function getJson(key, fallback, root = globalThis) {
  try {
    const raw = root?.localStorage?.getItem(key);
    return raw == null || raw === '' ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

function setJson(key, value, root = globalThis) {
  try { root?.localStorage?.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function remove(key, root = globalThis) {
  try { root?.localStorage?.removeItem(key); return true; }
  catch { return false; }
}

const storage = Object.freeze({ getJson, setJson, remove });
module.exports = { getJson, remove, setJson, storage };
