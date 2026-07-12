const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dates = require('../src/shared/dateUtils.js');

function dateKeysInTimezone(timezone, instant) {
  const appHelpersPath = path.join(__dirname, '../src/app/appHelpers.js');
  const todayModelPath = path.join(__dirname, '../src/features/today/todayModel.js');
  const script = `
    const helpers = require(${JSON.stringify(appHelpersPath)});
    const model = require(${JSON.stringify(todayModelPath)});
    const value = new Date(${JSON.stringify(instant)});
    process.stdout.write(JSON.stringify([helpers.todayIsoDate(value), helpers.rollupDateKey(value), model.todayKey(value)]));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TZ: timezone },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('date keys validate and shift without timezone drift', () => {
  assert.equal(dates.isValidDateKey('2024-02-29'), true);
  assert.equal(dates.isValidDateKey('2026-02-29'), false);
  assert.equal(dates.localDateKey('2026-07-13'), '2026-07-13');
  assert.equal(dates.localDateKey('not-a-date'), '');
  assert.equal(dates.shiftDateKey('2026-01-01', -1), '2025-12-31');
});

test('Today uses the local calendar day on both sides of UTC boundaries', () => {
  assert.deepEqual(
    dateKeysInTimezone('Asia/Colombo', '2026-07-12T20:30:00.000Z'),
    ['2026-07-13', '2026-07-13', '2026-07-13']
  );
  assert.deepEqual(
    dateKeysInTimezone('America/Los_Angeles', '2026-07-13T05:30:00.000Z'),
    ['2026-07-12', '2026-07-12', '2026-07-12']
  );
});
