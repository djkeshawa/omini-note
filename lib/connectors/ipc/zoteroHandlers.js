function registerZoteroHandlers(ipcMain, deps) {
  const { wrap, zotero, sanitizeSearch, sanitizeList, sanitizeRead } = deps;
  ipcMain.handle('mn:zotero.status', wrap(() => zotero.status()));
  ipcMain.handle('mn:zotero.search', wrap(payload => zotero.search(sanitizeSearch(payload))));
  ipcMain.handle('mn:zotero.list', wrap(payload => zotero.list(sanitizeList(payload))));
  ipcMain.handle('mn:zotero.read', wrap(payload => zotero.read(sanitizeRead(payload))));
}

module.exports = { registerZoteroHandlers };
