function registerSearchHandlers(ipcMain, deps) {
  const {
    wrap, idx, ai, store, withIndexVaultLock, initializeSearchIndex,
    noteSearchIndexFailure, getIndexReadyPromise, isSearchIndexAvailable,
    getSearchIndexError, assertSearchIndexAvailable,
  } = deps;
  const ready = async () => {
    await getIndexReadyPromise();
    assertSearchIndexAvailable();
  };

  ipcMain.handle('mn:search', wrap(async (vaultId, query, limit) => { await ready(); return idx.search(vaultId, query, limit); }));
  ipcMain.handle('mn:searchDetailed', wrap(async (vaultId, query, limit) => { await ready(); return idx.searchDetailed(vaultId, query, limit); }));
  ipcMain.handle('mn:searchDetailedStatus', wrap(async (vaultId, query, limit) => {
    await getIndexReadyPromise();
    if (!isSearchIndexAvailable()) return { ok: false, results: [], error: getSearchIndexError() || 'Search index unavailable' };
    return idx.searchDetailedStatus(vaultId, query, limit);
  }));
  ipcMain.handle('mn:backlinks', wrap(async (vaultId, title, limit) => { await ready(); return idx.backlinks(vaultId, title, limit); }));
  ipcMain.handle('mn:unlinkedMentions', wrap(async (vaultId, title, limit) => { await ready(); return idx.unlinkedMentions(vaultId, title, limit); }));
  ipcMain.handle('mn:notesByTag', wrap(async (vaultId, tag) => { await ready(); return idx.notesByTag(vaultId, tag); }));
  ipcMain.handle('mn:tagCounts', wrap(async vaultId => { await ready(); return idx.tagCounts(vaultId); }));
  ipcMain.handle('mn:rebuildIndex', wrap(async vaultId => {
    return await withIndexVaultLock(vaultId, async () => {
      if (!isSearchIndexAvailable() && !initializeSearchIndex()) assertSearchIndexAvailable();
      const vault = await store.loadVault(vaultId);
      try {
        idx.rescanVault(vaultId, vault.notes || []);
      } catch (error) {
        noteSearchIndexFailure('rebuild vault index', error);
        throw error;
      }
      return { indexed: vault.notes?.length || 0 };
    });
  }));
  ipcMain.handle('mn:vaultHealth', wrap(async vaultId => {
    const health = await store.vaultHealth(vaultId);
    await getIndexReadyPromise();
    if (!isSearchIndexAvailable()) {
      return { ...health, indexStatus: { ok: false, failureReason: getSearchIndexError() || 'Search index unavailable' } };
    }
    return { ...health, indexStatus: ai.indexStatus(vaultId) };
  }));
}

module.exports = { registerSearchHandlers };
