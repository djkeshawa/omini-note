const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const artifacts = require('../scripts/release-tools/prepare-artifacts');
const macSigning = require('../scripts/release-tools/prepare-macos-signing');
const retry = require('../scripts/release-tools/retry-command');
const tags = require('../scripts/release-tools/validate-release-tag');
const finalVerifier = require('../scripts/release-tools/verify-release-artifacts');
const PROJECT_ROOT = path.join(__dirname, '..');

function withTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-release-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(file, contents = 'artifact') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

test('Release tag must exactly equal the package version', () => {
  assert.equal(tags.validateReleaseTag('v1.2.3', '1.2.3'), 'v1.2.3');
  assert.throws(() => tags.validateReleaseTag('v1.2.3-build.1', '1.2.3'), /must exactly match/);
  assert.throws(() => tags.validateReleaseTag('v1.2.4', '1.2.3'), /expected v1\.2\.3/);
  assert.throws(() => tags.validateReleaseTag('', '1.2.3'), /received \(empty\)/);
  assert.equal(
    tags.validatePinnedImage(`ghcr.io/example/memory@sha256:${'a'.repeat(64)}`),
    `ghcr.io/example/memory@sha256:${'a'.repeat(64)}`
  );
  assert.throws(() => tags.validatePinnedImage('ghcr.io/example/memory:latest'), /immutable/);
  assert.throws(() => tags.validatePinnedImage(`@sha256:${'a'.repeat(64)}`), /immutable/);
});

test('Retry helper returns success and cleans only between failed attempts', async () => {
  const statuses = [7, 0];
  const cleaned = [];
  const waits = [];
  const status = await retry.retryCommand({
    attempts: 3,
    delayMs: 25,
    cleanPaths: ['dist'],
    command: 'build',
    run: () => ({ status: statuses.shift() }),
    clean: target => cleaned.push(target),
    wait: ms => waits.push(ms),
    log: { log() {}, error() {} },
  });
  assert.equal(status, 0);
  assert.deepEqual(cleaned, ['dist']);
  assert.deepEqual(waits, [25]);
});

test('Retry helper preserves the final failing exit code', async () => {
  const status = await retry.retryCommand({
    attempts: 3,
    delayMs: 10,
    command: 'build',
    run: () => ({ status: 42 }),
    wait: () => {},
    log: { log() {}, error() {} },
  });
  assert.equal(status, 42);
});

test('Retry helper refuses broad cleanup targets', () => {
  assert.throws(() => retry.defaultClean('.'), /Refusing to clean path/);
  assert.throws(() => retry.defaultClean('..'), /outside the working directory/);
});

test('macOS signing preparation fails closed and writes a private API key file', () => {
  assert.throws(() => macSigning.assertSigningEnvironment({}), /CSC_LINK/);
  const encoded = Buffer.from('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n').toString('base64');
  withTemp(root => {
    const githubEnv = path.join(root, 'github-env');
    const keyFile = macSigning.prepareMacosSigning({
      CSC_LINK: 'certificate',
      CSC_KEY_PASSWORD: 'password',
      APPLE_API_KEY_BASE64: encoded,
      APPLE_API_KEY_ID: 'KEY123',
      APPLE_API_ISSUER: 'issuer',
      RUNNER_TEMP: root,
      GITHUB_ENV: githubEnv,
    });
    // POSIX permission bits only. Windows has no mode bits, so chmod(0o600)
    // reports 0o666 there and the assertion is meaningless rather than failing
    // usefully. The signing job itself only ever runs on macOS.
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
    }
    const githubEnvironment = fs.readFileSync(githubEnv, 'utf8');
    assert.match(githubEnvironment, /^APPLE_API_KEY=.*AuthKey_KEY123\.p8/m);
    assert.match(githubEnvironment, /^APPLE_API_KEY_ID=KEY123$/m);
    assert.match(githubEnvironment, /^APPLE_API_ISSUER=issuer$/m);
    assert.throws(
      () => macSigning.prepareMacosSigning({
        CSC_LINK: 'certificate',
        CSC_KEY_PASSWORD: 'password',
        APPLE_API_KEY_BASE64: encoded,
        APPLE_API_KEY_ID: '../escape',
        APPLE_API_ISSUER: 'issuer',
        RUNNER_TEMP: root,
        GITHUB_ENV: githubEnv,
      }),
      /unsupported characters/
    );
  });
});

test('Artifact staging rejects missing, extra and empty publishable files', () => {
  withTemp(root => {
    const source = path.join(root, 'dist');
    fs.mkdirSync(source);
    const expected = artifacts.expectedArtifactNames('darwin', 'x64', '1.2.3');
    for (const name of expected) write(path.join(source, name));
    assert.deepEqual(
      artifacts.assertExactInventory({
        sourceDir: source,
        platform: 'darwin',
        arch: 'x64',
        version: '1.2.3',
      }),
      [...expected].sort()
    );
    write(path.join(source, 'latest-mac.yml'));
    assert.throws(
      () => artifacts.assertExactInventory({
        sourceDir: source,
        platform: 'darwin',
        arch: 'x64',
        version: '1.2.3',
      }),
      /unexpected: latest-mac\.yml/
    );
  });
});

test('Aggregate release inventory requires separate complete matrix directories', () => {
  withTemp(root => {
    for (const target of artifacts.MATRIX_TARGETS) {
      const directory = path.join(root, target.name);
      for (const name of artifacts.expectedArtifactNames(target.platform, target.arch, '1.2.3')) {
        write(path.join(directory, name));
      }
    }
    assert.equal(artifacts.verifyAggregateInventory(root, '1.2.3').length, 10);
    fs.rmSync(path.join(root, 'VispNote-macos-arm64'), { recursive: true });
    assert.throws(() => artifacts.verifyAggregateInventory(root, '1.2.3'), /missing: VispNote-macos-arm64/);
  });
});

test('Final artifact verifier validates archive headers and updater integrity metadata', () => {
  withTemp(root => {
    const zip = path.join(root, 'VispNote.zip');
    write(zip, Buffer.from('PK\x03\x04'));
    assert.doesNotThrow(() => finalVerifier.assertArtifactMagic(zip));

    const deb = path.join(root, 'VispNote.deb');
    write(deb, Buffer.from('!<arch>\n'));
    assert.doesNotThrow(() => finalVerifier.assertArtifactMagic(deb));

    const badExe = path.join(root, 'VispNote.exe');
    write(badExe, Buffer.from('NO'));
    assert.throws(() => finalVerifier.assertArtifactMagic(badExe), /Invalid Windows executable header/);

    const metadata = path.join(root, 'latest.yml');
    const installer = path.join(root, 'VispNote-1.2.3-setup-x64.exe');
    write(installer, Buffer.from('MZ release installer'));
    const hash = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
    write(
      metadata,
      `files:\n  - url: VispNote-1.2.3-setup-x64.exe\n    sha512: ${hash}\n    size: ${fs.statSync(installer).size}\n`
    );
    assert.doesNotThrow(
      () => finalVerifier.assertUpdateMetadata(metadata, 'VispNote-1.2.3-setup-x64.exe')
    );
    write(metadata, 'path: other.exe\n');
    assert.throws(() => finalVerifier.assertUpdateMetadata(metadata, 'expected.exe'), /does not reference/);
  });
});

test('Updater metadata parser does not overwrite file hashes with top-level compatibility fields', () => {
  const parsed = finalVerifier.parseUpdateFiles([
    'files:',
    '  - url: first.AppImage',
    '    sha512: first-hash',
    '    size: 10',
    '  - url: second.deb',
    '    sha512: second-hash',
    '    size: 20',
    'path: first.AppImage',
    'sha512: top-level-hash',
  ].join('\n'));
  assert.deepEqual(parsed, [
    { url: 'first.AppImage', sha512: 'first-hash', size: 10 },
    { url: 'second.deb', sha512: 'second-hash', size: 20 },
  ]);
});

test('Release configuration has one architecture authority and collision-free artifact transfer', () => {
  const builder = fs.readFileSync(path.join(PROJECT_ROOT, 'electron-builder.yml'), 'utf8');
  const workflow = fs.readFileSync(
    path.join(PROJECT_ROOT, '.github', 'workflows', 'release-builds.yml'),
    'utf8'
  );
  assert.doesNotMatch(builder, /^\s+arch:/m);
  assert.match(builder, /publish: null/);
  // Notarization is off while no signing secrets exist; requiring it blocked
  // every release after v0.2.1. Signing itself stays conditional in the
  // workflow, so this flips back to true when credentials are added.
  assert.match(builder, /notarize: false/);
  assert.match(builder, /writeUpdateInfo: false/);
  assert.match(workflow, /scripts\/release-tools\/retry-command\.js/);
  assert.match(workflow, /path: dist\/release-output\/\*/);
  assert.match(workflow, /Download build artifacts without merging/);
  assert.doesNotMatch(workflow, /merge-multiple:\s*true/);
  assert.match(workflow, /APPLE_API_KEY_BASE64/);
  assert.match(workflow, /CSC_LINK: \$\{\{ secrets\[matrix\.csc_link_secret\] \}\}/);
  // Signing engages off the certificate secret alone, so adding credentials
  // restores signed releases without another workflow edit — and a partial
  // credential set still fails closed inside prepare-macos-signing.js.
  assert.match(workflow, /SIGNING_AVAILABLE: \$\{\{ secrets\[matrix\.csc_link_secret\] != '' \}\}/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: \$\{\{ secrets\[matrix\.csc_link_secret\] != '' \}\}/);
  assert.match(workflow, /if: runner\.os == 'macOS' && env\.SIGNING_AVAILABLE == 'true'/);
  assert.match(workflow, /--verify-mac-signing \$\{\{ env\.SIGNING_AVAILABLE \}\}/);
  assert.match(workflow, /VISPNOTE_MEMORY_IMAGE/);
  assert.match(workflow, /VISP_MEMORY_SERVER_AUTH_ENABLED: "false"/);
  assert.match(workflow, /VISP_MEMORY_EMBEDDING_PROVIDER: "noop"/);
});

test('macOS signature verification only relaxes on an explicit false', () => {
  const base = ['--root', '.', '--artifacts', 'out', '--platform', 'darwin', '--arch', 'arm64', '--version', '0.2.3'];

  // Default stays on, so an unflagged invocation still verifies signatures.
  assert.equal(finalVerifier.parseArgs(base).verifyMacSigning, true);
  assert.equal(finalVerifier.parseArgs([...base, '--verify-mac-signing', 'true']).verifyMacSigning, true);
  assert.equal(finalVerifier.parseArgs([...base, '--verify-mac-signing', 'false']).verifyMacSigning, false);

  // An unresolved workflow expression or a typo must fail loudly rather than
  // being read as falsey and silently skipping the check.
  for (const bad of ['', 'FALSE', 'no', '0', '${{ env.SIGNING_AVAILABLE }}']) {
    assert.throws(
      () => finalVerifier.parseArgs([...base, '--verify-mac-signing', bad]),
      /requires "true" or "false"|requires a value/,
      `expected "${bad}" to be rejected`
    );
  }
});
