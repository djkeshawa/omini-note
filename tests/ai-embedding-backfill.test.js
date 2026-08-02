const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmbeddingDomain } = require('../lib/ai/embeddings.js');

// Backfill is the long-running "index my whole vault" job behind semantic
// search, and relatedNotes is the panel it feeds. Behaviours: recent notes are
// embedded first so search gets useful during a long first run, one failed
// note never sinks the rest, cancel actually stops, and the related-notes
// panel degrades to keyword matches instead of showing nothing.

function makeDomain({ reachable = true, embedModelOk = true, needIds = [], notes = [],
  embedImpl, vectorHits = [], lexicalHits = [] } = {}) {
  const calls = { embeddedNotes: [], vectorSearches: 0, lexicalSearches: 0 };
  const scope = {
    CONFIG: { enabled: true, embedModel: 'embed-v1', embedConcurrency: 1 },
    QUERY_CACHE_MS: 60000,
    backfillJobs: new Map(),
    idx: {
      noteContentHash: note => `h:${note.id}`,
      chunkNote: note => [String(note.body || note.title || '')].filter(Boolean),
      setNoteEmbeddings: (v, note) => { calls.embeddedNotes.push(note.id); return { committed: true }; },
      notesNeedingEmbeddings: () => [...needIds],
      vectorSearch: () => { calls.vectorSearches += 1; return vectorHits; },
      lexicalContextSearch: () => { calls.lexicalSearches += 1; return lexicalHits; },
      markEmbeddingsNormalized: () => { calls.normalized = true; },
    },
    queryEmbeddingCache: new Map(),
    state: {},
    pendingEmbeddings: new Map(),
    status: async () => ({ reachable, embedModelOk }),
    embedWithConfiguredModel: embedImpl || (async () => [0.1]),
    setTimeout: (fn) => ({ unref() {} }),
  };
  const store = { loadVault: async () => ({ notes }) };
  return { domain: createEmbeddingDomain(scope), calls, store, scope };
}

const note = (id, modifiedAt, body = `body of ${id}`) => ({ id, title: `Note ${id}`, body, modifiedAt });

test('backfill embeds the most recently edited notes first', async () => {
  const notes = [
    note('old', '2026-01-01T00:00:00Z'),
    note('newest', '2026-06-01T00:00:00Z'),
    note('middle', '2026-03-01T00:00:00Z'),
  ];
  const { domain, calls, store } = makeDomain({ needIds: ['old', 'newest', 'middle'], notes });
  const result = await domain.backfillVault('v1', store);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.embeddedNotes, ['newest', 'middle', 'old'],
    'a long first-run backfill must make current work searchable first');
});

test('one failing note is reported without sinking the rest of the backfill', async () => {
  const notes = [note('good1', '2026-03-01Z'), note('bad', '2026-02-01Z'), note('good2', '2026-01-01Z')];
  const { domain, store } = makeDomain({
    needIds: ['good1', 'bad', 'good2'], notes,
    embedImpl: async text => {
      if (text.includes('bad')) throw new Error('embedding exploded');
      return [0.2];
    },
  });
  const result = await domain.backfillVault('v1', store);
  assert.equal(result.ok, false, 'a partial failure must not report complete success');
  assert.equal(result.embedded, 2, 'the healthy notes should still have been embedded');
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].id, 'bad');
});

test('cancelling a backfill stops it and says so in the status', async () => {
  const notes = Array.from({ length: 5 }, (_, i) => note(`n${i}`, `2026-0${5 - i}-01T00:00:00Z`));
  let domainRef;
  const { domain, calls, store } = makeDomain({
    needIds: notes.map(n => n.id), notes,
    embedImpl: async () => {
      // Cancel from inside the second embed, as the UI button would.
      if (calls.embeddedNotes.length >= 1) domainRef.cancelBackfill('v1');
      return [0.3];
    },
  });
  domainRef = domain;
  const result = await domain.backfillVault('v1', store);
  assert.equal(result.canceled, true);
  assert.ok(calls.embeddedNotes.length < 5, 'cancel did not stop the run');
  const status = domain.backfillStatus('v1');
  assert.equal(status.running, false);
  assert.equal(status.reason, 'Cancelled');
});

test('backfill refuses cleanly when the server or model is missing', async () => {
  const down = makeDomain({ reachable: false, needIds: ['a'], notes: [note('a', '')] });
  const downResult = await down.domain.backfillVault('v1', down.store);
  assert.equal(downResult.ok, false);
  assert.match(downResult.reason, /not reachable/i);
  const noModel = makeDomain({ embedModelOk: false, needIds: ['a'], notes: [note('a', '')] });
  const noModelResult = await noModel.domain.backfillVault('v1', noModel.store);
  assert.equal(noModelResult.ok, false);
  assert.match(noModelResult.reason, /ollama pull/i, 'the error should tell the user the fix');
});

test('a vault with nothing to embed reports an idle, completed status', async () => {
  const { domain, store } = makeDomain({ needIds: [] });
  const result = await domain.backfillVault('v1', store);
  assert.equal(result.ok, true);
  assert.equal(result.embedded, 0);
  const status = domain.backfillStatus('v1');
  assert.equal(status.running, false);
  assert.ok(status.lastBackfill, 'an idle vault should still record when it was checked');
});

test('progress counts every note exactly once', async () => {
  const notes = [note('a', '2026-03-01Z'), note('b', '2026-02-01Z'), note('ghost-id-not-in-vault', '')];
  const { domain, store } = makeDomain({ needIds: ['a', 'b', 'missing'], notes: notes.slice(0, 2) });
  await domain.backfillVault('v1', store);
  const status = domain.backfillStatus('v1');
  assert.equal(status.done, 3, 'a note id with no note behind it must still advance progress');
  assert.equal(status.total, 3);
});

test('related notes prefer semantic hits and never include the note itself', async () => {
  const { domain, store } = makeDomain({
    notes: [note('me', ''), note('other', '')],
    vectorHits: [
      { noteId: 'me', title: 'Note me', chunkText: 'self match', distance: 0 },
      { noteId: 'other', title: 'Note other', chunkText: 'related text', distance: 0.2 },
      { noteId: 'other', title: 'Note other', chunkText: 'second chunk', distance: 0.3 },
    ],
  });
  const result = await domain.relatedNotes('v1', 'me', store);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'semantic');
  assert.deepEqual(result.items.map(i => i.noteId), ['other'],
    'the source note must be excluded and duplicate chunks collapsed');
});

test('related notes fall back to keyword matches when embeddings are unavailable', async () => {
  const { domain, calls, store } = makeDomain({
    embedModelOk: false,
    notes: [note('me', ''), note('kw', '')],
    lexicalHits: [{ noteId: 'kw', title: 'Note kw', chunkText: 'keyword hit' }],
  });
  const result = await domain.relatedNotes('v1', 'me', store);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'keyword');
  assert.equal(result.items[0].noteId, 'kw');
  assert.equal(calls.vectorSearches, 0, 'no vector search without an embedding model');
});

test('related notes for a missing or empty note answer honestly', async () => {
  const { domain, store } = makeDomain({ notes: [note('real', '')] });
  const missing = await domain.relatedNotes('v1', 'nope', store);
  assert.equal(missing.ok, false);
  const emptyDomain = makeDomain({ notes: [{ id: 'blank', title: '', body: '' }] });
  const empty = await emptyDomain.domain.relatedNotes('v1', 'blank', emptyDomain.store);
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.items, [], 'an empty note has nothing to relate to');
});
