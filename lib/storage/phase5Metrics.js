const FORMAT = 'vispnote.phase5Metrics.v1';
const KEYS = new Set(['capture_saves', 'zotero_source_notes', 'theme_installs', 'onboarding_mode_selections']);
const DETAIL_KEYS = new Set(['destinationId', 'templateId', 'mode', 'themeId', 'onboardingMode']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeKey(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return KEYS.has(key) ? key : '';
}

function cleanDetailValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  return String(value ?? '').replace(/\0/g, '').trim().slice(0, 120)
    .replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 120);
}

function sanitizeDetails(details = {}) {
  if (!isPlainObject(details)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(details)) {
    if (UNSAFE_KEYS.has(key) || !DETAIL_KEYS.has(key)) continue;
    const cleaned = cleanDetailValue(value);
    if (cleaned !== '' && cleaned != null) clean[key] = cleaned;
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
    if (UNSAFE_KEYS.has(key) || !KEYS.has(key)) {
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
  const events = (Array.isArray(raw.events) ? raw.events : []).map(event => {
    if (!isPlainObject(event)) return null;
    const key = normalizeKey(event.key);
    if (!key) {
      if (options.rejectUnknown) throw new Error('Unsupported Phase 5 metric key: ' + String(event.key || ''));
      return null;
    }
    const eventTime = event.at ? new Date(event.at) : null;
    if (!eventTime || !Number.isFinite(eventTime.getTime())) {
      if (options.rejectUnknown) throw new Error('Invalid Phase 5 metric timestamp');
      return null;
    }
    return { key, at: eventTime.toISOString(), details: sanitizeDetails(event.details) };
  }).filter(Boolean).slice(-100);
  const updatedTime = raw.updatedAt ? new Date(raw.updatedAt) : null;
  return { format: FORMAT, counters, events, updatedAt: updatedTime && Number.isFinite(updatedTime.getTime()) ? updatedTime.toISOString() : null };
}

function recordPhase5Metric(metrics, key, details = {}, options = {}) {
  const metricKey = normalizeKey(key);
  if (!metricKey) throw new Error('Unsupported Phase 5 metric key: ' + String(key || ''));
  const now = options.now ? new Date(options.now) : new Date();
  const at = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  const current = sanitizePhase5Metrics(metrics) || { format: FORMAT, counters: {}, events: [], updatedAt: null };
  return {
    format: FORMAT,
    counters: { ...current.counters, [metricKey]: (current.counters[metricKey] || 0) + 1 },
    events: [...current.events, { key: metricKey, at, details: sanitizeDetails(details) }].slice(-100),
    updatedAt: at,
  };
}

module.exports = { sanitizePhase5Metrics, recordPhase5Metric };
