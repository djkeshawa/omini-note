const { randomUUID } = require('crypto');

const FORMAT = 'vispnote.featureUsage.v1';
const FEATURE_KEYS = new Set([
  'first_note',
  'capture',
  'daily_note',
  'today',
  'connections',
  'search',
  'ask_ai',
  'canvas',
  'graph',
  'smart_views',
  'views',
  'planning',
  'writer',
  'research',
  'agents',
  'themes',
  'legacy_plugins',
  'reference_pane',
]);
const ACTION_KEYS = new Set([
  'exposed', 'opened', 'used', 'enabled', 'disabled', 'exported', 'shared',
  'created', 'completed', 'result_opened',
]);
const MAX_COUNT = 999999;
const MAX_DAYS = 90;

function safeDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function isoDay(value) {
  const date = safeDate(value) || new Date();
  return date.toISOString().slice(0, 10);
}

function normalizeFeatureKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return FEATURE_KEYS.has(key) ? key : '';
}

function normalizeActionKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return ACTION_KEYS.has(key) ? key : '';
}

function sanitizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(MAX_COUNT, Math.floor(number)) : 0;
}

function sanitizeFeatureUsage(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const counters = {};
  const activeDays = {};
  const firstUsedAt = {};
  const lastUsedAt = {};
  for (const feature of FEATURE_KEYS) {
    const rawActions = source.counters?.[feature];
    if (rawActions && typeof rawActions === 'object' && !Array.isArray(rawActions)) {
      const actions = {};
      for (const action of ACTION_KEYS) {
        const count = sanitizeCount(rawActions[action]);
        if (count) actions[action] = count;
      }
      if (Object.keys(actions).length) counters[feature] = actions;
    }
    const days = Array.isArray(source.activeDays?.[feature])
      ? [...new Set(source.activeDays[feature]
        .map(day => /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : '')
        .filter(Boolean))].sort().slice(-MAX_DAYS)
      : [];
    if (days.length) activeDays[feature] = days;
    const first = safeDate(source.firstUsedAt?.[feature]);
    const last = safeDate(source.lastUsedAt?.[feature]);
    if (first) firstUsedAt[feature] = first.toISOString();
    if (last) lastUsedAt[feature] = last.toISOString();
  }
  const updatedAt = safeDate(source.updatedAt);
  const uploadMonth = /^\d{4}-\d{2}$/.test(String(source.uploadIdentity?.month || ''))
    ? String(source.uploadIdentity.month)
    : '';
  const uploadId = /^[A-Za-z0-9_-]{8,80}$/.test(String(source.uploadIdentity?.id || ''))
    ? String(source.uploadIdentity.id)
    : '';
  const lastUploadedAt = safeDate(source.lastUploadedAt);
  return {
    format: FORMAT,
    counters,
    activeDays,
    firstUsedAt,
    lastUsedAt,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    uploadIdentity: uploadMonth && uploadId ? { month: uploadMonth, id: uploadId } : null,
    lastUploadedAt: lastUploadedAt ? lastUploadedAt.toISOString() : null,
  };
}

function recordFeatureUsage(raw, featureValue, actionValue = 'used', options = {}) {
  const feature = normalizeFeatureKey(featureValue);
  const action = normalizeActionKey(actionValue);
  if (!feature || !action) throw new Error('Unsupported feature usage event');
  const now = safeDate(options.now) || new Date();
  const at = now.toISOString();
  const day = isoDay(now);
  const current = sanitizeFeatureUsage(raw);
  if (feature === 'first_note' && action === 'created' && current.counters.first_note?.created) return current;
  const days = [...new Set([...(current.activeDays[feature] || []), day])].sort().slice(-MAX_DAYS);
  return {
    ...current,
    counters: {
      ...current.counters,
      [feature]: {
        ...(current.counters[feature] || {}),
        [action]: Math.min(MAX_COUNT, (current.counters[feature]?.[action] || 0) + 1),
      },
    },
    activeDays: { ...current.activeDays, [feature]: days },
    firstUsedAt: { ...current.firstUsedAt, [feature]: current.firstUsedAt[feature] || at },
    lastUsedAt: { ...current.lastUsedAt, [feature]: at },
    updatedAt: at,
  };
}

function rotateUploadIdentity(raw, options = {}) {
  const now = safeDate(options.now) || new Date();
  const month = now.toISOString().slice(0, 7);
  const current = sanitizeFeatureUsage(raw);
  if (current.uploadIdentity?.month === month) return current;
  return {
    ...current,
    uploadIdentity: {
      month,
      id: String(options.id || randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80),
    },
  };
}

function anonymousSummary(raw, options = {}) {
  const current = rotateUploadIdentity(raw, options);
  const features = {};
  for (const feature of FEATURE_KEYS) {
    const actions = current.counters[feature];
    const repeatDays = current.activeDays[feature]?.length || 0;
    if (actions || repeatDays) features[feature] = { actions: actions || {}, repeatDays };
  }
  return {
    format: FORMAT,
    monthId: current.uploadIdentity.id,
    month: current.uploadIdentity.month,
    appVersion: String(options.appVersion || '').slice(0, 40),
    os: String(options.os || '').slice(0, 24),
    features,
  };
}

function publicReport(raw, options = {}) {
  const current = sanitizeFeatureUsage(raw);
  return {
    format: FORMAT,
    generatedAt: (safeDate(options.now) || new Date()).toISOString(),
    appVersion: String(options.appVersion || '').slice(0, 40),
    counters: current.counters,
    activeDays: current.activeDays,
    firstUsedAt: current.firstUsedAt,
    lastUsedAt: current.lastUsedAt,
    updatedAt: current.updatedAt,
  };
}

module.exports = {
  FORMAT,
  FEATURE_KEYS,
  ACTION_KEYS,
  normalizeFeatureKey,
  normalizeActionKey,
  sanitizeFeatureUsage,
  recordFeatureUsage,
  rotateUploadIdentity,
  anonymousSummary,
  publicReport,
};
