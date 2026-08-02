const test = require('node:test');
const assert = require('node:assert/strict');

const { registerMemoryHandlers } = require('../lib/connectors/ipc/memoryHandlers.js');

// The llm-memory IPC boundary. Behaviours: nothing works without the plugin
// enabled (and the error tells the user where to fix it), memory recall
// prefers the graph but falls back to plain recall, remembering a note
// invalidates the cached memory index so the next sync sees it, and
// "connected memories" degrades from an explicit link to a recall guess to a
// plain not-remembered answer.

function setup({ pluginEnabled = true, traceNodes = null, recallSeeds = [], memories = [], neighbors = { nodes: [] } } = {}) {
  const calls = { recalls: [], traces: [], remembered: [], listCalls: 0, embedScheduled: [] };
  const handlers = {};
  let recallProvider = null;
  const plugin = { type: 'llm-memory', enabled: pluginEnabled, config: { serverUrl: 'http://127.0.0.1:9000' } };
  const deps = {
    wrap: fn => fn,
    store: {
      getPrefs: async () => ({ tweaks: { plugins: pluginEnabled === null ? [] : [plugin] } }),
      loadVault: async () => ({ notes: [{ id: 'n1', title: 'One', body: '[[Two]]' }] }),
      getNote: async (_v, id) => (id === 'n1' ? { id: 'n1', title: 'One', body: 'body text' } : null),
      loadConfig: async () => ({ vaults: [{ id: 'v1', name: 'Vault One' }] }),
    },
    idx: { indexNote: () => {} },
    ai: {
      setMemoryRecallProvider: fn => { recallProvider = fn; },
      scheduleEmbed: (_v, note) => calls.embedScheduled.push(note.id),
    },
    llmMemory: {
      normalizeMemoryConfig: config => ({ ...config, normalized: true }),
      graphTrace: async (config, args) => { calls.traces.push(args); if (traceNodes === null) throw new Error('no graph'); return { nodes: traceNodes }; },
      recall: async (config, args) => { calls.recalls.push(args); return recallSeeds; },
      listMemories: async () => { calls.listCalls += 1; return memories; },
      rememberNote: async (config, note) => { calls.remembered.push(note.id); return { ok: true, memoryId: 'm-new' }; },
      graphNeighbors: async (config, args) => ({ ...neighbors, args }),
      syncNoteLinks: async () => ({ created: 0, updated: 0 }),
      status: async () => ({ ok: true }),
    },
    memoryLinks: {
      noteMemoryIndex: mems => {
        const map = new Map(mems.map(m => [m.noteId, { memoryId: m.id }]));
        map.stats = {};
        return map;
      },
      buildNoteLinkEdges: () => ({ edges: [], stats: { wikiLinks: 0, linkedNotesMissingMemory: 0, ambiguousTitles: 0 } }),
    },
    withIndexVaultLock: async (_v, fn) => fn(),
    runOptionalSearchIndexTask: (_l, fn) => { try { return fn(); } catch { return null; } },
  };
  const api = registerMemoryHandlers({ handle: (channel, fn) => { handlers[channel] = fn; } }, deps);
  return { handlers, calls, recallProvider: (...a) => recallProvider(...a), api };
}

test('every memory feature refuses with guidance when the plugin is off', async () => {
  const { handlers } = setup({ pluginEnabled: false });
  for (const channel of ['mn:memory.status', 'mn:memory.recall', 'mn:memory.graph']) {
    await assert.rejects(() => handlers[channel]('q'), /Enable the LLM Memory bridge plugin/,
      `${channel} did not tell the user where to fix it`);
  }
});

test('AI memory recall prefers the graph and falls back to plain recall', async () => {
  // Graph available: its nodes are used, no plain recall.
  const withGraph = setup({ traceNodes: [{ id: 'm1', content: 'from graph', layer: 'l', category: 'c', importance: 1 }] });
  const graphResult = await withGraph.recallProvider({ query: 'q', limit: 5 });
  assert.equal(graphResult[0].content, 'from graph');
  assert.equal(withGraph.calls.recalls.length, 0, 'plain recall ran despite graph results');
  // Graph down: plain recall answers instead of the feature dying.
  const noGraph = setup({ traceNodes: null, recallSeeds: [{ id: 'm2', content: 'from recall' }] });
  const fallback = await noGraph.recallProvider({ query: 'q', limit: 5 });
  assert.equal(fallback[0].content, 'from recall');
});

test('the recall limit is clamped to something the server accepts', async () => {
  const { recallProvider, calls } = setup({ traceNodes: [] , recallSeeds: [] });
  await recallProvider({ query: 'q', limit: 9999 });
  assert.ok(calls.traces[0].limit <= 12, `limit ${calls.traces[0].limit} exceeds the clamp`);
  await recallProvider({ query: 'q', limit: -5 });
  assert.ok(calls.traces[1].limit >= 1, 'a negative limit must clamp up, not disable recall');
});

test('remembering a note invalidates the cached index so the next sync sees it', async () => {
  const { handlers, calls } = setup({ memories: [] });
  await handlers['mn:memory.syncLinks']('v1');
  assert.equal(calls.listCalls, 1);
  await handlers['mn:memory.syncLinks']('v1');
  assert.equal(calls.listCalls, 1, 'the 30s cache should serve the second sync');
  await handlers['mn:memory.remember']('v1', 'n1');
  await handlers['mn:memory.syncLinks']('v1');
  assert.equal(calls.listCalls, 2, 'remembering a note must bust the cache, or the new memory is invisible');
});

test('remembering a missing note fails instead of storing an empty memory', async () => {
  const { handlers } = setup();
  await assert.rejects(() => handlers['mn:memory.remember']('v1', 'ghost'), /Note not found/);
});

test('connected memories reports how the note was matched', async () => {
  // Explicitly linked: via 'link', remembered true.
  const linked = setup({ memories: [{ id: 'm-linked', noteId: 'n1' }] });
  const viaLink = await linked.handlers['mn:memory.connected']('v1', 'n1', {});
  assert.equal(viaLink.remembered, true);
  assert.equal(viaLink.via, 'link');
  assert.equal(viaLink.memoryId, 'm-linked');
  // Not linked but recall finds a candidate: via 'recall', remembered false --
  // the UI must present a guess as a guess.
  const guessed = setup({ recallSeeds: [{ id: 'm-guess' }] });
  const viaRecall = await guessed.handlers['mn:memory.connected']('v1', 'n1', {});
  assert.equal(viaRecall.remembered, false);
  assert.equal(viaRecall.via, 'recall');
  // Nothing at all: an honest not-remembered answer, no neighbors call.
  const nothing = setup();
  const none = await nothing.handlers['mn:memory.connected']('v1', 'n1', {});
  assert.equal(none.remembered, false);
  assert.equal(none.memoryId, '');
  assert.equal(none.neighbors, null);
});

test('neighbor depth and limit are clamped before reaching the server', async () => {
  const { handlers } = setup({ memories: [{ id: 'm1', noteId: 'n1' }] });
  const result = await handlers['mn:memory.connected']('v1', 'n1', { depth: 99, limit: 9999 });
  assert.ok(result.neighbors.args.depth <= 3, `depth ${result.neighbors.args.depth} not clamped`);
  assert.ok(result.neighbors.args.limit <= 30, `limit ${result.neighbors.args.limit} not clamped`);
});
