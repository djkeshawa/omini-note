const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// The other half of the Views query engine. views-query-engine.test.js pins
// what a view over *notes* shows; this pins what a view over *actions* shows --
// tasks and reminders pulled out of note bodies. That path had almost no tests,
// which is why two thirds of its branches had never run.

const note = (id, body, over = {}) => ({
  id,
  title: over.title ?? `Note ${id}`,
  body,
  tags: over.tags ?? [],
  date: over.date ?? '2026-01-10T09:00:00.000Z',
  modifiedAt: over.modifiedAt ?? over.date ?? '2026-01-10T09:00:00.000Z',
});

const NOW = new Date('2026-08-05T09:00:00.000Z');
const run = (notes, definition, options = {}) =>
  helpers.smartViewQueryActions(notes, definition, { now: NOW, ...options });

const NOTES = [
  note('a', [
    '- [ ] Buy milk',
    '- [x] Ship the release',
    '- [ ] Renew the lease @defer 2030-01-01',
    '- [ ] Pay rent @remind 2026-09-15 10:00',
  ].join('\n'), { tags: ['home'], title: 'Errands' }),
  note('b', [
    'Call the plumber @remind 2026-09-01',
    'just prose, not an action',
  ].join('\n'), { tags: ['house'], title: 'House' }),
];

test('an action view reads tasks and reminders out of note bodies', () => {
  const results = run(NOTES, { type: 'actions' });
  assert.equal(results.length, 5, 'four checkbox lines plus one bare reminder');
  const byLabel = new Map(results.map(r => [r.label, r]));
  assert.deepEqual([...byLabel.keys()].sort(), [
    'Buy milk', 'Call the plumber', 'Pay rent', 'Renew the lease', 'Ship the release',
  ], 'the label is the action text with its markers stripped');
  assert.equal(byLabel.get('Buy milk').type, 'task');
  assert.equal(byLabel.get('Call the plumber').type, 'reminder',
    'a line with only @remind on it is a reminder, not a task');
});

test('action status is open, completed, deferred or reminder', () => {
  const status = label => run(NOTES, { type: 'actions' }).find(r => r.label === label).status;
  assert.equal(status('Buy milk'), 'open');
  assert.equal(status('Ship the release'), 'completed', 'a ticked box is completed');
  assert.equal(status('Renew the lease'), 'deferred', '@defer in the future hides it until then');
  assert.equal(status('Call the plumber'), 'reminder');
  // A defer date already past is not deferred any more -- it is simply open.
  const past = run([note('p', '- [ ] Was hidden @defer 2020-01-01')], { type: 'actions' });
  assert.equal(past[0].status, 'open', 'a defer date in the past has expired');
  // A ticked box wins over a future defer date: done is done.
  const both = run([note('p', '- [x] Done early @defer 2030-01-01')], { type: 'actions' });
  assert.equal(both[0].status, 'completed');
});

test('a result carries the note it came from and the flags the UI reads', () => {
  const [result] = run([NOTES[0]], { type: 'actions', filters: { titleContains: 'Errands' } })
    .filter(r => r.label === 'Ship the release');
  assert.equal(result.noteId, 'a');
  assert.equal(result.noteTitle, 'Errands');
  assert.equal(result.sourceNoteTitle, 'Errands');
  assert.deepEqual(result.noteTags, ['home']);
  assert.equal(result.title, result.label, 'title mirrors label so one renderer serves both');
  assert.equal(result.checked, true);
  assert.equal(result.completed, true);
  assert.equal(result.deferred, false);
  assert.equal(result.id, result.key, 'id and key are the same handle');
  assert.equal(result.source.noteId, 'a');
  assert.equal(result.source.key, result.key);
  assert.equal(result.sourceNote.id, 'a', 'the whole note rides along for grouping');
  assert.equal(result.noteModifiedAt, NOTES[0].modifiedAt);
});

test('an action from a bare note falls back rather than throwing', () => {
  // A note with no title, no tags and no date is legal on disk. Every field the
  // action row renders has to survive it.
  const bare = { id: 'x', title: '', body: '- [ ] Loose end', tags: null, date: '' };
  const [result] = run([bare], { type: 'actions' });
  assert.equal(result.noteTitle, 'Untitled');
  assert.deepEqual(result.noteTags, []);
  assert.equal(result.remindAt, null);
  assert.equal(result.reminderDate, '');
  assert.equal(result.deferUntil, '');
  assert.equal(result.noteDate, '');
});

test('a dated action exposes its reminder date and time', () => {
  const result = run([NOTES[0]], { type: 'actions' }).find(r => r.label === 'Pay rent');
  assert.equal(result.type, 'task', 'a checkbox with @remind is still a task');
  assert.equal(result.reminderDate, '2026-09-15');
  assert.equal(result.remindAt.time, '10:00');
  assert.equal(result.remindAt.date, '2026-09-15');
  const reminderOnly = run([NOTES[1]], { type: 'reminders' })[0];
  assert.equal(reminderOnly.reminderDate, '2026-09-01');
  assert.equal(reminderOnly.remindAt.time, '', 'a date with no time reads as no time, not midnight');
});

test('the view type narrows to tasks or reminders', () => {
  const tasks = run(NOTES, { type: 'tasks' }).map(r => r.label).sort();
  assert.deepEqual(tasks, ['Buy milk', 'Pay rent', 'Renew the lease', 'Ship the release'],
    'a tasks view drops the bare reminder line');
  const reminders = run(NOTES, { type: 'reminders' }).map(r => r.label).sort();
  assert.deepEqual(reminders, ['Call the plumber'],
    'a reminders view keeps only reminder-only lines, not tasks that happen to have a date');
});

test('actionTypes and actionStatuses filter within an actions view', () => {
  const byType = run(NOTES, { type: 'actions', filters: { actionTypes: ['reminders'] } });
  assert.deepEqual(byType.map(r => r.label), ['Call the plumber'],
    'the plural spelling normalises to the singular type');
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { actionType: 'todos' } })
    .map(r => r.label).sort(), ['Buy milk', 'Pay rent', 'Renew the lease', 'Ship the release'],
    'todo/todos/task/tasks all mean task');
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { actionStatuses: ['done'] } })
    .map(r => r.label), ['Ship the release'], 'done is an alias for completed');
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { actionStatus: 'deferred' } })
    .map(r => r.label), ['Renew the lease']);
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { taskStatus: 'open' } })
    .map(r => r.label).sort(), ['Buy milk', 'Pay rent'],
    'taskStatus is the legacy spelling of actionStatuses');
});

test('a reminder date range filters on the reminder date, not the note date', () => {
  const inRange = run(NOTES, { type: 'actions', filters: { reminderFrom: '2026-09-01', reminderTo: '2026-09-15' } });
  assert.deepEqual(inRange.map(r => r.label).sort(), ['Call the plumber', 'Pay rent'],
    'both edges of the range are inclusive');
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { dueFrom: '2026-09-10' } })
    .map(r => r.label), ['Pay rent'], 'an open-ended from works alone');
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { remindTo: '2026-09-01' } })
    .map(r => r.label), ['Call the plumber']);
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { reminderFrom: '2027-01-01' } }), [],
    'an action with no reminder date cannot be inside a reminder range');
});

test('note filters still apply to an action view', () => {
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { tags: ['house'] } }).map(r => r.label),
    ['Call the plumber'], 'the tag scope picks notes, then actions come from those notes');
  assert.deepEqual(run(NOTES, { type: 'actions', filters: { titleContains: 'nothing' } }), []);
});

test('actions sort by every field and honour direction', () => {
  const labels = sort => run(NOTES, { type: 'actions', sort }).map(r => r.label);
  assert.deepEqual(labels({ field: 'title', direction: 'asc' }), [
    'Buy milk', 'Call the plumber', 'Pay rent', 'Renew the lease', 'Ship the release',
  ]);
  assert.deepEqual(labels({ field: 'title', direction: 'desc' }), [
    'Ship the release', 'Renew the lease', 'Pay rent', 'Call the plumber', 'Buy milk',
  ]);
  const byReminder = labels({ field: 'reminder', direction: 'asc' });
  assert.equal(byReminder[byReminder.length - 1], 'Pay rent',
    'the latest reminder sorts last; dateless actions fall back to the epoch');
  assert.equal(labels({ field: 'reminder', direction: 'desc' })[0], 'Pay rent');
  // created/modified read the source note, so same-note actions tie and break
  // by note title then key -- a stable order, not an arbitrary one.
  assert.deepEqual(labels({ field: 'created', direction: 'asc' }).length, 5);
  assert.deepEqual(labels({ field: 'modified', direction: 'desc' }).length, 5);
});

test('the limit trims an action view after sorting', () => {
  const results = run(NOTES, { type: 'actions', sort: { field: 'title', direction: 'asc' }, limit: 2 });
  assert.deepEqual(results.map(r => r.label), ['Buy milk', 'Call the plumber']);
});

test('the same note handed in twice yields its actions once', () => {
  const dupe = note('d', '- [ ] Water the plants');
  assert.equal(run([dupe, dupe], { type: 'actions' }).length, 1,
    'a note reachable twice must not double every row it contributes');
  // Two identical lines at different places in one note are two real actions:
  // the user wrote the line twice and can tick each independently.
  const twice = note('e', ['- [ ] Water the plants', '- [ ] Water the plants'].join('\n'));
  assert.equal(run([twice], { type: 'actions' }).length, 2);
});

test('a caller can supply its own reminder parser', () => {
  const parser = {
    parse: text => (String(text).includes('!!') ? { date: '2026-12-25', time: '', at: new Date('2026-12-25T00:00:00Z') } : null),
    strip: text => String(text).replace(/!!/g, '').trim(),
  };
  const results = run([note('c', 'Wrap the presents !!')], { type: 'reminders' }, { parser });
  assert.deepEqual(results.map(r => r.label), ['Wrap the presents']);
  assert.equal(results[0].reminderDate, '2026-12-25');
  // reminderParser is the older name for the same option.
  assert.equal(run([note('c', 'Wrap the presents !!')], { type: 'reminders' },
    { reminderParser: parser }).length, 1);
});

test('smartViewQuery routes by type and an unknown type falls back to notes', () => {
  assert.equal(helpers.smartViewQuery(NOTES, { type: 'notes' }).length, 2, 'a notes view returns notes');
  assert.equal(helpers.smartViewQuery(NOTES, { type: 'nonsense' }).length, 2,
    'an unrecognised type is treated as notes rather than returning nothing');
  assert.equal(helpers.smartViewQuery(NOTES, { type: 'actions' }, { now: NOW }).length, 5);
});

test('grouping action results reads the note they came from', () => {
  const results = run(NOTES, { type: 'actions' });
  const byTag = helpers.smartViewGroup(results, { by: 'tag' });
  assert.deepEqual(byTag.map(g => g.label), ['home', 'house', 'No tag'],
    'action results expose their note tags as noteTags, and grouping must find them');
  const tagged = note('t', '- [ ] Read the deed\nkind:: legal', { tags: [] });
  const propResults = run([tagged], { type: 'actions' });
  const byProperty = helpers.smartViewGroup(propResults, { by: 'kind' });
  assert.deepEqual(byProperty.map(g => g.label), ['legal', 'No kind'],
    'grouping by a body property must read the source note body, not the empty result');
});

test('grouping can be told how to read a value', () => {
  const results = helpers.smartViewQueryNotes([note('n1', 'x', { title: 'Alpha' })], {});
  const groups = helpers.smartViewGroup(results, { by: 'anything' }, { valueFor: n => n.title });
  assert.deepEqual(groups.map(g => g.label), ['Alpha', 'No anything']);
  const blank = helpers.smartViewGroup(results, { by: 'anything' }, { valueFor: () => null });
  assert.deepEqual(blank.map(g => g.label), ['No anything'],
    'a reader returning nothing puts the row in the unfiled bucket');
});

test('an empty or malformed group spec means one flat bucket', () => {
  const results = helpers.smartViewQueryNotes([note('n1', 'x')], {});
  for (const spec of [null, undefined, 'tag', { by: '   ' }, {}]) {
    const groups = helpers.smartViewGroup(results, spec);
    assert.equal(groups.length, 1, `${JSON.stringify(spec)} should not group`);
    assert.equal(groups[0].label, '');
  }
});
