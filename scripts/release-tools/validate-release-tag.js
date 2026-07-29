#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readPackageVersion(root = path.join(__dirname, '..', '..')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`package.json has an invalid release version: ${pkg.version}`);
  }
  return pkg.version;
}

function validateReleaseTag(tag, version) {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(`Release tag must exactly match package.json: expected ${expected}, received ${tag || '(empty)'}`);
  }
  return tag;
}

function validatePinnedImage(image) {
  const value = String(image || '').trim();
  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error('VISPNOTE_MEMORY_IMAGE must use an immutable @sha256 digest');
  }
  return value;
}

function main(argv = process.argv.slice(2)) {
  const tag = String(argv[0] || '').trim();
  const version = readPackageVersion();
  if (argv.length > 1) validatePinnedImage(argv[1]);
  console.log(validateReleaseTag(tag, version));
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
  main,
  readPackageVersion,
  validatePinnedImage,
  validateReleaseTag,
};
