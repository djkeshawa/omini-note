const crypto = require('crypto');

function configKey(config = {}) {
  const secretId = crypto.createHash('sha256').update(String(config.apiKey || '')).digest('hex').slice(0, 16);
  return `${String(config.baseUrl || '')}|${String(config.repoId || '')}|${secretId}`;
}

function createMemoryIndexCache({ loader, limit = 2000, ttlMs = 30000, maxEntries = 8, now = () => Date.now() } = {}) {
  if (typeof loader !== 'function') throw new Error('Memory index cache loader is required');
  const entries = new Map();
  // Bumped by invalidate(). A load remembers the generation it started under
  // and refuses to write its result if the world moved on — without this, a
  // load already in flight when "Remember note" invalidated the cache would
  // land afterwards and re-cache the pre-remember snapshot for a full TTL,
  // so the note reported "not remembered" right after the user remembered it.
  let generation = 0;

  function trim() {
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  async function get(config) {
    const key = configKey(config);
    const existing = entries.get(key);
    if (existing?.value && existing.expiresAt > now()) return existing.value;
    if (existing?.promise) return existing.promise;
    const startedAt = generation;
    const promise = Promise.resolve(loader(config, { limit: limit + 1, maxLimit: limit + 1 }))
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        const value = { memories: list.slice(0, limit), truncated: list.length > limit };
        if (generation === startedAt) {
          entries.set(key, { value, expiresAt: now() + ttlMs, promise: null });
          trim();
        } else if (entries.get(key)?.promise === promise) {
          // Stale result: hand it to this caller but do not cache it, and
          // clear the pending marker so the next caller loads fresh.
          entries.delete(key);
        }
        return value;
      })
      .catch((error) => {
        if (entries.get(key)?.promise === promise) entries.delete(key);
        throw error;
      });
    entries.set(key, { value: null, expiresAt: 0, promise });
    trim();
    return promise;
  }

  function invalidate(config) {
    generation += 1;
    if (config) entries.delete(configKey(config));
    else entries.clear();
  }

  return { get, invalidate, size: () => entries.size };
}

module.exports = { createMemoryIndexCache, configKey };
