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
    }, { vaultName: 'Personal' });
    assert.equal(created.id, 'created123');
    const req = fake.requests.find(r => r.path === '/memories' && r.method === 'POST');
    assert.match(req.body.content, /^# Design call\n\nDecided to keep vaults flat\./);
    assert.deepEqual(req.body.tags, ['work', 'vispnote']);
    assert.equal(req.body.metadata.vispnote_note_id, 'n1');
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
