const test = require('node:test');
const assert = require('node:assert/strict');

const actions = require('../src/app/memoryActions');

test('memory sync message reports partial, stale, failed, and ambiguous work', () => {
  const message = actions.syncResultMessage({
    notesRemembered: 3,
    wikiLinks: 8,
    created: 2,
    updated: 3,
    failed: 1,
    remaining: 4,
    staleManaged: 2,
    unmanagedConflicts: 1,
    ambiguousLegacy: 1,
  });
  assert.match(message, /2 relationships created/);
  assert.match(message, /3 relationships refreshed/);
  assert.match(message, /4 relationships remain/);
  assert.match(message, /2 stale VispNote relationships/);
  assert.match(message, /unmanaged relationship conflict/);
  assert.match(message, /legacy memory mapping/);
});

test('memory insights distinguish an unavailable duplicate scan from zero candidates', () => {
  const report = { ok: true, value: { summary: { total_memories: 5, total_relationships: 2 } } };
  assert.match(actions.insightsResultMessage(report, { ok: false, error: 'offline' }), /duplicate scan unavailable/);
  assert.match(actions.insightsResultMessage(report, { ok: true, value: { candidates: [] } }), /0 duplicate candidates/);
});
