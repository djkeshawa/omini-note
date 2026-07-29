const ERROR_CODES = Object.freeze({
  conflict: 'NOTE_CONFLICT',
  validation: 'VALIDATION_ERROR',
  notFound: 'NOT_FOUND',
  io: 'IO_ERROR',
  permission: 'PERMISSION_ERROR',
  internal: 'INTERNAL_ERROR',
});

function categorizeError(error) {
  const message = String(error?.message || error || '');
  if (error?.code === ERROR_CODES.conflict) return ERROR_CODES.conflict;
  if (error?.code === 'ENOENT' || /not found|missing/i.test(message)) return ERROR_CODES.notFound;
  if (error?.code === 'EACCES' || error?.code === 'EPERM' || /permission|outside|unsafe|symlink/i.test(message)) return ERROR_CODES.permission;
  if (error?.code === 'VALIDATION_ERROR' || /invalid|required|too (?:long|large)/i.test(message)) {
    return ERROR_CODES.validation;
  }
  if (error?.code && /^E[A-Z]+/.test(error.code)) return ERROR_CODES.io;
  return ERROR_CODES.internal;
}

function safeMessage(error, fallback = 'Operation failed') {
  const message = String(error?.message || error || fallback);
  if (!message) return fallback;
  return message
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\/[^\s]+/g, '[path]')
    .slice(0, 300);
}

function normalizeIpcError(error, details = {}) {
  const errorDetails = error?.code === ERROR_CODES.conflict
    ? {
        currentRevision: error.currentRevision ?? null,
        expectedRevision: error.expectedRevision ?? null,
        currentModifiedAt: error.currentModifiedAt ?? null,
        expectedModifiedAt: error.expectedModifiedAt ?? null,
      }
    : {};
  return {
    ok: false,
    error: {
      code: categorizeError(error),
      message: safeMessage(error),
      details: sanitizeDetails({ ...details, ...errorDetails }),
    },
  };
}

function sanitizeDetails(details) {
  const allowed = new Set([
    'channel',
    'currentRevision',
    'expectedRevision',
    'currentModifiedAt',
    'expectedModifiedAt',
  ]);
  const clean = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (!allowed.has(key)) continue;
    if (value == null) {
      if (key === 'currentRevision' || key === 'expectedRevision') clean[key] = null;
      continue;
    }
    if ((key === 'currentRevision' || key === 'expectedRevision') && !/^[a-f0-9]{64}$/i.test(String(value))) {
      continue;
    }
    clean[key] = String(value).replace(/[\\/][^\s]+/g, '[path]').slice(0, 120);
  }
  return clean;
}

function ok(data = {}) {
  return { ok: true, data };
}

module.exports = {
  ERROR_CODES,
  normalizeIpcError,
  ok,
  safeMessage,
};
