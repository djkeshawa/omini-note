const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// What a view does with notes and actions that are missing the fields it would
// like to have. A vault is markdown on disk, so any of these can be absent: a
// note with no date, an action with no note, a link that resolves to nothing.
// None of them may drop a row or throw.

const NOW = new Date('2026-08-05T09:00:00.000Z');
const note = (id, over = {}) => ({ id, title: `Note ${id}`, body: '', tags: [], ...over });

test('a note result fills in every field the row renders', () => {
  const [row] = helpers.smartViewQueryNotes([{ id: 'n1' }], {});
  assert.deepEqual(row, {
    type: 'note', id: 'n1', noteId: 'n1', title: 'Untitled', note: { id: 'n1' },
    tags: [], createdAt: '', modifiedAt: '', createdDate: '', modifiedDate: '',
  }, 'a note with nothing but an id still renders a complete row');

  const [full] = helpers.smartViewQueryNotes([note('n2', {
    title: 'Real', tags: ['work'], date: '2026-01-05T09:00:00.000Z', modifiedAt: '2026-03-01T09:00:00.000Z',
  })], {});
  assert.equal(full.createdDate, '2026-01-05');
  assert.equal(full.modifiedDate, '2026-03-01');
  assert.deepEqual(full.tags, ['work']);
  full.tags.push('mutated');
  assert.deepEqual(helpers.smartViewQueryNotes([note('n2', { tags: ['work'] })], {})[0].tags, ['work'],
    'a row never hands back the note\'s own tag array');

  const [fallback] = helpers.smartViewQueryNotes([note('n3', { date: '2026-01-05T09:00:00.000Z' })], {});
  assert.equal(fallback.modifiedAt, '2026-01-05T09:00:00.000Z', 'a note never modified is dated by its creation');
  assert.deepEqual(helpers.smartViewQueryNotes([note('n4', { tags: 'not a list' })], {})[0].tags, []);
});

test('sorting copes with notes that have no dates or no titles at all', () => {
  const notes = [{ id: 'b' }, { id: 'a' }, note('c', { date: 'not a date' })];
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { sort: { field: 'created', direction: 'asc' } }).map(r => r.id),
    ['a', 'b', 'c'], 'undated notes tie at the epoch and break by title, then by id');
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { sort: { field: 'title', direction: 'asc' } }).map(r => r.id),
    ['a', 'b', 'c'], 'a note with no title sorts as an empty string');
  assert.equal(helpers.smartViewQueryNotes([{}, {}], {}).length, 2, 'two notes with no id at all are still two rows');
  assert.deepEqual(helpers.smartViewQueryNotes(null, {}), []);
  assert.deepEqual(helpers.smartViewQueryNotes(undefined, undefined), []);
});

test('a linked-note scope resolves through whichever lookup it is given', () => {
  const hub = note('hub', { title: 'Project Hub', body: 'see [[Alpha Spec]]' });
  const alpha = note('alpha', { title: 'Alpha Spec' });
  const notes = [hub, alpha];
  const ids = options => helpers.smartViewQueryNotes(notes, { filters: { linkedNotes: ['alpha'] } }, options).map(r => r.id);

  assert.deepEqual(ids({ allNotes: notes }), ['hub']);
  assert.deepEqual(ids({ notes }), ['hub'], '`notes` is the other name for the note list');
  assert.deepEqual(ids({ notesById: new Map([['alpha', alpha]]) }), ['hub'], 'a Map of notes is accepted');
  assert.deepEqual(ids({ notesById: { alpha } }), ['hub'], 'so is a plain object');
  assert.deepEqual(ids({ notesById: 'nonsense' }), ['hub'],
    'an unusable lookup falls back to the notes the view is already querying');
  assert.deepEqual(ids({}), ['hub'], 'and so does no lookup at all');
  assert.deepEqual(helpers.smartViewQueryNotes([hub], { filters: { linkedNotes: ['alpha'] } }, {}).map(r => r.id), [],
    'an id that names no note in reach resolves to nothing');

  // Two scoped links: any by default, all when asked.
  const both = note('both', { title: 'Both', body: '[[Alpha Spec]] and [[Project Hub]]' });
  const one = note('one', { title: 'One', body: '[[Alpha Spec]]' });
  const all = [both, one, alpha, hub];
  assert.deepEqual(helpers.smartViewQueryNotes(all, { filters: { linkedNotes: ['Alpha Spec', 'Project Hub'] } }, { allNotes: all })
    .map(r => r.id).sort(), ['both', 'hub', 'one']);
  assert.deepEqual(helpers.smartViewQueryNotes(all,
    { filters: { linkedNotes: ['Alpha Spec', 'Project Hub'], linkedNotesMatch: 'all' } }, { allNotes: all })
    .map(r => r.id), ['both']);
  assert.equal(helpers.smartViewQueryNotes(all, { filters: { linkedNote: 'Alpha Spec' } }, { allNotes: all }).length, 3,
    'the singular spelling works too');
});

test('a workflow status is read through the states the caller declares', () => {
  const notes = [
    note('a', { body: 'status:: DOING' }),
    note('b', { body: 'status:: doing-something-else' }),
    note('c', { body: 'no status' }),
  ];
  const ids = (filters, options) => helpers.smartViewQueryNotes(notes, { filters }, options).map(r => r.id);
  assert.deepEqual(ids({ workflowStatuses: ['DOING'] }, { workflowStates: [{ id: 'DOING' }] }), ['a']);
  assert.deepEqual(ids({ workflowStatuses: ['DOING'] }, { states: [{ id: 'DOING' }] }), ['a'],
    '`states` is the other name for the declared states');
  assert.deepEqual(ids({ workflowStatuses: ['DOING'] }, {}), ['a'],
    'with no states declared the raw status is normalised and matched directly');
  assert.deepEqual(ids({ workflowStatus: 'DOING' }, {}), ['a'], 'the singular spelling works');
  assert.deepEqual(ids({ workflowStatuses: ['DOING'] }, { normalizeId: () => 'DOING', workflowStates: [{ id: 'DOING' }] })
    .sort(), ['a', 'b', 'c'], 'a caller can supply its own normaliser');
});

test('property comparison is numeric when both sides are numbers and textual otherwise', () => {
  const notes = [
    note('n2', { body: 'order:: 2' }),
    note('n10', { body: 'order:: 10' }),
    note('word', { body: 'order:: later' }),
  ];
  const by = (op, value) => helpers.smartViewQueryNotes(notes, { filters: { properties: [{ key: 'order', value, op }] } })
    .map(r => r.id).sort();
  assert.deepEqual(by('lt', '5'), ['n2'], '2 < 5 numerically; "later" is not a number so it compares as text');
  assert.deepEqual(by('gt', '5'), ['n10', 'word']);
  assert.deepEqual(by('lt', 'm'), ['n10', 'n2', 'word'], 'against a word every value compares as text');
  assert.deepEqual(by('is', '10'), ['n10']);
  assert.deepEqual(by('has', 'ATE'), ['word'], 'containment ignores case');
});

test('an action view survives notes and items with nothing on them', () => {
  const run = (notes, definition) => helpers.smartViewQueryActions(notes, definition, { now: NOW });
  assert.deepEqual(run(null, { type: 'actions' }), []);
  assert.deepEqual(run([], { type: 'actions' }), []);
  assert.deepEqual(run([{ id: 'n1' }], { type: 'actions' }), [], 'a note with no body has no actions');

  const [row] = run([{ id: 'n1', body: '- [ ] A task' }], { type: 'actions' });
  assert.equal(row.noteTitle, 'Untitled');
  assert.equal(row.noteTags.length, 0);
  assert.equal(row.noteDate, '');
  assert.equal(row.noteModifiedAt, '');
  assert.equal(row.source.blockId, '', 'a note held as lines has no block id to point at');
  assert.equal(row.source.line, 0);
  assert.equal(row.deferred, false);
  assert.equal(row.completed, false);

  // Sorting by a field none of the rows carry must still return every row.
  const many = [{ id: 'n1', body: '- [ ] One\n- [ ] Two' }];
  assert.equal(run(many, { type: 'actions', sort: { field: 'reminder' } }).length, 2);
  assert.equal(run(many, { type: 'actions', sort: { field: 'created' } }).length, 2);
  assert.equal(run(many, { type: 'actions', sort: { field: 'title', direction: 'desc' } })[0].label, 'Two');
});

test('an action row is titled and keyed even when the item is bare', () => {
  const results = helpers.smartViewQueryActions([
    { id: 'n1', title: 'Has a title', tags: ['work'], date: '2026-01-05', modifiedAt: '2026-03-01', body: '- [ ] Do it' },
  ], { type: 'actions' }, { now: NOW });
  const [row] = results;
  assert.equal(row.noteTitle, 'Has a title');
  assert.equal(row.sourceNoteTitle, 'Has a title');
  assert.deepEqual(row.noteTags, ['work']);
  assert.equal(row.noteDate, '2026-01-05');
  assert.equal(row.noteModifiedAt, '2026-03-01');
  assert.equal(row.text, '- [ ] Do it'.replace('- [ ] ', '') || row.text);
  assert.equal(row.source.line, 0);
  assert.equal(typeof row.key, 'string');
  assert.ok(row.key.length);

  // An action whose text is only markers still gets a label to show.
  const [blank] = helpers.smartViewQueryActions([{ id: 'n2', body: '- [ ] @remind 2026-09-01' }],
    { type: 'actions' }, { now: NOW });
  assert.equal(blank.label, 'Untitled action', 'a row with nothing to say still says something');
});

test('grouping falls back through tags, note tags and an empty bucket', () => {
  const noteResults = helpers.smartViewQueryNotes([note('a', { tags: ['work'] }), note('b')], {});
  const byTag = helpers.smartViewGroup(noteResults, { by: 'tag' });
  assert.deepEqual(byTag.map(g => g.label), ['work', 'No tag']);
  assert.deepEqual(byTag[1].items.map(i => i.id), ['b']);

  // A row that is neither a note result nor an action result is read directly.
  const raw = helpers.smartViewGroup([{ id: 'x', tags: ['loose'] }], { by: 'tag' });
  assert.deepEqual(raw.map(g => g.label), ['loose', 'No tag']);
  assert.deepEqual(helpers.smartViewGroup([{ id: 'x' }], { by: 'tag' }).map(g => g.label), ['No tag']);
  assert.deepEqual(helpers.smartViewGroup([], { by: 'tag' }).map(g => g.label), ['No tag'],
    'the unfiled bucket always exists, even when there is nothing at all');
  assert.deepEqual(helpers.smartViewGroup([null], { by: 'status' })[0].label, 'No status',
    'a null row lands in the unfiled bucket rather than throwing');
  assert.deepEqual(helpers.smartViewGroup(), [{ key: '', label: '', items: [] }]);
});

test('a date filter that cannot be parsed excludes rather than includes', () => {
  const notes = [note('a', { date: '2026-01-05T09:00:00.000Z' }), note('undated')];
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { filters: { createdFrom: 'not a date' } }).map(r => r.id).sort(),
    ['a', 'undated'], 'an unusable bound is dropped, so the filter is simply not applied');
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { filters: { createdFrom: '2026-01-01' } }).map(r => r.id), ['a'],
    'a note with no date cannot be inside a range');
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { filters: { createdAfter: '2026-01-01' } }).map(r => r.id), ['a'],
    'createdAfter is the other spelling of createdFrom');
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { filters: { createdBefore: '2026-01-10' } }).map(r => r.id), ['a']);
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { filters: { modifiedAfter: '2026-01-01' } }).map(r => r.id), ['a']);
  assert.deepEqual(helpers.smartViewQueryNotes(notes, { filters: { modifiedBefore: '2026-01-10' } }).map(r => r.id), ['a']);
});
