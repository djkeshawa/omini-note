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
