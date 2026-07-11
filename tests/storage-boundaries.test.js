const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function lines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
}

function storageFiles() {
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith('.js')) files.push(target);
    }
  };
  visit(path.join(root, 'lib', 'storage'));
  return files;
}

test('storage facade and repositories respect phase-three boundaries', () => {
  const facade = path.join(root, 'lib', 'store.js');
  assert.ok(lines(facade) <= 800, `store facade is ${lines(facade)} lines`);
  for (const file of storageFiles()) {
    assert.ok(lines(file) <= 500, `${path.relative(root, file)} is ${lines(file)} lines`);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
  }
});

test('store remains a compatibility facade for existing callers', () => {
  const store = require('../lib/store');
  for (const method of [
    'loadConfig', 'listVaults', 'loadVault', 'saveNote', 'deleteNote',
    'listNoteVersions', 'saveCanvas', 'exportBackup', 'getPrefs',
  ]) assert.equal(typeof store[method], 'function', method);
});

test('filesystem primitives expose config quarantine behavior', () => {
  const { createFilesystem } = require('../lib/storage/filesystem');
  const primitives = createFilesystem({
    fs,
    path,
    maxJsonReadBytes: 1024,
    maxJsonWriteBytes: 1024,
  });
  assert.equal(typeof primitives.quarantineBrokenJson, 'function');
});
