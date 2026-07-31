const { createMemoryIndexCache } = require('../../memoryIndexCache');

function registerMemoryHandlers(ipcMain, deps) {
  const {
    wrap, store, idx, ai, llmMemory, memoryLinks,
    withIndexVaultLock, runOptionalSearchIndexTask,
    vaultWatcher = { markInternal() {} },
  } = deps;

  async function activeMemoryConfig() {
    const prefs = await store.getPrefs();
    const plugins = Array.isArray(prefs?.tweaks?.plugins) ? prefs.tweaks.plugins : [];
    const plugin = plugins.find(item => item?.enabled !== false && item?.type === 'llm-memory');
    if (!plugin) throw new Error('Enable the LLM Memory bridge plugin in Settings first.');
    return llmMemory.normalizeMemoryConfig(plugin.config || {});
  }

  ai.setMemoryRecallProvider(async ({ query, limit }) => {
    const config = await activeMemoryConfig();
    const want = Math.max(1, Math.min(12, Math.trunc(Number(limit)) || 6));
    try {
      const trace = await llmMemory.graphTrace(config, { query, depth: 1, limit: want });
      const nodes = Array.isArray(trace?.nodes) ? trace.nodes : [];
      if (nodes.length) {
        return nodes.map(node => ({
          id: node.id,
          content: node.content,
          layer: node.layer,
          category: node.category,
          importance: node.importance,
          tags: [],
          createdAt: '',
        }));
      }
    } catch {}
    return llmMemory.recall(config, { query, limit: want });
  });

  const noteMemoryCache = createMemoryIndexCache({
    loader: (config, options) => llmMemory.listMemories(config, options),
    limit: 2000,
    ttlMs: 30000,
    maxEntries: 8,
  });

  async function buildNoteMemoryIndex(config, vaultId) {
    const { memories, truncated } = await noteMemoryCache.get(config);
    const index = memoryLinks.noteMemoryIndex(memories, { vaultId });
    return { index, truncated, mappingStats: index.stats || {} };
  }

  async function syncNoteLinks(config, vaultId) {
    const vault = await store.loadVault(vaultId);
    const notes = Array.isArray(vault?.notes) ? vault.notes : [];
    const { index, truncated, mappingStats } = await buildNoteMemoryIndex(config, vaultId);
    const { edges, stats } = memoryLinks.buildNoteLinkEdges(notes, index);
    const result = await llmMemory.syncNoteLinks(config, edges);
    return {
      ...result,
      notesScanned: notes.length,
      notesRemembered: index.size,
      wikiLinks: stats.wikiLinks,
      linkedNotesMissingMemory: stats.linkedNotesMissingMemory,
      ambiguousTitles: stats.ambiguousTitles,
      mappedLegacy: mappingStats.mappedLegacy || 0,
      ambiguousLegacy: mappingStats.ambiguousLegacy || 0,
      indexTruncated: truncated,
    };
  }

  async function connectedForNote(config, vaultId, noteId, options = {}) {
    const { index } = await buildNoteMemoryIndex(config, vaultId);
    const mapped = index.get(noteId);
    let memoryId = mapped?.memoryId || null;
    let via = memoryId ? 'link' : '';
    if (!memoryId) {
      const note = await store.getNote(vaultId, noteId);
      const query = [note?.title, String(note?.body || '').slice(0, 400)].filter(Boolean).join('\n');
      if (query.trim()) {
        const seeds = await llmMemory.recall(config, { query, limit: 1 });
        if (seeds[0]?.id) { memoryId = seeds[0].id; via = 'recall'; }
      }
    }
    if (!memoryId) return { ok: true, remembered: false, via: '', memoryId: '', neighbors: null };
    const neighbors = await llmMemory.graphNeighbors(config, {
      memoryId,
      depth: Math.max(1, Math.min(3, Number(options.depth) || 1)),
      limit: Math.max(1, Math.min(30, Number(options.limit) || 12)),
    });
    return { ok: true, remembered: via === 'link', via, memoryId, neighbors };
  }

  ipcMain.handle('mn:memory.status', wrap(async () => llmMemory.status(await activeMemoryConfig())));
  ipcMain.handle('mn:memory.recall', wrap(async (query, limit) => llmMemory.recall(await activeMemoryConfig(), { query, limit })));
  ipcMain.handle('mn:memory.import', wrap(async vaultId => {
    const config = await activeMemoryConfig();
    return await withIndexVaultLock(vaultId, async () => llmMemory.importMemoriesToVault({
      store,
      onNoteSaved: saved => {
        vaultWatcher.markInternal(vaultId, [saved.id]);
        const indexed = runOptionalSearchIndexTask('index imported memory note', () => idx.indexNote(vaultId, saved));
        if (indexed !== null) ai.scheduleEmbed(vaultId, saved);
      },
    }, config, vaultId, {}));
  }));
  ipcMain.handle('mn:memory.remember', wrap(async (vaultId, noteId) => {
    const config = await activeMemoryConfig();
    const note = await store.getNote(vaultId, noteId);
    if (!note) throw new Error('Note not found');
    const cfg = await store.loadConfig();
    const vaultName = cfg.vaults.find(vault => vault.id === vaultId)?.name || '';
    const remembered = await llmMemory.rememberNote(config, note, { vaultId, vaultName });
    noteMemoryCache.invalidate(config);
    return remembered;
  }));
  ipcMain.handle('mn:memory.ask', wrap(async (query, options) => llmMemory.askMemory(await activeMemoryConfig(), { query, ...(options || {}) })));
  ipcMain.handle('mn:memory.graphTrace', wrap(async (query, options) => llmMemory.graphTrace(await activeMemoryConfig(), { query, ...(options || {}) })));
  ipcMain.handle('mn:memory.neighbors', wrap(async (memoryId, options) => llmMemory.graphNeighbors(await activeMemoryConfig(), { memoryId, ...(options || {}) })));
  ipcMain.handle('mn:memory.whyRelevant', wrap(async (query, memoryId, options) => llmMemory.whyRelevant(await activeMemoryConfig(), { query, memoryId, ...(options || {}) })));
  ipcMain.handle('mn:memory.graph', wrap(async () => llmMemory.getGraph(await activeMemoryConfig())));
  ipcMain.handle('mn:memory.intelligence', wrap(async options => llmMemory.memoryIntelligence(await activeMemoryConfig(), options || {})));
  ipcMain.handle('mn:memory.duplicates', wrap(async options => llmMemory.duplicates(await activeMemoryConfig(), options || {})));
  ipcMain.handle('mn:memory.connected', wrap(async (vaultId, noteId, options) => connectedForNote(await activeMemoryConfig(), vaultId, noteId, options || {})));
  ipcMain.handle('mn:memory.syncLinks', wrap(async vaultId => syncNoteLinks(await activeMemoryConfig(), vaultId)));

  return { invalidateCache: config => noteMemoryCache.invalidate(config) };
}

module.exports = { registerMemoryHandlers };
