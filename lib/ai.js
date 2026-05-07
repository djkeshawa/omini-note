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
  openaiBaseUrl: 'https://api.openai.com/v1',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  anthropicBaseUrl: 'https://api.anthropic.com',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  customBaseUrl: '',
  embedModel: 'nomic-embed-text',
  chatModel: 'gemma3',           // user said gemma; replace if not installed
  embedConcurrency: 2,           // parallel chunks per note
  ragTopK: 6,                    // chunks fed to the LLM
  piiReduction: true,            // redact common identifiers before hosted AI calls
};

const PROVIDERS = {
  ollama: {
    label: 'Ollama',
    apiKeyField: null,
    baseUrlField: 'ollamaHost',
    defaultBaseUrl: ollama.DEFAULT_HOST,
    defaultChatModel: 'gemma3',
  },
  openai: {
    label: 'OpenAI',
    apiKeyField: 'openaiApiKey',
    baseUrlField: 'openaiBaseUrl',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultChatModel: 'gpt-4o-mini',
    compatible: 'openai',
  },
  openrouter: {
    label: 'OpenRouter',
    apiKeyField: 'openrouterApiKey',
    baseUrlField: 'openrouterBaseUrl',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultChatModel: 'openai/gpt-4o-mini',
    compatible: 'openai',
  },
  anthropic: {
    label: 'Anthropic',
    apiKeyField: 'anthropicApiKey',
    baseUrlField: 'anthropicBaseUrl',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultChatModel: 'claude-sonnet-4-5-20250929',
    compatible: 'anthropic',
  },
  gemini: {
    label: 'Gemini',
    apiKeyField: 'geminiApiKey',
    baseUrlField: 'geminiBaseUrl',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultChatModel: 'gemini-2.5-flash',
    compatible: 'gemini',
  },
  custom: {
    label: 'Custom',
    apiKeyField: 'customApiKey',
    baseUrlField: 'customBaseUrl',
    defaultBaseUrl: '',
    defaultChatModel: '',
    compatible: 'openai',
  },
};

const STATUS_CACHE_MS = 8000;
const OLLAMA_KEEP_ALIVE = '10m';
const WHOLE_VAULT_MAX_NOTES = 12;
const WHOLE_VAULT_MAX_CHARS = 18000;
const SELECTED_NOTE_LIMIT = 8;
const MAX_CONTEXT_CHARS = 22000;
const MAX_NOTE_BODY_CHARS = 5000;
const TRAVERSAL_SEED_LIMIT = 8;
const TRAVERSAL_MAX_NOTES = 18;
const TRAVERSAL_SHARED_TAG_LIMIT = 3;
const NOTE_RESEARCH_MAX_ROUNDS = 4;
const NOTE_RESEARCH_MAX_TOOL_CALLS = 14;
const NOTE_RESEARCH_MAX_NOTES = 28;
const NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND = 4;
const NOTE_RESEARCH_MAX_SUMMARIES = 2;
const NOTE_RESEARCH_TOOL_RESULT_CHARS = 900;
const AI_CONFIG_KEYS = new Set([
  'enabled',
  'provider',
  'ollamaHost',
  'openaiBaseUrl',
  'openrouterBaseUrl',
  'anthropicBaseUrl',
  'geminiBaseUrl',
  'customBaseUrl',
  'openaiApiKey',
  'openrouterApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'customApiKey',
  'embedModel',
  'chatModel',
  'embedConcurrency',
  'ragTopK',
  'maxTokens',
  'piiReduction',
]);
const URL_CONFIG_KEYS = new Set([
  'ollamaHost',
  'openaiBaseUrl',
  'openrouterBaseUrl',
  'anthropicBaseUrl',
  'geminiBaseUrl',
  'customBaseUrl',
]);
const SECRET_CONFIG_KEYS = new Set([
  'openaiApiKey',
  'openrouterApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'customApiKey',
]);
const OLLAMA_ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const OLLAMA_ALLOWED_PORTS = new Set(['11434', '11435', '11436', '11437', '11438', '11439', '11440']);
const PRIVATE_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|\[?::1\]?)$/i;
const PROVIDER_TIMEOUT_MS = 45000;

let ollamaProcess = null;
let ollamaSpawnPromise = null;
let statusCache = null;
let embedModelFailure = null;
const cancellableJobs = new Map();

function getConfig() { return { ...CONFIG, ollamaHost: ollama.getHost() }; }
function publicConfig(config = getConfig()) {
  const out = { ...config };
  for (const key of SECRET_CONFIG_KEYS) {
    if (out[key]) out[key] = 'configured';
  }
  return out;
}
function assertPlainConfigPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Invalid AI config patch');
  }
}
function normalizeHttpUrl(value, field) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error(`Invalid ${field}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid ${field} protocol`);
  }
  if (field === 'ollamaHost') {
    const hostname = parsed.hostname;
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (parsed.protocol !== 'http:' || !OLLAMA_ALLOWED_HOSTS.has(hostname) || !OLLAMA_ALLOWED_PORTS.has(port)) {
      throw new Error('Ollama host must be local and use port 11434-11440');
    }
  } else {
    if (parsed.protocol !== 'https:') throw new Error(`${field} must use HTTPS`);
    if (PRIVATE_HOST_RE.test(parsed.hostname)) throw new Error(`${field} cannot target local or private hosts`);
  }
  return parsed.href.replace(/\/+$/, '');
}
function ollamaHostForEnv() {
  const parsed = new URL(normalizeHttpUrl(ollama.getHost(), 'ollamaHost'));
  return parsed.host || `${parsed.hostname}:11434`;
}
function ollamaServeEnv() {
  const keep = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR'];
  const env = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.OLLAMA_HOST = ollamaHostForEnv();
  return env;
}
function sanitizeModelName(value) {
  return String(value || '').trim().replace(/\0/g, '').slice(0, 120);
}
function sanitizeSecretValue(value) {
  return String(value || '').replace(/[\x00-\x1f]/g, '').trim();
}
function sanitizeConfigPatch(patch, { rejectUnknown = true } = {}) {
  assertPlainConfigPatch(patch);
  const unknown = Object.keys(patch).filter(key => !AI_CONFIG_KEYS.has(key));
  if (unknown.length && rejectUnknown) throw new Error('Unsupported AI config field: ' + unknown[0]);
  const next = {};
  for (const key of Object.keys(patch)) {
    if (!AI_CONFIG_KEYS.has(key)) continue;
    if (URL_CONFIG_KEYS.has(key)) {
      next[key] = normalizeHttpUrl(patch[key], key);
    } else if (SECRET_CONFIG_KEYS.has(key)) {
      next[key] = sanitizeSecretValue(patch[key]);
    } else if (key === 'provider') {
      const provider = String(patch[key] || '').trim().toLowerCase();
      next.provider = PROVIDERS[provider] ? provider : 'ollama';
    } else if (key === 'enabled') {
      next.enabled = patch[key] !== false;
    } else if (key === 'piiReduction') {
      next.piiReduction = patch[key] !== false;
    } else if (key === 'chatModel' || key === 'embedModel') {
      next[key] = sanitizeModelName(patch[key]);
    } else if (key === 'embedConcurrency') {
      const value = Number(patch[key]);
      next.embedConcurrency = Number.isFinite(value) ? Math.max(1, Math.min(6, Math.round(value))) : CONFIG.embedConcurrency;
    } else if (key === 'ragTopK') {
      const value = Number(patch[key]);
      next.ragTopK = Number.isFinite(value) ? Math.max(1, Math.min(20, Math.round(value))) : CONFIG.ragTopK;
    } else if (key === 'maxTokens') {
      const value = Number(patch[key]);
      next.maxTokens = Number.isFinite(value) ? Math.max(128, Math.min(8192, Math.round(value))) : undefined;
    }
  }
  return next;
}
function setConfig(patch, options = {}) {
  const cleanPatch = sanitizeConfigPatch(patch, options);
  const next = { ...CONFIG, ...cleanPatch };
  const provider = PROVIDERS[next.provider] ? next.provider : 'ollama';
  const meta = PROVIDERS[provider];
  if (!next.chatModel && meta.defaultChatModel) next.chatModel = meta.defaultChatModel;
  CONFIG = { ...next, provider };
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'ollamaHost')) ollama.setHost(cleanPatch.ollamaHost || ollama.DEFAULT_HOST);
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'embedModel')) embedModelFailure = null;
  statusCache = null;
  return getConfig();
}

function isEmbeddingUnsupportedError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /does not support embeddings|embedding.*not supported|not.*embedding|doesn't support embeddings/.test(message);
}

function markEmbedModelFailure(error) {
  const reason = CONFIG.embedModel
    ? `Embedding model "${CONFIG.embedModel}" does not support embeddings. Select or pull an embedding model such as nomic-embed-text.`
    : 'Embedding model is not configured.';
  embedModelFailure = {
    model: CONFIG.embedModel,
    reason,
    detail: String(error?.message || error || ''),
    at: Date.now(),
  };
  statusCache = null;
  return reason;
}

function currentEmbedModelFailure() {
  return embedModelFailure && embedModelFailure.model === CONFIG.embedModel ? embedModelFailure : null;
}

async function embedWithConfiguredModel(text, opts = {}) {
  const failure = currentEmbedModelFailure();
  if (failure) {
    const e = new Error(failure.reason);
    e.code = 'EMBED_MODEL_UNSUPPORTED';
    throw e;
  }
  try {
    return await ollama.embed(CONFIG.embedModel, text, { keep_alive: OLLAMA_KEEP_ALIVE, ...opts });
  } catch (e) {
    if (isEmbeddingUnsupportedError(e)) {
      const reason = markEmbedModelFailure(e);
      const next = new Error(reason);
      next.code = 'EMBED_MODEL_UNSUPPORTED';
      next.cause = e;
      throw next;
    }
    throw e;
  }
}

function shouldReducePiiForProvider() {
  return CONFIG.piiReduction !== false && CONFIG.provider !== 'ollama';
}

function isLikelyCreditCard(value) {
  if (!/(?:\d[ -]?){12,18}\d/.test(String(value || ''))) return false;
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleNext = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (doubleNext) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleNext = !doubleNext;
  }
  return sum > 0 && sum % 10 === 0;
}

function isLikelyPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function createPiiReducer() {
  const replacements = [];
  const seen = new Map();
  const counters = {};
  const remember = (type, value) => {
    const original = String(value || '');
    if (!original) return original;
    const key = `${type}\0${original}`;
    if (seen.has(key)) return seen.get(key);
    counters[type] = (counters[type] || 0) + 1;
    const placeholder = `[${type}_${counters[type]}]`;
    seen.set(key, placeholder);
    replacements.push({ placeholder, value: original });
    return placeholder;
  };
  return { replacements, remember };
}

function reducePiiText(text, reducer = createPiiReducer()) {
  let out = String(text || '');
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, value => reducer.remember('EMAIL', value));
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, value => reducer.remember('SSN', value));
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, value => reducer.remember('TOKEN', value));
  out = out.replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, value => reducer.remember('SECRET', value));
  out = out.replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, value => reducer.remember('IP', value));
  out = out.replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Place|Pl|Way)\b\.?/gi, value => reducer.remember('ADDRESS', value));
  out = out.replace(/(?:\d[ -]*?){13,19}/g, value => isLikelyCreditCard(value) ? reducer.remember('CARD', value) : value);
  out = out.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, value => isLikelyPhone(value) ? reducer.remember('PHONE', value) : value);
  return out;
}

function restorePiiText(text, replacements = []) {
  let out = String(text || '');
  for (const item of replacements) {
    out = out.split(item.placeholder).join(item.value);
  }
  return out;
}

function reducePiiMessages(messages, enabled = true) {
  const reducer = createPiiReducer();
  if (!enabled) return { messages, replacements: reducer.replacements };
  return {
    messages: messages.map(message => ({
      ...message,
      content: reducePiiText(message.content, reducer),
    })),
    replacements: reducer.replacements,
  };
}

function restorePiiResult(result, replacements) {
  if (!replacements?.length || !result || typeof result.text !== 'string') return result;
  return { ...result, text: restorePiiText(result.text, replacements) };
}

function currentProviderMeta() {
  return PROVIDERS[CONFIG.provider] || PROVIDERS.ollama;
}

function providerBaseUrl(meta = currentProviderMeta()) {
  const value = String(CONFIG[meta.baseUrlField] || meta.defaultBaseUrl || '').trim();
  return value.replace(/\/+$/, '');
}

function providerApiKey(meta = currentProviderMeta()) {
  if (!meta.apiKeyField) return '';
  return String(CONFIG[meta.apiKeyField] || '').trim();
}

function providerChatModel(meta = currentProviderMeta()) {
  return String(CONFIG.chatModel || meta.defaultChatModel || '').trim();
}

function providerStatus(meta = currentProviderMeta()) {
  const model = providerChatModel(meta);
  if (CONFIG.provider === 'ollama') return null;
  const apiKey = providerApiKey(meta);
  const baseUrl = providerBaseUrl(meta);
  const ready = !!apiKey && !!model && (CONFIG.provider !== 'custom' || !!baseUrl);
  const reason = !apiKey
    ? `${meta.label} API key is missing`
    : !model
      ? `${meta.label} chat model is missing`
      : CONFIG.provider === 'custom' && !baseUrl
        ? 'Custom provider base URL is missing'
        : `${meta.label} is configured`;
  return {
    reachable: ready,
    models: model ? [model] : [],
    embedModelOk: false,
    chatModelOk: ready,
    providerReady: ready,
    askMode: 'keyword',
    ready,
    reason,
  };
}

function beginCancellableJob(jobId) {
  if (!jobId) return null;
  const controller = new AbortController();
  cancellableJobs.set(jobId, controller);
  return controller.signal;
}

function finishCancellableJob(jobId) {
  if (jobId) cancellableJobs.delete(jobId);
}

function cancelJob(jobId) {
  const controller = cancellableJobs.get(jobId);
  if (!controller) return { ok: false, reason: 'No running AI job found' };
  controller.abort();
  cancellableJobs.delete(jobId);
  return { ok: true };
}

// ── Status ──────────────────────────────────────────────────────────────────

// Returns { reachable, models: [...], embedModelOk, chatModelOk }
async function status(options = {}) {
  if (!options.force && statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) {
    return { ...statusCache.value, config: publicConfig() };
  }
  const remember = (value) => {
    const next = { ...value, config: publicConfig() };
    statusCache = { at: Date.now(), value: next };
    return next;
  };
  if (CONFIG.provider !== 'ollama') return remember(providerStatus());
  const reachable = await ollama.ping();
  if (!reachable) {
    return remember({ reachable: false, models: [], embedModelOk: false, chatModelOk: false });
  }
  let models = [];
  try { models = (await ollama.tags()).map(m => m.name); } catch { /* */ }
  const has = (name) => models.some(m => m === name || m.startsWith(name + ':'));
  if (!has(CONFIG.chatModel)) {
    const gemma = models.find(m => /^gemma/i.test(m));
    if (gemma) CONFIG.chatModel = gemma;
  }
  const embedModelOk = has(CONFIG.embedModel);
  const embedFailure = currentEmbedModelFailure();
  const chatModelOk = has(CONFIG.chatModel);
  return remember({
    reachable: true,
    models,
    embedModelOk: embedModelOk && !embedFailure,
    embedModelReason: embedFailure?.reason || null,
    chatModelOk,
    askMode: embedModelOk && !embedFailure ? 'semantic' : 'keyword',
    ready: chatModelOk,
  });
}

async function connect() {
  if (CONFIG.provider !== 'ollama') return await status();
  if (await ollama.ping()) return await status({ force: true });

  if (!ollamaProcess || ollamaProcess.killed) {
    if (!ollamaSpawnPromise) {
      ollamaSpawnPromise = (async () => {
        ollamaProcess = spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore',
          env: ollamaServeEnv(),
        });
        ollamaProcess.unref();
      })().finally(() => {
        ollamaSpawnPromise = null;
      });
    }
    try {
      await ollamaSpawnPromise;
    } catch (e) {
      return {
        ...(await status({ force: true })),
        connectError: `Could not start Ollama: ${e.message || String(e)}`,
      };
    }
  }

  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (await ollama.ping()) return await status({ force: true });
  }
  return {
    ...(await status({ force: true })),
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
    catch (e) {
      if (e.code !== 'EMBED_MODEL_UNSUPPORTED') console.warn('[ai] embedNote failed', w.note?.id, e.message);
    }
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
      out[i] = await embedWithConfiguredModel(chunks[i]);
    }
  }));
  idx.setNoteEmbeddings(vaultId, note, out, CONFIG.embedModel);
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
      const qVec = await embedWithConfiguredModel(query);
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
  const st = await status();
  if (!st.reachable) return { ok: false, reason: 'Ollama not reachable' };
  if (!st.embedModelOk) return { ok: false, reason: `Embedding model not installed: ollama pull ${CONFIG.embedModel}` };
  const need = idx.notesNeedingEmbeddings(vaultId, CONFIG.embedModel);
  if (!need.length) return { ok: true, embedded: 0 };
  const v = await store.loadVault(vaultId);
  let count = 0;
  const failed = [];
  for (const id of need) {
    const note = v.notes.find(n => n.id === id);
    if (!note) continue;
    try { await embedNote(vaultId, note); count++; }
    catch (e) {
      if (e.code === 'EMBED_MODEL_UNSUPPORTED') {
        return { ok: false, reason: e.message, embedded: count, failed };
      }
      failed.push({ id, error: e.message || String(e) });
      console.warn('[ai] backfill failed for', id, e.message);
    }
  }
  return { ok: failed.length === 0, embedded: count, failed };
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

const CHAT_SYSTEM_PROMPT = `You are VispNote's local AI assistant.

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

async function retrievalNoteIds(vaultId, query, st, options = {}) {
  const ids = [];
  const add = (noteId) => {
    if (noteId && !ids.includes(noteId)) ids.push(noteId);
  };
  if (st.embedModelOk) {
    try {
      const qVec = await embedWithConfiguredModel(query, { signal: options.signal });
      for (const hit of idx.vectorSearch(vaultId, qVec, CONFIG.ragTopK)) add(hit.noteId);
    } catch (e) {
      if (e.code !== 'EMBED_MODEL_UNSUPPORTED') console.warn('[ai] vector retrieval failed', e.message);
    }
  }
  for (const hit of idx.lexicalContextSearch(vaultId, query, CONFIG.ragTopK)) add(hit.noteId);
  return ids;
}

function titleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function extractWikiLinkTitles(text = '') {
  const titles = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const title = String(match[1] || '').trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

function queryMentionsCurrentNote(query) {
  return /\b(this|current)\s+(page|note)\b|\b(on|in)\s+this\b/i.test(String(query || ''));
}

function shouldUseRecursiveNoteResearch(query, seedIds = [], options = {}) {
  if (options.recursiveResearch === false) return false;
  if (options.recursiveResearch === true) return true;
  const q = String(query || '').toLowerCase();
  if (queryMentionsCurrentNote(q)) return true;
  if (seedIds.length <= 2) return true;
  return /\b(across|all|everything|overall|summari[sz]e|summary|related|connect|connection|linked|backlink|tagged|tag|theme|decision|decide|decided|task|todo|follow[- ]?up|project|research|compare|timeline|history|what changed|what did i)\b/.test(q);
}

function buildNoteResearchCorpus(allNotes = []) {
  return {
    byId: new Map(allNotes.map(note => [note.id, note])),
    byTitle: new Map(allNotes.map(note => [titleKey(note.title), note]).filter(item => item[0])),
    metaById: new Map(allNotes.map(note => [
      note.id,
      {
        note,
        titleKey: titleKey(note.title),
        titleLower: String(note.title || '').toLowerCase(),
        bodyLower: String(note.body || '').toLowerCase(),
        tagLower: (note.tags || []).map(value => String(value || '').toLowerCase()),
        outgoingTitleKeys: extractWikiLinkTitles(note.body || '').map(titleKey),
        modifiedTime: new Date(note.modifiedAt || note.date || 0).getTime(),
      },
    ])),
  };
}

function expandTraversalCandidates(seedIds = [], allNotes = [], query = '', options = {}) {
  const corpus = options.corpus || buildNoteResearchCorpus(allNotes);
  const byId = corpus.byId;
  const byTitle = corpus.byTitle;
  const scores = new Map();
  const reasons = new Map();
  const add = (id, score, reason) => {
    if (!id || !byId.has(id)) return;
    scores.set(id, (scores.get(id) || 0) + score);
    if (!reasons.has(id)) reasons.set(id, new Set());
    reasons.get(id).add(reason);
  };

  if (options.currentNoteId && byId.has(options.currentNoteId) && queryMentionsCurrentNote(query)) {
    add(options.currentNoteId, 120, 'current note');
  }

  seedIds.slice(0, TRAVERSAL_SEED_LIMIT).forEach((id, index) => add(id, 100 - index * 4, 'retrieval match'));

  const seedSet = new Set([...scores.keys()].slice(0, TRAVERSAL_SEED_LIMIT));
  for (const seedId of seedSet) {
    const seed = byId.get(seedId);
    if (!seed) continue;
    for (const linkedTitle of extractWikiLinkTitles(seed.body || '')) {
      const linked = byTitle.get(titleKey(linkedTitle));
      if (linked) add(linked.id, 36, `linked from ${seed.title || 'note'}`);
    }
    for (const candidate of allNotes) {
      if (candidate.id === seedId) continue;
      const outgoing = corpus.metaById.get(candidate.id)?.outgoingTitleKeys || [];
      if (outgoing.includes(titleKey(seed.title))) add(candidate.id, 32, `backlinks to ${seed.title || 'note'}`);
    }
    const seedTags = (seed.tags || []).filter(Boolean).slice(0, TRAVERSAL_SHARED_TAG_LIMIT);
    for (const tag of seedTags) {
      for (const candidate of allNotes) {
        if (candidate.id === seedId) continue;
        if ((candidate.tags || []).includes(tag)) add(candidate.id, 12, `shares #${tag}`);
      }
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => {
      const note = byId.get(id);
      return {
        note,
        score,
        reasons: [...(reasons.get(id) || [])],
        modifiedTime: new Date(note.modifiedAt || note.date || 0).getTime(),
      };
    })
    .sort((a, b) => b.score - a.score || b.modifiedTime - a.modifiedTime)
    .slice(0, TRAVERSAL_MAX_NOTES);
}

function notePreview(note, maxChars = 240) {
  return String(note?.body || '')
    .replace(/^[a-zA-Z_][a-zA-Z0-9_-]*::\s.*$/gm, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, title, alias) => alias || title)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function compactNoteForResearch(note) {
  return {
    id: note.id,
    title: note.title || 'Untitled',
    tags: note.tags || [],
    modifiedAt: note.modifiedAt || note.date || null,
    links: extractWikiLinkTitles(note.body || '').slice(0, 8),
    preview: notePreview(note),
  };
}

function lexicalScoreMeta(meta, query) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9_-]+/).filter(term => term.length > 1);
  if (!terms.length) return 0;
  let score = 0;
  const tags = meta.tagLower.join(' ');
  for (const term of terms) {
    if (meta.titleLower.includes(term)) score += 8;
    if (tags.includes(term)) score += 5;
    if (meta.bodyLower.includes(term)) score += 1;
  }
  return score;
}

function parseResearchToolCalls(text) {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];
    try { parsed = JSON.parse(arrayMatch[0]); } catch { return []; }
  }
  const calls = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.calls) ? parsed.calls : []);
  return calls
    .map(call => ({
      tool: String(call?.tool || call?.name || call?.action || '').trim().toLowerCase(),
      args: call?.args && typeof call.args === 'object' ? call.args : call,
    }))
    .filter(call => call.tool)
    .slice(0, NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND);
}

function makeResearchToolResult(tool, items = [], extra = {}) {
  return {
    tool,
    items: items.slice(0, 10).map(item => {
      if (item?.id && item?.title) return compactNoteForResearch(item);
      return item;
    }),
    ...extra,
  };
}

function buildResearchPlannerMessages(query, evidenceNotes, toolLog, round) {
  const evidence = evidenceNotes.slice(0, NOTE_RESEARCH_MAX_NOTES).map(compactNoteForResearch);
  const recentToolLog = toolLog.slice(-8).map(entry => ({
    tool: entry.tool,
    count: entry.count,
    result: String(entry.summary || '').slice(0, NOTE_RESEARCH_TOOL_RESULT_CHARS),
  }));
  return [
    {
      role: 'system',
      content: [
        'You are a read-only note research planner inside VispNote.',
        'Choose safe note-inspection tool calls that gather missing evidence before a final answer.',
        'Return only JSON: an array of tool calls.',
        'Allowed tools:',
        '- search_notes: {"tool":"search_notes","query":"...","limit":5}',
        '- get_note: {"tool":"get_note","id":"note-id"}',
        '- get_links: {"tool":"get_links","id":"note-id"}',
        '- get_backlinks: {"tool":"get_backlinks","id":"note-id","limit":5}',
        '- get_notes_by_tag: {"tool":"get_notes_by_tag","tag":"tag","limit":5}',
        '- summarize_subset: {"tool":"summarize_subset","noteIds":["id"],"question":"..."}',
        '- finish: {"tool":"finish"}',
        'Do not request code execution, shell commands, plugins, filesystem access, or network access.',
        'Prefer 1-4 high-value calls. Use finish when enough evidence is available.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Question: ${query}`,
        `Round: ${round}`,
        `Evidence notes (${evidence.length}):\n${JSON.stringify(evidence, null, 2)}`,
        `Recent tool results:\n${JSON.stringify(recentToolLog, null, 2)}`,
        'Return JSON tool calls only.',
      ].join('\n\n'),
    },
  ];
}

async function summarizeResearchSubset(notes, query, signal) {
  const fit = fitNotes(notes, 8000);
  const body = fit.notes.map(note => [
    `title: ${note.title || 'Untitled'}`,
    `id: ${note.id}`,
    `tags: ${(note.tags || []).join(', ') || 'none'}`,
    '',
    String(note.body || '').trim(),
  ].join('\n')).join('\n\n---\n\n');
  const { text } = await providerChat([
    {
      role: 'system',
      content: 'Summarize only the provided notes for the user question. Preserve concrete facts, decisions, tasks, dates, and source note titles. Be concise.',
    },
    {
      role: 'user',
      content: `Question: ${query}\n\nNotes:\n${body}`,
    },
  ], { signal, maxTokens: 1024, timeoutMs: 30000 });
  return String(text || '').trim();
}

async function executeResearchCall(call, state) {
  const { allNotes, corpus, byId, byTitle, query, signal } = state;
  const args = call.args || {};
  const limit = Math.max(1, Math.min(Number(args.limit) || 5, 10));
  const addEvidence = (note, reason) => {
    if (!note?.id || state.evidence.has(note.id) || state.evidence.size >= NOTE_RESEARCH_MAX_NOTES) return;
    state.evidence.set(note.id, { note, reason });
  };

  if (call.tool === 'finish') return { done: true, result: { tool: 'finish', count: 0, summary: 'Planner finished.' } };

  if (call.tool === 'search_notes') {
    const q = String(args.query || query || '').slice(0, 200);
    const matches = [...corpus.metaById.values()]
      .map(meta => ({ note: meta.note, score: lexicalScoreMeta(meta, q), modifiedTime: meta.modifiedTime }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.modifiedTime - a.modifiedTime)
      .slice(0, limit)
      .map(item => item.note);
    matches.forEach(note => addEvidence(note, `search:${q}`));
    return {
      result: makeResearchToolResult('search_notes', matches, {
        count: matches.length,
        summary: matches.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n'),
      }),
    };
  }

  if (call.tool === 'get_note') {
    const note = byId.get(String(args.id || ''));
    if (note) addEvidence(note, 'get_note');
    return {
      result: makeResearchToolResult('get_note', note ? [note] : [], {
        count: note ? 1 : 0,
        summary: note ? `${note.title}: ${notePreview(note, 400)}` : 'Note not found.',
      }),
    };
  }

  if (call.tool === 'get_links') {
    const source = byId.get(String(args.id || ''));
    const linked = source
      ? extractWikiLinkTitles(source.body || '')
        .map(title => byTitle.get(titleKey(title)))
        .filter(Boolean)
        .slice(0, limit)
      : [];
    linked.forEach(note => addEvidence(note, `linked:${source?.title || ''}`));
    return {
      result: makeResearchToolResult('get_links', linked, {
        count: linked.length,
        summary: linked.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n') || 'No resolved links.',
      }),
    };
  }

  if (call.tool === 'get_backlinks') {
    const target = byId.get(String(args.id || ''));
    const backlinks = target
      ? allNotes
        .filter(note => note.id !== target.id && (corpus.metaById.get(note.id)?.outgoingTitleKeys || []).includes(titleKey(target.title)))
        .slice(0, limit)
      : [];
    backlinks.forEach(note => addEvidence(note, `backlink:${target?.title || ''}`));
    return {
      result: makeResearchToolResult('get_backlinks', backlinks, {
        count: backlinks.length,
        summary: backlinks.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n') || 'No backlinks.',
      }),
    };
  }

  if (call.tool === 'get_notes_by_tag') {
    const tag = String(args.tag || '').replace(/^#/, '').trim().toLowerCase().slice(0, 80);
    const tagged = tag
      ? allNotes.filter(note => (corpus.metaById.get(note.id)?.tagLower || []).includes(tag)).slice(0, limit)
      : [];
    tagged.forEach(note => addEvidence(note, `tag:${tag}`));
    return {
      result: makeResearchToolResult('get_notes_by_tag', tagged, {
        count: tagged.length,
        summary: tagged.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n') || 'No notes for tag.',
      }),
    };
  }

  if (call.tool === 'summarize_subset') {
    if (state.summaryCount >= NOTE_RESEARCH_MAX_SUMMARIES) {
      return { result: { tool: 'summarize_subset', count: 0, summary: 'Summary limit reached.' } };
    }
    const ids = Array.isArray(args.noteIds) ? args.noteIds.map(id => String(id || '')) : [];
    const notes = ids.map(id => byId.get(id)).filter(Boolean).slice(0, 6);
    if (!notes.length) return { result: { tool: 'summarize_subset', count: 0, summary: 'No valid notes to summarize.' } };
    state.summaryCount++;
    const summary = await summarizeResearchSubset(notes, String(args.question || query || ''), signal);
    state.summaries.push({ noteIds: notes.map(note => note.id), summary });
    notes.forEach(note => addEvidence(note, 'summarized'));
    return { result: { tool: 'summarize_subset', count: notes.length, summary } };
  }

  return { result: { tool: call.tool, count: 0, summary: 'Rejected unknown note research tool.' } };
}

async function runRecursiveNoteResearch({ query, allNotes, seedIds = [], options = {} }) {
  const corpus = options.corpus || buildNoteResearchCorpus(allNotes);
  const byId = corpus.byId;
  const byTitle = corpus.byTitle;
  const state = {
    allNotes,
    corpus,
    byId,
    byTitle,
    query,
    signal: options.signal,
    evidence: new Map(),
    summaries: [],
    summaryCount: 0,
  };
  const addInitial = (id, reason) => {
    const note = byId.get(id);
    if (note && state.evidence.size < NOTE_RESEARCH_MAX_NOTES) state.evidence.set(id, { note, reason });
  };
  seedIds.slice(0, TRAVERSAL_SEED_LIMIT).forEach(id => addInitial(id, 'seed'));
  if (options.currentNoteId && queryMentionsCurrentNote(query)) addInitial(options.currentNoteId, 'current note');

  const toolLog = [];
  let toolCalls = 0;
  for (let round = 1; round <= NOTE_RESEARCH_MAX_ROUNDS && toolCalls < NOTE_RESEARCH_MAX_TOOL_CALLS; round++) {
    const evidenceNotes = [...state.evidence.values()].map(item => item.note);
    const planner = options.planNoteResearch || (async ({ messages }) => {
      const { text } = await providerChat(messages, { signal: options.signal, maxTokens: 900, timeoutMs: 30000 });
      return parseResearchToolCalls(text);
    });
    let calls = [];
    try {
      calls = await planner({
        query,
        round,
        evidenceNotes,
        toolLog,
        messages: buildResearchPlannerMessages(query, evidenceNotes, toolLog, round),
      });
    } catch (e) {
      console.warn('[ai] recursive note planner failed', e.message || String(e));
      break;
    }
    calls = (Array.isArray(calls) ? calls : parseResearchToolCalls(calls))
      .slice(0, NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND);
    if (!calls.length) break;

    let done = false;
    for (const call of calls) {
      if (toolCalls >= NOTE_RESEARCH_MAX_TOOL_CALLS) break;
      toolCalls++;
      const { done: callDone, result } = await executeResearchCall(call, state);
      toolLog.push({
        tool: result.tool,
        count: result.count || 0,
        summary: result.summary || '',
      });
      if (callDone) {
        done = true;
        break;
      }
    }
    if (done || state.evidence.size >= NOTE_RESEARCH_MAX_NOTES) break;
  }

  return {
    notes: [...state.evidence.values()].map(item => item.note),
    summaries: state.summaries,
    toolLog,
    toolCalls,
  };
}

async function buildVaultContext(vaultId, query, st, storeApi = vaultStore, options = {}) {
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

  const ids = await retrievalNoteIds(vaultId, query, st, options);
  const corpus = buildNoteResearchCorpus(allNotes);
  const expanded = expandTraversalCandidates(ids, allNotes, query, { ...options, corpus });
  let research = null;
  const seedIds = expanded.map(item => item.note?.id).filter(Boolean);
  if (shouldUseRecursiveNoteResearch(query, seedIds, options)) {
    research = await runRecursiveNoteResearch({
      query,
      allNotes,
      seedIds,
      options: { ...options, corpus },
    });
  }
  const selected = [
    ...(research?.notes || []),
    ...expanded.map(item => item.note).filter(Boolean),
  ].filter((note, index, arr) => note?.id && arr.findIndex(item => item?.id === note.id) === index);
  const withRecentFallback = selected.length ? selected : allNotes.slice(0, Math.min(SELECTED_NOTE_LIMIT, allNotes.length));
  const fit = fitNotes(withRecentFallback);
  const usedTraversal = expanded.some(item => item.reasons.some(reason => reason !== 'retrieval match'));
  const usedRecursive = !!research?.toolCalls;
  return {
    mode: selected.length ? (usedRecursive ? 'recursive-traversal' : (usedTraversal ? 'traversal' : (st.embedModelOk ? 'semantic' : 'keyword'))) : 'recent-fallback',
    notes: fit.notes,
    researchSummaries: research?.summaries || [],
    researchToolCalls: research?.toolCalls || 0,
    totalNotes: allNotes.length,
    capped: fit.capped || allNotes.length > fit.notes.length,
    reason: selected.length
      ? (usedRecursive
        ? 'seed notes matched retrieval, then a bounded read-only note research loop inspected search results, links, backlinks, tags, and summaries'
        : 'seed notes matched semantic or keyword retrieval, then related wiki-links, backlinks, and shared tags were traversed within limits')
      : 'no direct match was found, so recent notes were used',
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
    context.researchToolCalls ? `Read-only research tool calls: ${context.researchToolCalls}` : null,
    `Context capped: ${context.capped ? 'yes' : 'no'}`,
  ].filter(Boolean).join('\n');
  const research = (context.researchSummaries || []).length
    ? `Research summaries:\n${context.researchSummaries.map((item, index) => (
      `Summary ${index + 1} from notes ${item.noteIds.join(', ')}:\n${item.summary}`
    )).join('\n\n')}\n\n`
    : '';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content:
        `Context selection:\n${selection}\n\n` +
        research +
        `Context from my notes:\n\n${ctx}\n\n` +
        `Question: ${query}\n\n` +
        `Answer using only the context above.`
    },
  ];
}

function withProviderTimeoutSignal(signal, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  let didTimeout = false;
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error('Provider request timed out'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    },
  };
}

async function providerFetch(url, init, providerLabel) {
  const timeout = withProviderTimeoutSignal(init?.signal);
  try {
    const res = await fetch(url, { ...init, signal: timeout.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${providerLabel} ${res.status} ${res.statusText}: ${text.slice(0, 220)}`);
    }
    return await res.json();
  } catch (e) {
    if (timeout.timedOut()) throw new Error(`${providerLabel} request timed out`);
    throw e;
  } finally {
    timeout.cleanup();
  }
}

function openAiCompatibleEndpoint(baseUrl) {
  if (/\/chat\/completions\/?$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function collectSystem(messages) {
  return messages
    .filter(m => m.role === 'system')
    .map(m => String(m.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function nonSystemMessages(messages) {
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map(m => ({ role: m.role, content: String(m.content) }));
}

async function providerChat(messages, options = {}) {
  const pii = reducePiiMessages(messages, shouldReducePiiForProvider());
  const providerMessages = pii.messages;
  if (CONFIG.provider === 'ollama') {
    return await ollama.chat(options.model || CONFIG.chatModel, providerMessages, {
      keep_alive: OLLAMA_KEEP_ALIVE,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
  const meta = currentProviderMeta();
  const apiKey = providerApiKey(meta);
  const baseUrl = providerBaseUrl(meta);
  const model = options.model || providerChatModel(meta);
  if (!apiKey) throw new Error(`${meta.label} API key is missing`);
  if (!model) throw new Error(`${meta.label} chat model is missing`);
  if (CONFIG.provider === 'custom' && !baseUrl) throw new Error('Custom provider base URL is missing');

  if (meta.compatible === 'anthropic') {
    const system = collectSystem(providerMessages);
    const data = await providerFetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: options.signal,
      body: JSON.stringify({
        model,
        max_tokens: Number(options.maxTokens || CONFIG.maxTokens || 2048),
        ...(system ? { system } : {}),
        messages: nonSystemMessages(providerMessages),
      }),
    }, meta.label);
    const text = (data.content || [])
      .filter(part => part?.type === 'text')
      .map(part => part.text || '')
      .join('\n')
      .trim();
    return restorePiiResult({ text, raw: data }, pii.replacements);
  }

  if (meta.compatible === 'gemini') {
    const system = collectSystem(providerMessages);
    const contents = nonSystemMessages(providerMessages).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const data = await providerFetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
      }),
    }, meta.label);
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || '')
      .join('')
      .trim();
    return restorePiiResult({ text, raw: data }, pii.replacements);
  }

  const headers = {
    'content-type': 'application/json',
    'authorization': `Bearer ${apiKey}`,
  };
  if (CONFIG.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/djkeshawa/visp-note';
    headers['X-Title'] = 'VispNote';
  }
  const data = await providerFetch(openAiCompatibleEndpoint(baseUrl), {
    method: 'POST',
    headers,
    signal: options.signal,
    body: JSON.stringify({
      model,
      messages: providerMessages,
      stream: false,
    }),
  }, meta.label);
  return restorePiiResult({ text: String(data.choices?.[0]?.message?.content || '').trim(), raw: data }, pii.replacements);
}

async function providerChatStream(messages, options = {}) {
  const pii = reducePiiMessages(messages, shouldReducePiiForProvider());
  const providerMessages = pii.messages;
  if (CONFIG.provider === 'ollama' && ollama.chatStream) {
    return await ollama.chatStream(options.model || CONFIG.chatModel, providerMessages, {
      keep_alive: OLLAMA_KEEP_ALIVE,
      signal: options.signal,
      onToken: options.onToken,
      timeoutMs: options.timeoutMs,
    });
  }
  const result = restorePiiResult(await providerChat(providerMessages, options), pii.replacements);
  if (result.text) options.onToken && options.onToken(result.text);
  return result;
}

function providerUnavailableError(st) {
  if (CONFIG.provider === 'ollama') return 'Ollama not reachable at ' + ollama.getHost();
  return st.reason || `${currentProviderMeta().label} is not configured`;
}

// Gather vault context → chat with selected notes. Returns { answer, sources }.
async function ask(vaultId, query, storeApi = vaultStore, options = {}) {
  const signal = beginCancellableJob(options.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    if (!st.reachable) return { ok: false, error: providerUnavailableError(st) };
    if (!st.chatModelOk) {
      return { ok: false, error: CONFIG.provider === 'ollama' ? `Chat model not installed: ollama pull ${CONFIG.chatModel}` : st.reason || 'Chat model is not configured' };
    }

    const context = await buildVaultContext(vaultId, query, st, storeApi, { ...options, signal });
    if (!context.notes.length) {
      return { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] };
    }
    const messages = buildRagPrompt(query, context);
    const { text } = await providerChat(messages, { signal });
    const sources = context.notes.map(note => ({
      id: note.id,
      title: note.title,
      modifiedAt: note.modifiedAt,
      snippet: String(note.body || '').slice(0, 200),
    }));
    return { ok: true, answer: text.trim(), sources, mode: context.mode, contextCapped: context.capped };
  } finally {
    finishCancellableJob(options.jobId);
  }
}

// Streaming variant for the Ask AI panel. It preserves the same RAG behavior as ask().
async function askStream(vaultId, query, storeApi = vaultStore, options = {}) {
  const signal = beginCancellableJob(options.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    if (!st.reachable) return { ok: false, error: providerUnavailableError(st) };
    if (!st.chatModelOk) {
      return { ok: false, error: CONFIG.provider === 'ollama' ? `Chat model not installed: ollama pull ${CONFIG.chatModel}` : st.reason || 'Chat model is not configured' };
    }

    const context = await buildVaultContext(vaultId, query, st, storeApi, { ...options, signal });
    if (!context.notes.length) {
      return { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] };
    }
    const messages = buildRagPrompt(query, context);
    const { text } = await providerChatStream(messages, { signal, onToken: options.onToken, timeoutMs: options.timeoutMs });
    const sources = context.notes.map(note => ({
      id: note.id,
      title: note.title,
      modifiedAt: note.modifiedAt,
      snippet: String(note.body || '').slice(0, 200),
    }));
    return { ok: true, answer: text.trim(), sources, mode: context.mode, contextCapped: context.capped };
  } finally {
    finishCancellableJob(options.jobId);
  }
}

async function editText({ text, instruction, scope, jobId, systemMessage, model, maxTokens } = {}) {
  const signal = beginCancellableJob(jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    if (!st.reachable) return { ok: false, error: providerUnavailableError(st) };
    if (!st.chatModelOk) {
      return { ok: false, error: CONFIG.provider === 'ollama' ? `Chat model not installed: ollama pull ${CONFIG.chatModel}` : st.reason || 'Chat model is not configured' };
    }
    const source = String(text || '');
    if (!source.trim()) return { ok: false, error: 'No text selected for AI editing' };
    const messages = [
      { role: 'system', content: String(systemMessage || '').trim() || EDIT_SYSTEM_PROMPT },
      { role: 'user', content:
          `Scope: ${scope || 'text'}\n` +
          `Instruction: ${instruction || 'Improve the writing.'}\n\n` +
          `Text:\n${source}`
      },
    ];
    const { text: edited } = await providerChat(messages, { signal, model: String(model || '').trim(), maxTokens });
    return { ok: true, text: String(edited || '').trim() };
  } finally {
    finishCancellableJob(jobId);
  }
}

async function editTextStream({ text, instruction, scope, jobId, systemMessage, model, maxTokens, onToken } = {}) {
  const signal = beginCancellableJob(jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    if (!st.reachable) return { ok: false, error: providerUnavailableError(st) };
    if (!st.chatModelOk) {
      return { ok: false, error: CONFIG.provider === 'ollama' ? `Chat model not installed: ollama pull ${CONFIG.chatModel}` : st.reason || 'Chat model is not configured' };
    }
    const source = String(text || '');
    if (!source.trim()) return { ok: false, error: 'No text selected for AI editing' };
    const messages = [
      { role: 'system', content: String(systemMessage || '').trim() || EDIT_SYSTEM_PROMPT },
      { role: 'user', content:
          `Scope: ${scope || 'text'}\n` +
          `Instruction: ${instruction || 'Improve the writing.'}\n\n` +
          `Text:\n${source}`
      },
    ];
    const { text: edited } = await providerChatStream(messages, {
      signal,
      model: String(model || '').trim(),
      maxTokens,
      onToken,
    });
    return { ok: true, text: String(edited || '').trim() };
  } finally {
    finishCancellableJob(jobId);
  }
}

async function chat(input) {
  const signal = beginCancellableJob(input?.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    if (!st.reachable) return { ok: false, error: providerUnavailableError(st) };
    if (!st.chatModelOk) {
      return { ok: false, error: CONFIG.provider === 'ollama' ? `Chat model not installed: ollama pull ${CONFIG.chatModel}` : st.reason || 'Chat model is not configured' };
    }
    const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
    const messages = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...provided
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .slice(-8)
        .map(m => ({ role: m.role, content: String(m.content) })),
    ];
    const { text } = await providerChat(messages, { signal });
    return { ok: true, answer: String(text || '').trim() };
  } finally {
    finishCancellableJob(input?.jobId);
  }
}

async function chatStream(input) {
  const signal = beginCancellableJob(input?.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    if (!st.reachable) return { ok: false, error: providerUnavailableError(st) };
    if (!st.chatModelOk) {
      return { ok: false, error: CONFIG.provider === 'ollama' ? `Chat model not installed: ollama pull ${CONFIG.chatModel}` : st.reason || 'Chat model is not configured' };
    }
    const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
    const messages = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...provided
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .slice(-8)
        .map(m => ({ role: m.role, content: String(m.content) })),
    ];
    const { text } = await providerChatStream(messages, {
      signal,
      onToken: input?.onToken,
      timeoutMs: input?.timeoutMs,
    });
    return { ok: true, answer: String(text || '').trim() };
  } finally {
    finishCancellableJob(input?.jobId);
  }
}

module.exports = {
  status, connect, getConfig, setConfig,
  cancelJob,
  scheduleEmbed, embedNote, backfillVault,
  relatedNotes,
  ask, askStream, editText, editTextStream, chat, chatStream, buildVaultContext,
  __test: {
    publicConfig,
    sanitizeConfigPatch,
    sanitizeSecretValue,
    reducePiiText,
    restorePiiText,
    reducePiiMessages,
    providerChat,
    extractWikiLinkTitles,
    expandTraversalCandidates,
    shouldUseRecursiveNoteResearch,
    buildNoteResearchCorpus,
    parseResearchToolCalls,
    runRecursiveNoteResearch,
    ollamaServeEnv,
  },
};
