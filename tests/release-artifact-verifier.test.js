const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const verifier = require('../scripts/release-tools/verify-release-artifacts.js');

// The release verifier is the last gate before an installer reaches users.
// Its job: a truncated download, a corrupted build, or an updater manifest
// that does not match its artifact must fail the release -- and a correct
// build must pass, or every release is blocked.

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-release-'));
  try { return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('genuine artifact headers pass the magic check', () => {
  withDir(dir => {
    const cases = [
      ['app.zip', Buffer.concat([Buffer.from('PK'), Buffer.alloc(64)])],
      ['app.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)])],
      ['app.deb', Buffer.concat([Buffer.from('!<arch>\n'), Buffer.alloc(64)])],
      ['app.appimage', Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)])],
    ];
    for (const [name, bytes] of cases) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytes);
      assert.doesNotThrow(() => verifier.assertArtifactMagic(file), `${name} was rejected despite a valid header`);
    }
    // A DMG's magic lives in a trailer 512 bytes from the end.
    const dmg = path.join(dir, 'app.dmg');
    const body = Buffer.alloc(1024);
    Buffer.from('koly').copy(body, body.length - 512);
    fs.writeFileSync(dmg, body);
    assert.doesNotThrow(() => verifier.assertArtifactMagic(dmg), 'a valid DMG trailer was rejected');
  });
});

test('a corrupted or truncated artifact fails the release', () => {
  withDir(dir => {
    const bad = [
      ['broken.zip', Buffer.from('NOTAZIP....'), /Invalid ZIP header/],
      ['broken.exe', Buffer.from('ELF....'), /Invalid Windows executable/],
      ['broken.deb', Buffer.from('debian??'), /Invalid Debian archive/],
      ['broken.appimage', Buffer.from('PK......'), /Invalid AppImage header/],
      ['broken.dmg', Buffer.alloc(1024), /Invalid DMG trailer/],
      ['tiny.dmg', Buffer.from('x'), /Invalid DMG trailer/],
    ];
    for (const [name, bytes, expected] of bad) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytes);
      assert.throws(() => verifier.assertArtifactMagic(file), expected, `${name} passed with a corrupt header`);
    }
    const empty = path.join(dir, 'empty.zip');
    fs.writeFileSync(empty, '');
    assert.throws(() => verifier.assertArtifactMagic(empty), /empty/i, 'an empty artifact passed');
  });
});

const YML = (name, sha512, size, extra = '') => [
  'version: 1.2.3',
  'files:',
  `  - url: ${name}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  extra,
  `path: ${name}`,
  "releaseDate: '2026-08-01'",
].filter(Boolean).join('\n');

test('the updater manifest parser reads every field of every entry', () => {
  const text = [
    'version: 9.9.9',
    'files:',
    '  - url: My-App-Setup.exe',
    '    sha512: abc==',
    '    size: 123',
    '    blockMapSize: 45',
    '  - url: My-App.zip',
    '    sha512: def==',
    '    size: 678',
    'path: My-App-Setup.exe',
  ].join('\n');
  const entries = verifier.parseUpdateFiles(text);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { url: 'My-App-Setup.exe', sha512: 'abc==', size: 123, blockMapSize: 45 });
  assert.deepEqual(entries[1], { url: 'My-App.zip', sha512: 'def==', size: 678 });
});

test('a manifest that matches its artifact passes; a tampered artifact fails', () => {
  withDir(dir => {
    const name = 'App.deb';
    const artifact = path.join(dir, name);
    fs.writeFileSync(artifact, Buffer.concat([Buffer.from('!<arch>\n'), Buffer.from('payload')]));
    const bytes = fs.readFileSync(artifact);
    const sha = crypto.createHash('sha512').update(bytes).digest('base64');
    const yml = path.join(dir, 'latest-linux.yml');
    fs.writeFileSync(yml, YML(name, sha, bytes.length));
    assert.doesNotThrow(() => verifier.assertUpdateMetadata(yml, name), 'a correct build was blocked');

    // Now tamper with the artifact after the manifest was written -- the exact
    // situation the sha512 exists to catch.
    fs.appendFileSync(artifact, 'malicious tail');
    assert.throws(() => verifier.assertUpdateMetadata(yml, name), /integrity mismatch/,
      'a tampered installer passed the updater integrity check');
  });
});

test('a manifest referencing a missing or unlisted artifact fails', () => {
  withDir(dir => {
    const yml = path.join(dir, 'latest.yml');
    fs.writeFileSync(yml, YML('Ghost.deb', 'abc==', 10));
    assert.throws(() => verifier.assertUpdateMetadata(yml, 'Ghost.deb'), /missing artifact/i,
      'the updater would 404 for every user');
    assert.throws(() => verifier.assertUpdateMetadata(yml, 'NotInManifest.deb'), /does not reference/,
      'an installer absent from the manifest can never be offered as an update');
  });
});

test('differential-update targets must carry a blockmap; a .deb need not', () => {
  withDir(dir => {
    const make = (name, extra = '') => {
      const artifact = path.join(dir, name);
      const header = name.endsWith('.exe') ? 'MZ' : '!<arch>\n';
      fs.writeFileSync(artifact, Buffer.concat([Buffer.from(header), Buffer.from('data')]));
      const bytes = fs.readFileSync(artifact);
      const sha = crypto.createHash('sha512').update(bytes).digest('base64');
      const yml = path.join(dir, `latest-${name}.yml`);
      fs.writeFileSync(yml, YML(name, sha, bytes.length, extra));
      return yml;
    };
    // An NSIS installer with no sibling .blockmap and no appended blockMapSize
    // cannot serve differential updates -- the release must fail.
    assert.throws(() => verifier.assertUpdateMetadata(make('Setup.exe'), 'Setup.exe'), /blockmap/i);
    // The same installer with an appended block map size passes.
    assert.doesNotThrow(() => verifier.assertUpdateMetadata(make('Ok.exe', '    blockMapSize: 99'), 'Ok.exe'));
    // A Debian package supports no differential updates and needs neither.
    assert.doesNotThrow(() => verifier.assertUpdateMetadata(make('Plain.deb'), 'Plain.deb'));
    // An empty sibling blockmap is worse than none: the updater downloads it
    // and fails on every user's machine.
    const yml = make('WithMap.exe');
    fs.writeFileSync(path.join(dir, 'WithMap.exe.blockmap'), '');
    assert.throws(() => verifier.assertUpdateMetadata(yml, 'WithMap.exe'), /Empty updater blockmap/);
  });
});

test('the argument parser understands the release invocation', () => {
  const args = verifier.parseArgs(['--artifacts', '/tmp/out', '--platform', 'linux', '--arch', 'x64']);
  assert.ok(args.artifactDir.endsWith('/tmp/out'));
  assert.equal(args.platform, 'linux');
  assert.equal(args.arch, 'x64');
  assert.throws(() => verifier.parseArgs(['--not-a-flag', 'x']), /Unknown release verifier option/);
  assert.throws(() => verifier.parseArgs(['--platform']), /requires a value/);
});

test('mac signature verification cannot be disabled by a typo', () => {
  // Only a literal "false" relaxes the check: an unresolved CI expression like
  // "${{ inputs.skip }}" must fail loudly, not silently skip verification.
  assert.equal(verifier.parseArgs([]).verifyMacSigning, true, 'signing checks must default on');
  assert.equal(verifier.parseArgs(['--verify-mac-signing', 'false']).verifyMacSigning, false);
  assert.equal(verifier.parseArgs(['--verify-mac-signing', 'true']).verifyMacSigning, true);
  for (const junk of ['0', 'no', 'FALSE', '${{ inputs.skip }}']) {
    assert.throws(() => verifier.parseArgs(['--verify-mac-signing', junk]), /requires "true" or "false"/,
      `${JSON.stringify(junk)} should be rejected, not interpreted`);
  }
});
