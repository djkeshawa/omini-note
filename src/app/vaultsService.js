(function (root, factory) {
  const notesVaultsService = typeof require === 'function' ? require('./notesVaultsService.js') : {};
  const api = factory(root, notesVaultsService);
  if (typeof module === 'object' && module.exports) module.exports = api;
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
    const response = await api.vaults.createVault(name, options);
    return response?.data ? asLegacy(response, data => data.vault) : response;
  }

  async function renameVault(mn, vaultId, name) {
    const api = bridge(mn);
    const response = await api.vaults.renameVault(vaultId, name);
    return response?.data ? asLegacy(response, data => data.vault) : response;
  }

  async function deleteVault(mn, vaultId) {
    const api = bridge(mn);
    const response = await api.vaults.deleteVault(vaultId);
    return response?.data ? asLegacy(response) : response;
  }

  async function selectVault(mn, vaultId) {
    const api = bridge(mn);
    if (api?.vaults?.setActiveVault) {
      const response = await api.vaults.setActiveVault(vaultId);
      return response?.data ? asLegacy(response) : legacyToContract(response);
    }
    return { ok: true, value: null };
  }

  return {
    createVault,
    deleteVault,
    renameVault,
    selectVault,
  };
});
