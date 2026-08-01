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
    // 12, not 10: each macOS arch also ships the zip's sibling block map.
    assert.equal(artifacts.verifyAggregateInventory(root, '1.2.3').length, 12);
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
    // NSIS writes the compressed block map to a sibling file, and in that mode
    // electron-builder does not emit blockMapSize at all. The old check compared
    // the two, so it compared undefined to a number and could never pass.
    const blockmapFile = `${installer}.blockmap`;
    write(blockmapFile, Buffer.from('compressed blockmap'));
    assert.doesNotThrow(
      () => finalVerifier.assertUpdateMetadata(metadata, 'VispNote-1.2.3-setup-x64.exe')
    );

    write(blockmapFile, Buffer.alloc(0));
    assert.throws(
      () => finalVerifier.assertUpdateMetadata(metadata, 'VispNote-1.2.3-setup-x64.exe'),
      /Empty updater blockmap/
    );

    // No sibling file means append mode, where blockMapSize must be present.
    fs.rmSync(blockmapFile);
    assert.throws(
      () => finalVerifier.assertUpdateMetadata(metadata, 'VispNote-1.2.3-setup-x64.exe'),
      /Missing updater blockmap/
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
  // CSC_LINK must never be defined from a possibly-missing secret at job level:
  // an empty value is a certificate path electron-builder resolves to the
  // project root and rejects as "not a file". It is exported only when real.
  assert.doesNotMatch(workflow, /^\s+CSC_LINK: \$\{\{ secrets\[matrix\.csc_link_secret\] \}\}$/m);
  assert.match(workflow, /name: Export signing credentials\n\s+if: env\.SIGNING_AVAILABLE == 'true'/);
  assert.match(workflow, /printf 'CSC_LINK=%s\\n'/);
  // Signing engages off the certificate secret alone, so adding credentials
  // restores signed releases without another workflow edit — and a partial
  // credential set still fails closed inside prepare-macos-signing.js.
  assert.match(workflow, /SIGNING_AVAILABLE: \$\{\{ secrets\[matrix\.csc_link_secret\] != '' \}\}/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: \$\{\{ secrets\[matrix\.csc_link_secret\] != '' \}\}/);
  assert.match(workflow, /if: runner\.os == 'macOS' && env\.SIGNING_AVAILABLE == 'true'/);
  assert.match(workflow, /--verify-mac-signing \$\{\{ env\.SIGNING_AVAILABLE \}\}/);
  // Linux is the comprehensive gate; macOS and Windows run the same Electron
  // smoke test ci.yml runs on every PR. Running the full suite on those two
  // only at release time made platform-specific test defects invisible until
  // someone tried to ship, and blocked releases for three months.
  assert.match(workflow, /if: runner\.os == 'Linux'\n        run: xvfb-run -a npm run test:all/);
  assert.match(workflow, /if: runner\.os != 'Linux'\n        run: npm run smoke:electron/);
  assert.doesNotMatch(workflow, /if: runner\.os != 'Linux'\n        run: npm run test:all/);
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

test('the release retry helper can actually start npm on Windows', () => {
  // Node refuses to spawn a .cmd without a shell since the CVE-2024-27980 fix,
  // so npm.cmd fails with EINVAL and the Windows release build never starts.
  // The retry wrapper is the only thing that launches electron-builder, so this
  // took the whole Windows installer down while every PR stayed green.
  const source = fs.readFileSync(
    path.join(PROJECT_ROOT, 'scripts', 'release-tools', 'retry-command.js'),
    'utf8'
  );
  assert.match(source, /shell: isWindows/, 'npm.cmd needs a shell on Windows');
  assert.match(source, /npm\.cmd/);

  // And defaultRun still launches a real process on whatever platform this is,
  // which is the part a source assertion alone cannot prove.
  const ok = retry.defaultRun(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(ok.status, 0, ok.error ? String(ok.error) : '');

  const failed = retry.defaultRun(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(failed.status, 3, 'a real exit code must survive the wrapper');
});

const renderer = require('../scripts/verify-packaged-renderer');

test('packaged renderer discovery finds the macOS capital-R Resources directory', () => {
  // electron-builder writes VispNote.app/Contents/Resources/app.asar. Matching
  // '/resources/' literally found nothing on macOS, so the verifier reported a
  // missing bundle for an app it had just built correctly, and no release could
  // pass the build stage.
  withTemp(root => {
    const mac = path.join(root, 'VispNote.app', 'Contents', 'Resources');
    write(path.join(mac, 'app.asar'), 'archive');
    const found = renderer.discoverResourceRoots(root, 'darwin');
    assert.equal(found.length, 1, 'capital-R Resources must be discovered');
    assert.equal(found[0].resources, mac);
  });

  // Linux and Windows keep their lowercase layout.
  withTemp(root => {
    const linux = path.join(root, 'linux-unpacked', 'resources');
    write(path.join(linux, 'app.asar'), 'archive');
    assert.equal(renderer.discoverResourceRoots(root, 'linux').length, 1);
  });
});

test('reading a file out of app.asar uses separators this platform understands', () => {
  // @electron/asar splits an archive path on path.sep, so a forward-slash entry
  // resolves to nothing on Windows however correct the archive is. Assert the
  // separator the lookup is given rather than the archive format.
  withTemp(root => {
    const resources = path.join(root, 'resources');
    let requested = null;
    const original = require.cache[require.resolve('@electron/asar')];
    write(path.join(resources, 'app.asar'), 'archive');

    // The unpacked branch is the reference: it already joins natively.
    write(path.join(resources, 'app', 'build', 'renderer', 'app.js'), 'bundle');
    assert.equal(
      renderer.readPackagedFile(resources, 'build/renderer/app.js').toString(),
      'bundle',
      'the unpacked path must resolve on every platform'
    );

    // With no unpacked copy the asar branch runs, and must be handed a native path.
    fs.rmSync(path.join(resources, 'app'), { recursive: true, force: true });
    require.cache[require.resolve('@electron/asar')] = {
      exports: { extractFile: (_archive, entry) => { requested = entry; return Buffer.from('bundle'); } },
    };
    try {
      renderer.readPackagedFile(resources, 'build/renderer/app.js');
    } finally {
      if (original) require.cache[require.resolve('@electron/asar')] = original;
      else delete require.cache[require.resolve('@electron/asar')];
    }
    assert.equal(requested, ['build', 'renderer', 'app.js'].join(path.sep));
  });
});

test('a .deb needs no block map, because Debian packages have no differential update', () => {
  // Requiring a block map for every entry in latest-linux.yml rejected a
  // correct Linux build: deb produces neither a sibling file nor a
  // blockMapSize, unlike AppImage and NSIS.
  withTemp(root => {
    const deb = path.join(root, 'VispNote-1.2.3-linux-amd64.deb');
    write(deb, Buffer.from('!<arch>\n debian package'));
    const contents = fs.readFileSync(deb);
    const hash = crypto.createHash('sha512').update(contents).digest('base64');
    const metadata = path.join(root, 'latest-linux.yml');
    write(
      metadata,
      `files:\n  - url: VispNote-1.2.3-linux-amd64.deb\n    sha512: ${hash}\n    size: ${contents.length}\n`
    );
    assert.doesNotThrow(
      () => finalVerifier.assertUpdateMetadata(metadata, 'VispNote-1.2.3-linux-amd64.deb', root)
    );

    // An AppImage in the same position still has to carry one.
    const appImage = path.join(root, 'VispNote-1.2.3-linux-x86_64.AppImage');
    write(appImage, Buffer.from('\x7fELF app image'));
    const appContents = fs.readFileSync(appImage);
    const appHash = crypto.createHash('sha512').update(appContents).digest('base64');
    write(
      metadata,
      `files:\n  - url: VispNote-1.2.3-linux-x86_64.AppImage\n    sha512: ${appHash}\n    size: ${appContents.length}\n`
    );
    assert.throws(
      () => finalVerifier.assertUpdateMetadata(metadata, 'VispNote-1.2.3-linux-x86_64.AppImage', root),
      /Missing updater blockmap/
    );
  });
});
