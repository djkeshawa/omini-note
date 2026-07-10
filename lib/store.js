// Filesystem-backed store for VispNote vaults.
// Layout:
//   <root>/.config.json                  global config (vaults list, active vault, tweaks)
//   <root>/<slug>/.meta.json             per-vault metadata (name, tags w/ hues, lastSelectedId)
//   <root>/<slug>/<noteId>.md            one markdown file per note, with YAML front-matter

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const themes = require('./themes');
const featureUsage = require('./featureUsage');

const APP_DIR_NAME = 'VispNote';
const LEGACY_APP_DIR_NAMES = ['OminiNote', 'MyNote'];
const OVERRIDE_ROOT = process.env.VISPNOTE_HOME ? path.resolve(process.env.VISPNOTE_HOME) : '';
const PRIMARY_ROOT = OVERRIDE_ROOT || path.join(os.homedir(), APP_DIR_NAME);
const LEGACY_ROOT = LEGACY_APP_DIR_NAMES.map(name => path.join(os.homedir(), name)).find(dir => fs.existsSync(dir));
const ROOT = OVERRIDE_ROOT || (!fs.existsSync(PRIMARY_ROOT) && LEGACY_ROOT ? LEGACY_ROOT : PRIMARY_ROOT);
const CONFIG_FILE = path.join(ROOT, '.config.json');
const CONFIG_FILE_MODE = 0o600;
const ENTITY_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_TITLE_LENGTH = 240;
const MAX_TAG_NAME_LENGTH = 64;
const MAX_WORKFLOW_ID_LENGTH = 18;
const SAFETY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TEMP_FILE_RETENTION_MS = 60 * 60 * 1000;
const IMPORT_STAGING_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE_VERSIONS = 50;
const MAX_JSON_FILE_BYTES = 1024 * 1024;
const MAX_JSON_WRITE_BYTES = 1024 * 1024;
const MAX_NOTE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CANVAS_JSON_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_BACKUP_VAULTS = 50;
const MAX_BACKUP_NOTES_PER_VAULT = 5000;
const MAX_BACKUP_CANVASES_PER_VAULT = 1000;
const BACKUP_FORMAT = 'vispnote.backup.v1';
const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CLEANUP_DEBOUNCE_MS = 5 * 60 * 1000;
const STORE_PREF_TWEAK_KEYS = new Set([
  'theme', 'density', 'graphStyle', 'todoVariant', 'toastVariant',
  'fontChoice', 'showNoteList', 'showSidebar', 'editorWidth', 'fontSize',
  'appFontSize', 'indentGuides', 'spellCheck', 'autoLink',
  'collapseByDefault', 'sortBy', 'defaultTags', 'pinnedFirst',
  'startupView', 'rollupFormat', 'rollupDefaultRange', 'rollupGroupBy', 'rollupShowPreviews',
  'rollupShowTasks', 'rollupShowReminders', 'rollupCollapseOlder',
  'reminderSound', 'showOverdue', 'snoozeMinutes',
  'weekStart', 'workflowStates', 'plugins', 'autoSave', 'storageFormat', 'sync',
]);
const STORE_AI_CONFIG_KEYS = new Set([
  'enabled', 'provider', 'ollamaHost', 'openaiBaseUrl', 'openrouterBaseUrl',
  'anthropicBaseUrl', 'geminiBaseUrl', 'customBaseUrl', 'openaiApiKey',
  'openrouterApiKey', 'anthropicApiKey', 'geminiApiKey', 'customApiKey',
  'embedModel', 'chatModel', 'embedConcurrency', 'ragTopK', 'maxTokens',
  'piiReduction',
]);
const PHASE5_METRICS_FORMAT = 'vispnote.phase5Metrics.v1';
const PHASE5_METRIC_KEYS = new Set([
  'capture_saves',
  'zotero_source_notes',
  'theme_installs',
  'onboarding_mode_selections',
]);
const PHASE5_METRIC_DETAIL_KEYS = new Set([
  'destinationId',
  'templateId',
  'mode',
  'themeId',
  'onboardingMode',
]);
const FEATURE_PACK_IDS = new Set(['planning', 'canvas', 'research', 'writer', 'agents', 'labs']);
let configCache = null;
let configCacheRepaired = false;
const noteSaveLocks = new Map();
const cleanupVaultSafetyRuns = new Map();
const cleanupVaultSafetyInFlight = new Map();

function normalizeEnabledPacks(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => String(item || '').trim().toLowerCase())
    .filter(id => FEATURE_PACK_IDS.has(id)))];
}

// ── Front-matter ────────────────────────────────────────────────────────────

function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: text };
  const head = text.slice(4, end);
  let body = text.slice(end + 4).replace(/^\n+/, '');
  const meta = {};
  for (const raw of head.split('\n')) {
    const m = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (/^\[.*\]$/.test(val)) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) {
      try { val = JSON.parse(val); } catch {}
    }
    meta[m[1]] = val;
  }
  return { meta, body };
}

function serializeFrontMatter(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map(s => /[,\[\]"]/.test(String(s)) ? JSON.stringify(s) : s).join(', ')}]`);
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      lines.push(`${k}: ${v}`);
    } else {
      const s = String(v);
      lines.push(`${k}: ${/[:#"'\[\]\n]/.test(s) ? JSON.stringify(s) : s}`);
    }
  }
  lines.push('---', '', body || '');
  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vault';
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function mapLimit(items, limit, mapper) {
  const list = Array.from(items || []);
  const out = new Array(list.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), list.length || 1);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < list.length) {
      const index = next++;
      out[index] = await mapper(list[index], index);
    }
  }));
  return out;
}

async function quarantineBrokenJson(file, error) {
  try {
    const broken = `${file}.broken.${safetyStamp()}`;
    await retryRename(file, broken);
    console.warn(`Moved unreadable JSON to ${path.basename(broken)}: ${error?.message || String(error)}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('Could not preserve unreadable JSON', path.basename(file), e.message || String(e));
  }
}

async function readJsonSafe(file, fallback) {
  let handle = null;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    let text = '';
    try {
      handle = await fsp.open(file, fs.constants.O_RDONLY | noFollow);
      const stat = await handle.stat();
      if (!stat.isFile()) throw unsafeFileError(`JSON file must be a regular file: ${path.basename(file)}`);
      if (stat.size > MAX_JSON_FILE_BYTES) {
        const err = new Error(`JSON file too large: ${path.basename(file)}`);
        err.code = 'JSON_TOO_LARGE';
        throw err;
      }
      text = await handle.readFile('utf8');
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_JSON_FILE_BYTES) {
      const err = new Error(`JSON file too large: ${path.basename(file)}`);
      err.code = 'JSON_TOO_LARGE';
      throw err;
    }
    return JSON.parse(text);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    if (e.code === 'ELOOP') {
      await quarantineBrokenJson(file, unsafeFileError(`JSON file cannot be a symlink: ${path.basename(file)}`));
      return fallback;
    }
    if (e instanceof SyntaxError || e.code === 'JSON_TOO_LARGE') {
      await quarantineBrokenJson(file, e);
    } else if (e.code === 'UNSAFE_FILE') {
      console.warn('Ignored unsafe JSON file', path.basename(file), e.message || String(e));
    }
    return fallback;
  }
}

async function writeJson(file, obj, options = {}) {
  await ensureDir(path.dirname(file));
  const text = JSON.stringify(obj, null, 2);
  assertByteLength(text, options.maxBytes || MAX_JSON_WRITE_BYTES, `${path.basename(file)} is too large`);
  await atomicWriteFile(file, text, 'utf8', options);
}

function assertByteLength(value, maxBytes, message) {
  if (Buffer.byteLength(String(value || ''), 'utf8') > maxBytes) throw new Error(message);
}

function assertArrayLimit(items, maxItems, message) {
  if (Array.isArray(items) && items.length > maxItems) throw new Error(message);
}

function unsafeFileError(message) {
  const error = new Error(message);
  error.code = 'UNSAFE_FILE';
  return error;
}

async function readRegularUtf8File(file, options = {}) {
  const label = options.label || 'File';
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle = null;
  try {
    handle = await fsp.open(file, fs.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) throw unsafeFileError(`${label} must be a regular file`);
    if (options.maxBytes && stat.size > options.maxBytes) throw new Error(options.tooLargeMessage || `${label} is too large`);
    const text = await handle.readFile('utf8');
    if (options.maxBytes && Buffer.byteLength(text, 'utf8') > options.maxBytes) throw new Error(options.tooLargeMessage || `${label} is too large`);
    return { text, stat };
  } catch (e) {
    if (e?.code === 'ELOOP') throw unsafeFileError(`${label} cannot be a symlink`);
    throw e;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function retryRename(source, target) {
  const retryCodes = new Set(['EBUSY', 'EPERM']);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fsp.rename(source, target);
      return;
    } catch (e) {
      lastError = e;
      if (!retryCodes.has(e.code)) throw e;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function atomicWriteFile(file, data, encoding = 'utf8', options = {}) {
  await ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  let handle = null;
  try {
    handle = await fsp.open(tmp, 'w', options.mode);
    if (options.mode !== undefined) await handle.chmod(options.mode);
    await handle.writeFile(data, encoding);
    await handle.sync();
    await handle.close();
    handle = null;
    await retryRename(tmp, file);
    if (options.mode !== undefined) await fsp.chmod(file, options.mode);
    await syncDirectory(path.dirname(file));
  } catch (e) {
    try { if (handle) await handle.close(); } catch {}
    try { await fsp.unlink(tmp); } catch {}
    throw e;
  }
}

async function syncDirectory(dir) {
  let handle = null;
  try {
    handle = await fsp.open(dir, 'r');
    await handle.sync();
  } catch (e) {
    // Some platforms/filesystems do not allow fsync on directories.
  } finally {
    try { if (handle) await handle.close(); } catch {}
  }
}

function vaultDir(slug) { return path.join(ROOT, slug); }
function vaultMetaFile(slug) { return path.join(vaultDir(slug), '.meta.json'); }
function canvasDir(slug) { return path.join(vaultDir(slug), '.canvases'); }
function trashNoteDir(slug) { return path.join(vaultDir(slug), '.trash', 'notes'); }
function trashCanvasDir(slug) { return path.join(vaultDir(slug), '.trash', 'canvases'); }
function noteVersionsDir(slug, noteId) { return path.join(vaultDir(slug), '.versions', 'notes', validateNoteId(noteId)); }
function isSafeVaultSlug(slug) {
  return /^[A-Za-z0-9_-]+$/.test(String(slug || ''));
}
async function vaultDirectoryExists(slug) {
  if (!isSafeVaultSlug(slug)) return false;
  try {
    const stat = await fsp.lstat(vaultDir(slug));
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (e) {
    return false;
  }
}
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validateEntityId(value, label) {
  const id = String(value || '');
  if (!ENTITY_ID_RE.test(id)) {
    throw new Error(`Invalid ${label} id`);
  }
  return id;
}
function isValidEntityId(value) {
  return ENTITY_ID_RE.test(String(value || ''));
}
function validateNoteId(noteId) {
  return validateEntityId(noteId, 'note');
}
function validateTrashId(trashId) {
  return validateEntityId(trashId, 'trash');
}
function validateVersionId(versionId) {
  return validateEntityId(versionId, 'version');
}
function allocateVaultSlug(cfg, name) {
  const slug = slugify(name);
  let finalSlug = slug, i = 2;
  while (cfg.vaults.some(v => v.slug === finalSlug) || fs.existsSync(vaultDir(finalSlug))) {
    if (i >= 1000) throw new Error('Could not allocate vault folder');
    finalSlug = `${slug}-${i++}`;
  }
  return finalSlug;
}

async function reserveVaultDir(cfg, name) {
  const slug = slugify(name);
  let i = 1;
  while (i < 1000) {
    const finalSlug = i === 1 ? slug : `${slug}-${i}`;
    if (cfg.vaults.some(v => v.slug === finalSlug)) {
      i++;
      continue;
    }
    try {
      await fsp.mkdir(vaultDir(finalSlug), { recursive: false });
      return finalSlug;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      i++;
    }
  }
  throw new Error('Could not allocate vault folder');
}
function noteFile(slug, noteId) {
  const dir = vaultDir(slug);
  const file = path.resolve(dir, `${validateNoteId(noteId)}.md`);
  const rel = path.relative(dir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid note path');
  }
  return file;
}
function trashNoteFile(slug, trashId) {
  return path.join(trashNoteDir(slug), `${validateTrashId(trashId)}.md`);
}
function validateCanvasId(canvasId) {
  return validateEntityId(canvasId, 'canvas');
}
function canvasFile(slug, canvasId) {
  const dir = canvasDir(slug);
  const file = path.resolve(dir, `${validateCanvasId(canvasId)}.json`);
  const rel = path.relative(dir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid canvas path');
  }
  return file;
}
function trashCanvasFile(slug, trashId) {
  return path.join(trashCanvasDir(slug), `${validateTrashId(trashId)}.json`);
}
function versionNoteFile(slug, noteId, versionId) {
  return path.join(noteVersionsDir(slug, noteId), `${validateVersionId(versionId)}.md`);
}
function cleanString(value, fallback = '', maxLength = MAX_TITLE_LENGTH) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  return (text || fallback).slice(0, maxLength);
}
function cleanMergePatch(patch, allowed = null) {
  if (!isPlainObject(patch)) throw new Error('Invalid patch');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_MERGE_KEYS.has(key)) throw new Error('Unsupported patch field: ' + key);
    if (allowed && !allowed.has(key)) throw new Error('Unsupported patch field: ' + key);
    clean[key] = value;
  }
  return clean;
}
function normalizePhase5MetricKey(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return PHASE5_METRIC_KEYS.has(key) ? key : '';
}
function cleanPhase5MetricDetailValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  return cleanString(value, '', 120)
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
function sanitizePhase5MetricDetails(details = {}) {
  if (!isPlainObject(details)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(details)) {
    if (UNSAFE_MERGE_KEYS.has(key) || !PHASE5_METRIC_DETAIL_KEYS.has(key)) continue;
    const cleaned = cleanPhase5MetricDetailValue(value);
    if (cleaned === '' || cleaned == null) continue;
    clean[key] = cleaned;
  }
  return clean;
}
function sanitizePhase5Metrics(raw = null, options = {}) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) {
    if (options.rejectUnknown) throw new Error('Invalid Phase 5 metrics');
    return null;
  }
  const counters = {};
  const rawCounters = isPlainObject(raw.counters) ? raw.counters : {};
  for (const [key, value] of Object.entries(rawCounters)) {
    if (UNSAFE_MERGE_KEYS.has(key) || !PHASE5_METRIC_KEYS.has(key)) {
      if (options.rejectUnknown) throw new Error('Unsupported Phase 5 metric key: ' + key);
      continue;
    }
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
      if (options.rejectUnknown) throw new Error('Invalid Phase 5 metric count');
      continue;
    }
    if (count > 0) counters[key] = Math.min(Math.floor(count), 999999);
  }
  const events = (Array.isArray(raw.events) ? raw.events : [])
    .map((event) => {
      if (!isPlainObject(event)) return null;
      const key = normalizePhase5MetricKey(event.key);
      if (!key) {
        if (options.rejectUnknown) throw new Error('Unsupported Phase 5 metric key: ' + String(event.key || ''));
        return null;
      }
      const eventTime = event.at ? new Date(event.at) : null;
      if (!eventTime || !Number.isFinite(eventTime.getTime())) {
        if (options.rejectUnknown) throw new Error('Invalid Phase 5 metric timestamp');
        return null;
      }
      return { key, at: eventTime.toISOString(), details: sanitizePhase5MetricDetails(event.details) };
    })
    .filter(Boolean)
    .slice(-100);
  const updatedTime = raw.updatedAt ? new Date(raw.updatedAt) : null;
  return {
    format: PHASE5_METRICS_FORMAT,
    counters,
    events,
    updatedAt: updatedTime && Number.isFinite(updatedTime.getTime()) ? updatedTime.toISOString() : null,
  };
}
function recordPhase5Metric(metrics, key, details = {}, options = {}) {
  const metricKey = normalizePhase5MetricKey(key);
  if (!metricKey) throw new Error('Unsupported Phase 5 metric key: ' + String(key || ''));
  const now = options.now ? new Date(options.now) : new Date();
  const at = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  const current = sanitizePhase5Metrics(metrics, { rejectUnknown: false }) || {
    format: PHASE5_METRICS_FORMAT,
    counters: {},
    events: [],
    updatedAt: null,
  };
  return {
    format: PHASE5_METRICS_FORMAT,
    counters: { ...current.counters, [metricKey]: (current.counters[metricKey] || 0) + 1 },
    events: [...current.events, { key: metricKey, at, details: sanitizePhase5MetricDetails(details) }].slice(-100),
    updatedAt: at,
  };
}
function normalizeTagName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_NAME_LENGTH);
}
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags.map((tag) => {
    const name = normalizeTagName(typeof tag === 'string' ? tag : tag?.name);
    if (!name || seen.has(name)) return null;
    seen.add(name);
    const hue = Number(tag?.hue);
    return {
      name,
      hue: Number.isFinite(hue) ? Math.max(0, Math.min(360, hue)) : 240,
    };
  }).filter(Boolean);
}
function normalizeWorkflowId(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_WORKFLOW_ID_LENGTH);
}
function normalizeWorkflowStates(states) {
  if (states === null || states === undefined) return null;
  if (!Array.isArray(states)) throw new Error('Invalid workflow states');
  const seen = new Set();
  const next = states.map((state) => {
    const id = normalizeWorkflowId(typeof state === 'string' ? state : state?.id);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const normalized = { id };
    if (typeof state?.color === 'string') normalized.color = state.color.slice(0, 80);
    if (typeof state?.bg === 'string') normalized.bg = state.bg.slice(0, 80);
    if (Object.prototype.hasOwnProperty.call(state || {}, 'next')) {
      normalized.next = state.next ? normalizeWorkflowId(state.next) || null : null;
    }
    return normalized;
  }).filter(Boolean);
  const validIds = new Set(next.map(state => state.id));
  return next.map(state => ({
    ...state,
    next: state.next && validIds.has(state.next) ? state.next : (state.next === undefined ? undefined : null),
  }));
}
function cleanNovelistAiText(value, max = 5000) {
  return cleanString(value, '', max);
}
function sanitizeNovelistAiConfig(raw) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) throw new Error('Invalid novelist AI config patch');
  const parsedLimit = Number(raw.wordLimit);
  const maxTokens = Number(raw.advanced?.maxTokens);
  const temperature = Number(raw.advanced?.temperature);
  const prompts = Array.isArray(raw.prompts)
    ? raw.prompts.map((prompt, index) => ({
      id: cleanString(prompt?.id || `prompt-${index + 1}`, `prompt-${index + 1}`, 80).replace(/[^a-zA-Z0-9_-]+/g, '-'),
      name: cleanNovelistAiText(prompt?.name, 120),
      prompt: cleanNovelistAiText(prompt?.prompt ?? prompt?.text, 5000),
    })).filter(prompt => prompt.prompt).slice(0, 12)
    : [];
  const modelCollections = Array.isArray(raw.modelCollections)
    ? raw.modelCollections.map((collection, index) => ({
      id: cleanString(collection?.id || `collection-${index + 1}`, `collection-${index + 1}`, 80).replace(/[^a-zA-Z0-9_-]+/g, '-'),
      name: cleanNovelistAiText(collection?.name, 120),
      models: Array.isArray(collection?.models)
        ? collection.models.map(model => cleanNovelistAiText(model, 120)).filter(Boolean).slice(0, 24)
        : [],
    })).slice(0, 8)
    : [];
  return {
    version: 2,
    preset: cleanNovelistAiText(raw.preset, 120),
    modelCollections,
    activeModelCollectionId: cleanNovelistAiText(raw.activeModelCollectionId, 80),
    model: cleanNovelistAiText(raw.model, 120),
    promptType: cleanNovelistAiText(raw.promptType, 80),
    moderation: raw.moderation === false ? false : true,
    wordLimit: Number.isFinite(parsedLimit) ? Math.min(12000, Math.max(100, Math.round(parsedLimit))) : undefined,
    instructions: cleanNovelistAiText(raw.instructions, 10000),
    additionalContext: cleanNovelistAiText(raw.additionalContext, 10000),
    includedComponents: isPlainObject(raw.includedComponents) ? {
      plotPoints: raw.includedComponents.plotPoints !== false,
      selectedContext: raw.includedComponents.selectedContext !== false,
      noteBody: raw.includedComponents.noteBody !== false,
      storyStructure: raw.includedComponents.storyStructure !== false,
    } : undefined,
    systemMessage: cleanNovelistAiText(raw.systemMessage, 5000),
    userMessage: cleanNovelistAiText(raw.userMessage, 5000),
    advanced: {
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : '',
      maxTokens: Number.isFinite(maxTokens) ? Math.max(128, Math.min(8192, Math.round(maxTokens))) : '',
    },
    defaultPromptId: cleanNovelistAiText(raw.defaultPromptId, 80),
    prompts,
  };
}
function extractWikiTargets(body = '') {
  const targets = [];
  const re = /\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|[^\]\n]+)?\]\]/g;
  let match;
  while ((match = re.exec(String(body || '')))) {
    const title = cleanString(match[1], '', MAX_TITLE_LENGTH);
    if (title) targets.push(title);
  }
  return targets;
}
function sanitizeVaultMetaPatch(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid vault metadata patch');
  const allowed = new Set(['tags', 'lastSelectedId', 'novelistMode', 'workflowStates', 'novelistAiConfig']);
  const unknown = Object.keys(patch).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error('Unsupported vault metadata field: ' + unknown[0]);
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) next.tags = normalizeTags(patch.tags);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastSelectedId')) {
    next.lastSelectedId = patch.lastSelectedId ? validateNoteId(patch.lastSelectedId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'novelistMode')) next.novelistMode = !!patch.novelistMode;
  if (Object.prototype.hasOwnProperty.call(patch, 'workflowStates')) next.workflowStates = normalizeWorkflowStates(patch.workflowStates);
  if (Object.prototype.hasOwnProperty.call(patch, 'novelistAiConfig')) {
    if (patch.novelistAiConfig == null) next.novelistAiConfig = null;
    else next.novelistAiConfig = sanitizeNovelistAiConfig(patch.novelistAiConfig);
  }
  return next;
}

function normalizeCanvasViewport(viewport) {
  const raw = isPlainObject(viewport) ? viewport : {};
  const x = Number(raw.x);
  const y = Number(raw.y);
  const scale = Number(raw.scale);
  return {
    x: Number.isFinite(x) ? Math.max(-100000, Math.min(100000, x)) : 0,
    y: Number.isFinite(y) ? Math.max(-100000, Math.min(100000, y)) : 0,
    scale: Number.isFinite(scale) ? Math.max(0.1, Math.min(8, scale)) : 1,
  };
}

function normalizeCanvas(canvas = {}) {
  const now = new Date().toISOString();
  const id = validateCanvasId(canvas.id || `c_${Date.now().toString(36)}`);
  return {
    id,
    title: String(canvas.title || 'Untitled canvas').trim() || 'Untitled canvas',
    createdAt: canvas.createdAt || now,
    modifiedAt: canvas.modifiedAt || now,
    viewport: normalizeCanvasViewport(canvas.viewport),
    elements: Array.isArray(canvas.elements) ? canvas.elements : [],
  };
}

function safetyStamp() {
  return new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-+$/g, '');
}

function uniqueSafetyId(prefix, id) {
  const safeId = String(id || 'item').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'item';
  return `${prefix}_${safeId}_${safetyStamp()}_${Math.random().toString(36).slice(2, 7)}`;
}

function uniqueImportedEntityId(rawId, usedIds, validateId, fallbackPrefix) {
  const fallback = `${fallbackPrefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const base = validateId(rawId || fallback);
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = validateId(`${base}_imported_${randomUUID().replace(/-/g, '').slice(0, 12)}`);
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error('Could not allocate imported item id');
}

function fileAgeMs(stat) {
  return Date.now() - new Date(stat.mtime).getTime();
}

function safeNoteIdFromFile(metaId, fallbackId) {
  try {
    if (metaId) return validateNoteId(metaId);
  } catch {}
  return validateNoteId(fallbackId);
}

async function readNoteFile(file, fallbackId = '') {
  const { text, stat } = await readRegularUtf8File(file, {
    label: 'Note file',
    maxBytes: MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES,
    tooLargeMessage: 'Note file is too large',
  });
  const { meta: fm, body } = parseFrontMatter(text);
  const noteId = safeNoteIdFromFile(fm.id, fallbackId || path.basename(file, '.md'));
  const modifiedAt = stat.mtime.toISOString();
  return {
    id: noteId,
    title: fm.title || 'Untitled',
    date: fm.date || new Date().toISOString(),
    modifiedAt,
    diskModifiedAt: modifiedAt,
    tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
    pinned: !!fm.pinned,
    workflowArchived: !!fm.workflowArchived,
    body,
  };
}

async function cleanupFlatDir(dir, retentionMs = SAFETY_RETENTION_MS) {
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return; }
  await mapLimit(files, 16, async (file) => {
    const full = path.join(dir, file);
    try {
      const stat = await fsp.stat(full);
      if (stat.isFile() && fileAgeMs(stat) > retentionMs) await fsp.unlink(full);
    } catch {}
  });
}

async function cleanupTempFiles(dir, retentionMs = TEMP_FILE_RETENTION_MS) {
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return; }
  await mapLimit(files, 16, async (file) => {
    if (!file.startsWith('.') || !file.endsWith('.tmp')) return;
    const full = path.join(dir, file);
    try {
      const stat = await fsp.stat(full);
      if (stat.isFile() && fileAgeMs(stat) > retentionMs) await fsp.unlink(full);
    } catch {}
  });
}

async function cleanupDirChildren(dir, prefix, retentionMs) {
  let entries = [];
  try { entries = await fsp.readdir(dir); } catch { return; }
  await mapLimit(entries, 8, async (entry) => {
    if (prefix && !entry.startsWith(prefix)) return;
    const full = path.join(dir, entry);
    try {
      const stat = await fsp.stat(full);
      if (stat.isDirectory() && fileAgeMs(stat) > retentionMs) {
        await fsp.rm(full, { recursive: true, force: true });
      }
    } catch {}
  });
}

async function cleanupNoteVersions(slug, noteId) {
  const dir = noteVersionsDir(slug, noteId);
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return; }
  const rows = [];
  for (const file of files.filter(f => f.endsWith('.md'))) {
    const full = path.join(dir, file);
    try {
      const stat = await fsp.stat(full);
      rows.push({ file, full, mtime: stat.mtimeMs, old: fileAgeMs(stat) > SAFETY_RETENTION_MS });
    } catch {}
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  await mapLimit(rows, 16, async (row, index) => {
    if (row.old || index >= MAX_NOTE_VERSIONS) {
      try { await fsp.unlink(row.full); } catch {}
    }
  });
}

async function cleanupVaultSafety(slug) {
  await Promise.all([
    cleanupFlatDir(trashNoteDir(slug)),
    cleanupFlatDir(trashCanvasDir(slug)),
    cleanupTempFiles(vaultDir(slug)),
    cleanupTempFiles(canvasDir(slug)),
    cleanupTempFiles(trashNoteDir(slug)),
    cleanupTempFiles(trashCanvasDir(slug)),
  ]);
  const notesRoot = path.join(vaultDir(slug), '.versions', 'notes');
  let noteDirs = [];
  try { noteDirs = await fsp.readdir(notesRoot); } catch { return; }
  await mapLimit(noteDirs, 8, async (noteId) => {
    try { await cleanupNoteVersions(slug, noteId); } catch {}
  });
}

async function cleanupRootSafety() {
  await Promise.all([
    cleanupTempFiles(ROOT),
    cleanupDirChildren(ROOT, '.import-', IMPORT_STAGING_RETENTION_MS),
    cleanupDirChildren(path.join(ROOT, '.trash', 'vaults'), '', SAFETY_RETENTION_MS),
  ]);
}

async function cleanupVaultSafetyDebounced(slug) {
  const now = Date.now();
  const lastRun = cleanupVaultSafetyRuns.get(slug) || 0;
  if (now - lastRun < CLEANUP_DEBOUNCE_MS) return;
  const existing = cleanupVaultSafetyInFlight.get(slug);
  if (existing) return await existing;
  const task = cleanupVaultSafety(slug)
    .then(() => cleanupVaultSafetyRuns.set(slug, Date.now()))
    .finally(() => cleanupVaultSafetyInFlight.delete(slug));
  cleanupVaultSafetyInFlight.set(slug, task);
  await task;
}

async function moveVaultToTrash(slug) {
  const source = vaultDir(slug);
  const trashRoot = path.join(ROOT, '.trash', 'vaults');
  await ensureDir(trashRoot);
  const target = path.join(trashRoot, uniqueSafetyId('vault', slug));
  try {
    await retryRename(source, target);
    return target;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function conflictError(currentModifiedAt, expectedModifiedAt) {
  const e = new Error('Note changed on disk after it was loaded.');
  e.code = 'NOTE_CONFLICT';
  e.currentModifiedAt = currentModifiedAt;
  e.expectedModifiedAt = expectedModifiedAt;
  return e;
}

function shouldRejectStaleWrite(stat, expectedModifiedAt) {
  if (!expectedModifiedAt) return false;
  const expected = new Date(expectedModifiedAt).getTime();
  if (!Number.isFinite(expected)) return false;
  return stat.mtime.getTime() > expected;
}

async function snapshotNoteVersion(slug, noteId, text) {
  if (!text) return null;
  const versionId = `ver_${safetyStamp()}_${Math.random().toString(36).slice(2, 7)}`;
  const file = versionNoteFile(slug, noteId, versionId);
  await atomicWriteFile(file, text, 'utf8');
  await cleanupNoteVersions(slug, noteId);
  return versionId;
}

async function readExistingFile(file) {
  try {
    return await readRegularUtf8File(file, { label: 'Existing file' });
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// ── Vault CRUD ──────────────────────────────────────────────────────────────

async function loadConfig() {
  if (configCache) {
    if (!configCacheRepaired) {
      configCache = await repairConfigVaults(configCache);
      configCacheRepaired = true;
    }
    return configCache;
  }
  await secureConfigFile();
  await cleanupRootSafety();
  const cfg = await readJsonSafe(CONFIG_FILE, null);
  if (cfg && cfg.vaults && cfg.vaults.length) {
    configCache = await repairConfigVaults(cfg);
    configCacheRepaired = true;
    return configCache;
  }
  // First run: seed
  configCache = await firstRunSeed();
  return configCache;
}

async function saveConfig(cfg) {
  await writeJson(CONFIG_FILE, cfg, { mode: CONFIG_FILE_MODE });
  configCache = cfg;
  configCacheRepaired = true;
  return cfg;
}

async function firstRunSeed() {
  const { SEED_VAULTS } = require('./seed');
  const cfg = {
    vaults: [],
    activeVaultId: null,
    tweaks: null, // renderer fills with defaults
    aiConfig: null,
    phase5Metrics: null,
    enabledPacks: [],
    localUsageMetrics: true,
    anonymousUsageSharing: false,
    featureUsage: null,
  };
  for (const v of SEED_VAULTS) {
    const slug = await reserveVaultDir(cfg, v.name);
    const id = `v_${slug}`;
    await writeJson(vaultMetaFile(slug), {
      id, name: v.name, slug,
      tags: v.tags || [],
      lastSelectedId: v.notes[0]?.id || null,
      novelistMode: !!v.novelistMode,
      createdAt: new Date().toISOString(),
    });
    for (const n of v.notes) {
      await atomicWriteFile(
        noteFile(slug, n.id),
        serializeFrontMatter(
          { id: n.id, title: n.title, date: n.date, tags: n.tags || [], pinned: !!n.pinned },
          n.body || ''
        ),
        'utf8'
      );
    }
    cfg.vaults.push({ id, name: v.name, slug, path: vaultDir(slug) });
  }
  cfg.activeVaultId = cfg.vaults[0]?.id || null;
  await saveConfig(cfg);
  return cfg;
}

async function createVaultRecord(cfg, name, options = {}) {
  const cleanName = cleanString(name, 'Untitled vault');
  // De-dupe against both configured vaults and existing folders. A stale folder
  // from a removed/reset config must never be reused for a new vault.
  const finalSlug = await reserveVaultDir(cfg, cleanName);
  const id = `v_${finalSlug}_${Date.now().toString(36)}`;
  const seed = require('./seed');
  const explicitOnboardingMode = isPlainObject(options)
    ? seed.normalizeOnboardingMode(options.onboardingMode || options.mode)
    : '';
  const onboardingSeed = explicitOnboardingMode
    ? seed.buildOnboardingModeSeed(explicitOnboardingMode, { vaultName: cleanName, now: options.now })
    : null;
  if (onboardingSeed) {
    cfg.phase5Metrics = recordPhase5Metric(cfg.phase5Metrics, 'onboarding_mode_selections', {
      onboardingMode: onboardingSeed.id,
    }, { now: options.now });
  }
  const isNovelist = onboardingSeed
    ? !!onboardingSeed.novelistMode
    : isPlainObject(options) && (options.type === 'novelist' || options.novelistMode === true);
  const firstNoteId = `n_${Date.now().toString(36)}`;
  const starterTags = onboardingSeed ? onboardingSeed.tags : [];
  const starterNotes = onboardingSeed ? onboardingSeed.notes : isNovelist
    ? [
      {
        id: `${firstNoteId}_act`,
        title: 'Act 1',
        tags: ['novel-act'],
        pinned: true,
        body: 'status:: OUTLINE\norder:: 100\npurpose:: \n## Chapters\n- [[Chapter 1]]\n',
      },
      {
        id: `${firstNoteId}_chapter`,
        title: 'Chapter 1',
        tags: ['novel-chapter'],
        pinned: false,
        body: 'status:: OUTLINE\norder:: 110\nact:: [[Act 1]]\n## Scenes\n- [[Scene 1]]\n',
      },
      {
        id: `${firstNoteId}_scene`,
        title: 'Scene 1',
        tags: ['novel-scene'],
        pinned: false,
        body: 'status:: DRAFT\norder:: 111\nact:: [[Act 1]]\nchapter:: [[Chapter 1]]\npov:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.\n',
      },
    ]
    : [
      {
        id: firstNoteId,
        title: `Welcome to ${cleanName}`,
        tags: [],
        pinned: false,
        body: `- This is your new vault\n- Create notes with ⌘N\n- Switch vaults from the sidebar header\n`,
      },
    ];
  const workflowStates = isPlainObject(options) && Array.isArray(options.workflowStates)
    ? normalizeWorkflowStates(options.workflowStates)
    : null;
  await writeJson(vaultMetaFile(finalSlug), {
    id, name: cleanName, slug: finalSlug, tags: starterTags,
    lastSelectedId: starterNotes[0]?.id || firstNoteId,
    novelistMode: isNovelist,
    workflowStates,
    onboardingMode: onboardingSeed?.id || null,
    sidebarFocus: onboardingSeed?.suggestedSidebarFocus || null,
    commandSuggestions: onboardingSeed?.commands || null,
    createdAt: new Date().toISOString(),
  });
  for (const note of starterNotes) {
    await atomicWriteFile(
      noteFile(finalSlug, note.id),
      serializeFrontMatter(
        { id: note.id, title: note.title, date: note.date || new Date().toISOString(), tags: note.tags, pinned: !!note.pinned },
        note.body
      ),
      'utf8'
    );
  }
  const v = { id, name: cleanName, slug: finalSlug, path: vaultDir(finalSlug) };
  cfg.vaults.push(v);
  return v;
}

async function repairConfigVaults(cfg) {
  const originalVaults = Array.isArray(cfg.vaults) ? cfg.vaults : [];
  const validVaults = [];
  const usedIds = new Set();
  const repairedActiveIds = new Map();
  for (const v of originalVaults) {
    const slug = String(v?.slug || '');
    if (!slug || !await vaultDirectoryExists(slug)) continue;
    const baseId = isValidEntityId(v.id) ? String(v.id) : `v_${slug}`;
    let id = baseId;
    for (let i = 2; usedIds.has(id); i++) id = `${baseId}_${i}`;
    usedIds.add(id);
    const repaired = {
      id,
      name: cleanString(v.name, slug),
      slug,
      path: vaultDir(slug),
    };
    validVaults.push(repaired);
    if (v.id != null) repairedActiveIds.set(String(v.id), id);
  }
  let changed = JSON.stringify(validVaults) !== JSON.stringify(originalVaults);
  cfg.vaults = validVaults;
  if (!cfg.vaults.length) {
    await createVaultRecord(cfg, 'Personal');
    changed = true;
  }
  if (repairedActiveIds.has(String(cfg.activeVaultId || ''))) {
    const repairedActiveId = repairedActiveIds.get(String(cfg.activeVaultId || ''));
    if (cfg.activeVaultId !== repairedActiveId) {
      cfg.activeVaultId = repairedActiveId;
      changed = true;
    }
  }
  if (!cfg.vaults.some(v => v.id === cfg.activeVaultId)) {
    cfg.activeVaultId = cfg.vaults[0]?.id || null;
    changed = true;
  }
  if (changed) await saveConfig(cfg);
  return cfg;
}

async function secureConfigFile() {
  try {
    const stat = await fsp.lstat(CONFIG_FILE);
    if (stat.isSymbolicLink()) {
      await quarantineBrokenJson(CONFIG_FILE, unsafeFileError('Config file cannot be a symlink'));
      return;
    }
    if (!stat.isFile()) throw unsafeFileError('Config file must be a regular file');
    await fsp.chmod(CONFIG_FILE, CONFIG_FILE_MODE);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    if (e.code === 'UNSAFE_FILE') {
      console.warn('Ignored unsafe config file', path.basename(CONFIG_FILE), e.message || String(e));
      return;
    }
    throw e;
  }
}

async function listVaults() {
  let cfg = await loadConfig();
  cfg = await repairConfigVaults(cfg);
  configCache = cfg;
  configCacheRepaired = true;
  return await vaultsWithMeta(cfg);
}

async function vaultsWithMeta(cfg) {
  return Promise.all(cfg.vaults.map(async v => {
    const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
    return {
      ...v,
      novelistMode: !!meta.novelistMode,
      workflowStates: Array.isArray(meta.workflowStates) ? normalizeWorkflowStates(meta.workflowStates) : null,
      novelistAiConfig: isPlainObject(meta.novelistAiConfig) ? meta.novelistAiConfig : null,
    };
  }));
}

async function createVault(name, options = {}) {
  const cfg = await loadConfig();
  const v = await createVaultRecord(cfg, name, options);
  await saveConfig(cfg);
  return v;
}

async function renameVault(id, name) {
  const cfg = await loadConfig();
  const vaultId = validateEntityId(id, 'vault');
  const v = cfg.vaults.find(v => v.id === vaultId);
  if (!v) throw new Error('Vault not found: ' + vaultId);
  v.name = cleanString(name, 'Untitled vault');
  // keep slug stable on rename — don't move files
  await saveConfig(cfg);
  const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
  meta.name = v.name;
  await writeJson(vaultMetaFile(v.slug), meta);
  return v;
}

async function deleteVault(id) {
  const cfg = await loadConfig();
  const vaultId = validateEntityId(id, 'vault');
  const index = cfg.vaults.findIndex(v => v.id === vaultId);
  if (index < 0) throw new Error('Vault not found: ' + vaultId);
  if (cfg.vaults.length <= 1) {
    throw new Error('Create another vault before deleting this one.');
  }
  const originalVaults = [...cfg.vaults];
  const originalActiveVaultId = cfg.activeVaultId;
  const [v] = cfg.vaults.splice(index, 1);
  if (cfg.activeVaultId === vaultId) {
    cfg.activeVaultId = cfg.vaults[Math.min(index, cfg.vaults.length - 1)]?.id || cfg.vaults[0]?.id || null;
  }
  const deletedPath = await moveVaultToTrash(v.slug);
  try {
    await saveConfig(cfg);
  } catch (e) {
    if (deletedPath) {
      try { await retryRename(deletedPath, vaultDir(v.slug)); } catch {}
    }
    cfg.vaults = originalVaults;
    cfg.activeVaultId = originalActiveVaultId;
    configCache = cfg;
    throw e;
  }
  return {
    deletedVaultId: vaultId,
    activeVaultId: cfg.activeVaultId,
    deletedPath,
    vaults: await vaultsWithMeta(cfg),
  };
}

async function setActiveVault(id) {
  const cfg = await loadConfig();
  const vaultId = validateEntityId(id, 'vault');
  if (!cfg.vaults.some(v => v.id === vaultId)) throw new Error('Vault not found: ' + vaultId);
  cfg.activeVaultId = vaultId;
  await saveConfig(cfg);
}

// ── Note CRUD ───────────────────────────────────────────────────────────────

async function withNoteSaveLock(vaultId, noteId, fn) {
  const key = `${String(vaultId || '')}:${String(noteId || '')}`;
  const previous = noteSaveLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const chain = previous.then(() => current, () => current);
  noteSaveLocks.set(key, chain);
  try {
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
    if (noteSaveLocks.get(key) === chain) noteSaveLocks.delete(key);
  }
}

async function loadVault(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const dir = vaultDir(v.slug);
  if (!await vaultDirectoryExists(v.slug)) throw new Error('Vault folder missing: ' + v.name);
  await cleanupVaultSafetyDebounced(v.slug);
  const meta = await readJsonSafe(vaultMetaFile(v.slug), { tags: [], lastSelectedId: null });
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.md'));
  const warnings = [];
  const rows = await mapLimit(files, 32, async (f) => {
    try {
      const file = path.join(dir, f);
      return await readNoteFile(file, path.basename(f, '.md'));
    } catch (e) {
      if (e.code === 'UNSAFE_FILE') console.warn('Skipped unsafe note file', f, e.message || String(e));
      else console.error('Failed to read note', f, e);
      warnings.push({ type: 'note-read', file: f, message: e.message || String(e) });
      return null;
    }
  });
  const notes = rows.filter(Boolean);
  return {
    vaultId: safeVaultId,
    notes,
    tags: normalizeTags(meta.tags || []),
    novelistMode: !!meta.novelistMode,
    workflowStates: Array.isArray(meta.workflowStates) ? normalizeWorkflowStates(meta.workflowStates) : null,
    novelistAiConfig: isPlainObject(meta.novelistAiConfig) ? meta.novelistAiConfig : null,
    lastSelectedId: meta.lastSelectedId || notes[0]?.id || null,
    warnings,
  };
}

async function getNote(vaultId, noteId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const file = noteFile(v.slug, noteId);
  try {
    return await readNoteFile(file, validateNoteId(noteId));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function saveNote(vaultId, note, options = {}) {
  return await withNoteSaveLock(vaultId, note?.id, async () => {
    const cfg = await loadConfig();
    const safeVaultId = validateEntityId(vaultId, 'vault');
    const v = cfg.vaults.find(x => x.id === safeVaultId);
    if (!v) throw new Error('Vault not found: ' + safeVaultId);
    if (!isPlainObject(note)) throw new Error('Invalid note');
    await ensureDir(vaultDir(v.slug));
    assertByteLength(note.body || '', MAX_NOTE_BODY_BYTES, 'Note body is too large');
    const id = validateNoteId(note.id);
    const file = noteFile(v.slug, id);
    const existing = await readExistingFile(file);
    if (existing?.stat && shouldRejectStaleWrite(existing.stat, options.expectedModifiedAt)) {
      throw conflictError(existing.stat.mtime.toISOString(), options.expectedModifiedAt);
    }
    const normalizedTags = Array.isArray(note.tags) ? note.tags.map(normalizeTagName).filter(Boolean) : [];
    const text = serializeFrontMatter(
      {
        id,
        title: cleanString(note.title, 'Untitled'),
        date: note.date || new Date().toISOString(),
        tags: normalizedTags,
        pinned: !!note.pinned,
        workflowArchived: !!note.workflowArchived,
      },
      note.body || ''
    );
    assertByteLength(text, MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES, 'Note file is too large');
    if (existing?.text && existing.text !== text) {
      await snapshotNoteVersion(v.slug, id, existing.text);
    }
    await atomicWriteFile(file, text, 'utf8');
    const stat = await fsp.stat(file);
    const modifiedAt = stat.mtime.toISOString();
    return { ...note, tags: normalizedTags, modifiedAt, diskModifiedAt: modifiedAt };
  });
}

async function deleteNote(vaultId, noteId, noteSnapshot = null) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateNoteId(noteId);
  const file = noteFile(v.slug, id);
  const existing = await readExistingFile(file);
  if (!existing && !isPlainObject(noteSnapshot)) return null;
  const snapshotText = isPlainObject(noteSnapshot)
    ? serializeFrontMatter({
      id,
      title: cleanString(noteSnapshot.title, 'Untitled'),
      date: noteSnapshot.date || new Date().toISOString(),
      tags: Array.isArray(noteSnapshot.tags) ? noteSnapshot.tags.map(normalizeTagName).filter(Boolean) : [],
      pinned: !!noteSnapshot.pinned,
      workflowArchived: !!noteSnapshot.workflowArchived,
    }, noteSnapshot.body || '')
    : existing.text;
  const { meta: fm, body } = parseFrontMatter(snapshotText);
  const trashId = uniqueSafetyId('trash', id);
  const deletedAt = new Date().toISOString();
  const trashText = serializeFrontMatter({
    ...fm,
    id,
    originalId: id,
    trashId,
    deletedAt,
    originalTitle: fm.title || 'Untitled',
  }, body);
  await atomicWriteFile(trashNoteFile(v.slug, trashId), trashText, 'utf8');
  if (existing) await fsp.unlink(file);
  await cleanupFlatDir(trashNoteDir(v.slug));
  return { trashId, originalId: id, title: fm.title || 'Untitled', deletedAt };
}

async function listDeletedNotes(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  await cleanupFlatDir(trashNoteDir(v.slug));
  let files = [];
  try { files = (await fsp.readdir(trashNoteDir(v.slug))).filter(f => f.endsWith('.md')); } catch { return []; }
  const items = [];
  for (const f of files) {
    try {
      const file = path.join(trashNoteDir(v.slug), f);
      const { text, stat } = await readRegularUtf8File(file, {
        label: 'Deleted note file',
        maxBytes: MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES,
        tooLargeMessage: 'Deleted note file is too large',
      });
      const { meta: fm, body } = parseFrontMatter(text);
      const trashId = fm.trashId || path.basename(f, '.md');
      items.push({
        sourceType: 'note',
        trashId,
        originalId: fm.originalId || fm.id || '',
        title: fm.originalTitle || fm.title || 'Untitled',
        deletedAt: fm.deletedAt || stat.mtime.toISOString(),
        date: fm.date || null,
        tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
        size: Buffer.byteLength(body || '', 'utf8'),
      });
    } catch (e) {
      if (e.code === 'UNSAFE_FILE') console.warn('Skipped unsafe deleted note file', f, e.message || String(e));
      else console.error('Failed to read deleted note', f, e);
    }
  }
  return items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
}

async function restoreDeletedNote(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const safeTrashId = validateTrashId(trashId);
  const source = trashNoteFile(v.slug, safeTrashId);
  const { text } = await readRegularUtf8File(source, {
    label: 'Deleted note file',
    maxBytes: MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES,
    tooLargeMessage: 'Deleted note file is too large',
  });
  const { meta: fm, body } = parseFrontMatter(text);
  let noteId = validateNoteId(fm.originalId || fm.id || `n_${Date.now().toString(36)}`);
  if (await readExistingFile(noteFile(v.slug, noteId))) {
    const baseId = noteId;
    for (let i = 0; i < 8; i++) {
      const candidate = validateNoteId(`${baseId}_restored_${randomUUID().replace(/-/g, '').slice(0, 12)}`);
      if (!(await readExistingFile(noteFile(v.slug, candidate)))) {
        noteId = candidate;
        break;
      }
    }
    if (await readExistingFile(noteFile(v.slug, noteId))) throw new Error('Could not allocate restored note id');
  }
  const restoredText = serializeFrontMatter({
    id: noteId,
    title: fm.originalTitle || fm.title || 'Untitled',
    date: fm.date || new Date().toISOString(),
    tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
    pinned: !!fm.pinned,
    workflowArchived: !!fm.workflowArchived,
  }, body);
  const target = noteFile(v.slug, noteId);
  await atomicWriteFile(target, restoredText, 'utf8');
  await fsp.unlink(source);
  return await readNoteFile(target, noteId);
}

async function purgeDeletedNote(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const safeTrashId = validateTrashId(trashId);
  try { await fsp.unlink(trashNoteFile(v.slug, safeTrashId)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { purged: true, trashId: safeTrashId };
}

async function listNoteVersions(vaultId, noteId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateNoteId(noteId);
  await cleanupNoteVersions(v.slug, id);
  let files = [];
  try { files = (await fsp.readdir(noteVersionsDir(v.slug, id))).filter(f => f.endsWith('.md')); } catch { return []; }
  const items = [];
  for (const f of files) {
    try {
      const file = path.join(noteVersionsDir(v.slug, id), f);
      const { text, stat } = await readRegularUtf8File(file, {
        label: 'Note version file',
        maxBytes: MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES,
        tooLargeMessage: 'Note version file is too large',
      });
      const { meta: fm, body } = parseFrontMatter(text);
      items.push({
        versionId: path.basename(f, '.md'),
        noteId: id,
        title: fm.title || 'Untitled',
        createdAt: stat.mtime.toISOString(),
        date: fm.date || null,
        tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
        size: Buffer.byteLength(body || '', 'utf8'),
      });
    } catch (e) {
      if (e.code === 'UNSAFE_FILE') console.warn('Skipped unsafe note version file', f, e.message || String(e));
      else console.error('Failed to read note version', f, e);
    }
  }
  return items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function getNoteVersion(vaultId, noteId, versionId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateNoteId(noteId);
  const safeVersionId = validateVersionId(versionId);
  const { text, stat } = await readRegularUtf8File(versionNoteFile(v.slug, id, safeVersionId), {
    label: 'Note version file',
    maxBytes: MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES,
    tooLargeMessage: 'Note version file is too large',
  });
  const { meta: fm, body } = parseFrontMatter(text);
  return {
    versionId: safeVersionId,
    noteId: id,
    title: fm.title || 'Untitled',
    createdAt: stat.mtime.toISOString(),
    body: body || '',
  };
}

async function restoreNoteVersion(vaultId, noteId, versionId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateNoteId(noteId);
  const source = versionNoteFile(v.slug, id, versionId);
  const { text } = await readRegularUtf8File(source, {
    label: 'Note version file',
    maxBytes: MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES,
    tooLargeMessage: 'Note version file is too large',
  });
  const current = await readExistingFile(noteFile(v.slug, id));
  if (current?.text && current.text !== text) await snapshotNoteVersion(v.slug, id, current.text);
  const { meta: fm, body } = parseFrontMatter(text);
  const restoredText = serializeFrontMatter({
    id,
    title: fm.title || 'Untitled',
    date: fm.date || new Date().toISOString(),
    tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
    pinned: !!fm.pinned,
    workflowArchived: !!fm.workflowArchived,
  }, body);
  const target = noteFile(v.slug, id);
  await atomicWriteFile(target, restoredText, 'utf8');
  return await readNoteFile(target, id);
}

async function listCanvases(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const dir = canvasDir(v.slug);
  await ensureDir(dir);
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.json'));
  const canvases = [];
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      const { text: raw, stat } = await readRegularUtf8File(file, {
        label: 'Canvas file',
        maxBytes: MAX_CANVAS_JSON_BYTES,
        tooLargeMessage: 'Canvas file is too large',
      });
      const canvas = normalizeCanvas(JSON.parse(raw));
      canvases.push({
        id: canvas.id,
        title: canvas.title,
        createdAt: canvas.createdAt,
        modifiedAt: canvas.modifiedAt || stat.mtime.toISOString(),
        elementCount: canvas.elements.length,
      });
    } catch (e) {
      if (e.code === 'UNSAFE_FILE') console.warn('Skipped unsafe canvas file', f, e.message || String(e));
      else console.error('Failed to read canvas', f, e);
    }
  }
  canvases.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
  return canvases;
}

async function getCanvas(vaultId, canvasId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const { text: raw } = await readRegularUtf8File(canvasFile(v.slug, canvasId), {
    label: 'Canvas file',
    maxBytes: MAX_CANVAS_JSON_BYTES,
    tooLargeMessage: 'Canvas file is too large',
  });
  return normalizeCanvas(JSON.parse(raw));
}

async function saveCanvas(vaultId, canvas) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const next = normalizeCanvas({
    ...canvas,
    modifiedAt: new Date().toISOString(),
  });
  const text = JSON.stringify(next, null, 2);
  assertByteLength(text, MAX_CANVAS_JSON_BYTES, 'Canvas is too large');
  await ensureDir(canvasDir(v.slug));
  await atomicWriteFile(canvasFile(v.slug, next.id), text, 'utf8');
  return next;
}

async function deleteCanvas(vaultId, canvasId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateCanvasId(canvasId);
  const file = canvasFile(v.slug, id);
  let raw = null;
  try {
    ({ text: raw } = await readRegularUtf8File(file, {
      label: 'Canvas file',
      maxBytes: MAX_CANVAS_JSON_BYTES,
      tooLargeMessage: 'Canvas file is too large',
    }));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const trashId = uniqueSafetyId('canvas', id);
  let canvas = {};
  try { canvas = JSON.parse(raw); } catch {
    canvas = { title: 'Unreadable canvas', elements: [], rawText: raw };
  }
  const deletedAt = new Date().toISOString();
  await atomicWriteFile(trashCanvasFile(v.slug, trashId), JSON.stringify({
    ...canvas,
    id,
    originalId: id,
    trashId,
    deletedAt,
  }, null, 2), 'utf8');
  await fsp.unlink(file);
  await cleanupFlatDir(trashCanvasDir(v.slug));
  return { trashId, originalId: id, title: canvas.title || 'Untitled canvas', deletedAt };
}

async function listDeletedCanvases(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  await cleanupFlatDir(trashCanvasDir(v.slug));
  let files = [];
  try { files = (await fsp.readdir(trashCanvasDir(v.slug))).filter(f => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const f of files) {
    try {
      const file = path.join(trashCanvasDir(v.slug), f);
      const { text: raw, stat } = await readRegularUtf8File(file, {
        label: 'Deleted canvas file',
        maxBytes: MAX_CANVAS_JSON_BYTES,
        tooLargeMessage: 'Deleted canvas file is too large',
      });
      const canvas = JSON.parse(raw);
      items.push({
        sourceType: 'canvas',
        trashId: canvas.trashId || path.basename(f, '.json'),
        originalId: canvas.originalId || canvas.id || '',
        title: canvas.title || 'Untitled canvas',
        deletedAt: canvas.deletedAt || stat.mtime.toISOString(),
        size: Buffer.byteLength(raw || '', 'utf8'),
        elementCount: Array.isArray(canvas.elements) ? canvas.elements.length : 0,
      });
    } catch (e) {
      if (e.code === 'UNSAFE_FILE') console.warn('Skipped unsafe deleted canvas file', f, e.message || String(e));
      else console.error('Failed to read deleted canvas', f, e);
    }
  }
  return items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
}

async function restoreDeletedCanvas(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const safeTrashId = validateTrashId(trashId);
  const source = trashCanvasFile(v.slug, safeTrashId);
  const { text: raw } = await readRegularUtf8File(source, {
    label: 'Deleted canvas file',
    maxBytes: MAX_CANVAS_JSON_BYTES,
    tooLargeMessage: 'Deleted canvas file is too large',
  });
  const rawCanvas = JSON.parse(raw);
  let canvasId = validateCanvasId(rawCanvas.originalId || rawCanvas.id);
  if (await readExistingFile(canvasFile(v.slug, canvasId))) {
    const baseId = canvasId;
    for (let i = 0; i < 8; i++) {
      const candidate = validateCanvasId(`${baseId}_restored_${randomUUID().replace(/-/g, '').slice(0, 12)}`);
      if (!(await readExistingFile(canvasFile(v.slug, candidate)))) {
        canvasId = candidate;
        break;
      }
    }
    if (await readExistingFile(canvasFile(v.slug, canvasId))) throw new Error('Could not allocate restored canvas id');
  }
  const restored = normalizeCanvas({
    ...rawCanvas,
    id: canvasId,
    modifiedAt: new Date().toISOString(),
  });
  delete restored.originalId;
  delete restored.trashId;
  delete restored.deletedAt;
  await ensureDir(canvasDir(v.slug));
  const restoredText = JSON.stringify(restored, null, 2);
  assertByteLength(restoredText, MAX_CANVAS_JSON_BYTES, 'Canvas is too large');
  await atomicWriteFile(canvasFile(v.slug, restored.id), restoredText, 'utf8');
  await fsp.unlink(source);
  return restored;
}

async function purgeDeletedCanvas(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  try { await fsp.unlink(trashCanvasFile(v.slug, trashId)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { purged: true, trashId };
}

async function saveVaultMeta(vaultId, patch) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const cur = await readJsonSafe(vaultMetaFile(v.slug), {});
  const next = { ...cur, ...sanitizeVaultMetaPatch(patch) };
  await writeJson(vaultMetaFile(v.slug), next);
  return next;
}

async function exportBackup(options = {}) {
  const cfg = await loadConfig();
  const selected = options?.vaultId
    ? cfg.vaults.filter(v => v.id === validateEntityId(options.vaultId, 'vault'))
    : cfg.vaults;
  const vaults = [];
  const warnings = [];
  for (const v of selected) {
    const loaded = await loadVault(v.id);
    const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
    const canvasSummaries = await listCanvases(v.id);
    const canvases = [];
    for (const canvas of canvasSummaries) {
      try {
        canvases.push(await getCanvas(v.id, canvas.id));
      } catch (e) {
        warnings.push({ type: 'canvas-read', vaultId: v.id, canvasId: canvas.id, message: e.message || String(e) });
      }
    }
    vaults.push({
      id: v.id,
      name: v.name,
      slug: v.slug,
      meta: {
        tags: loaded.tags || [],
        lastSelectedId: loaded.lastSelectedId || null,
        novelistMode: !!loaded.novelistMode,
        workflowStates: loaded.workflowStates || null,
        novelistAiConfig: loaded.novelistAiConfig || null,
        createdAt: meta.createdAt || null,
      },
      notes: loaded.notes || [],
      canvases,
    });
  }
  return {
    format: BACKUP_FORMAT,
    app: APP_DIR_NAME,
    exportedAt: new Date().toISOString(),
    activeVaultId: cfg.activeVaultId || null,
    vaults,
    warnings,
  };
}

async function importBackup(payload, options = {}) {
  if (typeof payload === 'string' && Buffer.byteLength(payload, 'utf8') > MAX_BACKUP_IMPORT_BYTES) {
    throw new Error('Backup file is too large');
  }
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!isPlainObject(data) || data.format !== BACKUP_FORMAT || !Array.isArray(data.vaults)) {
    throw new Error('Unsupported backup file');
  }
  assertArrayLimit(data.vaults, MAX_BACKUP_VAULTS, `Backup has too many vaults; maximum is ${MAX_BACKUP_VAULTS}`);
  const cfg = await loadConfig();
  const nextCfg = { ...cfg, vaults: [...cfg.vaults] };
  const imported = [];
  const staged = [];
  const createdDirs = [];
  try {
    for (const source of data.vaults) {
      if (!isPlainObject(source)) continue;
      const sourceNotes = Array.isArray(source.notes) ? source.notes : [];
      const sourceCanvases = Array.isArray(source.canvases) ? source.canvases : [];
      assertArrayLimit(sourceNotes, MAX_BACKUP_NOTES_PER_VAULT, `Backup vault has too many notes; maximum is ${MAX_BACKUP_NOTES_PER_VAULT}`);
      assertArrayLimit(sourceCanvases, MAX_BACKUP_CANVASES_PER_VAULT, `Backup vault has too many canvases; maximum is ${MAX_BACKUP_CANVASES_PER_VAULT}`);
      const sourceName = cleanString(source.name, 'Restored vault');
      const name = options.keepNames === false ? `${sourceName} Restored` : sourceName;
      const finalSlug = allocateVaultSlug({ ...nextCfg, vaults: [...nextCfg.vaults, ...imported] }, name);
      const id = `v_${finalSlug}_${Date.now().toString(36)}`;
      const v = { id, name, slug: finalSlug, path: vaultDir(finalSlug) };
      const stagingSlug = `.import-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const stagingDir = vaultDir(stagingSlug);
      await ensureDir(stagingDir);
      staged.push({ stagingDir, finalDir: vaultDir(finalSlug), vault: v });

      const rawNovelistAiConfig = source.meta?.novelistAiConfig;
      const cleanMeta = sanitizeVaultMetaPatch({
        tags: source.meta?.tags || [],
        lastSelectedId: source.meta?.lastSelectedId || source.notes?.[0]?.id || null,
        novelistMode: !!source.meta?.novelistMode,
        workflowStates: source.meta?.workflowStates || null,
        novelistAiConfig: isPlainObject(rawNovelistAiConfig) ? rawNovelistAiConfig : null,
      });
      await writeJson(vaultMetaFile(stagingSlug), {
        id: v.id,
        name: v.name,
        slug: v.slug,
        tags: cleanMeta.tags || [],
        lastSelectedId: cleanMeta.lastSelectedId || null,
        novelistMode: !!cleanMeta.novelistMode,
        workflowStates: cleanMeta.workflowStates || null,
        novelistAiConfig: cleanMeta.novelistAiConfig || null,
        createdAt: source.meta?.createdAt || new Date().toISOString(),
        restoredAt: new Date().toISOString(),
      });

      const usedNoteIds = new Set();
      for (const note of sourceNotes) {
        if (!isPlainObject(note)) continue;
        const id = uniqueImportedEntityId(note.id, usedNoteIds, validateNoteId, 'n_imported');
        assertByteLength(note.body || '', MAX_NOTE_BODY_BYTES, 'Note body is too large');
        const text = serializeFrontMatter({
          id,
          title: cleanString(note.title, 'Untitled'),
          date: note.date || new Date().toISOString(),
          tags: Array.isArray(note.tags) ? note.tags.map(normalizeTagName).filter(Boolean) : [],
          pinned: !!note.pinned,
          workflowArchived: !!note.workflowArchived,
        }, note.body || '');
        await atomicWriteFile(noteFile(stagingSlug, id), text, 'utf8');
      }

      const usedCanvasIds = new Set();
      for (const canvas of sourceCanvases) {
        if (!isPlainObject(canvas)) continue;
        const next = normalizeCanvas({
          ...canvas,
          id: uniqueImportedEntityId(canvas.id, usedCanvasIds, validateCanvasId, 'c_imported'),
        });
        const text = JSON.stringify(next, null, 2);
        assertByteLength(text, MAX_CANVAS_JSON_BYTES, 'Canvas is too large');
        await ensureDir(canvasDir(stagingSlug));
        await atomicWriteFile(canvasFile(stagingSlug, next.id), text, 'utf8');
      }
      imported.push(v);
    }

    for (const item of staged) {
      try {
        await retryRename(item.stagingDir, item.finalDir);
      } catch (e) {
        if (e.code === 'EEXIST' || e.code === 'ENOTEMPTY') throw new Error('Vault import target already exists: ' + item.vault.slug);
        throw e;
      }
      createdDirs.push(item.finalDir);
    }
    nextCfg.vaults.push(...imported);
    if (imported.length && options.activate !== false) nextCfg.activeVaultId = imported[0].id;
    await saveConfig(nextCfg);
    return { importedVaults: imported, activeVaultId: nextCfg.activeVaultId, vaults: await vaultsWithMeta(nextCfg) };
  } catch (e) {
    await Promise.all(staged.map(item => fsp.rm(item.stagingDir, { recursive: true, force: true }).catch(() => {})));
    await Promise.all(createdDirs.map(dir => fsp.rm(dir, { recursive: true, force: true }).catch(() => {})));
    throw e;
  }
}

async function vaultHealth(vaultId) {
  const loaded = await loadVault(vaultId);
  const notes = loaded.notes || [];
  const canvases = await listCanvases(vaultId);
  const titleToIds = new Map();
  for (const note of notes) {
    const key = String(note.title || '').trim().toLowerCase();
    if (!key) continue;
    if (!titleToIds.has(key)) titleToIds.set(key, []);
    titleToIds.get(key).push(note.id);
  }
  const outgoing = new Map();
  const incoming = new Map(notes.map(note => [note.id, 0]));
  const brokenLinks = [];
  for (const note of notes) {
    const targets = extractWikiTargets(note.body || '');
    outgoing.set(note.id, targets.length);
    for (const target of targets) {
      const ids = titleToIds.get(target.toLowerCase());
      if (!ids?.length) {
        brokenLinks.push({ noteId: note.id, noteTitle: note.title, target });
      } else {
        ids.forEach(id => incoming.set(id, (incoming.get(id) || 0) + 1));
      }
    }
  }
  const orphanNotes = notes
    .filter(note => !(outgoing.get(note.id) || 0) && !(incoming.get(note.id) || 0))
    .map(note => ({ id: note.id, title: note.title }));
  const wordCount = notes.reduce((sum, note) => sum + `${note.title || ''} ${note.body || ''}`.trim().split(/\s+/).filter(Boolean).length, 0);
  return {
    noteCount: notes.length,
    tagCount: loaded.tags?.length || 0,
    canvasCount: canvases.length,
    wordCount,
    brokenLinks,
    orphanNotes,
    indexStatus: 'ready',
    checkedAt: new Date().toISOString(),
  };
}

// ── Prefs ───────────────────────────────────────────────────────────────────

async function getPrefs() {
  const cfg = await loadConfig();
  return {
    activeVaultId: cfg.activeVaultId,
    tweaks: cfg.tweaks || null,
    aiConfig: cfg.aiConfig || null,
    smartViews: Array.isArray(cfg.smartViews) ? cfg.smartViews : null,
    customThemes: themes.sanitizeStoredThemes(cfg.customThemes),
    phase5Metrics: sanitizePhase5Metrics(cfg.phase5Metrics),
    enabledPacks: normalizeEnabledPacks(cfg.enabledPacks),
    localUsageMetrics: cfg.localUsageMetrics !== false,
    anonymousUsageSharing: cfg.anonymousUsageSharing === true,
  };
}

async function setPrefs(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid preferences patch');
  const allowed = new Set([
    'activeVaultId', 'tweaks', 'aiConfig', 'smartViews', 'phase5Metrics',
    'enabledPacks', 'localUsageMetrics', 'anonymousUsageSharing',
  ]);
  const cleanPatch = cleanMergePatch(patch, allowed);
  const cfg = await loadConfig();
  if (cleanPatch.tweaks) {
    if (!isPlainObject(cleanPatch.tweaks)) throw new Error('Invalid tweaks patch');
    cfg.tweaks = { ...(cfg.tweaks || {}), ...cleanMergePatch(cleanPatch.tweaks, STORE_PREF_TWEAK_KEYS) };
  }
  if (cleanPatch.aiConfig) {
    if (!isPlainObject(cleanPatch.aiConfig)) throw new Error('Invalid AI config patch');
    cfg.aiConfig = { ...(cfg.aiConfig || {}), ...cleanMergePatch(cleanPatch.aiConfig, STORE_AI_CONFIG_KEYS) };
  }
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'smartViews')) {
    if (cleanPatch.smartViews == null) {
      cfg.smartViews = null;
    } else {
      if (!Array.isArray(cleanPatch.smartViews) || cleanPatch.smartViews.length > 24) throw new Error('Invalid Smart Views preference');
      assertByteLength(JSON.stringify(cleanPatch.smartViews), MAX_JSON_WRITE_BYTES, 'Smart Views preference is too large');
      cfg.smartViews = cleanPatch.smartViews;
    }
  }
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'phase5Metrics')) {
    cfg.phase5Metrics = cleanPatch.phase5Metrics == null
      ? null
      : sanitizePhase5Metrics(cleanPatch.phase5Metrics, { rejectUnknown: true });
  }
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'enabledPacks')) {
    cfg.enabledPacks = normalizeEnabledPacks(cleanPatch.enabledPacks);
  }
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'localUsageMetrics')) {
    if (typeof cleanPatch.localUsageMetrics !== 'boolean') throw new Error('Invalid local usage metrics preference');
    cfg.localUsageMetrics = cleanPatch.localUsageMetrics;
  }
  if (Object.prototype.hasOwnProperty.call(cleanPatch, 'anonymousUsageSharing')) {
    if (typeof cleanPatch.anonymousUsageSharing !== 'boolean') throw new Error('Invalid anonymous usage sharing preference');
    cfg.anonymousUsageSharing = cleanPatch.anonymousUsageSharing;
  }
  if (cleanPatch.activeVaultId) {
    const activeVaultId = validateEntityId(cleanPatch.activeVaultId, 'vault');
    if (!cfg.vaults.some(v => v.id === activeVaultId)) throw new Error('Vault not found: ' + activeVaultId);
    cfg.activeVaultId = activeVaultId;
  }
  await saveConfig(cfg);
}

async function featureUsageStatus() {
  const cfg = await loadConfig();
  return {
    localUsageMetrics: cfg.localUsageMetrics !== false,
    anonymousUsageSharing: cfg.anonymousUsageSharing === true,
    report: featureUsage.publicReport(cfg.featureUsage),
  };
}

async function recordFeatureUsage(feature, action = 'used') {
  const cfg = await loadConfig();
  if (cfg.localUsageMetrics !== false) {
    cfg.featureUsage = featureUsage.recordFeatureUsage(cfg.featureUsage, feature, action);
    await saveConfig(cfg);
  }
  return featureUsage.publicReport(cfg.featureUsage);
}

async function clearFeatureUsage() {
  const cfg = await loadConfig();
  cfg.featureUsage = null;
  await saveConfig(cfg);
  return featureUsage.publicReport(null);
}

async function getFeatureUsageData() {
  const cfg = await loadConfig();
  return featureUsage.sanitizeFeatureUsage(cfg.featureUsage);
}

async function setFeatureUsageData(value) {
  const cfg = await loadConfig();
  cfg.featureUsage = featureUsage.sanitizeFeatureUsage(value);
  await saveConfig(cfg);
  return cfg.featureUsage;
}

async function installCustomTheme(theme) {
  const cfg = await loadConfig();
  const installed = themes.upsertCustomTheme(cfg.customThemes, theme);
  cfg.customThemes = installed.customThemes;
  cfg.phase5Metrics = recordPhase5Metric(cfg.phase5Metrics, 'theme_installs', {
    themeId: installed.theme?.id || theme?.id,
  });
  await saveConfig(cfg);
  return installed;
}

async function importThemeFile(filePath) {
  const theme = await themes.readThemeFile(filePath);
  return await installCustomTheme(theme);
}

module.exports = {
  ROOT,
  loadConfig, listVaults, createVault, renameVault, deleteVault, setActiveVault,
  loadVault, getNote, saveNote, deleteNote, listDeletedNotes, restoreDeletedNote, purgeDeletedNote,
  listNoteVersions, getNoteVersion, restoreNoteVersion, saveVaultMeta,
  listCanvases, getCanvas, saveCanvas, deleteCanvas,
  listDeletedCanvases, restoreDeletedCanvas, purgeDeletedCanvas,
  exportBackup, importBackup, vaultHealth, atomicWriteFile,
  getPrefs, setPrefs, installCustomTheme, importThemeFile,
  featureUsageStatus, recordFeatureUsage, clearFeatureUsage, getFeatureUsageData, setFeatureUsageData,
  __test: {
    validateNoteId,
    validateCanvasId,
    validateTrashId,
    validateVersionId,
    normalizeTags,
    normalizeWorkflowStates,
    sanitizePhase5Metrics,
    recordPhase5Metric,
    normalizeEnabledPacks,
    sanitizeNovelistAiConfig,
    sanitizeVaultMetaPatch,
    atomicWriteFile,
    cleanupVaultSafety,
    secureConfigFile,
    CONFIG_FILE,
    CONFIG_FILE_MODE,
    MAX_NOTE_BODY_BYTES,
    MAX_JSON_WRITE_BYTES,
    MAX_CANVAS_JSON_BYTES,
    MAX_BACKUP_VAULTS,
    MAX_BACKUP_NOTES_PER_VAULT,
    MAX_BACKUP_CANVASES_PER_VAULT,
    clearConfigCache() { configCache = null; configCacheRepaired = false; },
  },
};
