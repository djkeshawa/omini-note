const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/app/quickSwitcherModel.js');

function note(id, title, extra = {}) {
  return { id, title, ...extra };
}

test('mnFuzzyTitleScore ranks exact > prefix > substring > subsequence', () => {
  const query = 'plan';
  const exact = model.mnFuzzyTitleScore(query, 'Plan');
  const prefix = model.mnFuzzyTitleScore(query, 'Planning notes');
  const substring = model.mnFuzzyTitleScore(query, 'Weekly plan review');
  const subsequence = model.mnFuzzyTitleScore(query, 'Personal log and notes');
  assert.ok(exact > prefix, 'exact beats prefix');
  assert.ok(prefix > substring, 'prefix beats substring');
  assert.ok(substring > subsequence, 'substring beats subsequence');
  assert.equal(model.mnFuzzyTitleScore(query, 'Nothing here'), null);
  assert.equal(model.mnFuzzyTitleScore('', 'Anything'), 0);
  assert.equal(model.mnFuzzyTitleScore('x', ''), null);
});

test('mnFuzzyTitleScore matches initials-style subsequences', () => {
  assert.notEqual(model.mnFuzzyTitleScore('mtg', 'Meeting notes'), null);
  assert.notEqual(model.mnFuzzyTitleScore('wp', 'Weekly Plan'), null);
  assert.equal(model.mnFuzzyTitleScore('zzz', 'Weekly Plan'), null);
});

test('mnQuickSwitcherResults with empty query lists recents first, then pinned and fresh notes', () => {
  const notes = [
    note('a', 'Alpha', { modifiedAt: '2026-01-01T00:00:00Z' }),
    note('b', 'Beta', { modifiedAt: '2026-03-01T00:00:00Z' }),
    note('c', 'Gamma', { modifiedAt: '2026-02-01T00:00:00Z', pinned: true }),
    note('d', 'Delta', { modifiedAt: '2026-04-01T00:00:00Z' }),
  ];
  const { items, createTitle } = model.mnQuickSwitcherResults({
    notes,
    query: '',
    recentIds: ['b', 'missing', 'b', 'a'],
  });
  assert.deepEqual(items.map(n => n.id), ['b', 'a', 'c', 'd']);
  assert.equal(createTitle, null);
});

test('mnQuickSwitcherResults filters by fuzzy title match and offers create when no exact match', () => {
  const notes = [
    note('a', 'Project roadmap'),
    note('b', 'Recipes'),
    note('c', 'Roadside trips'),
  ];
  const withMatches = model.mnQuickSwitcherResults({ notes, query: 'road' });
  assert.deepEqual([...withMatches.items.map(n => n.id)].sort(), ['a', 'c']);
  assert.equal(withMatches.createTitle, 'road');

  const exact = model.mnQuickSwitcherResults({ notes, query: 'recipes' });
  assert.equal(exact.items[0].id, 'b');
  assert.equal(exact.createTitle, null, 'case-insensitive exact match suppresses create');

  const none = model.mnQuickSwitcherResults({ notes, query: 'xyzzy' });
  assert.deepEqual(none.items, []);
  assert.equal(none.createTitle, 'xyzzy');
});

test('mnQuickSwitcherResults respects the limit', () => {
  const notes = Array.from({ length: 30 }, (_, i) => note(`n${i}`, `Note ${i}`));
  const { items } = model.mnQuickSwitcherResults({ notes, query: 'note', limit: 5 });
  assert.equal(items.length, 5);
});

test('mnPushRecentNoteId dedupes, prepends, and caps', () => {
  assert.deepEqual(model.mnPushRecentNoteId(['a', 'b'], 'b'), ['b', 'a']);
  assert.deepEqual(model.mnPushRecentNoteId([], 'x'), ['x']);
  assert.deepEqual(model.mnPushRecentNoteId(null, 'x'), ['x']);
  const capped = model.mnPushRecentNoteId(Array.from({ length: 25 }, (_, i) => `n${i}`), 'new', 20);
  assert.equal(capped.length, 20);
  assert.equal(capped[0], 'new');
});
