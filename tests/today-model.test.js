const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/features/today/todayModel.js');

const NOW = new Date('2026-07-12T10:00:00.000Z');

test('Today actionable count includes only unique due and overdue work', () => {
  const tasks = [
    { noteId: 'a', blockId: 'task-a', label: 'Send brief', checked: false, remindAt: { date: '2026-07-12' } },
    { noteId: 'b', label: 'Past due', checked: false, remindAt: { date: '2026-07-10' } },
    { noteId: 'c', label: 'Tomorrow', checked: false, remindAt: { date: '2026-07-13' } },
    { noteId: 'd', label: 'Done', checked: true, remindAt: { date: '2026-07-11' } },
    { noteId: 'e', label: 'Deferred', checked: false, deferUntil: '2026-07-14', remindAt: { date: '2026-07-10' } },
    { noteId: 'f', label: 'Unscheduled', checked: false },
    { noteId: 'h', label: 'Snoozed call', checked: false, remindAt: { date: '2026-07-11' } },
  ];
  const reminders = [
    { noteId: 'a', text: 'Send brief', remindAt: { date: '2026-07-12' } },
    { noteId: 'g', text: 'Call back', remindAt: { date: '2026-07-12' } },
    { noteId: 'h', text: 'Snoozed call', status: 'snoozed', snoozedUntil: NOW.getTime() + 60000, remindAt: { date: '2026-07-11' } },
  ];

  const items = model.todayActionableItems({ tasks, reminders, now: NOW });
  assert.equal(model.todayActionableCount({ tasks, reminders, now: NOW }), 3);
  assert.deepEqual(items.map(item => item.title), ['Past due', 'Call back', 'Send brief']);
  assert.deepEqual(items.map(item => item.reason), ['Overdue', 'Due today', 'Due today']);
});

test('Worth revisiting is deterministic, explained, deduplicated, and capped at three', () => {
  const items = model.todayReviewItems({
    staleTasks: [
      { noteId: 'stale', noteTitle: 'Old project', blockId: 'todo-1', label: 'Send the proposal' },
      { noteId: 'same', noteTitle: 'Shared note', blockId: 'todo-2', label: 'Follow up' },
    ],
    unlinkedNotes: [
      { id: 'unlinked', title: 'Loose thought' },
      { id: 'same', title: 'Shared note' },
    ],
    resurfacedNotes: [
      { id: 'pinned', title: 'Planning map', reason: 'Pinned' },
      { id: 'loop', title: 'Launch checklist', reason: 'Open loop' },
    ],
    now: NOW,
  });

  assert.equal(items.length, 3);
  assert.equal(items[0].id, 'stale:stale');
  assert.deepEqual(items.map(item => item.noteId), ['stale', 'unlinked', 'pinned']);
  assert.deepEqual(items.map(item => item.reason), [
    'Open task: Send the proposal',
    'Edited recently and not linked to another note',
    'Pinned context from the last few weeks',
  ]);
});

test('same-day notes are identifiable for exclusion from resurfacing', () => {
  assert.equal(model.noteTouchesToday({ id: 'created', date: '2026-07-12T08:00:00.000Z' }, NOW), true);
  assert.equal(model.noteTouchesToday({ id: 'modified', date: '2026-07-01', modifiedAt: '2026-07-12T09:00:00.000Z' }, NOW), true);
  assert.equal(model.noteTouchesToday({ id: 'daily', title: '2026-07-12', date: '2026-07-01' }, NOW), true);
  assert.equal(model.noteTouchesToday({ id: 'past', date: '2026-07-11T17:00:00.000Z' }, NOW), false);
});

test('Worth revisiting supports persistent dismiss and seven-day snooze controls', () => {
  const candidate = { id: 'note-a', title: 'Review me', reason: 'Recently changed' };
  const initial = model.todayReviewItems({ resurfacedNotes: [candidate], now: NOW });
  assert.equal(initial.length, 1);

  const snoozed = model.updateTodayReviewState({}, initial[0].id, 'snoozed', { now: NOW });
  assert.equal(model.todayReviewItems({ resurfacedNotes: [candidate], reviewState: snoozed, now: NOW }).length, 0);
  assert.equal(model.todayReviewItems({
    resurfacedNotes: [candidate], reviewState: snoozed, now: new Date('2026-07-20T10:00:00.000Z'),
  }).length, 1);

  const dismissed = model.updateTodayReviewState({}, initial[0].id, 'dismissed', { now: NOW });
  assert.equal(model.todayReviewItems({
    resurfacedNotes: [candidate], reviewState: dismissed, now: new Date('2027-07-20T10:00:00.000Z'),
  }).length, 0);
});

test('Review state normalization rejects malformed entries and bounds stored history', () => {
  const items = {};
  for (let index = 0; index < 220; index += 1) {
    items[`item-${index}`] = { action: 'dismissed', updatedAt: new Date(NOW.getTime() + index).toISOString() };
  }
  items.invalid = { action: 'unknown' };
  const normalized = model.normalizeTodayReviewState({ version: 99, items });
  assert.equal(normalized.version, model.REVIEW_STATE_VERSION);
  assert.equal(Object.keys(normalized.items).length, 200);
  assert.equal(normalized.items.invalid, undefined);
});
