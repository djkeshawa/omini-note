const test = require('node:test');
const assert = require('node:assert/strict');

const memory = require('../src/app/memoryActions.js');

// src/app/memoryActions.js sat at 30% branch coverage -- the lowest in the
// codebase. These are the sentences the user reads after a memory-graph action,
// so a wrong number here is a wrong answer, not just bad copy.

test('an empty memory graph explains what to do instead of reporting zeros', () => {
  const message = memory.syncResultMessage({});
  assert.match(message, /Remember this note/i);
  assert.doesNotMatch(message, /0 relationship/, 'a first-run user should get guidance, not a tally');
});

test('counts read naturally at one and at many', () => {
  const one = memory.syncResultMessage({ notesRemembered: 1, wikiLinks: 1, created: 1, updated: 1 });
  assert.match(one, /1 wiki-link\b/);
  assert.match(one, /1 remembered note\b/);
  assert.match(one, /1 relationship\b/);
  const many = memory.syncResultMessage({ notesRemembered: 2, wikiLinks: 3, created: 4, updated: 5 });
  assert.match(many, /3 wiki-links/);
  assert.match(many, /2 remembered notes/);
  assert.match(many, /4 relationships/);
  // Zero is plural in English: "0 relationships", never "0 relationship".
  const none = memory.syncResultMessage({ notesRemembered: 1, wikiLinks: 0, created: 0, updated: 0 });
  assert.match(none, /0 wiki-links/);
  assert.match(none, /0 relationships/);
});

test('optional clauses appear only when there is something to report', () => {
  const clean = memory.syncResultMessage({ notesRemembered: 1, wikiLinks: 1, created: 1, updated: 0 });
  for (const noise of [/failed/, /remain for the next/, /stale/, /unmanaged/, /ambiguous/, /truncated/]) {
    assert.doesNotMatch(clean, noise, `a clean sync should not mention ${noise}`);
  }
  const messy = memory.syncResultMessage({
    notesRemembered: 1, wikiLinks: 1, created: 1, updated: 1,
    failed: 2, remaining: 3, staleManaged: 4, unmanagedConflicts: 5, ambiguousLegacy: 6, indexTruncated: true,
  });
  for (const expected of [/2 relationships failed/, /3 relationships remain/, /4 stale VispNote relationships/,
    /5 unmanaged relationship conflicts/, /6 legacy memory mappings/, /truncated/]) {
    assert.match(messy, expected);
  }
});

test('a garbled count never reaches the user as NaN', () => {
  const message = memory.syncResultMessage({
    notesRemembered: 1, wikiLinks: 'lots', created: null, updated: undefined, failed: {},
  });
  assert.doesNotMatch(message, /NaN/, `NaN leaked into the message: ${message}`);
});

test('a failed report is raised, not rendered as an empty graph', () => {
  assert.throws(() => memory.insightsResultMessage({ ok: false, error: 'memory server offline' }, {}),
    /memory server offline/);
});

test('a healthy report is summarised with every figure', () => {
  const message = memory.insightsResultMessage(
    { ok: true, value: { summary: { total_memories: 12, total_relationships: 34, active_intents: 5 } } },
    { ok: true, value: { candidates: [1, 2, 3] } });
  assert.match(message, /12 memories/);
  assert.match(message, /34 relationships/);
  assert.match(message, /5 active intents/);
  assert.match(message, /3 duplicate candidates/);
});

test('a genuinely empty graph reports zeros rather than omitting them', () => {
  const message = memory.insightsResultMessage(
    { ok: true, value: { summary: { total_memories: 0, total_relationships: 0 } } },
    { ok: true, value: { candidates: [] } });
  assert.match(message, /0 memories/);
  assert.match(message, /0 relationships/);
  assert.match(message, /0 duplicate candidates/);
  assert.doesNotMatch(message, /active intents/, 'absent intents should be omitted, not shown as 0');
});

test('a failed duplicate scan degrades without sinking the whole report', () => {
  const message = memory.insightsResultMessage(
    { ok: true, value: { summary: { total_memories: 2, total_relationships: 1 } } },
    { ok: false, error: 'scan unavailable' });
  assert.match(message, /2 memories/);
  assert.match(message, /duplicate scan unavailable/);
});

test('both spellings of the duplicates payload are counted', () => {
  const withDuplicates = memory.insightsResultMessage(
    { ok: true, value: { summary: {} } }, { ok: true, value: { duplicates: [1, 2] } });
  assert.match(withDuplicates, /2 duplicate candidates/);
  const singular = memory.insightsResultMessage(
    { ok: true, value: { summary: {} } }, { ok: true, value: { candidates: [1] } });
  assert.match(singular, /1 duplicate candidate\b/);
});

test('a result that never arrived is not reported as a healthy empty graph', () => {
  // Distinct from "0 memories": if the call returned nothing at all, saying
  // the graph is empty is a wrong answer, not a terse one. The sibling sync
  // action raises in this situation.
  for (const missing of [null, undefined]) {
    assert.throws(() => memory.insightsResultMessage(missing, { ok: true, value: { candidates: [] } }),
      `insightsResultMessage(${missing}) reported an empty graph instead of raising`);
  }
});
