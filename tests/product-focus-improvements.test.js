const test = require('node:test');
const assert = require('node:assert/strict');

const search = require('../src/editor/searchNavigation');
const connections = require('../src/editor/connectionsModel');
const versionDiff = require('../src/app/versionDiff');
const helpers = require('../src/app/appHelpers');
const { createVaultWatcher, isRelevantVaultFile } = require('../lib/vaultWatcher');

test('opened-note search finds literal case-insensitive matches', () => {
  assert.deepEqual(search.textMatchOffsets('Alpha beta ALPHA', ' alpha '), [
    { start: 0, end: 5 },
    { start: 11, end: 16 },
  ]);
  assert.deepEqual(search.textMatchOffsets('anything', ''), []);
});

test('connection suggestions exclude linked and ignored notes and append portable markdown', () => {
  const suggestions = connections.suggestedConnections({
    noteId: 'a',
    related: [{ noteId: 'b' }, { noteId: 'c' }, { noteId: 'd' }, { noteId: 'c' }],
    links: [{ source: 'a', target: 'b' }],
    ignoredIds: ['d'],
  });
  assert.deepEqual(suggestions.map(item => item.noteId), ['c']);
  const appended = connections.appendConnectionMarkdown('A useful note.', 'Connected idea');
  assert.match(appended, /## Connections\n- \[\[Connected idea\]\]/);
  assert.equal(connections.appendConnectionMarkdown(appended, 'Connected idea'), appended);
});

test('connection suggestions work without AI and explain deterministic signals', () => {
  const notes = [
    { id: 'a', title: 'Launch decision', tags: ['project'] },
    { id: 'b', title: 'Launch risks', tags: ['project', 'review'] },
    { id: 'c', title: 'Grocery list', tags: ['personal'] },
  ];
  const suggestions = connections.suggestedConnections({
    noteId: 'a',
    currentNote: notes[0],
    notes,
  });
  assert.equal(suggestions[0].noteId, 'b');
  assert.equal(suggestions[0].reason, 'Shares #project · Both mention launch');
  assert.equal(suggestions.some(item => item.noteId === 'c'), false);
});

test('connection ranking bounds deterministic work for large vaults', () => {
  const notes = Array.from({ length: 2400 }, (_, index) => ({
    id: `n${index}`,
    title: index === 2399 ? 'Focused launch follow-up' : `Unrelated ${index}`,
    tags: index === 2399 ? ['focus'] : [],
  }));
  const suggestions = connections.suggestedConnections({
    noteId: 'current',
    currentNote: { id: 'current', title: 'Focused launch', tags: ['focus'] },
    notes,
    candidateLimit: 300,
  });
  assert.equal(suggestions[0].noteId, 'n2399');
  assert.ok(suggestions[0].connectionScore > 0);
});

test('version diff reports added and removed lines', () => {
  const diff = versionDiff.lineDiff('one\ntwo\nthree', 'one\nchanged\nthree');
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.rows.filter(row => row.type !== 'same'), [
    { type: 'remove', text: 'two' },
    { type: 'add', text: 'changed' },
  ]);
});

test('Today digest deduplicates actions and resurfaces explainable context', () => {
  const repeated = { noteId: 'n1', label: 'Send brief', remindAt: { date: '2026-07-10', time: '09:00' } };
  assert.equal(helpers.digestUniqueActionItems([repeated, { ...repeated }]).length, 1);

  const now = new Date('2026-07-10T12:00:00Z');
  const notes = [
    { id: 'pinned', title: 'Strategy', pinned: true, modifiedAt: '2026-07-05T12:00:00Z', body: '' },
    { id: 'loop', title: 'Launch', modifiedAt: '2026-07-04T12:00:00Z', body: '- [ ] Confirm date' },
    { id: 'daily', title: '2026-07-04', modifiedAt: '2026-07-04T12:00:00Z', body: '' },
  ];
  const resurfaced = helpers.digestResurfacedNotes(notes, [], { now });
  assert.deepEqual(resurfaced.map(note => note.id), ['pinned', 'loop']);
  assert.deepEqual(resurfaced.map(note => note.reason), ['Pinned', 'Open loop']);
});

test('vault watcher filters private folders and debounces Markdown changes', async () => {
  assert.equal(isRelevantVaultFile('note.md'), true);
  assert.equal(isRelevantVaultFile('.meta.json'), false);
  assert.equal(isRelevantVaultFile('.versions/note.md'), false);
  let callback = null;
  const changes = [];
  const watcher = createVaultWatcher({
    debounceMs: 50,
    onChange: event => changes.push(event),
    watch: (_path, _options, listener) => {
      callback = listener;
      return { on() {}, close() {} };
    },
  });
  watcher.refresh([{ id: 'v1', path: 'C:\\vault' }]);
  watcher.markInternal('v1', 250);
  callback('change', 'internal.md');
  await new Promise(resolve => setTimeout(resolve, 260));
  callback('change', 'one.md');
  callback('change', 'one.md');
  callback('change', '.meta.json');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fileName, 'one.md');
  watcher.close();
});
