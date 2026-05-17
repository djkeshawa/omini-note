const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const verifier = require('../scripts/verify-packaged-renderer.js');

function withPackageFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-package-'));
  try {
    const devFile = path.join(root, verifier.EXPECTED);
    fs.mkdirSync(path.dirname(devFile), { recursive: true });
    fs.writeFileSync(devFile, 'renderer bundle', 'utf8');
    const devTime = new Date('2026-05-17T08:00:00.000Z');
    fs.utimesSync(devFile, devTime, devTime);
    return fn({ root, devFile, devMtime: fs.statSync(devFile).mtimeMs });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writePackagedRenderer(root, contents = 'packaged renderer', time = new Date('2026-05-17T08:01:00.000Z')) {
  const file = path.join(root, 'dist', 'linux-unpacked', 'resources', 'app', verifier.EXPECTED);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
  fs.utimesSync(file, time, time);
  return file;
}

function writePackagedAsar(root, time = new Date('2026-05-17T08:01:00.000Z')) {
  const file = path.join(root, 'dist', 'linux-unpacked', 'resources', 'app.asar');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'asar placeholder', 'utf8');
  fs.utimesSync(file, time, time);
  return file;
}

test('Packaged renderer verifier fails when no packaged artifact exists', () => {
  withPackageFixture(({ root, devMtime }) => {
    assert.throws(
      () => verifier.assertPackagedBundle(devMtime, root),
      /Missing packaged renderer bundle/
    );
  });
});

test('Packaged renderer verifier rejects stale and empty unpacked bundles', () => {
  withPackageFixture(({ root, devMtime }) => {
    writePackagedRenderer(root, 'old bundle', new Date('2026-05-17T07:59:00.000Z'));
    assert.throws(
      () => verifier.assertPackagedBundle(devMtime, root),
      /Stale packaged renderer bundle/
    );
  });

  withPackageFixture(({ root, devMtime }) => {
    writePackagedRenderer(root, '');
    assert.throws(
      () => verifier.assertPackagedBundle(devMtime, root),
      /Empty packaged renderer bundle/
    );
  });
});

test('Packaged renderer verifier accepts a current unpacked bundle', () => {
  withPackageFixture(({ root, devMtime }) => {
    writePackagedRenderer(root);
    assert.doesNotThrow(() => verifier.assertPackagedBundle(devMtime, root));
  });
});

test('Packaged renderer verifier rejects stale app.asar artifacts', () => {
  withPackageFixture(({ root, devMtime }) => {
    writePackagedAsar(root, new Date('2026-05-17T07:59:00.000Z'));
    assert.throws(
      () => verifier.assertPackagedBundle(devMtime, root),
      /Stale packaged app\.asar/
    );
  });
});
