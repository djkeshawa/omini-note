function createPreferencesService({
  app, fs, dialog, store, ai, featureUsage, sanitizePrefsPatchFromIpc,
  isPlainObject, getMainWindow, invalidateMemoryIndexCache,
}) {
async function setPrefsFromIpc(patch) {
  const cleanPatch = sanitizePrefsPatchFromIpc(patch);
  const invalidateMemoryCache = isPlainObject(cleanPatch.tweaks)
    && Object.prototype.hasOwnProperty.call(cleanPatch.tweaks, 'plugins');
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'aiConfig')) {
    const config = ai.previewConfig(cleanPatch.aiConfig);
    await store.setPrefs({ ...cleanPatch, aiConfig: config });
    ai.applyConfig(config);
    if (invalidateMemoryCache) invalidateMemoryIndexCache();
    return ai.publicConfig(config);
  }
  const result = await store.setPrefs(cleanPatch);
  if (invalidateMemoryCache) invalidateMemoryIndexCache();
  return result;
}

async function importThemeFileFromIpc() {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Install VispNote theme',
    properties: ['openFile'],
    filters: [{ name: 'VispNote Theme', extensions: ['json', 'yaml', 'yml'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const installed = await store.importThemeFile(result.filePaths[0]);
  return { ...installed, canceled: false };
}

function telemetryEndpoint() {
  const raw = String(process.env.VISPNOTE_TELEMETRY_ENDPOINT || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

async function featureUsageStatusFromIpc() {
  const status = await store.featureUsageStatus();
  return {
    ...status,
    report: featureUsage.publicReport(await store.getFeatureUsageData(), {
      appVersion: app.getVersion(),
    }),
    anonymousUploadAvailable: Boolean(telemetryEndpoint()),
  };
}

async function exportFeatureUsageFromIpc() {
  const report = featureUsage.publicReport(await store.getFeatureUsageData(), {
    appVersion: app.getVersion(),
  });
  const result = await dialog.showSaveDialog(getMainWindow(), {
    title: 'Export local feature usage report',
    defaultPath: `vispnote-feature-usage-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    const targetStat = await fs.promises.lstat(result.filePath);
    if (targetStat.isSymbolicLink()) throw new Error('Usage report target cannot be a symlink');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await store.atomicWriteFile(result.filePath, JSON.stringify(report, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
}

async function shareFeatureUsageFromIpc() {
  const endpoint = telemetryEndpoint();
  if (!endpoint) throw new Error('Anonymous usage sharing is not available in this build');
  const prefs = await store.getPrefs();
  if (prefs.anonymousUsageSharing !== true) throw new Error('Anonymous usage sharing is disabled');
  const rotated = featureUsage.rotateUploadIdentity(await store.getFeatureUsageData());
  const payload = featureUsage.anonymousSummary(rotated, {
    appVersion: app.getVersion(),
    os: process.platform,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Anonymous usage upload failed (${response.status})`);
    await store.setFeatureUsageData({
      ...rotated,
      lastUploadedAt: new Date().toISOString(),
    });
    return { shared: true, month: payload.month };
  } finally {
    clearTimeout(timeoutId);
  }
}


  return {
    setPrefsFromIpc,
    importThemeFileFromIpc,
    featureUsageStatusFromIpc,
    exportFeatureUsageFromIpc,
    shareFeatureUsageFromIpc,
  };
}

module.exports = { createPreferencesService };
