function createWindowLifecycle({
  app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, globalShortcut,
  path, rootDir, appName, iconPath, attachEditContextMenu, hardenWindow, quitPersistence,
}) {
  let mainWindow = null;
  let tray = null;
  let isQuitting = false;
  let flushSequence = 0;
  let shortcutState = { accelerator: null, registered: false, error: null };
  const shortcut = process.platform === 'darwin' ? 'Cmd+Shift+N' : 'Ctrl+Shift+N';

  function createFallbackIcon() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#57595d"/><path d="M7 11C7 7 12 6 15 9L16 10L17 9C20 6 25 7 25 11C25 15 20 17 17 14L16 13L15 14C12 17 7 15 7 11Z" fill="none" stroke="#9bbdff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 16C6 18 7 24 12 24C13 27 16 27 16 23M22 16C26 18 25 24 20 24C19 27 16 27 16 23M16 15V23" fill="none" stroke="#aaa5ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }

  function createAppIcon() {
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) return image;
    } catch (error) {
      console.error('failed to load app icon', error);
    }
    return createFallbackIcon();
  }

  function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function openQuickCapture() {
    showMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const win = mainWindow;
    const send = () => {
      if (!win.isDestroyed()) win.webContents.send('mn:openQuickCapture');
    };
    if (win.webContents.isLoading()) {
      const clear = () => win.webContents?.removeListener?.('did-finish-load', send);
      win.once('closed', clear);
      win.webContents.once('did-finish-load', send);
    } else send();
  }

  function registerQuickCaptureShortcut() {
    if (process.env.VISPNOTE_DISABLE_GLOBAL_SHORTCUTS === '1') {
      shortcutState = { accelerator: shortcut, registered: false, error: 'Global shortcuts are disabled for this process.' };
      return;
    }
    try {
      if (!globalShortcut.register(shortcut, openQuickCapture)) {
        shortcutState = { accelerator: shortcut, registered: false, error: 'Shortcut is already in use or unavailable.' };
        console.warn('quick capture shortcut not registered:', shortcut);
        return;
      }
      shortcutState = { accelerator: shortcut, registered: true, error: null };
    } catch (error) {
      shortcutState = { accelerator: shortcut, registered: false, error: error?.message || String(error) };
      console.error('quick capture shortcut registration failed', error);
    }
  }

  function updateTrayMenu() {
    if (!tray) return;
    const visible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: visible ? `Hide ${appName}` : `Show ${appName}`, click: () => visible ? mainWindow.hide() : showMainWindow() },
      { type: 'separator' },
      { label: `Quit ${appName}`, click: () => { isQuitting = true; app.quit(); } },
    ]));
  }

  function createTray() {
    if (tray) return;
    tray = new Tray(createAppIcon());
    tray.setToolTip(appName);
    tray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide();
      else showMainWindow();
      updateTrayMenu();
    });
    updateTrayMenu();
  }

  function cancelQuit(win, status) {
    isQuitting = false;
    if (!win || win.isDestroyed()) return;
    win.show();
    win.focus();
    dialog.showMessageBox(win, {
      type: 'error', title: 'Changes were not saved',
      message: 'VispNote stayed open to protect your unsaved changes.',
      detail: quitPersistence.flushFailureDetail(status),
      buttons: ['Keep app open'], defaultId: 0, noLink: true,
    }).catch(error => console.error('quit save warning failed', error));
  }

  function flushDirtyNotes(win, timeoutMs = 3500) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve({ ok: true, skipped: true });
    const requestId = `flush_${Date.now().toString(36)}_${++flushSequence}`;
    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ipcMain.removeListener('mn:flushDirtyNotesResult', onResult);
        resolve(result || { ok: true });
      };
      const onResult = (event, id, result) => {
        if (event.sender === win.webContents && id === requestId) finish(result);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'Timed out waiting for dirty-note flush' }), timeoutMs);
      ipcMain.on('mn:flushDirtyNotesResult', onResult);
      try {
        win.webContents.send('mn:flushDirtyNotes', requestId);
      } catch (error) {
        finish({ ok: false, error: error?.message || String(error) });
      }
    });
  }

  function createWindow() {
    const win = new BrowserWindow({
      width: 1440, height: 900, minWidth: 900, minHeight: 700,
      backgroundColor: '#f6f7f9', icon: createAppIcon(), title: appName,
      webPreferences: {
        ...(process.env.VISPNOTE_EPHEMERAL_SESSION === '1'
          ? { partition: `vispnote-test-${process.pid}`, backgroundThrottling: false }
          : {}),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, spellcheck: true,
        preload: path.join(rootDir, 'preload.js'),
      },
    });
    hardenWindow(win);
    const spellSession = win.webContents.session;
    spellSession.setSpellCheckerEnabled(true);
    const languages = spellSession.availableSpellCheckerLanguages || [];
    const language = languages.includes('en-US') ? 'en-US'
      : languages.includes('en-GB') ? 'en-GB' : languages.find(item => /^en[-_]/i.test(item));
    spellSession.setSpellCheckerLanguages([language || 'en-US']);
    win.loadFile(path.join(rootDir, 'vispnote.html'));
    mainWindow = win;
    attachEditContextMenu(win);
    win.on('close', event => {
      if (isQuitting) {
        if (win.__vispnoteFlushComplete) return;
        event.preventDefault();
        if (win.__vispnoteFlushInProgress) return;
        win.__vispnoteFlushInProgress = true;
        flushDirtyNotes(win).then(result => {
          const status = quitPersistence.classifyFlushResult(result);
          win.__vispnoteFlushInProgress = false;
          if (!status.ok) return cancelQuit(win, status);
          win.__vispnoteFlushComplete = true;
          if (!win.isDestroyed()) win.close();
          setImmediate(() => { if (isQuitting) app.quit(); });
        }).catch(error => {
          win.__vispnoteFlushInProgress = false;
          console.error('dirty-note flush failed', error);
          cancelQuit(win, quitPersistence.classifyFlushResult({ ok: false, error: error?.message || String(error) }));
        });
        return;
      }
      event.preventDefault();
      win.hide();
      updateTrayMenu();
    });
    win.on('show', updateTrayMenu);
    win.on('hide', updateTrayMenu);
    win.on('closed', () => { if (mainWindow === win) mainWindow = null; updateTrayMenu(); });
    return win;
  }

  return {
    createAppIcon, createTray, createWindow, showMainWindow, registerQuickCaptureShortcut,
    getMainWindow: () => mainWindow, getTray: () => tray, getShortcutState: () => shortcutState,
    beginQuit: () => { isQuitting = true; },
  };
}

module.exports = { createWindowLifecycle };
