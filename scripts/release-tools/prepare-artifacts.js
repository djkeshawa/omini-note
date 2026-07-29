#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { normalizeArch, normalizePlatform } = require('../verify-packaged-renderer');

const MATRIX_TARGETS = [
  { name: 'VispNote-macos-x64', platform: 'darwin', arch: 'x64' },
  { name: 'VispNote-macos-arm64', platform: 'darwin', arch: 'arm64' },
  { name: 'VispNote-linux-x64', platform: 'linux', arch: 'x64' },
  { name: 'VispNote-windows-x64', platform: 'win32', arch: 'x64' },
];

function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    throw new Error(`Invalid package version: ${version}`);
  }
  return version;
}

function expectedArtifactNames(platformValue, archValue, versionValue) {
  const platform = normalizePlatform(platformValue);
  const arch = normalizeArch(archValue);
  const version = assertVersion(versionValue);
  if (platform === 'darwin') {
    return [
      `VispNote-${version}-mac-${arch}.dmg`,
      `VispNote-${version}-mac-${arch}.zip`,
    ];
  }
  if (platform === 'linux' && arch === 'x64') {
    return [
      `VispNote-${version}-linux-x86_64.AppImage`,
      `VispNote-${version}-linux-amd64.deb`,
      'latest-linux.yml',
    ];
  }
  if (platform === 'win32' && arch === 'x64') {
    return [
      `VispNote-${version}-setup-x64.exe`,
      `VispNote-${version}-setup-x64.exe.blockmap`,
      'latest.yml',
    ];
  }
  throw new Error(`No release artifact inventory for ${platform}-${arch}`);
}

function publishableNames(sourceDir, platformValue, version) {
  const platform = normalizePlatform(platformValue);
  if (!fs.existsSync(sourceDir)) return [];
  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => {
      if (name.startsWith(`VispNote-${version}-`)) {
        return /\.(?:AppImage|deb|dmg|zip|exe|blockmap)$/i.test(name);
      }
      if (platform === 'darwin') return name === 'latest-mac.yml';
      if (platform === 'linux') return name === 'latest-linux.yml';
      return name === 'latest.yml';
    })
    .sort();
}

function assertExactInventory({ sourceDir, platform, arch, version }) {
  const expected = expectedArtifactNames(platform, arch, version).sort();
  const actual = publishableNames(sourceDir, platform, version);
  const missing = expected.filter(name => !actual.includes(name));
  const unexpected = actual.filter(name => !expected.includes(name));
  if (missing.length || unexpected.length) {
    const details = [];
    if (missing.length) details.push(`missing: ${missing.join(', ')}`);
    if (unexpected.length) details.push(`unexpected: ${unexpected.join(', ')}`);
    throw new Error(`Release artifact inventory mismatch (${details.join('; ')})`);
  }
  for (const name of expected) {
    const file = path.join(sourceDir, name);
    if (!fs.statSync(file).size) throw new Error(`Release artifact is empty: ${name}`);
  }
  return expected;
}

function assertSafeOutput(root, outputDir) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(outputDir);
  const relative = path.relative(resolvedRoot, resolvedOutput);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Release output must be a child of ${resolvedRoot}`);
  }
  return resolvedOutput;
}

function prepareArtifacts({
  root,
  sourceDir,
  outputDir,
  platform,
  arch,
  version,
}) {
  const names = assertExactInventory({ sourceDir, platform, arch, version });
  const safeOutput = assertSafeOutput(root, outputDir);
  fs.rmSync(safeOutput, { recursive: true, force: true });
  fs.mkdirSync(safeOutput, { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(sourceDir, name), path.join(safeOutput, name));
  return names;
}

function verifyAggregateInventory(root, version) {
  const expectedDirectories = new Map(MATRIX_TARGETS.map(target => [target.name, target]));
  const actualDirectories = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const unexpectedDirectories = actualDirectories.filter(name => !expectedDirectories.has(name));
  const missingDirectories = [...expectedDirectories.keys()].filter(name => !actualDirectories.includes(name));
  if (unexpectedDirectories.length || missingDirectories.length) {
    throw new Error(
      `Aggregate artifact directories mismatch `
      + `(missing: ${missingDirectories.join(', ') || '(none)'}; `
      + `unexpected: ${unexpectedDirectories.join(', ') || '(none)'})`
    );
  }

  const seen = new Set();
  const files = [];
  for (const name of actualDirectories) {
    const target = expectedDirectories.get(name);
    const directory = path.join(root, name);
    const expected = expectedArtifactNames(target.platform, target.arch, version).sort();
    const actual = fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${name} has an unexpected artifact inventory`);
    }
    for (const basename of actual) {
      if (seen.has(basename)) throw new Error(`Duplicate artifact basename: ${basename}`);
      seen.add(basename);
      const file = path.join(directory, basename);
      if (!fs.statSync(file).size) throw new Error(`Release artifact is empty: ${name}/${basename}`);
      files.push(file);
    }
  }
  return files;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`${flag || 'option'} requires a value`);
    if (flag === '--root') options.root = path.resolve(value);
    else if (flag === '--source') options.sourceDir = path.resolve(value);
    else if (flag === '--output') options.outputDir = path.resolve(value);
    else if (flag === '--platform') options.platform = value;
    else if (flag === '--arch') options.arch = value;
    else if (flag === '--version') options.version = value;
    else if (flag === '--verify-aggregate') options.aggregateRoot = path.resolve(value);
    else throw new Error(`Unknown artifact option: ${flag}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.aggregateRoot) {
    const files = verifyAggregateInventory(options.aggregateRoot, options.version);
    console.log(`Verified aggregate release inventory: ${files.length} files`);
    return;
  }
  const names = prepareArtifacts(options);
  console.log(`Prepared release artifacts: ${names.join(', ')}`);
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
  MATRIX_TARGETS,
  assertExactInventory,
  expectedArtifactNames,
  prepareArtifacts,
  publishableNames,
  verifyAggregateInventory,
};
