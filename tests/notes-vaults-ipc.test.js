const test = require('node:test');
const assert = require('node:assert/strict');

const { NOTES_VAULTS_CHANNELS, channelList } = require('../lib/ipc/contracts');
const {
  validateNoteSaveRequest,
  validateVaultCreateRequest,
  validateVaultIdRequest,
  validateContractResponse,
} = require('../lib/ipc/validation');
const { normalizeIpcError } = require('../lib/ipc/errors');

test('notes/vault IPC contracts expose versioned channels', () => {
  assert.equal(NOTES_VAULTS_CHANNELS.noteSave, 'vispnote:v1:note:save');
  assert.equal(NOTES_VAULTS_CHANNELS.vaultSelect, 'vispnote:v1:vault:select');
  assert.equal(new Set(channelList()).size, channelList().length);
});

test('notes/vault IPC validation rejects unsafe payloads', () => {
  assert.throws(() => validateVaultIdRequest({ vaultId: '../bad' }), /Invalid vault id/);
  assert.throws(() => validateVaultCreateRequest({ name: '../bad' }), /path separators/);
  assert.throws(() => validateNoteSaveRequest({ vaultId: 'v1', note: { id: '../bad' } }), /Invalid note id/);
});

test('notes/vault IPC validation accepts note save payloads', () => {
  const clean = validateNoteSaveRequest({
    vaultId: 'v1',
    noteId: 'n1',
    content: 'hello',
    options: { expectedModifiedAt: null },
  });
  assert.equal(clean.vaultId, 'v1');
  assert.equal(clean.note.id, 'n1');
  assert.equal(clean.note.body, 'hello');
});

test('notes/vault IPC responses are normalized', () => {
  assert.equal(validateContractResponse({ ok: true, data: {} }).ok, true);
  assert.equal(normalizeIpcError(new Error('/tmp/private/path failed'), { channel: NOTES_VAULTS_CHANNELS.noteSave }).ok, false);
  assert.doesNotMatch(normalizeIpcError(new Error('/tmp/private/path failed')).error.message, /tmp\/private/);
});
