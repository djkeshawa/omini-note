const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const client = require('../lib/integrations/memory/client.js');
const t = client.__test;

// What the llm-memory client does with payloads that are not the happy one.
// The server has changed field names across versions (source/source_id,
// links/edges, score/relevance_score) and omits fields it has nothing to say
// about. Every mapper here has to survive that without inventing values --
// llm-memory.test.js pins the well-formed case, this pins the rest.

function startServer(handler) {
  const server = http.createServer((req, res) => {
    let bodyText = '';
    req.on('data', chunk => { bodyText += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      handler({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: bodyText ? JSON.parse(bodyText) : null }, res);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      config: client.normalizeMemoryConfig({ serverUrl: `http://127.0.0.1:${server.address().port}`, repoId: '' }),
      close: () => new Promise(done => server.close(done)),
    }));
  });
}

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
};

test('an unreachable server is reported, not thrown as a network error', async () => {
  // Port 1 is reserved and nothing listens on it.
  const config = client.normalizeMemoryConfig({ serverUrl: 'http://127.0.0.1:1' });
  const st = await client.status(config);
  assert.equal(st.reachable, false);
  assert.match(st.error, /not reachable at http:\/\/127\.0\.0\.1:1/);
  await assert.rejects(client.listMemories(config, {}), /not reachable/);
});

test('a server error keeps its own message, or names the status when it has none', async () => {
  const fake = await startServer((req, res) => {
    if (req.path === '/memories') return json(res, 500, 'the database is on fire');
    if (req.path === '/relationships') return json(res, 503, '');
    return json(res, 404, '');
  });
  try {
    await assert.rejects(client.listMemories(fake.config, {}), /the database is on fire/);
    await assert.rejects(client.listRelationships(fake.config), /llm-memory server returned 503/);
  } finally {
    await fake.close();
  }
});

test('an empty or unparseable response body does not become a fake result', async () => {
  const fake = await startServer((req, res) => {
    if (req.path === '/memories') return json(res, 200, '');
    if (req.path === '/relationships') return json(res, 200, 'not json at all');
    return json(res, 200, {});
  });
  try {
    assert.deepEqual(await client.listMemories(fake.config, {}), [],
      'a 200 with no body is no memories, not a crash');
    await assert.rejects(client.listRelationships(fake.config), /not reachable/,
      'a body that is not JSON is treated as a broken server');
  } finally {
    await fake.close();
  }
});

test('a response that is not the expected shape yields empty collections', async () => {
  const fake = await startServer((req, res) => json(res, 200, { nope: true }));
  try {
    assert.deepEqual(await client.listMemories(fake.config, {}), []);
    assert.deepEqual(await client.recall(fake.config, { query: 'x' }), []);
    assert.deepEqual(await client.listRelationships(fake.config), []);
    const graph = await client.getGraph(fake.config);
    assert.deepEqual(graph, { nodes: [], links: [] });
    const trace = await client.graphTrace(fake.config, { query: 'x' });
    assert.deepEqual(trace.nodes, []);
    assert.deepEqual(trace.edges, []);
    assert.equal(trace.explanation, '');
    assert.equal(trace.omitted, null);
    assert.equal(trace.limits, null);
    const asked = await client.askMemory(fake.config, { query: 'x' });
    assert.deepEqual(asked, { answer: '', mode: '', citations: [], providerStatus: null });
  } finally {
    await fake.close();
  }
});

test('empty content and ids are refused before a request is made', async () => {
  const config = client.normalizeMemoryConfig({ serverUrl: 'http://127.0.0.1:1' });
  await assert.rejects(client.createMemory(config, { content: '   ' }), /Memory content is empty/);
  await assert.rejects(client.createMemory(config, {}), /Memory content is empty/);
  await assert.rejects(client.recall(config, {}), /recall query is empty/);
  await assert.rejects(client.askMemory(config, {}), /Ask memory query is empty/);
  await assert.rejects(client.graphTrace(config, {}), /Graph trace query is empty/);
  await assert.rejects(client.whyRelevant(config, { memoryId: 'abc' }), /Why-relevant query is empty/);
  await assert.rejects(client.ensureRepo(config, {}), /Project id is empty/);
  await assert.rejects(client.graphPath(config, { sourceId: 'abc', targetId: 'bad id!' }), /Invalid memory id/);
});

test('a request without a repo id or optional params omits them entirely', async () => {
  const seen = [];
  const fake = await startServer((req, res) => { seen.push(req); json(res, 200, req.method === 'GET' ? [] : {}); });
  try {
    await client.listMemories(fake.config, {});
    assert.equal('repo_id' in seen[0].query, false, 'an unset repo id is not sent as an empty string');
    assert.equal('layer' in seen[0].query, false);

    await client.listMemories(fake.config, { limit: 5, layer: 'semantic' });
    assert.equal(seen[1].query.layer, 'semantic');
    assert.equal(seen[1].query.limit, '5');

    await client.recall(fake.config, { query: 'q' });
    assert.equal('repo_id' in seen[2].body, false);
    assert.equal(seen[2].body.limit, 8, 'recall defaults to 8 results');

    await client.memoryIntelligence(fake.config, {});
    assert.equal('limit' in seen[3].query, false, 'an absent limit is not sent as a default');
    await client.memoryIntelligence(fake.config, { limit: 999 });
    assert.equal(seen[4].query.limit, '100', 'a limit above the ceiling is clamped');

    await client.duplicates(fake.config, {});
    assert.deepEqual(seen[5].query, {});
    await client.duplicates(fake.config, { layer: 'semantic', category: 'pattern', limit: 3 });
    assert.deepEqual(seen[6].query, { layer: 'semantic', category: 'pattern', limit: '3' });

    await client.graphTrace(fake.config, { query: 'q' });
    assert.equal('relationship_filter' in seen[7].body, false, 'no filter means no key, not a null');
    await client.graphNeighbors(fake.config, { memoryId: 'abc', relationshipFilter: '' });
    assert.equal('relationship_filter' in seen[8].body, false, 'an empty filter is the same as none');
    await client.graphNeighbors(fake.config, { memoryId: 'abc', relationshipFilter: ['refers to', 'ignored'] });
    assert.equal(seen[9].body.relationship_filter, 'REFERS_TO', 'a legacy array sends only its first entry');
  } finally {
    await fake.close();
  }
});

test('createMemory clamps and cleans everything it is given', async () => {
  const seen = [];
  const fake = await startServer((req, res) => { seen.push(req); json(res, 200, { id: 'm1' }); });
  try {
    await client.createMemory(fake.config, {
      content: 'hello',
      importance: 42,
      tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
      metadata: 'not an object',
    });
    assert.equal(seen[0].body.importance, 1, 'importance clamps to [0,1]');
    assert.equal(seen[0].body.tags.length, 12, 'at most twelve tags are sent');
    assert.deepEqual(seen[0].body.metadata, {}, 'metadata that is not an object is dropped');
    assert.equal(seen[0].body.category, 'note', 'the default category is note');

    await client.createMemory(fake.config, { content: 'hello', importance: -5, tags: 'not a list', metadata: { a: 1 } });
    assert.equal(seen[1].body.importance, 0, 'a negative importance clamps to zero');
    assert.deepEqual(seen[1].body.tags, [], 'tags that are not a list are dropped');
    assert.deepEqual(seen[1].body.metadata, { a: 1 });

    await client.createMemory(fake.config, { content: 'hello', importance: 'lots', category: 'x'.repeat(80) });
    assert.equal(seen[2].body.importance, 0.5, 'an unreadable importance falls back to the default');
    assert.equal(seen[2].body.category.length, 60, 'the category is length-capped');
  } finally {
    await fake.close();
  }
});

test('rememberNote names the project after the note when none is configured', async () => {
  const seen = [];
  const fake = await startServer((req, res) => { seen.push(req); json(res, 200, { id: 'm1' }); });
  try {
    await client.rememberNote(fake.config, { title: '  Weekly Review!  ', body: 'x' }, {});
    assert.deepEqual(seen[0].body, { id: 'weekly_review', name: 'Weekly Review!' },
      'the note title becomes the project, slugged for the id and kept for the name');
    // A title with nothing sluggable still needs a project to land in.
    await client.rememberNote(fake.config, { title: '???', body: 'x' }, {});
    assert.equal(seen[2].body.id, 'vispnote');
    // No title, no body, no vault: still a valid memory. Each remember is two
    // requests -- register the project, then post the memory.
    await client.rememberNote(fake.config, null, {});
    assert.equal(seen[5].body.content, '# Untitled', 'an empty body leaves just the heading, trimmed');
    assert.deepEqual(seen[5].body.metadata, { vispnote_note_id: '' },
      'no vault means no vault keys, not empty ones');
  } finally {
    await fake.close();
  }
});

test('ensureRepo treats "already exists" as success and rethrows anything else', async () => {
  const fake = await startServer((req, res) => {
    if (req.body.id === 'exists') return json(res, 409, 'Repository already exists');
    if (req.body.id === 'broken') return json(res, 500, 'boom');
    return json(res, 200, { id: req.body.id });
  });
  try {
    assert.deepEqual(await client.ensureRepo(fake.config, { repoId: 'fresh' }), { repoId: 'fresh', created: true });
    assert.deepEqual(await client.ensureRepo(fake.config, { repoId: 'exists' }), { repoId: 'exists', created: false });
    await assert.rejects(client.ensureRepo(fake.config, { repoId: 'broken' }), /boom/);
  } finally {
    await fake.close();
  }
});

test('graph nodes and edges are read under either field name the server uses', async () => {
  const recall = t.publicGraphRecall({
    mode: 'trace',
    nodes: [{}, { id: 'n1', content: 'c', layer: 'semantic', category: 'pattern', importance: 0.5, repo_id: 'r', relevance_score: 0.25, relevance_factors: { seed: true } }],
    edges: [
      { source: 'a', target: 'b', label: 'REFERENCES', value: 0.5 },
      { source_id: 'c', target_id: 'd', relationship: 'FOLLOWS', strength: 0.25 },
      {},
    ],
    omitted: 3,
    limits: { depth: 2 },
  });
  assert.deepEqual(recall.nodes[0], {
    id: '', content: '', layer: '', category: '', importance: 0, repoId: '',
    relevanceScore: null, relevanceFactors: null,
  }, 'an empty node maps to empty strings and nulls, never undefined');
  assert.equal(recall.nodes[1].relevanceScore, 0.25);
  assert.deepEqual(recall.nodes[1].relevanceFactors, { seed: true });
  assert.deepEqual(recall.edges[0], { sourceId: 'a', targetId: 'b', relationship: 'REFERENCES', strength: 0.5 },
    'the short field names are the older spelling of the same edge');
  assert.deepEqual(recall.edges[1], { sourceId: 'c', targetId: 'd', relationship: 'FOLLOWS', strength: 0.25 });
  assert.equal(recall.edges[2].strength, null, 'a missing strength is null, not zero');
  assert.equal(recall.omitted, 3);
  assert.deepEqual(recall.limits, { depth: 2 });

  const bare = t.publicGraphRecall();
  assert.deepEqual(bare, { mode: '', query: '', nodes: [], edges: [], explanation: '', omitted: null, limits: null });
  assert.deepEqual(t.publicGraphRecall({ nodes: 'x', edges: 'y', limits: 'z' }).nodes, []);
  assert.equal(t.publicGraphRecall({ limits: 'z' }).limits, null);
});

test('the full graph reads links under either name and drops incomplete rows', async () => {
  const fake = await startServer((req, res) => json(res, 200, {
    nodes: [
      { id: 'n1', layer: 'semantic', full_label: 'Full', category: 'pattern', importance: 0.5 },
      { id: 'n2', group: 'episodic', fullLabel: 'Camel', label: 'N2' },
      { id: 'n3', content: 'content is the last resort for a label' },
      { label: 'no id' },
    ],
    edges: [
      { source_id: 'n1', target_id: 'n2', relationship: 'FOLLOWS', strength: 0.4 },
      { source: 'n1', target: '' },
    ],
  }));
  try {
    const graph = await client.getGraph(fake.config);
    assert.deepEqual(graph.nodes.map(n => n.id), ['n1', 'n2', 'n3'], 'a node with no id is dropped');
    assert.equal(graph.nodes[0].group, 'semantic', 'group falls back to the layer');
    assert.equal(graph.nodes[0].fullLabel, 'Full');
    assert.equal(graph.nodes[1].fullLabel, 'Camel');
    assert.equal(graph.nodes[2].fullLabel, 'content is the last resort for a label');
    assert.equal(graph.nodes[1].category, '');
    assert.equal(graph.nodes[1].importance, null, 'no importance is null, not zero');
    assert.deepEqual(graph.links, [{ source: 'n1', target: 'n2', relationship: 'FOLLOWS', strength: 0.4 }],
      'links can arrive under `edges`, and a link missing an end is dropped');
  } finally {
    await fake.close();
  }
});

test('citations and relationships tolerate every field spelling', () => {
  assert.deepEqual(t.publicCitation(), {
    memoryId: '', snippet: '', layer: '', category: '', repoId: '', relevanceScore: null,
  });
  assert.deepEqual(t.publicCitation({ id: 'c1', content: 'snip', score: 0.5, repo_id: 'r' }), {
    memoryId: 'c1', snippet: 'snip', layer: '', category: '', repoId: 'r', relevanceScore: 0.5,
  }, 'id/content/score are the older names for memory_id/snippet/relevance_score');
  assert.equal(t.publicCitation({ relevance_score: 0, score: 0.9 }).relevanceScore, 0,
    'a score of zero is a score, not a missing value');

  assert.deepEqual(t.publicRelationship(), {
    id: '', sourceId: '', targetId: '', relationship: '', strength: null,
    evidence: { source: '', reason: '', createdBy: '' },
  });
  assert.equal(t.publicRelationship({ evidence: ['bad'] }).evidence.source, '',
    'evidence that is not an object is ignored rather than read as one');
  assert.equal(t.publicRelationship({ evidence: { createdBy: 'me' } }).evidence.createdBy, 'me');
  assert.equal(t.publicRelationship({ evidence: { created_by: 'snake' } }).evidence.createdBy, 'snake');
});

test('clamping and relationship names have defined fallbacks', () => {
  assert.equal(t.clampInt(5, 1, 10, 3), 5);
  assert.equal(t.clampInt(99, 1, 10, 3), 10);
  assert.equal(t.clampInt(0, 1, 10, 3), 1);
  assert.equal(t.clampInt('7', 1, 10, 3), 7);
  assert.equal(t.clampInt(2.9, 1, 10, 3), 2, 'a fraction truncates rather than rounding up past a cap');
  for (const bad of [undefined, 'lots', NaN, Infinity]) {
    assert.equal(t.clampInt(bad, 1, 10, 3), 3, `${bad} should fall back`);
  }
  assert.equal(t.clampInt(null, 1, 10, 3), 1, 'null reads as zero and clamps up to the minimum');
  assert.equal(t.normalizeRelationshipType('refers to'), 'REFERS_TO');
  assert.equal(t.normalizeRelationshipType('__weird__'), 'WEIRD');
  assert.equal(t.normalizeRelationshipType(''), 'RELATED_TO', 'the default relationship is RELATED_TO');
  assert.equal(t.normalizeRelationshipType(null, 'REFERENCES'), 'REFERENCES');
  assert.equal(t.normalizeRelationshipType('!!!', ''), '', 'a name with nothing usable in it yields the fallback');
});

test('a memory maps to a note even when the server sends almost nothing', () => {
  const bare = t.publicMemory({ id: 'm1' });
  assert.deepEqual(bare, {
    id: 'm1', repoId: '', content: '', layer: '', category: '', importance: 0,
    tags: [], createdAt: '', similarity: null, metadata: {},
  });
  assert.equal(t.publicMemory({ id: 'm1', similarity: 0 }).similarity, 0,
    'a similarity of zero is a score, not a missing one');
  assert.deepEqual(t.publicMemory({ id: 'm1', tags: 'nope' }).tags, []);

  const note = t.memoryToNote(bare);
  assert.equal(note.body, 'source:: llm-memory\nmemoryId:: m1',
    'a memory with no layer, category or date writes only the properties it has');
  assert.equal(note.title, 'Memory m1', 'a memory with no content is titled by its id');
  assert.deepEqual(note.tags, ['memory']);
  assert.ok(note.date, 'a memory with no created date is stamped now, so it can be sorted');

  assert.equal(t.memoryNoteTitle({ content: '### A heading\nbody' }), 'A heading',
    'markdown decoration is stripped from the title');
  assert.equal(t.memoryNoteTitle({ content: '\n\n  \n> quoted first line' }), 'quoted first line',
    'blank lines are skipped to find the first real one');
  assert.equal(t.memoryNoteTitle({ id: 'abcdefghijkl', content: '' }), 'Memory abcdefgh',
    'the id fallback is shortened');
  assert.equal(t.memoryNoteTitle({ content: 'x'.repeat(200) }).length, 80, 'a long title is cut to 80 characters');

  const tagged = t.memoryToNote(t.publicMemory({ id: 'm2', content: 'c', tags: ['Work Item', 'work-item', ...Array.from({ length: 15 }, (_, i) => `t${i}`)] }));
  assert.equal(tagged.tags[1], 'work-item', 'a tag is lowercased and slugged');
  assert.equal(tagged.tags.length, 10, 'at most ten tags, deduplicated');
});

test('a memory id that cannot be made safe is refused, not guessed at', () => {
  assert.equal(t.memoryNoteId('abc-123'), 'mem_abc-123');
  assert.equal(t.memoryNoteId('a/../b'), 'mem_a_b', 'path characters cannot escape the vault');
  assert.equal(t.memoryNoteId('///'), 'mem__', 'an id of pure punctuation still yields a safe note id');
  assert.equal(t.memoryNoteId('x'.repeat(200)).length, 104, 'a long id is cut, not rejected');
  assert.throws(() => t.memoryNoteId(''), /Invalid memory id/);
  assert.throws(() => t.memoryNoteId(null), /Invalid memory id/);
  assert.equal(t.repoIdFromName('My Notes!'), 'my_notes');
  assert.equal(t.repoIdFromName('!!!'), '', 'a name with nothing usable yields nothing, so the caller can fall back');
  assert.equal(t.repoIdFromName(null), '');
});
