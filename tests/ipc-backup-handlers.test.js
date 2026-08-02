const test = require('node:test');
const assert = require('node:assert/strict');

const { registerBackupHandlers } = require('../lib/connectors/ipc/backupHandlers.js');

// lib/connectors/ipc/backupHandlers.js writes and reads whole-vault backups, so
// a mistake here loses or leaks everything at once. It sat at 53.85% branch
// coverage. Two guards matter most: the file must not be a symlink, and an
// oversized import must be refused before it is read into memory.

function setup({
  saveDialog = { canceled: false, filePath: '/tmp/backup.json' },
  openDialog = { canceled: false, filePaths: ['/tmp/backup.json'] },
  lstat = { isSymbolicLink: () => false, size: 100 },
  lstatError = null,
  fileLimit = 1000,
  recordBackupExport = async () => {},
  importedVaults = [{ id: 'v1' }],
  storeOverrides = {},
  rescanThrows = false,
} = {}) {
  const calls = { written: [], read: [], rescanned: [], watcherRefreshed: 0, exported: 0 };
  const handlers = {};
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
  const store = {
    exportBackup: async () => { calls.exported += 1; return { exportedAt: 'T0', vaults: [{ id: 'v1' }], warnings: [] }; },
    atomicWriteFile: async (p, data) => calls.written.push([p, data.length]),
    importBackup: async () => ({ importedVaults, noteCount: 3 }),
    loadVault: async id => ({ id, notes: [] }),
    listVaults: async () => [{ id: 'v1' }],
    recordBackupExport,
    ...storeOverrides,
  };
  registerBackupHandlers(ipcMain, {
    wrap: fn => fn,
    dialog: { showSaveDialog: async () => saveDialog, showOpenDialog: async () => openDialog },
    fs: {
      promises: {
        lstat: async () => { if (lstatError) throw lstatError; return lstat; },
        readFile: async p => { calls.read.push(p); return '{"vaults":[]}'; },
      },
    },
    store,
    idx: { rescanVault: id => { if (rescanThrows) throw new Error('index locked'); calls.rescanned.push(id); } },
    getMainWindow: () => ({}),
    runOptionalSearchIndexTask: (_l, fn) => { try { return fn(); } catch { return null; } },
    importNovelFilesFromIpc: async () => ({}),
    markdownImportService: { preview: async () => ({}), apply: async () => ({ ok: true }), cancel: async () => ({}) },
    exportNote: async () => ({}),
    backupImportFileLimit: fileLimit,
    vaultWatcher: { refresh: () => { calls.watcherRefreshed += 1; } },
  });
  return { handlers, calls };
}

test('cancelling the export dialog writes nothing', async () => {
  const { handlers, calls } = setup({ saveDialog: { canceled: true } });
  const res = await handlers['mn:exportBackup']({});
  assert.equal(res.canceled, true);
  assert.deepEqual(calls.written, [], 'a cancelled export still wrote a file');
  assert.equal(calls.exported, 0, 'a cancelled export still read the whole vault');
});

test('a save dialog that returns no path is treated as cancelled', async () => {
  const { handlers, calls } = setup({ saveDialog: { canceled: false, filePath: '' } });
  const res = await handlers['mn:exportBackup']({});
  assert.equal(res.canceled, true);
  assert.deepEqual(calls.written, []);
});

test('a backup is never written through a symlink', async () => {
  // Writing through a symlink would let a crafted target place the user's
  // entire vault somewhere they did not choose.
  const { handlers, calls } = setup({ lstat: { isSymbolicLink: () => true } });
  await assert.rejects(() => handlers['mn:exportBackup']({}), /symlink/i);
  assert.deepEqual(calls.written, [], 'wrote despite the symlink check failing');
});

test('exporting to a path that does not exist yet is allowed', async () => {
  // ENOENT is the normal case for a new backup file and must not be an error.
  const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
  const { handlers, calls } = setup({ lstatError: enoent });
  const res = await handlers['mn:exportBackup']({});
  assert.equal(res.canceled, false);
  assert.equal(calls.written.length, 1);
});

test('an unreadable export target is reported rather than silently skipped', async () => {
  const eacces = Object.assign(new Error('denied'), { code: 'EACCES' });
  const { handlers, calls } = setup({ lstatError: eacces });
  await assert.rejects(() => handlers['mn:exportBackup']({}), /denied/);
  assert.deepEqual(calls.written, []);
});

test('a failure to record the export does not discard the backup', async () => {
  // The file is already on disk at this point. Failing the whole call would
  // tell the user their backup failed when it actually succeeded.
  const { handlers, calls } = setup({
    recordBackupExport: async () => { throw new Error('status write failed'); },
  });
  const res = await handlers['mn:exportBackup']({});
  assert.equal(res.canceled, false);
  assert.equal(calls.written.length, 1, 'the backup was not written');
  assert.ok(res.warnings.some(w => /status write failed/.test(w.message)),
    'the failure was swallowed instead of being surfaced as a warning');
});

test('cancelling the import dialog reads nothing', async () => {
  const { handlers, calls } = setup({ openDialog: { canceled: true } });
  const res = await handlers['mn:importBackup']({});
  assert.equal(res.canceled, true);
  assert.deepEqual(calls.read, []);
});

test('a backup is never imported from a symlink', async () => {
  const { handlers, calls } = setup({ lstat: { isSymbolicLink: () => true, size: 10 } });
  await assert.rejects(() => handlers['mn:importBackup']({}), /symlink/i);
  assert.deepEqual(calls.read, [], 'read the file despite the symlink check failing');
});

test('an oversized backup is refused before it is read into memory', async () => {
  // Checking after reading would defeat the limit entirely.
  const { handlers, calls } = setup({ lstat: { isSymbolicLink: () => false, size: 999999 }, fileLimit: 1000 });
  await assert.rejects(() => handlers['mn:importBackup']({}), /too large/i);
  assert.deepEqual(calls.read, [], 'an oversized file was read before the size check');
});

test('a successful import reindexes every imported vault and refreshes the watcher', async () => {
  const { handlers, calls } = setup({ importedVaults: [{ id: 'v1' }, { id: 'v2' }] });
  const res = await handlers['mn:importBackup']({});
  assert.equal(res.canceled, false);
  assert.deepEqual(calls.rescanned, ['v1', 'v2'], 'an imported vault was left out of the search index');
  assert.equal(calls.watcherRefreshed, 1, 'the file watcher was not told about the new vaults');
});

test('an import with no vaults still completes and refreshes the watcher', async () => {
  const { handlers, calls } = setup({ importedVaults: [] });
  const res = await handlers['mn:importBackup']({});
  assert.equal(res.canceled, false);
  assert.equal(calls.watcherRefreshed, 1);
});

test('a failing search index does not fail an import whose data is already on disk', async () => {
  // By this point importBackup has written the notes. Failing the call would
  // tell the user the import failed while their notes are actually restored.
  const { handlers, calls } = setup({ rescanThrows: true });
  const res = await handlers['mn:importBackup']({});
  assert.equal(res.canceled, false, 'the import was reported as failed because indexing failed');
  assert.equal(res.noteCount, 3, 'the import result was lost');
  assert.equal(calls.watcherRefreshed, 1, 'the watcher was not refreshed after a failed reindex');
});

test('applying a Markdown import reindexes the target vault', async () => {
  const { handlers, calls } = setup();
  await handlers['mn:applyMarkdownImport']({ vaultId: 'v1' });
  assert.deepEqual(calls.rescanned, ['v1']);
});
