const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('preload exposes namespaced notes/vault contract APIs', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  assert.match(preload, /NOTES_VAULTS_CHANNELS/);
  assert.match(preload, /notesVaults: \{/);
  assert.match(preload, /listNotes: \(payload = \{\}\) => ipcRenderer\.invoke\(NOTES_VAULTS_CHANNELS\.noteList, payload\)/);
  assert.match(preload, /selectVault: \(payload = \{\}\) => ipcRenderer\.invoke\(NOTES_VAULTS_CHANNELS\.vaultSelect, payload\)/);
});
