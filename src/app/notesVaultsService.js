(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  function bridge(mn) {
    return mn || root.mn || {};
  }

  function contractError(response, fallback = 'Operation failed') {
    return response?.error?.message || response?.error || fallback;
  }

  function legacyToContract(response, mapValue) {
    if (response?.ok === false) return { ok: false, error: { message: response.error || 'Operation failed', code: response.code || 'INTERNAL_ERROR' } };
    return { ok: true, data: mapValue ? mapValue(response?.value) : response?.value };
  }

  async function listVaults(mn) {
    const api = bridge(mn);
    const response = await api.vaults.listVaults();
    return response?.data ? response : legacyToContract(response, vaults => ({ vaults: vaults || [], activeVaultId: null }));
  }

  async function loadVault(mn, vaultId) {
    const api = bridge(mn);
    const response = await api.notes.loadVault(vaultId);
    return legacyToContract(response, value => ({ vault: value }));
  }

  function linkedNoteUpdatesFrom(value) {
    return Array.isArray(value) ? value : [];
  }

  async function saveNote(mn, vaultId, note, options = {}) {
    const api = bridge(mn);
    const response = await api.notes.saveNote(vaultId, note, options);
    if (response?.data?.note) {
      return {
        ok: true,
        value: response.data.note,
        linkedNoteUpdates: linkedNoteUpdatesFrom(response.data.linkedNoteUpdates),
        linkedNoteRename: response.data.linkedNoteRename || null,
      };
    }
    if (response?.ok === false && response?.error) {
      return {
        ok: false,
        error: contractError(response),
        code: response.error?.code,
        ...(response.error?.details || {}),
      };
    }
    const legacy = response;
    if (legacy?.ok && legacy.value && Array.isArray(legacy.value.linkedNoteUpdates)) {
      const { linkedNoteUpdates, linkedNoteRename, ...saved } = legacy.value;
      return { ...legacy, value: saved, linkedNoteUpdates, linkedNoteRename: linkedNoteRename || null };
    }
    return legacy;
  }

  async function deleteNote(mn, vaultId, noteId, noteSnapshot = null, options = {}) {
    const api = bridge(mn);
    const deleteOptions = { ...options };
    if (
      !Object.prototype.hasOwnProperty.call(deleteOptions, 'expectedRevision') &&
      noteSnapshot &&
      Object.prototype.hasOwnProperty.call(noteSnapshot, 'diskRevision')
    ) {
      deleteOptions.expectedRevision = noteSnapshot.diskRevision;
    }
    const response = await api.notes.deleteNote(vaultId, noteId, noteSnapshot, deleteOptions);
    if (response?.data) return { ok: true, value: response.data.deleted || response.data };
    if (response?.ok === false && response?.error) {
      return {
        ok: false,
        error: contractError(response),
        code: response.error?.code,
        ...(response.error?.details || {}),
      };
    }
    return response;
  }

  return {
    contractError,
    deleteNote,
    listVaults,
    loadVault,
    saveNote,
  };
});
