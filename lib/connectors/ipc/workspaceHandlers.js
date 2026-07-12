function registerWorkspaceHandlers(ipcMain, deps) {
  const { wrap, store, attachments, sanitizeAttachmentPayload, shell, vaultWatcher, withIndexVaultLock, idx, ai, runOptionalSearchIndexTask } = deps;

  ipcMain.handle('mn:saveAttachment', wrap((vaultId, payload) => {
    return attachments.saveAttachment(vaultId, sanitizeAttachmentPayload(payload));
  }));
  ipcMain.handle('mn:describeAttachment', wrap((vaultId, fileName) => {
    return attachments.describeAttachment(vaultId, fileName);
  }));
  ipcMain.handle('mn:openAttachment', wrap((vaultId, fileName) => {
    return attachments.openAttachment(vaultId, fileName, filePath => shell.openPath(filePath));
  }));
  ipcMain.handle('mn:listDeletedNotes', wrap(store.listDeletedNotes));
  ipcMain.handle('mn:restoreDeletedNote', wrap(async (vaultId, trashId) => {
    vaultWatcher.markInternal(vaultId);
    return await withIndexVaultLock(vaultId, async () => {
      const note = await store.restoreDeletedNote(vaultId, trashId);
      const indexed = runOptionalSearchIndexTask('index restored note', () => idx.indexNote(vaultId, note));
      if (indexed !== null) ai.scheduleEmbed(vaultId, note);
      return note;
    });
  }));
  ipcMain.handle('mn:purgeDeletedNote', wrap(store.purgeDeletedNote));
  ipcMain.handle('mn:listNoteVersions', wrap(store.listNoteVersions));
  ipcMain.handle('mn:getNoteVersion', wrap(store.getNoteVersion));
  ipcMain.handle('mn:restoreNoteVersion', wrap(async (vaultId, noteId, versionId) => {
    vaultWatcher.markInternal(vaultId);
    return await withIndexVaultLock(vaultId, async () => {
      const note = await store.restoreNoteVersion(vaultId, noteId, versionId);
      const indexed = runOptionalSearchIndexTask('index restored note version', () => idx.indexNote(vaultId, note));
      if (indexed !== null) ai.scheduleEmbed(vaultId, note);
      return note;
    });
  }));
  ipcMain.handle('mn:listCanvases', wrap(store.listCanvases));
  ipcMain.handle('mn:getCanvas', wrap(store.getCanvas));
  ipcMain.handle('mn:saveCanvas', wrap(store.saveCanvas));
  ipcMain.handle('mn:deleteCanvas', wrap(store.deleteCanvas));
  ipcMain.handle('mn:listDeletedCanvases', wrap(store.listDeletedCanvases));
  ipcMain.handle('mn:restoreDeletedCanvas', wrap(store.restoreDeletedCanvas));
  ipcMain.handle('mn:purgeDeletedCanvas', wrap(store.purgeDeletedCanvas));
  ipcMain.handle('mn:saveVaultMeta', wrap(store.saveVaultMeta));
}

module.exports = { registerWorkspaceHandlers };
