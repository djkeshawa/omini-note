// AI orchestration: embed notes via Ollama and answer questions with RAG.
// Failures are isolated — if Ollama isn't running, the rest of the app
// keeps working, and embeds simply don't happen.

const ollama = require('./ollama');
const idx = require('./index');
const vaultStore = require('./store');
const { spawn } = require('child_process');

// Defaults — overridable via setConfig() from prefs.
let CONFIG = {
  enabled: true,
  provider: 'ollama',
  ollamaHost: ollama.DEFAULT_HOST,
  embedModel: 'nomic-embed-text',
  chatModel: 'gemma3',           // user said gemma; replace if not installed
  embedConcurrency: 2,           // parallel chunks per note
  ragTopK: 6,                    // chunks fed to the LLM
};

const WHOLE_VAULT_MAX_NOTES = 12;
const WHOLE_VAULT_MAX_CHARS = 18000;
const SELECTED_NOTE_LIMIT = 8;
const MAX_CONTEXT_CHARS = 22000;
const MAX_NOTE_BODY_CHARS = 5000;

let ollamaProcess = null;

function getConfig() { return { ...CONFIG, ollamaHost: ollama.getHost() }; }
function setConfig(patch) {
  CONFIG = { ...CONFIG, ...patch };
  if (patch?.ollamaHost) ollama.setHost(patch.ollamaHost);
  return getConfig();
}

// ── Status ──────────────────────────────────────────────────────────────────

// Returns { reachable, models: [...], embedModelOk, chatModelOk }
async function status() {
  if (CONFIG.provider !== 'ollama') {
    return {
      reachable: false,
      models: [],
      embedModelOk: false,
      chatModelOk: false,
      providerReady: false,
      reason: `Provider "${CONFIG.provider}" is not implemented yet`,
      config: getConfig(),
    };
  }
  const reachable = await ollama.ping();
  if (!reachable) {
    return { reachable: false, models: [], embedModelOk: false, chatModelOk: false, config: getConfig() };
  }
  let models = [];
  try { models = (await ollama.tags()).map(m => m.name); } catch { /* */ }
  const has = (name) => models.some(m => m === name || m.startsWith(name + ':'));
  if (!has(CONFIG.chatModel)) {
    const gemma = models.find(m => /^gemma/i.test(m));
    if (gemma) CONFIG.chatModel = gemma;
  }
  const embedModelOk = has(CONFIG.embedModel);
  const chatModelOk = has(CONFIG.chatModel);
  return {
    reachable: true,
    models,
    embedModelOk,
    chatModelOk,
    askMode: embedModelOk ? 'semantic' : 'keyword',
    ready: chatModelOk,
    config: getConfig(),
  };
}

async function connect() {
  if (CONFIG.provider !== 'ollama') return await status();
  if (await ollama.ping()) return await status();

  if (!ollamaProcess || ollamaProcess.killed) {
    try {
      const hostForEnv = ollama.getHost().replace(/^https?:\/\//, '');
      ollamaProcess = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, OLLAMA_HOST: hostForEnv },
      });
      ollamaProcess.unref();
    } catch (e) {
      return {
        ...(await status()),
        connectError: `Could not start Ollama: ${e.message || String(e)}`,
      };
    }
  }

  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (await ollama.ping()) return await status();
  }
  return {
    ...(await status()),
    connectError: `Ollama did not respond at ${ollama.getHost()}. Try running "ollama serve" in a terminal.`,
  };
}

// ── Embed-on-save: serial queue with per-note dedup ─────────────────────────
// We hold a single in-flight job per (vaultId, noteId) and coalesce repeats —
// rapid edits during typing only embed the final state.

const pending = new Map();  // key: `${vaultId}:${noteId}` → { vaultId, note, scheduled: timestamp }
const inFlight = new Set(); // keys currently being embedded
let drainScheduled = false;

function key(vaultId, noteId) { return `${vaultId}:${noteId}`; }

function scheduleEmbed(vaultId, note) {
  if (!CONFIG.enabled) return;
  const k = key(vaultId, note.id);
  pending.set(k, { vaultId, note, scheduled: Date.now() });
  if (!drainScheduled) {
    drainScheduled = true;
    setTimeout(drain, 300); // small batch window
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
  for (const w of work) {
    try { await embedNote(w.vaultId, w.note); }
    catch (e) { console.warn('[ai] embedNote failed', w.note?.id, e.message); }
    finally { inFlight.delete(w.k); }
  }
  if (pending.size) { drainScheduled = true; setTimeout(drain, 300); }
}

// Embed every chunk of a note and store the vectors.
async function embedNote(vaultId, note) {
  const st = await status();
  if (!st.embedModelOk) throw new Error(`Embedding model not installed: ollama pull ${CONFIG.embedModel}`);
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
      out[i] = await ollama.embed(CONFIG.embedModel, chunks[i]);
    }
  }));
  idx.setNoteEmbeddings(vaultId, note, out, CONFIG.embedModel);
}

// Backfill missing embeddings for a vault. Reads every note from disk via
// the store, embeds those that don't have a chunk for the current model.
async function backfillVault(vaultId, store) {
  const st = await status();
  if (!st.reachable) return { ok: false, reason: 'Ollama not reachable' };
  if (!st.embedModelOk) return { ok: false, reason: `Embedding model not installed: ollama pull ${CONFIG.embedModel}` };
  const need = idx.notesNeedingEmbeddings(vaultId, CONFIG.embedModel);
  if (!need.length) return { ok: true, embedded: 0 };
  const v = await store.loadVault(vaultId);
  let count = 0;
  for (const id of need) {
    const note = v.notes.find(n => n.id === id);
    if (!note) continue;
    try { await embedNote(vaultId, note); count++; }
    catch (e) { console.warn('[ai] backfill failed for', id, e.message); }
  }
  return { ok: true, embedded: count };
}

// ── RAG ─────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an assistant that answers questions strictly from the user's personal notes.

Rules:
- Use only the provided context. If the context doesn't contain the answer, say so plainly.
- Quote short phrases verbatim when useful, in "quotes".
- Cite sources by the note title in square brackets after each claim, like: [Note Title].
- Never cite context labels such as [Note 1], [Context item], or note ids.
- Use modifiedAt as the last saved edit time. Use noteDate as the note's own front-matter date.
- If the context says only selected notes were included and the question is broad, mention that briefly.
- Be concise. Prefer 2–4 short paragraphs or a tight bulleted list.`;

const EDIT_SYSTEM_PROMPT = `You are an editing assistant inside a note-taking app.

Rules:
- Return only the edited replacement text.
- Do not wrap the result in markdown fences.
- Preserve the user's meaning unless the instruction asks for summarization.
- Preserve useful markdown structure, wiki-links, tags, task markers, and headings when possible.
- Do not explain what you changed.`;

const CHAT_SYSTEM_PROMPT = `You are OminiNote's local AI assistant.

Rules:
- Be conversational, concise, and helpful.
- You can explain that you can answer questions about notes, create pages, link notes, and edit or format the current page when the app asks you to.
- Do not pretend you searched the user's notes unless note context is provided.
- If the user asks about their notes but no note context is provided, ask them to phrase it as a note question or use the Ask AI notes flow.`;

function isRecencyQuery(query) {
  const q = String(query || '').toLowerCase();
  const recency = /(latest|newest|most recent|recent|last|updated|update|modified|changed|saved|edited)/;
  const noteish = /(note|notes|update|updates|edit|edits|change|changes|wrote|writing|vault)/;
  return recency.test(q) && noteish.test(q);
}

function noteTextLength(note) {
  return [
    note.title || '',
    note.date || '',
    note.modifiedAt || '',
    (note.tags || []).join(' '),
    note.body || '',
  ].join('\n').length;
}

function sortByModified(notes) {
  return [...notes].sort((a, b) => {
    const bm = new Date(b.modifiedAt || b.date || 0).getTime();
    const am = new Date(a.modifiedAt || a.date || 0).getTime();
    return bm - am;
  });
}

function fitNotes(notes, maxChars = MAX_CONTEXT_CHARS) {
  const selected = [];
  let used = 0;
  for (const note of notes) {
    const body = String(note.body || '');
    const bodyLimit = Math.min(MAX_NOTE_BODY_CHARS, Math.max(1200, maxChars - used));
    const clippedBody = body.length > bodyLimit
      ? body.slice(0, bodyLimit).trimEnd() + '\n...[truncated]'
      : body;
    const next = { ...note, body: clippedBody };
    const cost = noteTextLength(next) + 180;
    if (selected.length && used + cost > maxChars) break;
    selected.push(next);
    used += cost;
    if (used >= maxChars) break;
  }
  return { notes: selected, usedChars: used, capped: selected.length < notes.length };
}

async function retrievalNoteIds(vaultId, query, st) {
  const ids = [];
  const add = (noteId) => {
    if (noteId && !ids.includes(noteId)) ids.push(noteId);
  };
  if (st.embedModelOk) {
    try {
      const qVec = await ollama.embed(CONFIG.embedModel, query);
      for (const hit of idx.vectorSearch(vaultId, qVec, CONFIG.ragTopK)) add(hit.noteId);
    } catch (e) {
      console.warn('[ai] vector retrieval failed', e.message);
    }
  }
  for (const hit of idx.lexicalContextSearch(vaultId, query, CONFIG.ragTopK)) add(hit.noteId);
  return ids;
}

async function buildVaultContext(vaultId, query, st, storeApi = vaultStore) {
  const vault = await storeApi.loadVault(vaultId);
  const allNotes = sortByModified(vault.notes || []);
  const allChars = allNotes.reduce((sum, note) => sum + noteTextLength(note), 0);
  const recency = isRecencyQuery(query);
  const wholeVault = allNotes.length <= WHOLE_VAULT_MAX_NOTES && allChars <= WHOLE_VAULT_MAX_CHARS;

  if (wholeVault) {
    const fit = fitNotes(allNotes);
    return {
      mode: 'whole-vault',
      notes: fit.notes,
      totalNotes: allNotes.length,
      capped: fit.capped,
      reason: 'the active vault is small enough to include in full',
    };
  }

  if (recency) {
    const fit = fitNotes(allNotes.slice(0, SELECTED_NOTE_LIMIT));
    return {
      mode: 'recent',
      notes: fit.notes,
      totalNotes: allNotes.length,
      capped: true,
      reason: 'the question asks about recent or latest updates',
    };
  }

  const ids = await retrievalNoteIds(vaultId, query, st);
  const byId = new Map(allNotes.map(note => [note.id, note]));
  const selected = ids.map(id => byId.get(id)).filter(Boolean);
  const withRecentFallback = selected.length ? selected : allNotes.slice(0, Math.min(SELECTED_NOTE_LIMIT, allNotes.length));
  const fit = fitNotes(withRecentFallback);
  return {
    mode: selected.length ? (st.embedModelOk ? 'semantic' : 'keyword') : 'recent-fallback',
    notes: fit.notes,
    totalNotes: allNotes.length,
    capped: fit.capped || allNotes.length > fit.notes.length,
    reason: selected.length ? 'the notes matched semantic or keyword retrieval' : 'no direct match was found, so recent notes were used',
  };
}

function buildRagPrompt(query, context) {
  const ctx = context.notes.map((note, i) => {
    const tags = (note.tags || []).map(t => `#${t}`).join(' ') || 'none';
    return [
      `--- Context item ${i + 1} ---`,
      `title: ${note.title || 'Untitled'}`,
      `id: ${note.id}`,
      `noteDate: ${note.date || 'unknown'}`,
      `modifiedAt: ${note.modifiedAt || 'unknown'}`,
      `tags: ${tags}`,
      '',
      String(note.body || '').trim() || '(empty note)',
    ].join('\n');
  }).join('\n\n');
  const selection = [
    `Selection mode: ${context.mode}`,
    `Selection reason: ${context.reason}`,
    `Notes provided: ${context.notes.length} of ${context.totalNotes}`,
    `Context capped: ${context.capped ? 'yes' : 'no'}`,
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content:
        `Context selection:\n${selection}\n\n` +
        `Context from my notes:\n\n${ctx}\n\n` +
        `Question: ${query}\n\n` +
        `Answer using only the context above.`
    },
  ];
}

// Gather vault context → chat with selected notes. Returns { answer, sources }.
async function ask(vaultId, query, storeApi = vaultStore) {
  if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
  if (CONFIG.provider !== 'ollama') return { ok: false, error: `Provider "${CONFIG.provider}" is not implemented yet` };
  if (!await ollama.ping()) return { ok: false, error: 'Ollama not reachable at ' + ollama.getHost() };
  const st = await status();
  if (!st.chatModelOk) {
    return { ok: false, error: `Chat model not installed: ollama pull ${CONFIG.chatModel}` };
  }

  const context = await buildVaultContext(vaultId, query, st, storeApi);
  if (!context.notes.length) {
    return { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] };
  }
  const messages = buildRagPrompt(query, context);
  const { text } = await ollama.chat(CONFIG.chatModel, messages);
  const sources = context.notes.map(note => ({
    id: note.id,
    title: note.title,
    modifiedAt: note.modifiedAt,
    snippet: String(note.body || '').slice(0, 200),
  }));
  return { ok: true, answer: text.trim(), sources, mode: context.mode, contextCapped: context.capped };
}

async function editText({ text, instruction, scope }) {
  if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
  if (CONFIG.provider !== 'ollama') return { ok: false, error: `Provider "${CONFIG.provider}" is not implemented yet` };
  if (!await ollama.ping()) return { ok: false, error: 'Ollama not reachable at ' + ollama.getHost() };
  const st = await status();
  if (!st.chatModelOk) {
    return { ok: false, error: `Chat model not installed: ollama pull ${CONFIG.chatModel}` };
  }
  const source = String(text || '');
  if (!source.trim()) return { ok: false, error: 'No text selected for AI editing' };
  const messages = [
    { role: 'system', content: EDIT_SYSTEM_PROMPT },
    { role: 'user', content:
        `Scope: ${scope || 'text'}\n` +
        `Instruction: ${instruction || 'Improve the writing.'}\n\n` +
        `Text:\n${source}`
    },
  ];
  const { text: edited } = await ollama.chat(CONFIG.chatModel, messages);
  return { ok: true, text: String(edited || '').trim() };
}

async function chat(input) {
  if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
  if (CONFIG.provider !== 'ollama') return { ok: false, error: `Provider "${CONFIG.provider}" is not implemented yet` };
  if (!await ollama.ping()) return { ok: false, error: 'Ollama not reachable at ' + ollama.getHost() };
  const st = await status();
  if (!st.chatModelOk) {
    return { ok: false, error: `Chat model not installed: ollama pull ${CONFIG.chatModel}` };
  }
  const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
  const messages = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...provided
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
      .slice(-8)
      .map(m => ({ role: m.role, content: String(m.content) })),
  ];
  const { text } = await ollama.chat(CONFIG.chatModel, messages);
  return { ok: true, answer: String(text || '').trim() };
}

module.exports = {
  status, connect, getConfig, setConfig,
  scheduleEmbed, embedNote, backfillVault,
  ask, editText, chat, buildVaultContext,
};
