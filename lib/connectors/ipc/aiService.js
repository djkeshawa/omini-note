const {
  isPlainObject,
  capString,
  capText,
  AI_QUERY_LIMIT,
  AI_EDIT_TEXT_LIMIT,
  AI_MESSAGE_TEXT_LIMIT,
  AI_MAX_TOKENS_LIMIT,
  AI_TOOL_LIMIT,
  AI_TOOL_SCHEMA_LIMIT,
  IPC_ID_RE,
  AI_TOOL_NAME_RE,
} = require('./preferenceValidation');

function createAiIpcService({ store, ai, getIndexReadyPromise, assertSearchIndexAvailable }) {
async function sanitizeAiAskArgs(vaultId, query) {
  const cleanVaultId = String(vaultId || '').trim();
  if (!IPC_ID_RE.test(cleanVaultId)) throw new Error('Invalid vault id');
  const cleanQuery = String(query || '');
  if (!cleanQuery.trim()) throw new Error('AI query is empty');
  if (cleanQuery.length > AI_QUERY_LIMIT) throw new Error('AI query is too long');
  const cfg = await store.loadConfig();
  if (!cfg.vaults?.some(v => v.id === cleanVaultId)) throw new Error('Vault not found: ' + cleanVaultId);
  return { vaultId: cleanVaultId, query: cleanQuery };
}

async function askFromIpc(vaultId, query, options) {
  const clean = await sanitizeAiAskArgs(vaultId, query);
  return ai.ask(clean.vaultId, clean.query, store, sanitizeAiAskOptions(options || {}));
}

function sendIpcChunk(evt, requestId, channel, token) {
  if (!requestId || evt.sender?.isDestroyed?.()) return;
  try {
    evt.sender.send(`${channel}:${requestId}`, String(token || ''));
  } catch (e) {
    console.warn(`${channel} chunk delivery failed`, e?.message || String(e));
  }
}

async function askStreamFromIpc(evt, vaultId, query, options = {}) {
  const clean = await sanitizeAiAskArgs(vaultId, query);
  const requestId = String(options.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const cleanOptions = sanitizeAiAskOptions(options || {});
  return await ai.askStream(clean.vaultId, clean.query, store, {
    ...cleanOptions,
    onToken: (token) => {
      sendIpcChunk(evt, requestId, 'mn:ai.askStream.chunk', token);
    },
  });
}

function isMissingVaultError(error) {
  return /\bVault (?:folder missing|not found):/i.test(String(error?.message || error || ''));
}

async function relatedNotesFromIpc(vaultId, noteId, options) {
  try {
    await getIndexReadyPromise();
    assertSearchIndexAvailable();
    return await ai.relatedNotes(vaultId, noteId, store, options || {});
  } catch (error) {
    if (isMissingVaultError(error)) {
      return { ok: false, reason: 'Vault not available' };
    }
    throw error;
  }
}

function sanitizeAiJobId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || undefined;
}

function sanitizeOptionalIpcId(value, field) {
  if (value == null || value === '') return undefined;
  const clean = capString(value, field, 120);
  if (!IPC_ID_RE.test(clean)) throw new Error(`Invalid ${field}`);
  return clean;
}

function sanitizeAiMaxTokens(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(128, Math.min(AI_MAX_TOKENS_LIMIT, Math.round(n))) : undefined;
}

function sanitizeAiAskOptions(options = {}) {
  return {
    jobId: sanitizeAiJobId(options.jobId),
    currentNoteId: sanitizeOptionalIpcId(options.currentNoteId, 'currentNoteId'),
    recursiveResearch: options.recursiveResearch === true,
    timeoutMs: sanitizeAiTimeoutMs(options.timeoutMs),
  };
}

function sanitizeAiTimeoutMs(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(5000, Math.min(180000, Math.round(n))) : undefined;
}

function sanitizeAiEditPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid AI edit payload');
  const clean = {
    text: capText(payload.text, 'text', AI_EDIT_TEXT_LIMIT),
    instruction: capString(payload.instruction || 'Improve the writing.', 'instruction', 4000),
    scope: capString(payload.scope || 'text', 'scope', 120),
    jobId: sanitizeAiJobId(payload.jobId),
  };
  if (payload.vaultId != null && payload.vaultId !== '') {
    const vaultId = capString(payload.vaultId, 'vaultId', 120);
    if (!IPC_ID_RE.test(vaultId)) throw new Error('Invalid vault id');
    clean.vaultId = vaultId;
  }
  clean.useNovelistConfig = payload.useNovelistConfig === true;
  return clean;
}

async function prepareAiEditPayload(payload = {}) {
  const clean = sanitizeAiEditPayload(payload);
  if (!clean.useNovelistConfig || !clean.vaultId) return clean;
  const vault = await store.loadVault(clean.vaultId);
  const config = isPlainObject(vault?.novelistAiConfig) ? vault.novelistAiConfig : null;
  if (!config) return clean;
  const advanced = isPlainObject(config.advanced) ? config.advanced : {};
  const maxTokens = sanitizeAiMaxTokens(advanced.maxTokens);
  return {
    ...clean,
    systemMessage: config.systemMessage ? capString(config.systemMessage, 'systemMessage', 12000) : '',
    model: config.model ? capString(config.model, 'model', 120) : '',
    maxTokens,
  };
}

function sanitizeAiChatPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid AI chat payload');
  const clean = {
    jobId: sanitizeAiJobId(payload.jobId),
    timeoutMs: sanitizeAiTimeoutMs(payload.timeoutMs),
    maxTokens: sanitizeAiMaxTokens(payload.maxTokens),
  };
  if (Array.isArray(payload.messages)) {
    clean.messages = payload.messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .slice(-8)
      .map(m => ({ role: m.role, content: capText(m.content, 'message', AI_MESSAGE_TEXT_LIMIT) }))
      .filter(m => m.content.trim());
  } else {
    clean.text = capText(payload.text || '', 'text', AI_MESSAGE_TEXT_LIMIT);
  }
  return clean;
}

function sanitizeJsonValue(value, field, maxBytes = AI_TOOL_SCHEMA_LIMIT) {
  const text = JSON.stringify(value ?? null);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`${field} is too large`);
  return JSON.parse(text);
}

function sanitizeStringList(value, field, limit = 8, maxChars = 240) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit)
    .map((item, index) => capString(item || '', `${field}[${index}]`, maxChars))
    .filter(Boolean);
}

function sanitizeAiToolPlanPayload(payload = {}) {
  const clean = sanitizeAiChatPayload(payload);
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  clean.tools = tools.slice(0, AI_TOOL_LIMIT).map((tool, index) => {
    if (!isPlainObject(tool)) throw new Error(`Invalid tool at index ${index}`);
    const name = capString(tool.name || tool.id || '', `tools[${index}].name`, 64);
    if (!AI_TOOL_NAME_RE.test(name)) throw new Error(`Invalid tool name: ${name}`);
    const item = {
      name,
      title: capString(tool.title || tool.label || name, `tools[${index}].title`, 120),
      description: capText(tool.description || tool.title || name, `tools[${index}].description`, 1600),
      section: capString(tool.section || '', `tools[${index}].section`, 80),
      kind: capString(tool.kind || '', `tools[${index}].kind`, 40),
      requires: sanitizeStringList(tool.requires, `tools[${index}].requires`, 8, 160),
      examples: sanitizeStringList(tool.examples, `tools[${index}].examples`, 8, 240),
      risk: capString(tool.risk || 'safe', `tools[${index}].risk`, 40),
      readOnly: tool.readOnly === true,
      destructive: tool.destructive === true,
      external: tool.external === true,
      confirm: tool.confirm === true,
      idempotent: tool.idempotent === true,
      inputSchema: sanitizeJsonValue(tool.inputSchema || tool.input_schema || { type: 'object', additionalProperties: false }, `tools[${index}].inputSchema`),
      outputSchema: sanitizeJsonValue(tool.outputSchema || tool.output_schema || { type: 'object', additionalProperties: true }, `tools[${index}].outputSchema`),
    };
    return item;
  });
  clean.nativeOnly = payload.nativeOnly === true;
  return clean;
}


  return {
    sanitizeAiAskArgs,
    askFromIpc,
    sendIpcChunk,
    askStreamFromIpc,
    relatedNotesFromIpc,
    sanitizeAiAskOptions,
    prepareAiEditPayload,
    sanitizeAiChatPayload,
    sanitizeAiToolPlanPayload,
  };
}

module.exports = { createAiIpcService };
