const test = require('node:test');
const assert = require('node:assert/strict');

const { NOTES_VAULTS_CHANNELS, channelList } = require('../lib/ipc/contracts');
const {
  validateNoteSaveRequest,
  validateNoteDeleteRequest,
  validateNoteListRequest,
  validateNoteOpenRequest,
  validateVaultCreateRequest,
  validateVaultIdRequest,
  validateVaultRenameRequest,
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
    options: { expectedRevision: null },
  });
  assert.equal(clean.vaultId, 'v1');
  assert.equal(clean.note.id, 'n1');
  assert.equal(clean.note.body, 'hello');
  assert.equal(clean.options.expectedRevision, null);
});

test('notes/vault IPC responses are normalized', () => {
  assert.equal(validateContractResponse({ ok: true, data: {} }).ok, true);
  assert.equal(normalizeIpcError(new Error('/tmp/private/path failed'), { channel: NOTES_VAULTS_CHANNELS.noteSave }).ok, false);
  assert.doesNotMatch(normalizeIpcError(new Error('/tmp/private/path failed')).error.message, /tmp\/private/);
});

test('note conflicts retain only safe revision details over IPC', () => {
  const conflict = Object.assign(new Error('Note changed on disk'), {
    code: 'NOTE_CONFLICT',
    currentRevision: 'a'.repeat(64),
    expectedRevision: 'b'.repeat(64),
    currentModifiedAt: '2026-07-29T10:00:00.000Z',
    privatePath: '/tmp/private-note.md',
  });
  const response = normalizeIpcError(conflict, {
    channel: NOTES_VAULTS_CHANNELS.noteSave,
    privatePath: '/tmp/private-note.md',
  });
  assert.equal(response.error.code, 'NOTE_CONFLICT');
  assert.equal(response.error.details.currentRevision, 'a'.repeat(64));
  assert.equal(response.error.details.expectedRevision, 'b'.repeat(64));
  assert.equal(Object.prototype.hasOwnProperty.call(response.error.details, 'privatePath'), false);
});

// These validators guard the note delete, open, list and vault rename
// channels. Until now nothing exercised them — the same gap that let the
// Smart View format skew ship — so hostile ids and oversized bodies are
// pinned here alongside the happy paths.
test('remaining note and vault validators reject hostile input and pass clean input', () => {
  assert.deepEqual(validateNoteListRequest(), { vaultId: null });
  assert.deepEqual(validateNoteListRequest({ vaultId: 'v1' }), { vaultId: 'v1' });
  assert.throws(() => validateNoteListRequest({ vaultId: '../up' }), /Invalid vault id/);

  assert.deepEqual(validateNoteOpenRequest({ vaultId: 'v1', noteId: 'n1' }), { vaultId: 'v1', noteId: 'n1' });
  assert.throws(() => validateNoteOpenRequest({ vaultId: 'v1', noteId: '../../etc/passwd' }), /Invalid note id/);
  assert.throws(() => validateNoteOpenRequest({ vaultId: 'v1' }), /note id/);

  const del = validateNoteDeleteRequest({ vaultId: 'v1', noteId: 'n1', noteSnapshot: { title: 'x' }, permanent: 'yes' });
  assert.equal(del.permanent, false, 'permanent must be literal true, not truthy');
  assert.deepEqual(del.noteSnapshot, { title: 'x' });
  assert.equal(validateNoteDeleteRequest({ vaultId: 'v1', noteId: 'n1', noteSnapshot: 'text' }).noteSnapshot, null);
  assert.throws(
    () => validateNoteDeleteRequest({
      vaultId: 'v1',
      noteId: 'n1',
      noteSnapshot: { body: 'x'.repeat((2 * 1024 * 1024) + 1) },
    }),
    /Note content is too large/
  );
  assert.equal(validateNoteDeleteRequest({
    vaultId: 'v1',
    noteId: 'n1',
    noteSnapshot: { diskRevision: 'a'.repeat(64) },
  }).options.expectedRevision, 'a'.repeat(64));
  assert.throws(() => validateNoteDeleteRequest({ vaultId: 'v1', noteId: 'a/b' }), /Invalid note id/);
  assert.throws(
    () => validateNoteSaveRequest({ vaultId: 'v1', note: { id: 'n1' }, options: { expectedRevision: 'bad' } }),
    /Invalid expected revision/
  );

  assert.deepEqual(validateVaultRenameRequest({ vaultId: 'v1', name: '  Work  ' }), { vaultId: 'v1', name: 'Work' });
  assert.throws(() => validateVaultRenameRequest({ vaultId: 'v1', name: '' }), /vault name/);

  // The 2MB content cap and NUL stripping on the save path.
  const nul = validateNoteSaveRequest({ vaultId: 'v1', note: { id: 'n1', body: 'a\u0000b' } });
  assert.equal(nul.note.body.includes('\u0000'), false, 'NUL bytes are stripped');
  assert.throws(
    () => validateNoteSaveRequest({ vaultId: 'v1', note: { id: 'n1', body: 'x'.repeat(2 * 1024 * 1024 + 1) } }),
    /too large/
  );
});
