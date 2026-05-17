let fs;
try {
  fs = require('original-fs');
} catch {
  fs = require('fs');
}
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXPECTED = 'build/renderer/app.js';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function relative(root, file) {
  return path.relative(root, file) || '.';
}

function assertDevBundle(root = ROOT) {
  const file = path.join(root, EXPECTED);
  if (!fs.existsSync(file)) throw new Error(`Missing renderer bundle: ${EXPECTED}`);
  if (fs.statSync(file).size <= 0) throw new Error(`Renderer bundle is empty: ${EXPECTED}`);
  return fs.statSync(file).mtimeMs;
}

function staleFiles(files, mtimeMs) {
  return files.filter(file => fs.statSync(file).mtimeMs < mtimeMs);
}

function assertPackagedBundle(devBundleMtimeMs, root = ROOT) {
  const dist = path.join(root, 'dist');
  const unpackedApps = walk(dist)
    .filter(file => file.endsWith(path.join('resources', 'app', EXPECTED)));
  const asarFiles = walk(dist)
    .filter(file => file.endsWith('app.asar'));
  if (!unpackedApps.length && !asarFiles.length) {
    throw new Error('Missing packaged renderer bundle in dist; run a package build before verification');
  }

  const staleUnpacked = staleFiles(unpackedApps, devBundleMtimeMs);
  if (staleUnpacked.length) {
    throw new Error(`Stale packaged renderer bundle: ${staleUnpacked.map(file => relative(root, file)).join(', ')}`);
  }
  const emptyUnpacked = unpackedApps.filter(file => fs.statSync(file).size <= 0);
  if (emptyUnpacked.length) {
    throw new Error(`Empty packaged renderer bundle: ${emptyUnpacked.map(file => relative(root, file)).join(', ')}`);
  }

  const staleAsars = staleFiles(asarFiles, devBundleMtimeMs);
  if (staleAsars.length) {
    throw new Error(`Stale packaged app.asar: ${staleAsars.map(file => relative(root, file)).join(', ')}`);
  }
  if (!asarFiles.length) return;

  let asar;
  try {
    asar = require('@electron/asar');
  } catch {
    throw new Error('Found app.asar but @electron/asar is unavailable for package inspection');
  }
  const expectedEntry = `/${EXPECTED}`;
  const missing = asarFiles.filter(file => {
    const entries = asar.listPackage(file).map(entry => entry.replace(/\\/g, '/'));
    return !entries.includes(expectedEntry);
  });
  if (missing.length) {
    throw new Error(`Renderer bundle missing from packaged asar: ${missing.map(file => relative(root, file)).join(', ')}`);
  }
}

function packagedResourceRoots(root = ROOT) {
  const dist = path.join(root, 'dist');
  const roots = [];
  const add = (platform, resources) => {
    const asarFile = path.join(resources, 'app.asar');
    if (!fs.existsSync(asarFile)) return;
    roots.push({ platform, resources });
  };

  add('win32', path.join(dist, 'win-unpacked', 'resources'));
  add('linux', path.join(dist, 'linux-unpacked', 'resources'));

  for (const file of walk(dist)) {
    const normalized = file.replace(/\\/g, '/');
    if (!normalized.endsWith('.app/Contents/Resources/app.asar')) continue;
    roots.push({ platform: 'darwin', resources: path.dirname(file) });
  }

  return roots;
}

function hasMagic(file, platform) {
  const buf = fs.readFileSync(file);
  if (platform === 'win32') return buf[0] === 0x4d && buf[1] === 0x5a; // MZ
  if (platform === 'linux') return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46; // ELF
  if (platform === 'darwin') {
    const magic = buf.subarray(0, 4).toString('hex');
    return ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'cafebabf'].includes(magic);
  }
  return false;
}

function assertBetterSqliteNative(root) {
  const nativeFile = path.join(
    root.resources,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );
  if (!fs.existsSync(nativeFile)) {
    throw new Error(`Missing better-sqlite3 native module in ${path.relative(ROOT, root.resources)}`);
  }
  if (!hasMagic(nativeFile, root.platform)) {
    throw new Error(`Wrong-platform better-sqlite3 native module: ${path.relative(ROOT, nativeFile)}`);
  }
}

function assertSqliteVecNative(root) {
  const modulesDir = path.join(root.resources, 'app.asar.unpacked', 'node_modules');
  const platformPackages = {
    win32: ['sqlite-vec-windows-x64'],
    linux: ['sqlite-vec-linux-x64', 'sqlite-vec-linux-arm64'],
    darwin: ['sqlite-vec-darwin-x64', 'sqlite-vec-darwin-arm64'],
  };
  const extension = {
    win32: 'dll',
    linux: 'so',
    darwin: 'dylib',
  }[root.platform];
  const expectedPackages = platformPackages[root.platform] || [];
  const installedPackages = fs.existsSync(modulesDir)
    ? fs.readdirSync(modulesDir).filter(name => /^sqlite-vec-(darwin|linux|windows)-/.test(name))
    : [];
  const wrongPackages = installedPackages.filter(name => !expectedPackages.includes(name));
  if (wrongPackages.length) {
    throw new Error(`Wrong-platform sqlite-vec package in ${path.relative(ROOT, root.resources)}: ${wrongPackages.join(', ')}`);
  }
  const expectedFile = expectedPackages
    .map(name => path.join(modulesDir, name, `vec0.${extension}`))
    .find(file => fs.existsSync(file));
  if (!expectedFile) {
    throw new Error(`Missing sqlite-vec ${root.platform} native extension in ${path.relative(ROOT, root.resources)}`);
  }
  if (!hasMagic(expectedFile, root.platform)) {
    throw new Error(`Wrong-platform sqlite-vec native extension: ${path.relative(ROOT, expectedFile)}`);
  }
}

function assertPackagedNativeModules() {
  for (const root of packagedResourceRoots()) {
    assertBetterSqliteNative(root);
    assertSqliteVecNative(root);
  }
}

function main() {
  const devBundleMtimeMs = assertDevBundle();
  assertPackagedBundle(devBundleMtimeMs);
  assertPackagedNativeModules();
  console.log(`Verified packaged renderer path: ${EXPECTED}`);
}

if (require.main === module) main();

module.exports = {
  EXPECTED,
  assertDevBundle,
  assertPackagedBundle,
  packagedResourceRoots,
  main,
};
