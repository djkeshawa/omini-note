const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { registerBackupHandlers } = require('../lib/connectors/ipc/backupHandlers.js');

// lib/connectors/ipc/backupHandlers.js writes and reads whole-vault backups, so
// a mistake here loses or leaks everything at once. It sat at 53.85% branch
// coverage. Two guards matter most: the file must not be a symlink, and an
// oversized import must be refused before it is read into memory.

// exportBackup serializes the payload and measures it once, and the handler
// writes that exact string. `serialized` counts every serialization of the
// payload, so a second one inside the handler shows up as a count of 2.
function exportResult(payload, serialized = { count: 0 }) {
  Object.defineProperty(payload, 'toJSON', {
    enumerable: false,
    value() { serialized.count += 1; return { ...this }; },
  });
  const text = JSON.stringify(payload);
  return {
    payload,
    text,
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    noteCount: payload.vaults.reduce((total, vault) => total + (vault.notes?.length || 0), 0),
    canvasCount: payload.vaults.reduce((total, vault) => total + (vault.canvases?.length || 0), 0),
  };
}

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
    exportBackup: async () => { calls.exported += 1; return exportResult({ exportedAt: 'T0', vaults: [{ id: 'v1' }], warnings: [] }); },
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

test('an export with warnings is written but never recorded as a good backup', async () => {
  // A backup missing notes must not move the last-backup date: a green
  // "backed up" indicator over an incomplete file is a lie.
  const recorded = [];
  const { handlers, calls } = setup({
    recordBackupExport: async at => { recorded.push(at); },
    storeOverrides: {
      exportBackup: async () => exportResult({
        exportedAt: 'T0',
        vaults: [{ id: 'v1', notes: [{ id: 'n_1' }] }],
        warnings: [{ type: 'note-read', vaultId: 'v1', file: 'n_broken.md', message: 'unreadable' }],
      }),
    },
  });
  const res = await handlers['mn:exportBackup']({});
  assert.equal(res.canceled, false);
  assert.equal(calls.written.length, 1, 'the incomplete backup was withheld instead of written');
  assert.deepEqual(recorded, [], 'an incomplete export still updated the last-backup date');
  assert.equal(res.noteCount, 1);
  assert.ok(res.warnings.some(w => w.file === 'n_broken.md'), 'the warning did not reach the renderer');
});

test('a clean export records the backup and writes compact JSON', async () => {
  const recorded = [];
  const written = [];
  const serialized = { count: 0 };
  const result = exportResult({ exportedAt: 'T0', vaults: [{ id: 'v1', notes: [{ id: 'n_1' }, { id: 'n_2' }] }], warnings: [] }, serialized);
  const { handlers } = setup({
    recordBackupExport: async at => { recorded.push(at); },
    storeOverrides: {
      exportBackup: async () => result,
      atomicWriteFile: async (p, data) => written.push(data),
    },
  });
  const res = await handlers['mn:exportBackup']({});
  assert.deepEqual(recorded, ['T0'], 'a clean export did not update the last-backup date');
  assert.equal(written[0], result.text, 'the file was not written as compact single-line JSON');
  assert.equal(res.noteCount, 2);
  assert.equal(res.sizeBytes, Buffer.byteLength(result.text, 'utf8'));
});

// On a 10k-note vault a second stringify puts a second multi-megabyte string in
// memory beside the first, and reports a size the file on disk does not have.
test('the handler writes the string exportBackup already made instead of making its own', async () => {
  const serialized = { count: 0 };
  const written = [];
  const result = exportResult({ exportedAt: 'T0', vaults: [{ id: 'v1', notes: [{ id: 'n_1' }] }], warnings: [] }, serialized);
  assert.equal(serialized.count, 1, 'the repository stub did not serialize the payload exactly once');
  const { handlers } = setup({
    storeOverrides: { exportBackup: async () => result, atomicWriteFile: async (p, data) => written.push(data) },
  });
  const res = await handlers['mn:exportBackup']({});
  assert.equal(serialized.count, 1, 'the handler serialized the payload a second time');
  assert.equal(written[0], result.text, 'the bytes written are not the bytes that were measured');
  assert.equal(res.sizeBytes, result.sizeBytes, 'the reported size is not the size of the file on disk');

  const source = fs.readFileSync(path.join(__dirname, '../lib/connectors/ipc/backupHandlers.js'), 'utf8');
  assert.doesNotMatch(source, /JSON\.stringify\(payload\)/, 'the handler still stringifies the payload itself');
});

// An unreadable canvas used to be counted into the notes denominator, so the
// notice named the wrong thing and got the total wrong at the same time.
test('the export result counts canvases separately from notes', async () => {
  const { handlers } = setup({
    storeOverrides: {
      exportBackup: async () => exportResult({
        exportedAt: 'T0',
        vaults: [
          { id: 'v1', notes: [{ id: 'n_1' }, { id: 'n_2' }], canvases: [{ id: 'c_1' }] },
          { id: 'v2', notes: [{ id: 'n_3' }], canvases: [{ id: 'c_2' }, { id: 'c_3' }] },
        ],
        warnings: [],
      }),
    },
  });
  const res = await handlers['mn:exportBackup']({});
  assert.equal(res.noteCount, 3, 'the notes denominator still includes canvases');
  assert.equal(res.canvasCount, 3, 'the renderer has no denominator for the canvases it lost');
  assert.equal(res.vaultCount, 2);
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
