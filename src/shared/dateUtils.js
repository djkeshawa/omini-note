const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A clock time makes a string an unambiguous instant. A date-only string is
// parsed as UTC by the engine but read back with local getters, so it lands on
// the wrong day either side of the date line.
const HAS_CLOCK_TIME_RE = /[T\s]\d{1,2}:\d{2}/;

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function dateKeyFromParts(year, month, day) {
  const key = `${String(year).padStart(4, '0')}-${padDatePart(month)}-${padDatePart(day)}`;
  // Validating what we emit keeps the module self-consistent: every key it
  // hands out is one it will accept back. Out-of-range years fail here.
  return isValidDateKey(key) ? key : '';
}

function dateKeyFromInstant(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  return dateKeyFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
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
  if (typeof value === 'string') {
    const raw = value.trim();
    // A key-shaped string is either a real date or nothing. Reparsing an
    // impossible one lets it overflow into the next month, and which month
    // depends on the reader's timezone.
    if (DATE_KEY_RE.test(raw)) return isValidDateKey(raw) ? raw : '';
    // Anything else must carry a clock time to be unambiguous; '2026-07' and
    // '2026' would otherwise resolve to a different day west of UTC.
    return HAS_CLOCK_TIME_RE.test(raw) ? dateKeyFromInstant(new Date(raw)) : '';
  }
  if (value instanceof Date) return dateKeyFromInstant(value);
  // Timestamps stay supported; null, booleans and NaN do not, so a missing
  // value reads as "no date" instead of silently becoming the epoch.
  if (typeof value === 'number' && Number.isFinite(value)) return dateKeyFromInstant(new Date(value));
  return '';
}

function shiftDateKey(value, days) {
  const key = String(value || '').trim();
  if (!isValidDateKey(key)) return '';
  const requested = Number(days);
  // A non-finite shift means "no shift". Passing Infinity through produced the
  // string 'NaN-NaN-NaN', which is truthy and so survived every `if (key)`.
  const shift = Number.isFinite(requested) ? Math.trunc(requested) : 0;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + shift);
  if (!Number.isFinite(date.getTime())) return '';
  return dateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

module.exports = { isValidDateKey, localDateKey, shiftDateKey };
