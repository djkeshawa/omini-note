const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// The Views query engine: what a saved view actually shows. 96% of its lines
// ran under tests but only two thirds of its branches -- most filters had
// never been exercised in BOTH directions. Every case here states the
// expected behaviour for a user's saved view; a red is a bug candidate.

const query = (notes, definition, options = {}) =>
  helpers.smartViewQueryNotes(notes, definition, options).map(r => r.id);

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? '',
  tags: over.tags ?? [], date: over.date ?? '2026-01-10T09:00:00.000Z',
  modifiedAt: over.modifiedAt ?? over.date ?? '2026-01-10T09:00:00.000Z',
});

const NOTES = [
  note('work1', { tags: ['work'], date: '2026-01-05T09:00:00.000Z', modifiedAt: '2026-03-01T09:00:00.000Z' }),
  note('work2', { tags: ['work', 'urgent'], date: '2026-02-10T09:00:00.000Z', modifiedAt: '2026-02-10T09:00:00.000Z' }),
  note('home1', { tags: ['home'], date: '2026-03-15T09:00:00.000Z', modifiedAt: '2026-01-20T09:00:00.000Z' }),
  note('plain', { tags: [], date: '2026-04-01T09:00:00.000Z' }),
];

test('a tag scope matches ANY picked tag by default, ALL when asked', () => {
  assert.deepEqual(new Set(query(NOTES, { filters: { tags: ['work', 'home'] } })),
    new Set(['work1', 'work2', 'home1']), 'the default scope is any-of');
  assert.deepEqual(query(NOTES, { filters: { tags: ['work', 'urgent'], tagsMatch: 'all' } }),
    ['work2'], 'all-of must require every picked tag');
  assert.deepEqual(query(NOTES, { filters: { tags: ['urgent'] } }), ['work2']);
  assert.deepEqual(query(NOTES, { filters: { tags: ['nope'] } }), [], 'an unknown tag matches nothing');
});

test('title matching is case-insensitive containment', () => {
  const notes = [note('a', { title: 'Quarterly Review' }), note('b', { title: 'Daily log' })];
  assert.deepEqual(query(notes, { filters: { titleContains: 'quarterly' } }), ['a']);
  assert.deepEqual(query(notes, { filters: { titleContains: 'REVIEW' } }), ['a']);
  assert.deepEqual(query(notes, { filters: { titleContains: 'meeting' } }), []);
});

test('date ranges are inclusive at both edges and undated notes fall out', () => {
  const dated = [
    note('early', { date: '2026-01-01T00:00:00.000Z' }),
    note('mid', { date: '2026-02-15T00:00:00.000Z' }),
    note('late', { date: '2026-03-31T00:00:00.000Z' }),
    { id: 'undated', title: 'No date', body: '', tags: [] },
  ];
  assert.deepEqual(new Set(query(dated, { filters: { createdFrom: '2026-01-01', createdTo: '2026-02-15' } })),
    new Set(['early', 'mid']), 'both boundary days belong to the range');
  assert.deepEqual(query(dated, { filters: { createdFrom: '2026-03-01' } }), ['late'], 'an open-ended from works alone');
  assert.deepEqual(new Set(query(dated, { filters: { createdTo: '2026-01-01' } })), new Set(['early']));
  assert.ok(!query(dated, { filters: { createdFrom: '2020-01-01' } }).includes('undated'),
    'a note with no date cannot claim to be inside a date range');
});

test('modified ranges read modifiedAt and fall back to the created date', () => {
  const notes = [
    note('m', { date: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-06-01T00:00:00.000Z' }),
    { id: 'fallback', title: 'F', body: '', tags: [], date: '2026-06-02T00:00:00.000Z' },
  ];
  const hits = query(notes, { filters: { modifiedFrom: '2026-06-01' } });
  assert.ok(hits.includes('m'), 'modifiedAt should be read first');
  assert.ok(hits.includes('fallback'), 'a note never modified counts as modified when it was created');
});

test('every property operator behaves as its name says', () => {
  const notes = [
    note('draft', { body: 'status:: DRAFT\ntext' }),
    note('final', { body: 'status:: FINAL\ntext' }),
    note('blank', { body: 'status::\ntext' }),
    note('none', { body: 'just text' }),
    note('p3', { body: 'priority:: 3' }),
    note('p10', { body: 'priority:: 10' }),
  ];
  const by = (op, key, value) => query(notes, { filters: { properties: [{ key, value, op }] } });
  assert.deepEqual(by('is', 'status', 'draft'), ['draft'], 'is compares case-insensitively');
  assert.deepEqual(new Set(by('not', 'status', 'draft')), new Set(['final', 'blank']),
    'not still requires the property to exist');
  assert.deepEqual(by('has', 'status', 'RAF'), ['draft'], 'has is containment');
  assert.deepEqual(by('lt', 'priority', '5'), ['p3'], 'lt must compare 3 and 10 numerically, not as strings');
  assert.deepEqual(by('gt', 'priority', '5'), ['p10'], 'gt likewise -- "10" > "5" is false as text');
  // empty = missing OR blank. p3/p10 have no status line, so they count too.
  assert.deepEqual(new Set(by('empty', 'status')), new Set(['blank', 'none', 'p3', 'p10']),
    'empty means missing or blank, and must not first require presence');
  assert.deepEqual(new Set(by('filled', 'status')), new Set(['draft', 'final']),
    'a blank status:: line is not filled');
  assert.deepEqual(new Set(by('is', 'status', undefined)), new Set(['draft', 'final', 'blank']),
    'a key with no value means "has this property line"');
});

test('multiple property conditions default to ALL and honour any', () => {
  const notes = [
    note('both', { body: 'status:: DRAFT\nkind:: essay' }),
    note('one', { body: 'status:: DRAFT' }),
    note('other', { body: 'kind:: essay' }),
  ];
  const filters = { properties: [{ key: 'status', value: 'draft' }, { key: 'kind', value: 'essay' }] };
  assert.deepEqual(query(notes, { filters }), ['both'], 'conditions combine with AND by default');
  assert.deepEqual(new Set(query(notes, { filters: { ...filters, propertiesMatch: 'any' } })),
    new Set(['both', 'one', 'other']));
});

test('workflow status filtering uses the normalised status', () => {
  const notes = [
    note('doing', { body: 'status:: DOING' }),
    note('idea', { body: 'status:: IDEA' }),
    note('none', { body: 'plain' }),
  ];
  const states = [{ id: 'DOING' }, { id: 'IDEA' }];
  const hits = query(notes, { filters: { workflowStatuses: ['doing'] } }, { workflowStates: states });
  assert.deepEqual(hits, ['doing']);
  assert.deepEqual(query(notes, { filters: { workflowStatuses: ['nothing'] } }, { workflowStates: states }), []);
});

test('linked-note scopes resolve titles and note ids alike', () => {
  const hub = note('hub', { title: 'Project Hub', body: 'see [[Alpha Spec]]' });
  const alpha = note('alpha', { title: 'Alpha Spec' });
  const stray = note('stray', { body: 'no links' });
  const notes = [hub, alpha, stray];
  assert.deepEqual(query(notes, { filters: { linkedNotes: ['Alpha Spec'] } }, { allNotes: notes }),
    ['hub'], 'a view scoped to a title finds the notes linking to it');
  assert.deepEqual(query(notes, { filters: { linkedNotes: ['alpha'] } }, { allNotes: notes }),
    ['hub'], 'scoping by the note ID must resolve through the note to its title');
  assert.deepEqual(query(notes, { filters: { linkedNotes: ['Missing Note'] } }, { allNotes: notes }), []);
});

test('sorting varies by field and direction with stable, direction-proof ties', () => {
  const notes = [
    note('b', { title: 'Bravo', date: '2026-01-02T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z' }),
    note('a', { title: 'alpha', date: '2026-01-03T00:00:00.000Z', modifiedAt: '2026-01-03T00:00:00.000Z' }),
    note('c', { title: 'Charlie', date: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(query(notes, { sort: { field: 'title', direction: 'asc' } }), ['a', 'b', 'c'],
    'title sort must be case-insensitive');
  assert.deepEqual(query(notes, { sort: { field: 'title', direction: 'desc' } }), ['c', 'b', 'a']);
  assert.deepEqual(query(notes, { sort: { field: 'created', direction: 'asc' } }), ['c', 'b', 'a']);
  assert.deepEqual(query(notes, { sort: { field: 'modified', direction: 'desc' } }), ['a', 'b', 'c']);
  // Equal timestamps: ties break by title, and flipping direction must not
  // flip the tie-break -- desc reverses the field, not the whole ordering.
  const tied = [
    note('z', { title: 'Zulu', date: '2026-01-01T00:00:00.000Z' }),
    note('m', { title: 'Mike', date: '2026-01-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(query(tied, { sort: { field: 'created', direction: 'asc' } }), ['m', 'z']);
  assert.deepEqual(query(tied, { sort: { field: 'created', direction: 'desc' } }), ['m', 'z'],
    'a tie has no direction; reversing it would shuffle rows on every toggle');
});

test('the limit trims after sorting, not before', () => {
  const notes = [
    note('old', { modifiedAt: '2026-01-01T00:00:00.000Z' }),
    note('new', { modifiedAt: '2026-06-01T00:00:00.000Z' }),
    note('mid', { modifiedAt: '2026-03-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(query(notes, { sort: { field: 'modified', direction: 'desc' }, limit: 2 }),
    ['new', 'mid'], 'the limit must keep the top of the sorted list');
});

test('grouping buckets by tag, sorts buckets, and keeps unfiled last', () => {
  const results = helpers.smartViewQueryNotes([
    note('w', { tags: ['work'] }),
    note('h', { tags: ['home'] }),
    note('wh', { tags: ['work', 'home'] }),
    note('bare', { tags: [] }),
  ], {});
  const groups = helpers.smartViewGroup(results, { by: 'tag' });
  assert.deepEqual(groups.map(g => g.label), ['home', 'work', 'No tag'], 'named buckets sort, unfiled sits last');
  assert.deepEqual(new Set(groups[0].items.map(i => i.id)), new Set(['h', 'wh']),
    'a note with two tags appears in both buckets');
  const desc = helpers.smartViewGroup(results, { by: 'tag', direction: 'desc' });
  assert.deepEqual(desc.map(g => g.label), ['work', 'home', 'No tag'],
    'descending reverses the named buckets but never moves the unfiled bucket');
});

test('grouping by a body property reads each result note', () => {
  const results = helpers.smartViewQueryNotes([
    note('d1', { body: 'status:: DRAFT' }),
    note('f1', { body: 'status:: FINAL' }),
    note('n1', { body: 'nothing' }),
  ], {});
  const groups = helpers.smartViewGroup(results, { by: 'status' });
  assert.deepEqual(groups.map(g => g.label), ['DRAFT', 'FINAL', 'No status']);
  assert.deepEqual(groups[2].items.map(i => i.id), ['n1']);
  const flat = helpers.smartViewGroup(results, null);
  assert.equal(flat.length, 1, 'no grouping means one flat bucket');
  assert.equal(flat[0].items.length, 3);
});
