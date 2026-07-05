const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

const NOW = new Date('2026-07-05T09:00:00Z');
const DAYS = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAYS).toISOString();

test('digestStaleTodoItems surfaces open todos from long-untouched notes, oldest first', () => {
  const notes = [
    { id: 'fresh', title: 'Fresh', modifiedAt: iso(1) },
    { id: 'stale20', title: 'Stale 20d', modifiedAt: iso(20) },
    { id: 'stale40', title: 'Stale 40d', modifiedAt: iso(40) },
  ];
  const tasks = [
    { type: 'todo', checked: false, noteId: 'fresh', label: 'active work', key: 't1' },
    { type: 'todo', checked: false, noteId: 'stale20', label: 'forgotten a', key: 't2' },
    { type: 'todo', checked: true, noteId: 'stale40', label: 'done long ago', key: 't3' },
    { type: 'todo', checked: false, noteId: 'stale40', label: 'forgotten b', key: 't4' },
    { type: 'reminder', checked: false, noteId: 'stale40', label: 'not a todo', key: 't5' },
  ];
  const stale = helpers.digestStaleTodoItems(tasks, notes, { now: NOW, staleDays: 14, limit: 6 });
  assert.deepEqual(stale.map(item => item.key), ['t4', 't2'], 'oldest note first; checked/reminder/fresh excluded');
  assert.ok(stale[0].staleSince);

  const limited = helpers.digestStaleTodoItems(tasks, notes, { now: NOW, staleDays: 14, limit: 1 });
  assert.equal(limited.length, 1);
});

test('digestUnlinkedRecentNotes finds fresh notes with no links, skipping daily notes', () => {
  const notes = [
    { id: 'orphan', title: 'New Idea', modifiedAt: iso(2) },
    { id: 'linkedOut', title: 'Has outbound', modifiedAt: iso(1) },
    { id: 'linkedIn', title: 'Has inbound', modifiedAt: iso(1) },
    { id: 'old', title: 'Old orphan', modifiedAt: iso(30) },
    { id: 'daily', title: helpers.todayIsoDate(NOW), modifiedAt: iso(0) },
  ];
  const links = [{ source: 'linkedOut', target: 'linkedIn' }];
  const orphans = helpers.digestUnlinkedRecentNotes(notes, links, { now: NOW, days: 7, limit: 6 });
  assert.deepEqual(orphans.map(n => n.id), ['orphan']);
  assert.equal(orphans[0].title, 'New Idea');
});

test('today recap context and prompt include the digest facts', () => {
  const notes = [
    { id: 'stale', title: 'Stale Note', modifiedAt: iso(30), tags: [], date: iso(30), blocks: [] },
    { id: 'orphan', title: 'Orphan Note', modifiedAt: iso(1), tags: [], date: iso(1), blocks: [] },
  ];
  const tasks = [{ type: 'todo', checked: false, noteId: 'stale', noteTitle: 'Stale Note', label: 'circle back', key: 'k1' }];
  const context = helpers.contextualAiBuildTodayRecapContext({
    notes, tasks, reminders: [], agendaItems: [], links: [], now: NOW,
  });
  assert.equal(context.staleTodos.length, 1);
  assert.deepEqual(context.unlinkedNotes.map(n => n.id), ['orphan']);

  const prompt = helpers.contextualAiBuildTodayRecapPrompt(context);
  assert.match(prompt, /Stale todos \(their notes untouched for 2\+ weeks\):/);
  assert.match(prompt, /circle back/);
  assert.match(prompt, /Recently edited notes with no links in or out:/);
  assert.match(prompt, /- Orphan Note/);
});
