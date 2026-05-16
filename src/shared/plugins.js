// No-code plugin registry for VispNote.
// Plugins are stored in preferences as data-only actions so they stay local and safe.

const MN_PLUGIN_TYPES = [
  {
    id: 'note-template',
    label: 'Note template',
    purpose: 'Create a note from reusable text, tags, and date tokens.',
    defaultConfig: {
      title: '{{date}} note',
      body: '# {{date}}\n\n',
      tags: 'plugin',
      url: '',
    },
  },
  {
    id: 'quick-capture',
    label: 'Quick capture',
    purpose: 'Open the capture box for fast inbox entries.',
    defaultConfig: {
      title: '',
      body: '',
      tags: '',
      url: '',
    },
  },
  {
    id: 'open-url',
    label: 'Open URL',
    purpose: 'Launch a trusted HTTPS page or mail link.',
    defaultConfig: {
      title: '',
      body: '',
      tags: '',
      url: 'https://',
    },
  },
  {
    id: 'zotero-reader',
    label: 'Zotero reader',
    purpose: 'Search and read Zotero Desktop documents through the local Zotero API.',
    defaultConfig: {
      title: '',
      body: '',
      tags: '',
      url: '',
    },
  },
];

function mnPluginType(typeId) {
  return MN_PLUGIN_TYPES.find(type => type.id === typeId) || MN_PLUGIN_TYPES[0];
}

function mnPluginId() {
  return `plg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mnSafePluginText(value, fallback = '', limit = 4000) {
  const text = String(value ?? fallback).replace(/\0/g, '').trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

function mnNormalizePlugin(raw = {}) {
  const type = mnPluginType(raw.type).id;
  const meta = mnPluginType(type);
  const config = { ...meta.defaultConfig, ...(raw.config || {}) };
  return {
    id: mnSafePluginText(raw.id, mnPluginId(), 80) || mnPluginId(),
    name: mnSafePluginText(raw.name, meta.label, 80) || meta.label,
    purpose: mnSafePluginText(raw.purpose, meta.purpose, 180) || meta.purpose,
    type,
    enabled: raw.enabled !== false,
    config: {
      title: mnSafePluginText(config.title, meta.defaultConfig.title, 160),
      body: mnSafePluginText(config.body, meta.defaultConfig.body, 4000),
      tags: mnSafePluginText(config.tags, meta.defaultConfig.tags, 240),
      url: mnSafePluginText(config.url, meta.defaultConfig.url, 500),
    },
  };
}

function mnNormalizePlugins(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 30).map(mnNormalizePlugin).filter(plugin => {
    if (seen.has(plugin.id)) return false;
    seen.add(plugin.id);
    return true;
  });
}

function mnTodayParts() {
  const date = new Date();
  const iso = date.toISOString().slice(0, 10);
  return {
    date: iso,
    time: date.toTimeString().slice(0, 5),
    datetime: `${iso} ${date.toTimeString().slice(0, 5)}`,
  };
}

function mnExpandPluginTokens(text) {
  const parts = mnTodayParts();
  return String(text || '').replace(/{{\s*(date|time|datetime)\s*}}/g, (_match, key) => parts[key] || '');
}

function mnPluginTags(plugin) {
  return String(plugin?.config?.tags || '')
    .split(',')
    .map(tag => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 12);
}

function mnPluginCommandTitle(plugin) {
  const meta = mnPluginType(plugin?.type);
  return `${plugin?.name || meta.label}`;
}

window.MN_PLUGINS = Object.freeze({
  TYPES: MN_PLUGIN_TYPES,
  type: mnPluginType,
  id: mnPluginId,
  normalize: mnNormalizePlugin,
  normalizeAll: mnNormalizePlugins,
  expandTokens: mnExpandPluginTokens,
  tags: mnPluginTags,
  commandTitle: mnPluginCommandTitle,
});
