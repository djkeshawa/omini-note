(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function cacheActiveVault(vaults = [], activeVaultId, snapshot = {}) {
    return (vaults || []).map(vault => vault.id === activeVaultId
      ? { ...vault, ...snapshot }
      : vault);
  }

  function upsertVault(vaults = [], nextVault) {
    if (!nextVault?.id) return vaults || [];
    const found = (vaults || []).some(vault => vault.id === nextVault.id);
    if (found) return vaults.map(vault => vault.id === nextVault.id ? { ...vault, ...nextVault } : vault);
    return [...(vaults || []), nextVault];
  }

  function removeVault(vaults = [], vaultId) {
    return (vaults || []).filter(vault => vault.id !== vaultId);
  }

  function updateNoteDiskStamp(notes = [], noteId, diskModifiedAt) {
    if (!diskModifiedAt) return notes || [];
    return (notes || []).map(note => note.id === noteId ? { ...note, diskModifiedAt } : note);
  }

  function updateNoteDiskState(notes = [], noteId, diskState = {}) {
    return (notes || []).map(note => note.id === noteId
      ? {
          ...note,
          ...(diskState.diskModifiedAt ? { diskModifiedAt: diskState.diskModifiedAt } : {}),
          ...(diskState.diskRevision ? { diskRevision: diskState.diskRevision } : {}),
        }
      : note);
  }

  function restoreNoteAtIndex(notes = [], note, index = 0) {
    if (!note?.id || (notes || []).some(current => current.id === note.id)) return notes || [];
    const next = [...(notes || [])];
    const safeIndex = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, next.length));
    next.splice(safeIndex, 0, note);
    return next;
  }

  function removeNote(notes = [], noteId) {
    return (notes || []).filter(note => note.id !== noteId);
  }

  function nextSelectedNoteId(notes = [], previousSelectedId = null) {
    if (previousSelectedId && (notes || []).some(note => note.id === previousSelectedId)) return previousSelectedId;
    return notes?.[0]?.id || null;
  }

  return {
    cacheActiveVault,
    nextSelectedNoteId,
    removeNote,
    removeVault,
    restoreNoteAtIndex,
    updateNoteDiskState,
    updateNoteDiskStamp,
    upsertVault,
  };
});
