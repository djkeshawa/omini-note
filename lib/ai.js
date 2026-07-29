// AI orchestration: embed notes via Ollama and answer questions with RAG.
// Failures are isolated — if Ollama isn't running, the rest of the app
// keeps working, and embeds simply don't happen.

const ollama = require('./ollama');
const idx = require('./index');
const vaultStore = require('./store');
const pii = require('./aiPii');
const { readSseData, parseJsonSseEvent } = require('./ai/sse');
const providerTransport = require('./integrations/ai/providerTransport');
const toolSchemas = require('./integrations/ai/toolSchemas');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Defaults — overridable via setConfig() from prefs.
let CONFIG = {
  enabled: false,
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
const PROVIDER_STATUS_TIMEOUT_MS = 8000;
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
const TOOL_PLAN_TIMEOUT_MS = 45000;
const TOOL_PLAN_MAX_TOKENS = 900;

const {
  reducePiiText,
  restorePiiText,
  reducePiiMessages,
  restorePiiResult,
} = pii;
const {
  providerFetch,
  providerFetchStream,
} = providerTransport;
const {
  anthropicToolDefinitions: integrationAnthropicToolDefinitions,
  fallbackToolPlannerMessages: integrationFallbackToolPlannerMessages,
  geminiToolDefinitions: integrationGeminiToolDefinitions,
  normalizeToolCalls: integrationNormalizeToolCalls,
  openAiToolDefinitions: integrationOpenAiToolDefinitions,
  parseJsonObject: integrationParseJsonObject,
  sanitizeAiTools: integrationSanitizeAiTools,
  sanitizeToolSchema: integrationSanitizeToolSchema,
  toolPlannerSystemPrompt: integrationToolPlannerSystemPrompt,
} = toolSchemas;


let ollamaProcess = null;
let ollamaSpawnPromise = null;
let statusCache = null;
let embedModelFailure = null;
const cancellableJobs = new Map();
let embedAbortController = null;
const backfillJobs = new Map();
const pendingEmbeddings = new Map();
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
  return providerTransport.isUnsafeHostname(hostname);
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
  for (const key of Object.keys(CONFIG)) delete CONFIG[key];
  Object.assign(CONFIG, next, { provider });
  if (!CONFIG.enabled) {
    embedAbortController?.abort?.(new Error('AI disabled'));
    pendingEmbeddings.clear();
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

function providerSetupSteps(meta = currentProviderMeta()) {
  if (CONFIG.provider === 'ollama') {
    return [
      'Install Ollama from https://ollama.com/download if it is not installed.',
      'Start Ollama by opening the app or running: ollama serve',
      `Install the chat model: ollama pull ${providerChatModel(meta) || meta.defaultChatModel || 'gemma3'}`,
      `Optional for semantic note search: ollama pull ${CONFIG.embedModel || 'nomic-embed-text'}`,
      'Return to Settings > AI and click Connect or Refresh.',
    ];
  }
  const steps = [
    `Open Settings > AI and select ${meta.label}.`,
  ];
  if (meta.apiKeyField) steps.push(`Paste the API key for ${meta.label}.`);
  if (CONFIG.provider === 'custom') steps.push('Enter the HTTPS base URL for an OpenAI-compatible chat completions API.');
  steps.push(`Set a chat model${providerChatModel(meta) ? ` such as ${providerChatModel(meta)}` : ''}.`);
  steps.push('Click Check or Refresh in Settings > AI.');
  return steps;
}

function providerSetupMessage(reason, meta = currentProviderMeta()) {
  return [
    reason,
    '',
    'To use AI features:',
    ...providerSetupSteps(meta).map(step => `- ${step}`),
  ].join('\n');
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
    chatModel: model,
    providerReady: ready,
    askMode: 'keyword',
    ready,
    reason,
    setupRequired: !ready,
    setupSteps: ready ? [] : providerSetupSteps(meta),
    setupMessage: ready ? '' : providerSetupMessage(reason, meta),
  };
}

async function hostedProviderStatus(meta = currentProviderMeta()) {
  const localStatus = providerStatus(meta);
  if (!localStatus?.providerReady || CONFIG.provider !== 'openrouter') return localStatus;

  const apiKey = providerApiKey(meta);
  const baseUrl = providerBaseUrl(meta);
  try {
    await providerFetch(`${baseUrl}/credits`, {
      method: 'GET',
      headers: { 'authorization': `Bearer ${apiKey}` },
    }, meta.label, { timeoutMs: PROVIDER_STATUS_TIMEOUT_MS });
    return localStatus;
  } catch (e) {
    const detail = String(e?.message || e || '').trim();
    const rejected = /\b401\b|unauthorized|user not found|no auth credentials|missing authentication/i.test(detail);
    const reason = rejected
      ? `${meta.label} API key was rejected. Replace it in Settings > AI.`
      : `${meta.label} could not be verified: ${detail || 'request failed'}`;
    return {
      ...localStatus,
      reachable: false,
      chatModelOk: false,
      providerReady: false,
      ready: false,
      reason,
      setupRequired: true,
      setupSteps: providerSetupSteps(meta),
      setupMessage: providerSetupMessage(reason, meta),
    };
  }
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
  if (CONFIG.provider !== 'ollama') return remember(await hostedProviderStatus());
  const reachable = await ollama.ping();
  if (!reachable) {
    const reason = `Ollama not reachable at ${ollama.getHost()}`;
    return remember({
      reachable: false,
      models: [],
      embedModelOk: false,
      chatModelOk: false,
      ready: false,
      reason,
      setupRequired: true,
      setupSteps: providerSetupSteps(PROVIDERS.ollama),
      setupMessage: providerSetupMessage(reason, PROVIDERS.ollama),
    });
  }
  let models = [];
  try { models = (await ollama.tags()).map(m => m.name); } catch { /* */ }
  const matchingModel = (name) => models.find(m => m === name) || models.find(m => m.startsWith(name + ':')) || '';
  const has = (name) => !!matchingModel(name);
  let effectiveChatModel = CONFIG.chatModel;
  const configuredChatModel = matchingModel(effectiveChatModel);
  if (configuredChatModel) {
    effectiveChatModel = configuredChatModel;
  } else {
    const gemma = models.find(m => /^gemma/i.test(m));
    if (gemma) effectiveChatModel = gemma;
  }
  const embedModelOk = has(CONFIG.embedModel);
  const embedFailure = currentEmbedModelFailure();
  const chatModelOk = has(effectiveChatModel);
  const reason = chatModelOk
    ? (embedModelOk && !embedFailure ? 'Ollama is ready' : (embedFailure?.reason || `Embedding model is not installed: ollama pull ${CONFIG.embedModel}`))
    : `Local chat model is not installed: ollama pull ${CONFIG.chatModel}`;
  return remember({
    reachable: true,
    models,
    embedModelOk: embedModelOk && !embedFailure,
    embedModelReason: embedFailure?.reason || null,
    chatModelOk,
    chatModel: effectiveChatModel,
    askMode: embedModelOk && !embedFailure ? 'semantic' : 'keyword',
    ready: chatModelOk,
    reason,
    setupRequired: !chatModelOk,
    setupSteps: chatModelOk ? [] : providerSetupSteps(PROVIDERS.ollama),
    setupMessage: chatModelOk ? '' : providerSetupMessage(reason, PROVIDERS.ollama),
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

const { createEmbeddingDomain } = require('./ai/embeddings.js');
const { createResearchDomain } = require('./ai/research.js');
const { createProviderDomain } = require('./ai/providers.js');
const { createSummaryDomain } = require('./ai/summaries.js');
const { createOperationDomain } = require('./ai/operations.js');

const state = {};
Object.defineProperties(state, {
  ollamaProcess: { get: () => ollamaProcess, set: value => { ollamaProcess = value; } },
  ollamaSpawnPromise: { get: () => ollamaSpawnPromise, set: value => { ollamaSpawnPromise = value; } },
  statusCache: { get: () => statusCache, set: value => { statusCache = value; } },
  embedModelFailure: { get: () => embedModelFailure, set: value => { embedModelFailure = value; } },
  embedAbortController: { get: () => embedAbortController, set: value => { embedAbortController = value; } }
});
const scope = { ollama, idx, vaultStore, pii, readSseData, parseJsonSseEvent, providerTransport, toolSchemas, spawn, fs, path, crypto, CONFIG, PROVIDERS, STATUS_CACHE_MS, PROVIDER_STATUS_TIMEOUT_MS, OLLAMA_KEEP_ALIVE, WHOLE_VAULT_MAX_NOTES, WHOLE_VAULT_MAX_CHARS, SELECTED_NOTE_LIMIT, MAX_CONTEXT_CHARS, MAX_NOTE_BODY_CHARS, MAX_RAG_PROMPT_CHARS, TRAVERSAL_SEED_LIMIT, TRAVERSAL_MAX_NOTES, TRAVERSAL_SHARED_TAG_LIMIT, NOTE_RESEARCH_MAX_ROUNDS, NOTE_RESEARCH_MAX_TOOL_CALLS, NOTE_RESEARCH_MAX_NOTES, NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND, NOTE_RESEARCH_MAX_SUMMARIES, NOTE_RESEARCH_TOOL_RESULT_CHARS, NOTE_RESEARCH_ARG_CHARS, AI_CONFIG_KEYS, URL_CONFIG_KEYS, SECRET_CONFIG_KEYS, OLLAMA_ALLOWED_HOSTS, OLLAMA_ALLOWED_PORTS, PROVIDER_TIMEOUT_MS, QUERY_CACHE_MS, ASK_MAX_TOKENS, CHAT_MAX_TOKENS, SUMMARY_BATCH_MAX_CHARS, SUMMARY_BATCH_MAX_NOTES, SUMMARY_NOTE_BODY_CHARS, SUMMARY_MAP_MAX_TOKENS, SUMMARY_REDUCE_MAX_TOKENS, SUMMARY_REQUEST_TIMEOUT_MS, TOOL_PLAN_TIMEOUT_MS, TOOL_PLAN_MAX_TOKENS, reducePiiText, restorePiiText, reducePiiMessages, restorePiiResult, providerFetch, providerFetchStream, integrationAnthropicToolDefinitions, integrationFallbackToolPlannerMessages, integrationGeminiToolDefinitions, integrationNormalizeToolCalls, integrationOpenAiToolDefinitions, integrationParseJsonObject, integrationSanitizeAiTools, integrationSanitizeToolSchema, integrationToolPlannerSystemPrompt, ollamaProcess, ollamaSpawnPromise, statusCache, embedModelFailure, cancellableJobs, embedAbortController, backfillJobs, pendingEmbeddings, queryEmbeddingCache, retrievalCache, summaryCache, resolveOllamaBinary, getConfig, publicConfig, assertPlainConfigPatch, normalizeHttpUrl, isPrivateHost, ollamaHostForEnv, ollamaServeEnv, sanitizeModelName, sanitizeSecretValue, sanitizeConfigPatch, applyConfig, setConfig, isEmbeddingUnsupportedError, markEmbedModelFailure, currentEmbedModelFailure, embedWithConfiguredModel, shouldReducePiiForProvider, currentProviderMeta, providerBaseUrl, providerApiKey, providerChatModel, chatNumPredict, providerSetupSteps, providerSetupMessage, providerStatus, hostedProviderStatus, beginCancellableJob, finishCancellableJob, cancelJob, isUsefulResearchSummary, previewConfig, status, connect, state };
Object.assign(scope, createEmbeddingDomain(scope));
Object.assign(scope, createResearchDomain(scope));
Object.assign(scope, createProviderDomain(scope));
Object.assign(scope, createSummaryDomain(scope));
Object.assign(scope, createOperationDomain(scope));

module.exports = {
  status: scope.status,
  connect: scope.connect,
  getConfig: scope.getConfig,
  publicConfig: scope.publicConfig,
  setConfig: scope.setConfig,
  previewConfig: scope.previewConfig,
  applyConfig: scope.applyConfig,
  cancelJob: scope.cancelJob,
  scheduleEmbed: scope.scheduleEmbed,
  embedNote: scope.embedNote,
  backfillVault: scope.backfillVault,
  backfillStatus: scope.backfillStatus,
  cancelBackfill: scope.cancelBackfill,
  indexStatus: scope.indexStatus,
  relatedNotes: scope.relatedNotes,
  ask: scope.ask,
  askStream: scope.askStream,
  summarizeVault: scope.summarizeVault,
  editText: scope.editText,
  editTextStream: scope.editTextStream,
  chat: scope.chat,
  chatStream: scope.chatStream,
  toolPlan: scope.toolPlan,
  buildVaultContext: scope.buildVaultContext,
  setMemoryRecallProvider: scope.setMemoryRecallProvider,
  __test: {
    publicConfig: scope.publicConfig,
    buildRagPrompt: scope.buildRagPrompt,
    recallMemoryContext: scope.recallMemoryContext,
    memorySources: scope.memorySources,
    sanitizeConfigPatch: scope.sanitizeConfigPatch,
    sanitizeSecretValue: scope.sanitizeSecretValue,
    reducePiiText: scope.reducePiiText,
    restorePiiText: scope.restorePiiText,
    reducePiiMessages: scope.reducePiiMessages,
    isPrivateHost: scope.isPrivateHost,
    normalizeResearchToolCalls: scope.normalizeResearchToolCalls,
    providerChat: scope.providerChat,
    providerChatStream: scope.providerChatStream,
    providerToolPlan: scope.providerToolPlan,
    fallbackJsonToolPlan: scope.fallbackJsonToolPlan,
    sanitizeAiTools: scope.sanitizeAiTools,
    openAiToolDefinitions: scope.openAiToolDefinitions,
    anthropicToolDefinitions: scope.anthropicToolDefinitions,
    geminiToolDefinitions: scope.geminiToolDefinitions,
    normalizeToolCalls: scope.normalizeToolCalls,
    summarizeVaultInternal: scope.summarizeVaultInternal,
    extractWikiLinkTitles: scope.extractWikiLinkTitles,
    expandTraversalCandidates: scope.expandTraversalCandidates,
    shouldUseRecursiveNoteResearch: scope.shouldUseRecursiveNoteResearch,
    buildNoteResearchCorpus: scope.buildNoteResearchCorpus,
    parseResearchToolCalls: scope.parseResearchToolCalls,
    runRecursiveNoteResearch: scope.runRecursiveNoteResearch,
    ollamaServeEnv: scope.ollamaServeEnv,
  },
};
