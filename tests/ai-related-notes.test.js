const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmbeddingDomain } = require('../lib/ai/embeddings');

// Related notes and the vault backfill. Both are best-effort by design: with no
// embedding model the panel still suggests notes from keyword search, and a
// backfill that partially fails reports exactly which notes did not make it
// rather than claiming success. ai-embeddings.test.js pins the write queue.

function makeDomain(over = {}) {
  const calls = { embed: [], vector: [], lexical: [] };
  const { idx: idxOver = {}, ...rest } = over;
  const idx = {
    noteContentHash: note => `hash:${note.body}`,
    chunkNote: note => [note.body],
    setNoteEmbeddings: (vaultId, note, vectors, model, hash) => ({ committed: true, contentHash: hash }),
    notesNeedingEmbeddings: () => [],
    vectorSearch: () => [],
    lexicalContextSearch: () => [],
    indexHealth: (vaultId, model) => ({ vaultId, model, indexedNoteCount: 3 }),
    markEmbeddingsNormalized: () => { calls.normalized = true; },
    ...idxOver,
  };
  const scope = {
    CONFIG: { enabled: true, embedModel: 'test-model', embedConcurrency: 1 },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: () => ({ unref() {} }),
    status: async () => ({ reachable: true, embedModelOk: true }),
    embedWithConfiguredModel: async (text) => { calls.embed.push(text); return [1, 2, 3]; },
    ...rest,
    idx: {
      ...idx,
      vectorSearch: (vaultId, vec, k) => { calls.vector.push({ vaultId, k }); return idx.vectorSearch(vaultId, vec, k); },
      lexicalContextSearch: (vaultId, query, k) => { calls.lexical.push({ vaultId, query, k }); return idx.lexicalContextSearch(vaultId, query, k); },
    },
  };
  return { domain: createEmbeddingDomain(scope), scope, calls };
}

const note = (id, over = {}) => ({ id, title: `Note ${id}`, body: 'A body.', modifiedAt: '2026-01-01T00:00:00.000Z', ...over });
const storeWith = notes => ({ loadVault: async () => ({ notes }) });

test('related notes needs a note with something in it', async () => {
  const { domain } = makeDomain();
  assert.deepEqual(await domain.relatedNotes('v1', 'missing', storeWith([])), { ok: false, reason: 'Note not found' });
  assert.deepEqual(await domain.relatedNotes('v1', 'n1', storeWith([{ id: 'n1', title: '  ', body: '  ' }])),
    { ok: true, mode: 'empty', items: [] }, 'a note with no title and no body has nothing to be related to');
  assert.deepEqual(await domain.relatedNotes('v1', 'n1', storeWith([{ id: 'n1', title: '', body: 'status:: DRAFT' }])),
    { ok: true, mode: 'empty', items: [] }, 'property lines are not content to search on');
});

test('related notes are found semantically and topped up with keyword hits', async () => {
  const { domain, calls } = makeDomain({
    idx: {
      vectorSearch: () => [
        { noteId: 'n2', title: 'Semantic', chunkText: 'x'.repeat(300), distance: 0.1 },
        { noteId: 'n1', title: 'Itself', chunkText: 'self', distance: 0 },
        { noteId: 'n2', title: 'Semantic again', chunkText: 'dupe', distance: 0.2 },
      ],
      lexicalContextSearch: () => [{ noteId: 'n3', title: 'Lexical', chunkText: 'words', distance: 5 }],
    },
  });
  const result = await domain.relatedNotes('v1', 'n1', storeWith([note('n1', { title: 'The Meeting', body: 'status:: DRAFT\nSome prose.' })]));
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'semantic');
  assert.deepEqual(result.items.map(i => i.noteId), ['n2', 'n3'],
    'the note itself and a repeated hit are dropped; keyword hits fill the rest');
  assert.equal(result.items[0].mode, 'semantic');
  assert.equal(result.items[1].mode, 'keyword');
  assert.equal(result.items[0].snippet.length, 200, 'each suggestion carries a capped snippet');
  assert.match(calls.embed[0], /The Meeting/);
  assert.ok(!calls.embed[0].includes('status::'), 'the query embedded is the note\'s content, not its metadata');
  assert.equal(calls.lexical[0].query, 'The Meeting', 'the keyword top-up searches on the title');
});

test('with no embedding model, related notes are keyword-only rather than empty', async () => {
  const { domain, calls } = makeDomain({
    status: async () => ({ reachable: true, embedModelOk: false }),
    idx: { lexicalContextSearch: () => [{ noteId: 'n2', title: 'Lexical', chunkText: 'words' }] },
  });
  const result = await domain.relatedNotes('v1', 'n1', storeWith([note('n1')]));
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.items.map(i => i.noteId), ['n2']);
  assert.equal(calls.embed.length, 0, 'no embedding model means no embedding call');

  // A model that turns out not to support embedding downgrades mid-flight.
  const unsupported = makeDomain({
    embedWithConfiguredModel: async () => { throw Object.assign(new Error('nope'), { code: 'EMBED_MODEL_UNSUPPORTED' }); },
    idx: { lexicalContextSearch: () => [{ noteId: 'n2', title: 'Lexical', chunkText: 'words' }] },
  });
  const downgraded = await unsupported.domain.relatedNotes('v1', 'n1', storeWith([note('n1')]));
  assert.equal(downgraded.mode, 'keyword');
  assert.deepEqual(downgraded.items.map(i => i.noteId), ['n2']);

  // Any other vector failure is logged but still answers from keywords.
  const broken = makeDomain({
    idx: {
      vectorSearch: () => { throw new Error('index is locked'); },
      lexicalContextSearch: () => [{ noteId: 'n2', title: 'Lexical', chunkText: 'words' }],
    },
  });
  const recovered = await broken.domain.relatedNotes('v1', 'n1', storeWith([note('n1')]));
  assert.equal(recovered.mode, 'semantic', 'the model is still there, only this search failed');
  assert.deepEqual(recovered.items.map(i => i.noteId), ['n2']);
});

test('the related-notes limit is clamped and honoured', async () => {
  const hits = Array.from({ length: 40 }, (_, i) => ({ noteId: `n${i + 2}`, title: `T${i}`, chunkText: 'x' }));
  const { domain, calls } = makeDomain({ idx: { vectorSearch: () => hits } });
  assert.equal((await domain.relatedNotes('v1', 'n1', storeWith([note('n1')]), { limit: 3 })).items.length, 3);
  assert.equal((await domain.relatedNotes('v1', 'n1', storeWith([note('n1')]), { limit: 999 })).items.length, 24,
    'an absurd limit is capped rather than obeyed');
  assert.equal((await domain.relatedNotes('v1', 'n1', storeWith([note('n1')]), { limit: 0 })).items.length, 6,
    'a limit of zero falls back to the default');
  assert.equal(calls.vector[0].k, 12, 'the vector search over-fetches so duplicates can be dropped');
});

test('a query embedding is cached per model and per text', async () => {
  const { domain, calls, scope } = makeDomain();
  await domain.embedQueryCached('a question');
  await domain.embedQueryCached('a question');
  assert.equal(calls.embed.length, 1, 'the same question is not embedded twice');
  await domain.embedQueryCached('another question');
  assert.equal(calls.embed.length, 2);

  scope.queryEmbeddingCache.set('test-model\nstale', { at: Date.now() - 5000, value: [9] });
  await domain.embedQueryCached('stale');
  assert.equal(calls.embed.length, 3, 'a cached embedding older than the window is recomputed');

  for (let i = 0; i < 90; i++) await domain.embedQueryCached(`q${i}`);
  assert.ok(scope.queryEmbeddingCache.size <= 81, 'the cache is bounded rather than growing forever');
});

test('a backfill with nothing to do says so without touching the vault', async () => {
  const { domain } = makeDomain();
  assert.deepEqual(await domain.backfillVault('v1', storeWith([])), { ok: true, embedded: 0 });
  assert.deepEqual(domain.backfillStatus('v1'), {
    running: false, total: 0, done: 0, embedded: 0, failed: [],
    startedAt: null, lastBackfill: domain.backfillStatus('v1').lastBackfill, reason: '',
  });
  assert.ok(domain.backfillStatus('v1').lastBackfill, 'an empty backfill still records that it ran');
  assert.deepEqual(domain.backfillStatus('never-seen'), {
    running: false, total: 0, done: 0, embedded: 0, failed: [], lastBackfill: null, reason: '',
  });
});

test('a backfill refuses to start when the model is not there', async () => {
  assert.deepEqual(await makeDomain({ status: async () => ({ reachable: false }) }).domain.backfillVault('v1', storeWith([])),
    { ok: false, reason: 'Ollama not reachable' });
  assert.deepEqual(await makeDomain({ status: async () => ({ reachable: true, embedModelOk: false }) })
    .domain.backfillVault('v1', storeWith([])),
    { ok: false, reason: 'Embedding model not installed: ollama pull test-model' });
});

test('a backfill embeds the most recently edited notes first', async () => {
  const embedded = [];
  const { domain } = makeDomain({
    idx: {
      notesNeedingEmbeddings: () => ['old', 'new', 'mid', 'gone'],
      setNoteEmbeddings: (vaultId, note, vectors, model, hash) => { embedded.push(note.id); return { committed: true, contentHash: hash }; },
    },
  });
  const result = await domain.backfillVault('v1', storeWith([
    note('old', { modifiedAt: '2026-01-01T00:00:00.000Z' }),
    note('new', { modifiedAt: '2026-06-01T00:00:00.000Z' }),
    note('mid', { modifiedAt: '2026-03-01T00:00:00.000Z' }),
  ]));
  assert.deepEqual(embedded, ['new', 'mid', 'old'], 'current work becomes searchable first');
  assert.deepEqual(result, { ok: true, embedded: 3, failed: [] });
  const status = domain.backfillStatus('v1');
  assert.equal(status.running, false);
  assert.equal(status.total, 4);
  assert.equal(status.done, 4, 'a note that is no longer in the vault still counts as done');
  assert.equal(status.embedded, 3);
  assert.ok(status.startedAt);
  assert.ok(status.lastBackfill);
});

test('a backfill reports the notes that failed instead of claiming success', async () => {
  let attempt = 0;
  const { domain } = makeDomain({
    embedWithConfiguredModel: async () => { attempt++; if (attempt === 2) throw new Error('model exploded'); return [1]; },
    idx: { notesNeedingEmbeddings: () => ['a', 'b', 'c'] },
  });
  const result = await domain.backfillVault('v1', storeWith([note('a'), note('b'), note('c')]));
  assert.equal(result.ok, false, 'a partial backfill is not a success');
  assert.equal(result.embedded, 2);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /model exploded/);
  assert.equal(domain.backfillStatus('v1').reason, '1 notes failed');

  // A note that changed under the embedding is reported, not silently retried.
  const changed = makeDomain({
    idx: {
      notesNeedingEmbeddings: () => ['a'],
      setNoteEmbeddings: () => ({ committed: false, currentContentHash: 'other' }),
    },
  });
  const stale = await changed.domain.backfillVault('v1', storeWith([note('a')]));
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.failed, [{ id: 'a', error: 'Note changed while embeddings were generated' }]);

  // A model that cannot embed at all stops the whole run with its reason.
  const unsupported = makeDomain({
    embedWithConfiguredModel: async () => { throw Object.assign(new Error('not an embedding model'), { code: 'EMBED_MODEL_UNSUPPORTED' }); },
    idx: { notesNeedingEmbeddings: () => ['a', 'b'] },
  });
  const stopped = await unsupported.domain.backfillVault('v1', storeWith([note('a'), note('b')]));
  assert.equal(stopped.ok, false);
  assert.match(stopped.reason, /not an embedding model/);
  assert.equal(stopped.embedded, 0);
});

test('a running backfill can be cancelled, and cannot be started twice', async () => {
  const { domain } = makeDomain({ idx: { notesNeedingEmbeddings: () => ['a'] } });
  assert.deepEqual(domain.cancelBackfill('v1'), { ok: false, error: 'No running backfill job found' });
  await domain.backfillVault('v1', storeWith([note('a')]));
  assert.deepEqual(domain.cancelBackfill('v1'), { ok: false, error: 'No running backfill job found' },
    'a finished backfill has nothing left to cancel');

  // A job already marked running is reported rather than started again.
  const busy = makeDomain();
  busy.scope.backfillJobs.set('v1', { running: true, total: 5, done: 2, embedded: 2, failed: [], controller: new AbortController() });
  const second = await busy.domain.backfillVault('v1', storeWith([]));
  assert.equal(second.running, true);
  assert.equal(second.total, 5);
  assert.deepEqual(busy.domain.cancelBackfill('v1'), { ok: true });
  assert.equal(busy.domain.backfillStatus('v1').reason, 'Cancelled');
  assert.equal(busy.domain.backfillStatus('v1').running, false);
});

test('index status folds the backfill progress into the health report', () => {
  const { domain } = makeDomain();
  const status = domain.indexStatus('v1');
  assert.equal(status.vaultId, 'v1');
  assert.equal(status.model, 'test-model');
  assert.equal(status.indexedNoteCount, 3);
  assert.deepEqual(status.backfill, {
    running: false, total: 0, done: 0, embedded: 0, failed: [], lastBackfill: null, reason: '',
  });
});
