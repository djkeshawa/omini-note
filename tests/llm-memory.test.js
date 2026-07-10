const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const llmMemory = require('../lib/llmMemory.js');

function startFakeServer(state = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let bodyText = '';
    req.on('data', chunk => { bodyText += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const record = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: bodyText ? JSON.parse(bodyText) : null };
      requests.push(record);
      const respond = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (state.requireKey && req.headers['x-api-key'] !== state.requireKey) return respond(401, { detail: 'unauthorized' });
      if (url.pathname === '/healthz') return respond(200, { status: 'ok' });
      if (url.pathname === '/memories' && req.method === 'GET') return respond(200, state.memories || []);
      if (url.pathname === '/memories' && req.method === 'POST') {
        return respond(200, { id: 'created123', ...record.body, created_at: '2026-07-05T10:00:00Z', accessed_at: '2026-07-05T10:00:00Z' });
      }
      if (url.pathname === '/recall' && req.method === 'POST') return respond(200, state.recall || []);
      if (url.pathname === '/ai/ask' && req.method === 'POST') {
        return respond(200, state.ask || {
          answer: 'Server answer with a [citation].',
          mode: 'graph',
          citations: [{ memory_id: 'abc-123', snippet: 'WAL mode', layer: 'semantic', category: 'pattern', repo_id: record.query.repo_id || record.body.repo_id || '', relevance_score: 0.71 }],
          provider_status: 'not_configured',
        });
      }
      if (url.pathname.startsWith('/graph-recall/') && req.method === 'POST') {
        return respond(200, state.graphRecall || {
          mode: url.pathname.split('/').pop(),
          query: record.body.query || '',
          nodes: [{ id: 'abc-123', content: 'Use WAL mode', layer: 'semantic', category: 'pattern', importance: 0.7, repo_id: 'my_notes', relevance_score: 0.9, relevance_factors: { seed: true, distance: 0 } }],
          edges: [{ source_id: 'abc-123', target_id: 'def-456', relationship: 'REFERENCES', strength: 0.8 }],
          explanation: 'Expanded seeds through relationships.',
          omitted: 0,
          limits: { depth: record.body.depth, limit: record.body.limit },
        });
      }
      if (url.pathname === '/graph' && req.method === 'GET') {
        return respond(200, state.graph || { nodes: [{ id: 'abc-123', group: 'semantic', label: 'WAL', full_label: 'Use WAL mode', category: 'pattern', importance: 0.7 }], links: [{ source: 'abc-123', target: 'def-456', value: 0.8, label: 'REFERENCES' }] });
      }
      if (url.pathname === '/relationships' && req.method === 'GET') {
        return respond(200, state.relationships || []);
      }
      if (url.pathname === '/relationships' && req.method === 'POST') {
        state.relationships = state.relationships || [];
        const existingIndex = state.relationships.findIndex(rel => (
          rel.source_id === record.body.source_id
          && rel.target_id === record.body.target_id
          && rel.relationship === record.body.relationship
        ));
        const created = { id: existingIndex >= 0 ? state.relationships[existingIndex].id : `rel-${state.relationships.length + 1}`, ...record.body };
        if (existingIndex >= 0) state.relationships[existingIndex] = created;
        else state.relationships.push(created);
        return respond(200, { ok: true, ...created });
      }
      if (url.pathname === '/reports/memory-intelligence' && req.method === 'GET') {
        return respond(200, state.intelligence || { insights: [], repo_id: record.query.repo_id || null });
      }
      if (url.pathname === '/quality/duplicates' && req.method === 'GET') {
        return respond(200, state.duplicates || { duplicates: [] });
      }
      if (url.pathname === '/repos' && req.method === 'POST') {
        state.repos = state.repos || new Set();
        if (state.repos.has(record.body.id)) return respond(409, { detail: `Repository already exists: ${record.body.id}` });
        state.repos.add(record.body.id);
        return respond(200, { id: record.body.id, name: record.body.name });
      }
      respond(404, { detail: 'not found' });
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        requests,
        config: llmMemory.normalizeMemoryConfig({
          serverUrl: `http://127.0.0.1:${server.address().port}`,
          repoId: state.repoId || 'my_notes',
          apiKey: state.apiKey || '',
        }),
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

const MEMORIES = [
  { id: 'abc-123', content: '## Fix pattern\nUse WAL mode for concurrent sqlite readers.', layer: 'semantic', category: 'pattern', importance: 0.7, tags: ['sqlite'], created_at: '2026-07-01T08:00:00Z' },
  { id: 'def 456', content: 'Second memory content.', layer: 'episodic', category: 'event', importance: 0.4, tags: [], created_at: '2026-07-02T08:00:00Z' },
  { id: 'empty-1', content: '   ', layer: 'episodic', category: 'event', importance: 0.1, tags: [], created_at: '2026-07-03T08:00:00Z' },
];

test('normalizeMemoryConfig pins the server to localhost', () => {
  assert.equal(llmMemory.normalizeMemoryConfig({}).baseUrl, 'http://127.0.0.1:8000');
  assert.equal(llmMemory.normalizeMemoryConfig({ serverUrl: 'http://localhost:9000/' }).baseUrl, 'http://localhost:9000');
  assert.throws(() => llmMemory.normalizeMemoryConfig({ serverUrl: 'http://evil.example.com:8000' }), /localhost/);
  assert.throws(() => llmMemory.normalizeMemoryConfig({ serverUrl: 'ftp://127.0.0.1' }), /http/);
});

test('client calls carry repo id and API key, and shape results', async () => {
  const fake = await startFakeServer({ memories: MEMORIES, requireKey: 'k1', apiKey: 'k1', recall: [MEMORIES[0]] });
  try {
    const st = await llmMemory.status(fake.config);
    assert.equal(st.reachable, true);

    const list = await llmMemory.listMemories(fake.config, { limit: 10 });
    assert.equal(list.length, 3);
    assert.equal(list[0].id, 'abc-123');
    assert.equal(fake.requests.find(r => r.path === '/memories').query.repo_id, 'my_notes');

    const recalled = await llmMemory.recall(fake.config, { query: 'sqlite', limit: 5 });
    assert.equal(recalled.length, 1);
    const recallReq = fake.requests.find(r => r.path === '/recall');
    assert.equal(recallReq.body.repo_id, 'my_notes');
    assert.equal(recallReq.headers['x-api-key'], 'k1');

    const created = await llmMemory.createMemory(fake.config, { content: 'A new memory', tags: ['x'] });
    assert.equal(created.id, 'created123');
    const createReq = fake.requests.find(r => r.path === '/memories' && r.method === 'POST');
    assert.equal(createReq.body.source, 'vispnote');

    await assert.rejects(llmMemory.recall(fake.config, { query: '' }), /empty/);
  } finally {
    await fake.close();
  }
});

test('client surfaces auth failures instead of fabricating results', async () => {
  const fake = await startFakeServer({ memories: MEMORIES, requireKey: 'right-key', apiKey: 'wrong-key' });
  try {
    await assert.rejects(llmMemory.listMemories(fake.config, {}), /unauthorized|401/);
    const st = await llmMemory.status(fake.config);
    assert.equal(st.reachable, false);
  } finally {
    await fake.close();
  }
});

test('memoryToNote builds provenance properties and safe note ids', () => {
  const note = llmMemory.__test.memoryToNote(llmMemory.__test.publicMemory(MEMORIES[0]));
  assert.equal(note.id, 'mem_abc-123');
  assert.equal(note.title, 'Fix pattern');
  assert.match(note.body, /^source:: llm-memory\nmemoryId:: abc-123\nmemoryLayer:: semantic\nmemoryCategory:: pattern\nmemoryCreated:: 2026-07-01\n/);
  assert.match(note.body, /Use WAL mode/);
  assert.deepEqual(note.tags, ['memory', 'sqlite']);

  const spaced = llmMemory.__test.memoryNoteId('def 456');
  assert.equal(spaced, 'mem_def_456');
});

test('importMemoriesToVault creates notes once and never overwrites edits', async () => {
  const previousVispnoteHome = process.env.VISPNOTE_HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-memory-'));
  const storePath = require.resolve('../lib/store');
  delete require.cache[storePath];
  process.env.VISPNOTE_HOME = tmpHome;
  const fake = await startFakeServer({ memories: MEMORIES });
  try {
    const store = require('../lib/store');
    const cfg = await store.loadConfig();
    const vaultId = cfg.vaults[0].id;
    const indexed = [];

    const first = await llmMemory.importMemoriesToVault(
      { store, onNoteSaved: (n) => indexed.push(n.id) },
      fake.config, vaultId, {}
    );
    assert.equal(first.imported, 2, 'blank-content memory is skipped');
    assert.equal(first.skipped, 1);
    assert.deepEqual(indexed.sort(), ['mem_abc-123', 'mem_def_456']);

    // Human edits the note; a re-import must not clobber it.
    const edited = await store.getNote(vaultId, 'mem_abc-123');
    await store.saveNote(vaultId, { ...edited, body: `${edited.body}\n\nHuman note.` });

    const second = await llmMemory.importMemoriesToVault({ store }, fake.config, vaultId, {});
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 3);
    const preserved = await store.getNote(vaultId, 'mem_abc-123');
    assert.match(preserved.body, /Human note\./);
  } finally {
    await fake.close();
    delete require.cache[storePath];
    if (previousVispnoteHome === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previousVispnoteHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('rememberNote distills title and body with vault metadata', async () => {
  const fake = await startFakeServer({});
  try {
    const created = await llmMemory.rememberNote(fake.config, {
      id: 'n1', title: 'Design call', body: 'Decided to keep vaults flat.', tags: ['work'],
    }, { vaultId: 'vault-1', vaultName: 'Personal' });
    assert.equal(created.id, 'created123');
    const req = fake.requests.find(r => r.path === '/memories' && r.method === 'POST');
    assert.match(req.body.content, /^# Design call\n\nDecided to keep vaults flat\./);
    assert.deepEqual(req.body.tags, ['work', 'vispnote']);
    assert.equal(req.body.metadata.vispnote_note_id, 'n1');
    assert.equal(req.body.metadata.vispnote_vault_id, 'vault-1');
    assert.equal(req.body.metadata.vispnote_vault, 'Personal');
  } finally {
    await fake.close();
  }
});

test('rememberNote registers the configured project when the server lacks it', async () => {
  const fake = await startFakeServer({});
  try {
    await llmMemory.rememberNote(fake.config, { id: 'n1', title: 'Design call', body: 'x' }, {});
    const repoReq = fake.requests.find(r => r.path === '/repos' && r.method === 'POST');
    assert.deepEqual(repoReq.body, { id: 'my_notes', name: 'my_notes' });

    // Second remember hits the 409 "already exists" path and still succeeds.
    const again = await llmMemory.rememberNote(fake.config, { id: 'n2', title: 'Another', body: 'y' }, {});
    assert.equal(again.id, 'created123');
  } finally {
    await fake.close();
  }
});

test('publicMemory preserves provenance metadata for note↔memory mapping', () => {
  const shaped = llmMemory.__test.publicMemory({ id: 'm1', content: 'x', metadata: { vispnote_note_id: 'n42' } });
  assert.deepEqual(shaped.metadata, { vispnote_note_id: 'n42' });
  assert.deepEqual(llmMemory.__test.publicMemory({ id: 'm2', content: 'y' }).metadata, {});
  assert.deepEqual(llmMemory.__test.publicMemory({ id: 'm3', content: 'z', metadata: ['bad'] }).metadata, {});
});

test('listMemories honors an explicit maxLimit above the default import cap', async () => {
  const fake = await startFakeServer({ memories: [] });
  try {
    await llmMemory.listMemories(fake.config, { limit: 2000, maxLimit: 2000 });
    const high = fake.requests.find(r => r.path === '/memories');
    assert.equal(high.query.limit, '2000', 'the high internal ceiling is sent, not clamped to 200');

    await llmMemory.listMemories(fake.config, { limit: 999 });
    const clamped = fake.requests.filter(r => r.path === '/memories').pop();
    assert.equal(clamped.query.limit, '200', 'without maxLimit the default import cap still applies');
  } finally {
    await fake.close();
  }
});

test('askMemory shapes the server answer and citations and scopes to the repo', async () => {
  const fake = await startFakeServer({});
  try {
    const res = await llmMemory.askMemory(fake.config, { query: 'what pattern', limit: 3 });
    assert.match(res.answer, /Server answer/);
    assert.equal(res.mode, 'graph');
    assert.equal(res.citations.length, 1);
    assert.equal(res.citations[0].memoryId, 'abc-123');
    assert.equal(res.citations[0].relevanceScore, 0.71);
    assert.equal(res.providerStatus, 'not_configured', 'provider_status is a string enum, not an object');
    const req = fake.requests.find(r => r.path === '/ai/ask');
    assert.equal(req.body.repo_id, 'my_notes');
    assert.equal(req.body.limit, 3);
    assert.equal(req.body.require_citations, true);
    await assert.rejects(llmMemory.askMemory(fake.config, { query: '  ' }), /empty/);
  } finally {
    await fake.close();
  }
});

test('graphTrace maps nodes/edges/explanation and clamps depth and limit', async () => {
  const fake = await startFakeServer({});
  try {
    // A legacy array input must be normalized to a single string — the live
    // server types relationship_filter as anyOf string|null and 422s on arrays.
    const res = await llmMemory.graphTrace(fake.config, { query: 'sqlite', depth: 99, limit: 999, relationshipFilter: ['references'] });
    assert.equal(res.mode, 'trace');
    assert.equal(res.nodes.length, 1);
    assert.equal(res.nodes[0].id, 'abc-123');
    assert.equal(res.nodes[0].relevanceScore, 0.9);
    assert.equal(res.edges[0].relationship, 'REFERENCES');
    assert.match(res.explanation, /Expanded seeds/);
    const req = fake.requests.find(r => r.path === '/graph-recall/trace');
    assert.equal(req.body.depth, 4, 'depth clamps to MAX_GRAPH_DEPTH');
    assert.equal(req.body.limit, 50, 'limit clamps to MAX_GRAPH_LIMIT');
    assert.equal(req.body.relationship_filter, 'REFERENCES', 'relationship_filter is a single normalized string, not an array');
    assert.equal(req.body.repo_id, 'my_notes');
  } finally {
    await fake.close();
  }
});

test('graphNeighbors, graphPath and whyRelevant send validated ids', async () => {
  const fake = await startFakeServer({});
  try {
    await llmMemory.graphNeighbors(fake.config, { memoryId: 'abc-123', limit: 5 });
    assert.equal(fake.requests.find(r => r.path === '/graph-recall/neighbors').body.memory_id, 'abc-123');

    await llmMemory.graphPath(fake.config, { sourceId: 'abc-123', targetId: 'def-456' });
    const pathReq = fake.requests.find(r => r.path === '/graph-recall/path');
    assert.equal(pathReq.body.source_id, 'abc-123');
    assert.equal(pathReq.body.target_id, 'def-456');

    await llmMemory.whyRelevant(fake.config, { query: 'q', memoryId: 'abc-123' });
    assert.equal(fake.requests.find(r => r.path === '/graph-recall/why-relevant').body.memory_id, 'abc-123');

    await assert.rejects(llmMemory.graphNeighbors(fake.config, { memoryId: 'bad id!' }), /Invalid memory id/);
    await assert.rejects(llmMemory.graphNeighbors(fake.config, { memoryId: '' }), /empty/);
  } finally {
    await fake.close();
  }
});

test('getGraph maps nodes and links into a stable renderer shape', async () => {
  const fake = await startFakeServer({});
  try {
    const graph = await llmMemory.getGraph(fake.config);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'abc-123');
    assert.equal(graph.nodes[0].fullLabel, 'Use WAL mode');
    assert.equal(graph.links.length, 1);
    assert.equal(graph.links[0].source, 'abc-123');
    assert.equal(graph.links[0].target, 'def-456');
    assert.equal(graph.links[0].relationship, 'REFERENCES');
    assert.equal(graph.links[0].strength, 0.8);
  } finally {
    await fake.close();
  }
});

test('addRelationship normalizes the type, clamps strength, and rejects self-loops', async () => {
  const fake = await startFakeServer({});
  try {
    await llmMemory.addRelationship(fake.config, { sourceId: 'abc-123', targetId: 'def-456', relationship: 'references note', strength: 5 });
    const req = fake.requests.find(r => r.path === '/relationships' && r.method === 'POST');
    assert.equal(req.body.relationship, 'REFERENCES_NOTE');
    assert.equal(req.body.strength, 1, 'strength clamps to [0,1]');
    await assert.rejects(llmMemory.addRelationship(fake.config, { sourceId: 'abc-123', targetId: 'abc-123' }), /itself/);
  } finally {
    await fake.close();
  }
});

test('syncNoteLinks skips unmanaged existing edges, self-loops, and duplicate input', async () => {
  const fake = await startFakeServer({ relationships: [{ id: 'r0', source_id: 'abc-123', target_id: 'def-456', relationship: 'REFERENCES', strength: 0.9 }] });
  try {
    const first = await llmMemory.syncNoteLinks(fake.config, [
      { sourceMemoryId: 'abc-123', targetMemoryId: 'def-456' },  // already exists → skipped
      { sourceMemoryId: 'abc-123', targetMemoryId: 'ghi-789' },  // new → created
      { sourceMemoryId: 'xyz-000', targetMemoryId: 'xyz-000' },  // self-loop → dropped
      { sourceMemoryId: 'abc-123', targetMemoryId: 'ghi-789' },  // duplicate of #2 → deduped
    ]);
    assert.equal(first.created, 1, 'only the one genuinely new edge is created');
    assert.equal(first.total, 1);

    // Re-syncing the same edges creates nothing: the new edge now exists too.
    const second = await llmMemory.syncNoteLinks(fake.config, [
      { sourceMemoryId: 'abc-123', targetMemoryId: 'def-456' },
      { sourceMemoryId: 'abc-123', targetMemoryId: 'ghi-789' },
    ]);
    assert.equal(second.created, 0, 're-sync is idempotent');
  } finally {
    await fake.close();
  }
});

test('syncNoteLinks updates managed edges and reports conflicts, stale edges, and batching', async () => {
  const fake = await startFakeServer({ relationships: [
    { id: 'r0', source_id: 'abc-123', target_id: 'def-456', relationship: 'REFERENCES', strength: 0.9, evidence: { source: 'vispnote' } },
    { id: 'r1', source_id: 'abc-123', target_id: 'manual-1', relationship: 'REFERENCES', strength: 1, evidence: { source: 'manual' } },
    { id: 'stale', source_id: 'stale-1', target_id: 'stale-2', relationship: 'REFERENCES', strength: 1, evidence: { source: 'vispnote' } },
  ] });
  try {
    const result = await llmMemory.syncNoteLinks(fake.config, [
      { sourceMemoryId: 'abc-123', targetMemoryId: 'def-456', strength: 0.4 },
      { sourceMemoryId: 'abc-123', targetMemoryId: 'ghi-789' },
      { sourceMemoryId: 'abc-123', targetMemoryId: 'manual-1' },
    ]);
    assert.equal(result.created, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.unmanagedConflicts, 1);
    assert.equal(result.staleManaged, 1);
    assert.equal(result.total, 2);
    assert.equal(fake.requests.find(r => r.path === '/relationships' && r.method === 'POST').body.strength, 0.4);

    const edges = Array.from({ length: 501 }, (_, index) => ({ sourceMemoryId: `source-${index}`, targetMemoryId: `target-${index}` }));
    const batched = await llmMemory.syncNoteLinks(fake.config, edges);
    assert.equal(batched.created, 500);
    assert.equal(batched.remaining, 1);
    assert.equal(batched.batchLimited, true);
    assert.equal(batched.eligible, 501);
  } finally {
    await fake.close();
  }
});

test('memoryIntelligence and duplicates pass repo scope and limits', async () => {
  const fake = await startFakeServer({});
  try {
    await llmMemory.memoryIntelligence(fake.config, { limit: 10 });
    const intel = fake.requests.find(r => r.path === '/reports/memory-intelligence');
    assert.equal(intel.query.repo_id, 'my_notes');
    assert.equal(intel.query.limit, '10');

    await llmMemory.duplicates(fake.config, { layer: 'semantic', limit: 5 });
    const dup = fake.requests.find(r => r.path === '/quality/duplicates');
    assert.equal(dup.query.layer, 'semantic');
    assert.equal(dup.query.limit, '5');
  } finally {
    await fake.close();
  }
});

test('rememberNote without a configured project creates one from the note name', async () => {
  const fake = await startFakeServer({ repoId: ' ' });
  try {
    const created = await llmMemory.rememberNote(fake.config, {
      id: 'n1', title: 'Novel Research: Act 2!', body: 'Outline.',
    }, {});
    const repoReq = fake.requests.find(r => r.path === '/repos' && r.method === 'POST');
    assert.deepEqual(repoReq.body, { id: 'novel_research_act_2', name: 'Novel Research: Act 2!' });
    const memoryReq = fake.requests.find(r => r.path === '/memories' && r.method === 'POST');
    assert.equal(memoryReq.body.repo_id, 'novel_research_act_2');
    assert.equal(created.repoId, 'novel_research_act_2');

    // A title with no usable characters falls back to a stable project id.
    await llmMemory.rememberNote(fake.config, { id: 'n2', title: '!!!', body: 'z' }, {});
    const fallbackReq = fake.requests.filter(r => r.path === '/repos' && r.method === 'POST').pop();
    assert.equal(fallbackReq.body.id, 'vispnote');
  } finally {
    await fake.close();
  }
});
