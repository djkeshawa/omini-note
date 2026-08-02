const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmbeddingDomain } = require('../lib/ai/embeddings.js');

// The embedding pipeline runs behind every save. The behaviours that matter:
// a saved note gets embedded exactly once, an unreachable model postpones work
// instead of losing it, a model swap mid-flight never stores vectors under the
// wrong model, and query embeddings are cached so search stays cheap.

function makeDomain({ enabled = true, embedModel = 'embed-v1', reachable = true, embedModelOk = true,
  embedImpl } = {}) {
  const calls = { embedded: [], stored: [], statusChecks: 0 };
  const timers = [];
  const CONFIG = { enabled, embedModel, embedConcurrency: 2 };
  const statusRef = { reachable, embedModelOk };
  const scope = {
    CONFIG,
    QUERY_CACHE_MS: 60000,
    backfillJobs: new Map(),
    idx: {
      noteContentHash: note => `hash:${note.id}:${(note.body || '').length}`,
      chunkNote: note => String(note.body || '').split('\n').filter(Boolean),
      setNoteEmbeddings: (vaultId, note, vectors, model, hash) => {
        calls.stored.push({ vaultId, noteId: note.id, vectors, model, hash });
      },
    },
    queryEmbeddingCache: new Map(),
    state: {},
    pendingEmbeddings: new Map(),
    status: async () => { calls.statusChecks += 1; return { ...statusRef }; },
    embedWithConfiguredModel: embedImpl || (async (text) => { calls.embedded.push(text); return [text.length, 0.5]; }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; },
  };
  const domain = createEmbeddingDomain(scope);
  const runTimers = async () => {
    while (timers.length) {
      const t = timers.shift();
      await t.fn();
    }
  };
  return { domain, calls, timers, runTimers, CONFIG, statusRef, scope };
}

const NOTE = { id: 'n1', title: 'Note', body: 'first chunk\nsecond chunk\nthird chunk' };

test('a saved note is chunked, embedded, and stored under its model and hash', async () => {
  const { domain, calls, runTimers } = makeDomain();
  domain.scheduleEmbed('v1', NOTE);
  await runTimers();
  assert.equal(calls.stored.length, 1, 'the note was not stored exactly once');
  const stored = calls.stored[0];
  assert.equal(stored.model, 'embed-v1');
  assert.equal(stored.hash, `hash:n1:${NOTE.body.length}`, 'the content hash must travel with the vectors');
  assert.equal(stored.vectors.length, 3, 'every chunk needs a vector');
});

test('chunk order is preserved even with a concurrent embed pool', async () => {
  // Vectors stored against the wrong chunk would make semantic search point
  // at the wrong part of the note.
  const { domain, calls, runTimers } = makeDomain({
    embedImpl: async text => {
      // Finish out of order: later chunks resolve first.
      await new Promise(r => setImmediate(r));
      return [`vec:${text}`];
    },
  });
  domain.scheduleEmbed('v1', NOTE);
  await runTimers();
  assert.deepEqual(calls.stored[0].vectors, [['vec:first chunk'], ['vec:second chunk'], ['vec:third chunk']],
    'vectors came back out of order');
});

test('saving the same note twice before the drain embeds it once', async () => {
  const { domain, calls, runTimers } = makeDomain();
  domain.scheduleEmbed('v1', NOTE);
  domain.scheduleEmbed('v1', { ...NOTE, body: 'newer body' });
  await runTimers();
  assert.equal(calls.stored.length, 1, 'rapid saves must collapse into one embed');
  assert.equal(calls.stored[0].vectors.length, 1, 'the LATEST body should be the one embedded');
});

test('with AI disabled nothing is embedded and the queue is emptied', async () => {
  const { domain, calls, runTimers, scope } = makeDomain({ enabled: false });
  domain.scheduleEmbed('v1', NOTE);
  await runTimers();
  await domain.drain();
  assert.equal(calls.embedded.length, 0);
  assert.equal(scope.pendingEmbeddings.size, 0, 'disabled AI must not leave work queued forever');
});

test('an unreachable server postpones the work instead of losing it', async () => {
  const { domain, calls, runTimers, statusRef, timers } = makeDomain({ reachable: false });
  domain.scheduleEmbed('v1', NOTE);
  const first = timers.shift();
  await first.fn();
  assert.equal(calls.stored.length, 0, 'embedded while the server was down');
  assert.ok(timers.length >= 1, 'no retry was scheduled -- the note would never be embedded');
  // Server comes back; the retry drain must complete the original work.
  statusRef.reachable = true;
  await runTimers();
  assert.equal(calls.stored.length, 1, 'the postponed note was never embedded after recovery');
});

test('a model swap mid-flight restarts the work under the new model', async () => {
  // Vectors from two different models in one index are silently incomparable,
  // so nothing may be stored under the OLD model once the config changes. The
  // pipeline aborts the stale attempt (EMBED_CONFIG_CHANGED), treats it as
  // retryable, and re-embeds everything under the new model.
  let swapped = false;
  const { domain, calls, runTimers, CONFIG } = makeDomain({
    embedImpl: async text => {
      if (!swapped) { swapped = true; CONFIG.embedModel = 'embed-v2'; }
      return [`by:${CONFIG.embedModel}`];
    },
  });
  domain.scheduleEmbed('v1', NOTE);
  await runTimers();
  assert.equal(calls.stored.length, 1, 'the note was never re-embedded after the swap');
  assert.equal(calls.stored[0].model, 'embed-v2', 'vectors were stored under the old model');
  assert.ok(calls.stored[0].vectors.every(v => v[0] === 'by:embed-v2'),
    'a vector from the aborted old-model attempt leaked into the stored set');
});

test('a note with no content stores nothing and does not crash', async () => {
  const { domain, calls, runTimers } = makeDomain();
  domain.scheduleEmbed('v1', { id: 'empty', title: 'E', body: '' });
  await runTimers();
  assert.equal(calls.stored.length, 0);
});

test('query embeddings are cached within the TTL and keyed by model', async () => {
  const { domain, calls, CONFIG } = makeDomain();
  const first = await domain.embedQueryCached('find my notes');
  const second = await domain.embedQueryCached('find my notes');
  assert.deepEqual(second, first);
  assert.equal(calls.embedded.length, 1, 'the second identical query should hit the cache');
  await domain.embedQueryCached('a different query');
  assert.equal(calls.embedded.length, 2);
  CONFIG.embedModel = 'embed-v2';
  await domain.embedQueryCached('find my notes');
  assert.equal(calls.embedded.length, 3,
    'after a model change the same query text must be re-embedded, not served from the old-model cache');
});

test('the query cache cannot grow without bound', async () => {
  const { domain, scope } = makeDomain();
  for (let i = 0; i < 100; i++) await domain.embedQueryCached(`query ${i}`);
  assert.ok(scope.queryEmbeddingCache.size <= 81, `cache grew to ${scope.queryEmbeddingCache.size}`);
});
