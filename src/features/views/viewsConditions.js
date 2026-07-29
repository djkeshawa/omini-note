// Conditions: which rows survive, once scope has picked the notes.
//
// A condition is a property key, an operator, and what to compare against —
// stored in `filters.properties`, which the query engine already read. What is
// new is the operator: before this, a property filter could only ask "is", so
// there was no way to say "is not", "contains", or "has no value at all".
//
// Two limits are the reason this is a module and not inline JSX. The saved
// filters are sanitized twice, once in the renderer and once at the IPC
// boundary, and both keep an allowlist of filter keys. A condition that does
// not fit either list does not fail visibly — the whole save is rejected.

// Labels are the UI's, the operator ids are the engine's. A test asserts this
// map covers exactly the operators the engine accepts, so adding one there
// without a label here is caught rather than rendering a blank dropdown.
const MN_VIEW_CONDITION_OPS = [
  { op: 'is', label: 'is', needsValue: true },
  { op: 'not', label: 'is not', needsValue: true },
  { op: 'has', label: 'contains', needsValue: true },
  { op: 'lt', label: 'before / less than', needsValue: true },
  { op: 'gt', label: 'after / more than', needsValue: true },
  { op: 'filled', label: 'has any value', needsValue: false },
  { op: 'empty', label: 'is empty', needsValue: false },
];

// Well under the 40-item cap the preference sanitizer enforces on any filter
// array, because a view with twenty conditions is already unreadable.
const MN_VIEW_CONDITION_MAX = 20;
const MN_VIEW_CONDITION_VALUE_MAX = 500;

function mnViewsConditionOp(op) {
  return MN_VIEW_CONDITION_OPS.find(item => item.op === op) || MN_VIEW_CONDITION_OPS[0];
}

function mnViewsConditionNeedsValue(op) {
  return mnViewsConditionOp(op).needsValue;
}

// Reading tolerates every shape the engine accepts, including definitions
// written before operators existed, which carry a key and value and no `op`.
function mnViewsConditions(definition = {}) {
  const raw = definition?.filters?.properties;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      key: String(item.key || '').trim(),
      op: mnViewsConditionOp(String(item.op || 'is')).op,
      value: Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''),
    }))
    .filter(condition => condition.key);
}

function mnViewsConditionsMatch(definition = {}) {
  return String(definition?.filters?.propertiesMatch || '').toLowerCase() === 'any' ? 'any' : 'all';
}

// An operator that asks whether a value exists carries no value, so one is not
// stored — otherwise a stale value would sit in the file looking meaningful.
function mnViewsConditionForSave(condition) {
  const saved = { key: condition.key, op: condition.op };
  if (!mnViewsConditionNeedsValue(condition.op)) return saved;
  const values = String(condition.value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (values.length) saved.value = values;
  return saved;
}

function mnViewsWriteConditions(definition = {}, conditions, match) {
  const filters = { ...(definition.filters || {}) };
  if (conditions.length) filters.properties = conditions.map(mnViewsConditionForSave);
  else delete filters.properties;
  const nextMatch = match || mnViewsConditionsMatch(definition);
  if (conditions.length > 1 && nextMatch === 'any') filters.propertiesMatch = 'any';
  else delete filters.propertiesMatch;
  return filters;
}

function mnViewsAddCondition(definition = {}, key = '') {
  const current = mnViewsConditions(definition);
  if (current.length >= MN_VIEW_CONDITION_MAX) return { ok: false, reason: 'cap' };
  const clean = String(key || '').trim();
  if (!clean) return { ok: false, reason: 'key' };
  return { ok: true, filters: mnViewsWriteConditions(definition, current.concat([{ key: clean, op: 'is', value: '' }])) };
}

function mnViewsUpdateCondition(definition = {}, index, patch = {}) {
  const current = mnViewsConditions(definition);
  if (index < 0 || index >= current.length) return { ok: false, reason: 'missing' };
  const next = { ...current[index], ...patch };
  next.key = String(next.key || '').trim();
  if (!next.key) return { ok: false, reason: 'key' };
  if (String(next.value || '').length > MN_VIEW_CONDITION_VALUE_MAX) return { ok: false, reason: 'long' };
  next.op = mnViewsConditionOp(next.op).op;
  const list = [...current];
  list[index] = next;
  return { ok: true, filters: mnViewsWriteConditions(definition, list) };
}

function mnViewsRemoveCondition(definition = {}, index) {
  const current = mnViewsConditions(definition);
  if (index < 0 || index >= current.length) return { ok: false, reason: 'missing' };
  return { ok: true, filters: mnViewsWriteConditions(definition, current.filter((_, at) => at !== index)) };
}

function mnViewsSetConditionsMatch(definition = {}, match) {
  return { ok: true, filters: mnViewsWriteConditions(definition, mnViewsConditions(definition), match === 'any' ? 'any' : 'all') };
}

function mnViewsClearConditions(definition = {}) {
  return { ok: true, filters: mnViewsWriteConditions(definition, []) };
}

// The chip has to say whether rows are being held back, and roughly by what.
function mnViewsConditionsSummary(definition = {}) {
  const conditions = mnViewsConditions(definition);
  if (!conditions.length) return 'None';
  if (conditions.length === 1) {
    const only = conditions[0];
    const label = mnViewsConditionOp(only.op).label;
    return mnViewsConditionNeedsValue(only.op) && only.value
      ? `${only.key} ${label} ${only.value}`
      : `${only.key} ${label}`;
  }
  return `${conditions.length} ${mnViewsConditionsMatch(definition) === 'any' ? 'any' : 'all'}`;
}

export {
  MN_VIEW_CONDITION_OPS, MN_VIEW_CONDITION_MAX, MN_VIEW_CONDITION_VALUE_MAX,
  mnViewsConditions, mnViewsConditionsMatch, mnViewsConditionOp, mnViewsConditionNeedsValue,
  mnViewsAddCondition, mnViewsUpdateCondition, mnViewsRemoveCondition,
  mnViewsSetConditionsMatch, mnViewsClearConditions, mnViewsConditionsSummary,
};
