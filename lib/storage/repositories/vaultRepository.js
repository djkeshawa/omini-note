function createVaultRepository(d) {
  async function vaultsWithMeta(cfg) {
    return Promise.all(cfg.vaults.map(async vault => {
      const meta = await d.readJsonSafe(d.vaultMetaFile(vault.slug), {});
      return {
        ...vault,
        novelistMode: !!meta.novelistMode,
        workflowStates: Array.isArray(meta.workflowStates) ? d.normalizeWorkflowStates(meta.workflowStates) : null,
        novelistAiConfig: d.isPlainObject(meta.novelistAiConfig) ? meta.novelistAiConfig : null,
      };
    }));
  }

  async function listVaults() {
    let cfg = await d.loadConfig();
    cfg = await d.repairConfigVaults(cfg);
    d.setRepairedConfigCache(cfg);
    return vaultsWithMeta(cfg);
  }

  async function createVault(name, options = {}) {
    const cfg = await d.loadConfig();
    const vault = await d.createVaultRecord(cfg, name, options);
    await d.saveConfig(cfg);
    return vault;
  }

  async function renameVault(id, name) {
    const cfg = await d.loadConfig();
    const vaultId = d.validateEntityId(id, 'vault');
    const vault = cfg.vaults.find(item => item.id === vaultId);
    if (!vault) throw new Error('Vault not found: ' + vaultId);
    vault.name = d.cleanString(name, 'Untitled vault');
    const meta = await d.readJsonSafe(d.vaultMetaFile(vault.slug), {});
    await d.saveConfig(cfg);
    await d.writeJson(d.vaultMetaFile(vault.slug), { ...meta, name: vault.name });
    return vault;
  }

  async function deleteVault(id) {
    const cfg = await d.loadConfig();
    const vaultId = d.validateEntityId(id, 'vault');
    const index = cfg.vaults.findIndex(item => item.id === vaultId);
    if (index < 0) throw new Error('Vault not found: ' + vaultId);
    if (cfg.vaults.length <= 1) throw new Error('Create another vault before deleting this one.');
    const originalVaults = [...cfg.vaults];
    const originalActiveVaultId = cfg.activeVaultId;
    const [removed] = cfg.vaults.splice(index, 1);
    if (cfg.activeVaultId === vaultId) cfg.activeVaultId = cfg.vaults[Math.min(index, cfg.vaults.length - 1)]?.id || cfg.vaults[0]?.id || null;
    const deletedPath = await d.moveVaultToTrash(removed.slug);
    try {
      await d.saveConfig(cfg);
    } catch (error) {
      if (deletedPath) await d.retryRename(deletedPath, d.vaultDir(removed.slug)).catch(() => {});
      cfg.vaults = originalVaults;
      cfg.activeVaultId = originalActiveVaultId;
      d.setConfigCache(cfg);
      throw error;
    }
    return { deletedVaultId: vaultId, activeVaultId: cfg.activeVaultId, deletedPath, vaults: await vaultsWithMeta(cfg) };
  }

  async function setActiveVault(id) {
    const cfg = await d.loadConfig();
    const vaultId = d.validateEntityId(id, 'vault');
    if (!cfg.vaults.some(vault => vault.id === vaultId)) throw new Error('Vault not found: ' + vaultId);
    cfg.activeVaultId = vaultId;
    await d.saveConfig(cfg);
  }

  return { listVaults, vaultsWithMeta, createVault, renameVault, deleteVault, setActiveVault };
}

module.exports = { createVaultRepository };
