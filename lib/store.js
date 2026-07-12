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
const featureUsage = require('./integrations/telemetry/featureUsage');
const { parseFrontMatter, serializeFrontMatter } = require('./storage/frontMatter');
const { createFilesystem } = require('./storage/filesystem');
const { createPreferencesRepository } = require('./storage/repositories/preferencesRepository');
const { createCanvasRepository } = require('./storage/repositories/canvasRepository');
const { createBackupRepository } = require('./storage/repositories/backupRepository');
const { createNoteRepository } = require('./storage/repositories/noteRepository');
const { createNoteHistoryRepository } = require('./storage/repositories/noteHistoryRepository');
const { sanitizePhase5Metrics, recordPhase5Metric } = require('./storage/phase5Metrics');
const { createMetadataModels } = require('./storage/metadataModels');
const { createVaultRepository } = require('./storage/repositories/vaultRepository');
const { createVaultMetadataRepository } = require('./storage/repositories/vaultMetadataRepository');
const { createBasicModels } = require('./storage/basicModels');
const { createSafetyMaintenance } = require('./storage/safetyMaintenance');

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
  'onboardingTipsDismissed', 'startupView', 'rollupFormat', 'rollupDefaultRange', 'rollupGroupBy', 'rollupShowPreviews',
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
const {
  ensureDir, mapLimit, quarantineBrokenJson, readJsonSafe, writeJson, assertByteLength, assertArrayLimit,
  unsafeFileError, readRegularUtf8File, retryRename, atomicWriteFile, syncDirectory,
} = createFilesystem({
  fs,
  path,
  maxJsonReadBytes: MAX_JSON_FILE_BYTES,
  maxJsonWriteBytes: MAX_JSON_WRITE_BYTES,
});
let configCache = null;
let configCacheRepaired = false;

// ── Front-matter ────────────────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vault';
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
const {
  normalizeEnabledPacks, extractWikiTargets, normalizeCanvas, safetyStamp,
  uniqueSafetyId, uniqueImportedEntityId,
} = createBasicModels({
  isPlainObject, validateCanvasId, cleanString, maxTitleLength: MAX_TITLE_LENGTH, randomUUID,
});
const {
  normalizeTagName, normalizeTags, normalizeWorkflowStates,
  sanitizeNovelistAiConfig, sanitizeVaultMetaPatch,
} = createMetadataModels({ cleanString, isPlainObject, validateNoteId });
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

const safetyMaintenance = createSafetyMaintenance({
  fsp, path, mapLimit, root: ROOT, vaultDir, canvasDir, trashNoteDir, trashCanvasDir,
  noteVersionsDir, isValidEntityId, ensureDir, uniqueSafetyId, retryRename,
  versionNoteFile, safetyStamp, atomicWriteFile, readRegularUtf8File,
  safetyRetentionMs: SAFETY_RETENTION_MS,
  tempRetentionMs: TEMP_FILE_RETENTION_MS,
  importRetentionMs: IMPORT_STAGING_RETENTION_MS,
  cleanupDebounceMs: CLEANUP_DEBOUNCE_MS,
  maxNoteVersions: MAX_NOTE_VERSIONS,
});
const {
  cleanupFlatDir, cleanupNoteVersions, cleanupVaultSafety, cleanupRootSafety,
  cleanupVaultSafetyDebounced, moveVaultToTrash, conflictError,
  shouldRejectStaleWrite, snapshotNoteVersion, readExistingFile,
} = safetyMaintenance;

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
  const { buildFirstRunSeed } = require('./seed');
  const seedVaults = buildFirstRunSeed();
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
  for (const v of seedVaults) {
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

const vaultRepository = createVaultRepository({
  loadConfig, saveConfig, repairConfigVaults,
  setRepairedConfigCache(cfg) { configCache = cfg; configCacheRepaired = true; },
  setConfigCache(cfg) { configCache = cfg; },
  readJsonSafe, vaultMetaFile, normalizeWorkflowStates, isPlainObject,
  createVaultRecord, validateEntityId, cleanString, writeJson,
  moveVaultToTrash, retryRename, vaultDir,
});
const {
  listVaults, vaultsWithMeta, createVault, renameVault, deleteVault, setActiveVault,
} = vaultRepository;

// ── Note CRUD ───────────────────────────────────────────────────────────────

const noteRepository = createNoteRepository({
  fsp, path, loadConfig, validateEntityId, vaultDir, vaultDirectoryExists,
  cleanupVaultSafetyDebounced, readJsonSafe, vaultMetaFile, mapLimit, readNoteFile,
  normalizeTags, normalizeWorkflowStates, isPlainObject, validateNoteId, ensureDir,
  assertByteLength, maxNoteBodyBytes: MAX_NOTE_BODY_BYTES, noteFile, readExistingFile,
  shouldRejectStaleWrite, conflictError, normalizeTagName, serializeFrontMatter,
  cleanString, maxJsonWriteBytes: MAX_JSON_WRITE_BYTES, snapshotNoteVersion, atomicWriteFile,
});
const { loadVault, getNote, saveNote } = noteRepository;

const noteHistoryRepository = createNoteHistoryRepository({
  fsp, path, randomUUID, loadConfig, validateEntityId, validateNoteId, validateTrashId,
  validateVersionId, noteFile, trashNoteFile, trashNoteDir, noteVersionsDir,
  versionNoteFile, readExistingFile, isPlainObject, serializeFrontMatter, parseFrontMatter,
  cleanString, normalizeTagName, uniqueSafetyId, atomicWriteFile, cleanupFlatDir,
  cleanupNoteVersions, readRegularUtf8File, readNoteFile, snapshotNoteVersion,
  noteReadOptions: label => ({
    label,
    maxBytes: MAX_NOTE_BODY_BYTES + MAX_JSON_WRITE_BYTES,
    tooLargeMessage: `${label} is too large`,
  }),
});
const {
  deleteNote, listDeletedNotes, restoreDeletedNote, purgeDeletedNote,
  listNoteVersions, getNoteVersion, restoreNoteVersion,
} = noteHistoryRepository;

const canvasRepository = createCanvasRepository({
  fsp, path, randomUUID, loadConfig, validateEntityId, canvasDir, canvasFile,
  trashCanvasDir, trashCanvasFile, readRegularUtf8File,
  maxCanvasBytes: MAX_CANVAS_JSON_BYTES,
  normalizeCanvas, ensureDir, atomicWriteFile, assertByteLength, validateCanvasId,
  validateTrashId, uniqueSafetyId, cleanupFlatDir, readExistingFile,
});
const {
  listCanvases, getCanvas, saveCanvas, deleteCanvas,
  listDeletedCanvases, restoreDeletedCanvas, purgeDeletedCanvas,
} = canvasRepository;

const backupRepository = createBackupRepository({
  fsp, processRef: process, loadConfig, saveConfig, loadVault, listCanvases, getCanvas,
  readJsonSafe, vaultMetaFile, validateEntityId, backupFormat: BACKUP_FORMAT,
  appName: APP_DIR_NAME, maxImportBytes: MAX_BACKUP_IMPORT_BYTES,
  isPlainObject, assertArrayLimit,
  limits: {
    vaults: MAX_BACKUP_VAULTS,
    notes: MAX_BACKUP_NOTES_PER_VAULT,
    canvases: MAX_BACKUP_CANVASES_PER_VAULT,
  },
  cleanString, allocateVaultSlug, vaultDir, ensureDir, sanitizeVaultMetaPatch,
  writeJson, uniqueImportedEntityId, validateNoteId, assertByteLength,
  maxNoteBodyBytes: MAX_NOTE_BODY_BYTES, serializeFrontMatter, normalizeTagName,
  atomicWriteFile, noteFile, normalizeCanvas, validateCanvasId,
  maxCanvasBytes: MAX_CANVAS_JSON_BYTES, canvasDir, canvasFile,
  retryRename, vaultsWithMeta,
});
const { exportBackup, importBackup } = backupRepository;

const vaultMetadataRepository = createVaultMetadataRepository({
  loadConfig, validateEntityId, readJsonSafe, vaultMetaFile, sanitizeVaultMetaPatch,
  writeJson, loadVault, listCanvases, extractWikiTargets,
});
const { saveVaultMeta, vaultHealth } = vaultMetadataRepository;

// ── Prefs ───────────────────────────────────────────────────────────────────

const preferencesRepository = createPreferencesRepository({
  loadConfig, saveConfig, themes, featureUsage, isPlainObject, cleanMergePatch,
  preferenceKeys: STORE_PREF_TWEAK_KEYS,
  aiConfigKeys: STORE_AI_CONFIG_KEYS,
  assertByteLength,
  maxJsonWriteBytes: MAX_JSON_WRITE_BYTES,
  sanitizePhase5Metrics,
  normalizeEnabledPacks,
  validateEntityId,
  recordPhase5Metric,
});
const {
  getPrefs, setPrefs, installCustomTheme, importThemeFile,
  featureUsageStatus, recordFeatureUsage, clearFeatureUsage,
  getFeatureUsageData, setFeatureUsageData,
} = preferencesRepository;

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
