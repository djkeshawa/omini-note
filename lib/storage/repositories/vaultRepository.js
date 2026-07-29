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
    const { config } = await d.updateConfig(cfg => d.repairConfigVaults(cfg, { persist: false }));
    return vaultsWithMeta(config);
  }

  async function createVault(name, options = {}) {
    const { result } = await d.updateConfig(cfg => d.createVaultRecord(cfg, name, options));
    return result;
  }

  async function renameVault(id, name) {
    const vaultId = d.validateEntityId(id, 'vault');
    const cleanName = d.cleanString(name, 'Untitled vault');
    return d.withMetadataLock(vaultId, async () => {
      const { result } = await d.updateConfig(cfg => {
        const vault = cfg.vaults.find(item => item.id === vaultId);
        if (!vault) throw new Error('Vault not found: ' + vaultId);
        vault.name = cleanName;
        return { ...vault };
      });
      const vault = result;
      if (vault) {
        const meta = await d.readJsonSafe(d.vaultMetaFile(vault.slug), {});
        await d.writeJson(d.vaultMetaFile(vault.slug), { ...meta, name: cleanName });
      }
      return vault;
    });
  }

  async function deleteVault(id) {
    const vaultId = d.validateEntityId(id, 'vault');
    let deletedPath = null;
    let removedSlug = null;
    let configCommitted = false;
    try {
      return await d.withMetadataLock(vaultId, async () => {
        const { config, result } = await d.updateConfig(async cfg => {
          const index = cfg.vaults.findIndex(item => item.id === vaultId);
          if (index < 0) throw new Error('Vault not found: ' + vaultId);
          if (cfg.vaults.length <= 1) throw new Error('Create another vault before deleting this one.');
          const [removed] = cfg.vaults.splice(index, 1);
          removedSlug = removed.slug;
          if (cfg.activeVaultId === vaultId) {
            cfg.activeVaultId = cfg.vaults[Math.min(index, cfg.vaults.length - 1)]?.id || cfg.vaults[0]?.id || null;
          }
          deletedPath = await d.moveVaultToTrash(removed.slug);
          return { activeVaultId: cfg.activeVaultId, removed };
        });
        configCommitted = true;
        return {
          deletedVaultId: vaultId,
          activeVaultId: result.activeVaultId,
          deletedPath,
          vaults: await vaultsWithMeta(config),
        };
      });
    } catch (error) {
      if (!configCommitted && deletedPath && removedSlug) {
        await d.retryRename(deletedPath, d.vaultDir(removedSlug)).catch(() => {});
      }
      throw error;
    }
  }

  async function setActiveVault(id) {
    const vaultId = d.validateEntityId(id, 'vault');
    await d.updateConfig(cfg => {
      if (!cfg.vaults.some(vault => vault.id === vaultId)) throw new Error('Vault not found: ' + vaultId);
      cfg.activeVaultId = vaultId;
    });
  }

  return { listVaults, vaultsWithMeta, createVault, renameVault, deleteVault, setActiveVault };
}

module.exports = { createVaultRepository };
