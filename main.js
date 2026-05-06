const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const store = require('./lib/store');
const idx = require('./lib/index');
const ai = require('./lib/ai');

let mainWindow = null;
let tray = null;
let isQuitting = false;
const APP_NAME = 'VispNote';
const APP_ID = 'com.vispnote.app';
const APP_ICON_PATH = path.join(__dirname, 'assets', 'vispnote-icon.png');
const SPELL_DICTIONARY_PATHS = [
  '/usr/share/dict/american-english',
  '/usr/share/dict/british-english',
  '/usr/share/hunspell/en_US.dic',
  '/usr/share/hunspell/en_GB.dic',
];
let spellWords = null;
let spellWordBuckets = null;
let spellDictionaryAvailable = false;
const spellSuggestionCache = new Map();

const COMMON_SPELL_WORDS = [
  'about', 'after', 'again', 'also', 'because', 'block', 'blocks', 'calendar',
  'check', 'checker', 'code', 'correct', 'document', 'editor', 'feature',
  'features', 'highlight', 'language', 'markdown', 'misspelled', 'note',
  'notes', 'notification', 'notifications', 'programming', 'reminder',
  'reminders', 'settings', 'spell', 'spelling', 'suggestion', 'suggestions',
  'syntax', 'text', 'their', 'there', 'these', 'this', 'typing', 'with',
  'word', 'words', 'working',
];

function normalizeSpellWord(word) {
  return String(word || '').toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

function loadSpellWords() {
  if (spellWords) return spellWords;
  const words = new Set();
  let loadedDictionaryWords = 0;
  for (const file of SPELL_DICTIONARY_PATHS) {
    try {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const raw = line.replace(/\/.*$/, '').trim();
        const word = normalizeSpellWord(raw);
        if (word.length >= 2 && /^[a-z][a-z']*$/.test(word)) {
          const before = words.size;
          words.add(word);
          if (words.size > before) loadedDictionaryWords++;
        }
      }
    } catch (e) {}
  }
  if (loadedDictionaryWords < 1000) {
    spellWords = new Set();
    spellWordBuckets = new Map();
    spellDictionaryAvailable = false;
    return spellWords;
  }
  for (const word of COMMON_SPELL_WORDS) words.add(word);
  spellDictionaryAvailable = true;
  spellWordBuckets = new Map();
  for (const word of words) {
    const first = word[0] || '';
    if (!spellWordBuckets.has(first)) spellWordBuckets.set(first, []);
    spellWordBuckets.get(first).push(word);
  }
  spellWords = words;
  return spellWords;
}

function spellDistance(a, b) {
  const alen = a.length, blen = b.length;
  if (Math.abs(alen - blen) > 2) return 99;
  const prev = Array.from({ length: blen + 1 }, (_, i) => i);
  for (let i = 1; i <= alen; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= blen; j++) {
      const old = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + cost);
      last = old;
    }
  }
  return prev[blen];
}

function spellSuggestions(word, dictionary) {
  if (spellSuggestionCache.has(word)) return spellSuggestionCache.get(word);
  const first = word[0];
  const maxDistance = word.length <= 5 ? 1 : 2;
  const scored = [];
  const candidates = spellWordBuckets?.get(first) || dictionary;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - word.length) > maxDistance) continue;
    const distance = spellDistance(word, candidate);
    if (distance <= maxDistance) scored.push({ candidate, distance });
  }
  const suggestions = scored
    .sort((a, b) => a.distance - b.distance || a.candidate.length - b.candidate.length || a.candidate.localeCompare(b.candidate))
    .slice(0, 5)
    .map(item => item.candidate);
  spellSuggestionCache.set(word, suggestions);
  return suggestions;
}

function spellcheckWords(inputWords = []) {
  const dictionary = loadSpellWords();
  if (!spellDictionaryAvailable) return {};
  const result = {};
  for (const raw of inputWords) {
    const word = normalizeSpellWord(raw);
    if (!word || word.length < 3 || dictionary.has(word)) continue;
    result[word] = spellSuggestions(word, dictionary);
  }
  return result;
}

function createFallbackIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" fill="#57595d"/>
      <path d="M7 11C7 7 12 6 15 9L16 10L17 9C20 6 25 7 25 11C25 15 20 17 17 14L16 13L15 14C12 17 7 15 7 11Z" fill="none" stroke="#9bbdff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10 16C6 18 7 24 12 24C13 27 16 27 16 23M22 16C26 18 25 24 20 24C19 27 16 27 16 23M16 15V23" fill="none" stroke="#aaa5ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function createAppIcon() {
  try {
    const image = nativeImage.createFromPath(APP_ICON_PATH);
    if (!image.isEmpty()) return image;
  } catch (e) {
    console.error('failed to load app icon', e);
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

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: visible ? `Hide ${APP_NAME}` : `Show ${APP_NAME}`,
      click: () => {
        if (visible) mainWindow.hide();
        else showMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: `Quit ${APP_NAME}`,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  if (tray) return;
  tray = new Tray(createAppIcon());
  tray.setToolTip(APP_NAME);
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide();
    else showMainWindow();
    updateTrayMenu();
  });
  updateTrayMenu();
}

function attachEditContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const flags = params.editFlags || {};
    const template = [];

    if (params.isEditable) {
      const suggestions = Array.isArray(params.dictionarySuggestions)
        ? params.dictionarySuggestions.slice(0, 5)
        : [];
      if (params.misspelledWord && suggestions.length) {
        suggestions.forEach(word => {
          template.push({
            label: word,
            click: () => win.webContents.replaceMisspelling(word),
          });
        });
        template.push({ type: 'separator' });
      }
      template.push(
        { label: 'Undo', role: 'undo', enabled: !!flags.canUndo },
        { label: 'Redo', role: 'redo', enabled: !!flags.canRedo },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: !!flags.canCut },
        { label: 'Copy', role: 'copy', enabled: !!flags.canCopy },
        { label: 'Paste', role: 'paste', enabled: !!flags.canPaste },
        { label: 'Delete', role: 'delete', enabled: !!flags.canDelete },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', enabled: !!flags.canSelectAll }
      );
      if (params.misspelledWord) {
        template.push(
          { type: 'separator' },
          {
            label: `Add "${params.misspelledWord}" to Dictionary`,
            click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
          }
        );
      }
    } else if (params.selectionText) {
      template.push(
        { label: 'Copy', role: 'copy', enabled: !!flags.canCopy },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', enabled: !!flags.canSelectAll }
      );
    }

    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function isAllowedAppNavigation(rawUrl) {
  try {
    const target = new URL(rawUrl);
    const appUrl = new URL(pathToFileURL(path.join(__dirname, 'OminiNote.html')).href);
    return target.protocol === appUrl.protocol && target.pathname === appUrl.pathname;
  } catch (e) {
    return false;
  }
}

function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedAppNavigation(targetUrl)) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f6f7f9',
    icon: createAppIcon(),
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  hardenWindow(win);
  const spellSession = win.webContents.session;
  spellSession.setSpellCheckerEnabled(true);
  const spellLanguages = spellSession.availableSpellCheckerLanguages || [];
  const spellLanguage = spellLanguages.includes('en-US')
    ? 'en-US'
    : spellLanguages.includes('en-GB')
    ? 'en-GB'
    : spellLanguages.find(lang => /^en[-_]/i.test(lang));
  if (spellLanguage) spellSession.setSpellCheckerLanguages([spellLanguage]);

  win.loadFile('OminiNote.html');
  mainWindow = win;
  attachEditContextMenu(win);

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
      return {
        ok: false,
        error: e.message || String(e),
        code: e.code || null,
        currentModifiedAt: e.currentModifiedAt || null,
        expectedModifiedAt: e.expectedModifiedAt || null,
      };
    }
  };
}

async function setPrefsFromIpc(patch) {
  if (patch && typeof patch === 'object' && !Array.isArray(patch) &&
      Object.prototype.hasOwnProperty.call(patch, 'aiConfig')) {
    const config = ai.setConfig(patch.aiConfig);
    return await store.setPrefs({ ...patch, aiConfig: config });
  }
  return await store.setPrefs(patch);
}

// Vault management
ipcMain.handle('mn:listVaults',     wrap(store.listVaults));
ipcMain.handle('mn:createVault',    wrap(async (name, options) => {
  const v = await store.createVault(name, options);
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
ipcMain.handle('mn:saveNote',       wrap(async (vaultId, note, options) => {
  const saved = await store.saveNote(vaultId, note, options || {});
  idx.indexNote(vaultId, saved);
  ai.scheduleEmbed(vaultId, saved);  // fire-and-forget; no-op if Ollama down
  return saved;
}));
ipcMain.handle('mn:deleteNote',     wrap(async (vaultId, noteId, noteSnapshot) => {
  const result = await store.deleteNote(vaultId, noteId, noteSnapshot);
  idx.removeNote(vaultId, noteId);
  return result;
}));
ipcMain.handle('mn:listDeletedNotes', wrap(store.listDeletedNotes));
ipcMain.handle('mn:restoreDeletedNote', wrap(async (vaultId, trashId) => {
  const note = await store.restoreDeletedNote(vaultId, trashId);
  idx.indexNote(vaultId, note);
  ai.scheduleEmbed(vaultId, note);
  return note;
}));
ipcMain.handle('mn:purgeDeletedNote', wrap(store.purgeDeletedNote));
ipcMain.handle('mn:listNoteVersions', wrap(store.listNoteVersions));
ipcMain.handle('mn:restoreNoteVersion', wrap(async (vaultId, noteId, versionId) => {
  const note = await store.restoreNoteVersion(vaultId, noteId, versionId);
  idx.indexNote(vaultId, note);
  ai.scheduleEmbed(vaultId, note);
  return note;
}));
ipcMain.handle('mn:listCanvases',   wrap(store.listCanvases));
ipcMain.handle('mn:getCanvas',      wrap(store.getCanvas));
ipcMain.handle('mn:saveCanvas',     wrap(store.saveCanvas));
ipcMain.handle('mn:deleteCanvas',   wrap(store.deleteCanvas));
ipcMain.handle('mn:listDeletedCanvases', wrap(store.listDeletedCanvases));
ipcMain.handle('mn:restoreDeletedCanvas', wrap(store.restoreDeletedCanvas));
ipcMain.handle('mn:purgeDeletedCanvas', wrap(store.purgeDeletedCanvas));
ipcMain.handle('mn:saveVaultMeta',  wrap(store.saveVaultMeta));

// Prefs
ipcMain.handle('mn:getPrefs',       wrap(store.getPrefs));
ipcMain.handle('mn:setPrefs',       wrap(setPrefsFromIpc));
ipcMain.handle('mn:spellcheck',     wrap(spellcheckWords));

// Search / backlinks / tags (SQLite-backed)
ipcMain.handle('mn:search',         wrap((vaultId, query, limit) => idx.search(vaultId, query, limit)));
ipcMain.handle('mn:searchDetailed', wrap(async (vaultId, query, limit) => {
  const hits = idx.search(vaultId, query, limit);
  const vault = await store.loadVault(vaultId);
  const byId = new Map((vault.notes || []).map(note => [note.id, note]));
  const q = String(query || '').trim().toLowerCase();
  return hits.map(hit => {
    const note = byId.get(hit.id) || {};
    const fields = [];
    if (String(note.title || '').toLowerCase().includes(q)) fields.push('title');
    if ((note.tags || []).some(tag => String(tag).toLowerCase().includes(q))) fields.push('tags');
    if (String(note.body || '').toLowerCase().includes(q)) fields.push('body');
    return {
      ...hit,
      snippet: hit.snippet || String(note.body || '').slice(0, 180),
      matchedFields: fields.length ? fields : ['body'],
      tags: note.tags || [],
      modifiedAt: note.modifiedAt || null,
      date: note.date || null,
      pinned: !!note.pinned,
    };
  });
}));
ipcMain.handle('mn:backlinks',      wrap((vaultId, title) => idx.backlinks(vaultId, title)));
ipcMain.handle('mn:notesByTag',     wrap((vaultId, tag) => idx.notesByTag(vaultId, tag)));
ipcMain.handle('mn:tagCounts',      wrap((vaultId) => idx.tagCounts(vaultId)));
ipcMain.handle('mn:rebuildIndex',   wrap(async (vaultId) => {
  const vault = await store.loadVault(vaultId);
  idx.rescanVault(vaultId, vault.notes || []);
  return { indexed: vault.notes?.length || 0 };
}));
ipcMain.handle('mn:vaultHealth',    wrap((vaultId) => store.vaultHealth(vaultId)));
ipcMain.handle('mn:exportBackup',   wrap(async (options = {}) => {
  const payload = await store.exportBackup(options || {});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export VispNote backup',
    defaultPath: `vispnote-backup-${stamp}.vispnote-backup.json`,
    filters: [{ name: 'VispNote Backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.promises.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath, vaultCount: payload.vaults.length };
}));
ipcMain.handle('mn:importBackup',   wrap(async (options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import VispNote backup',
    properties: ['openFile'],
    filters: [{ name: 'VispNote Backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const text = await fs.promises.readFile(result.filePaths[0], 'utf8');
  const imported = await store.importBackup(text, options || {});
  for (const vault of imported.importedVaults || []) {
    const loaded = await store.loadVault(vault.id);
    idx.rescanVault(vault.id, loaded.notes || []);
  }
  return { ...imported, canceled: false, filePath: result.filePaths[0] };
}));

// AI (Ollama)
ipcMain.handle('mn:ai.status',      wrap(() => ai.status()));
ipcMain.handle('mn:ai.connect',     wrap(async () => {
  const result = await ai.connect();
  if (result?.config?.provider === 'ollama') await store.setPrefs({ aiConfig: ai.getConfig() });
  return result;
}));
ipcMain.handle('mn:ai.ask',         wrap((vaultId, query, options) => ai.ask(vaultId, query, store, options || {})));
ipcMain.handle('mn:ai.edit',        wrap((payload) => ai.editText(payload)));
ipcMain.handle('mn:ai.editStream',  async (evt, payload = {}) => {
  try {
    const requestId = String(payload.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const cleanPayload = { ...payload };
    delete cleanPayload.requestId;
    const value = await ai.editTextStream({
      ...cleanPayload,
      onToken: (token) => {
        if (requestId) evt.sender.send(`mn:ai.editStream.chunk:${requestId}`, String(token || ''));
      },
    });
    return { ok: true, value };
  } catch (e) {
    console.error('[ipc]', 'editTextStream', e);
    return { ok: false, error: e.message || String(e) };
  }
});
ipcMain.handle('mn:ai.chat',        wrap((payload) => ai.chat(payload)));
ipcMain.handle('mn:ai.cancel',      wrap((jobId) => ai.cancelJob(jobId)));
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

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (process.platform === 'linux') app.setDesktopName('vispnote.desktop');

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (process.platform === 'darwin') app.dock?.setIcon(createAppIcon());
  try {
    await store.loadConfig();   // ensures the vault folder, seeds on first run
    const prefs = await store.getPrefs();
    if (prefs.aiConfig) {
      try {
        ai.setConfig(prefs.aiConfig, { rejectUnknown: false });
      } catch (e) {
        console.error('saved AI config ignored', e);
      }
    }
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
