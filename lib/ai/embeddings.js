function createEmbeddingDomain(scope) {
  const CONFIG = scope.CONFIG;
  const QUERY_CACHE_MS = scope.QUERY_CACHE_MS;
  const backfillJobs = scope.backfillJobs;
  const embedWithConfiguredModel = (...args) => scope.embedWithConfiguredModel(...args);
  const idx = scope.idx;
  const queryEmbeddingCache = scope.queryEmbeddingCache;
  const state = scope.state;
  const status = (...args) => scope.status(...args);
  const pending = scope.pendingEmbeddings; // key: `${vaultId}:${noteId}` → { vaultId, note, scheduled: timestamp }
  const scheduleTimer = scope.setTimeout || setTimeout;
  const inFlight = new Set(); // keys currently being embedded
  let drainScheduled = false;
  let draining = false;
  let drainTimer = null;
  let retryDelayMs = 1000;
  let lastEmbedScheduleAt = 0;
  let embedScheduleDelayMs = 300;
  
  function key(vaultId, noteId) { return `${vaultId}:${noteId}`; }

  function sourceContentHash(note) {
    return typeof idx.noteContentHash === 'function' ? idx.noteContentHash(note) : null;
  }

  function scheduleDrain(delayMs) {
    if (!CONFIG.enabled || drainScheduled) return false;
    drainScheduled = true;
    drainTimer = scheduleTimer(async () => {
      drainTimer = null;
      await drain();
    }, delayMs);
    drainTimer?.unref?.();
    return true;
  }

  function discardWork(work) {
    for (const job of work) inFlight.delete(job.k);
  }

  function queueRetry(work) {
    if (!CONFIG.enabled) {
      discardWork(work);
      return;
    }
    for (const job of work) {
      const newer = pending.get(job.k);
      if (!newer || Number(newer.scheduled) < Number(job.scheduled)) {
        pending.set(job.k, {
          vaultId: job.vaultId,
          note: job.note,
          scheduled: job.scheduled,
          sourceContentHash: job.sourceContentHash,
        });
      }
      inFlight.delete(job.k);
    }
    if (scheduleDrain(retryDelayMs)) {
      retryDelayMs = Math.min(5 * 60 * 1000, retryDelayMs * 2);
    }
  }

  function isRetryableEmbeddingError(error, signal) {
    if (!CONFIG.enabled || signal?.aborted) return false;
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false;
    if (error?.code === 'EMBED_MODEL_UNSUPPORTED') return false;
    return !/dim mismatch|embedding vector is empty/i.test(String(error?.message || error || ''));
  }

  function throwIfEmbeddingStopped(signal) {
    if (CONFIG.enabled && !signal?.aborted) return;
    const reason = signal?.reason;
    const error = new Error(
      reason instanceof Error
        ? reason.message
        : String(reason || (!CONFIG.enabled ? 'AI disabled' : 'Embedding cancelled'))
    );
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    if (reason instanceof Error) error.cause = reason;
    throw error;
  }

  function throwIfEmbeddingModelChanged(model) {
    if (String(CONFIG.embedModel || '') === model) return;
    const error = new Error(`Embedding model changed while work was in progress (${model || 'none'} -> ${CONFIG.embedModel || 'none'})`);
    error.code = 'EMBED_CONFIG_CHANGED';
    throw error;
  }
  
  function scheduleEmbed(vaultId, note) {
    if (!CONFIG.enabled) return;
    const k = key(vaultId, note.id);
    const now = Date.now();
    embedScheduleDelayMs = now - lastEmbedScheduleAt < 1000 ? Math.min(1500, embedScheduleDelayMs + 200) : 300;
    lastEmbedScheduleAt = now;
    pending.set(k, {
      vaultId,
      note,
      scheduled: now,
      sourceContentHash: sourceContentHash(note),
    });
    scheduleDrain(embedScheduleDelayMs); // adaptive batch window
  }
  
  async function drain() {
    drainScheduled = false;
    if (!CONFIG.enabled) {
      pending.clear();
      return;
    }
    // One drain at a time. A retry scheduled from inside the loop fired while
    // this one was still awaiting a note: the second pass embedded work the
    // first was already holding, and cleared the shared abort controller out
    // from under it — so disabling AI could no longer cancel what was running.
    // Whatever is left in `pending` is picked up by the tail of the drain that
    // is already going, so returning here loses nothing.
    if (draining) return;
    draining = true;
    try {
      await drainOnce();
    } finally {
      draining = false;
    }
  }

  async function drainOnce() {
    const work = [];
    for (const [k, job] of pending.entries()) {
      if (inFlight.has(k)) continue;
      pending.delete(k);
      inFlight.add(k);
      work.push({ k, ...job });
    }
    if (!work.length) return;
    const controller = new AbortController();
    state.embedAbortController = controller;
    try {
      // Probe once per drain. The controller is installed before this await so
      // disabling AI can cancel work that has already left `pending`.
      let st;
      try {
        st = await status();
      } catch (e) {
        if (isRetryableEmbeddingError(e, controller.signal)) queueRetry(work);
        else discardWork(work);
        return;
      }
      if (!CONFIG.enabled || controller.signal.aborted) {
        discardWork(work);
        return;
      }
      if (!st.reachable || !st.embedModelOk) {
        queueRetry(work);
        return;
      }
      retryDelayMs = 1000;
      // Process sequentially to avoid stampeding the local server.
      for (const w of work) {
        try {
          await embedNote(w.vaultId, w.note, {
            signal: controller.signal,
            sourceContentHash: w.sourceContentHash,
          });
        }
        catch (e) {
          if (isRetryableEmbeddingError(e, controller.signal)) {
            queueRetry([w]);
          } else {
            inFlight.delete(w.k);
          }
          if (e.name !== 'AbortError' && e.code !== 'ABORT_ERR' && e.code !== 'EMBED_MODEL_UNSUPPORTED') {
            console.warn('[ai] embedNote failed', w.note?.id, e.message);
          }
        }
        finally {
          inFlight.delete(w.k);
        }
      }
    } finally {
      // Only retire the controller if it is still the one this pass installed.
      if (state.embedAbortController === controller) state.embedAbortController = null;
      if (pending.size && !drainScheduled) scheduleDrain(embedScheduleDelayMs);
    }
  }
  
  // Embed every chunk of a note and store the vectors.
  async function embedNote(vaultId, note, options = {}) {
    throwIfEmbeddingStopped(options.signal);
    const embedModel = String(options.embedModel || CONFIG.embedModel || '');
    let st;
    try {
      st = await status();
    } catch (error) {
      throwIfEmbeddingStopped(options.signal);
      throw error;
    }
    throwIfEmbeddingStopped(options.signal);
    throwIfEmbeddingModelChanged(embedModel);
    if (!st.embedModelOk) throw new Error(`Embedding model not installed: ollama pull ${embedModel}`);
    const chunks = idx.chunkNote(note);
    if (!chunks.length) return;
    // Run a small pool of parallel requests.
    const N = Math.max(1, CONFIG.embedConcurrency);
    const out = new Array(chunks.length);
    let next = 0;
    await Promise.all(Array.from({ length: N }, async () => {
      while (true) {
        const i = next++;
        if (i >= chunks.length) return;
        throwIfEmbeddingStopped(options.signal);
        throwIfEmbeddingModelChanged(embedModel);
        try {
          out[i] = await embedWithConfiguredModel(chunks[i], { signal: options.signal }, embedModel);
        } catch (error) {
          throwIfEmbeddingStopped(options.signal);
          throwIfEmbeddingModelChanged(embedModel);
          throw error;
        }
        throwIfEmbeddingStopped(options.signal);
        throwIfEmbeddingModelChanged(embedModel);
      }
    }));
    throwIfEmbeddingStopped(options.signal);
    throwIfEmbeddingModelChanged(embedModel);
    return idx.setNoteEmbeddings(
      vaultId,
      note,
      out,
      embedModel,
      options.sourceContentHash || sourceContentHash(note)
    );
  }
  
  async function embedQueryCached(text, options = {}) {
    const embedModel = String(CONFIG.embedModel || '');
    const cacheKey = `${embedModel}\n${String(text || '').slice(0, 2000)}`;
    const cached = queryEmbeddingCache.get(cacheKey);
    if (cached && Date.now() - cached.at < QUERY_CACHE_MS) return cached.value;
    const value = await embedWithConfiguredModel(text, options, embedModel);
    throwIfEmbeddingModelChanged(embedModel);
    queryEmbeddingCache.set(cacheKey, { at: Date.now(), value });
    if (queryEmbeddingCache.size > 80) {
      const first = queryEmbeddingCache.keys().next().value;
      queryEmbeddingCache.delete(first);
    }
    return value;
  }
  
  // Find notes semantically similar to a source note, scoped to its vault.
  // Embeds the source note's title + opening body as a query and runs KNN over
  // the existing per-chunk vectors. Returns up to `limit` distinct notes,
  // excluding the source itself, ordered by distance ascending. Falls back to
  // FTS-based "more like this" when embeddings aren't available.
  async function relatedNotes(vaultId, noteId, store, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 6, 24));
    const v = await store.loadVault(vaultId);
    const note = (v.notes || []).find(n => n.id === noteId);
    if (!note) return { ok: false, reason: 'Note not found' };
  
    // Build a compact query string: title carries the strongest signal, body
    // gives topical detail. We cap to keep the embed cost cheap and stable.
    const titlePart = String(note.title || '').trim();
    const bodyPart = String(note.body || '').replace(/^[a-zA-Z_][a-zA-Z0-9_-]*::\s.*$/gm, '').trim().slice(0, 1500);
    const query = [titlePart, bodyPart].filter(Boolean).join('\n\n');
    if (!query) return { ok: true, mode: 'empty', items: [] };
  
    const st = await status();
    const seen = new Set([noteId]);
    const items = [];
    const pushHit = (hit, mode) => {
      if (!hit?.noteId || seen.has(hit.noteId)) return;
      seen.add(hit.noteId);
      items.push({
        noteId: hit.noteId,
        title: hit.title,
        snippet: String(hit.chunkText || '').slice(0, 200),
        distance: hit.distance,
        mode,
      });
    };
  
    let semanticAvailable = st.embedModelOk;
    if (semanticAvailable) {
      try {
        const qVec = await embedQueryCached(query, { signal: options.signal });
        const hits = idx.vectorSearch(vaultId, qVec, Math.max(limit * 3, 12));
        for (const hit of hits) pushHit(hit, 'semantic');
      } catch (e) {
        if (e.code === 'EMBED_MODEL_UNSUPPORTED') semanticAvailable = false;
        if (e.code !== 'EMBED_MODEL_UNSUPPORTED') console.warn('[ai] related notes vector search failed', e.message);
      }
    }
  
    // Top up with lexical matches (title + first paragraph as the query) so
    // small/early-stage vaults still get suggestions even before embeddings
    // back-fill, and so the panel never looks empty for short notes.
    if (items.length < limit) {
      const lex = idx.lexicalContextSearch(vaultId, titlePart || query.slice(0, 200), Math.max(limit * 2, 8));
      for (const hit of lex) {
        if (items.length >= limit * 2) break;
        pushHit(hit, 'keyword');
      }
    }
  
    return {
      ok: true,
      mode: semanticAvailable ? 'semantic' : 'keyword',
      items: items.slice(0, limit),
    };
  }
  
  // Backfill missing embeddings for a vault. Reads every note from disk via
  // the store, embeds those that don't have a chunk for the current model.
  async function backfillVault(vaultId, store) {
    const existing = backfillJobs.get(vaultId);
    if (existing?.running) return { ok: true, running: true, ...backfillStatus(vaultId) };
    const st = await status();
    if (!st.reachable) return { ok: false, reason: 'Ollama not reachable' };
    if (!st.embedModelOk) return { ok: false, reason: `Embedding model not installed: ollama pull ${CONFIG.embedModel}` };
    const need = idx.notesNeedingEmbeddings(vaultId, CONFIG.embedModel);
    if (!need.length) {
      const idle = { running: false, total: 0, done: 0, embedded: 0, failed: [], lastBackfill: new Date().toISOString(), reason: '' };
      backfillJobs.set(vaultId, idle);
      return { ok: true, embedded: 0 };
    }
    const v = await store.loadVault(vaultId);
    // Embed recently edited notes first so semantic search becomes useful for
    // current work while a long first-run backfill is still in flight. The map
    // also replaces the per-id linear scan through v.notes below.
    const notesById = new Map((v.notes || []).map(n => [n.id, n]));
    const noteRecency = (id) => {
      const note = notesById.get(id);
      const time = Date.parse(note?.modifiedAt || note?.date || '');
      return Number.isFinite(time) ? time : 0;
    };
    need.sort((a, b) => noteRecency(b) - noteRecency(a));
    const controller = new AbortController();
    const state = {
      running: true,
      total: need.length,
      done: 0,
      embedded: 0,
      failed: [],
      startedAt: new Date().toISOString(),
      lastBackfill: null,
      reason: '',
      controller,
    };
    backfillJobs.set(vaultId, state);
    let count = 0;
    const failed = [];
    try {
      for (const id of need) {
        if (controller.signal.aborted) {
          state.reason = 'Cancelled';
          return { ok: false, canceled: true, reason: 'Cancelled', embedded: count, failed };
        }
        const note = notesById.get(id);
        if (!note) {
          state.done++;
          continue;
        }
        try {
          const result = await embedNote(vaultId, note, { signal: controller.signal });
          if (result?.committed === false) {
            failed.push({ id, error: 'Note changed while embeddings were generated' });
            state.failed = failed.slice();
          } else {
            count++;
            state.embedded = count;
          }
        }
        catch (e) {
          if (e.code === 'EMBED_MODEL_UNSUPPORTED') {
            state.reason = e.message;
            return { ok: false, reason: e.message, embedded: count, failed };
          }
          if (e.name === 'AbortError' || e.code === 'ABORT_ERR') {
            state.reason = 'Cancelled';
            return { ok: false, canceled: true, reason: 'Cancelled', embedded: count, failed };
          }
          failed.push({ id, error: e.message || String(e) });
          state.failed = failed.slice();
          console.warn('[ai] backfill failed for', id, e.message);
        } finally {
          state.done++;
        }
      }
      if (!failed.length && typeof idx.markEmbeddingsNormalized === 'function') idx.markEmbeddingsNormalized();
      state.reason = failed.length ? `${failed.length} notes failed` : '';
      return { ok: failed.length === 0, embedded: count, failed };
    } finally {
      state.running = false;
      state.lastBackfill = new Date().toISOString();
      delete state.controller;
    }
  }
  
  function backfillStatus(vaultId) {
    const state = backfillJobs.get(vaultId);
    if (!state) return { running: false, total: 0, done: 0, embedded: 0, failed: [], lastBackfill: null, reason: '' };
    return {
      running: !!state.running,
      total: state.total || 0,
      done: state.done || 0,
      embedded: state.embedded || 0,
      failed: state.failed || [],
      startedAt: state.startedAt || null,
      lastBackfill: state.lastBackfill || null,
      reason: state.reason || '',
    };
  }
  
  function cancelBackfill(vaultId) {
    const state = backfillJobs.get(vaultId);
    if (!state?.running || !state.controller) return { ok: false, error: 'No running backfill job found' };
    state.controller.abort();
    state.running = false;
    state.reason = 'Cancelled';
    state.lastBackfill = new Date().toISOString();
    return { ok: true };
  }

  function indexStatus(vaultId) {
    const health = idx.indexHealth(vaultId, CONFIG.embedModel);
    return {
      ...health,
      backfill: backfillStatus(vaultId),
    };
  }
  
  // ── RAG ─────────────────────────────────────────────────────────────────────
  return { pending, inFlight, drainScheduled, lastEmbedScheduleAt, embedScheduleDelayMs, key, scheduleEmbed, drain, embedNote, embedQueryCached, relatedNotes, backfillVault, backfillStatus, cancelBackfill, indexStatus };
}

module.exports = { createEmbeddingDomain };
