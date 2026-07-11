function registerAiHandlers(ipcMain, deps) {
  const {
    wrap, wrapWithEvent, ai, store, askFromIpc, sanitizeAiAskArgs,
    sanitizeAiAskOptions, askStreamFromIpc, prepareAiEditPayload,
    sanitizeAiChatPayload, sanitizeAiToolPlanPayload, sendIpcChunk,
    getIndexReadyPromise, assertSearchIndexAvailable, relatedNotesFromIpc,
  } = deps;

  ipcMain.handle('mn:ai.status', wrap(() => ai.status()));
  ipcMain.handle('mn:ai.connect', wrap(async () => {
    const result = await ai.connect();
    if (result?.config?.provider === 'ollama') await store.setPrefs({ aiConfig: ai.getConfig() });
    return result;
  }));
  ipcMain.handle('mn:ai.ask', wrap(askFromIpc));
  ipcMain.handle('mn:ai.summarizeVault', wrap(async (vaultId, query, options) => {
    const clean = await sanitizeAiAskArgs(vaultId, query);
    return ai.summarizeVault(clean.vaultId, clean.query, store, sanitizeAiAskOptions(options || {}));
  }));
  ipcMain.handle('mn:ai.askStream', wrapWithEvent(askStreamFromIpc));
  ipcMain.handle('mn:ai.edit', wrap(async payload => ai.editText(await prepareAiEditPayload(payload))));
  ipcMain.handle('mn:ai.editStream', wrapWithEvent(async (event, payload = {}) => {
    const requestId = String(payload.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const cleanPayload = await prepareAiEditPayload(payload);
    return await ai.editTextStream({
      ...cleanPayload,
      onToken: token => sendIpcChunk(event, requestId, 'mn:ai.editStream.chunk', token),
    });
  }));
  ipcMain.handle('mn:ai.chat', wrap(payload => ai.chat(sanitizeAiChatPayload(payload))));
  ipcMain.handle('mn:ai.toolPlan', wrap(payload => ai.toolPlan(sanitizeAiToolPlanPayload(payload))));
  ipcMain.handle('mn:ai.chatStream', wrapWithEvent(async (event, payload = {}) => {
    const requestId = String(payload.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const cleanPayload = sanitizeAiChatPayload(payload);
    return await ai.chatStream({
      ...cleanPayload,
      onToken: token => sendIpcChunk(event, requestId, 'mn:ai.chatStream.chunk', token),
    });
  }));
  ipcMain.handle('mn:ai.cancel', wrap(jobId => ai.cancelJob(jobId)));
  ipcMain.handle('mn:ai.backfill', wrap(vaultId => ai.backfillVault(vaultId, store)));
  ipcMain.handle('mn:ai.indexStatus', wrap(async vaultId => {
    await getIndexReadyPromise();
    assertSearchIndexAvailable();
    return ai.indexStatus(vaultId);
  }));
  ipcMain.handle('mn:ai.backfillStatus', wrap(vaultId => ai.backfillStatus(vaultId)));
  ipcMain.handle('mn:ai.backfillCancel', wrap(vaultId => ai.cancelBackfill(vaultId)));
  ipcMain.handle('mn:ai.related', wrap(relatedNotesFromIpc));
  ipcMain.handle('mn:ai.getConfig', wrap(() => ai.publicConfig()));
  ipcMain.handle('mn:ai.setConfig', wrap(async patch => {
    const config = ai.previewConfig(patch);
    await store.setPrefs({ aiConfig: config });
    ai.applyConfig(config);
    return ai.publicConfig(config);
  }));
}

module.exports = { registerAiHandlers };
