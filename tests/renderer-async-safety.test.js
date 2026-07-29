const test = require('node:test');
const assert = require('node:assert/strict');
const { deferred, flushMicrotasks } = require('./helpers/common.js');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const { createLatestWriteQueue } = require('../src/shared/latestWriteQueue.js');
const canvasActions = require('../src/app/appCanvasActions.js');
const notesVaultsService = require('../src/app/notesVaultsService.js');
const notesVaultsState = require('../src/app/notesVaultsState.js');
const aiOwnership = loadRendererModule('src/ai/aiOwnership.js');
const aiSessions = loadRendererModule('src/features/ai/useAiSessionsController.js');

test('latest write queue serializes per key and coalesces pending writes', async () => {
  const queue = createLatestWriteQueue();
  const first = deferred();
  const writes = [];
  const write = async value => {
    writes.push(value);
    if (value === 'first') await first.promise;
    return value.toUpperCase();
  };

  const firstResult = queue.enqueue('vault:canvas', 'first', write);
  const secondResult = queue.enqueue('vault:canvas', 'second', write);
  const thirdResult = queue.enqueue('vault:canvas', 'third', write);
  assert.deepEqual(writes, ['first']);

  first.resolve();
  await flushMicrotasks(3);
  assert.deepEqual(writes, ['first', 'third']);
  assert.deepEqual(await firstResult, { value: 'FIRST', revision: 1, latest: false });
  assert.equal((await secondResult).value, 'THIRD');
  assert.equal((await thirdResult).value, 'THIRD');
  await queue.flush('vault:canvas');
  assert.equal(queue.pending('vault:canvas'), false);
});

test('latest write queue continues after a failed write', async () => {
  const queue = createLatestWriteQueue();
  const first = deferred();
  const failed = queue.enqueue('note', 'bad', async () => {
    await first.promise;
    throw new Error('disk unavailable');
  });
  const recovered = queue.enqueue('note', 'good', async value => value);
  first.resolve();
  await assert.rejects(failed, /disk unavailable/);
  assert.equal((await recovered).value, 'good');
  await queue.flush('note');
});

test('AI session updates remain bound to the originating session', () => {
  const sessions = [
    { id: 'chat-a', messages: [], title: 'A' },
    { id: 'chat-b', messages: [], title: 'B' },
  ];
  const updated = aiSessions.updateAiSessionById(
    sessions,
    'chat-a',
    session => ({ messages: [...session.messages, { text: 'token' }] }),
    session => session.title,
    () => '2026-07-29T00:00:00.000Z'
  );
  assert.deepEqual(updated[0].messages, [{ text: 'token' }]);
  assert.deepEqual(updated[1].messages, []);
  assert.equal(updated[0].updatedAt, '2026-07-29T00:00:00.000Z');
});

test('AI note edit owner rejects note, vault, disk, and body changes', () => {
  const note = { id: 'note-a', diskRevision: 'rev-a' };
  const owner = aiOwnership.mnAiNoteEditOwner({
    vaultId: 'vault-a',
    noteId: note.id,
    body: '# Original',
    diskRevision: note.diskRevision,
  });
  assert.deepEqual(
    aiOwnership.mnAiValidateNoteEditOwner(owner, { vaultId: 'vault-a', note, body: '# Original' }),
    { ok: true }
  );
  assert.equal(aiOwnership.mnAiValidateNoteEditOwner(owner, {
    vaultId: 'vault-a',
    note,
    body: '# Changed',
  }).ok, false);
  assert.equal(aiOwnership.mnAiValidateNoteEditOwner(owner, {
    vaultId: 'vault-b',
    note,
    body: '# Original',
  }).ok, false);
  assert.equal(aiOwnership.mnAiValidateNoteEditOwner(owner, {
    vaultId: 'vault-a',
    note: { ...note, diskRevision: 'rev-b' },
    body: '# Original',
  }).ok, false);
});

test('optimistic note rollback restores only the deleted note at its prior index', () => {
  const removed = { id: 'note-b', title: 'B' };
  const current = [
    { id: 'note-new', title: 'Concurrent create' },
    { id: 'note-a', title: 'Concurrent edit' },
    { id: 'note-c', title: 'C' },
  ];
  const restored = notesVaultsState.restoreNoteAtIndex(current, removed, 1);
  assert.deepEqual(restored.map(note => note.id), ['note-new', 'note-b', 'note-a', 'note-c']);
  assert.equal(restored[2].title, 'Concurrent edit');
  assert.strictEqual(notesVaultsState.restoreNoteAtIndex(restored, removed, 1), restored);
});

test('slow canvas open cannot commit after its owner becomes stale', async () => {
  const response = deferred();
  const committed = [];
  let current = true;
  const opening = canvasActions.openCanvas('canvas-a', {
    hasDisk: true,
    activeVaultId: 'vault-a',
    mn: { canvas: { getCanvas: () => response.promise } },
    isOperationCurrent: () => current,
    setActiveCanvas: canvas => committed.push(canvas),
    setSelectedTag() {},
    setSelectedWorkflow() {},
    setQuery() {},
    navigateView() {},
  });
  current = false;
  response.resolve({ ok: true, value: { id: 'canvas-a' } });
  assert.equal(await opening, null);
  assert.deepEqual(committed, []);
});

test('canvas saves forward CAS revision and ignore stale UI commits', async () => {
  const calls = [];
  const committed = [];
  const saved = await canvasActions.saveCanvas({ id: 'canvas-a', title: 'A', diskRevision: 'old' }, {
    hasDisk: true,
    activeVaultId: 'vault-a',
    expectedRevision: 'current',
    mn: {
      canvas: {
        saveCanvas: async (...args) => {
          calls.push(args);
          return { ok: true, value: { id: 'canvas-a', title: 'A', diskRevision: 'new' } };
        },
      },
    },
    shouldCommitResult: () => false,
    setActiveCanvas: value => committed.push(value),
    setCanvases: value => committed.push(value),
    setVaults: value => committed.push(value),
  });
  assert.equal(saved.diskRevision, 'new');
  assert.deepEqual(calls[0][2], { expectedRevision: 'current' });
  assert.deepEqual(committed, []);
});

test('notes service preserves structured conflict details and forwards delete revision', async () => {
  const conflict = await notesVaultsService.saveNote({
    notes: {
      saveNote: async () => ({
        ok: false,
        error: {
          code: 'NOTE_CONFLICT',
          message: 'changed',
          details: { currentRevision: 'a'.repeat(64), expectedRevision: 'b'.repeat(64) },
        },
      }),
    },
  }, 'vault-a', { id: 'note-a' }, { expectedRevision: 'b'.repeat(64) });
  assert.equal(conflict.code, 'NOTE_CONFLICT');
  assert.equal(conflict.currentRevision, 'a'.repeat(64));

  let deleteArgs;
  await notesVaultsService.deleteNote({
    notes: {
      deleteNote: async (...args) => {
        deleteArgs = args;
        return { ok: true, value: { trashId: 'trash-a' } };
      },
    },
  }, 'vault-a', 'note-a', { id: 'note-a', diskRevision: 'c'.repeat(64) });
  assert.equal(deleteArgs[3].expectedRevision, 'c'.repeat(64));
});
