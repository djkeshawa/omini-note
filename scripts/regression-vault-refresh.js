const { ipcMain } = require('electron');
const store = require('../lib/store');
const { createIpcRuntime } = require('../main/ipcRuntime');

async function runVaultRefreshScenario(win, { seedEditorNote, focusEditorRow, typeActiveEditorText, waitFor, editorRows }) {
  const id = 'qe_refresh_typing';
  await seedEditorNote(win, { id, title: 'QE Refresh Typing', body: 'Parent' });
  const { activeVaultId } = await store.getPrefs();
  const { wrap } = createIpcRuntime();
  let release;
  let captured = false;
  const pending = new Promise(resolve => { release = resolve; });
  ipcMain.removeHandler('mn:loadVault');
  ipcMain.handle('mn:loadVault', wrap(async vaultId => {
    const snapshot = await store.loadVault(vaultId);
    if (!captured) {
      captured = true;
      await pending;
    }
    return snapshot;
  }));
  try {
    // Exercise the actual watcher event and IPC response, pausing the disk
    // snapshot so typing happens at the precise point that used to lose it.
    win.webContents.send('mn:vaultFilesChanged', { vaultId: activeVaultId, fileName: `${id}.md` });
    await waitFor(win, 'refresh has captured the disk snapshot', async () => ({ ok: captured }));
    await focusEditorRow(win, 0);
    await typeActiveEditorText(win, ' kept');
    release();
    await waitFor(win, 'typing during refresh survives in the editor and on disk', async () => {
      const note = await store.getNote(activeVaultId, id);
      const rows = await editorRows(win);
      return { ok: note.body.includes('Parent kept') && rows[0]?.text.includes('Parent kept'), rows };
    });
  } finally {
    release();
    ipcMain.removeHandler('mn:loadVault');
    ipcMain.handle('mn:loadVault', wrap(store.loadVault));
  }
}

module.exports = { runVaultRefreshScenario };
