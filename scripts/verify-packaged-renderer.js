let fs;
try {
  fs = require('original-fs');
} catch {
  fs = require('fs');
}
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXPECTED = 'build/renderer/app.js';
const PACKAGE_JSON = 'package.json';

const SQLITE_VEC_PACKAGES = {
  darwin: {
    x64: { name: 'sqlite-vec-darwin-x64', extension: 'dylib' },
    arm64: { name: 'sqlite-vec-darwin-arm64', extension: 'dylib' },
  },
  linux: {
    x64: { name: 'sqlite-vec-linux-x64', extension: 'so' },
    arm64: { name: 'sqlite-vec-linux-arm64', extension: 'so' },
  },
  win32: {
    x64: { name: 'sqlite-vec-windows-x64', extension: 'dll' },
    arm64: { name: 'sqlite-vec-windows-arm64', extension: 'dll' },
  },
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function normalizePlatform(value) {
  const platform = String(value || '').toLowerCase();
  if (platform === 'mac' || platform === 'macos' || platform === 'darwin') return 'darwin';
  if (platform === 'win' || platform === 'windows' || platform === 'win32') return 'win32';
  if (platform === 'linux') return 'linux';
  throw new Error(`Unsupported package platform: ${value}`);
}

function normalizeArch(value) {
  const arch = String(value || '').toLowerCase();
  if (arch === 'x64' || arch === 'x86_64' || arch === 'amd64') return 'x64';
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
  throw new Error(`Unsupported package architecture: ${value}`);
}

function relative(root, file) {
  return path.relative(root, file) || '.';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertDevBundle(root = ROOT) {
  const file = path.join(root, EXPECTED);
  if (!fs.existsSync(file)) throw new Error(`Missing renderer bundle: ${EXPECTED}`);
  const contents = fs.readFileSync(file);
  if (!contents.length) throw new Error(`Renderer bundle is empty: ${EXPECTED}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, PACKAGE_JSON), 'utf8'));
  return {
    file,
    hash: sha256(contents),
    version: pkg.version,
  };
}

function loadAsar() {
  try {
    return require('@electron/asar');
  } catch {
    throw new Error('Found app.asar but @electron/asar is unavailable for package inspection');
  }
}

function readPackagedFile(resources, entry) {
  const unpacked = path.join(resources, 'app', ...entry.split('/'));
  if (fs.existsSync(unpacked)) return fs.readFileSync(unpacked);

  const asarFile = path.join(resources, 'app.asar');
  if (!fs.existsSync(asarFile)) {
    throw new Error(`Missing packaged app.asar in ${resources}`);
  }
  try {
    return loadAsar().extractFile(asarFile, entry);
  } catch (error) {
    throw new Error(`Missing ${entry} from packaged app.asar: ${error.message}`);
  }
}

function discoverResourceRoots(searchRoot, platform) {
  const normalizedPlatform = normalizePlatform(platform);
  const resources = new Set();
  for (const file of walk(searchRoot)) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.endsWith('/resources/app.asar')) resources.add(path.dirname(file));
    if (normalized.endsWith('/resources/app/package.json')) {
      resources.add(path.dirname(path.dirname(file)));
    }
  }
  return [...resources].sort().map(resourcePath => ({
    platform: normalizedPlatform,
    resources: resourcePath,
  }));
}

function packagedResourceRoots(root = ROOT, platform = process.platform) {
  const normalizedPlatform = normalizePlatform(platform);
  return discoverResourceRoots(path.join(root, 'dist'), normalizedPlatform).filter(resourceRoot => {
    const normalized = resourceRoot.resources.replace(/\\/g, '/');
    if (normalizedPlatform === 'darwin') return normalized.endsWith('.app/Contents/Resources');
    if (normalizedPlatform === 'win32') return normalized.includes('/win-unpacked/resources');
    return normalized.includes('/linux-unpacked/resources');
  });
}

function assertPackagedBundle(devBundle, resourceRoots, root = ROOT) {
  if (!resourceRoots.length) {
    throw new Error('Missing packaged renderer bundle; run a package build before verification');
  }
  for (const resourceRoot of resourceRoots) {
    const renderer = readPackagedFile(resourceRoot.resources, EXPECTED);
    if (!renderer.length) {
      throw new Error(`Empty packaged renderer bundle: ${relative(root, resourceRoot.resources)}`);
    }
    const packagedHash = sha256(renderer);
    if (packagedHash !== devBundle.hash) {
      throw new Error(
        `Packaged renderer hash mismatch in ${relative(root, resourceRoot.resources)}: `
        + `expected ${devBundle.hash}, received ${packagedHash}`
      );
    }

    let pkg;
    try {
      pkg = JSON.parse(readPackagedFile(resourceRoot.resources, PACKAGE_JSON).toString('utf8'));
    } catch (error) {
      throw new Error(`Invalid packaged package.json in ${relative(root, resourceRoot.resources)}: ${error.message}`);
    }
    if (pkg.version !== devBundle.version) {
      throw new Error(
        `Packaged version mismatch in ${relative(root, resourceRoot.resources)}: `
        + `expected ${devBundle.version}, received ${pkg.version || '(empty)'}`
      );
    }
  }
}

function cpuName(cpuType) {
  const normalized = cpuType >>> 0;
  if (normalized === 0x01000007) return 'x64';
  if (normalized === 0x0100000c) return 'arm64';
  return null;
}

function binaryArchitectures(value) {
  const buffer = Buffer.isBuffer(value) ? value : fs.readFileSync(value);
  if (buffer.length < 20) return [];

  if (buffer[0] === 0x7f && buffer.subarray(1, 4).toString('ascii') === 'ELF') {
    const littleEndian = buffer[5] === 1;
    const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
    if (machine === 0x3e) return ['x64'];
    if (machine === 0xb7) return ['arm64'];
    return [];
  }

  if (buffer[0] === 0x4d && buffer[1] === 0x5a && buffer.length >= 64) {
    const header = buffer.readUInt32LE(0x3c);
    if (header + 6 > buffer.length || buffer.subarray(header, header + 4).toString('hex') !== '50450000') {
      return [];
    }
    const machine = buffer.readUInt16LE(header + 4);
    if (machine === 0x8664) return ['x64'];
    if (machine === 0xaa64) return ['arm64'];
    return [];
  }

  const magic = buffer.subarray(0, 4).toString('hex');
  const thinEndian = {
    feedface: 'be',
    feedfacf: 'be',
    cefaedfe: 'le',
    cffaedfe: 'le',
  }[magic];
  if (thinEndian) {
    const cpuType = thinEndian === 'be' ? buffer.readUInt32BE(4) : buffer.readUInt32LE(4);
    const arch = cpuName(cpuType);
    return arch ? [arch] : [];
  }

  const fatEndian = magic === 'cafebabe' || magic === 'cafebabf'
    ? 'be'
    : magic === 'bebafeca' || magic === 'bfbafeca'
      ? 'le'
      : null;
  if (!fatEndian) return [];
  const read32 = offset => fatEndian === 'be' ? buffer.readUInt32BE(offset) : buffer.readUInt32LE(offset);
  const count = read32(4);
  const entrySize = magic === 'cafebabf' || magic === 'bfbafeca' ? 32 : 20;
  if (!count || count > 32 || 8 + count * entrySize > buffer.length) return [];
  const architectures = new Set();
  for (let index = 0; index < count; index += 1) {
    const arch = cpuName(read32(8 + index * entrySize));
    if (arch) architectures.add(arch);
  }
  return [...architectures].sort();
}

function assertExactBinaryArchitecture(file, expectedArch, label, root = ROOT) {
  const expected = normalizeArch(expectedArch);
  const actual = binaryArchitectures(file);
  if (actual.length !== 1 || actual[0] !== expected) {
    const prefix = label.startsWith('Wrong-platform ') ? label : `Wrong-platform ${label}`;
    throw new Error(
      `${prefix}: ${relative(root, file)} `
      + `(expected ${expected}, received ${actual.join('+') || 'unknown'})`
    );
  }
}

function applicationExecutable(resourceRoot) {
  const parent = path.dirname(resourceRoot.resources);
  if (resourceRoot.platform === 'darwin') {
    return path.join(parent, 'MacOS', 'VispNote');
  }
  if (resourceRoot.platform === 'win32') return path.join(parent, 'VispNote.exe');
  return path.join(parent, 'vispnote');
}

function assertApplicationExecutable(resourceRoot, expectedArch, root = ROOT) {
  const executable = applicationExecutable(resourceRoot);
  if (!fs.existsSync(executable)) {
    throw new Error(`Missing packaged Electron executable: ${relative(root, executable)}`);
  }
  assertExactBinaryArchitecture(executable, expectedArch, 'Electron executable', root);
}

function assertBetterSqliteNative(resourceRoot, expectedArch, root = ROOT) {
  const nativeFile = path.join(
    resourceRoot.resources,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );
  if (!fs.existsSync(nativeFile)) {
    throw new Error(`Missing better-sqlite3 native module in ${relative(root, resourceRoot.resources)}`);
  }
  assertExactBinaryArchitecture(
    nativeFile,
    expectedArch,
    'Wrong-platform better-sqlite3 native module',
    root
  );
}

function assertSqliteVecNative(resourceRoot, expectedArch, root = ROOT) {
  const arch = normalizeArch(expectedArch);
  const expected = SQLITE_VEC_PACKAGES[resourceRoot.platform]?.[arch];
  if (!expected) throw new Error(`sqlite-vec does not support ${resourceRoot.platform}-${arch}`);

  const modulesDir = path.join(resourceRoot.resources, 'app.asar.unpacked', 'node_modules');
  const installed = fs.existsSync(modulesDir)
    ? fs.readdirSync(modulesDir).filter(name => /^sqlite-vec-(darwin|linux|windows)-/.test(name)).sort()
    : [];
  if (installed.length !== 1 || installed[0] !== expected.name) {
    throw new Error(
      `Wrong-platform sqlite-vec package in ${relative(root, resourceRoot.resources)}: `
      + `expected ${expected.name}, received ${installed.join(', ') || '(none)'}`
    );
  }
  const nativeFile = path.join(modulesDir, expected.name, `vec0.${expected.extension}`);
  if (!fs.existsSync(nativeFile)) {
    throw new Error(`Missing sqlite-vec native extension: ${relative(root, nativeFile)}`);
  }
  assertExactBinaryArchitecture(nativeFile, arch, 'sqlite-vec native extension', root);
}

function verifyResourceRoots({
  root = ROOT,
  devBundle = assertDevBundle(root),
  resourceRoots,
  expectedArch,
}) {
  assertPackagedBundle(devBundle, resourceRoots, root);
  for (const resourceRoot of resourceRoots) {
    assertApplicationExecutable(resourceRoot, expectedArch, root);
    assertBetterSqliteNative(resourceRoot, expectedArch, root);
    assertSqliteVecNative(resourceRoot, expectedArch, root);
  }
}

function parseArgs(argv) {
  const options = {
    root: ROOT,
    platform: process.platform,
    arch: process.arch,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--root') options.root = path.resolve(value);
    else if (flag === '--platform') options.platform = normalizePlatform(value);
    else if (flag === '--arch') options.arch = normalizeArch(value);
    else throw new Error(`Unknown verifier option: ${flag}`);
    index += 1;
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const resourceRoots = packagedResourceRoots(options.root, options.platform);
  verifyResourceRoots({
    root: options.root,
    resourceRoots,
    expectedArch: options.arch,
  });
  console.log(
    `Verified ${resourceRoots.length} packaged app resource root(s): `
    + `${normalizePlatform(options.platform)}-${normalizeArch(options.arch)}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED,
  SQLITE_VEC_PACKAGES,
  applicationExecutable,
  assertDevBundle,
  assertExactBinaryArchitecture,
  assertPackagedBundle,
  binaryArchitectures,
  discoverResourceRoots,
  normalizeArch,
  normalizePlatform,
  packagedResourceRoots,
  readPackagedFile,
  sha256,
  verifyResourceRoots,
};
