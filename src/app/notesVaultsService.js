(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_NOTES_VAULTS_SERVICE = api;
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
    if (api?.notesVaults?.listVaults) return await api.notesVaults.listVaults({});
    return legacyToContract(await api.listVaults(), vaults => ({ vaults: vaults || [], activeVaultId: null }));
  }

  async function loadVault(mn, vaultId) {
    const api = bridge(mn);
    const response = await api.loadVault(vaultId);
    return legacyToContract(response, value => ({ vault: value }));
  }

  function linkedNoteUpdatesFrom(value) {
    return Array.isArray(value) ? value : [];
  }

  async function saveNote(mn, vaultId, note, options = {}) {
    const api = bridge(mn);
    if (api?.notesVaults?.saveNote) {
      const response = await api.notesVaults.saveNote({ vaultId, noteId: note?.id, note, options });
      if (response?.ok) {
        return {
          ok: true,
          value: response.data.note,
          linkedNoteUpdates: linkedNoteUpdatesFrom(response.data.linkedNoteUpdates),
          linkedNoteRename: response.data.linkedNoteRename || null,
        };
      }
      return { ok: false, error: contractError(response), code: response.error?.code };
    }
    const legacy = await api.saveNote(vaultId, note, options);
    if (legacy?.ok && legacy.value && Array.isArray(legacy.value.linkedNoteUpdates)) {
      const { linkedNoteUpdates, linkedNoteRename, ...saved } = legacy.value;
      return { ...legacy, value: saved, linkedNoteUpdates, linkedNoteRename: linkedNoteRename || null };
    }
    return legacy;
  }

  async function deleteNote(mn, vaultId, noteId, noteSnapshot = null) {
    const api = bridge(mn);
    if (api?.notesVaults?.deleteNote) {
      const response = await api.notesVaults.deleteNote({ vaultId, noteId, noteSnapshot });
      if (response?.ok) return { ok: true, value: response.data.deleted || response.data };
      return { ok: false, error: contractError(response), code: response.error?.code };
    }
    return await api.deleteNote(vaultId, noteId, noteSnapshot);
  }

  return {
    contractError,
    deleteNote,
    listVaults,
    loadVault,
    saveNote,
  };
});
