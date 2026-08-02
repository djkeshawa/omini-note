const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dates = require('../src/shared/dateUtils.js');

// Timezone-sensitive assertions run in a child process with TZ pinned, following
// the pattern in date-utils.test.js.
function localDateKeyInTimezone(timezone, value) {
  const modulePath = path.join(__dirname, '../src/shared/dateUtils.js');
  const script = `
    const dates = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify(dates.localDateKey(${JSON.stringify(value)})));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TZ: timezone },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('a date key the module calls invalid is not then converted to a real date', () => {
  // isValidDateKey and localDateKey must agree. Previously isValidDateKey said
  // "not a date" and localDateKey returned the day it overflowed into.
  for (const key of ['2026-02-30', '2026-04-31', '2026-06-31', '2025-02-29']) {
    assert.equal(dates.isValidDateKey(key), false, `${key} should be invalid`);
    assert.equal(dates.localDateKey(key), '', `${key} must not convert to a real date`);
  }
});

test('an impossible date does not resolve differently per timezone', () => {
  // The old fall-through parsed date-only strings as UTC and read them back
  // local, so the same vault gave different users different months.
  const zones = ['UTC', 'America/Los_Angeles', 'Asia/Colombo', 'Pacific/Kiritimati'];
  const answers = zones.map(tz => localDateKeyInTimezone(tz, '2026-02-30'));
  assert.deepEqual(answers, ['', '', '', ''], `got ${JSON.stringify(answers)}`);
});

test('missing values do not become 1970', () => {
  // The `= new Date()` default only fires for undefined, so null reached
  // new Date(null) === epoch. A note dated 1969 is worse than an undated one,
  // because nothing downstream flags it.
  assert.equal(dates.localDateKey(null), '');
  assert.equal(dates.localDateKey(false), '');
});

test('ambiguous partial date strings are refused rather than guessed', () => {
  // '2026-07' parsed as UTC then read local becomes 2026-06-30 west of UTC:
  // the wrong month. Refusing is the only answer that is right everywhere.
  assert.equal(dates.localDateKey('2026-07'), '');
  assert.equal(dates.localDateKey('2026'), '');
});

test('timestamps still resolve to a local day', () => {
  // Regression guard for the fix above: note.modifiedAt is stat.mtime.toISOString(),
  // so full ISO timestamps MUST keep working or "modified today" breaks.
  assert.equal(localDateKeyInTimezone('UTC', '2026-08-02T23:30:00.000Z'), '2026-08-02');
  assert.equal(localDateKeyInTimezone('Asia/Colombo', '2026-08-02T23:30:00.000Z'), '2026-08-03');
  assert.equal(dates.localDateKey(new Date('2026-08-02T12:00:00.000Z')).length, 10);
  assert.equal(dates.localDateKey(Date.parse('2026-08-02T12:00:00.000Z')).length, 10);
});

test('shiftDateKey never emits a malformed key', () => {
  // Number(days) || 0 filtered NaN but not Infinity, so this produced the
  // literal string 'NaN-NaN-NaN' -- which is truthy, so every downstream
  // `if (key)` guard waved it through.
  for (const days of [Infinity, -Infinity, 1e21]) {
    const out = dates.shiftDateKey('2026-07-13', days);
    assert.ok(out === '' || dates.isValidDateKey(out), `shift by ${days} gave ${JSON.stringify(out)}`);
  }
});

test('anything localDateKey or shiftDateKey returns is a key they accept back', () => {
  // The module must not emit keys its own validator rejects (unpadded years
  // like '999-01-01', or '10000-01-01' which sorts before every real key).
  const inputs = [
    new Date('2026-08-02T12:00:00.000Z'), Date.now(), '2026-08-02',
    new Date(-62167219200000), new Date(8.64e15),
  ];
  for (const value of inputs) {
    const out = dates.localDateKey(value);
    assert.ok(out === '' || dates.isValidDateKey(out), `localDateKey gave ${JSON.stringify(out)}`);
  }
  for (const days of [1, -1, 4000000, -4000000]) {
    const out = dates.shiftDateKey('2026-07-13', days);
    assert.ok(out === '' || dates.isValidDateKey(out), `shift ${days} gave ${JSON.stringify(out)}`);
  }
});
