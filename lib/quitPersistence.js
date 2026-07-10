function asNonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function normalizeFailure(value) {
  if (!value) return null;
  if (typeof value === 'string') return { kind: 'unknown', message: value };
  if (typeof value !== 'object') return { kind: 'unknown', message: String(value) };
  return {
    kind: String(value.kind || 'unknown').slice(0, 40),
    id: value.id == null ? null : String(value.id).slice(0, 120),
    code: value.code == null ? null : String(value.code).slice(0, 80),
    message: String(value.message || value.error || 'Save failed').slice(0, 500),
  };
}

function classifyFlushResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, dirtyRemaining: 0, metaDirty: false, failures: [], error: 'No save result was returned.' };
  }
  if (result.skipped === true) {
    return { ok: true, skipped: true, dirtyRemaining: 0, metaDirty: false, failures: [], error: null };
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  const dirtyRemaining = asNonNegativeInt(value.dirtyRemaining);
  const metaDirty = value.metaDirty === true;
  const failures = (Array.isArray(value.failures) ? value.failures : []).map(normalizeFailure).filter(Boolean);
  const error = result.ok === false
    ? String(result.error || value.error || 'Could not save all changes before quitting.').slice(0, 500)
    : (value.ok === false ? String(value.error || 'Could not save all changes before quitting.').slice(0, 500) : null);
  return {
    ok: result.ok !== false && value.ok !== false && dirtyRemaining === 0 && !metaDirty && failures.length === 0,
    dirtyRemaining,
    metaDirty,
    failures,
    error,
  };
}

function flushFailureDetail(status) {
  const parts = [];
  if (status?.dirtyRemaining) parts.push(`${status.dirtyRemaining} note${status.dirtyRemaining === 1 ? '' : 's'} still unsaved`);
  if (status?.metaDirty) parts.push('vault settings still unsaved');
  if (status?.failures?.length) parts.push(`${status.failures.length} save operation${status.failures.length === 1 ? '' : 's'} failed`);
  if (!parts.length && status?.error) parts.push(status.error);
  return parts.length ? `${parts.join('; ')}. Resolve the problem and quit again.` : 'Resolve the save problem and quit again.';
}

module.exports = { classifyFlushResult, flushFailureDetail };
