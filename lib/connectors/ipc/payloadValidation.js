function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cappedString(value, field, limit) {
  const text = String(value || '').trim();
  if (!text || text.length > limit) throw new Error(`Invalid ${field}`);
  return text;
}

function optionalCappedString(value, field, limit) {
  const text = String(value || '').trim();
  if (text.length > limit) throw new Error(`Invalid ${field}`);
  return text;
}

function sanitizeAttachmentPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid attachment payload');
  const bytes = payload.bytes;
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error('Invalid attachment payload');
  const name = optionalCappedString(payload.name, 'attachment name', 240);
  const mimeType = optionalCappedString(payload.mimeType, 'attachment type', 100);
  if (!name && !mimeType) throw new Error('Invalid attachment payload');
  return {
    name,
    mimeType,
    bytes,
  };
}

function sanitizeZoteroSearchPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid Zotero search request');
  return {
    query: cappedString(payload.query, 'query', 300),
    limit: Math.max(1, Math.min(20, Math.trunc(Number(payload.limit) || 8))),
  };
}

function sanitizeZoteroListPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid Zotero list request');
  return { limit: Math.max(1, Math.min(20, Math.trunc(Number(payload.limit) || 20))) };
}

function sanitizeZoteroReadPayload(payload = {}) {
  if (!isPlainObject(payload)) throw new Error('Invalid Zotero read request');
  const itemKey = cappedString(payload.itemKey || payload.key, 'itemKey', 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(itemKey)) throw new Error('Invalid Zotero item key');
  return { itemKey, includeFullText: payload.includeFullText !== false };
}

module.exports = {
  sanitizeAttachmentPayload,
  sanitizeZoteroSearchPayload,
  sanitizeZoteroListPayload,
  sanitizeZoteroReadPayload,
};
