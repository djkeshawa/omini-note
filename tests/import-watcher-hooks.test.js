const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { registerBackupHandlers } = require('../lib/connectors/ipc/backupHandlers');
const { registerMemoryHandlers } = require('../lib/connectors/ipc/memoryHandlers');

function handlerRegistry() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

test('backup and Markdown imports rescan under the index lock and refresh new vault watchers', async () => {
  const { handlers, ipcMain } = handlerRegistry();
  const marked = [];
  const refreshed = [];
  const rescanned = [];
  const lockOrder = [];
  const vaults = [{ id: 'backup-vault', path: '/vaults/backup' }];
  const store = {
    async importBackup() { return { importedVaults: [{ id: 'backup-vault' }] }; },
    async loadVault(vaultId) {
      return vaultId === 'backup-vault'
        ? { notes: [{ id: 'backup-one' }, { id: 'backup-two' }] }
        : { notes: [{ id: 'markdown-one' }, { id: 'markdown-two' }] };
    },
    async listVaults() { return vaults; },
  };
  registerBackupHandlers(ipcMain, {
    wrap: fn => fn,
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: ['/safe/backup.json'] }; } },
    fs: {
      promises: {
        async lstat() { return { isSymbolicLink: () => false, size: 2 }; },
        async readFile() { return '{}'; },
      },
    },
    store,
    idx: { rescanVault: (vaultId, notes) => rescanned.push([vaultId, notes.map(note => note.id)]) },
    getMainWindow: () => null,
    runOptionalSearchIndexTask: (_label, fn) => fn(),
    withIndexVaultLock: async (vaultId, fn) => {
      lockOrder.push(`lock:${vaultId}`);
      return await fn();
    },
    importNovelFilesFromIpc: async () => ({}),
    markdownImportService: {
      async apply() { return { imported: 2, noteIds: ['markdown-one', 'markdown-two'] }; },
      async preview() { return {}; },
      async cancel() { return {}; },
    },
    exportNote: async () => ({}),
    backupImportFileLimit: 1024,
    vaultWatcher: {
      markInternal: (vaultId, noteIds) => marked.push([vaultId, noteIds]),
      refresh: nextVaults => refreshed.push(nextVaults),
    },
  });

  await handlers.get('mn:importBackup')({ activate: true });
  await handlers.get('mn:applyMarkdownImport')({ vaultId: 'markdown-vault', token: 'token' });

  assert.deepEqual(marked, [], 'handler-level bulk stamps cannot hide edits during a long import');
  assert.deepEqual(refreshed, [vaults]);
  assert.deepEqual(lockOrder, ['lock:backup-vault', 'lock:markdown-vault']);
  assert.deepEqual(rescanned, [
    ['backup-vault', ['backup-one', 'backup-two']],
    ['markdown-vault', ['markdown-one', 'markdown-two']],
  ]);
});

test('memory import marks each note as soon as its save callback runs', async () => {
  const { handlers, ipcMain } = handlerRegistry();
  const marked = [];
  const indexed = [];
  const embedded = [];
  const ai = {
    setMemoryRecallProvider() {},
    scheduleEmbed: (vaultId, note) => embedded.push([vaultId, note.id]),
  };
  registerMemoryHandlers(ipcMain, {
    wrap: fn => fn,
    store: {
      async getPrefs() { return { tweaks: { plugins: [{ type: 'llm-memory', enabled: true, config: {} }] } }; },
    },
    idx: { indexNote: (vaultId, note) => indexed.push([vaultId, note.id]) },
    ai,
    llmMemory: {
      normalizeMemoryConfig: config => config,
      async importMemoriesToVault(host, _config, vaultId) {
        const notes = [{ id: 'memory-one' }, { id: 'memory-two' }];
        for (const note of notes) await host.onNoteSaved(note);
        return { imported: notes.length, notes, vaultId };
      },
    },
    memoryLinks: {},
    async withIndexVaultLock(_vaultId, fn) { return await fn(); },
    runOptionalSearchIndexTask: (_label, fn) => fn(),
    vaultWatcher: { markInternal: (vaultId, noteIds) => marked.push([vaultId, noteIds]) },
  });

  const result = await handlers.get('mn:memory.import')('v1');

  assert.equal(result.imported, 2);
  assert.deepEqual(marked, [['v1', ['memory-one']], ['v1', ['memory-two']]]);
  assert.deepEqual(indexed, [['v1', 'memory-one'], ['v1', 'memory-two']]);
  assert.deepEqual(embedded, [['v1', 'memory-one'], ['v1', 'memory-two']]);
});

test('main composition passes the production watcher through every import boundary', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /createMarkdownImportService\(\{[\s\S]*?onNoteSaved: \(vaultId, note\) => vaultWatcher\.markInternal/);
  assert.match(main, /registerMemoryHandlers\(ipcMain, \{[\s\S]*?vaultWatcher,/);
  assert.match(main, /registerBackupHandlers\(ipcMain, \{[\s\S]*?vaultWatcher,/);
});
