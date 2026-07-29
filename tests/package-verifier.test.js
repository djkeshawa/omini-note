const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const verifier = require('../scripts/verify-packaged-renderer.js');

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-package-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    const devFile = path.join(root, verifier.EXPECTED);
    fs.mkdirSync(path.dirname(devFile), { recursive: true });
    fs.writeFileSync(devFile, 'renderer bundle', 'utf8');
    return fn({ root, devFile, devBundle: verifier.assertDevBundle(root) });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function elf(arch) {
  const buffer = Buffer.alloc(64);
  buffer.write('\x7fELF', 0, 'binary');
  buffer[4] = 2;
  buffer[5] = 1;
  buffer.writeUInt16LE(arch === 'arm64' ? 0xb7 : 0x3e, 18);
  return buffer;
}

function pe(arch) {
  const buffer = Buffer.alloc(256);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(128, 0x3c);
  buffer.write('PE\0\0', 128, 'binary');
  buffer.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 132);
  return buffer;
}

function macho(arch) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  return buffer;
}

function fatMacho() {
  const buffer = Buffer.alloc(48);
  buffer.writeUInt32BE(0xcafebabe, 0);
  buffer.writeUInt32BE(2, 4);
  buffer.writeUInt32BE(0x01000007, 8);
  buffer.writeUInt32BE(0x0100000c, 28);
  return buffer;
}

function writeFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function writeLinuxPackage(root, {
  renderer = 'renderer bundle',
  version = '1.2.3',
  executableArch = 'x64',
  sqliteArch = 'x64',
  vecArch = 'x64',
  extraVecPackage = '',
} = {}) {
  const resources = path.join(root, 'dist', 'linux-unpacked', 'resources');
  writeFile(path.join(resources, 'app', verifier.EXPECTED), renderer);
  writeFile(path.join(resources, 'app', 'package.json'), JSON.stringify({ version }));
  writeFile(path.join(resources, '..', 'vispnote'), elf(executableArch));
  writeFile(
    path.join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    elf(sqliteArch)
  );
  const vecPackage = `sqlite-vec-linux-${vecArch}`;
  writeFile(
    path.join(resources, 'app.asar.unpacked', 'node_modules', vecPackage, 'vec0.so'),
    elf(vecArch)
  );
  if (extraVecPackage) {
    writeFile(
      path.join(resources, 'app.asar.unpacked', 'node_modules', extraVecPackage, 'vec0.so'),
      elf('arm64')
    );
  }
  return { platform: 'linux', resources };
}

test('Packaged verifier fails when no packaged application exists', () => {
  withFixture(({ root, devBundle }) => {
    assert.throws(
      () => verifier.assertPackagedBundle(devBundle, [], root),
      /Missing packaged renderer bundle/
    );
  });
});

test('Packaged verifier compares renderer bytes and package version', () => {
  withFixture(({ root, devBundle }) => {
    const resourceRoot = writeLinuxPackage(root, { renderer: 'different renderer' });
    assert.throws(
      () => verifier.assertPackagedBundle(devBundle, [resourceRoot], root),
      /Packaged renderer hash mismatch/
    );
  });

  withFixture(({ root, devBundle }) => {
    const resourceRoot = writeLinuxPackage(root, { version: '1.2.4' });
    assert.throws(
      () => verifier.assertPackagedBundle(devBundle, [resourceRoot], root),
      /Packaged version mismatch/
    );
  });
});

test('Packaged verifier accepts an exact Linux x64 application', () => {
  withFixture(({ root, devBundle }) => {
    const resourceRoot = writeLinuxPackage(root);
    assert.doesNotThrow(() => verifier.verifyResourceRoots({
      root,
      devBundle,
      resourceRoots: [resourceRoot],
      expectedArch: 'x64',
    }));
  });
});

test('Packaged verifier rejects wrong-CPU executable and native modules', () => {
  withFixture(({ root, devBundle }) => {
    const resourceRoot = writeLinuxPackage(root, { executableArch: 'arm64' });
    assert.throws(
      () => verifier.verifyResourceRoots({
        root,
        devBundle,
        resourceRoots: [resourceRoot],
        expectedArch: 'x64',
      }),
      /Wrong-platform Electron executable/
    );
  });

  withFixture(({ root, devBundle }) => {
    const resourceRoot = writeLinuxPackage(root, { sqliteArch: 'arm64' });
    assert.throws(
      () => verifier.verifyResourceRoots({
        root,
        devBundle,
        resourceRoots: [resourceRoot],
        expectedArch: 'x64',
      }),
      /Wrong-platform better-sqlite3 native module/
    );
  });
});

test('Packaged verifier requires exactly the sqlite-vec package for the target CPU', () => {
  withFixture(({ root, devBundle }) => {
    const resourceRoot = writeLinuxPackage(root, {
      extraVecPackage: 'sqlite-vec-linux-arm64',
    });
    assert.throws(
      () => verifier.verifyResourceRoots({
        root,
        devBundle,
        resourceRoots: [resourceRoot],
        expectedArch: 'x64',
      }),
      /Wrong-platform sqlite-vec package/
    );
  });
});

test('Binary parser identifies exact PE, ELF, thin Mach-O and universal Mach-O CPUs', () => {
  assert.deepEqual(verifier.binaryArchitectures(elf('x64')), ['x64']);
  assert.deepEqual(verifier.binaryArchitectures(elf('arm64')), ['arm64']);
  assert.deepEqual(verifier.binaryArchitectures(pe('x64')), ['x64']);
  assert.deepEqual(verifier.binaryArchitectures(pe('arm64')), ['arm64']);
  assert.deepEqual(verifier.binaryArchitectures(macho('x64')), ['x64']);
  assert.deepEqual(verifier.binaryArchitectures(macho('arm64')), ['arm64']);
  assert.deepEqual(verifier.binaryArchitectures(fatMacho()), ['arm64', 'x64']);
});
