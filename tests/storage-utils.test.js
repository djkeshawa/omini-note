const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/shared/storageUtils.js');

function memoryRoot() {
  const map = new Map();
  return {
    localStorage: {
      getItem: key => map.has(key) ? map.get(key) : null,
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: key => map.delete(key),
    },
  };
}

test('Storage helpers read, write, remove, and fall back safely', () => {
  const root = memoryRoot();

  assert.equal(storage.setJson('prefs', { open: true }, root), true);
  assert.deepEqual(storage.getJson('prefs', {}, root), { open: true });

  root.localStorage.setItem('broken', '{');
  assert.deepEqual(storage.getJson('broken', { safe: true }, root), { safe: true });

  assert.equal(storage.remove('prefs', root), true);
  assert.deepEqual(storage.getJson('prefs', { missing: true }, root), { missing: true });
  assert.deepEqual(storage.getJson('x', { noStorage: true }, {}), { noStorage: true });
});
