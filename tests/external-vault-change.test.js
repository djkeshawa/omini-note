const test = require('node:test');
const assert = require('node:assert/strict');

const {
  changedFileNames,
  createExternalVaultChangeHandler,
} = require('../main/externalVaultChangeService');

test('external vault batches rescan once and schedule every changed note', async () => {
  const rescans = [];
  const embedded = [];
  const notified = [];
  let loads = 0;
  let locks = 0;
  const order = [];
  const notes = [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
    { id: 'untouched', title: 'Untouched' },
  ];
  const handler = createExternalVaultChangeHandler({
    store: {
      async loadVault(vaultId) {
        order.push('load');
        loads++;
        assert.equal(vaultId, 'v1');
        return { notes };
      },
    },
    idx: { rescanVault: (vaultId, value) => rescans.push({ vaultId, value }) },
    ai: { scheduleEmbed: (vaultId, note) => embedded.push([vaultId, note.id]) },
    async withIndexVaultLock(vaultId, fn) {
      order.push('lock');
      locks++;
      assert.equal(vaultId, 'v1');
      return await fn();
    },
    runOptionalSearchIndexTask(_label, fn) { return fn(); },
    getIndexReadyPromise: () => Promise.resolve(),
    notifyRenderer: event => notified.push(event),
  });
  const event = {
    vaultId: 'v1',
    fileName: 'one.md',
    fileNames: ['one.md', 'two.md', 'deleted.md'],
    changes: [
      { fileName: 'one.md', eventType: 'change' },
      { fileName: 'two.md', eventType: 'change' },
      { fileName: 'deleted.md', eventType: 'rename' },
    ],
  };

  await handler(event);

  assert.equal(loads, 1);
  assert.equal(locks, 1);
  assert.deepEqual(order.slice(0, 2), ['lock', 'load'], 'the snapshot is loaded after acquiring the index lock');
  assert.deepEqual(rescans, [{ vaultId: 'v1', value: notes }]);
  assert.deepEqual(embedded, [['v1', 'one'], ['v1', 'two']]);
  assert.deepEqual(notified, [event]);
});

test('external vault handler retains compatibility with single-file events', async () => {
  assert.deepEqual(changedFileNames({ fileName: 'note.md' }), ['note.md']);
  assert.deepEqual(changedFileNames({ fileNames: ['a.md', 'a.md', '', 'b.md'] }), ['a.md', 'b.md']);

  const embedded = [];
  const handler = createExternalVaultChangeHandler({
    store: { async loadVault() { return { notes: [{ id: 'note' }] }; } },
    idx: { rescanVault() {} },
    ai: { scheduleEmbed: (_vaultId, note) => embedded.push(note.id) },
    async withIndexVaultLock(_vaultId, fn) { return await fn(); },
    runOptionalSearchIndexTask(_label, fn) { return fn(); },
    getIndexReadyPromise: () => Promise.resolve(),
  });

  await handler({ vaultId: 'v1', fileName: 'note.md' });
  assert.deepEqual(embedded, ['note']);
});

test('an unknown watcher filename rescans once and re-embeds the vault', async () => {
  const embedded = [];
  let rescans = 0;
  const handler = createExternalVaultChangeHandler({
    store: { async loadVault() { return { notes: [{ id: 'one' }, { id: 'two' }] }; } },
    idx: { rescanVault() { rescans++; } },
    ai: { scheduleEmbed: (_vaultId, note) => embedded.push(note.id) },
    async withIndexVaultLock(_vaultId, fn) { return await fn(); },
    runOptionalSearchIndexTask(_label, fn) { return fn(); },
    getIndexReadyPromise: () => Promise.resolve(),
  });

  await handler({
    vaultId: 'v1',
    fileName: '',
    fileNames: [],
    changes: [{ fileName: null, eventType: 'change' }],
    fullVault: true,
  });

  assert.equal(rescans, 1);
  assert.deepEqual(embedded, ['one', 'two']);
});
