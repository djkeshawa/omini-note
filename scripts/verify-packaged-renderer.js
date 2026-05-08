const fs = require('fs');
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

function assertDevBundle() {
  const file = path.join(ROOT, EXPECTED);
  if (!fs.existsSync(file)) throw new Error(`Missing renderer bundle: ${EXPECTED}`);
  if (fs.statSync(file).size <= 0) throw new Error(`Renderer bundle is empty: ${EXPECTED}`);
  return fs.statSync(file).mtimeMs;
}

function assertPackagedBundle(devBundleMtimeMs) {
  const unpackedApps = walk(path.join(ROOT, 'dist'))
    .filter(file => file.endsWith(path.join('resources', 'app', EXPECTED)));
  if (unpackedApps.length) return;

  const asarFiles = walk(path.join(ROOT, 'dist'))
    .filter(file => file.endsWith('app.asar'))
    .filter(file => fs.statSync(file).mtimeMs >= devBundleMtimeMs);
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
    throw new Error(`Renderer bundle missing from packaged asar: ${missing.map(file => path.relative(ROOT, file)).join(', ')}`);
  }
}

function packagedResourceRoots(devBundleMtimeMs) {
  const dist = path.join(ROOT, 'dist');
  const roots = [];
  const add = (platform, resources) => {
    const asarFile = path.join(resources, 'app.asar');
    if (!fs.existsSync(asarFile)) return;
    if (fs.statSync(asarFile).mtimeMs < devBundleMtimeMs) return;
    roots.push({ platform, resources });
  };

  add('win32', path.join(dist, 'win-unpacked', 'resources'));
  add('linux', path.join(dist, 'linux-unpacked', 'resources'));

  for (const file of walk(dist)) {
    const normalized = file.replace(/\\/g, '/');
    if (!normalized.endsWith('.app/Contents/Resources/app.asar')) continue;
    if (fs.statSync(file).mtimeMs < devBundleMtimeMs) continue;
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

function assertPackagedNativeModules(devBundleMtimeMs) {
  for (const root of packagedResourceRoots(devBundleMtimeMs)) {
    assertBetterSqliteNative(root);
    assertSqliteVecNative(root);
  }
}

const devBundleMtimeMs = assertDevBundle();
assertPackagedBundle(devBundleMtimeMs);
assertPackagedNativeModules(devBundleMtimeMs);
console.log(`Verified packaged renderer path: ${EXPECTED}`);
