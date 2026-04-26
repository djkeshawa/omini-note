// Preload: exposes a safe IPC bridge as window.mn for the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mn', {
  // Vaults
  listVaults: () => ipcRenderer.invoke('mn:listVaults'),
  createVault: (name) => ipcRenderer.invoke('mn:createVault', name),
  renameVault: (id, name) => ipcRenderer.invoke('mn:renameVault', id, name),
  deleteVault: (id) => ipcRenderer.invoke('mn:deleteVault', id),
  setActiveVault: (id) => ipcRenderer.invoke('mn:setActiveVault', id),

  // Notes
  loadVault: (vaultId) => ipcRenderer.invoke('mn:loadVault', vaultId),
  saveNote: (vaultId, note) => ipcRenderer.invoke('mn:saveNote', vaultId, note),
  deleteNote: (vaultId, noteId) => ipcRenderer.invoke('mn:deleteNote', vaultId, noteId),
  saveVaultMeta: (vaultId, patch) => ipcRenderer.invoke('mn:saveVaultMeta', vaultId, patch),

  // Prefs
  getPrefs: () => ipcRenderer.invoke('mn:getPrefs'),
  setPrefs: (patch) => ipcRenderer.invoke('mn:setPrefs', patch),

  // Search / backlinks / tags (SQLite-backed)
  search:      (vaultId, query, limit) => ipcRenderer.invoke('mn:search', vaultId, query, limit),
  backlinks:   (vaultId, title) => ipcRenderer.invoke('mn:backlinks', vaultId, title),
  notesByTag:  (vaultId, tag) => ipcRenderer.invoke('mn:notesByTag', vaultId, tag),
  tagCounts:   (vaultId) => ipcRenderer.invoke('mn:tagCounts', vaultId),

  // AI (Ollama)
  ai: {
    status:    () => ipcRenderer.invoke('mn:ai.status'),
    connect:   () => ipcRenderer.invoke('mn:ai.connect'),
    ask:       (vaultId, query) => ipcRenderer.invoke('mn:ai.ask', vaultId, query),
    edit:      (payload) => ipcRenderer.invoke('mn:ai.edit', payload),
    chat:      (payload) => ipcRenderer.invoke('mn:ai.chat', payload),
    backfill:  (vaultId) => ipcRenderer.invoke('mn:ai.backfill', vaultId),
    getConfig: () => ipcRenderer.invoke('mn:ai.getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('mn:ai.setConfig', patch),
  },

  // Window
  setTitle: (title) => ipcRenderer.invoke('mn:setTitle', title),
});
