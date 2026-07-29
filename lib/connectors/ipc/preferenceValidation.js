const PREF_TOP_LEVEL_KEYS = new Set([
  'activeVaultId',
  'tweaks',
  'aiConfig',
  'smartViews',
  'enabledPacks',
  'localUsageMetrics',
  'anonymousUsageSharing',
]);
const FEATURE_PACK_IDS = new Set(['planning', 'canvas', 'research', 'writer', 'agents', 'labs', 'views']);
const PREF_TWEAK_DEFAULTS = {
  theme: 'light',
  density: 'comfortable',
  graphStyle: 'force',
  todoVariant: 'list',
  toastVariant: 'card',
  fontChoice: 'Editorial (Newsreader + Inter)',
  showNoteList: true,
  showSidebar: true,
  editorWidth: 'medium',
  fontSize: 'default',
  appFontSize: 'default',
  indentGuides: true,
  spellCheck: true,
  autoLink: true,
  collapseByDefault: false,
  sortBy: 'modified',
  defaultTags: '',
  pinnedFirst: true,
  onboardingTipsDismissed: '',
  startupView: 'notes',
  rollupFormat: 'long',
  rollupDefaultRange: 'today',
  rollupGroupBy: 'created',
  rollupShowPreviews: true,
  rollupShowTasks: true,
  rollupShowReminders: true,
  rollupCollapseOlder: true,
  reminderSound: false,
  showOverdue: true,
  snoozeMinutes: '15',
  weekStart: 'monday',
  workflowStates: null,
  plugins: null,
  autoSave: true,
  storageFormat: 'markdown',
  sync: 'local',
};
const PREF_TWEAK_KEYS = new Set(Object.keys(PREF_TWEAK_DEFAULTS));
const PREF_STRING_LIMIT = 500;
const PREF_SECRET_LIMIT = 4096;
const AI_QUERY_LIMIT = 20000;
const AI_EDIT_TEXT_LIMIT = 120000;
const AI_MESSAGE_TEXT_LIMIT = 20000;
const AI_MAX_TOKENS_LIMIT = 8192;
const AI_TOOL_LIMIT = 100;
const AI_TOOL_SCHEMA_LIMIT = 30000;
const BACKUP_IMPORT_FILE_LIMIT = 50 * 1024 * 1024;
const NOVEL_IMPORT_FILE_LIMIT = 8;
const NOVEL_IMPORT_FILE_BYTES_LIMIT = 750 * 1024;
const NOVEL_IMPORT_TOTAL_TEXT_BYTES_LIMIT = 2 * 1024 * 1024;
const IPC_ID_RE = /^[A-Za-z0-9_-]+$/;
const AI_TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
// SMART_VIEW_FORMATS is the set accepted on the way in; SMART_VIEW_FORMAT is
// what gets written back. The renderer moved to v2 (layout, group, columns)
// and this file did not move with it, which rejected every smartViews patch
// at the IPC boundary — including the boot-time seeding of defaults.
const SMART_VIEW_FORMAT = 'vispnote.smartView.v2';
const SMART_VIEW_FORMATS = new Set(['vispnote.smartView.v1', 'vispnote.smartView.v2']);
const SMART_VIEW_LAYOUTS = new Set(['list', 'table', 'cards', 'timeline', 'board', 'calendar']);
const SMART_VIEW_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const SMART_VIEW_TYPES = new Set(['notes', 'tasks', 'reminders', 'actions']);
const SMART_VIEW_FILTER_KEYS = new Set([
  'title',
  'titleContains',
  'tag',
  'tags',
  'createdFrom',
  'createdTo',
  'createdAfter',
  'createdBefore',
  'modifiedFrom',
  'modifiedTo',
  'modifiedAfter',
  'modifiedBefore',
  'property',
  'properties',
  'propertyKey',
  'propertyValue',
  'workflowStatus',
  'workflowStatuses',
  'linkedNote',
  'linkedNotes',
  'actionStatus',
  'actionStatuses',
  'taskStatus',
  'actionType',
  'actionTypes',
  'reminderFrom',
  'reminderTo',
  'remindFrom',
  'remindTo',
  'dueFrom',
  'dueTo',
]);
const SMART_VIEW_DATE_FILTER_KEYS = new Set([
  'createdFrom',
  'createdTo',
  'createdAfter',
  'createdBefore',
  'modifiedFrom',
  'modifiedTo',
  'modifiedAfter',
  'modifiedBefore',
  'reminderFrom',
  'reminderTo',
  'remindFrom',
  'remindTo',
  'dueFrom',
  'dueTo',
]);
const SMART_VIEW_SORT_FIELDS = new Set(['title', 'created', 'modified', 'reminder']);
const SMART_VIEW_SORT_DIRECTIONS = new Set(['asc', 'desc']);

function normalizeSpellWord(word) {
  return String(word || '').toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isUnsafePatchKey(key) {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function capString(value, field, maxLength = PREF_STRING_LIMIT) {
  const clean = String(value || '').replace(/\0/g, '').trim();
  if (clean.length > maxLength) throw new Error(`${field} is too long`);
  return clean;
}

function capText(value, field, maxLength) {
  const clean = String(value || '').replace(/\0/g, '');
  if (clean.length > maxLength) throw new Error(`${field} is too long`);
  return clean;
}

function sanitizeWorkflowStatesForPrefs(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid workflowStates preference');
  return value.map((state, index) => {
    if (!isPlainObject(state)) throw new Error('Invalid workflowStates preference');
    return {
      id: capString(state.id, `workflowStates[${index}].id`, 40),
      next: state.next == null ? null : capString(state.next, `workflowStates[${index}].next`, 40),
      color: capString(state.color, `workflowStates[${index}].color`, 120),
      bg: capString(state.bg, `workflowStates[${index}].bg`, 120),
    };
  });
}

function sanitizePluginIdForPrefs(value, index) {
  const clean = capString(value, `plugins[${index}].id`, 80)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return clean || `plugin-${index + 1}`;
}

function sanitizePluginsForPrefs(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid plugins preference');
  return value.map((plugin, index) => {
    if (!isPlainObject(plugin)) throw new Error('Invalid plugin preference');
    const config = isPlainObject(plugin.config) ? plugin.config : {};
    const type = capString(plugin.type, `plugins[${index}].type`, 40);
    if (!['note-template', 'quick-capture', 'open-url', 'zotero-reader', 'llm-memory'].includes(type)) throw new Error('Invalid plugin type');
    return {
      id: sanitizePluginIdForPrefs(plugin.id, index),
      name: capString(plugin.name, `plugins[${index}].name`, 80),
      purpose: capString(plugin.purpose, `plugins[${index}].purpose`, 180),
      type,
      enabled: plugin.enabled !== false,
      config: {
        title: capString(config.title, `plugins[${index}].config.title`, 160),
        body: capString(config.body, `plugins[${index}].config.body`, 4000),
        tags: capString(config.tags, `plugins[${index}].config.tags`, 240),
        url: capString(config.url, `plugins[${index}].config.url`, 500),
        serverUrl: capString(config.serverUrl, `plugins[${index}].config.serverUrl`, 500),
        repoId: capString(config.repoId, `plugins[${index}].config.repoId`, 120),
        apiKey: capString(config.apiKey, `plugins[${index}].config.apiKey`, 300),
      },
    };
  });
}

function sanitizeTweaksForPrefs(tweaks) {
  if (!isPlainObject(tweaks)) throw new Error('Invalid tweaks patch');
  const clean = {};
  for (const [key, value] of Object.entries(tweaks)) {
    if (isUnsafePatchKey(key)) throw new Error('Unsupported tweak field: ' + key);
    if (!PREF_TWEAK_KEYS.has(key)) throw new Error('Unsupported tweak field: ' + key);
    const defaultValue = PREF_TWEAK_DEFAULTS[key];
    if (key === 'workflowStates') {
      clean.workflowStates = sanitizeWorkflowStatesForPrefs(value);
    } else if (key === 'plugins') {
      clean.plugins = sanitizePluginsForPrefs(value);
    } else if (typeof defaultValue === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('Invalid tweak field: ' + key);
      clean[key] = value;
    } else if (typeof defaultValue === 'string') {
      clean[key] = capString(value, key);
    }
  }
  return clean;
}

function sanitizeAiConfigForPrefs(aiConfig) {
  if (!isPlainObject(aiConfig)) throw new Error('Invalid AI config patch');
  const clean = {};
  for (const [key, value] of Object.entries(aiConfig)) {
    if (isUnsafePatchKey(key)) throw new Error('Invalid AI config field: ' + key);
    if (typeof value === 'string') clean[key] = capString(value, key, PREF_SECRET_LIMIT);
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) clean[key] = value;
    else throw new Error('Invalid AI config field: ' + key);
  }
  return clean;
}

function sanitizeSmartViewJsonValue(value, field, depth = 0) {
  if (depth > 3) throw new Error(`${field} is too deeply nested`);
  if (typeof value === 'string') return capString(value, field, 500);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field}`);
    return value;
  }
  if (typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) {
    if (value.length > 40) throw new Error(`${field} has too many items`);
    return value.map((item, index) => sanitizeSmartViewJsonValue(item, `${field}[${index}]`, depth + 1));
  }
  if (!isPlainObject(value)) throw new Error(`Invalid ${field}`);
  const clean = {};
  const entries = Object.entries(value);
  if (entries.length > 40) throw new Error(`${field} has too many fields`);
  for (const [key, item] of entries) {
    if (isUnsafePatchKey(key)) throw new Error(`Unsupported ${field} field: ${key}`);
    const cleanKey = capString(key, `${field} key`, 80);
    clean[cleanKey] = sanitizeSmartViewJsonValue(item, `${field}.${cleanKey}`, depth + 1);
  }
  return clean;
}

function sanitizeSmartViewFiltersForPrefs(filters, index) {
  if (filters == null) return {};
  if (!isPlainObject(filters)) throw new Error(`Invalid Smart View filters at ${index}`);
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    if (isUnsafePatchKey(key)) throw new Error('Unsupported Smart View filter field: ' + key);
    if (!SMART_VIEW_FILTER_KEYS.has(key)) throw new Error('Unsupported Smart View filter field: ' + key);
    const next = sanitizeSmartViewJsonValue(value, `smartViews[${index}].filters.${key}`);
    if (SMART_VIEW_DATE_FILTER_KEYS.has(key) && next && !/^\d{4}-\d{2}-\d{2}$/.test(String(next))) {
      throw new Error('Invalid Smart View date filter: ' + key);
    }
    clean[key] = next;
  }
  return clean;
}

function sanitizeSmartViewSortForPrefs(sort, index) {
  if (sort == null) return {};
  if (!isPlainObject(sort)) throw new Error(`Invalid Smart View sort at ${index}`);
  const clean = {};
  for (const [key, value] of Object.entries(sort)) {
    if (isUnsafePatchKey(key)) throw new Error('Unsupported Smart View sort field: ' + key);
    if (!['field', 'direction'].includes(key)) throw new Error('Unsupported Smart View sort field: ' + key);
    clean[key] = capString(value, `smartViews[${index}].sort.${key}`, 40);
  }
  if (clean.field && !SMART_VIEW_SORT_FIELDS.has(clean.field)) throw new Error('Invalid Smart View sort field');
  if (clean.direction && !SMART_VIEW_SORT_DIRECTIONS.has(clean.direction)) throw new Error('Invalid Smart View sort direction');
  return clean;
}

// The v2 fields, mirroring the renderer's normalizers in smartViewHelpers.js:
// layout is one of a fixed set, group is {by, direction} or null, and columns
// are pinned property keys — discovered from notes, so only length-capped.
function sanitizeSmartViewLayoutForPrefs(value, index) {
  if (value == null) return undefined;
  const layout = capString(value, `smartViews[${index}].layout`, 20).toLowerCase();
  if (!SMART_VIEW_LAYOUTS.has(layout)) throw new Error('Invalid Smart View layout');
  return layout;
}

function sanitizeSmartViewGroupForPrefs(value, index) {
  if (value == null) return undefined;
  if (!isPlainObject(value)) throw new Error('Invalid Smart View group');
  for (const key of Object.keys(value)) {
    if (isUnsafePatchKey(key)) throw new Error('Unsupported Smart View group field: ' + key);
    if (!['by', 'direction'].includes(key)) throw new Error('Unsupported Smart View group field: ' + key);
  }
  const by = capString(value.by, `smartViews[${index}].group.by`, 40);
  if (!by) return undefined;
  const direction = value.direction == null ? 'asc' : capString(value.direction, `smartViews[${index}].group.direction`, 4).toLowerCase();
  if (!['asc', 'desc'].includes(direction)) throw new Error('Invalid Smart View group direction');
  return { by, direction };
}

function sanitizeSmartViewColumnsForPrefs(value, index) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 12) throw new Error('Invalid Smart View columns');
  const clean = [...new Set(value.map((item, col) => capString(item, `smartViews[${index}].columns[${col}]`, 40)).filter(Boolean))];
  return clean.length ? clean : undefined;
}

function sanitizeSmartViewsForPrefs(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 24) throw new Error('Invalid Smart Views preference');
  const seen = new Set();
  return value.map((definition, index) => {
    if (!isPlainObject(definition)) throw new Error(`Invalid Smart View definition at ${index}`);
    Object.keys(definition).forEach(key => {
      if (isUnsafePatchKey(key)) throw new Error('Unsupported Smart View field: ' + key);
      if (!['format', 'id', 'title', 'type', 'filters', 'sort', 'limit', 'layout', 'group', 'columns'].includes(key)) throw new Error('Unsupported Smart View field: ' + key);
    });
    if (definition.format && !SMART_VIEW_FORMATS.has(definition.format)) throw new Error('Unsupported Smart View format');
    const id = capString(definition.id, `smartViews[${index}].id`, 64);
    if (!SMART_VIEW_ID_RE.test(id)) throw new Error('Invalid Smart View id');
    if (seen.has(id)) throw new Error('Duplicate Smart View id');
    seen.add(id);
    const title = capString(definition.title, `smartViews[${index}].title`, 120);
    if (!title) throw new Error('Smart View title is required');
    const type = definition.type == null ? 'notes' : capString(definition.type, `smartViews[${index}].type`, 20);
    if (!SMART_VIEW_TYPES.has(type)) throw new Error('Invalid Smart View type');
    const limit = definition.limit == null ? undefined : Number(definition.limit);
    if (limit != null && (!Number.isFinite(limit) || limit < 1 || limit > 500)) throw new Error('Invalid Smart View limit');
    return {
      format: SMART_VIEW_FORMAT,
      id,
      title,
      type,
      filters: sanitizeSmartViewFiltersForPrefs(definition.filters, index),
      sort: sanitizeSmartViewSortForPrefs(definition.sort, index),
      limit,
      layout: sanitizeSmartViewLayoutForPrefs(definition.layout, index),
      group: sanitizeSmartViewGroupForPrefs(definition.group, index),
      columns: sanitizeSmartViewColumnsForPrefs(definition.columns, index),
    };
  });
}

function sanitizePrefsPatchFromIpc(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid preferences patch');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (isUnsafePatchKey(key)) throw new Error('Unsupported preferences field: ' + key);
    if (!PREF_TOP_LEVEL_KEYS.has(key)) throw new Error('Unsupported preferences field: ' + key);
    if (key === 'activeVaultId') clean.activeVaultId = capString(value, 'activeVaultId', 120);
    if (key === 'tweaks') clean.tweaks = sanitizeTweaksForPrefs(value);
    if (key === 'aiConfig') clean.aiConfig = sanitizeAiConfigForPrefs(value);
    if (key === 'smartViews') clean.smartViews = sanitizeSmartViewsForPrefs(value);
    if (key === 'enabledPacks') clean.enabledPacks = sanitizeEnabledPacksForPrefs(value);
    if (key === 'localUsageMetrics' || key === 'anonymousUsageSharing') {
      if (typeof value !== 'boolean') throw new Error(`Invalid ${key} preference`);
      clean[key] = value;
    }
  }
  return clean;
}

function sanitizeEnabledPacksForPrefs(value) {
  if (!Array.isArray(value) || value.length > FEATURE_PACK_IDS.size) {
    throw new Error('Invalid enabled packs preference');
  }
  return [...new Set(value.map(item => capString(item, 'enabledPacks', 40)))]
    .filter(packId => FEATURE_PACK_IDS.has(packId));
}


module.exports = {
  normalizeSpellWord,
  isPlainObject,
  capString,
  capText,
  sanitizePrefsPatchFromIpc,
  AI_QUERY_LIMIT,
  AI_EDIT_TEXT_LIMIT,
  AI_MESSAGE_TEXT_LIMIT,
  AI_MAX_TOKENS_LIMIT,
  AI_TOOL_LIMIT,
  AI_TOOL_SCHEMA_LIMIT,
  BACKUP_IMPORT_FILE_LIMIT,
  NOVEL_IMPORT_FILE_LIMIT,
  NOVEL_IMPORT_FILE_BYTES_LIMIT,
  NOVEL_IMPORT_TOTAL_TEXT_BYTES_LIMIT,
  IPC_ID_RE,
  AI_TOOL_NAME_RE,
};
