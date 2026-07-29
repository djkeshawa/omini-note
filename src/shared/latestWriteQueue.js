(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MN_LATEST_WRITE_QUEUE = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function createLatestWriteQueue() {
    const states = new Map();
    let nextRevision = 0;

    function stateFor(key) {
      if (!states.has(key)) {
        states.set(key, {
          running: false,
          current: null,
          pending: null,
          latestRevision: 0,
          idleWaiters: [],
        });
      }
      return states.get(key);
    }

    function resolveIdle(state) {
      if (state.running || state.current || state.pending) return;
      const waiters = state.idleWaiters.splice(0);
      waiters.forEach(resolve => resolve());
    }

    async function drain(key, state) {
      if (state.running) return;
      state.running = true;
      try {
        while (state.current || state.pending) {
          const request = state.current || state.pending;
          state.current = request;
          if (state.pending === request) state.pending = null;
          try {
            const value = await request.write(request.value, {
              key,
              revision: request.revision,
              isLatest: () => state.latestRevision === request.revision,
            });
            request.waiters.forEach(waiter => waiter.resolve({
              value,
              revision: request.revision,
              latest: state.latestRevision === request.revision,
            }));
          } catch (error) {
            request.waiters.forEach(waiter => waiter.reject(error));
          } finally {
            state.current = null;
          }
        }
      } finally {
        state.running = false;
        resolveIdle(state);
      }
    }

    function enqueue(key, value, write) {
      if (!key) return Promise.reject(new Error('A write queue key is required.'));
      if (typeof write !== 'function') return Promise.reject(new Error('A write function is required.'));
      const state = stateFor(key);
      const revision = ++nextRevision;
      state.latestRevision = revision;
      const promise = new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        if (!state.running && !state.current) {
          state.current = { value, write, revision, waiters: [waiter] };
        } else if (state.pending) {
          state.pending.value = value;
          state.pending.write = write;
          state.pending.revision = revision;
          state.pending.waiters.push(waiter);
        } else {
          state.pending = { value, write, revision, waiters: [waiter] };
        }
      });
      void drain(key, state);
      return promise;
    }

    function flush(key) {
      const state = states.get(key);
      if (!state || (!state.running && !state.current && !state.pending)) return Promise.resolve();
      return new Promise(resolve => state.idleWaiters.push(resolve));
    }

    function isLatest(key, revision) {
      return states.get(key)?.latestRevision === revision;
    }

    function pending(key) {
      const state = states.get(key);
      return !!(state?.running || state?.current || state?.pending);
    }

    return { enqueue, flush, isLatest, pending };
  }

  return { createLatestWriteQueue };
});
