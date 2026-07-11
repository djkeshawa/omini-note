const PHASE5_METRICS_STORAGE_KEY = 'mn_phase5_metrics_v1';

function normalizeCustomThemes(themes = []) {
  if (!Array.isArray(themes)) return [];
  return themes.filter(theme => theme && typeof theme.id === 'string' && typeof theme.name === 'string' && theme.tokens && typeof theme.tokens === 'object')
    .map(theme => ({ id: theme.id, name: theme.name, tokens: theme.tokens }));
}

function themeOptions(baseThemes, customThemes) {
  const labels = { light: 'Light', dark: 'Dark', pastel: 'Pastel' };
  const builtIns = Object.entries(labels).filter(([id]) => !!baseThemes[id]).map(([value, label]) => ({ value, label }));
  return [...builtIns, ...normalizeCustomThemes(customThemes).map(theme => ({ value: theme.id, label: theme.name }))];
}

function normalizeStartupView(value) { return value === 'today' ? 'today' : 'notes'; }

function normalizeOnboardingMode(value) {
  const clean = String(value || '').trim().toLowerCase();
  return ['general', 'daily', 'researcher', 'writer'].includes(clean) ? clean : '';
}

function readLocalPhase5Metrics() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try { return JSON.parse(window.localStorage.getItem(PHASE5_METRICS_STORAGE_KEY) || 'null'); } catch { return null; }
}

function writeLocalPhase5Metrics(metrics) {
  if (typeof window === 'undefined' || !window.localStorage || !metrics) return;
  try { window.localStorage.setItem(PHASE5_METRICS_STORAGE_KEY, JSON.stringify(metrics)); } catch {}
}

function buildDefaultSmartViewDefinitions(helpers = {}) {
  const today = helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10);
  const format = helpers.SMART_VIEW_FORMAT || 'vispnote.smartView.v1';
  return [
    { format, id: 'recent_notes', title: 'Recent notes', type: 'notes', filters: {}, sort: { field: 'modified', direction: 'desc' }, limit: 60 },
    { format, id: 'open_tasks', title: 'Open tasks', type: 'tasks', filters: { actionStatus: 'open' }, sort: { field: 'reminder', direction: 'asc' }, limit: 80 },
    { format, id: 'deferred_tasks', title: 'Deferred tasks', type: 'tasks', filters: { actionStatus: 'deferred' }, sort: { field: 'reminder', direction: 'asc' }, limit: 80 },
    { format, id: 'due_reminders', title: 'Due reminders', type: 'reminders', filters: { reminderFrom: '1970-01-01', reminderTo: today }, sort: { field: 'reminder', direction: 'asc' }, limit: 80 },
  ];
}

function normalizeSmartViews(value, helpers = {}) {
  const defaults = buildDefaultSmartViewDefinitions(helpers);
  if (!Array.isArray(value)) return defaults;
  const clean = [];
  for (const definition of value.slice(0, 24)) {
    try {
      const next = helpers.smartViewValidateSavedDefinition ? helpers.smartViewValidateSavedDefinition(definition) : definition;
      if (next?.id && next?.title) clean.push(next);
    } catch {}
  }
  return clean.length ? clean : defaults;
}

export {
  PHASE5_METRICS_STORAGE_KEY, normalizeCustomThemes, themeOptions, normalizeStartupView,
  normalizeOnboardingMode, readLocalPhase5Metrics, writeLocalPhase5Metrics,
  buildDefaultSmartViewDefinitions, normalizeSmartViews,
};
