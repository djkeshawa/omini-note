function registerBackupHandlers(ipcMain, deps) {
  const {
    wrap, dialog, fs, store, idx, getMainWindow, runOptionalSearchIndexTask,
    importNovelFilesFromIpc, markdownImportService, exportNote, backupImportFileLimit,
  } = deps;

  ipcMain.handle('mn:exportBackup', wrap(async (options = {}) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Export VispNote backup',
      defaultPath: `vispnote-backup-${stamp}.vispnote-backup.json`,
      filters: [{ name: 'VispNote Backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      const targetStat = await fs.promises.lstat(result.filePath);
      if (targetStat.isSymbolicLink()) throw new Error('Backup export target cannot be a symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const payload = await store.exportBackup(options || {});
    await store.atomicWriteFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { canceled: false, filePath: result.filePath, vaultCount: payload.vaults.length, warnings: payload.warnings || [] };
  }));
  ipcMain.handle('mn:exportNote', wrap(exportNote));
  ipcMain.handle('mn:importBackup', wrap(async (options = {}) => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import VispNote backup',
      properties: ['openFile'],
      filters: [{ name: 'VispNote Backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const importStat = await fs.promises.lstat(filePath);
    if (importStat.isSymbolicLink()) throw new Error('Backup import file cannot be a symlink');
    if (importStat.size > backupImportFileLimit) throw new Error('Backup file is too large');
    const imported = await store.importBackup(await fs.promises.readFile(filePath, 'utf8'), options || {});
    for (const vault of imported.importedVaults || []) {
      const loaded = await store.loadVault(vault.id);
      runOptionalSearchIndexTask('rescan imported vault', () => idx.rescanVault(vault.id, loaded.notes || []));
    }
    return { ...imported, canceled: false, filePath };
  }));
  ipcMain.handle('mn:importNovelFiles', wrap(importNovelFilesFromIpc));
  ipcMain.handle('mn:previewMarkdownImport', wrap(async (options = {}) => markdownImportService.preview(options)));
  ipcMain.handle('mn:applyMarkdownImport', wrap(async (options = {}) => {
    const imported = await markdownImportService.apply(options);
    const loaded = await store.loadVault(options.vaultId);
    runOptionalSearchIndexTask('rescan Markdown import', () => idx.rescanVault(options.vaultId, loaded.notes || []));
    return imported;
  }));
  ipcMain.handle('mn:cancelMarkdownImport', wrap(async (options = {}) => markdownImportService.cancel(options)));
}

module.exports = { registerBackupHandlers };
