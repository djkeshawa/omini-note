function createKeyedLock() {
  const tails = new Map();

  return async function withKeyedLock(key, task) {
    const lockKey = String(key || '');
    const previous = tails.get(lockKey) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => current, () => current);
    tails.set(lockKey, tail);

    try {
      await previous.catch(() => {});
      return await task();
    } finally {
      release();
      if (tails.get(lockKey) === tail) tails.delete(lockKey);
    }
  };
}

module.exports = { createKeyedLock };
