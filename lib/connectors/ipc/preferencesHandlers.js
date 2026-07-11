function registerPreferencesHandlers(ipcMain, deps) {
  const {
    wrap, store, ai, setPrefsFromIpc, importThemeFileFromIpc, spellcheckWords,
    featureUsageStatusFromIpc, exportFeatureUsageFromIpc, shareFeatureUsageFromIpc,
  } = deps;
  ipcMain.handle('mn:getPrefs', wrap(async () => {
    const prefs = await store.getPrefs();
    return {
      ...prefs,
      aiConfig: prefs.aiConfig ? ai.publicConfig(ai.previewConfig(prefs.aiConfig, { rejectUnknown: false })) : null,
    };
  }));
  ipcMain.handle('mn:setPrefs', wrap(setPrefsFromIpc));
  ipcMain.handle('mn:importThemeFile', wrap(importThemeFileFromIpc));
  ipcMain.handle('mn:spellcheck', wrap(spellcheckWords));
  ipcMain.handle('mn:featureUsage.status', wrap(featureUsageStatusFromIpc));
  ipcMain.handle('mn:featureUsage.record', wrap((feature, action) => store.recordFeatureUsage(feature, action)));
  ipcMain.handle('mn:featureUsage.clear', wrap(store.clearFeatureUsage));
  ipcMain.handle('mn:featureUsage.export', wrap(exportFeatureUsageFromIpc));
  ipcMain.handle('mn:featureUsage.share', wrap(shareFeatureUsageFromIpc));
}

module.exports = { registerPreferencesHandlers };
