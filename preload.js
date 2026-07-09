// Preload: exposes a safe IPC bridge as window.mn for the renderer.
const { contextBridge, ipcRenderer } = require('electron');

const NOTES_VAULTS_CHANNELS = Object.freeze({
  noteList: 'vispnote:v1:note:list',
  noteOpen: 'vispnote:v1:note:open',
  noteSave: 'vispnote:v1:note:save',
  noteDelete: 'vispnote:v1:note:delete',
  vaultList: 'vispnote:v1:vault:list',
  vaultCreate: 'vispnote:v1:vault:create',
  vaultRename: 'vispnote:v1:vault:rename',
  vaultDelete: 'vispnote:v1:vault:delete',
  vaultSelect: 'vispnote:v1:vault:select',
});

function requestId(prefix) {
  const crypto = globalThis.crypto;
  const id = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

contextBridge.exposeInMainWorld('mn', {
  // Vaults
  notesVaults: {
    listNotes: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.noteList, payload),
    openNote: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.noteOpen, payload),
    saveNote: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.noteSave, payload),
    deleteNote: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.noteDelete, payload),
    listVaults: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.vaultList, payload),
    createVault: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.vaultCreate, payload),
    renameVault: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.vaultRename, payload),
    deleteVault: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.vaultDelete, payload),
    selectVault: (payload = {}) => ipcRenderer.invoke(NOTES_VAULTS_CHANNELS.vaultSelect, payload),
  },
  listVaults: () => ipcRenderer.invoke('mn:listVaults'),
  createVault: (name, options) => ipcRenderer.invoke('mn:createVault', name, options),
  renameVault: (id, name) => ipcRenderer.invoke('mn:renameVault', id, name),
  deleteVault: (id) => ipcRenderer.invoke('mn:deleteVault', id),
  setActiveVault: (id) => ipcRenderer.invoke('mn:setActiveVault', id),

  // Notes
  loadVault: (vaultId) => ipcRenderer.invoke('mn:loadVault', vaultId),
  saveNote: (vaultId, note, options) => ipcRenderer.invoke('mn:saveNote', vaultId, note, options),
  deleteNote: (vaultId, noteId, noteSnapshot) => ipcRenderer.invoke('mn:deleteNote', vaultId, noteId, noteSnapshot),
  saveAttachment: (vaultId, payload) => ipcRenderer.invoke('mn:saveAttachment', vaultId, payload),
  listDeletedNotes: (vaultId) => ipcRenderer.invoke('mn:listDeletedNotes', vaultId),
  restoreDeletedNote: (vaultId, trashId) => ipcRenderer.invoke('mn:restoreDeletedNote', vaultId, trashId),
  purgeDeletedNote: (vaultId, trashId) => ipcRenderer.invoke('mn:purgeDeletedNote', vaultId, trashId),
  listNoteVersions: (vaultId, noteId) => ipcRenderer.invoke('mn:listNoteVersions', vaultId, noteId),
  restoreNoteVersion: (vaultId, noteId, versionId) => ipcRenderer.invoke('mn:restoreNoteVersion', vaultId, noteId, versionId),
  listCanvases: (vaultId) => ipcRenderer.invoke('mn:listCanvases', vaultId),
  getCanvas: (vaultId, canvasId) => ipcRenderer.invoke('mn:getCanvas', vaultId, canvasId),
  saveCanvas: (vaultId, canvas) => ipcRenderer.invoke('mn:saveCanvas', vaultId, canvas),
  deleteCanvas: (vaultId, canvasId) => ipcRenderer.invoke('mn:deleteCanvas', vaultId, canvasId),
  listDeletedCanvases: (vaultId) => ipcRenderer.invoke('mn:listDeletedCanvases', vaultId),
  restoreDeletedCanvas: (vaultId, trashId) => ipcRenderer.invoke('mn:restoreDeletedCanvas', vaultId, trashId),
  purgeDeletedCanvas: (vaultId, trashId) => ipcRenderer.invoke('mn:purgeDeletedCanvas', vaultId, trashId),
  saveVaultMeta: (vaultId, patch) => ipcRenderer.invoke('mn:saveVaultMeta', vaultId, patch),

  // Prefs
  getPrefs: () => ipcRenderer.invoke('mn:getPrefs'),
  setPrefs: (patch) => ipcRenderer.invoke('mn:setPrefs', patch),
  importThemeFile: () => ipcRenderer.invoke('mn:importThemeFile'),
  spellcheck: (words) => ipcRenderer.invoke('mn:spellcheck', words),

  // Search / backlinks / tags (SQLite-backed)
  search:      (vaultId, query, limit) => ipcRenderer.invoke('mn:search', vaultId, query, limit),
  searchDetailed:(vaultId, query, limit) => ipcRenderer.invoke('mn:searchDetailed', vaultId, query, limit),
  searchDetailedStatus:(vaultId, query, limit) => ipcRenderer.invoke('mn:searchDetailedStatus', vaultId, query, limit),
  backlinks:   (vaultId, title) => ipcRenderer.invoke('mn:backlinks', vaultId, title),
  unlinkedMentions: (vaultId, title, limit) => ipcRenderer.invoke('mn:unlinkedMentions', vaultId, title, limit),
  notesByTag:  (vaultId, tag) => ipcRenderer.invoke('mn:notesByTag', vaultId, tag),
  tagCounts:   (vaultId) => ipcRenderer.invoke('mn:tagCounts', vaultId),
  rebuildIndex:(vaultId) => ipcRenderer.invoke('mn:rebuildIndex', vaultId),
  vaultHealth: (vaultId) => ipcRenderer.invoke('mn:vaultHealth', vaultId),
  exportBackup:(options) => ipcRenderer.invoke('mn:exportBackup', options),
  exportNote:  (vaultId, noteId, format) => ipcRenderer.invoke('mn:exportNote', vaultId, noteId, format),
  importBackup:(options) => ipcRenderer.invoke('mn:importBackup', options),
  importNovelFiles:(options) => ipcRenderer.invoke('mn:importNovelFiles', options),

  // AI (Ollama)
  ai: {
    status:    () => ipcRenderer.invoke('mn:ai.status'),
    connect:   () => ipcRenderer.invoke('mn:ai.connect'),
    ask:       (vaultId, query, options) => ipcRenderer.invoke('mn:ai.ask', vaultId, query, options),
    summarizeVault: (vaultId, query, options) => ipcRenderer.invoke('mn:ai.summarizeVault', vaultId, query, options),
    askStream: (vaultId, query, options = {}, onChunk) => {
      const tokenHandler = typeof onChunk === 'function'
        ? onChunk
        : typeof options?.onToken === 'function' ? options.onToken : null;
      const cleanOptions = { ...(options || {}) };
      delete cleanOptions.onToken;
      const id = requestId('ask');
      const channel = `mn:ai.askStream.chunk:${id}`;
      const listener = (_event, chunk) => {
        if (typeof tokenHandler === 'function') tokenHandler(String(chunk || ''));
      };
      ipcRenderer.on(channel, listener);
      return ipcRenderer.invoke('mn:ai.askStream', vaultId, query, { ...cleanOptions, requestId: id })
        .finally(() => ipcRenderer.removeListener(channel, listener));
    },
    edit:      (payload) => ipcRenderer.invoke('mn:ai.edit', payload),
    editStream:(payload = {}, onChunk) => {
      const tokenHandler = typeof onChunk === 'function'
        ? onChunk
        : typeof payload?.onToken === 'function' ? payload.onToken : null;
      const cleanPayload = { ...(payload || {}) };
      delete cleanPayload.onToken;
      const id = requestId('edit');
      const channel = `mn:ai.editStream.chunk:${id}`;
      const listener = (_event, chunk) => {
        if (typeof tokenHandler === 'function') tokenHandler(String(chunk || ''));
      };
      ipcRenderer.on(channel, listener);
      return ipcRenderer.invoke('mn:ai.editStream', { ...cleanPayload, requestId: id })
        .finally(() => ipcRenderer.removeListener(channel, listener));
    },
    chat:      (payload) => ipcRenderer.invoke('mn:ai.chat', payload),
    toolPlan:  (payload) => ipcRenderer.invoke('mn:ai.toolPlan', payload),
    chatStream:(payload = {}, onChunk) => {
      const tokenHandler = typeof onChunk === 'function'
        ? onChunk
        : typeof payload?.onToken === 'function' ? payload.onToken : null;
      const cleanPayload = { ...(payload || {}) };
      delete cleanPayload.onToken;
      const id = requestId('chat');
      const channel = `mn:ai.chatStream.chunk:${id}`;
      const listener = (_event, chunk) => {
        if (typeof tokenHandler === 'function') tokenHandler(String(chunk || ''));
      };
      ipcRenderer.on(channel, listener);
      return ipcRenderer.invoke('mn:ai.chatStream', { ...cleanPayload, requestId: id })
        .finally(() => ipcRenderer.removeListener(channel, listener));
    },
    cancel:    (jobId) => ipcRenderer.invoke('mn:ai.cancel', jobId),
    backfill:  (vaultId) => ipcRenderer.invoke('mn:ai.backfill', vaultId),
    indexStatus: (vaultId) => ipcRenderer.invoke('mn:ai.indexStatus', vaultId),
    backfillStatus: (vaultId) => ipcRenderer.invoke('mn:ai.backfillStatus', vaultId),
    backfillCancel: (vaultId) => ipcRenderer.invoke('mn:ai.backfillCancel', vaultId),
    related:   (vaultId, noteId, options) => ipcRenderer.invoke('mn:ai.related', vaultId, noteId, options),
    getConfig: () => ipcRenderer.invoke('mn:ai.getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('mn:ai.setConfig', patch),
  },

  // Local llm-memory server bridge
  memory: {
    status: () => ipcRenderer.invoke('mn:memory.status'),
    recall: (query, limit) => ipcRenderer.invoke('mn:memory.recall', query, limit),
    import: (vaultId) => ipcRenderer.invoke('mn:memory.import', vaultId),
    remember: (vaultId, noteId) => ipcRenderer.invoke('mn:memory.remember', vaultId, noteId),
    // Graph-aware features backed by the llm-memory knowledge graph.
    ask: (query, options) => ipcRenderer.invoke('mn:memory.ask', query, options),
    graphTrace: (query, options) => ipcRenderer.invoke('mn:memory.graphTrace', query, options),
    neighbors: (memoryId, options) => ipcRenderer.invoke('mn:memory.neighbors', memoryId, options),
    whyRelevant: (query, memoryId, options) => ipcRenderer.invoke('mn:memory.whyRelevant', query, memoryId, options),
    graph: () => ipcRenderer.invoke('mn:memory.graph'),
    intelligence: (options) => ipcRenderer.invoke('mn:memory.intelligence', options),
    duplicates: (options) => ipcRenderer.invoke('mn:memory.duplicates', options),
    connected: (vaultId, noteId, options) => ipcRenderer.invoke('mn:memory.connected', vaultId, noteId, options),
    syncLinks: (vaultId) => ipcRenderer.invoke('mn:memory.syncLinks', vaultId),
  },

  // Zotero Desktop local API
  zotero: {
    status: () => ipcRenderer.invoke('mn:zotero.status'),
    search: (payload) => ipcRenderer.invoke('mn:zotero.search', payload),
    list: (payload) => ipcRenderer.invoke('mn:zotero.list', payload),
    read: (payload) => ipcRenderer.invoke('mn:zotero.read', payload),
  },

  // Window
  setTitle: (title) => ipcRenderer.invoke('mn:setTitle', title),
  openExternal: (url) => ipcRenderer.invoke('mn:openExternal', url),
  shortcutStatus: () => ipcRenderer.invoke('mn:shortcutStatus'),
  updates: {
    status: () => ipcRenderer.invoke('mn:updates.status'),
    check: () => ipcRenderer.invoke('mn:updates.check'),
    install: () => ipcRenderer.invoke('mn:updates.install'),
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, state) => { try { callback(state); } catch (e) { console.error('updates state handler', e); } };
      ipcRenderer.on('mn:updates.state', listener);
      return () => ipcRenderer.removeListener('mn:updates.state', listener);
    },
  },

  // Push events from main → renderer. The bridge wraps the listener so the
  // renderer never sees the raw IpcRendererEvent object.
  onOpenQuickCapture: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => { try { callback(); } catch (e) { console.error('onOpenQuickCapture handler', e); } };
    ipcRenderer.on('mn:openQuickCapture', listener);
    return () => ipcRenderer.removeListener('mn:openQuickCapture', listener);
  },
  onFlushDirtyNotes: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = async (_event, requestId) => {
      try {
        const value = await callback();
        ipcRenderer.send('mn:flushDirtyNotesResult', requestId, { ok: true, value });
      } catch (e) {
        ipcRenderer.send('mn:flushDirtyNotesResult', requestId, { ok: false, error: e?.message || String(e) });
      }
    };
    ipcRenderer.on('mn:flushDirtyNotes', listener);
    return () => ipcRenderer.removeListener('mn:flushDirtyNotes', listener);
  },
});
