(function (root, factory) {
  const api = factory(root, root.MN_NOTES_VAULTS_SERVICE || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_VAULTS_SERVICE = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root, notesVaultsService) {
  function bridge(mn) {
    return mn || root.mn || {};
  }

  function legacyToContract(response, mapValue) {
    if (response?.ok === false) return { ok: false, error: { message: response.error || 'Operation failed', code: response.code || 'INTERNAL_ERROR' } };
    return { ok: true, data: mapValue ? mapValue(response?.value) : response?.value };
  }

  function asLegacy(response, mapData) {
    if (response?.ok) return { ok: true, value: mapData ? mapData(response.data) : response.data };
    return { ok: false, error: notesVaultsService.contractError?.(response) || 'Operation failed', code: response?.error?.code };
  }

  async function createVault(mn, name, options = {}) {
    const api = bridge(mn);
    if (api?.notesVaults?.createVault) {
      return asLegacy(await api.notesVaults.createVault({ name, options }), data => data.vault);
    }
    return await api.createVault(name, options);
  }

  async function renameVault(mn, vaultId, name) {
    const api = bridge(mn);
    if (api?.notesVaults?.renameVault) {
      return asLegacy(await api.notesVaults.renameVault({ vaultId, name }), data => data.vault);
    }
    return await api.renameVault(vaultId, name);
  }

  async function deleteVault(mn, vaultId) {
    const api = bridge(mn);
    if (api?.notesVaults?.deleteVault) {
      return asLegacy(await api.notesVaults.deleteVault({ vaultId }));
    }
    return await api.deleteVault(vaultId);
  }

  async function selectVault(mn, vaultId) {
    const api = bridge(mn);
    if (api?.notesVaults?.selectVault) {
      return asLegacy(await api.notesVaults.selectVault({ vaultId }));
    }
    if (api?.setActiveVault) return legacyToContract(await api.setActiveVault(vaultId));
    return { ok: true, value: null };
  }

  return {
    createVault,
    deleteVault,
    renameVault,
    selectVault,
  };
});
