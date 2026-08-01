#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  assertDevBundle,
  discoverResourceRoots,
  normalizeArch,
  normalizePlatform,
  verifyResourceRoots,
} = require('../verify-packaged-renderer');
const { expectedArtifactNames } = require('./prepare-artifacts');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function assertArtifactMagic(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || !stat.size) throw new Error(`Release artifact is empty: ${path.basename(file)}`);
  const extension = path.extname(file).toLowerCase();
  const head = Buffer.alloc(Math.min(8, stat.size));
  const descriptor = fs.openSync(file, 'r');
  try {
    fs.readSync(descriptor, head, 0, head.length, 0);
    if (extension === '.dmg') {
      if (stat.size < 512) throw new Error(`Invalid DMG trailer: ${path.basename(file)}`);
      const trailer = Buffer.alloc(4);
      fs.readSync(descriptor, trailer, 0, 4, stat.size - 512);
      if (trailer.toString('ascii') !== 'koly') throw new Error(`Invalid DMG trailer: ${path.basename(file)}`);
    } else if (extension === '.zip' && head.subarray(0, 2).toString('ascii') !== 'PK') {
      throw new Error(`Invalid ZIP header: ${path.basename(file)}`);
    } else if (extension === '.appimage' && head.subarray(0, 4).toString('hex') !== '7f454c46') {
      throw new Error(`Invalid AppImage header: ${path.basename(file)}`);
    } else if (extension === '.deb' && head.toString('ascii') !== '!<arch>\n') {
      throw new Error(`Invalid Debian archive header: ${path.basename(file)}`);
    } else if (extension === '.exe' && head.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`Invalid Windows executable header: ${path.basename(file)}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseUpdateFiles(contents) {
  const entries = [];
  let current = null;
  for (const rawLine of contents.split(/\r?\n/)) {
    const url = rawLine.match(/^\s+-\s+url:\s*(\S+)\s*$/);
    if (url) {
      current = { url: url[1] };
      entries.push(current);
    } else if (current && /^\s+sha512:\s*\S+/.test(rawLine)) {
      current.sha512 = rawLine.trim().replace(/^sha512:\s*/, '');
    } else if (current && /^\s+size:\s*\d+/.test(rawLine)) {
      current.size = Number(rawLine.trim().replace(/^size:\s*/, ''));
    } else if (current && /^\s+blockMapSize:\s*\d+/.test(rawLine)) {
      current.blockMapSize = Number(rawLine.trim().replace(/^blockMapSize:\s*/, ''));
    } else if (/^\S/.test(rawLine) && !/^files:/.test(rawLine)) {
      current = null;
    }
  }
  return entries;
}

function assertUpdateMetadata(file, expectedInstallers, artifactDir = path.dirname(file)) {
  const contents = fs.readFileSync(file, 'utf8');
  const expected = Array.isArray(expectedInstallers) ? expectedInstallers : [expectedInstallers];
  const entries = parseUpdateFiles(contents);
  for (const installer of expected) {
    const entry = entries.find(item => item.url === installer);
    if (!entry) throw new Error(`${path.basename(file)} does not reference ${installer}`);
    if (!entry.sha512 || !Number.isSafeInteger(entry.size)) {
      throw new Error(`${path.basename(file)} is missing update integrity metadata for ${installer}`);
    }
    const artifact = path.join(artifactDir, installer);
    if (!fs.existsSync(artifact)) throw new Error(`Updater metadata references a missing artifact: ${installer}`);
    const contentsBuffer = fs.readFileSync(artifact);
    const hash = crypto.createHash('sha512').update(contentsBuffer).digest('base64');
    if (entry.sha512 !== hash || entry.size !== contentsBuffer.length) {
      throw new Error(`Updater metadata integrity mismatch for ${installer}`);
    }
    // electron-builder writes the compressed block map either to a sibling
    // .blockmap file or appended to the installer itself, never both:
    // buildBlockMap returns blockMapSize only in append mode, and omits it
    // entirely when given an out file. Comparing blockMapSize against a sibling
    // file's size therefore compared undefined to a number and could not pass
    // for any NSIS build, which is the only kind this repo produces.
    // Only the targets that support differential download carry one. A .deb has
    // neither a sibling file nor a blockMapSize, so requiring one of them for
    // every entry rejects a correct Linux build.
    const blockmap = `${artifact}.blockmap`;
    const supportsDifferentialUpdate = /\.(?:exe|AppImage|zip)$/i.test(installer);
    if (fs.existsSync(blockmap)) {
      if (!fs.statSync(blockmap).size) {
        throw new Error(`Empty updater blockmap for ${installer}`);
      }
    } else if (supportsDifferentialUpdate
      && (!Number.isSafeInteger(entry.blockMapSize) || entry.blockMapSize <= 0)) {
      throw new Error(`Missing updater blockmap for ${installer}`);
    }
  }
}

function verifyExtractedApp({ searchRoot, projectRoot, platform, arch, verifyMacSigning }) {
  const resourceRoots = discoverResourceRoots(searchRoot, platform);
  if (resourceRoots.length !== 1) {
    throw new Error(
      `Expected one packaged app in ${searchRoot}, found ${resourceRoots.length}`
    );
  }
  verifyResourceRoots({
    root: projectRoot,
    devBundle: assertDevBundle(projectRoot),
    resourceRoots,
    expectedArch: arch,
  });

  if (platform === 'darwin' && verifyMacSigning) {
    const app = path.dirname(path.dirname(resourceRoots[0].resources));
    runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    runCommand('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
    runCommand('xcrun', ['stapler', 'validate', app]);
  }
}

function extractZip(file, destination) {
  runCommand('unzip', ['-tqq', file]);
  runCommand('ditto', ['-x', '-k', file, destination]);
}

function withMountedDmg(file, mountPoint, callback) {
  runCommand('hdiutil', ['verify', file]);
  fs.mkdirSync(mountPoint, { recursive: true });
  runCommand('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, file]);
  try {
    callback(mountPoint);
  } finally {
    runCommand('hdiutil', ['detach', mountPoint]);
  }
}

function extractAppImage(file, destination) {
  fs.chmodSync(file, 0o755);
  runCommand(file, ['--appimage-extract'], { cwd: destination });
  return path.join(destination, 'squashfs-root');
}

function extractDeb(file, destination) {
  runCommand('dpkg-deb', ['--info', file]);
  runCommand('dpkg-deb', ['--extract', file, destination]);
}

function extractWindowsInstaller(file, destination) {
  runCommand('7z', ['t', '-y', file]);
  runCommand('7z', ['x', '-y', `-o${destination}`, file]);
  const nestedArchives = [];
  const pending = [destination];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name.toLowerCase().endsWith('.7z')) nestedArchives.push(full);
    }
  }
  for (const archive of nestedArchives) {
    const nestedDestination = `${archive}.extracted`;
    fs.mkdirSync(nestedDestination, { recursive: true });
    runCommand('7z', ['x', '-y', `-o${nestedDestination}`, archive]);
  }
}

function verifyApplicationArtifact({
  file,
  projectRoot,
  platform,
  arch,
  tempRoot,
  verifyMacSigning,
}) {
  const extension = path.extname(file).toLowerCase();
  const destination = path.join(tempRoot, path.basename(file).replace(/[^A-Za-z0-9_.-]+/g, '-'));
  fs.mkdirSync(destination, { recursive: true });

  if (extension === '.dmg') {
    withMountedDmg(file, path.join(destination, 'mount'), mountPoint => {
      verifyExtractedApp({ searchRoot: mountPoint, projectRoot, platform, arch, verifyMacSigning });
    });
  } else if (extension === '.zip') {
    extractZip(file, destination);
    verifyExtractedApp({ searchRoot: destination, projectRoot, platform, arch, verifyMacSigning });
  } else if (extension === '.appimage') {
    const extractedRoot = extractAppImage(file, destination);
    verifyExtractedApp({ searchRoot: extractedRoot, projectRoot, platform, arch, verifyMacSigning: false });
  } else if (extension === '.deb') {
    extractDeb(file, destination);
    verifyExtractedApp({ searchRoot: destination, projectRoot, platform, arch, verifyMacSigning: false });
  } else if (extension === '.exe') {
    extractWindowsInstaller(file, destination);
    verifyExtractedApp({ searchRoot: destination, projectRoot, platform, arch, verifyMacSigning: false });
  }
}

function verifyReleaseArtifacts({
  projectRoot,
  artifactDir,
  platform: platformValue,
  arch: archValue,
  version,
  verifyMacSigning = true,
}) {
  const platform = normalizePlatform(platformValue);
  const arch = normalizeArch(archValue);
  const expected = expectedArtifactNames(platform, arch, version);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-release-verify-'));
  try {
    for (const name of expected) {
      const file = path.join(artifactDir, name);
      if (!fs.existsSync(file)) throw new Error(`Missing release artifact: ${name}`);
      assertArtifactMagic(file);
      if (name === 'latest-linux.yml') {
        assertUpdateMetadata(file, [
          `VispNote-${version}-linux-x86_64.AppImage`,
          `VispNote-${version}-linux-amd64.deb`,
        ], artifactDir);
      } else if (name === 'latest.yml') {
        assertUpdateMetadata(file, `VispNote-${version}-setup-x64.exe`, artifactDir);
      }
      if (/\.(?:dmg|zip|AppImage|deb|exe)$/i.test(name)) {
        verifyApplicationArtifact({
          file,
          projectRoot,
          platform,
          arch,
          tempRoot,
          verifyMacSigning,
        });
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return expected;
}

function parseArgs(argv) {
  const options = { verifyMacSigning: true };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`${flag || 'option'} requires a value`);
    if (flag === '--root') options.projectRoot = path.resolve(value);
    else if (flag === '--artifacts') options.artifactDir = path.resolve(value);
    else if (flag === '--platform') options.platform = value;
    else if (flag === '--arch') options.arch = value;
    else if (flag === '--version') options.version = value;
    else if (flag === '--verify-mac-signing') {
      // Only an explicit "false" relaxes the check, so a typo or an unresolved
      // workflow expression still verifies signatures rather than skipping them.
      if (value !== 'true' && value !== 'false') {
        throw new Error('--verify-mac-signing requires "true" or "false"');
      }
      options.verifyMacSigning = value === 'true';
    } else throw new Error(`Unknown release verifier option: ${flag}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const verified = verifyReleaseArtifacts(options);
  console.log(`Verified final release artifacts: ${verified.join(', ')}`);
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
  assertArtifactMagic,
  assertUpdateMetadata,
  extractWindowsInstaller,
  parseArgs,
  parseUpdateFiles,
  runCommand,
  verifyReleaseArtifacts,
};
