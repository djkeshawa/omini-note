function ipcErrorResponse(name, error) {
  console.error('[ipc]', name, error);
  return {
    ok: false,
    error: error.message || String(error),
    code: error.code || null,
    currentRevision: error.currentRevision || null,
    expectedRevision: error.expectedRevision ?? null,
    currentModifiedAt: error.currentModifiedAt || null,
    expectedModifiedAt: error.expectedModifiedAt || null,
  };
}

function createIpcRuntime() {
  const wrap = fn => async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return ipcErrorResponse(fn.name, error);
    }
  };
  const wrapWithEvent = fn => async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (error) {
      return ipcErrorResponse(fn.name, error);
    }
  };
  return { wrap, wrapWithEvent };
}

module.exports = { createIpcRuntime };
