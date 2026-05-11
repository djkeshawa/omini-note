const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, globalShortcut, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const store = require('./lib/store');
const idx = require('./lib/index');
const ai = require('./lib/ai');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let flushBeforeCloseSeq = 0;
let quickCaptureShortcutState = {
  accelerator: null,
  registered: false,
  error: null,
};
let indexReadyPromise = Promise.resolve();
let searchIndexAvailable = false;
let searchIndexError = null;
const indexVaultLocks = new Map();
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  lastCheckedAt: null,
  error: null,
  updateInfo: null,
  downloaded: false,
  manualUrl: 'https://github.com/djkeshawa/visp-note/releases/latest',
};
const APP_NAME = 'VispNote';
const APP_ID = 'com.vispnote.app';
const APP_ICON_PATH = path.join(__dirname, 'assets', 'vispnote-icon.png');
const SPELL_DICTIONARY_PATHS = [
  '/usr/share/dict/american-english',
  '/usr/share/dict/british-english',
  '/usr/share/hunspell/en_US.dic',
  '/usr/share/hunspell/en_GB.dic',
];
const SPELL_SUGGESTION_CACHE_LIMIT = 1000;
let spellWords = null;
let spellWordsPromise = null;
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
const PREF_TOP_LEVEL_KEYS = new Set(['activeVaultId', 'tweaks', 'aiConfig']);
const PREF_TWEAK_DEFAULTS = {
  theme: 'light',
  density: 'comfortable',
  graphStyle: 'force',
  todoVariant: 'list',
  toastVariant: 'card',
  fontChoice: 'Editorial (Newsreader + Inter)',
  showNoteList: true,
  showSidebar: true,
  editorWidth: 'medium',
  fontSize: 'default',
  appFontSize: 'default',
  indentGuides: true,
  spellCheck: true,
  autoLink: true,
  collapseByDefault: false,
  sortBy: 'modified',
  defaultTags: '',
  pinnedFirst: true,
  rollupFormat: 'long',
  reminderSound: false,
  showOverdue: true,
  snoozeMinutes: '15',
  weekStart: 'monday',
  workflowStates: null,
  plugins: null,
  autoSave: true,
  storageFormat: 'markdown',
  sync: 'local',
};
const PREF_TWEAK_KEYS = new Set(Object.keys(PREF_TWEAK_DEFAULTS));
const PREF_STRING_LIMIT = 500;
const PREF_SECRET_LIMIT = 4096;
const AI_QUERY_LIMIT = 20000;
const AI_EDIT_TEXT_LIMIT = 120000;
const AI_MESSAGE_TEXT_LIMIT = 20000;
const AI_MAX_TOKENS_LIMIT = 8192;
const BACKUP_IMPORT_FILE_LIMIT = 50 * 1024 * 1024;
const IPC_ID_RE = /^[A-Za-z0-9_-]+$/;

function normalizeSpellWord(word) {
  return String(word || '').toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function capString(value, field, maxLength = PREF_STRING_LIMIT) {
  const clean = String(value || '').replace(/\0/g, '').trim();
  if (clean.length > maxLength) throw new Error(`${field} is too long`);
  return clean;
}

function capText(value, field, maxLength) {
  const clean = String(value || '').replace(/\0/g, '');
  if (clean.length > maxLength) throw new Error(`${field} is too long`);
  return clean;
}

function sanitizeWorkflowStatesForPrefs(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid workflowStates preference');
  return value.map((state, index) => {
    if (!isPlainObject(state)) throw new Error('Invalid workflowStates preference');
    return {
      id: capString(state.id, `workflowStates[${index}].id`, 40),
      next: state.next == null ? null : capString(state.next, `workflowStates[${index}].next`, 40),
      color: capString(state.color, `workflowStates[${index}].color`, 120),
      bg: capString(state.bg, `workflowStates[${index}].bg`, 120),
    };
  });
}

function sanitizePluginsForPrefs(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid plugins preference');
  return value.map((plugin, index) => {
    if (!isPlainObject(plugin)) throw new Error('Invalid plugin preference');
    const config = isPlainObject(plugin.config) ? plugin.config : {};
    const type = capString(plugin.type, `plugins[${index}].type`, 40);
    if (!['note-template', 'quick-capture', 'open-url'].includes(type)) throw new Error('Invalid plugin type');
    return {
      id: capString(plugin.id, `plugins[${index}].id`, 80),
      name: capString(plugin.name, `plugins[${index}].name`, 80),
      purpose: capString(plugin.purpose, `plugins[${index}].purpose`, 180),
      type,
      enabled: plugin.enabled !== false,
      config: {
        title: capString(config.title, `plugins[${index}].config.title`, 160),
        body: capString(config.body, `plugins[${index}].config.body`, 4000),
        tags: capString(config.tags, `plugins[${index}].config.tags`, 240),
        url: capString(config.url, `plugins[${index}].config.url`, 500),
      },
    };
  });
}

function sanitizeTweaksForPrefs(tweaks) {
  if (!isPlainObject(tweaks)) throw new Error('Invalid tweaks patch');
  const clean = {};
  for (const [key, value] of Object.entries(tweaks)) {
    if (!PREF_TWEAK_KEYS.has(key)) throw new Error('Unsupported tweak field: ' + key);
    const defaultValue = PREF_TWEAK_DEFAULTS[key];
    if (key === 'workflowStates') {
      clean.workflowStates = sanitizeWorkflowStatesForPrefs(value);
    } else if (key === 'plugins') {
      clean.plugins = sanitizePluginsForPrefs(value);
    } else if (typeof defaultValue === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('Invalid tweak field: ' + key);
      clean[key] = value;
    } else if (typeof defaultValue === 'string') {
      clean[key] = capString(value, key);
    } else if (defaultValue == null) {
      clean[key] = value == null ? null : value;
    }
  }
  return clean;
}

function sanitizeAiConfigForPrefs(aiConfig) {
  if (!isPlainObject(aiConfig)) throw new Error('Invalid AI config patch');
  const clean = {};
  for (const [key, value] of Object.entries(aiConfig)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('Invalid AI config field: ' + key);
    if (typeof value === 'string') clean[key] = capString(value, key, PREF_SECRET_LIMIT);
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) clean[key] = value;
    else throw new Error('Invalid AI config field: ' + key);
  }
  return clean;
}

function sanitizePrefsPatchFromIpc(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid preferences patch');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!PREF_TOP_LEVEL_KEYS.has(key)) throw new Error('Unsupported preferences field: ' + key);
    if (key === 'activeVaultId') clean.activeVaultId = capString(value, 'activeVaultId', 120);
    if (key === 'tweaks') clean.tweaks = sanitizeTweaksForPrefs(value);
    if (key === 'aiConfig') clean.aiConfig = sanitizeAiConfigForPrefs(value);
  }
  return clean;
}

async function loadSpellWords() {
  if (spellWords) return spellWords;
  if (spellWordsPromise) return await spellWordsPromise;
  spellWordsPromise = loadSpellWordsFromDisk();
  return await spellWordsPromise;
}

async function loadSpellWordsFromDisk() {
  const words = new Set();
  let loadedDictionaryWords = 0;
  for (const file of SPELL_DICTIONARY_PATHS) {
    try {
      const lines = (await fs.promises.readFile(file, 'utf8')).split(/\r?\n/);
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
  if (spellSuggestionCache.size >= SPELL_SUGGESTION_CACHE_LIMIT) {
    const oldest = spellSuggestionCache.keys().next().value;
    spellSuggestionCache.delete(oldest);
  }
  spellSuggestionCache.set(word, suggestions);
  return suggestions;
}

async function spellcheckWords(inputWords = []) {
  const dictionary = await loadSpellWords();
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

// Bring the window forward and tell the renderer to open Quick Capture.
// Routed through IPC because the renderer owns its modal stack and undo
// history; the main process stays focused on lifecycle and OS hooks.
function openQuickCaptureFromShortcut() {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mn:openQuickCapture');
    }
  };
  if (mainWindow.webContents.isLoading()) {
    const clear = () => mainWindow?.webContents?.removeListener?.('did-finish-load', send);
    mainWindow.once('closed', clear);
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function linuxUpdaterMode() {
  if (process.platform !== 'linux') return 'native';
  return process.env.APPIMAGE ? 'appimage' : 'manual';
}

function emitUpdateState(patch = {}) {
  updateState = {
    ...updateState,
    ...patch,
    currentVersion: app.getVersion(),
    linuxMode: linuxUpdaterMode(),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mn:updates.state', updateState);
  }
  return updateState;
}

function configureUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => emitUpdateState({
    status: 'checking',
    lastCheckedAt: new Date().toISOString(),
    error: null,
  }));
  autoUpdater.on('update-available', info => emitUpdateState({
    status: 'available',
    updateInfo: info || null,
    downloaded: false,
  }));
  autoUpdater.on('update-not-available', info => emitUpdateState({
    status: 'not-available',
    updateInfo: info || null,
    downloaded: false,
  }));
  autoUpdater.on('update-downloaded', info => emitUpdateState({
    status: 'downloaded',
    updateInfo: info || null,
    downloaded: true,
  }));
  autoUpdater.on('error', error => emitUpdateState({
    status: 'error',
    error: error?.message || String(error),
  }));
}

async function checkForUpdates(manual = false) {
  const mode = linuxUpdaterMode();
  if (!app.isPackaged || mode === 'manual' || process.platform === 'darwin') {
    return emitUpdateState({
      status: mode === 'manual' || process.platform === 'darwin' ? 'manual' : 'not-available',
      lastCheckedAt: new Date().toISOString(),
      error: process.platform === 'darwin' && app.isPackaged ? 'Automatic updates are disabled for unsigned macOS builds.' : null,
      updateInfo: null,
    });
  }
  emitUpdateState({ status: 'checking', lastCheckedAt: new Date().toISOString(), error: null });
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    emitUpdateState({ status: 'error', error: e?.message || String(e) });
  }
  return updateState;
}

const QUICK_CAPTURE_SHORTCUT = process.platform === 'darwin'
  ? 'Cmd+Shift+N'
  : 'Ctrl+Shift+N';

function registerQuickCaptureShortcut() {
  // globalShortcut may fail (already-registered, no display server). The app
  // still works without it — capture stays available via the in-app button.
  try {
    if (!globalShortcut.register(QUICK_CAPTURE_SHORTCUT, openQuickCaptureFromShortcut)) {
      quickCaptureShortcutState = { accelerator: QUICK_CAPTURE_SHORTCUT, registered: false, error: 'Shortcut is already in use or unavailable.' };
      console.warn('quick capture shortcut not registered:', QUICK_CAPTURE_SHORTCUT);
      return;
    }
    quickCaptureShortcutState = { accelerator: QUICK_CAPTURE_SHORTCUT, registered: true, error: null };
  } catch (e) {
    quickCaptureShortcutState = { accelerator: QUICK_CAPTURE_SHORTCUT, registered: false, error: e?.message || String(e) };
    console.error('quick capture shortcut registration failed', e);
  }
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
    if (target.protocol !== 'file:') return false;
    const appPath = fs.realpathSync(path.join(__dirname, 'vispnote.html'));
    const targetPath = fs.realpathSync(fileURLToPath(target));
    return targetPath === appPath;
  } catch (e) {
    return false;
  }
}

function sanitizeExternalUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value || value.length > 2048) throw new Error('Invalid external URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    throw new Error('Invalid external URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
    throw new Error('Unsupported external URL protocol');
  }
  if (parsed.protocol === 'mailto:') {
    if (/[\r\n\x00-\x1f\x7f]/.test(value) || /%0d|%0a/i.test(value)) throw new Error('Invalid external URL');
    const address = decodeURIComponent(parsed.pathname || '').trim();
    if (!address || /\s/.test(address) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error('Invalid mailto URL');
  }
  return parsed.href;
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
      sandbox: true,
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
  spellSession.setSpellCheckerLanguages([spellLanguage || 'en-US']);

  win.loadFile(path.join(__dirname, 'vispnote.html'));
  mainWindow = win;
  attachEditContextMenu(win);

  win.on('close', (event) => {
    if (isQuitting) {
      if (win.__vispnoteFlushComplete) return;
      event.preventDefault();
      if (win.__vispnoteFlushInProgress) return;
      win.__vispnoteFlushInProgress = true;
      flushRendererDirtyNotes(win).finally(() => {
        win.__vispnoteFlushComplete = true;
        win.__vispnoteFlushInProgress = false;
        if (!win.isDestroyed()) win.close();
        setImmediate(() => {
          if (isQuitting) app.quit();
        });
      });
      return;
    }
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

function flushRendererDirtyNotes(win, timeoutMs = 3500) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve({ ok: true, skipped: true });
  const requestId = `flush_${Date.now().toString(36)}_${++flushBeforeCloseSeq}`;
  return new Promise(resolve => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('mn:flushDirtyNotesResult', onResult);
      resolve(result || { ok: true });
    };
    const onResult = (_event, id, result) => {
      if (id === requestId) finish(result);
    };
    const timer = setTimeout(() => {
      console.warn('timed out waiting for renderer dirty-note flush');
      finish({ ok: false, error: 'Timed out waiting for dirty-note flush' });
    }, timeoutMs);
    ipcMain.on('mn:flushDirtyNotesResult', onResult);
    try {
      win.webContents.send('mn:flushDirtyNotes', requestId);
    } catch (e) {
      finish({ ok: false, error: e?.message || String(e) });
    }
  });
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

function ipcErrorResponse(name, e) {
  console.error('[ipc]', name, e);
  return {
    ok: false,
    error: e.message || String(e),
    code: e.code || null,
    currentModifiedAt: e.currentModifiedAt || null,
    expectedModifiedAt: e.expectedModifiedAt || null,
  };
}

function wrap(fn) {
  return async (_evt, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return ipcErrorResponse(fn.name, e);
    }
  };
}

function wrapWithEvent(fn) {
  return async (evt, ...args) => {
    try {
      return { ok: true, value: await fn(evt, ...args) };
    } catch (e) {
      return ipcErrorResponse(fn.name, e);
    }
  };
}

function noteSearchIndexFailure(context, error) {
  searchIndexAvailable = false;
  searchIndexError = error?.message || String(error);
  console.error(`[search-index] ${context} failed`, error);
}

function initializeSearchIndex() {
  try {
    idx.init();
    searchIndexAvailable = true;
    searchIndexError = null;
    return true;
  } catch (e) {
    noteSearchIndexFailure('init', e);
    return false;
  }
}

function runOptionalSearchIndexTask(context, fn) {
  if (!searchIndexAvailable) return null;
  try {
    return fn();
  } catch (e) {
    console.error(`[search-index] ${context} failed`, e);
    return null;
  }
}

function assertSearchIndexAvailable() {
  if (!searchIndexAvailable) {
    throw new Error(searchIndexError ? `Search index unavailable: ${searchIndexError}` : 'Search index unavailable');
  }
}

async function setPrefsFromIpc(patch) {
  const cleanPatch = sanitizePrefsPatchFromIpc(patch);
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'aiConfig')) {
    const config = ai.previewConfig(cleanPatch.aiConfig);
    await store.setPrefs({ ...cleanPatch, aiConfig: config });
    ai.applyConfig(config);
    return config;
  }
  return await store.setPrefs(cleanPatch);
}

async function sanitizeAiAskArgs(vaultId, query) {
  const cleanVaultId = String(vaultId || '').trim();
  if (!IPC_ID_RE.test(cleanVaultId)) throw new Error('Invalid vault id');
  const cleanQuery = String(query || '');
  if (!cleanQuery.trim()) throw new Error('AI query is empty');
  if (cleanQuery.length > AI_QUERY_LIMIT) throw new Error('AI query is too long');
  const cfg = await store.loadConfig();
  if (!cfg.vaults?.some(v => v.id === cleanVaultId)) throw new Error('Vault not found: ' + cleanVaultId);
  return { vaultId: cleanVaultId, query: cleanQuery };
}

async function askFromIpc(vaultId, query, options) {
  const clean = await sanitizeAiAskArgs(vaultId, query);
  return ai.ask(clean.vaultId, clean.query, store, sanitizeAiAskOptions(options || {}));
}

function sendIpcChunk(evt, requestId, channel, token) {
  if (!requestId || evt.sender?.isDestroyed?.()) return;
  try {
    evt.sender.send(`${channel}:${requestId}`, String(token || ''));
  } catch (e) {
    console.warn(`${channel} chunk delivery failed`, e?.message || String(e));
  }
}

async function withIndexVaultLock(vaultId, fn) {
  const key = String(vaultId || '');
  const previous = indexVaultLocks.get(key) || Promise.resolve();
  let release;
  const current = previous.catch(() => {}).then(() => new Promise(resolve => { release = resolve; }));
  indexVaultLocks.set(key, current);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (indexVaultLocks.get(key) === current) indexVaultLocks.delete(key);
  }
}

async function askStreamFromIpc(evt, vaultId, query, options = {}) {
  const clean = await sanitizeAiAskArgs(vaultId, query);
  const requestId = String(options.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const cleanOptions = sanitizeAiAskOptions(options || {});
  return await ai.askStream(clean.vaultId, clean.query, store, {
    ...cleanOptions,
    onToken: (token) => {
      sendIpcChunk(evt, requestId, 'mn:ai.askStream.chunk', token);
    },
  });
}

function sanitizeAiJobId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || undefined;
}

function sanitizeAiMaxTokens(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(128, Math.min(AI_MAX_TOKENS_LIMIT, Math.round(n))) : undefined;
}

function sanitizeAiAskOptions(options = {}) {
  return {
    jobId: sanitizeAiJobId(options.jobId),
    recursiveResearch: options.recursiveResearch === true,
  };
}

function sanitizeAiEditPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid AI edit payload');
  const clean = {
    text: capText(payload.text, 'text', AI_EDIT_TEXT_LIMIT),
    instruction: capString(payload.instruction || 'Improve the writing.', 'instruction', 4000),
    scope: capString(payload.scope || 'text', 'scope', 120),
    jobId: sanitizeAiJobId(payload.jobId),
  };
  if (payload.vaultId != null && payload.vaultId !== '') {
    const vaultId = capString(payload.vaultId, 'vaultId', 120);
    if (!IPC_ID_RE.test(vaultId)) throw new Error('Invalid vault id');
    clean.vaultId = vaultId;
  }
  clean.useNovelistConfig = payload.useNovelistConfig === true;
  return clean;
}

async function prepareAiEditPayload(payload = {}) {
  const clean = sanitizeAiEditPayload(payload);
  if (!clean.useNovelistConfig || !clean.vaultId) return clean;
  const vault = await store.loadVault(clean.vaultId);
  const config = isPlainObject(vault?.novelistAiConfig) ? vault.novelistAiConfig : null;
  if (!config) return clean;
  const advanced = isPlainObject(config.advanced) ? config.advanced : {};
  const maxTokens = sanitizeAiMaxTokens(advanced.maxTokens);
  return {
    ...clean,
    systemMessage: config.systemMessage ? capString(config.systemMessage, 'systemMessage', 12000) : '',
    model: config.model ? capString(config.model, 'model', 120) : '',
    maxTokens,
  };
}

function sanitizeAiChatPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid AI chat payload');
  const clean = {
    jobId: sanitizeAiJobId(payload.jobId),
  };
  if (Array.isArray(payload.messages)) {
    clean.messages = payload.messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .slice(-8)
      .map(m => ({ role: m.role, content: capText(m.content, 'message', AI_MESSAGE_TEXT_LIMIT) }))
      .filter(m => m.content.trim());
  } else {
    clean.text = capText(payload.text || '', 'text', AI_MESSAGE_TEXT_LIMIT);
  }
  return clean;
}

// Vault management
ipcMain.handle('mn:listVaults',     wrap(store.listVaults));
ipcMain.handle('mn:createVault',    wrap(async (name, options) => {
  const v = await store.createVault(name, options);
  // Index the seeded welcome note
  const data = await store.loadVault(v.id);
  await withIndexVaultLock(v.id, async () => runOptionalSearchIndexTask('rescan created vault', () => idx.rescanVault(v.id, data.notes)));
  return v;
}));
ipcMain.handle('mn:renameVault',    wrap(store.renameVault));
ipcMain.handle('mn:deleteVault',    wrap(async (vaultId) => {
  return await withIndexVaultLock(vaultId, async () => {
    const result = await store.deleteVault(vaultId);
    runOptionalSearchIndexTask('remove vault from index', () => idx.removeVault(vaultId));
    return result;
  });
}));
ipcMain.handle('mn:setActiveVault', wrap(store.setActiveVault));

// Notes
ipcMain.handle('mn:loadVault',      wrap(store.loadVault));
ipcMain.handle('mn:saveNote',       wrap(async (vaultId, note, options) => {
  return await withIndexVaultLock(vaultId, async () => {
    const saved = await store.saveNote(vaultId, note, options || {});
    const indexed = runOptionalSearchIndexTask('index note', () => idx.indexNote(vaultId, saved));
    if (indexed !== null) ai.scheduleEmbed(vaultId, saved);  // fire-and-forget; no-op if Ollama down
    return saved;
  });
}));
ipcMain.handle('mn:deleteNote',     wrap(async (vaultId, noteId, noteSnapshot) => {
  return await withIndexVaultLock(vaultId, async () => {
    const result = await store.deleteNote(vaultId, noteId, noteSnapshot);
    runOptionalSearchIndexTask('remove note from index', () => idx.removeNote(vaultId, noteId));
    return result;
  });
}));
ipcMain.handle('mn:listDeletedNotes', wrap(store.listDeletedNotes));
ipcMain.handle('mn:restoreDeletedNote', wrap(async (vaultId, trashId) => {
  return await withIndexVaultLock(vaultId, async () => {
    const note = await store.restoreDeletedNote(vaultId, trashId);
    const indexed = runOptionalSearchIndexTask('index restored note', () => idx.indexNote(vaultId, note));
    if (indexed !== null) ai.scheduleEmbed(vaultId, note);
    return note;
  });
}));
ipcMain.handle('mn:purgeDeletedNote', wrap(store.purgeDeletedNote));
ipcMain.handle('mn:listNoteVersions', wrap(store.listNoteVersions));
ipcMain.handle('mn:restoreNoteVersion', wrap(async (vaultId, noteId, versionId) => {
  return await withIndexVaultLock(vaultId, async () => {
    const note = await store.restoreNoteVersion(vaultId, noteId, versionId);
    const indexed = runOptionalSearchIndexTask('index restored note version', () => idx.indexNote(vaultId, note));
    if (indexed !== null) ai.scheduleEmbed(vaultId, note);
    return note;
  });
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
ipcMain.handle('mn:search',         wrap(async (vaultId, query, limit) => { await indexReadyPromise; assertSearchIndexAvailable(); return idx.search(vaultId, query, limit); }));
ipcMain.handle('mn:searchDetailed', wrap(async (vaultId, query, limit) => { await indexReadyPromise; assertSearchIndexAvailable(); return idx.searchDetailed(vaultId, query, limit); }));
ipcMain.handle('mn:searchDetailedStatus', wrap(async (vaultId, query, limit) => { await indexReadyPromise; if (!searchIndexAvailable) return { ok: false, results: [], error: searchIndexError || 'Search index unavailable' }; return idx.searchDetailedStatus(vaultId, query, limit); }));
ipcMain.handle('mn:backlinks',      wrap(async (vaultId, title, limit) => { await indexReadyPromise; assertSearchIndexAvailable(); return idx.backlinks(vaultId, title, limit); }));
ipcMain.handle('mn:notesByTag',     wrap(async (vaultId, tag) => { await indexReadyPromise; assertSearchIndexAvailable(); return idx.notesByTag(vaultId, tag); }));
ipcMain.handle('mn:tagCounts',      wrap(async (vaultId) => { await indexReadyPromise; assertSearchIndexAvailable(); return idx.tagCounts(vaultId); }));
ipcMain.handle('mn:rebuildIndex',   wrap(async (vaultId) => {
  return await withIndexVaultLock(vaultId, async () => {
    if (!searchIndexAvailable && !initializeSearchIndex()) assertSearchIndexAvailable();
    const vault = await store.loadVault(vaultId);
    idx.rescanVault(vaultId, vault.notes || []);
    return { indexed: vault.notes?.length || 0 };
  });
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
  try {
    const targetStat = await fs.promises.lstat(result.filePath);
    if (targetStat.isSymbolicLink()) throw new Error('Backup export target cannot be a symlink');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const backupText = JSON.stringify(payload, null, 2);
  await store.atomicWriteFile(result.filePath, backupText, 'utf8');
  return { canceled: false, filePath: result.filePath, vaultCount: payload.vaults.length };
}));
ipcMain.handle('mn:importBackup',   wrap(async (options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import VispNote backup',
    properties: ['openFile'],
    filters: [{ name: 'VispNote Backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const importStat = await fs.promises.lstat(result.filePaths[0]);
  if (importStat.isSymbolicLink()) throw new Error('Backup import file cannot be a symlink');
  if (importStat.size > BACKUP_IMPORT_FILE_LIMIT) throw new Error('Backup file is too large');
  const text = await fs.promises.readFile(result.filePaths[0], 'utf8');
  const imported = await store.importBackup(text, options || {});
  for (const vault of imported.importedVaults || []) {
    const loaded = await store.loadVault(vault.id);
    runOptionalSearchIndexTask('rescan imported vault', () => idx.rescanVault(vault.id, loaded.notes || []));
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
ipcMain.handle('mn:ai.ask',         wrap(askFromIpc));
ipcMain.handle('mn:ai.askStream',   wrapWithEvent(askStreamFromIpc));
ipcMain.handle('mn:ai.edit',        wrap(async (payload) => ai.editText(await prepareAiEditPayload(payload))));
ipcMain.handle('mn:ai.editStream', wrapWithEvent(async function editTextStream(evt, payload = {}) {
  const requestId = String(payload.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const cleanPayload = await prepareAiEditPayload(payload);
  return await ai.editTextStream({
    ...cleanPayload,
    onToken: (token) => {
      sendIpcChunk(evt, requestId, 'mn:ai.editStream.chunk', token);
    },
  });
}));
ipcMain.handle('mn:ai.chat',        wrap((payload) => ai.chat(sanitizeAiChatPayload(payload))));
ipcMain.handle('mn:ai.chatStream', wrapWithEvent(async function chatStream(evt, payload = {}) {
  const requestId = String(payload.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const cleanPayload = sanitizeAiChatPayload(payload);
  return await ai.chatStream({
    ...cleanPayload,
    onToken: (token) => {
      sendIpcChunk(evt, requestId, 'mn:ai.chatStream.chunk', token);
    },
  });
}));
ipcMain.handle('mn:ai.cancel',      wrap((jobId) => ai.cancelJob(jobId)));
ipcMain.handle('mn:ai.backfill',    wrap((vaultId) => ai.backfillVault(vaultId, store)));
ipcMain.handle('mn:ai.related',     wrap(async (vaultId, noteId, options) => { await indexReadyPromise; assertSearchIndexAvailable(); return ai.relatedNotes(vaultId, noteId, store, options || {}); }));
ipcMain.handle('mn:ai.getConfig',   wrap(() => ai.getConfig()));
ipcMain.handle('mn:ai.setConfig',   wrap(async (patch) => {
  const config = ai.previewConfig(patch);
  await store.setPrefs({ aiConfig: config });
  ai.applyConfig(config);
  return config;
}));

// Window
ipcMain.handle('mn:setTitle', wrapWithEvent((evt, title) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (win && typeof title === 'string') win.setTitle(title);
}));
ipcMain.handle('mn:openExternal', wrap((url) => shell.openExternal(sanitizeExternalUrl(url))));
ipcMain.handle('mn:shortcutStatus', wrap(() => quickCaptureShortcutState));
ipcMain.handle('mn:updates.status', wrap(() => emitUpdateState()));
ipcMain.handle('mn:updates.check', wrap(() => checkForUpdates(true)));
ipcMain.handle('mn:updates.install', wrap(() => {
  if (!updateState.downloaded) throw new Error('No downloaded update is ready to install');
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
}));

// ── Boot scan: populate the index from disk ──────────────────────────────────

async function rescanAllVaults() {
  if (!searchIndexAvailable) return;
  const cfg = await store.loadConfig();
  for (const v of cfg.vaults) {
    try {
      const data = await store.loadVault(v.id);
      runOptionalSearchIndexTask('boot vault rescan', () => idx.rescanVault(v.id, data.notes));
    } catch (e) {
      console.error('rescan failed for vault', v.id, e);
    }
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (process.platform === 'linux') app.setDesktopName('vispnote.desktop');

const singleInstanceBypassForSmoke = process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE === '1'
  && process.argv.some(arg => /scripts[\\/]+smoke-electron\.js$/.test(arg));
const singleInstanceLock = singleInstanceBypassForSmoke
  ? true
  : app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

if (singleInstanceLock) app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  configureUpdates();
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
    loadSpellWords().catch(e => console.error('spell dictionary preload failed', e));
  } catch (e) {
    console.error('boot init failed', e);
    dialog.showErrorBox('VispNote failed to initialize', e?.message || String(e));
  }
  initializeSearchIndex();      // opens / creates the local search index
  createTray();
  createWindow();
  indexReadyPromise = rescanAllVaults().catch(e => {
    console.error('boot index rescan failed', e);
  });
  registerQuickCaptureShortcut();
  setTimeout(() => { checkForUpdates(false).catch(e => console.error('update check failed', e)); }, 5000);

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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  idx.close();
});
