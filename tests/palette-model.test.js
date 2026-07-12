const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/app/paletteModel.js');

function note(id, title, extra = {}) {
  return { id, title, ...extra };
}

function action(id, title, extra = {}) {
  return { id, title, section: 'Action', enabled: true, ...extra };
}

test('palette fuzzy title scoring ranks exact through subsequence matches', () => {
  const query = 'plan';
  const exact = model.mnFuzzyTitleScore(query, 'Plan');
  const prefix = model.mnFuzzyTitleScore(query, 'Planning notes');
  const substring = model.mnFuzzyTitleScore(query, 'Weekly plan review');
  const subsequence = model.mnFuzzyTitleScore(query, 'Personal log and notes');
  assert.ok(exact > prefix);
  assert.ok(prefix > substring);
  assert.ok(substring > subsequence);
  assert.equal(model.mnFuzzyTitleScore(query, 'Nothing here'), null);
  assert.notEqual(model.mnFuzzyTitleScore('mtg', 'Meeting notes'), null);
});

test('empty palette lists recent notes and exactly four available frequent actions', () => {
  const notes = [
    note('a', 'Alpha', { modifiedAt: '2026-01-01T00:00:00Z' }),
    note('b', 'Beta', { modifiedAt: '2026-03-01T00:00:00Z' }),
    note('c', 'Gamma', { modifiedAt: '2026-02-01T00:00:00Z', pinned: true }),
  ];
  const commands = [
    action('settings', 'Settings'),
    action('today', 'Open Today'),
    action('new-note', 'New note'),
    action('quick-capture', 'Quick capture'),
    action('graph', 'Open graph', { enabled: false }),
  ];
  const items = model.mnPaletteItems({ notes, commands, recentIds: ['b', 'a'], query: '' });

  assert.deepEqual(items.filter(item => item.kind === 'note').map(item => item.note.id), ['b', 'a', 'c']);
  assert.deepEqual(items.filter(item => item.kind === 'action').map(item => item.action.id), model.FREQUENT_ACTION_IDS);
  assert.equal(items.some(item => item.action?.id === 'graph'), false);
});

test('notes-first mode orders notes before matching actions in the shared palette', () => {
  const notes = [note('open-plan', 'Open planning notes')];
  const commands = [action('settings', 'Open settings')];
  const notesFirst = model.mnPaletteItems({ notes, commands, query: 'open', mode: 'notes' });
  const mixed = model.mnPaletteItems({ notes, commands, query: 'open', mode: 'mixed' });

  assert.equal(notesFirst[0].kind, 'note');
  assert.equal(mixed[0].kind, 'action');
});

test('unmatched palette text offers note creation while exact titles suppress it', () => {
  const notes = [note('recipes', 'Recipes')];
  const unmatched = model.mnPaletteItems({ notes, commands: [], query: 'Project seed', mode: 'notes' });
  const exact = model.mnPaletteItems({ notes, commands: [], query: 'recipes', mode: 'notes' });

  assert.equal(unmatched[0].kind, 'create');
  assert.equal(unmatched[0].createTitle, 'Project seed');
  assert.equal(exact.some(item => item.kind === 'create'), false);
});

test('interpreted actions never reintroduce unavailable pack commands', () => {
  const naturalPlan = { title: 'Open graph', steps: [{ actionId: 'graph', label: 'Open graph' }] };
  const items = model.mnPaletteItems({
    notes: [],
    commands: [action('new-note', 'New note')],
    query: 'open graph',
    naturalPlan,
  });
  assert.equal(items.some(item => item.kind === 'natural'), false);
  assert.equal(items.some(item => item.action?.id === 'graph'), false);
});

test('recent note tracking dedupes, prepends, and caps', () => {
  assert.deepEqual(model.mnPushRecentNoteId(['a', 'b'], 'b'), ['b', 'a']);
  assert.deepEqual(model.mnPushRecentNoteId([], 'x'), ['x']);
  const capped = model.mnPushRecentNoteId(Array.from({ length: 25 }, (_, i) => `n${i}`), 'new', 20);
  assert.equal(capped.length, 20);
  assert.equal(capped[0], 'new');
});
