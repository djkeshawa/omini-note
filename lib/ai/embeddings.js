function createEmbeddingDomain(scope) {
  const CONFIG = scope.CONFIG;
  const QUERY_CACHE_MS = scope.QUERY_CACHE_MS;
  const backfillJobs = scope.backfillJobs;
  const embedWithConfiguredModel = (...args) => scope.embedWithConfiguredModel(...args);
  const idx = scope.idx;
  const queryEmbeddingCache = scope.queryEmbeddingCache;
  const state = scope.state;
  const status = (...args) => scope.status(...args);
  const pending = new Map();  // key: `${vaultId}:${noteId}` → { vaultId, note, scheduled: timestamp }
  const inFlight = new Set(); // keys currently being embedded
  let drainScheduled = false;
  let lastEmbedScheduleAt = 0;
  let embedScheduleDelayMs = 300;
  
  function key(vaultId, noteId) { return `${vaultId}:${noteId}`; }
  
  function scheduleEmbed(vaultId, note) {
    if (!CONFIG.enabled) return;
    const k = key(vaultId, note.id);
    const now = Date.now();
    embedScheduleDelayMs = now - lastEmbedScheduleAt < 1000 ? Math.min(1500, embedScheduleDelayMs + 200) : 300;
    lastEmbedScheduleAt = now;
    pending.set(k, { vaultId, note, scheduled: Date.now() });
    if (!drainScheduled) {
      drainScheduled = true;
      setTimeout(drain, embedScheduleDelayMs); // adaptive batch window
    }
  }
  
  async function drain() {
    drainScheduled = false;
    const work = [];
    for (const [k, job] of pending.entries()) {
      if (inFlight.has(k)) continue;
      pending.delete(k);
      inFlight.add(k);
      work.push({ k, ...job });
    }
    if (!work.length) return;
    // Probe once per drain. Keyword Ask AI can work without embeddings, but
    // background indexing should wait until the configured embed model exists.
    const st = await status();
    if (!st.reachable || !st.embedModelOk) {
      for (const w of work) inFlight.delete(w.k);
      return;
    }
    // Process sequentially to avoid stampeding the local server.
    state.embedAbortController = new AbortController();
    for (const w of work) {
      try { await embedNote(w.vaultId, w.note, { signal: state.embedAbortController.signal }); }
      catch (e) {
        if (e.name !== 'AbortError' && e.code !== 'ABORT_ERR' && e.code !== 'EMBED_MODEL_UNSUPPORTED') console.warn('[ai] embedNote failed', w.note?.id, e.message);
      }
      finally { inFlight.delete(w.k); }
    }
    state.embedAbortController = null;
    if (pending.size) { drainScheduled = true; setTimeout(drain, embedScheduleDelayMs); }
  }
  
  // Embed every chunk of a note and store the vectors.
  async function embedNote(vaultId, note, options = {}) {
    const st = await status();
    if (!st.embedModelOk) throw new Error(`Embedding model not installed: ollama pull ${CONFIG.embedModel}`);
    if (options.signal?.aborted) throw options.signal.reason || new Error('Embedding cancelled');
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
        out[i] = await embedWithConfiguredModel(chunks[i], { signal: options.signal });
      }
    }));
    idx.setNoteEmbeddings(vaultId, note, out, CONFIG.embedModel);
  }
  
  async function embedQueryCached(text, options = {}) {
    const key = `${CONFIG.embedModel}\n${String(text || '').slice(0, 2000)}`;
    const cached = queryEmbeddingCache.get(key);
    if (cached && Date.now() - cached.at < QUERY_CACHE_MS) return cached.value;
    const value = await embedWithConfiguredModel(text, options);
    queryEmbeddingCache.set(key, { at: Date.now(), value });
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
          await embedNote(vaultId, note, { signal: controller.signal });
          count++;
          state.embedded = count;
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
