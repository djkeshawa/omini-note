function registerVaultNoteHandlers(ipcMain, deps) {
  const {
    wrap, registerNotesVaultHandlers, store, idx, ai, linkRename,
    withIndexVaultLock, runOptionalSearchIndexTask, vaultWatcher,
  } = deps;

  registerNotesVaultHandlers(ipcMain, {
    store,
    idx,
    ai,
    withIndexVaultLock,
    runOptionalSearchIndexTask,
    onVaultMutated: vaultId => vaultWatcher.markInternal(vaultId),
    onVaultRegistryChange: async () => vaultWatcher.refresh(await store.listVaults()),
  });

  ipcMain.handle('mn:listVaults', wrap(store.listVaults));
  ipcMain.handle('mn:createVault', wrap(async (name, options) => {
    const vault = await store.createVault(name, options);
    const data = await store.loadVault(vault.id);
    await withIndexVaultLock(vault.id, async () => runOptionalSearchIndexTask(
      'rescan created vault',
      () => idx.rescanVault(vault.id, data.notes)
    ));
    vaultWatcher.refresh(await store.listVaults());
    return vault;
  }));
  ipcMain.handle('mn:renameVault', wrap(store.renameVault));
  ipcMain.handle('mn:deleteVault', wrap(async vaultId => {
    return await withIndexVaultLock(vaultId, async () => {
      const result = await store.deleteVault(vaultId);
      runOptionalSearchIndexTask('remove vault from index', () => idx.removeVault(vaultId));
      vaultWatcher.refresh(await store.listVaults());
      return result;
    });
  }));
  ipcMain.handle('mn:setActiveVault', wrap(store.setActiveVault));
  ipcMain.handle('mn:loadVault', wrap(store.loadVault));
  ipcMain.handle('mn:saveNote', wrap(async (vaultId, note, options) => {
    return await withIndexVaultLock(vaultId, async () => {
      const previousNote = note?.id ? await store.getNote(vaultId, note.id).catch(() => null) : null;
      const saved = await store.saveNote(vaultId, note, options || {});
      const indexed = runOptionalSearchIndexTask('index note', () => idx.indexNote(vaultId, saved));
      if (indexed !== null) ai.scheduleEmbed(vaultId, saved);
      const linkedNoteUpdates = await linkRename.renameLinksAfterSave({
        store,
        vaultId,
        previousNote,
        savedNote: saved,
        onNoteUpdated: updated => {
          const linkIndexed = runOptionalSearchIndexTask('index link-renamed note', () => idx.indexNote(vaultId, updated));
          if (linkIndexed !== null) ai.scheduleEmbed(vaultId, updated);
        },
      });
      // Every file this call writes has landed by here — including the link
      // rename cascade, which can rewrite dozens of notes well after the
      // original save.
      vaultWatcher.markInternal(vaultId);
      return linkedNoteUpdates.length
        ? {
            ...saved,
            linkedNoteUpdates,
            linkedNoteRename: { oldTitle: previousNote?.title || '', newTitle: saved.title || '' },
          }
        : saved;
    });
  }));
  ipcMain.handle('mn:deleteNote', wrap(async (vaultId, noteId, noteSnapshot) => {
    return await withIndexVaultLock(vaultId, async () => {
      const result = await store.deleteNote(vaultId, noteId, noteSnapshot);
      runOptionalSearchIndexTask('remove note from index', () => idx.removeNote(vaultId, noteId));
      vaultWatcher.markInternal(vaultId);
      return result;
    });
  }));
}

module.exports = { registerVaultNoteHandlers };
