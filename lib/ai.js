// AI orchestration: embed notes via Ollama and answer questions with RAG.
// Failures are isolated — if Ollama isn't running, the rest of the app
// keeps working, and embeds simply don't happen.

const ollama = require('./ollama');
const idx = require('./index');
const vaultStore = require('./store');
const pii = require('./aiPii');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const STATUS_CACHE_MS = 2000;
const OLLAMA_KEEP_ALIVE = '10m';
const WHOLE_VAULT_MAX_NOTES = 12;
const WHOLE_VAULT_MAX_CHARS = 18000;
const SELECTED_NOTE_LIMIT = 8;
const MAX_CONTEXT_CHARS = 22000;
const MAX_NOTE_BODY_CHARS = 5000;
const MAX_RAG_PROMPT_CHARS = 60000;
const TRAVERSAL_SEED_LIMIT = 8;
const TRAVERSAL_MAX_NOTES = 18;
const TRAVERSAL_SHARED_TAG_LIMIT = 3;
const NOTE_RESEARCH_MAX_ROUNDS = 4;
const NOTE_RESEARCH_MAX_TOOL_CALLS = 14;
const NOTE_RESEARCH_MAX_NOTES = 28;
const NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND = 4;
const NOTE_RESEARCH_MAX_SUMMARIES = 2;
const NOTE_RESEARCH_TOOL_RESULT_CHARS = 900;
const NOTE_RESEARCH_ARG_CHARS = 1000;
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
const PROVIDER_TIMEOUT_MS = 45000;
const QUERY_CACHE_MS = 30000;
const ASK_MAX_TOKENS = 1400;
const CHAT_MAX_TOKENS = 700;
const SUMMARY_BATCH_MAX_CHARS = 9000;
const SUMMARY_BATCH_MAX_NOTES = 8;
const SUMMARY_NOTE_BODY_CHARS = 2400;
const SUMMARY_MAP_MAX_TOKENS = 650;
const SUMMARY_REDUCE_MAX_TOKENS = 1500;
const SUMMARY_REQUEST_TIMEOUT_MS = 60000;
const TOOL_PLAN_MAX_TOOLS = 100;
const TOOL_PLAN_MAX_CALLS = 8;
const TOOL_PLAN_SCHEMA_DEPTH = 8;
const TOOL_PLAN_TIMEOUT_MS = 45000;
const TOOL_PLAN_MAX_TOKENS = 900;
const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

const {
  reducePiiText,
  restorePiiText,
  reducePiiMessages,
  restorePiiResult,
} = pii;


let ollamaProcess = null;
let ollamaSpawnPromise = null;
let statusCache = null;
let embedModelFailure = null;
const cancellableJobs = new Map();
let embedAbortController = null;
const backfillJobs = new Map();
const queryEmbeddingCache = new Map();
const retrievalCache = new Map();
const summaryCache = new Map();

function resolveOllamaBinary() {
  const candidates = [
    ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, process.platform === 'win32' ? 'ollama.exe' : 'ollama')),
    '/usr/bin/ollama',
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/Applications/Ollama.app/Contents/Resources/ollama',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return null;
}

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
    if (isPrivateHost(parsed.hostname)) throw new Error(`${field} cannot target local or private hosts`);
  }
  return parsed.href.replace(/\/+$/, '');
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 169 && parts[1] === 254)
      || parts[0] === 0;
  }
  if (ipVersion === 6) {
    return host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || host.startsWith('fe80:')
      || host === '::';
  }
  return false;
}
function ollamaHostForEnv() {
  const parsed = new URL(normalizeHttpUrl(ollama.getHost(), 'ollamaHost'));
  return parsed.host || `${parsed.hostname}:11434`;
}
function ollamaServeEnv() {
  const keep = [
    'HOME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR',
    'OLLAMA_MODELS', 'OLLAMA_DEBUG', 'OLLAMA_KEEP_ALIVE',
    'OLLAMA_MAX_LOADED_MODELS', 'OLLAMA_NUM_PARALLEL',
    'OLLAMA_FLASH_ATTENTION', 'OLLAMA_KV_CACHE_TYPE',
  ];
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
function applyConfig(config) {
  assertPlainConfigPatch(config);
  const next = { ...config };
  const provider = PROVIDERS[next.provider] ? next.provider : 'ollama';
  const meta = PROVIDERS[provider];
  if (!next.chatModel && meta.defaultChatModel) next.chatModel = meta.defaultChatModel;
  const previousEmbedModel = CONFIG.embedModel;
  CONFIG = { ...next, provider };
  if (!CONFIG.enabled) {
    embedAbortController?.abort?.(new Error('AI disabled'));
    pending.clear();
  }
  ollama.setHost(CONFIG.ollamaHost || ollama.DEFAULT_HOST);
  if (CONFIG.embedModel !== previousEmbedModel) embedModelFailure = null;
  statusCache = null;
  return getConfig();
}

function setConfig(patch, options = {}) {
  return applyConfig(previewConfig(patch, options));
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
function chatNumPredict(value = CONFIG.maxTokens) {
  const n = Number(value || CONFIG.maxTokens || 2048);
  return Number.isFinite(n) ? Math.max(128, Math.min(8192, Math.round(n))) : 2048;
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
  if (!controller) return { ok: false, error: 'No running AI job found' };
  controller.abort();
  cancellableJobs.delete(jobId);
  return { ok: true };
}

function isUsefulResearchSummary(summary) {
  const text = String(summary || '').trim();
  if (text.length < 24) return false;
  const normalized = text.toLowerCase();
  return ![
    'summary limit reached',
    'no valid notes to summarize',
    'summary was empty or failed validation',
  ].some(template => normalized.includes(template));
}

function previewConfig(patch, options = {}) {
  const cleanPatch = sanitizeConfigPatch(patch, options);
  const next = { ...CONFIG, ...cleanPatch };
  const provider = PROVIDERS[next.provider] ? next.provider : 'ollama';
  const meta = PROVIDERS[provider];
  if (!next.chatModel && meta.defaultChatModel) next.chatModel = meta.defaultChatModel;
  return { ...next, provider, ollamaHost: Object.prototype.hasOwnProperty.call(cleanPatch, 'ollamaHost') ? (cleanPatch.ollamaHost || ollama.DEFAULT_HOST) : ollama.getHost() };
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
  let effectiveChatModel = CONFIG.chatModel;
  if (!has(effectiveChatModel)) {
    const gemma = models.find(m => /^gemma/i.test(m));
    if (gemma) effectiveChatModel = gemma;
  }
  const embedModelOk = has(CONFIG.embedModel);
  const embedFailure = currentEmbedModelFailure();
  const chatModelOk = has(effectiveChatModel);
  return remember({
    reachable: true,
    models,
    embedModelOk: embedModelOk && !embedFailure,
    embedModelReason: embedFailure?.reason || null,
    chatModelOk,
    chatModel: effectiveChatModel,
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
        const ollamaBin = resolveOllamaBinary();
        if (!ollamaBin) throw new Error('Ollama binary not found in a known install location. Start Ollama manually or install it from ollama.com.');
        ollamaProcess = spawn(ollamaBin, ['serve'], {
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

  for (let i = 0; i < 60; i++) {
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
  embedAbortController = new AbortController();
  for (const w of work) {
    try { await embedNote(w.vaultId, w.note, { signal: embedAbortController.signal }); }
    catch (e) {
      if (e.name !== 'AbortError' && e.code !== 'ABORT_ERR' && e.code !== 'EMBED_MODEL_UNSUPPORTED') console.warn('[ai] embedNote failed', w.note?.id, e.message);
    }
    finally { inFlight.delete(w.k); }
  }
  embedAbortController = null;
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
      const note = v.notes.find(n => n.id === id);
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

function isBroadVaultSummaryQuery(query) {
  const q = String(query || '').toLowerCase();
  return /\b(summari[sz]e|summary|overview|recap)\b/.test(q) &&
    /\b(all|my|entire|whole|vault|everything)\b/.test(q) &&
    /\bnotes?|pages?|vault|everything\b/.test(q);
}

function fastChatAnswer(input) {
  const text = String(input || '').trim();
  const normalized = text.toLowerCase().replace(/[!?.\s]+$/g, '');
  if (/^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening)$/.test(normalized)) {
    return 'Hello. Ask me about your notes, or tell me an app action like "open settings", "create a note", or "tag this note as reading".';
  }
  if (/^(thanks|thank you|ok|okay|cool|nice)$/.test(normalized)) {
    return 'Done.';
  }
  if (/\b(who are you|what can you do|help|how do you work|capabilities)\b/.test(normalized)) {
    return 'I can answer questions from your notes, summarize note context, create notes, edit the current page, add tags, and open VispNote views. For note answers, ask directly about your notes.';
  }
  return '';
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

function stripPromptPropertyLines(body) {
  return String(body || '').replace(/^[a-zA-Z_][a-zA-Z0-9_-]*::\s.*$/gm, '').trim();
}

function fitNotes(notes, maxChars = MAX_CONTEXT_CHARS) {
  const selected = [];
  let used = 0;
  for (const note of notes) {
    const body = stripPromptPropertyLines(note.body);
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
  const cacheKey = `${vaultId}\n${CONFIG.embedModel}\n${st.embedModelOk ? 'semantic' : 'keyword'}\n${String(query || '').trim().toLowerCase().slice(0, 1000)}`;
  const cached = retrievalCache.get(cacheKey);
  if (cached && Date.now() - cached.at < QUERY_CACHE_MS) return [...cached.value];
  const ids = [];
  const add = (noteId) => {
    if (noteId && !ids.includes(noteId)) ids.push(noteId);
  };
  if (st.embedModelOk) {
    try {
      const qVec = await embedQueryCached(query, { signal: options.signal });
      for (const hit of idx.vectorSearch(vaultId, qVec, CONFIG.ragTopK)) add(hit.noteId);
    } catch (e) {
      if (e.name !== 'AbortError' && e.code !== 'ABORT_ERR' && e.code !== 'EMBED_MODEL_UNSUPPORTED') {
        console.warn('[ai] vector retrieval failed', e.message);
      }
    }
  }
  for (const hit of idx.lexicalContextSearch(vaultId, query, CONFIG.ragTopK)) add(hit.noteId);
  retrievalCache.set(cacheKey, { at: Date.now(), value: [...ids] });
  if (retrievalCache.size > 80) {
    const first = retrievalCache.keys().next().value;
    retrievalCache.delete(first);
  }
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
  if (options.recursiveResearch === true) return !isBroadVaultSummaryQuery(query);
  return false;
}

function buildNoteResearchCorpus(allNotes = []) {
  const byId = new Map();
  const byTitle = new Map();
  const metaById = new Map();
  const notesByTag = new Map();
  const backlinksByTitle = new Map();
  for (const note of allNotes) {
    byId.set(note.id, note);
    const noteTitleKey = titleKey(note.title);
    if (noteTitleKey) byTitle.set(noteTitleKey, note);
    const tagLower = (note.tags || []).map(value => String(value || '').toLowerCase());
    const outgoingTitleKeys = extractWikiLinkTitles(note.body || '').map(titleKey);
    const meta = {
      note,
      titleKey: noteTitleKey,
      titleLower: String(note.title || '').toLowerCase(),
      bodyLower: String(note.body || '').toLowerCase(),
      tagLower,
      outgoingTitleKeys,
      modifiedTime: new Date(note.modifiedAt || note.date || 0).getTime(),
    };
    metaById.set(note.id, meta);
    for (const tag of tagLower) {
      if (!notesByTag.has(tag)) notesByTag.set(tag, []);
      notesByTag.get(tag).push(note);
    }
    for (const targetTitleKey of outgoingTitleKeys) {
      if (!backlinksByTitle.has(targetTitleKey)) backlinksByTitle.set(targetTitleKey, []);
      backlinksByTitle.get(targetTitleKey).push(note);
    }
  }
  return {
    byId,
    byTitle,
    metaById,
    metaList: [...metaById.values()],
    notesByTag,
    backlinksByTitle,
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
    for (const candidate of corpus.backlinksByTitle.get(titleKey(seed.title)) || []) {
      if (candidate.id !== seedId) add(candidate.id, 32, `backlinks to ${seed.title || 'note'}`);
    }
    const seedTags = (seed.tags || []).filter(Boolean).slice(0, TRAVERSAL_SHARED_TAG_LIMIT);
    for (const tag of seedTags) {
      for (const candidate of corpus.notesByTag.get(String(tag).toLowerCase()) || []) {
        if (candidate.id !== seedId) add(candidate.id, 12, `shares #${tag}`);
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

function normalizeResearchToolCalls(value) {
  return (Array.isArray(value) ? value : parseResearchToolCalls(value))
    .map(call => ({
      tool: String(call?.tool || '').trim().toLowerCase(),
      args: call?.args && typeof call.args === 'object' ? call.args : {},
    }))
    .filter(call => call.tool)
    .slice(0, NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND);
}

function capResearchArg(value, max = NOTE_RESEARCH_ARG_CHARS) {
  return String(value || '').slice(0, max);
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
  const { corpus, byId, byTitle, query, signal } = state;
  const args = call.args || {};
  const limit = Math.max(1, Math.min(Number(args.limit) || 5, 10));
  const addEvidence = (note, reason) => {
    if (!note?.id || state.evidence.has(note.id) || state.evidence.size >= NOTE_RESEARCH_MAX_NOTES) return;
    state.evidence.set(note.id, { note, reason });
  };

  if (call.tool === 'finish') return { done: true, result: { tool: 'finish', count: 0, summary: 'Planner finished.' } };

  if (call.tool === 'search_notes') {
    const q = capResearchArg(args.query || query || '', 200);
    const matches = corpus.metaList
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
      ? (corpus.backlinksByTitle.get(titleKey(target.title)) || [])
        .filter(note => note.id !== target.id)
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
      ? (corpus.notesByTag.get(tag) || []).slice(0, limit)
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
    const summary = await summarizeResearchSubset(notes, capResearchArg(args.question || query || ''), signal);
    if (!isUsefulResearchSummary(summary)) {
      return { result: { tool: 'summarize_subset', count: 0, summary: 'Summary was empty or failed validation.' } };
    }
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
    calls = normalizeResearchToolCalls(calls);
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
  const broadSummary = isBroadVaultSummaryQuery(query);
  const wholeVault = allNotes.length <= WHOLE_VAULT_MAX_NOTES && allChars <= WHOLE_VAULT_MAX_CHARS;

  if (wholeVault || broadSummary) {
    const fit = fitNotes(allNotes, broadSummary ? MAX_RAG_PROMPT_CHARS : MAX_CONTEXT_CHARS);
    return {
      mode: broadSummary && !wholeVault ? 'broad-summary' : 'whole-vault',
      notes: fit.notes,
      totalNotes: allNotes.length,
      capped: fit.capped,
      reason: broadSummary && !wholeVault
        ? 'the question asks for a whole-vault summary, so notes were included in recent-edit order up to the prompt budget'
        : 'the active vault is small enough to include in full',
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
  let usedChars = 0;
  let promptCapped = false;
  const ctx = context.notes.map((note, i) => {
    const tags = (note.tags || []).map(t => `#${t}`).join(' ') || 'none';
    const header = [
      `--- Context item ${i + 1} ---`,
      `title: ${note.title || 'Untitled'}`,
      `id: ${note.id}`,
      `noteDate: ${note.date || 'unknown'}`,
      `modifiedAt: ${note.modifiedAt || 'unknown'}`,
      `tags: ${tags}`,
      '',
    ].join('\n');
    const remaining = Math.max(0, MAX_RAG_PROMPT_CHARS - usedChars - header.length - 240);
    let body = stripPromptPropertyLines(note.body) || '(empty note)';
    if (body.length > remaining) {
      body = `${body.slice(0, Math.max(0, remaining)).trimEnd()}\n...[truncated for prompt budget]`;
      promptCapped = true;
    }
    const item = `${header}${body}`;
    usedChars += item.length + 2;
    return item;
  }).join('\n\n');
  const selection = [
    `Selection mode: ${context.mode}`,
    `Selection reason: ${context.reason}`,
    `Notes provided: ${context.notes.length} of ${context.totalNotes}`,
    context.researchToolCalls ? `Read-only research tool calls: ${context.researchToolCalls}` : null,
    `Context capped: ${context.capped || promptCapped ? 'yes' : 'no'}`,
    promptCapped ? 'Prompt budget: context was truncated to stay within the model prompt budget' : null,
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

function scrubSecretText(value) {
  return String(value || '')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(x-api-key:\s*)[^\s,;]+/gi, '$1[redacted]');
}

async function providerFetch(url, init, providerLabel, options = {}) {
  const timeout = withProviderTimeoutSignal(init?.signal, options.timeoutMs ?? PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: timeout.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(scrubSecretText(`${providerLabel} ${res.status} ${res.statusText}: ${text.slice(0, 220)}`));
    }
    return await res.json();
  } catch (e) {
    if (timeout.timedOut()) throw new Error(`${providerLabel} request timed out`);
    throw new Error(scrubSecretText(e?.message || e));
  } finally {
    timeout.cleanup();
  }
}

async function providerFetchStream(url, init, providerLabel, options = {}) {
  const timeout = withProviderTimeoutSignal(init?.signal, options.timeoutMs ?? PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: timeout.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      timeout.cleanup();
      throw new Error(scrubSecretText(`${providerLabel} ${res.status} ${res.statusText}: ${text.slice(0, 220)}`));
    }
    return {
      res,
      timedOut: timeout.timedOut,
      cleanup: timeout.cleanup,
    };
  } catch (e) {
    timeout.cleanup();
    if (timeout.timedOut()) throw new Error(`${providerLabel} request timed out`);
    throw new Error(scrubSecretText(e?.message || e));
  }
}

async function readSseData(res, onData) {
  const reader = res.body?.getReader?.();
  if (!reader) return false;
  const decoder = new TextDecoder();
  let buffer = '';
  const processBlock = (block) => {
    const data = String(block || '').split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data) return false;
    if (data === '[DONE]') return true;
    onData(data);
    return false;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      if (processBlock(block)) return true;
    }
  }
  buffer += decoder.decode().replace(/\r\n/g, '\n');
  if (buffer.trim()) processBlock(buffer);
  return true;
}

function createPiiTokenEmitter(replacements, onToken) {
  if (typeof onToken !== 'function') return { push() {}, flush() {} };
  if (!replacements?.length) return { push: onToken, flush() {} };
  const maxPlaceholderLength = replacements.reduce(
    (max, item) => Math.max(max, String(item.placeholder || '').length),
    12
  ) + 4;
  let buffer = '';
  const emit = (text) => {
    if (text) onToken(restorePiiText(text, replacements));
  };
  return {
    push(chunk) {
      buffer += String(chunk || '');
      if (buffer.length <= maxPlaceholderLength * 2) return;
      let cut = buffer.length - maxPlaceholderLength * 2;
      const open = buffer.lastIndexOf('[', cut);
      if (open >= Math.max(0, cut - maxPlaceholderLength)) cut = open;
      if (cut <= 0) return;
      emit(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
    },
    flush() {
      emit(buffer);
      buffer = '';
    },
  };
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

function sanitizeToolSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > TOOL_PLAN_SCHEMA_DEPTH) {
    return { type: 'object', additionalProperties: false };
  }
  const out = {};
  const copyString = (key, max = 500) => {
    if (schema[key] !== undefined && schema[key] !== null) out[key] = String(schema[key]).slice(0, max);
  };
  copyString('type', 40);
  copyString('description', 500);
  copyString('default', 500);
  if (typeof schema.maxLength === 'number') out.maxLength = Math.max(1, Math.min(20000, Math.round(schema.maxLength)));
  if (typeof schema.minimum === 'number') out.minimum = schema.minimum;
  if (typeof schema.maximum === 'number') out.maximum = schema.maximum;
  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, 80).map(value => String(value).slice(0, 160));
  if (Array.isArray(schema.required)) {
    out.required = schema.required.map(value => String(value || '').trim()).filter(Boolean).slice(0, 80);
  }
  if (schema.items) out.items = sanitizeToolSchema(schema.items, depth + 1);
  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties).slice(0, 120)) {
      if (/^[A-Za-z0-9_-]{1,80}$/.test(key)) out.properties[key] = sanitizeToolSchema(value, depth + 1);
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'additionalProperties')) {
    out.additionalProperties = schema.additionalProperties === true ? true : false;
  }
  if (!out.type && out.properties) out.type = 'object';
  if (!out.type) out.type = 'string';
  if (out.type === 'object' && !out.properties) out.properties = {};
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

function sanitizeAiTools(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .map(tool => {
      const name = String(tool?.name || tool?.id || '').trim();
      if (!TOOL_NAME_RE.test(name)) return null;
      const title = String(tool.title || tool.label || name).trim().slice(0, 120);
      const description = String(tool.description || title || name).trim().slice(0, 1400);
      const inputSchema = sanitizeToolSchema(tool.inputSchema || tool.input_schema || { type: 'object', additionalProperties: false });
      const outputSchema = sanitizeToolSchema(tool.outputSchema || tool.output_schema || { type: 'object', additionalProperties: true });
      const risk = ['safe', 'confirm', 'destructive', 'external'].includes(tool.risk) ? tool.risk : 'safe';
      return {
        name,
        title,
        description,
        inputSchema,
        outputSchema,
        risk,
        readOnly: !!tool.readOnly,
        destructive: risk === 'destructive' || !!tool.destructive,
        external: risk === 'external' || !!tool.external,
        confirm: risk === 'confirm' || !!tool.confirm,
        idempotent: !!tool.idempotent,
      };
    })
    .filter(Boolean)
    .slice(0, TOOL_PLAN_MAX_TOOLS);
}

function toolPlannerSystemPrompt() {
  return [
    'You are VispNote\'s tool planner.',
    'Use the provided tools to perform app actions, inspect notes, and navigate the app.',
    'Call tools when the user asks VispNote to do something. Do not claim you cannot call tools if an appropriate tool exists.',
    'Use read/search tools first if target details are missing. Use write tools only when the requested action and arguments are clear.',
    'For create-note and append-to-note requests, draft concise Markdown content in the tool arguments when the user asks for generated content.',
    'Do not invent tool names or arguments. Use only the provided JSON Schemas.',
    'If no tool is appropriate, answer briefly or ask for the missing detail.',
  ].join('\n');
}

function fallbackToolPlannerMessages(messages, tools, feedback = '') {
  return [
    {
      role: 'system',
      content: [
        toolPlannerSystemPrompt(),
        'Return only JSON in this exact shape:',
        '{"answer":"","toolCalls":[{"name":"tool_name","args":{},"reason":"short reason"}]}',
        'If no tool should be called, return {"answer":"brief answer or clarification","toolCalls":[]}.',
        feedback ? `Previous invalid output feedback: ${feedback}` : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: [
        `Available tools:\n${JSON.stringify(tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
          risk: tool.risk,
          readOnly: tool.readOnly,
        })), null, 2)}`,
        `Conversation:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
      ].join('\n\n'),
    },
  ];
}

function parseJsonObject(text) {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function restorePiiDeep(value, replacements = []) {
  if (!replacements.length) return value;
  if (typeof value === 'string') return restorePiiText(value, replacements);
  if (Array.isArray(value)) return value.map(item => restorePiiDeep(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restorePiiDeep(item, replacements)]));
  }
  return value;
}

function parseToolArgs(value, replacements = []) {
  let args = {};
  if (typeof value === 'string') {
    try { args = value.trim() ? JSON.parse(value) : {}; } catch { args = {}; }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    args = value;
  }
  return restorePiiDeep(args, replacements);
}

function normalizeToolCalls(calls = [], replacements = []) {
  return (Array.isArray(calls) ? calls : [])
    .map((call, index) => {
      const name = String(call?.name || call?.tool || call?.function?.name || '').trim();
      if (!TOOL_NAME_RE.test(name)) return null;
      return {
        id: String(call.id || call.toolUseId || `tool_${index + 1}`).slice(0, 120),
        name,
        args: parseToolArgs(call.args ?? call.input ?? call.function?.arguments ?? {}, replacements),
        reason: String(call.reason || '').slice(0, 500),
      };
    })
    .filter(Boolean)
    .slice(0, TOOL_PLAN_MAX_CALLS);
}

function openAiToolDefinitions(tools) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function anthropicToolDefinitions(tools) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function geminiToolDefinitions(tools) {
  return [{
    functionDeclarations: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
  }];
}

async function providerChat(messages, options = {}) {
  const pii = reducePiiMessages(messages, shouldReducePiiForProvider());
  const providerMessages = pii.messages;
  if (CONFIG.provider === 'ollama') {
    return await ollama.chat(options.model || CONFIG.chatModel, providerMessages, {
      keep_alive: OLLAMA_KEEP_ALIVE,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      options: { num_predict: chatNumPredict(options.maxTokens) },
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
        max_tokens: chatNumPredict(options.maxTokens),
        ...(system ? { system } : {}),
        messages: nonSystemMessages(providerMessages),
      }),
    }, meta.label, { timeoutMs: options.timeoutMs });
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
        generationConfig: { maxOutputTokens: chatNumPredict(options.maxTokens) },
      }),
    }, meta.label, { timeoutMs: options.timeoutMs });
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
      max_tokens: chatNumPredict(options.maxTokens),
      stream: false,
    }),
  }, meta.label, { timeoutMs: options.timeoutMs });
  return restorePiiResult({ text: String(data.choices?.[0]?.message?.content || '').trim(), raw: data }, pii.replacements);
}

async function fallbackJsonToolPlan(messages, tools, options = {}) {
  const attempts = ['', options.feedback || ''].filter((item, index, arr) => index === 0 || item);
  let lastError = '';
  for (const feedback of attempts) {
    const result = await providerChat(fallbackToolPlannerMessages(messages, tools, feedback || lastError), {
      signal: options.signal,
      timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS,
      maxTokens: options.maxTokens || TOOL_PLAN_MAX_TOKENS,
    });
    const parsed = parseJsonObject(result.text || '');
    if (parsed) {
      return {
        answer: String(parsed.answer || '').trim(),
        toolCalls: normalizeToolCalls(parsed.toolCalls || parsed.calls || parsed.plan || []),
        native: false,
        provider: CONFIG.provider,
        raw: result.raw || null,
      };
    }
    lastError = 'Planner did not return valid JSON.';
  }
  return { answer: 'I could not map that safely to a tool call.', toolCalls: [], native: false, provider: CONFIG.provider, raw: null };
}

async function providerToolPlan(messages, tools, options = {}) {
  const cleanTools = sanitizeAiTools(tools);
  const providerMessagesBase = [
    { role: 'system', content: toolPlannerSystemPrompt() },
    ...nonSystemMessages(messages).slice(-10),
  ];
  if (!cleanTools.length) return { answer: 'No tools are available.', toolCalls: [], native: false, provider: CONFIG.provider };
  if (CONFIG.provider === 'ollama') return await fallbackJsonToolPlan(providerMessagesBase, cleanTools, options);

  const pii = reducePiiMessages(providerMessagesBase, shouldReducePiiForProvider());
  const providerMessages = pii.messages;
  const meta = currentProviderMeta();
  const apiKey = providerApiKey(meta);
  const baseUrl = providerBaseUrl(meta);
  const model = options.model || providerChatModel(meta);
  if (!apiKey) throw new Error(`${meta.label} API key is missing`);
  if (!model) throw new Error(`${meta.label} chat model is missing`);
  if (CONFIG.provider === 'custom' && !baseUrl) throw new Error('Custom provider base URL is missing');

  try {
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
          max_tokens: chatNumPredict(options.maxTokens || TOOL_PLAN_MAX_TOKENS),
          ...(system ? { system } : {}),
          messages: nonSystemMessages(providerMessages),
          tools: anthropicToolDefinitions(cleanTools),
          tool_choice: { type: 'auto' },
        }),
      }, meta.label, { timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS });
      const content = Array.isArray(data.content) ? data.content : [];
      const answer = content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n').trim();
      const toolCalls = content
        .filter(part => part?.type === 'tool_use')
        .map(part => ({ id: part.id, name: part.name, args: part.input || {} }));
      return {
        answer: restorePiiText(answer, pii.replacements),
        toolCalls: normalizeToolCalls(toolCalls, pii.replacements),
        native: true,
        provider: CONFIG.provider,
        raw: data,
      };
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
          tools: geminiToolDefinitions(cleanTools),
          generationConfig: { maxOutputTokens: chatNumPredict(options.maxTokens || TOOL_PLAN_MAX_TOKENS) },
        }),
      }, meta.label, { timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS });
      const parts = data.candidates?.[0]?.content?.parts || [];
      const answer = parts.map(part => part.text || '').join('').trim();
      const toolCalls = parts
        .filter(part => part.functionCall)
        .map((part, index) => ({ id: `gemini_${index + 1}`, name: part.functionCall.name, args: part.functionCall.args || {} }));
      return {
        answer: restorePiiText(answer, pii.replacements),
        toolCalls: normalizeToolCalls(toolCalls, pii.replacements),
        native: true,
        provider: CONFIG.provider,
        raw: data,
      };
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
        tools: openAiToolDefinitions(cleanTools),
        tool_choice: 'auto',
        max_tokens: chatNumPredict(options.maxTokens || TOOL_PLAN_MAX_TOKENS),
        stream: false,
      }),
    }, meta.label, { timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS });
    const message = data.choices?.[0]?.message || {};
    const toolCalls = (message.tool_calls || []).map(call => ({
      id: call.id,
      name: call.function?.name,
      args: call.function?.arguments || {},
    }));
    return {
      answer: restorePiiText(String(message.content || '').trim(), pii.replacements),
      toolCalls: normalizeToolCalls(toolCalls, pii.replacements),
      native: true,
      provider: CONFIG.provider,
      raw: data,
    };
  } catch (e) {
    if (options.nativeOnly) throw e;
    return await fallbackJsonToolPlan(providerMessagesBase, cleanTools, {
      ...options,
      feedback: `Native tool planning failed: ${e.message || String(e)}`,
    });
  }
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
      options: { num_predict: chatNumPredict(options.maxTokens) },
    });
  }
  const meta = currentProviderMeta();
  const apiKey = providerApiKey(meta);
  const baseUrl = providerBaseUrl(meta);
  const model = options.model || providerChatModel(meta);
  if (!apiKey) throw new Error(`${meta.label} API key is missing`);
  if (!model) throw new Error(`${meta.label} chat model is missing`);
  if (CONFIG.provider === 'custom' && !baseUrl) throw new Error('Custom provider base URL is missing');

  const emitter = createPiiTokenEmitter(pii.replacements, options.onToken);
  let text = '';
  const pushToken = (token) => {
    const chunk = String(token || '');
    if (!chunk) return;
    text += chunk;
    emitter.push(chunk);
  };
  const fallback = async () => {
    const result = await providerChat(messages, options);
    if (result.text) options.onToken && options.onToken(result.text);
    return result;
  };
  let stream = null;
  try {
    if (meta.compatible === 'anthropic') {
      const system = collectSystem(providerMessages);
      stream = await providerFetchStream(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: options.signal,
        body: JSON.stringify({
          model,
          max_tokens: chatNumPredict(options.maxTokens),
          stream: true,
          ...(system ? { system } : {}),
          messages: nonSystemMessages(providerMessages),
        }),
      }, meta.label, { timeoutMs: options.timeoutMs });
      const read = await readSseData(stream.res, data => {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) pushToken(parsed.delta.text);
        if (parsed.type === 'error') throw new Error(parsed.error?.message || `${meta.label} stream error`);
      });
      if (!read) return await fallback();
    } else if (meta.compatible === 'gemini') {
      const system = collectSystem(providerMessages);
      const contents = nonSystemMessages(providerMessages).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      stream = await providerFetchStream(`${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: { maxOutputTokens: chatNumPredict(options.maxTokens) },
        }),
      }, meta.label, { timeoutMs: options.timeoutMs });
      const read = await readSseData(stream.res, data => {
        const parsed = JSON.parse(data);
        for (const part of parsed.candidates?.[0]?.content?.parts || []) pushToken(part.text || '');
      });
      if (!read) return await fallback();
    } else {
      const headers = {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      };
      if (CONFIG.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/djkeshawa/visp-note';
        headers['X-Title'] = 'VispNote';
      }
      stream = await providerFetchStream(openAiCompatibleEndpoint(baseUrl), {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages: providerMessages,
          max_tokens: chatNumPredict(options.maxTokens),
          stream: true,
        }),
      }, meta.label, { timeoutMs: options.timeoutMs });
      const read = await readSseData(stream.res, data => {
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(parsed.error.message || `${meta.label} stream error`);
        const delta = parsed.choices?.[0]?.delta || {};
        pushToken(delta.content || delta.text || '');
      });
      if (!read) return await fallback();
    }
    emitter.flush();
    return restorePiiResult({ text: text.trim(), raw: null }, pii.replacements);
  } catch (e) {
    if (stream?.timedOut?.() && text) {
      emitter.flush();
      return restorePiiResult({ text: text.trim(), raw: null, timedOut: true }, pii.replacements);
    }
    throw e;
  } finally {
    stream?.cleanup?.();
  }
}

function hashText(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function summaryNoteFingerprint(note) {
  return [
    note?.id || '',
    note?.modifiedAt || note?.date || '',
    String(note?.body || '').length,
    hashText(String(note?.title || '') + '\n' + String(note?.body || '').slice(0, 4000)).slice(0, 16),
  ].join(':');
}

function formatSummaryNote(note, index) {
  const tags = (note.tags || []).map(tag => `#${tag}`).join(' ') || 'none';
  const body = stripPromptPropertyLines(note.body || '').slice(0, SUMMARY_NOTE_BODY_CHARS);
  return [
    `<note index="${index + 1}">`,
    `<title>${note.title || 'Untitled'}</title>`,
    `<modifiedAt>${note.modifiedAt || note.date || 'unknown'}</modifiedAt>`,
    `<tags>${tags}</tags>`,
    '<content>',
    body || '(empty note)',
    '</content>',
    '</note>',
  ].join('\n');
}

function batchNotesForSummary(notes, options = {}) {
  const maxChars = Math.max(2500, Math.min(Number(options.batchMaxChars) || SUMMARY_BATCH_MAX_CHARS, 20000));
  const maxNotes = Math.max(1, Math.min(Number(options.batchMaxNotes) || SUMMARY_BATCH_MAX_NOTES, 20));
  const batches = [];
  let batch = [];
  let used = 0;
  for (const note of sortByModified(notes || [])) {
    const formatted = formatSummaryNote(note, batch.length);
    const cost = formatted.length + 2;
    if (batch.length && (batch.length >= maxNotes || used + cost > maxChars)) {
      batches.push(batch);
      batch = [];
      used = 0;
    }
    batch.push(note);
    used += cost;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function fallbackBatchSummary(notes = [], reason = '') {
  const lines = [];
  for (const note of notes) {
    const preview = notePreview(note, 180);
    lines.push(`- ${note.title || 'Untitled'}${preview ? `: ${preview}` : ''}`);
  }
  return [
    reason ? `AI summary fallback (${reason}).` : 'AI summary fallback.',
    ...lines,
  ].join('\n');
}

function collectSummarySources(notes = [], limit = 80) {
  return sortByModified(notes).slice(0, limit).map(note => ({
    id: note.id,
    title: note.title || 'Untitled',
    modifiedAt: note.modifiedAt,
    snippet: notePreview(note, 220),
  }));
}

function summaryCacheKey(kind, parts = []) {
  return `${CONFIG.provider}:${CONFIG.chatModel}:${kind}:${hashText(parts.join('\n'))}`;
}

function getCachedSummary(key) {
  const cached = summaryCache.get(key);
  if (cached && Date.now() - cached.at < QUERY_CACHE_MS * 4) return cached.value;
  return null;
}

function setCachedSummary(key, value) {
  summaryCache.set(key, { at: Date.now(), value });
  if (summaryCache.size > 120) {
    const first = summaryCache.keys().next().value;
    summaryCache.delete(first);
  }
}

async function summarizeNoteBatch(batch, query, options = {}) {
  const fingerprints = batch.map(summaryNoteFingerprint);
  const cacheKey = summaryCacheKey('batch', [String(query || ''), ...fingerprints]);
  const cached = getCachedSummary(cacheKey);
  if (cached) return cached;
  const docs = batch.map((note, index) => formatSummaryNote(note, index)).join('\n\n');
  const messages = [
    {
      role: 'system',
      content: [
        'You summarize batches of personal notes for VispNote.',
        'Use only the provided notes.',
        'Return concise markdown bullets.',
        'Preserve concrete decisions, tasks, dates, names, and important references.',
        'Cite note titles in brackets when useful.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `User request: ${query}`,
        '',
        'Summarize this batch. Include:',
        '- Key themes',
        '- Important decisions or facts',
        '- Open tasks',
        '- Notable dates/names',
        '',
        docs,
      ].join('\n'),
    },
  ];
  const { text } = await providerChat(messages, {
    signal: options.signal,
    timeoutMs: options.timeoutMs || SUMMARY_REQUEST_TIMEOUT_MS,
    maxTokens: options.maxTokens || SUMMARY_MAP_MAX_TOKENS,
  });
  const summary = String(text || '').trim();
  const value = summary || fallbackBatchSummary(batch, 'empty model response');
  setCachedSummary(cacheKey, value);
  return value;
}

function formatFinalSummary({ query, summaries, notes, failures = [] } = {}) {
  const sourceLines = sortByModified(notes || []).slice(0, 80).map(note => `- [[${note.title || 'Untitled'}]]`);
  return [
    '# Notes summary',
    '',
    failures.length ? `> Partial AI summary: ${failures.length} batch${failures.length === 1 ? '' : 'es'} used a fallback because the model timed out or failed.` : null,
    '',
    '## Summary',
    summaries.join('\n\n'),
    '',
    '## Source notes',
    sourceLines.join('\n'),
    '',
    `Request: ${query}`,
  ].filter(item => item !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function reduceBatchSummaries(summaries, query, notes, options = {}) {
  if (summaries.length <= 1) return summaries[0] || '';
  const combined = summaries.map((summary, index) => `--- Batch ${index + 1} ---\n${summary}`).join('\n\n');
  const cacheKey = summaryCacheKey('reduce', [String(query || ''), combined]);
  const cached = getCachedSummary(cacheKey);
  if (cached) return cached;
  const messages = [
    {
      role: 'system',
      content: [
        'You combine batch summaries into one final markdown note.',
        'Use only the batch summaries.',
        'Do not invent facts.',
        'Keep the final note useful, concise, and structured.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `User request: ${query}`,
        '',
        'Combine these batch summaries into one final note with sections:',
        '## Overview',
        '## Key points',
        '## Decisions and facts',
        '## Tasks',
        '## Source themes',
        '',
        combined.slice(0, MAX_RAG_PROMPT_CHARS),
      ].join('\n'),
    },
  ];
  try {
    const { text } = await providerChat(messages, {
      signal: options.signal,
      timeoutMs: options.timeoutMs || SUMMARY_REQUEST_TIMEOUT_MS,
      maxTokens: options.maxTokens || SUMMARY_REDUCE_MAX_TOKENS,
    });
    const reduced = String(text || '').trim();
    if (reduced) {
      setCachedSummary(cacheKey, reduced);
      return reduced;
    }
  } catch (e) {
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') throw e;
    console.warn('[ai] summary reduce failed', e.message || String(e));
  }
  return formatFinalSummary({ query, summaries, notes });
}

async function summarizeVaultInternal(vaultId, query, st, storeApi, options = {}) {
  const vault = await storeApi.loadVault(vaultId);
  const notes = sortByModified(vault.notes || []);
  if (!notes.length) return { ok: true, answer: 'No notes were found in this vault.', sources: [], mode: 'summary-empty' };
  if (!st?.reachable || !st?.chatModelOk) {
    return {
      ok: false,
      error: chatUnavailableReason(st || {}),
      setupRequired: true,
      sources: collectSummarySources(notes),
    };
  }
  const batches = batchNotesForSummary(notes, options);
  const summaries = [];
  const failures = [];
  for (let i = 0; i < batches.length; i++) {
    if (options.signal?.aborted) throw options.signal.reason || new Error('AI summary cancelled');
    try {
      options.onProgress && options.onProgress({ phase: 'map', index: i + 1, total: batches.length });
      summaries.push(await summarizeNoteBatch(batches[i], query, options));
    } catch (e) {
      if (e.name === 'AbortError' || e.code === 'ABORT_ERR') throw e;
      failures.push({ index: i + 1, error: e.message || String(e) });
      summaries.push(fallbackBatchSummary(batches[i], e.message || 'model failed'));
    }
  }
  options.onProgress && options.onProgress({ phase: 'reduce', index: batches.length, total: batches.length });
  const reduced = await reduceBatchSummaries(summaries, query, notes, options);
  const answer = formatFinalSummary({
    query,
    summaries: [reduced],
    notes,
    failures,
  });
  return {
    ok: true,
    answer,
    sources: collectSummarySources(notes),
    mode: 'map-reduce-summary',
    batches: batches.length,
    partial: failures.length > 0,
    failures,
  };
}

function providerUnavailableError(st) {
  if (CONFIG.provider === 'ollama') return 'Ollama not reachable at ' + ollama.getHost();
  return st.reason || `${currentProviderMeta().label} is not configured`;
}

function chatUnavailableReason(st) {
  if (!st?.reachable) return providerUnavailableError(st || {});
  if (CONFIG.provider === 'ollama') return `Local chat model is not installed. To enable generative AI, install Ollama and run: ollama pull ${CONFIG.chatModel}`;
  return st.reason || 'Chat model is not configured';
}

function buildModelSetupAnswer(query, context, st) {
  const reason = chatUnavailableReason(st);
  const snippets = (context.notes || []).slice(0, 5).map((note, index) => {
    const preview = notePreview(note, 220) || '(empty note)';
    return `${index + 1}. ${note.title || 'Untitled'} — ${preview}`;
  });
  const lines = [
    reason,
    '',
    'VispNote can still search your notes locally without a chat model. Here are the most relevant notes I found for your question:',
    snippets.length ? snippets.join('\n') : 'No matching notes were found yet.',
    '',
    CONFIG.provider === 'ollama'
      ? `After the model is installed, reopen Ask AI or click Refresh in Settings > AI. Requested question: ${String(query || '').trim()}`
      : 'Configure the selected AI provider in Settings > AI to enable generated answers.',
  ];
  return lines.filter(line => line !== null && line !== undefined).join('\n');
}


function buildChatSetupAnswer(st) {
  return [
    chatUnavailableReason(st),
    '',
    CONFIG.provider === 'ollama'
      ? `To enable generated chat responses, start Ollama and install the configured model with: ollama pull ${CONFIG.chatModel}`
      : 'Configure the selected AI provider in Settings > AI to enable generated chat responses.',
  ].join('\n');
}

async function modelSetupFallback(vaultId, query, st, storeApi, options) {
  const context = await buildVaultContext(
    vaultId,
    query,
    { ...(st || {}), embedModelOk: false, askMode: 'keyword' },
    storeApi,
    { ...options, recursiveResearch: false }
  );
  const sources = (context.notes || []).map(note => ({
    id: note.id,
    title: note.title,
    modifiedAt: note.modifiedAt,
    snippet: String(note.body || '').slice(0, 200),
  }));
  return {
    ok: true,
    answer: buildModelSetupAnswer(query, context, st),
    sources,
    mode: 'keyword-setup',
    setupRequired: true,
    contextCapped: context.capped,
  };
}

async function summarizeVault(vaultId, query, storeApi = vaultStore, options = {}) {
  const signal = beginCancellableJob(options.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    return await summarizeVaultInternal(vaultId, query, st, storeApi, { ...options, signal });
  } finally {
    finishCancellableJob(options.jobId);
  }
}

// Gather vault context → chat with selected notes. Returns { answer, sources }.
async function ask(vaultId, query, storeApi = vaultStore, options = {}) {
  const signal = beginCancellableJob(options.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const st = await status();
    if (!st.reachable || !st.chatModelOk) return await modelSetupFallback(vaultId, query, st, storeApi, { ...options, signal });
    if (isBroadVaultSummaryQuery(query)) {
      return await summarizeVaultInternal(vaultId, query, st, storeApi, { ...options, signal });
    }

    const context = await buildVaultContext(vaultId, query, st, storeApi, { ...options, signal });
    if (!context.notes.length) {
      return { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] };
    }
    const messages = buildRagPrompt(query, context);
    const { text } = await providerChat(messages, {
      signal,
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens || ASK_MAX_TOKENS,
    });
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
    if (!st.reachable || !st.chatModelOk) {
      const fallback = await modelSetupFallback(vaultId, query, st, storeApi, { ...options, signal });
      if (fallback.answer) options.onToken && options.onToken(fallback.answer);
      return fallback;
    }
    if (isBroadVaultSummaryQuery(query)) {
      const summary = await summarizeVaultInternal(vaultId, query, st, storeApi, { ...options, signal });
      if (summary.answer) options.onToken && options.onToken(summary.answer);
      return summary;
    }

    const context = await buildVaultContext(vaultId, query, st, storeApi, { ...options, signal });
    if (!context.notes.length) {
      return { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] };
    }
    const messages = buildRagPrompt(query, context);
    const { text } = await providerChatStream(messages, {
      signal,
      onToken: options.onToken,
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens || ASK_MAX_TOKENS,
    });
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
    if (!st.reachable) return { ok: false, error: providerUnavailableError(st), setupRequired: true };
    if (!st.chatModelOk) {
      return { ok: false, error: chatUnavailableReason(st), setupRequired: true };
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
    if (!st.reachable) {
      return { ok: false, error: providerUnavailableError(st), setupRequired: true };
    }
    if (!st.chatModelOk) {
      return { ok: false, error: chatUnavailableReason(st), setupRequired: true };
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
    const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
    const latestUser = [...provided].reverse().find(m => m?.role === 'user' && String(m.content || '').trim());
    const fast = fastChatAnswer(latestUser?.content || '');
    if (fast) return { ok: true, answer: fast, fast: true };
    const st = await status();
    if (!st.reachable || !st.chatModelOk) {
      return { ok: true, answer: buildChatSetupAnswer(st), setupRequired: true };
    }
    const messages = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...provided
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .slice(-8)
        .map(m => ({ role: m.role, content: String(m.content) })),
    ];
    const { text } = await providerChat(messages, {
      signal,
      timeoutMs: input?.timeoutMs,
      maxTokens: input?.maxTokens || CHAT_MAX_TOKENS,
    });
    return { ok: true, answer: String(text || '').trim() };
  } finally {
    finishCancellableJob(input?.jobId);
  }
}

async function toolPlan(input = {}) {
  const signal = beginCancellableJob(input?.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
    const messages = provided
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
      .slice(-10)
      .map(m => ({ role: m.role, content: String(m.content) }));
    if (!messages.length) return { ok: false, error: 'No user request was provided' };
    const tools = sanitizeAiTools(input?.tools || []);
    if (!tools.length) return { ok: false, error: 'No tools were provided' };
    const st = await status();
    if (!st.reachable || !st.chatModelOk) return { ok: false, error: chatUnavailableReason(st), setupRequired: true };
    const result = await providerToolPlan(messages, tools, {
      signal,
      timeoutMs: input?.timeoutMs || TOOL_PLAN_TIMEOUT_MS,
      maxTokens: input?.maxTokens || TOOL_PLAN_MAX_TOKENS,
      nativeOnly: input?.nativeOnly === true,
    });
    return {
      ok: true,
      answer: String(result.answer || '').trim(),
      toolCalls: normalizeToolCalls(result.toolCalls || []),
      native: !!result.native,
      provider: result.provider || CONFIG.provider,
    };
  } finally {
    finishCancellableJob(input?.jobId);
  }
}

async function chatStream(input) {
  const signal = beginCancellableJob(input?.jobId);
  try {
    if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
    const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
    const latestUser = [...provided].reverse().find(m => m?.role === 'user' && String(m.content || '').trim());
    const fast = fastChatAnswer(latestUser?.content || '');
    if (fast) {
      input?.onToken && input.onToken(fast);
      return { ok: true, answer: fast, fast: true };
    }
    const st = await status();
    if (!st.reachable || !st.chatModelOk) {
      const answer = buildChatSetupAnswer(st);
      if (answer) input?.onToken && input.onToken(answer);
      return { ok: true, answer, setupRequired: true };
    }
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
      maxTokens: input?.maxTokens || CHAT_MAX_TOKENS,
    });
    return { ok: true, answer: String(text || '').trim() };
  } finally {
    finishCancellableJob(input?.jobId);
  }
}

module.exports = {
  status, connect, getConfig, publicConfig, setConfig, previewConfig, applyConfig,
  cancelJob,
  scheduleEmbed, embedNote, backfillVault, backfillStatus, cancelBackfill, indexStatus,
  relatedNotes,
  ask, askStream, summarizeVault, editText, editTextStream, chat, chatStream, toolPlan, buildVaultContext,
  __test: {
    publicConfig,
    sanitizeConfigPatch,
    sanitizeSecretValue,
    reducePiiText,
    restorePiiText,
    reducePiiMessages,
    isPrivateHost,
    normalizeResearchToolCalls,
    providerChat,
    providerChatStream,
    providerToolPlan,
    fallbackJsonToolPlan,
    sanitizeAiTools,
    openAiToolDefinitions,
    anthropicToolDefinitions,
    geminiToolDefinitions,
    normalizeToolCalls,
    summarizeVaultInternal,
    extractWikiLinkTitles,
    expandTraversalCandidates,
    shouldUseRecursiveNoteResearch,
    buildNoteResearchCorpus,
    parseResearchToolCalls,
    runRecursiveNoteResearch,
    ollamaServeEnv,
  },
};
