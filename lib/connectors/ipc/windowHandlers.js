function registerWindowHandlers(ipcMain, deps) {
  const {
    wrap, wrapWithEvent, BrowserWindow, shell, autoUpdater, sanitizeExternalUrl,
    getAppInfo, getShortcutState, openDataFolder, emitUpdateState, checkForUpdates, getUpdateState,
  } = deps;
  ipcMain.handle('mn:setTitle', wrapWithEvent((event, title) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && typeof title === 'string') win.setTitle(title.slice(0, 200));
  }));
  ipcMain.handle('mn:openExternal', wrap(url => shell.openExternal(sanitizeExternalUrl(url))));
  ipcMain.handle('mn:appInfo', wrap(() => getAppInfo()));
  ipcMain.handle('mn:shortcutStatus', wrap(() => getShortcutState()));
  ipcMain.handle('mn:openDataFolder', wrap(() => openDataFolder()));
  ipcMain.handle('mn:updates.status', wrap(() => emitUpdateState()));
  ipcMain.handle('mn:updates.check', wrap(() => checkForUpdates(true)));
  ipcMain.handle('mn:updates.install', wrap(() => {
    if (!getUpdateState().downloaded) throw new Error('No downloaded update is ready to install');
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  }));
}

module.exports = { registerWindowHandlers };
