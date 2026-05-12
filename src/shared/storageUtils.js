(function () {
  function storageFor(root) {
    try { return root?.localStorage || null; }
    catch { return null; }
  }

  function getJson(key, fallback, root = globalThis) {
    const storage = storageFor(root);
    if (!storage) return fallback;
    try {
      const raw = storage.getItem(key);
      if (raw == null || raw === '') return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function setJson(key, value, root = globalThis) {
    const storage = storageFor(root);
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function remove(key, root = globalThis) {
    const storage = storageFor(root);
    if (!storage) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  const api = { getJson, setJson, remove };
  globalThis.MN_STORAGE = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
