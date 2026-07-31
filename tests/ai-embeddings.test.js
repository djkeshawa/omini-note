const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmbeddingDomain } = require('../lib/ai/embeddings');

function createTimerHarness() {
  const callbacks = [];
  const delays = [];
  return {
    callbacks,
    delays,
    setTimeout(callback, delay) {
      callbacks.push(callback);
      delays.push(delay);
      return { unref() {} };
    },
  };
}

test('embedding queue retains work while the provider is unavailable and keeps the newest note', async () => {
  const timers = createTimerHarness();
  const commits = [];
  let statusCalls = 0;
  const scope = {
    CONFIG: {
      enabled: true,
      embedModel: 'test-model',
      embedConcurrency: 1,
    },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: timers.setTimeout,
    status: async () => {
      statusCalls++;
      return statusCalls === 1
        ? { reachable: false, embedModelOk: false }
        : { reachable: true, embedModelOk: true };
    },
    embedWithConfiguredModel: async text => [`vector:${text}`],
    idx: {
      noteContentHash: note => `hash:${note.body}`,
      chunkNote: note => [note.body],
      setNoteEmbeddings(vaultId, note, vectors, model, contentHash) {
        commits.push({ vaultId, note, vectors, model, contentHash });
        return { committed: true, contentHash };
      },
    },
  };
  const domain = createEmbeddingDomain(scope);

  domain.scheduleEmbed('vault_a', { id: 'n1', body: 'old' });
  assert.equal(timers.callbacks.length, 1);
  await timers.callbacks.shift()();
  assert.equal(scope.pendingEmbeddings.get('vault_a:n1')?.note.body, 'old');
  assert.ok(timers.delays[1] >= 1000, 'unavailable providers use retry backoff');

  domain.scheduleEmbed('vault_a', { id: 'n1', body: 'latest' });
  await timers.callbacks.shift()();

  assert.equal(commits.length, 1);
  assert.equal(commits[0].note.body, 'latest');
  assert.equal(commits[0].contentHash, 'hash:latest');
  assert.equal(scope.pendingEmbeddings.size, 0);
  assert.equal(domain.inFlight.size, 0);
});

test('embedding queue retries transient generation failures without dropping the job', async () => {
  const timers = createTimerHarness();
  let embedAttempts = 0;
  let commitCount = 0;
  const scope = {
    CONFIG: {
      enabled: true,
      embedModel: 'test-model',
      embedConcurrency: 1,
    },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: timers.setTimeout,
    status: async () => ({ reachable: true, embedModelOk: true }),
    embedWithConfiguredModel: async () => {
      embedAttempts++;
      if (embedAttempts === 1) throw new Error('connection reset');
      return [1];
    },
    idx: {
      noteContentHash: note => `hash:${note.body}`,
      chunkNote: note => [note.body],
      setNoteEmbeddings(_vaultId, _note, _vectors, _model, contentHash) {
        commitCount++;
        return { committed: true, contentHash };
      },
    },
  };
  const domain = createEmbeddingDomain(scope);

  domain.scheduleEmbed('vault_a', { id: 'n1', body: 'body' });
  await timers.callbacks.shift()();
  assert.equal(scope.pendingEmbeddings.size, 1);
  assert.equal(commitCount, 0);

  await timers.callbacks.shift()();
  assert.equal(embedAttempts, 2);
  assert.equal(commitCount, 1);
  assert.equal(scope.pendingEmbeddings.size, 0);
});

test('disabling AI during the provider status probe drops the in-flight queue work', async () => {
  const timers = createTimerHarness();
  let resolveStatus;
  const statusPending = new Promise(resolve => { resolveStatus = resolve; });
  let embedCalls = 0;
  const scope = {
    CONFIG: { enabled: true, embedModel: 'test-model', embedConcurrency: 1 },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: timers.setTimeout,
    status: () => statusPending,
    embedWithConfiguredModel: async () => {
      embedCalls++;
      return [1];
    },
    idx: {
      noteContentHash: note => `hash:${note.body}`,
      chunkNote: note => [note.body],
      setNoteEmbeddings: () => ({ committed: true }),
    },
  };

  const domain = createEmbeddingDomain(scope);
  domain.scheduleEmbed('vault_a', { id: 'n1', body: 'body' });
  const drain = timers.callbacks.shift()();

  assert.ok(scope.state.embedAbortController, 'the status probe is covered by the queue abort controller');
  scope.CONFIG.enabled = false;
  scope.state.embedAbortController.abort(new Error('AI disabled'));
  scope.pendingEmbeddings.clear();
  resolveStatus({ reachable: true, embedModelOk: true });
  await drain;

  assert.equal(embedCalls, 0);
  assert.equal(scope.pendingEmbeddings.size, 0);
  assert.equal(domain.inFlight.size, 0);
  assert.equal(scope.state.embedAbortController, null);
  assert.equal(timers.callbacks.length, 0, 'disabled work is not scheduled for retry');
});

test('an embedding aborted by disabling AI is not restored to the cleared queue', async () => {
  const timers = createTimerHarness();
  let markEmbeddingStarted;
  const embeddingStarted = new Promise(resolve => { markEmbeddingStarted = resolve; });
  let commitCount = 0;
  const scope = {
    CONFIG: { enabled: true, embedModel: 'test-model', embedConcurrency: 1 },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: timers.setTimeout,
    status: async () => ({ reachable: true, embedModelOk: true }),
    embedWithConfiguredModel: (_text, { signal }) => new Promise((_resolve, reject) => {
      markEmbeddingStarted();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    idx: {
      noteContentHash: note => `hash:${note.body}`,
      chunkNote: note => [note.body],
      setNoteEmbeddings: () => {
        commitCount++;
        return { committed: true };
      },
    },
  };

  const domain = createEmbeddingDomain(scope);
  domain.scheduleEmbed('vault_a', { id: 'n1', body: 'body' });
  const drain = timers.callbacks.shift()();
  await embeddingStarted;

  scope.CONFIG.enabled = false;
  scope.state.embedAbortController.abort(new Error('AI disabled'));
  scope.pendingEmbeddings.clear();
  await drain;

  assert.equal(commitCount, 0);
  assert.equal(scope.pendingEmbeddings.size, 0);
  assert.equal(domain.inFlight.size, 0);
  assert.equal(timers.callbacks.length, 0, 'an abort reason shaped as Error is not treated as transient');
});

test('a retry scheduled mid-drain does not start a second pass over the same work', async () => {
  const timers = createTimerHarness();
  const embedded = [];
  const seenDuringEmbed = [];
  let release;
  const stillEmbedding = new Promise(resolve => { release = resolve; });

  const scope = {
    CONFIG: { enabled: true, embedModel: 'test-model', embedConcurrency: 1 },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: timers.setTimeout,
    status: async () => ({ reachable: true, embedModelOk: true }),
    embedWithConfiguredModel: async (text) => {
      embedded.push(text);
      // 'a' fails retryably, which schedules a retry drain from inside the loop.
      if (text === 'a') throw new Error('connection reset');
      if (text === 'b') {
        const fire = timers.callbacks.shift();
        if (fire) await fire();
        seenDuringEmbed.push(scope.state.embedAbortController);
        await stillEmbedding;
      }
      return [1];
    },
    idx: {
      noteContentHash: note => `hash:${note.body}`,
      chunkNote: note => [note.body],
      setNoteEmbeddings: () => ({ committed: true }),
    },
  };

  const domain = createEmbeddingDomain(scope);
  domain.scheduleEmbed('vault_a', { id: 'a', body: 'a' });
  domain.scheduleEmbed('vault_a', { id: 'b', body: 'b' });

  const drain = timers.callbacks.shift()();
  await new Promise(resolve => setImmediate(resolve));
  release();
  await drain;

  // The abort controller has to stay live while a note is still embedding —
  // clearing it meant turning AI off could no longer cancel the work in flight.
  assert.ok(seenDuringEmbed[0], 'the abort controller stays set while a note is embedding');
  assert.equal(scope.state.embedAbortController, null, 'and is retired once the drain is done');

  // The re-entrant drain must not embed a note the running drain already holds.
  assert.deepEqual(embedded, ['a', 'b'], 'each queued note is embedded once per pass');
  assert.deepEqual([...scope.pendingEmbeddings.keys()], ['vault_a:a'], 'the failed note stays queued for the next pass');
});

test('changing the embedding model mid-request retries without mislabelling vectors', async () => {
  const timers = createTimerHarness();
  const models = [];
  const commits = [];
  let markOldStarted;
  let resolveOld;
  const oldStarted = new Promise(resolve => { markOldStarted = resolve; });
  const oldResult = new Promise(resolve => { resolveOld = resolve; });
  const scope = {
    CONFIG: { enabled: true, embedModel: 'old-model', embedConcurrency: 1 },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: timers.setTimeout,
    status: async () => ({ reachable: true, embedModelOk: true }),
    embedWithConfiguredModel: async (_text, _options, model) => {
      models.push(model);
      if (model === 'old-model') {
        markOldStarted();
        return oldResult;
      }
      return [2];
    },
    idx: {
      noteContentHash: note => `hash:${note.body}`,
      chunkNote: note => [note.body],
      setNoteEmbeddings(_vaultId, _note, vectors, model) {
        commits.push({ vectors, model });
        return { committed: true };
      },
    },
  };

  const domain = createEmbeddingDomain(scope);
  domain.scheduleEmbed('vault_a', { id: 'n1', body: 'body' });
  const firstDrain = timers.callbacks.shift()();
  await oldStarted;
  scope.CONFIG.embedModel = 'new-model';
  resolveOld([1]);
  await firstDrain;

  assert.deepEqual(commits, [], 'vectors from the previous model are never committed under the new model name');
  assert.equal(scope.pendingEmbeddings.size, 1, 'the note remains queued for the active model');

  await timers.callbacks.shift()();
  assert.deepEqual(models, ['old-model', 'new-model']);
  assert.deepEqual(commits, [{ vectors: [[2]], model: 'new-model' }]);
  assert.equal(scope.pendingEmbeddings.size, 0);
});

test('an old-model rejection after settings change retries on the active model', async () => {
  const timers = createTimerHarness();
  const commits = [];
  let markOldStarted;
  let rejectOld;
  const oldStarted = new Promise(resolve => { markOldStarted = resolve; });
  const oldResult = new Promise((_resolve, reject) => { rejectOld = reject; });
  const scope = {
    CONFIG: { enabled: true, embedModel: 'old-model', embedConcurrency: 1 },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    setTimeout: timers.setTimeout,
    status: async () => ({ reachable: true, embedModelOk: true }),
    embedWithConfiguredModel: async (_text, _options, model) => {
      if (model === 'old-model') {
        markOldStarted();
        return oldResult;
      }
      return [2];
    },
    idx: {
      noteContentHash: note => `hash:${note.body}`,
      chunkNote: note => [note.body],
      setNoteEmbeddings(_vaultId, _note, vectors, model) {
        commits.push({ vectors, model });
        return { committed: true };
      },
    },
  };

  const domain = createEmbeddingDomain(scope);
  domain.scheduleEmbed('vault_a', { id: 'n1', body: 'body' });
  const firstDrain = timers.callbacks.shift()();
  await oldStarted;
  scope.CONFIG.embedModel = 'new-model';
  const unsupported = new Error('old model does not support embeddings');
  unsupported.code = 'EMBED_MODEL_UNSUPPORTED';
  rejectOld(unsupported);
  await firstDrain;

  assert.equal(scope.pendingEmbeddings.size, 1, 'the stale unsupported result does not drop the note');
  assert.deepEqual(commits, []);
  await timers.callbacks.shift()();
  assert.deepEqual(commits, [{ vectors: [[2]], model: 'new-model' }]);
});

test('a query embedding is not cached after its model changes', async () => {
  let resolveEmbedding;
  const pendingEmbedding = new Promise(resolve => { resolveEmbedding = resolve; });
  const scope = {
    CONFIG: { enabled: true, embedModel: 'old-model', embedConcurrency: 1 },
    QUERY_CACHE_MS: 1000,
    backfillJobs: new Map(),
    pendingEmbeddings: new Map(),
    queryEmbeddingCache: new Map(),
    state: {},
    status: async () => ({ reachable: true, embedModelOk: true }),
    embedWithConfiguredModel: () => pendingEmbedding,
    idx: {},
  };
  const domain = createEmbeddingDomain(scope);
  const query = domain.embedQueryCached('query');
  scope.CONFIG.embedModel = 'new-model';
  resolveEmbedding([1]);

  await assert.rejects(query, error => error.code === 'EMBED_CONFIG_CHANGED');
  assert.equal(scope.queryEmbeddingCache.size, 0);
});
