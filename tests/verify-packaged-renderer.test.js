const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const verifier = require('../scripts/verify-packaged-renderer.js');

// The release gate that refuses to ship a package built for the wrong CPU or
// carrying a stale renderer bundle. It reads binary headers by hand, so the
// header parsing is pinned here against synthetic binaries of each format --
// a false "looks fine" here ships an app that will not start.

function elf({ arch = 'x64', bigEndian = false } = {}) {
  const buffer = Buffer.alloc(64);
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'ascii');
  buffer[5] = bigEndian ? 2 : 1;
  const machine = arch === 'arm64' ? 0xb7 : arch === 'x64' ? 0x3e : 0x28;
  if (bigEndian) buffer.writeUInt16BE(machine, 18);
  else buffer.writeUInt16LE(machine, 18);
  return buffer;
}

function pe({ arch = 'x64', header = 0x80, magic = '50450000', size = null } = {}) {
  const buffer = Buffer.alloc(size == null ? Math.max(256, header + 8) : size);
  buffer[0] = 0x4d;
  buffer[1] = 0x5a;
  buffer.writeUInt32LE(header, 0x3c);
  buffer.write(magic, header, 'hex');
  buffer.writeUInt16LE(arch === 'arm64' ? 0xaa64 : arch === 'x64' ? 0x8664 : 0x014c, header + 4);
  return buffer;
}

const CPU = { x64: 0x01000007, arm64: 0x0100000c, unknown: 0x0000000c };

function machoThin({ arch = 'x64', magic = 'feedfacf' } = {}) {
  const buffer = Buffer.alloc(64);
  buffer.write(magic, 0, 'hex');
  const littleEndian = magic === 'cefaedfe' || magic === 'cffaedfe';
  if (littleEndian) buffer.writeUInt32LE(CPU[arch], 4);
  else buffer.writeUInt32BE(CPU[arch], 4);
  return buffer;
}

function machoFat({ arches = ['x64', 'arm64'], magic = 'cafebabe', count = null } = {}) {
  const entrySize = magic === 'cafebabf' || magic === 'bfbafeca' ? 32 : 20;
  const littleEndian = magic === 'bebafeca' || magic === 'bfbafeca';
  const total = count == null ? arches.length : count;
  const buffer = Buffer.alloc(8 + Math.max(arches.length, 1) * entrySize + 8);
  buffer.write(magic, 0, 'hex');
  if (littleEndian) buffer.writeUInt32LE(total, 4);
  else buffer.writeUInt32BE(total, 4);
  arches.forEach((arch, index) => {
    const at = 8 + index * entrySize;
    if (littleEndian) buffer.writeUInt32LE(CPU[arch], at);
    else buffer.writeUInt32BE(CPU[arch], at);
  });
  return buffer;
}

test('platform and architecture names are normalised, or refused by name', () => {
  for (const [value, expected] of [['mac', 'darwin'], ['macOS', 'darwin'], ['darwin', 'darwin'],
    ['win', 'win32'], ['windows', 'win32'], ['WIN32', 'win32'], ['Linux', 'linux']]) {
    assert.equal(verifier.normalizePlatform(value), expected);
  }
  for (const bad of ['solaris', '', null, undefined]) {
    assert.throws(() => verifier.normalizePlatform(bad), /Unsupported package platform/);
  }

  for (const [value, expected] of [['x64', 'x64'], ['x86_64', 'x64'], ['AMD64', 'x64'],
    ['arm64', 'arm64'], ['aarch64', 'arm64']]) {
    assert.equal(verifier.normalizeArch(value), expected);
  }
  for (const bad of ['ia32', 'armv7', '', null]) {
    assert.throws(() => verifier.normalizeArch(bad), /Unsupported package architecture/);
  }
});

test('an ELF binary reports the one architecture it was built for', () => {
  assert.deepEqual(verifier.binaryArchitectures(elf({ arch: 'x64' })), ['x64']);
  assert.deepEqual(verifier.binaryArchitectures(elf({ arch: 'arm64' })), ['arm64']);
  assert.deepEqual(verifier.binaryArchitectures(elf({ arch: 'x64', bigEndian: true })), ['x64'],
    'a big-endian ELF header is read the other way round');
  assert.deepEqual(verifier.binaryArchitectures(elf({ arch: 'arm64', bigEndian: true })), ['arm64']);
  assert.deepEqual(verifier.binaryArchitectures(elf({ arch: 'mips' })), [],
    'an architecture we do not ship is reported as unknown, not guessed');
});

test('a Windows PE binary is read through its PE header offset', () => {
  assert.deepEqual(verifier.binaryArchitectures(pe({ arch: 'x64' })), ['x64']);
  assert.deepEqual(verifier.binaryArchitectures(pe({ arch: 'arm64' })), ['arm64']);
  assert.deepEqual(verifier.binaryArchitectures(pe({ arch: 'i386' })), []);
  assert.deepEqual(verifier.binaryArchitectures(pe({ magic: 'deadbeef' })), [],
    'a file that says MZ but carries no PE header is not a Windows binary');
  const truncated = Buffer.alloc(128);
  truncated[0] = 0x4d;
  truncated[1] = 0x5a;
  truncated.writeUInt32LE(0x7fffff00, 0x3c);
  assert.deepEqual(verifier.binaryArchitectures(truncated), [],
    'a header offset past the end of the file is refused rather than read');
});

test('a Mach-O binary is read thin or fat, in either byte order', () => {
  for (const magic of ['feedface', 'feedfacf']) {
    assert.deepEqual(verifier.binaryArchitectures(machoThin({ arch: 'x64', magic })), ['x64']);
    assert.deepEqual(verifier.binaryArchitectures(machoThin({ arch: 'arm64', magic })), ['arm64']);
  }
  for (const magic of ['cefaedfe', 'cffaedfe']) {
    assert.deepEqual(verifier.binaryArchitectures(machoThin({ arch: 'x64', magic })), ['x64']);
  }
  assert.deepEqual(verifier.binaryArchitectures(machoThin({ arch: 'unknown' })), []);

  // A universal binary lists every slice it contains -- which is exactly what
  // the gate refuses for a single-architecture release.
  assert.deepEqual(verifier.binaryArchitectures(machoFat({ arches: ['x64', 'arm64'] })), ['arm64', 'x64']);
  assert.deepEqual(verifier.binaryArchitectures(machoFat({ arches: ['arm64'] })), ['arm64']);
  for (const magic of ['cafebabf', 'bebafeca', 'bfbafeca']) {
    assert.deepEqual(verifier.binaryArchitectures(machoFat({ arches: ['arm64'], magic })), ['arm64'],
      `${magic} is a fat header too`);
  }
  assert.deepEqual(verifier.binaryArchitectures(machoFat({ arches: [], count: 0 })), [],
    'a fat binary with no slices contains nothing');
  assert.deepEqual(verifier.binaryArchitectures(machoFat({ arches: ['x64'], count: 999 })), [],
    'a slice count larger than the file is refused rather than read past the end');
  assert.deepEqual(verifier.binaryArchitectures(machoFat({ arches: ['x64'], count: 40 })), [],
    'and so is an implausible slice count');
});

test('anything that is not a binary we recognise reports nothing', () => {
  assert.deepEqual(verifier.binaryArchitectures(Buffer.alloc(10)), [], 'a file too short to have a header');
  assert.deepEqual(verifier.binaryArchitectures(Buffer.alloc(64)), []);
  assert.deepEqual(verifier.binaryArchitectures(Buffer.from('just some text, quite a lot of it really')), []);
});

test('a binary built for the wrong CPU is named in the failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-verify-'));
  try {
    const file = path.join(dir, 'better_sqlite3.node');
    fs.writeFileSync(file, elf({ arch: 'arm64' }));
    assert.doesNotThrow(() => verifier.assertExactBinaryArchitecture(file, 'arm64', 'native module', dir));
    assert.throws(() => verifier.assertExactBinaryArchitecture(file, 'x64', 'native module', dir), err => {
      assert.match(err.message, /^Wrong-platform native module: better_sqlite3\.node /);
      assert.match(err.message, /expected x64, received arm64/);
      return true;
    });

    const universal = path.join(dir, 'universal.node');
    fs.writeFileSync(universal, machoFat({ arches: ['x64', 'arm64'] }));
    assert.throws(() => verifier.assertExactBinaryArchitecture(universal, 'x64', 'native module', dir),
      /received arm64\+x64/, 'a universal binary is not a single-architecture build');

    const unknown = path.join(dir, 'unknown.node');
    fs.writeFileSync(unknown, Buffer.alloc(64));
    assert.throws(() => verifier.assertExactBinaryArchitecture(unknown, 'x64', 'native module', dir),
      /received unknown/);

    assert.throws(() => verifier.assertExactBinaryArchitecture(unknown, 'x64', 'Wrong-platform thing', dir),
      /Error: Wrong-platform thing: unknown\.node/, 'a label that already says it is not repeated');
    assert.throws(() => verifier.assertExactBinaryArchitecture(unknown, 'ia32', 'thing', dir),
      /Unsupported package architecture/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the application executable is named per platform', () => {
  assert.equal(
    verifier.applicationExecutable({ platform: 'darwin', resources: path.join('/app', 'Contents', 'Resources') }),
    path.join('/app', 'Contents', 'MacOS', 'VispNote'));
  const linux = verifier.applicationExecutable({ platform: 'linux', resources: path.join('/app', 'resources') });
  assert.equal(path.dirname(linux), '/app');
  const windows = verifier.applicationExecutable({ platform: 'win32', resources: path.join('/app', 'resources') });
  assert.match(path.basename(windows), /\.exe$/i, 'a Windows build looks for an .exe');
});

test('the dev bundle must exist, carry content, and be hashed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-verify-dev-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    assert.throws(() => verifier.assertDevBundle(dir), /Missing renderer bundle: build\/renderer\/app\.js/);

    fs.mkdirSync(path.join(dir, 'build', 'renderer'), { recursive: true });
    const bundle = path.join(dir, 'build', 'renderer', 'app.js');
    fs.writeFileSync(bundle, '');
    assert.throws(() => verifier.assertDevBundle(dir), /Renderer bundle is empty/,
      'an empty bundle would package an app that renders nothing');

    fs.writeFileSync(bundle, 'console.log(1);');
    const result = verifier.assertDevBundle(dir);
    assert.equal(result.file, bundle);
    assert.equal(result.version, '9.9.9');
    assert.equal(result.hash, crypto.createHash('sha256').update('console.log(1);').digest('hex'),
      'the hash is what the packaged copy is compared against');
    assert.equal(verifier.sha256('console.log(1);'), result.hash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resource roots are discovered per platform, and none is not an error here', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-verify-roots-'));
  try {
    assert.deepEqual(verifier.discoverResourceRoots(dir, 'linux'), [], 'an unbuilt tree has no packaged roots');
    assert.deepEqual(verifier.discoverResourceRoots(path.join(dir, 'missing'), 'linux'), []);

    fs.mkdirSync(path.join(dir, 'linux-unpacked', 'resources'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'linux-unpacked', 'resources', 'app.asar'), 'not really an asar');
    const roots = verifier.discoverResourceRoots(dir, 'linux');
    assert.equal(roots.length, 1);
    assert.equal(roots[0].platform, 'linux');
    assert.match(roots[0].resources, /linux-unpacked/);

    fs.mkdirSync(path.join(dir, 'mac', 'VispNote.app', 'Contents', 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'mac', 'VispNote.app', 'Contents', 'Resources', 'app.asar'), 'x');
    const macRoots = verifier.discoverResourceRoots(dir, 'darwin');
    assert.equal(macRoots.length, 2, 'every resources directory under the build tree is checked');
    assert.ok(macRoots.every(root => root.platform === 'darwin'),
      'each root is labelled with the platform being verified, not guessed from its path');
    assert.ok(macRoots.some(root => root.resources.includes('VispNote.app')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the sqlite-vec package table covers every platform we ship', () => {
  assert.deepEqual(Object.keys(verifier.SQLITE_VEC_PACKAGES).sort(), ['darwin', 'linux', 'win32']);
  for (const [platform, arches] of Object.entries(verifier.SQLITE_VEC_PACKAGES)) {
    assert.deepEqual(Object.keys(arches).sort(), ['arm64', 'x64'], `${platform} must cover both architectures`);
    for (const entry of Object.values(arches)) {
      assert.match(entry.name, /^sqlite-vec-/);
      assert.ok(['dylib', 'so', 'dll'].includes(entry.extension));
    }
  }
  assert.equal(verifier.EXPECTED, 'build/renderer/app.js');
});
