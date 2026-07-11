function createUpdateService({ app, autoUpdater, getMainWindow }) {
  let state = {
    status: 'idle',
    currentVersion: app.getVersion(),
    lastCheckedAt: null,
    error: null,
    updateInfo: null,
    downloaded: false,
    manualUrl: 'https://github.com/djkeshawa/visp-note/releases/latest',
  };

  function linuxMode() {
    if (process.platform !== 'linux') return 'native';
    return process.env.APPIMAGE ? 'appimage' : 'manual';
  }

  function emitState(patch = {}) {
    state = { ...state, ...patch, currentVersion: app.getVersion(), linuxMode: linuxMode() };
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('mn:updates.state', state);
    return state;
  }

  function configure() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update', () => emitState({ status: 'checking', lastCheckedAt: new Date().toISOString(), error: null }));
    autoUpdater.on('update-available', info => emitState({ status: 'available', updateInfo: info || null, downloaded: false }));
    autoUpdater.on('update-not-available', info => emitState({ status: 'not-available', updateInfo: info || null, downloaded: false }));
    autoUpdater.on('update-downloaded', info => emitState({ status: 'downloaded', updateInfo: info || null, downloaded: true }));
    autoUpdater.on('error', error => emitState({ status: 'error', error: error?.message || String(error) }));
  }

  async function check() {
    const mode = linuxMode();
    if (!app.isPackaged || mode === 'manual' || process.platform === 'darwin') {
      return emitState({
        status: mode === 'manual' || process.platform === 'darwin' ? 'manual' : 'not-available',
        lastCheckedAt: new Date().toISOString(),
        error: process.platform === 'darwin' && app.isPackaged ? 'Automatic updates are disabled for unsigned macOS builds.' : null,
        updateInfo: null,
      });
    }
    emitState({ status: 'checking', lastCheckedAt: new Date().toISOString(), error: null });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      emitState({ status: 'error', error: error?.message || String(error) });
    }
    return state;
  }

  return { configure, check, emitState, getState: () => state };
}

module.exports = { createUpdateService };
