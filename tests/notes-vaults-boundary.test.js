const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('notes/vault renderer modules do not use direct privileged APIs', () => {
  const files = [
    'src/app/app.jsx',
    'src/app/notesVaultsService.js',
    'src/app/vaultsService.js',
    'src/app/notesVaultsState.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /require\(['"](?:fs|path|electron)['"]\)/, file);
    assert.doesNotMatch(source, /\bipcRenderer\b/, file);
  }
});

test('core notes/vault app callsites use renderer services', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/app.jsx'), 'utf8');
  assert.doesNotMatch(source, /window\.mn\.(?:listVaults|createVault|renameVault|deleteVault|setActiveVault|loadVault|saveNote|deleteNote)\(/);
  assert.match(source, /MN_NOTES_VAULTS_SERVICE\.saveNote/);
  assert.match(source, /MN_VAULTS_SERVICE\.selectVault/);
});
