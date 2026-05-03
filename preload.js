// Preload: exposes a safe IPC bridge as window.mn for the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mn', {
  // Vaults
  listVaults: () => ipcRenderer.invoke('mn:listVaults'),
  createVault: (name, options) => ipcRenderer.invoke('mn:createVault', name, options),
  renameVault: (id, name) => ipcRenderer.invoke('mn:renameVault', id, name),
  deleteVault: (id) => ipcRenderer.invoke('mn:deleteVault', id),
  setActiveVault: (id) => ipcRenderer.invoke('mn:setActiveVault', id),

  // Notes
  loadVault: (vaultId) => ipcRenderer.invoke('mn:loadVault', vaultId),
  saveNote: (vaultId, note) => ipcRenderer.invoke('mn:saveNote', vaultId, note),
  deleteNote: (vaultId, noteId) => ipcRenderer.invoke('mn:deleteNote', vaultId, noteId),
  listCanvases: (vaultId) => ipcRenderer.invoke('mn:listCanvases', vaultId),
  getCanvas: (vaultId, canvasId) => ipcRenderer.invoke('mn:getCanvas', vaultId, canvasId),
  saveCanvas: (vaultId, canvas) => ipcRenderer.invoke('mn:saveCanvas', vaultId, canvas),
  deleteCanvas: (vaultId, canvasId) => ipcRenderer.invoke('mn:deleteCanvas', vaultId, canvasId),
  saveVaultMeta: (vaultId, patch) => ipcRenderer.invoke('mn:saveVaultMeta', vaultId, patch),

  // Prefs
  getPrefs: () => ipcRenderer.invoke('mn:getPrefs'),
  setPrefs: (patch) => ipcRenderer.invoke('mn:setPrefs', patch),
  spellcheck: (words) => ipcRenderer.invoke('mn:spellcheck', words),

  // Search / backlinks / tags (SQLite-backed)
  search:      (vaultId, query, limit) => ipcRenderer.invoke('mn:search', vaultId, query, limit),
  backlinks:   (vaultId, title) => ipcRenderer.invoke('mn:backlinks', vaultId, title),
  notesByTag:  (vaultId, tag) => ipcRenderer.invoke('mn:notesByTag', vaultId, tag),
  tagCounts:   (vaultId) => ipcRenderer.invoke('mn:tagCounts', vaultId),

  // AI (Ollama)
  ai: {
    status:    () => ipcRenderer.invoke('mn:ai.status'),
    connect:   () => ipcRenderer.invoke('mn:ai.connect'),
    ask:       (vaultId, query, options) => ipcRenderer.invoke('mn:ai.ask', vaultId, query, options),
    edit:      (payload) => ipcRenderer.invoke('mn:ai.edit', payload),
    editStream:(payload, onChunk) => {
      const requestId = `edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const channel = `mn:ai.editStream.chunk:${requestId}`;
      const listener = (_event, chunk) => {
        if (typeof onChunk === 'function') onChunk(String(chunk || ''));
      };
      ipcRenderer.on(channel, listener);
      return ipcRenderer.invoke('mn:ai.editStream', { ...payload, requestId })
        .finally(() => ipcRenderer.removeListener(channel, listener));
    },
    chat:      (payload) => ipcRenderer.invoke('mn:ai.chat', payload),
    cancel:    (jobId) => ipcRenderer.invoke('mn:ai.cancel', jobId),
    backfill:  (vaultId) => ipcRenderer.invoke('mn:ai.backfill', vaultId),
    getConfig: () => ipcRenderer.invoke('mn:ai.getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('mn:ai.setConfig', patch),
  },

  // Window
  setTitle: (title) => ipcRenderer.invoke('mn:setTitle', title),
});
