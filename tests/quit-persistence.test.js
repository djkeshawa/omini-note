const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyFlushResult, flushFailureDetail } = require('../lib/quitPersistence');

test('quit persistence allows a complete renderer flush', () => {
  const status = classifyFlushResult({
    ok: true,
    value: { ok: true, dirtyRemaining: 0, metaDirty: false, failures: [] },
  });
  assert.equal(status.ok, true);
});

test('quit persistence blocks dirty, failed, timed-out, and metadata-incomplete flushes', () => {
  const dirty = classifyFlushResult({
    ok: false,
    value: {
      ok: false,
      dirtyRemaining: 2,
      metaDirty: true,
      failures: [{ kind: 'note', id: 'n1', code: 'NOTE_CONFLICT', message: 'Conflict' }],
    },
  });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.dirtyRemaining, 2);
  assert.equal(dirty.metaDirty, true);
  assert.equal(dirty.failures[0].code, 'NOTE_CONFLICT');
  assert.match(flushFailureDetail(dirty), /2 notes still unsaved/);
  assert.equal(classifyFlushResult({ ok: false, error: 'Timed out waiting for dirty-note flush' }).ok, false);
  assert.equal(classifyFlushResult(null).ok, false);
});

test('quit persistence permits a destroyed-renderer skip', () => {
  assert.equal(classifyFlushResult({ ok: true, skipped: true }).ok, true);
});
