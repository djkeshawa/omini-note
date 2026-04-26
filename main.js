const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } = require('electron');
const path = require('path');
const store = require('./lib/store');
const idx = require('./lib/index');
const ai = require('./lib/ai');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="5" y="4" width="22" height="24" rx="5" fill="#111827"/>
      <path d="M11 11H21M11 16H20M11 21H17" stroke="#F9FAFB" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
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

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: visible ? 'Hide OminiNote' : 'Show OminiNote',
      click: () => {
        if (visible) mainWindow.hide();
        else showMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit OminiNote',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('OminiNote');
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide();
    else showMainWindow();
    updateTrayMenu();
  });
  updateTrayMenu();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f6f7f9',
    title: 'OminiNote',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('OminiNote.html');
  mainWindow = win;

  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
    updateTrayMenu();
  });
  win.on('show', updateTrayMenu);
  win.on('hide', updateTrayMenu);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    updateTrayMenu();
  });

  return win;
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

function wrap(fn) {
  return async (_evt, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      console.error('[ipc]', fn.name, e);
      return { ok: false, error: e.message || String(e) };
    }
  };
}

// Vault management
ipcMain.handle('mn:listVaults',     wrap(store.listVaults));
ipcMain.handle('mn:createVault',    wrap(async (name) => {
  const v = await store.createVault(name);
  // Index the seeded welcome note
  const data = await store.loadVault(v.id);
  idx.rescanVault(v.id, data.notes);
  return v;
}));
ipcMain.handle('mn:renameVault',    wrap(store.renameVault));
ipcMain.handle('mn:deleteVault',    wrap(async (vaultId) => {
  const result = await store.deleteVault(vaultId);
  idx.removeVault(vaultId);
  return result;
}));
ipcMain.handle('mn:setActiveVault', wrap(store.setActiveVault));

// Notes
ipcMain.handle('mn:loadVault',      wrap(store.loadVault));
ipcMain.handle('mn:saveNote',       wrap(async (vaultId, note) => {
  await store.saveNote(vaultId, note);
  idx.indexNote(vaultId, note);
  ai.scheduleEmbed(vaultId, note);  // fire-and-forget; no-op if Ollama down
}));
ipcMain.handle('mn:deleteNote',     wrap(async (vaultId, noteId) => {
  await store.deleteNote(vaultId, noteId);
  idx.removeNote(vaultId, noteId);
}));
ipcMain.handle('mn:saveVaultMeta',  wrap(store.saveVaultMeta));

// Prefs
ipcMain.handle('mn:getPrefs',       wrap(store.getPrefs));
ipcMain.handle('mn:setPrefs',       wrap(store.setPrefs));

// Search / backlinks / tags (SQLite-backed)
ipcMain.handle('mn:search',         wrap((vaultId, query, limit) => idx.search(vaultId, query, limit)));
ipcMain.handle('mn:backlinks',      wrap((vaultId, title) => idx.backlinks(vaultId, title)));
ipcMain.handle('mn:notesByTag',     wrap((vaultId, tag) => idx.notesByTag(vaultId, tag)));
ipcMain.handle('mn:tagCounts',      wrap((vaultId) => idx.tagCounts(vaultId)));

// AI (Ollama)
ipcMain.handle('mn:ai.status',      wrap(() => ai.status()));
ipcMain.handle('mn:ai.connect',     wrap(async () => {
  const result = await ai.connect();
  if (result?.config) await store.setPrefs({ aiConfig: result.config });
  return result;
}));
ipcMain.handle('mn:ai.ask',         wrap((vaultId, query) => ai.ask(vaultId, query)));
ipcMain.handle('mn:ai.edit',        wrap((payload) => ai.editText(payload)));
ipcMain.handle('mn:ai.chat',        wrap((payload) => ai.chat(payload)));
ipcMain.handle('mn:ai.backfill',    wrap((vaultId) => ai.backfillVault(vaultId, store)));
ipcMain.handle('mn:ai.getConfig',   wrap(() => ai.getConfig()));
ipcMain.handle('mn:ai.setConfig',   wrap(async (patch) => {
  const config = ai.setConfig(patch);
  await store.setPrefs({ aiConfig: config });
  return config;
}));

// Window
ipcMain.handle('mn:setTitle', (evt, title) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (win && typeof title === 'string') win.setTitle(title);
});

// ── Boot scan: populate the index from disk ──────────────────────────────────

async function rescanAllVaults() {
  const cfg = await store.loadConfig();
  for (const v of cfg.vaults) {
    try {
      const data = await store.loadVault(v.id);
      idx.rescanVault(v.id, data.notes);
    } catch (e) {
      console.error('rescan failed for vault', v.id, e);
    }
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    await store.loadConfig();   // ensures the OminiNote vault folder, seeds on first run
    const prefs = await store.getPrefs();
    if (prefs.aiConfig) ai.setConfig(prefs.aiConfig);
    idx.init();                 // opens / creates the local search index
    await rescanAllVaults();    // sync index with disk
  } catch (e) {
    console.error('boot init failed', e);
  }
  createTray();
  createWindow();

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => { idx.close(); });
