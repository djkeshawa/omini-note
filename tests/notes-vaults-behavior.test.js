const test = require('node:test');
const assert = require('node:assert/strict');

const { createNotesVaultHandlers } = require('../lib/ipc/notesVaultHandlers');
const { withIsolatedStore } = require('./helpers/common.js');

function makeHandlers(store) {
  return createNotesVaultHandlers({
    store,
    idx: {
      indexNote() {},
      removeNote() {},
      removeVault() {},
      rescanVault() {},
    },
    ai: { scheduleEmbed() {} },
    async withIndexVaultLock(_vaultId, fn) { return await fn(); },
    runOptionalSearchIndexTask(_label, fn) {
      fn();
      return true;
    },
  });
}

test('notes/vault handlers preserve list, save, delete, and select behavior', async () => {
  await withIsolatedStore(async (store) => {
    const handlers = makeHandlers(store);
    const listResult = await handlers.listVaults();
    assert.equal(listResult.ok, true);
    const firstVault = listResult.data.vaults[0];

    const saved = await handlers.saveNote({
      vaultId: firstVault.id,
      note: { id: 'n_contract', title: 'Contract note', body: 'contract body', tags: [] },
    });
    assert.equal(saved.ok, true);
    assert.match(saved.data.note.diskRevision, /^[a-f0-9]{64}$/);

    const notes = await handlers.listNotes({ vaultId: firstVault.id });
    assert.equal(notes.ok, true);
    assert.equal(notes.data.notes.some(note => note.id === 'n_contract'), true);

    const opened = await handlers.openNote({ vaultId: firstVault.id, noteId: 'n_contract' });
    assert.equal(opened.data.note.raw, 'contract body');
    assert.equal(opened.data.note.diskRevision, saved.data.note.diskRevision);

    const selected = await handlers.selectVault({ vaultId: firstVault.id });
    assert.equal(selected.data.activeVaultId, firstVault.id);

    const deleted = await handlers.deleteNote({
      vaultId: firstVault.id,
      noteId: 'n_contract',
      noteSnapshot: saved.data.note,
      options: { expectedRevision: saved.data.note.diskRevision },
    });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.data.removed, true);
  });
});

test('notes/vault handlers normalize invalid payload failures', async () => {
  await withIsolatedStore(async (store) => {
    const handlers = makeHandlers(store);
    await assert.rejects(() => handlers.selectVault({ vaultId: '../bad' }), /Invalid vault id/);
  });
});
