const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemoryIndexCache, configKey } = require('../lib/memoryIndexCache');

test('memory index cache deduplicates concurrent loads and invalidates explicitly', async () => {
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const cache = createMemoryIndexCache({
    loader: async (_config, options) => {
      calls++;
      assert.equal(options.limit, 3);
      await pending;
      return [{ id: 'm1' }, { id: 'm2' }, { id: 'overflow' }];
    },
    limit: 2,
  });
  const config = { baseUrl: 'http://127.0.0.1:8000', repoId: 'repo', apiKey: 'secret' };
  const first = cache.get(config);
  const second = cache.get(config);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.strictEqual(a, b);
  assert.deepEqual(a.memories.map(row => row.id), ['m1', 'm2']);
  assert.equal(a.truncated, true);
  cache.invalidate(config);
  await cache.get(config);
  assert.equal(calls, 2);
});

test('memory index cache expires entries and separates API-key identities without exposing keys', async () => {
  let clock = 100;
  let calls = 0;
  const cache = createMemoryIndexCache({ loader: async () => [{ id: `m${++calls}` }], ttlMs: 10, now: () => clock });
  const firstConfig = { baseUrl: 'http://127.0.0.1:8000', repoId: 'repo', apiKey: 'key-one' };
  const secondConfig = { ...firstConfig, apiKey: 'key-two' };
  assert.doesNotMatch(configKey(firstConfig), /key-one/);
  await cache.get(firstConfig);
  await cache.get(firstConfig);
  assert.equal(calls, 1);
  await cache.get(secondConfig);
  assert.equal(calls, 2);
  clock = 111;
  await cache.get(firstConfig);
  assert.equal(calls, 3);
});
