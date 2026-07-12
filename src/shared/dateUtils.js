const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function dateKeyFromParts(year, month, day) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function isValidDateKey(value = '') {
  const match = String(value || '').trim().match(DATE_KEY_RE);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function localDateKey(value = new Date()) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (isValidDateKey(raw)) return raw;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return dateKeyFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function shiftDateKey(value, days) {
  const key = String(value || '').trim();
  if (!isValidDateKey(key)) return '';
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + (Number(days) || 0));
  return dateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

module.exports = { isValidDateKey, localDateKey, shiftDateKey };
