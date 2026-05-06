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

const devBundleMtimeMs = assertDevBundle();
assertPackagedBundle(devBundleMtimeMs);
console.log(`Verified packaged renderer path: ${EXPECTED}`);
