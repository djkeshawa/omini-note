const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// The Today/agenda layer: which notes and actions belong to a day, what each
// row says about itself, and the schedule phrases a user can type. All of it
// is local-time arithmetic, so every case here fixes `now` at local noon --
// a UTC midnight would land on a different day depending on the machine.

const NOON = h => new Date(`2026-08-05T${String(h).padStart(2, '0')}:00:00`);
const NOW = NOON(12);            // a Wednesday
const TODAY = '2026-08-05';
const YESTERDAY = '2026-08-04';
const TOMORROW = '2026-08-06';
const at = (key, hour = 9) => new Date(`${key}T${String(hour).padStart(2, '0')}:00:00`).toISOString();

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? '', tags: over.tags ?? [],
  date: over.date ?? at(TODAY), modifiedAt: over.modifiedAt ?? over.date ?? at(TODAY), ...over,
});

const task = (over = {}) => ({
  type: 'todo', noteId: 'n1', noteTitle: 'Note n1', label: 'A task', text: 'A task',
  checked: false, isReminderOnly: false, ...over,
});

const reminder = (date, over = {}) => ({
  type: 'reminder', isReminderOnly: true, noteId: 'n1', noteTitle: 'Note n1',
  label: 'A reminder', remindAt: { date, time: '', at: new Date(`${date}T09:00:00`) }, ...over,
});

test('date ranges cover today, yesterday, the week and the month', () => {
  assert.deepEqual(helpers.rollupDateRangeBounds('today', NOW), { start: TODAY, end: TODAY, today: TODAY });
  assert.deepEqual(helpers.rollupDateRangeBounds('yesterday', NOW), { start: YESTERDAY, end: YESTERDAY, today: TODAY });
  assert.equal(helpers.rollupDateRangeBounds('week', NOW).start, '2026-08-03', 'a Monday-start week begins on the Monday');
  assert.equal(helpers.rollupDateRangeBounds('week', NOW, 'sunday').start, '2026-08-02');
  assert.equal(helpers.rollupDateRangeBounds('month', NOW).start, '2026-08-01');
  assert.equal(helpers.rollupDateRangeBounds('decade', NOW).start, TODAY, 'an unknown range is treated as today');

  assert.equal(helpers.rollupDateKeyInRange(TODAY, 'today', NOW), true);
  assert.equal(helpers.rollupDateKeyInRange(YESTERDAY, 'today', NOW), false);
  assert.equal(helpers.rollupDateKeyInRange(YESTERDAY, 'week', NOW), true);
  assert.equal(helpers.rollupDateKeyInRange('not-a-date', 'week', NOW), false);
  assert.equal(helpers.rollupDateKeyInRange('', 'today', NOW), false);
});

test('a note is dated by its title, its creation or its last edit', () => {
  const dated = note('d', { title: `${TODAY} Daily`, date: at(YESTERDAY), modifiedAt: at(TOMORROW) });
  assert.equal(helpers.rollupTitleDateKey(dated), TODAY, 'a date at the start of the title is the note date');
  assert.equal(helpers.rollupTitleDateKey({ title: 'Nope' }), '');
  assert.equal(helpers.rollupTitleDateKey({ title: '2026-13-45' }), '', 'a date that does not exist is not a date');
  assert.equal(helpers.rollupTitleDateKey(null), '');

  assert.equal(helpers.rollupNoteDateKey(dated, 'title-date'), TODAY);
  assert.equal(helpers.rollupNoteDateKey(dated, 'created'), YESTERDAY);
  assert.equal(helpers.rollupNoteDateKey(dated, 'modified'), TOMORROW);
  assert.equal(helpers.rollupNoteDateKey(dated, 'nonsense'), YESTERDAY, 'an unknown grouping means created');
  assert.equal(helpers.rollupNoteDateKey({ date: at(TODAY) }, 'title-date'), TODAY,
    'a note with no date in its title falls back to when it was created');
  assert.equal(helpers.rollupNoteDateKey({ date: at(TODAY) }, 'modified'), TODAY,
    'a note never modified was last touched when it was created');
  assert.equal(helpers.rollupNoteDateKey(null), '');
});

test('notes group by day, newest day first and newest note first inside it', () => {
  const notes = [
    note('a', { date: at(TODAY, 9) }),
    note('b', { date: at(TODAY, 17) }),
    note('c', { date: at(YESTERDAY) }),
    note('old', { date: at('2026-07-01') }),
    { id: 'undated', title: 'No date' },
  ];
  const groups = helpers.rollupGroupNotes(notes, { range: 'week', now: NOW });
  assert.deepEqual(groups.map(g => g.key), [TODAY, YESTERDAY], 'only days inside the range, newest first');
  assert.deepEqual(groups[0].notes.map(n => n.id), ['b', 'a'], 'the later note of the day sorts first');
  assert.equal(groups[0].isOlder, false);
  assert.equal(groups[1].isOlder, false, 'yesterday is not "older" -- older means before yesterday');
  assert.ok(groups[0].date instanceof Date);

  const month = helpers.rollupGroupNotes(notes, { range: 'month', now: NOW });
  assert.deepEqual(month.map(g => g.key), [TODAY, YESTERDAY], 'a July note is outside August');
  assert.deepEqual(helpers.rollupGroupNotes(null, { now: NOW }), []);
  assert.equal(helpers.rollupIsOlderGroup('2026-07-01', NOW), true);
  assert.equal(helpers.rollupIsOlderGroup('not a date', NOW), false);
});

test('a note preview strips markdown down to something readable', () => {
  const body = '## A heading\n- [ ] a task\n- a bullet\nSee [[Another Note]] and `code`\n\n> quoted';
  assert.equal(helpers.rollupNotePreview({ body }, 1), 'A heading');
  assert.equal(helpers.rollupNotePreview({ body }, 3), 'A heading · a task · a bullet');
  assert.match(helpers.rollupNotePreview({ body }, 4), /See Another Note and code/);
  assert.equal(helpers.rollupNotePreview({ body: '' }), '');
  assert.equal(helpers.rollupNotePreview(null), '');
  assert.equal(helpers.rollupNotePreview({ body }, 'lots'), 'A heading · a task',
    'an unreadable line count falls back to two');
});

test('open tasks are filtered by the day of the note they live in', () => {
  const notes = [note('n1'), note('n2', { date: at(YESTERDAY), modifiedAt: at(YESTERDAY) })];
  const items = [
    task({ label: 'Today task' }),
    task({ noteId: 'n2', noteTitle: 'Note n2', label: 'Yesterday task' }),
    task({ label: 'Done', checked: true }),
    task({ label: 'A reminder', isReminderOnly: true }),
    task({ label: 'Typed reminder', type: 'reminder' }),
    task({ label: 'Deferred', text: 'Deferred @defer 2030-01-01' }),
    task({ noteId: 'gone', noteTitle: 'Detached', noteDate: at(TODAY), label: 'Orphan' }),
    null,
    undefined,
  ];
  const today = helpers.rollupFilterTaskItems(items, notes, { range: 'today', now: NOW });
  assert.deepEqual(today.map(t => t.label), ['Orphan', 'Today task'],
    'a task whose note is gone is still placed by the date it carries, and rows sort by note title');
  const week = helpers.rollupFilterTaskItems(items, notes, { range: 'week', now: NOW });
  assert.deepEqual(week.map(t => t.label).sort(), ['Orphan', 'Today task', 'Yesterday task']);
  assert.deepEqual(helpers.rollupFilterTaskItems(null, null, { now: NOW }), []);

  // An empty entry in the list is skipped, not read. Testing whether it was
  // deferred before checking it exists at all took the whole panel down.
  assert.deepEqual(helpers.rollupFilterTaskItems([null], notes, { now: NOW }), []);
  assert.equal(helpers.agendaIsDeferred(null, NOW), false);
  assert.equal(helpers.agendaIsDeferred(undefined, NOW), false);
});

test('reminders are stamped overdue, due today or upcoming and never lost', () => {
  const items = [
    reminder(TODAY, { label: 'Due today' }),
    reminder(YESTERDAY, { label: 'Overdue' }),
    reminder(TOMORROW, { label: 'Tomorrow' }),
    reminder('2026-09-01', { label: 'Next month' }),
    { label: 'No date at all', remindAt: null },
    reminder(TOMORROW, { label: 'Deferred', deferUntil: '2030-01-01' }),
  ];
  const today = helpers.rollupFilterReminderItems(items, [], { range: 'today', now: NOW });
  assert.deepEqual(today.map(r => r.label), ['Overdue', 'Due today'],
    'an overdue reminder always shows, whatever range is asked for');
  assert.deepEqual(today.map(r => r.rollupStatus), ['overdue', 'due-today']);

  // A reminder's date is a due date, so a wider range reaches forward into it.
  // NOW is a Wednesday, so this week runs 2026-08-03 to 2026-08-09.
  const week = helpers.rollupFilterReminderItems(items, [], { range: 'week', now: NOW });
  assert.deepEqual(week.map(r => r.label), ['Overdue', 'Due today', 'Tomorrow']);
  assert.equal(week.find(r => r.label === 'Tomorrow').rollupStatus, 'upcoming');
  assert.ok(!week.some(r => r.label === 'Next month'), 'next month is not this week');

  const month = helpers.rollupFilterReminderItems(items, [], { range: 'month', now: NOW });
  assert.deepEqual(month.map(r => r.label), ['Overdue', 'Due today', 'Tomorrow']);
  assert.ok(!month.some(r => r.label === 'Next month'), 'and September is not August');
  assert.ok(!month.some(r => r.label === 'Deferred'), 'a deferred reminder is hidden until its date');
  assert.ok(!month.some(r => r.label === 'No date at all'), 'a reminder with no date cannot be due');
  assert.deepEqual(
    helpers.rollupFilterReminderItems([reminder('2026-08-31')], [], { range: 'month', now: NOW }).map(r => r.label),
    ['A reminder'], 'the month range reaches the last day of the month');
  assert.equal(helpers.rollupFilterReminderItems([reminder(TOMORROW)], [], { range: 'today', now: NOW }).length, 0,
    'but "today" still means overdue and due today only');

  // A reminder timestamped rather than keyed still lands on the right day.
  const timestamped = helpers.rollupFilterReminderItems(
    [{ label: 'From a timestamp', remindAt: { at: at(TODAY) } }], [], { now: NOW });
  assert.equal(timestamped[0].rollupDateKey, TODAY);
});

test('every action row explains why it is on the list', () => {
  const daily = note('daily', { title: TODAY });
  assert.equal(helpers.rollupTaskReasonLabel(task({ noteId: 'daily' }), daily, NOW), 'unscheduled daily task');
  assert.equal(helpers.rollupTaskReasonLabel(task({ remindAt: { date: TODAY } }), daily, NOW), "from today's daily note");
  assert.equal(helpers.rollupTaskReasonLabel(task(), note('n1'), NOW), 'captured today');
  assert.equal(helpers.rollupTaskReasonLabel(task(), note('n1', { date: at('2026-01-01'), modifiedAt: at(TODAY) }), NOW), 'modified today');
  assert.equal(helpers.rollupTaskReasonLabel(task(), null, NOW), 'source note', 'a task with no note still says where it is from');
  assert.equal(helpers.rollupTaskReasonLabel(task({ noteDate: at('2026-01-01') }),
    note('n1', { date: at('2026-01-01'), modifiedAt: at('2026-01-01') }), NOW), 'from note');

  assert.equal(helpers.rollupReminderReasonLabel({ rollupStatus: 'overdue' }), 'overdue');
  assert.equal(helpers.rollupReminderReasonLabel({ rollupStatus: 'due-today' }), 'due today');
  assert.equal(helpers.rollupReminderReasonLabel({ rollupStatus: 'upcoming' }), 'upcoming');
  assert.equal(helpers.rollupReminderReasonLabel(reminder('2020-01-01')), 'overdue',
    'an undecorated reminder is judged by its own date');
  assert.equal(helpers.rollupReminderReasonLabel(reminder(helpers.todayIsoDate())), 'due today');
  assert.equal(helpers.rollupReminderReasonLabel({}), 'upcoming');
});

test('an action carries a status derived from its date and its state', () => {
  assert.equal(helpers.agendaActionStatus(task({ checked: true }), NOW), 'completed');
  assert.equal(helpers.agendaActionStatus(task({ text: 'x @defer 2030-01-01' }), NOW), 'deferred');
  assert.equal(helpers.agendaActionStatus(task(), NOW), 'unscheduled');
  assert.equal(helpers.agendaActionStatus(reminder(YESTERDAY), NOW), 'overdue');
  assert.equal(helpers.agendaActionStatus(reminder(TODAY), NOW), 'today');
  assert.equal(helpers.agendaActionStatus(reminder(TOMORROW), NOW), 'upcoming');

  assert.equal(helpers.agendaActionReasonLabel(task({ checked: true }), null, NOW), 'completed');
  assert.equal(helpers.agendaActionReasonLabel(task(), null, NOW), 'source note',
    'an unscheduled action explains itself the way a task does');
  assert.equal(helpers.agendaActionReasonLabel(reminder(YESTERDAY), null, NOW), 'overdue');
  assert.equal(helpers.agendaActionReasonLabel(reminder(TODAY), null, NOW), 'due today');
  assert.equal(helpers.agendaActionReasonLabel(task({ remindAt: { date: TODAY } }), null, NOW), 'scheduled today',
    'a task due today is scheduled; only a reminder is "due"');
  assert.equal(helpers.agendaActionReasonLabel(reminder(TOMORROW), null, NOW), 'upcoming');
});

test('action detail merges the note and the item, preferring the note', () => {
  const notes = [note('n1', { title: `${TODAY} Daily`, tags: ['work'], modifiedAt: at(TODAY) })];
  const detail = helpers.agendaActionDetail(
    task({ noteTags: ['work', 'urgent', '  '], remindAt: { date: TOMORROW, time: '14:30' }, deferUntil: '' }),
    notes, { now: NOW });
  assert.equal(detail.status, 'upcoming');
  assert.equal(detail.sourceNoteTitle, `${TODAY} Daily`, 'the live note title wins over the copy on the item');
  assert.equal(detail.titleDate, TODAY);
  assert.equal(detail.createdDate, TODAY);
  assert.equal(detail.modifiedDate, TODAY);
  assert.equal(detail.scheduledDate, TOMORROW);
  assert.equal(detail.scheduledTime, '14:30');
  assert.deepEqual(detail.inheritedTags, ['work', 'urgent'],
    'the note tags and the item tags are merged, deduplicated and cleaned');

  // With no note in the vault the item's own copy of everything is used.
  const detached = helpers.agendaActionDetail(
    task({ noteId: 'gone', noteTitle: `${YESTERDAY} Daily`, noteDate: at(YESTERDAY), noteModifiedAt: at(YESTERDAY) }),
    notes, { now: NOW });
  assert.equal(detached.sourceNoteTitle, `${YESTERDAY} Daily`);
  assert.equal(detached.titleDate, YESTERDAY);
  assert.equal(detached.createdDate, YESTERDAY);
  assert.equal(detached.modifiedDate, YESTERDAY);
  assert.deepEqual(detached.inheritedTags, []);
  assert.equal(helpers.agendaActionDetail({}, [], { now: NOW }).sourceNoteTitle, 'Untitled');
});

test('the agenda can be filtered by status, tag and source note', () => {
  const notes = [note('n1', { tags: ['work'] }), note('n2', { tags: ['home'] })];
  const items = [
    task({ label: 'Open one' }),
    task({ label: 'Done one', checked: true }),
    task({ label: 'Hidden', text: 'Hidden @defer 2030-01-01' }),
    reminder(TODAY, { label: 'Due now' }),
    task({ noteId: 'n2', noteTitle: 'Note n2', label: 'Home task' }),
  ];
  const decorated = helpers.agendaDecorateActionItems(items, notes, { now: NOW });
  assert.equal(decorated.length, items.length, 'decorating never drops a row');
  assert.equal(decorated[0].actionStatus, 'unscheduled');
  assert.ok(decorated[0].actionDetail, 'each row carries its detail for the UI to read');

  const all = helpers.agendaFilterActionItems(items, notes, {}, { now: NOW });
  assert.deepEqual(all.map(i => i.label), ['Open one', 'Done one', 'Due now', 'Home task'],
    '"all" means everything except what is deferred out of sight');
  assert.deepEqual(helpers.agendaFilterActionItems(items, notes, { status: 'deferred' }, { now: NOW })
    .map(i => i.label), ['Hidden'], 'asking for deferred is the only way to see them');
  assert.deepEqual(helpers.agendaFilterActionItems(items, notes, { status: 'completed' }, { now: NOW })
    .map(i => i.label), ['Done one']);
  assert.deepEqual(helpers.agendaFilterActionItems(items, notes, { tag: 'home' }, { now: NOW })
    .map(i => i.label), ['Home task']);
  assert.deepEqual(helpers.agendaFilterActionItems(items, notes, { sourceNoteId: 'n2' }, { now: NOW })
    .map(i => i.label), ['Home task']);
  assert.deepEqual(helpers.agendaFilterActionItems(items, notes, { tag: 'nothing' }, { now: NOW }), []);
});

test('schedule phrases are parsed, and nonsense is refused with a reason', () => {
  const parse = (text, now = NOW) => helpers.agendaParseScheduleInput(text, { now });
  assert.deepEqual(parse('today'), { ok: true, date: TODAY, time: '', raw: 'today' });
  assert.equal(parse('Tomorrow.').date, TOMORROW, 'case and trailing punctuation do not matter');
  assert.deepEqual(parse('in 3 hours'), { ok: true, date: TODAY, time: '15:00', raw: 'in 3 hours' });
  assert.equal(parse('in 1 hour').time, '13:00', 'the singular reads the same as the plural');

  // NOW is a Wednesday: "friday" is this week, "wednesday" is next week.
  assert.equal(parse('friday').date, '2026-08-07');
  assert.equal(parse('wednesday').date, '2026-08-12', 'the day you are already on means the next one');
  assert.equal(parse('next friday').date, '2026-08-07',
    '"next" only changes today: any other day already means the coming one');
  assert.equal(parse('next wednesday').date, '2026-08-12');
  assert.equal(parse('friday 5pm').time, '17:00');
  assert.equal(parse('friday 9:30').time, '09:30');
  assert.equal(parse('friday 12am').time, '00:00');
  assert.equal(parse('friday 12pm').time, '12:00');

  assert.deepEqual(parse(''), { ok: false, error: 'Enter a schedule phrase.' });
  assert.deepEqual(parse('   '), { ok: false, error: 'Enter a schedule phrase.' });
  assert.equal(parse('sometime soon').error, 'Unsupported schedule phrase.');
  assert.equal(parse('in 0 hours').error, 'Use a positive hour count.');
  assert.equal(parse('friday 25:00').error, 'Use a valid time.');
  assert.equal(parse('friday 13pm').error, 'Use a valid time.');
  assert.equal(parse('friday 9:99').error, 'Use a valid time.');
  assert.equal(helpers.agendaParseScheduleInput('today', { now: 'not a date' }).error, 'Invalid reference time.');
});

test('a quick task lands under a Tasks heading, or at the end if there is none', () => {
  assert.equal(helpers.rollupAppendQuickTask('Existing.', 'Buy milk'), 'Existing.\n- [ ] Buy milk\n');
  assert.equal(helpers.rollupAppendQuickTask('', 'Buy milk'), '- [ ] Buy milk\n');
  assert.equal(helpers.rollupAppendQuickTask('Existing.', '   '), 'Existing.',
    'an empty task changes nothing at all');

  const withHeading = '## Tasks\n- [ ] first\n\n## Notes\nprose';
  assert.equal(helpers.rollupAppendQuickTask(withHeading, 'second'),
    '## Tasks\n- [ ] first\n- [ ] second\n\n## Notes\nprose\n',
    'the task joins the Tasks section, not the end of the note');

  const blankSlot = '## Tasks\n- [ ] \n\n## Notes';
  assert.equal(helpers.rollupAppendQuickTask(blankSlot, 'fills the slot'),
    '## Tasks\n- [ ] fills the slot\n\n## Notes\n', 'an empty checkbox is filled rather than added to');

  assert.equal(helpers.rollupAppendQuickTask('## Tasks', 'first'), '## Tasks\n- [ ] first\n');
  assert.equal(helpers.rollupAppendQuickTask('# Journal\n## Tasks\n- [ ] a\n- [ ] b', 'c'),
    '# Journal\n## Tasks\n- [ ] a\n- [ ] b\n- [ ] c\n');
  assert.equal(helpers.rollupAppendQuickTask('## Tasks\r\n- [ ] a', 'b'), '## Tasks\n- [ ] a\n- [ ] b\n',
    'windows line endings are normalised when the Tasks section is rewritten');
});

test('a reflection section is appended without eating the note', () => {
  const appended = helpers.rollupAppendReflection('Existing body.', { now: NOW });
  assert.equal(appended, `Existing body.\n\n## Reflection - ${TODAY}\n\n- What stood out:\n- What I learned:\n- What to improve:\n`);
  assert.match(helpers.rollupAppendReflection('', { now: NOW }), /^## Reflection/);
  assert.match(helpers.rollupAppendReflection('   \n\n', { now: NOW }), /^## Reflection/);
});

test('the daily note is found by an exact date title', () => {
  const notes = [note('a', { title: 'Something else' }), note('b', { title: `  ${TODAY}  ` })];
  assert.equal(helpers.rollupFindDailyNote(notes, NOW).id, 'b');
  assert.equal(helpers.rollupFindDailyNote([note('a', { title: `${TODAY} Daily` })], NOW), null,
    'a note merely starting with the date is not the daily note');
  assert.equal(helpers.rollupFindDailyNote([], NOW), null);
  assert.equal(helpers.rollupFindDailyNote(null, NOW), null);
});
