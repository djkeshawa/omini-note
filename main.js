// Packaged Windows builds run without a console, so stdout/stderr are pipes
// the OS may close. Without these handlers, any console.log/error write after
// that raises an unhandled EPIPE and crashes the main process with Electron's
// "JavaScript error in the main process" dialog.
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') stream.on('error', () => {});
}

const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, globalShortcut, shell, protocol } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const attachments = require('./lib/attachments');
const linkRename = require('./lib/linkRename');
const exportHtml = require('./lib/exportHtml');
const llmMemory = require('./lib/integrations/memory/client');
const memoryLinks = require('./lib/memoryLinks');
const quitPersistence = require('./lib/quitPersistence');
const featureUsage = require('./lib/integrations/telemetry/featureUsage');
const { createVaultWatcher } = require('./lib/vaultWatcher');
const idx = require('./lib/index');
const ai = require('./lib/ai');
const zotero = require('./lib/integrations/zotero/client');
const { registerNotesVaultHandlers } = require('./lib/ipc/notesVaultHandlers');
const { createNavigationSecurity } = require('./main/navigationSecurity');
const { createNoteExportService } = require('./main/noteExportService');
const { createSpellcheckService } = require('./main/spellcheckService');
const { createWindowSecurity } = require('./main/windowSecurity');
const { createWindowLifecycle } = require('./main/windowLifecycle');
const { createUpdateService } = require('./main/updateService');
const { createIpcRuntime } = require('./main/ipcRuntime');
const { createNovelImportService } = require('./main/novelImportService');
const {
  sanitizeAttachmentPayload,
  sanitizeZoteroSearchPayload,
  sanitizeZoteroListPayload,
  sanitizeZoteroReadPayload,
} = require('./lib/connectors/ipc/payloadValidation');
const { registerWorkspaceHandlers } = require('./lib/connectors/ipc/workspaceHandlers');
const { registerPreferencesHandlers } = require('./lib/connectors/ipc/preferencesHandlers');
const { registerZoteroHandlers } = require('./lib/connectors/ipc/zoteroHandlers');
const { registerWindowHandlers } = require('./lib/connectors/ipc/windowHandlers');
const { registerSearchHandlers } = require('./lib/connectors/ipc/searchHandlers');
const { registerVaultNoteHandlers } = require('./lib/connectors/ipc/vaultNoteHandlers');
const { registerMemoryHandlers } = require('./lib/connectors/ipc/memoryHandlers');
const { registerAiHandlers } = require('./lib/connectors/ipc/aiHandlers');
const { registerBackupHandlers } = require('./lib/connectors/ipc/backupHandlers');
const { createAiIpcService } = require('./lib/connectors/ipc/aiService');
const { createPreferencesService } = require('./lib/connectors/ipc/preferencesService');

let indexReadyPromise = Promise.resolve();
let searchIndexAvailable = false;
let searchIndexError = null;
let memoryConnector = null;
const indexVaultLocks = new Map();
const APP_NAME = 'VispNote';
const APP_ID = 'com.vispnote.app';
const ASSET_PROTOCOL_SCHEME = 'vispnote-asset';
// Must run before app ready so the renderer can load vault images through the
// validated asset protocol instead of raw file:// paths.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_PROTOCOL_SCHEME, privileges: { standard: true, secure: true } },
]);
const APP_ICON_PATH = path.join(__dirname, 'assets', 'vispnote-icon.png');
const { isAllowedAppNavigation, sanitizeExternalUrl } = createNavigationSecurity(
  path.join(__dirname, 'vispnote.html')
);
const { attachEditContextMenu, registerAssetProtocol, hardenWindow } = createWindowSecurity({
  Menu,
  protocol,
  assetScheme: ASSET_PROTOCOL_SCHEME,
  attachments,
  isAllowedAppNavigation,
});
const windowLifecycle = createWindowLifecycle({
  app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, globalShortcut,
  path, rootDir: __dirname, appName: APP_NAME, iconPath: APP_ICON_PATH,
  attachEditContextMenu, hardenWindow, quitPersistence,
});
const updateService = createUpdateService({
  app, autoUpdater, getMainWindow: windowLifecycle.getMainWindow,
});
const noteExportService = createNoteExportService({
  app,
  BrowserWindow,
  fs,
  path,
  store,
  dialog,
  exportHtml,
  attachments,
  getMainWindow: windowLifecycle.getMainWindow,
});
const { spellcheckWords, loadSpellWords } = createSpellcheckService();
const { wrap, wrapWithEvent } = createIpcRuntime();
const INITIAL_UPDATE_CHECK_DELAY_MS = 5000;
const vaultWatcher = process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE === '1'
  ? { refresh() {}, close() {}, markInternal() {} }
  : createVaultWatcher({
    onChange: event => {
      Promise.resolve(indexReadyPromise).then(async () => {
        const data = await store.loadVault(event.vaultId);
        await withIndexVaultLock(event.vaultId, async () => runOptionalSearchIndexTask(
          'rescan externally changed vault',
          () => idx.rescanVault(event.vaultId, data.notes)
        ));
        const noteId = path.basename(event.fileName || '', path.extname(event.fileName || ''));
        const note = data.notes.find(item => item.id === noteId);
        if (note) ai.scheduleEmbed(event.vaultId, note);
      }).catch(error => console.error('external vault refresh failed', event.vaultId, error));
      const win = windowLifecycle.getMainWindow();
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
      win.webContents.send('mn:vaultFilesChanged', event);
    },
  });
const {
  isPlainObject,
  capString,
  capText,
  sanitizePrefsPatchFromIpc,
  AI_QUERY_LIMIT,
  AI_EDIT_TEXT_LIMIT,
  AI_MESSAGE_TEXT_LIMIT,
  AI_MAX_TOKENS_LIMIT,
  AI_TOOL_LIMIT,
  AI_TOOL_SCHEMA_LIMIT,
  BACKUP_IMPORT_FILE_LIMIT,
  NOVEL_IMPORT_FILE_LIMIT,
  NOVEL_IMPORT_FILE_BYTES_LIMIT,
  NOVEL_IMPORT_TOTAL_TEXT_BYTES_LIMIT,
  IPC_ID_RE,
  AI_TOOL_NAME_RE,
} = require('./lib/connectors/ipc/preferenceValidation');

// ── IPC handlers ─────────────────────────────────────────────────────────────

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
    noteSearchIndexFailure(context, e);
    return null;
  }
}

function assertSearchIndexAvailable() {
  if (!searchIndexAvailable) {
    throw new Error(searchIndexError ? `Search index unavailable: ${searchIndexError}` : 'Search index unavailable');
  }
}

const {
  setPrefsFromIpc,
  importThemeFileFromIpc,
  featureUsageStatusFromIpc,
  exportFeatureUsageFromIpc,
  shareFeatureUsageFromIpc,
} = createPreferencesService({
  app,
  fs,
  dialog,
  store,
  ai,
  featureUsage,
  sanitizePrefsPatchFromIpc,
  isPlainObject,
  getMainWindow: windowLifecycle.getMainWindow,
  invalidateMemoryIndexCache: () => memoryConnector?.invalidateCache(),
});

const {
  sanitizeAiAskArgs,
  askFromIpc,
  sendIpcChunk,
  askStreamFromIpc,
  relatedNotesFromIpc,
  sanitizeAiAskOptions,
  prepareAiEditPayload,
  sanitizeAiChatPayload,
  sanitizeAiToolPlanPayload,
} = createAiIpcService({
  store,
  ai,
  getIndexReadyPromise: () => indexReadyPromise,
  assertSearchIndexAvailable,
});

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

const novelImportService = createNovelImportService({
  fs, path, dialog, getMainWindow: windowLifecycle.getMainWindow,
  limits: {
    fileCount: NOVEL_IMPORT_FILE_LIMIT,
    fileBytes: NOVEL_IMPORT_FILE_BYTES_LIMIT,
    totalTextBytes: NOVEL_IMPORT_TOTAL_TEXT_BYTES_LIMIT,
  },
});

registerVaultNoteHandlers(ipcMain, {
  wrap,
  registerNotesVaultHandlers,
  store,
  idx,
  ai,
  linkRename,
  withIndexVaultLock,
  runOptionalSearchIndexTask,
  vaultWatcher,
});

memoryConnector = registerMemoryHandlers(ipcMain, {
  wrap,
  store,
  idx,
  ai,
  llmMemory,
  memoryLinks,
  withIndexVaultLock,
  runOptionalSearchIndexTask,
});

registerWorkspaceHandlers(ipcMain, {
  wrap, store, attachments, sanitizeAttachmentPayload, vaultWatcher,
  withIndexVaultLock, idx, ai, runOptionalSearchIndexTask,
});

registerPreferencesHandlers(ipcMain, {
  wrap, store, ai, setPrefsFromIpc, importThemeFileFromIpc, spellcheckWords,
  featureUsageStatusFromIpc, exportFeatureUsageFromIpc, shareFeatureUsageFromIpc,
});

registerSearchHandlers(ipcMain, {
  wrap,
  idx,
  ai,
  store,
  withIndexVaultLock,
  initializeSearchIndex,
  noteSearchIndexFailure,
  getIndexReadyPromise: () => indexReadyPromise,
  isSearchIndexAvailable: () => searchIndexAvailable,
  getSearchIndexError: () => searchIndexError,
  assertSearchIndexAvailable,
});

registerBackupHandlers(ipcMain, {
  wrap,
  dialog,
  fs,
  store,
  idx,
  getMainWindow: windowLifecycle.getMainWindow,
  runOptionalSearchIndexTask,
  importNovelFilesFromIpc: novelImportService.importFiles,
  exportNote: noteExportService.exportNote,
  backupImportFileLimit: BACKUP_IMPORT_FILE_LIMIT,
});

registerZoteroHandlers(ipcMain, {
  wrap,
  zotero,
  sanitizeSearch: sanitizeZoteroSearchPayload,
  sanitizeList: sanitizeZoteroListPayload,
  sanitizeRead: sanitizeZoteroReadPayload,
});

registerAiHandlers(ipcMain, {
  wrap,
  wrapWithEvent,
  ai,
  store,
  askFromIpc,
  sanitizeAiAskArgs,
  sanitizeAiAskOptions,
  askStreamFromIpc,
  prepareAiEditPayload,
  sanitizeAiChatPayload,
  sanitizeAiToolPlanPayload,
  sendIpcChunk,
  getIndexReadyPromise: () => indexReadyPromise,
  assertSearchIndexAvailable,
  relatedNotesFromIpc,
});

registerWindowHandlers(ipcMain, {
  wrap,
  wrapWithEvent,
  BrowserWindow,
  shell,
  autoUpdater,
  sanitizeExternalUrl,
  getAppInfo: () => ({ platform: process.platform }),
  getShortcutState: windowLifecycle.getShortcutState,
  openDataFolder: async () => {
    await fs.promises.mkdir(store.ROOT, { recursive: true });
    const error = await shell.openPath(store.ROOT);
    if (error) throw new Error('Could not open the VispNote data folder');
    return { opened: true };
  },
  emitUpdateState: updateService.emitState,
  checkForUpdates: updateService.check,
  getUpdateState: updateService.getState,
});

async function rescanAllVaults() {
  if (!searchIndexAvailable) return;
  const cfg = await store.loadConfig();
  await Promise.all((cfg.vaults || []).map(async (v) => {
    try {
      const data = await store.loadVault(v.id);
      runOptionalSearchIndexTask('boot vault rescan', () => idx.rescanVault(v.id, data.notes));
    } catch (e) {
      console.error('rescan failed for vault', v.id, e);
    }
  }));
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (process.platform === 'linux') app.setDesktopName('vispnote.desktop');

const singleInstanceBypassForAutomation = process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE === '1'
  && process.argv.some(arg => /scripts[\\/]+(?:smoke|regression|ai-regression)-electron\.js$/.test(arg));
const singleInstanceLock = singleInstanceBypassForAutomation
  ? true
  : app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowLifecycle.showMainWindow();
  });
}

if (singleInstanceLock) app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  updateService.configure();
  if (process.platform === 'darwin') app.dock?.setIcon(windowLifecycle.createAppIcon());
  try {
    await store.loadConfig();   // ensures the vault folder, seeds on first run
    vaultWatcher.refresh(await store.listVaults());
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
  }
  initializeSearchIndex();      // opens / creates the local search index
  registerAssetProtocol();
  windowLifecycle.createTray();
  windowLifecycle.createWindow();
  indexReadyPromise = rescanAllVaults().catch(e => {
    console.error('boot index rescan failed', e);
  });
  windowLifecycle.registerQuickCaptureShortcut();
  setTimeout(() => { updateService.check(false).catch(e => console.error('update check failed', e)); }, INITIAL_UPDATE_CHECK_DELAY_MS);

  app.on('activate', () => {
    windowLifecycle.showMainWindow();
  });
});

app.on('before-quit', () => {
  windowLifecycle.beginQuit();
});

app.on('window-all-closed', () => {
  if (!windowLifecycle.getTray() && process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  vaultWatcher.close();
  idx.close();
});
