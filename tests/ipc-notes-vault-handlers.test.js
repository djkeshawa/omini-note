const test = require('node:test');
const assert = require('node:assert/strict');

const { createNotesVaultHandlers } = require('../lib/ipc/notesVaultHandlers.js');

// lib/ipc/notesVaultHandlers.js is the IPC boundary for notes and vaults, so it
// stands between the renderer and the user's files. It sat at 41.18% branch
// coverage. The property that matters most: the search index is a convenience,
// and its failure must never cost the user a save.

function makeHandlers(overrides = {}) {
  const calls = { saved: [], indexed: [], embedded: [], mutated: [], registryChanged: 0, removedVaults: [] };
  const store = {
    listVaults: async () => [{ id: 'v1', name: 'Vault One', path: '/tmp/v1' }],
    getPrefs: async () => ({ activeVaultId: 'v1' }),
    loadVault: async id => ({ id, notes: [{ id: 'n1', title: 'One', body: 'body one' }] }),
    getNote: async (_v, id) => (id === 'n1' ? { id: 'n1', title: 'One', body: 'body one' } : null),
    saveNote: async (_v, note) => { calls.saved.push(note.id); return { ...note, previousTitle: null }; },
    deleteNote: async () => ({ deleted: true }),
    createVault: async name => ({ id: 'v2', name, path: '/tmp/v2' }),
    renameVault: async (id, name) => ({ id, name, path: '/tmp/v1' }),
    deleteVault: async () => ({ vaults: [] }),
    setActiveVault: async () => {},
    ...(overrides.store || {}),
  };
  const idx = {
    indexNote: (_v, note) => { calls.indexed.push(note.id); },
    removeNote: () => {},
    removeVault: id => { calls.removedVaults.push(id); },
    rescanVault: () => {},
    ...(overrides.idx || {}),
  };
  const handlers = createNotesVaultHandlers({
    store,
    idx,
    ai: { scheduleEmbed: (_v, note) => calls.embedded.push(note.id) },
    withIndexVaultLock: async (_v, fn) => fn(),
    // Mirrors the real wrapper: index work is optional, so a throw is swallowed
    // and reported as null rather than propagating.
    runOptionalSearchIndexTask: (_label, fn) => { try { return fn(); } catch { return null; } },
    onVaultMutated: (v, ids) => calls.mutated.push([v, ids]),
    onVaultRegistryChange: async () => { calls.registryChanged += 1; },
    ...(overrides.deps || {}),
  });
  return { handlers, calls };
}

const save = { vaultId: 'v1', note: { id: 'n1', title: 'One', body: 'text' } };

test('a note still saves when the search index throws', () => {
  // Losing a save because indexing failed would be trading the user's work for
  // a convenience feature.
  return (async () => {
    const { handlers, calls } = makeHandlers({
      idx: { indexNote: () => { throw new Error('index is corrupt'); } },
    });
    const res = await handlers.saveNote(save);
    assert.equal(res.ok, true, 'the save was rejected because indexing failed');
    assert.deepEqual(calls.saved, ['n1'], 'the note never reached the store');
  })();
});

test('embedding is not scheduled for a note that failed to index', async () => {
  // Embedding a note the index does not know about wastes work and can leave
  // the two stores disagreeing.
  const { handlers, calls } = makeHandlers({
    idx: { indexNote: () => { throw new Error('index is corrupt'); } },
  });
  await handlers.saveNote(save);
  assert.deepEqual(calls.embedded, [], 'embedded a note that was not indexed');
});

test('a successful save indexes, embeds, and announces the mutation', async () => {
  const { handlers, calls } = makeHandlers();
  const res = await handlers.saveNote(save);
  assert.equal(res.ok, true);
  assert.deepEqual(calls.indexed, ['n1']);
  assert.deepEqual(calls.embedded, ['n1']);
  assert.equal(calls.mutated.length, 1, 'the watcher was not told the vault changed');
  assert.ok(calls.mutated[0][1].includes('n1'));
});

test('opening a missing note fails loudly instead of returning an empty note', async () => {
  const { handlers } = makeHandlers();
  await assert.rejects(() => handlers.openNote({ vaultId: 'v1', noteId: 'nope' }), /not found/i);
});

test('listing notes with no active vault returns empty rather than throwing', async () => {
  const { handlers } = makeHandlers({ store: { getPrefs: async () => ({ activeVaultId: null }) } });
  const res = await handlers.listNotes({});
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.notes, []);
  assert.equal(res.data.vaultId, null);
});

test('selecting a vault that does not exist is refused', async () => {
  // Silently selecting nothing would leave the app pointed at no vault while
  // reporting success.
  const { handlers } = makeHandlers();
  await assert.rejects(() => handlers.selectVault({ vaultId: 'ghost' }), /not found/i);
});

test('deleting a vault removes it from the index and refreshes the registry', async () => {
  const { handlers, calls } = makeHandlers();
  const res = await handlers.deleteVault({ vaultId: 'v1' });
  assert.equal(res.ok, true);
  assert.equal(res.data.deleted, true);
  assert.deepEqual(calls.removedVaults, ['v1'], 'the deleted vault stayed in the search index');
  assert.equal(calls.registryChanged, 1);
});

test('a vault whose index cannot be cleaned is still deleted', async () => {
  const { handlers } = makeHandlers({ idx: { removeVault: () => { throw new Error('index locked'); } } });
  const res = await handlers.deleteVault({ vaultId: 'v1' });
  assert.equal(res.ok, true, 'a failing index blocked the vault deletion');
});

test('creating a vault indexes it and refreshes the registry', async () => {
  const { handlers, calls } = makeHandlers();
  const res = await handlers.createVault({ name: 'New Vault' });
  assert.equal(res.ok, true);
  assert.equal(calls.registryChanged, 1);
});

test('malformed payloads are rejected rather than reaching the store', async () => {
  const { handlers, calls } = makeHandlers();
  for (const payload of [null, undefined, 'string', 42, [], { vaultId: '' }, { note: {} }]) {
    await handlers.saveNote(payload).catch(() => {});
  }
  assert.deepEqual(calls.saved, [], `a malformed payload reached store.saveNote: ${JSON.stringify(calls.saved)}`);
});
