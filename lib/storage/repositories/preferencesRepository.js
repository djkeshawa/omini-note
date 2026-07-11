function createPreferencesRepository(deps) {
  const {
    loadConfig, saveConfig, themes, featureUsage, isPlainObject, cleanMergePatch,
    preferenceKeys, aiConfigKeys, assertByteLength, maxJsonWriteBytes,
    sanitizePhase5Metrics, normalizeEnabledPacks, validateEntityId, recordPhase5Metric,
  } = deps;

  async function getPrefs() {
    const cfg = await loadConfig();
    return {
      activeVaultId: cfg.activeVaultId,
      tweaks: cfg.tweaks || null,
      aiConfig: cfg.aiConfig || null,
      smartViews: Array.isArray(cfg.smartViews) ? cfg.smartViews : null,
      customThemes: themes.sanitizeStoredThemes(cfg.customThemes),
      phase5Metrics: sanitizePhase5Metrics(cfg.phase5Metrics),
      enabledPacks: normalizeEnabledPacks(cfg.enabledPacks),
      localUsageMetrics: cfg.localUsageMetrics !== false,
      anonymousUsageSharing: cfg.anonymousUsageSharing === true,
    };
  }

  async function setPrefs(patch) {
    if (!isPlainObject(patch)) throw new Error('Invalid preferences patch');
    const allowed = new Set([
      'activeVaultId', 'tweaks', 'aiConfig', 'smartViews', 'phase5Metrics',
      'enabledPacks', 'localUsageMetrics', 'anonymousUsageSharing',
    ]);
    const cleanPatch = cleanMergePatch(patch, allowed);
    const cfg = await loadConfig();
    if (cleanPatch.tweaks) {
      if (!isPlainObject(cleanPatch.tweaks)) throw new Error('Invalid tweaks patch');
      cfg.tweaks = { ...(cfg.tweaks || {}), ...cleanMergePatch(cleanPatch.tweaks, preferenceKeys) };
    }
    if (cleanPatch.aiConfig) {
      if (!isPlainObject(cleanPatch.aiConfig)) throw new Error('Invalid AI config patch');
      cfg.aiConfig = { ...(cfg.aiConfig || {}), ...cleanMergePatch(cleanPatch.aiConfig, aiConfigKeys) };
    }
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'smartViews')) {
      if (cleanPatch.smartViews == null) cfg.smartViews = null;
      else {
        if (!Array.isArray(cleanPatch.smartViews) || cleanPatch.smartViews.length > 24) throw new Error('Invalid Smart Views preference');
        assertByteLength(JSON.stringify(cleanPatch.smartViews), maxJsonWriteBytes, 'Smart Views preference is too large');
        cfg.smartViews = cleanPatch.smartViews;
      }
    }
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'phase5Metrics')) {
      cfg.phase5Metrics = cleanPatch.phase5Metrics == null ? null : sanitizePhase5Metrics(cleanPatch.phase5Metrics, { rejectUnknown: true });
    }
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'enabledPacks')) cfg.enabledPacks = normalizeEnabledPacks(cleanPatch.enabledPacks);
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'localUsageMetrics')) {
      if (typeof cleanPatch.localUsageMetrics !== 'boolean') throw new Error('Invalid local usage metrics preference');
      cfg.localUsageMetrics = cleanPatch.localUsageMetrics;
    }
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'anonymousUsageSharing')) {
      if (typeof cleanPatch.anonymousUsageSharing !== 'boolean') throw new Error('Invalid anonymous usage sharing preference');
      cfg.anonymousUsageSharing = cleanPatch.anonymousUsageSharing;
    }
    if (cleanPatch.activeVaultId) {
      const activeVaultId = validateEntityId(cleanPatch.activeVaultId, 'vault');
      if (!cfg.vaults.some(vault => vault.id === activeVaultId)) throw new Error('Vault not found: ' + activeVaultId);
      cfg.activeVaultId = activeVaultId;
    }
    await saveConfig(cfg);
  }

  async function featureUsageStatus() {
    const cfg = await loadConfig();
    return {
      localUsageMetrics: cfg.localUsageMetrics !== false,
      anonymousUsageSharing: cfg.anonymousUsageSharing === true,
      report: featureUsage.publicReport(cfg.featureUsage),
    };
  }

  async function recordFeatureUsage(feature, action = 'used') {
    const cfg = await loadConfig();
    if (cfg.localUsageMetrics !== false) {
      cfg.featureUsage = featureUsage.recordFeatureUsage(cfg.featureUsage, feature, action);
      await saveConfig(cfg);
    }
    return featureUsage.publicReport(cfg.featureUsage);
  }

  async function clearFeatureUsage() {
    const cfg = await loadConfig();
    cfg.featureUsage = null;
    await saveConfig(cfg);
    return featureUsage.publicReport(null);
  }

  async function getFeatureUsageData() {
    const cfg = await loadConfig();
    return featureUsage.sanitizeFeatureUsage(cfg.featureUsage);
  }

  async function setFeatureUsageData(value) {
    const cfg = await loadConfig();
    cfg.featureUsage = featureUsage.sanitizeFeatureUsage(value);
    await saveConfig(cfg);
    return cfg.featureUsage;
  }

  async function installCustomTheme(theme) {
    const cfg = await loadConfig();
    const installed = themes.upsertCustomTheme(cfg.customThemes, theme);
    cfg.customThemes = installed.customThemes;
    cfg.phase5Metrics = recordPhase5Metric(cfg.phase5Metrics, 'theme_installs', { themeId: installed.theme?.id || theme?.id });
    await saveConfig(cfg);
    return installed;
  }

  async function importThemeFile(filePath) {
    return installCustomTheme(await themes.readThemeFile(filePath));
  }

  return {
    getPrefs, setPrefs, featureUsageStatus, recordFeatureUsage, clearFeatureUsage,
    getFeatureUsageData, setFeatureUsageData, installCustomTheme, importThemeFile,
  };
}

module.exports = { createPreferencesRepository };
