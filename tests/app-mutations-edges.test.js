const test = require('node:test');
const assert = require('node:assert/strict');

const mutations = require('../src/app/appMutations.js');
const helpers = require('../src/app/appHelpers.js');

// The pure note mutations the renderer applies before anything is written:
// naming a note without colliding, cleaning its tags, renaming it everywhere
// it is linked from, and turning a plain mention into a link. Each one runs on
// plain data so it can be checked exactly here rather than through the UI.

const mdToBlocks = body => String(body || '').split('\n').map((content, i) => ({ id: `b${i}`, content }));
const blocksToMd = blocks => (blocks || []).map(b => b.content).join('\n');
const makeEmptyBlock = () => ({ id: 'empty', content: '' });
const CTX = {
  normalizeTagName: helpers.normalizeTagName,
  parseDefaultTags: helpers.parseDefaultTags,
  normalizeNoteBody: helpers.normalizeNoteBody,
  ensureScenePlotPoints: helpers.ensureScenePlotPoints,
  replaceWikiLinkTitle: helpers.replaceWikiLinkTitle,
  mdToBlocks,
  blocksToMd,
  makeEmptyBlock,
  resolveBlocksChange: (prev, next) => (typeof next === 'function' ? next(prev) : next),
  now: '2026-08-05T09:00:00.000Z',
};

const note = (id, over = {}) => ({ id, title: `Note ${id}`, body: '', blocks: [], tags: [], ...over });

test('a new note is never given a name another note already has', () => {
  const notes = [note('a', { title: 'Plan' }), note('b', { title: 'Plan 2' })];
  assert.equal(mutations.uniqueNoteTitle(notes, 'Plan'), 'Plan 3');
  assert.equal(mutations.uniqueNoteTitle(notes, 'Fresh'), 'Fresh');
  assert.equal(mutations.uniqueNoteTitle(notes, '  '), 'Untitled');
  assert.equal(mutations.uniqueNoteTitle(notes, 'Plan', 'a'), 'Plan',
    'renaming a note does not collide with the name it already has');
  assert.equal(mutations.uniqueNoteTitle([], 'Plan'), 'Plan');
  assert.equal(mutations.uniqueNoteTitle(null, 'Plan'), 'Plan');
  assert.equal(mutations.uniqueNoteTitle(notes), 'Untitled');
});

test('tags are cleaned, defaulted and deduplicated', () => {
  assert.deepEqual(mutations.cleanNoteTags(['Work Item', 'work-item', ''], 'daily, Daily', CTX.normalizeTagName, CTX.parseDefaultTags),
    ['work-item', 'daily']);
  assert.deepEqual(mutations.cleanNoteTags([], 'a,b', CTX.normalizeTagName, CTX.parseDefaultTags), ['a', 'b']);
  // Without helpers supplied the module falls back to its own cleaning.
  assert.deepEqual(mutations.cleanNoteTags(['Work Item'], 'daily , notes'), ['work-item', 'daily', 'notes']);
  assert.deepEqual(mutations.cleanNoteTags(), []);
  assert.deepEqual(mutations.cleanNoteTags(null, null), []);
});

test('tags a note needs but the vault has never seen are reported and added', () => {
  const existing = [{ name: 'work', hue: 40 }];
  assert.deepEqual(mutations.missingTagNames(existing, ['work', 'home']), ['home']);
  assert.deepEqual(mutations.missingTagNames(null, ['home']), ['home']);
  assert.deepEqual(mutations.missingTagNames(existing, null), []);

  const added = mutations.addTagsToList(existing, ['home', 'work', '']);
  assert.deepEqual(added.map(t => t.name), ['work', 'home'], 'a tag already present is not added again');
  assert.equal(typeof added[1].hue, 'number', 'a new tag is given a colour so it can be told apart');
  assert.equal(mutations.addTagsToList(existing, ['work']), existing,
    'with nothing to add the same list is returned, so nothing re-renders');
  assert.equal(mutations.addTagsToList(existing, []), existing);
  assert.equal(mutations.addTagsToList(existing, ['home'], () => 123)[1].hue, 123,
    'a caller can choose the colour');
});

test('a created note is normalised and reports the tags it introduced', () => {
  const draft = mutations.createNoteDraft({
    id: 'n1',
    title: '  The Meeting  ',
    body: '# The Meeting\nprose',
    tags: ['Novel Scene'],
    defaultTags: 'daily',
    now: CTX.now,
    existingTags: [{ name: 'daily' }],
  }, CTX);
  assert.equal(draft.note.title, 'The Meeting');
  assert.deepEqual(draft.note.tags, ['novel-scene', 'daily']);
  assert.ok(!draft.note.body.includes('# The Meeting'), 'the heading that repeats the title is dropped');
  assert.match(draft.note.body, /::: plot-points/, 'a scene gains its beats block on creation');
  assert.deepEqual(draft.missingTags, ['novel-scene']);
  assert.equal(draft.note.date, CTX.now);
  assert.equal(draft.note.diskRevision, null, 'a note that has never been written has no disk revision');

  const empty = mutations.createNoteDraft({ id: 'n2' }, CTX);
  assert.equal(empty.note.title, 'Untitled');
  assert.deepEqual(empty.note.blocks, [makeEmptyBlock()], 'an empty note still gets one block to type in');
  assert.deepEqual(empty.missingTags, []);
});

test('a duplicated note is a fresh, unpinned copy', () => {
  const source = note('a', { title: 'Plan', body: '# Plan\nprose', pinned: true, tags: ['work'] });
  const copy = mutations.duplicateNoteDraft(source, { id: 'a2', now: CTX.now }, CTX);
  assert.equal(copy.id, 'a2');
  assert.equal(copy.title, 'Plan copy');
  assert.equal(copy.pinned, false, 'a copy does not inherit the pin');
  assert.deepEqual(copy.tags, ['work'], 'but it does inherit the tags');
  assert.equal(copy.modifiedAt, CTX.now);
  assert.equal(copy.diskModifiedAt, null);

  const fromBlocks = mutations.duplicateNoteDraft(
    { id: 'b', title: 'From blocks', blocks: [{ id: 'x', content: 'block prose' }] },
    { id: 'b2' }, CTX);
  assert.equal(fromBlocks.body, 'block prose', 'a note held only as blocks is copied through its blocks');
  assert.equal(mutations.duplicateNoteDraft(source, { id: 'a3', title: 'Chosen' }, CTX).title, 'Chosen');
  assert.equal(mutations.duplicateNoteDraft(null, {}, CTX), null);
  assert.equal(mutations.duplicateNoteDraft({ id: 'c' }, { id: 'c2' }, CTX).title, 'Untitled copy');
});

test('a note patch can be an object or a function of the note', () => {
  const source = note('a', { title: 'Plan' });
  assert.equal(mutations.applyNotePatch(source, { title: 'New' }, CTX.now).title, 'New');
  assert.equal(mutations.applyNotePatch(source, n => ({ title: `${n.title}!` }), CTX.now).title, 'Plan!');
  assert.equal(mutations.applyNotePatch(source, { title: 'New' }, CTX.now).modifiedAt, CTX.now,
    'any patch marks the note as modified');
  assert.ok(mutations.applyNotePatch(source, {}).modifiedAt, 'with no timestamp given the clock is used');
});

test('a body update reads the current body from the blocks and rewrites both', () => {
  const source = note('a', { title: 'Plan', blocks: [{ id: 'b0', content: '# Plan' }, { id: 'b1', content: 'prose' }] });
  const replaced = mutations.applyNoteBodyUpdate(source, 'new body', CTX);
  assert.equal(replaced.body, 'new body');
  assert.deepEqual(replaced.blocks.map(b => b.content), ['new body'], 'the blocks are rebuilt from the new body');
  assert.equal(replaced.modifiedAt, CTX.now);

  const appended = mutations.applyNoteBodyUpdate(source, current => `${current}\nmore`, CTX);
  assert.equal(appended.body, 'prose\nmore',
    'the updater is handed the normalised body, with the duplicate title heading already gone');
  assert.equal(mutations.applyNoteBodyUpdate(source, '', CTX).body, '');
  assert.ok(mutations.applyNoteBodyUpdate(source, 'x', { ...CTX, now: null }).modifiedAt);
});

test('a blocks update is resolved and stamped', () => {
  const source = note('a', { blocks: [{ id: 'b0', content: 'one' }] });
  assert.deepEqual(mutations.applyNoteBlocksUpdate(source, [{ id: 'b1', content: 'two' }], CTX).blocks,
    [{ id: 'b1', content: 'two' }]);
  assert.deepEqual(mutations.applyNoteBlocksUpdate(source, prev => [...prev, { id: 'b1', content: 'two' }], CTX)
    .blocks.map(b => b.content), ['one', 'two']);
  assert.equal(mutations.applyNoteBlocksUpdate(source, [], CTX).modifiedAt, CTX.now);
  assert.ok(mutations.applyNoteBlocksUpdate({ id: 'a' }, [], { ...CTX, now: null }).modifiedAt);
});

test('linking a mention takes the first plain occurrence and leaves markup alone', () => {
  const link = (body, title) => mutations.linkMentionInBody(body, title);
  assert.deepEqual(link('See the Plan today.', 'Plan'), { body: 'See the [[Plan]] today.', linked: true });
  assert.equal(link('See the plan today.', 'Plan').body, 'See the [[plan]] today.',
    'the writer\'s own casing is kept');
  assert.deepEqual(link('Planning is not Plan.', 'Plan'),
    { body: 'Planning is not [[Plan]].', linked: true }, 'a word that merely contains the title is not a mention');
  assert.equal(link('Already [[Plan]] linked.', 'Plan').linked, false, 'an existing link is not linked again');
  assert.equal(link('A [Plan](https://example.org) link.', 'Plan').linked, false);
  assert.equal(link('An ![Plan](pic.png) image.', 'Plan').linked, false);
  assert.equal(link('Some `Plan` code.', 'Plan').linked, false);
  assert.equal(link('```\nPlan\n```', 'Plan').linked, false, 'nothing inside a fence is a mention');
  assert.equal(link('```\nPlan\n```\nand a Plan here.', 'Plan').body, '```\nPlan\n```\nand a [[Plan]] here.',
    'a fence hides only what is inside it');
  assert.equal(link('```\nPlan', 'Plan').linked, false, 'an unclosed fence runs to the end of the note');
  assert.equal(link('Some text.', 'Plan').linked, false);
  assert.equal(link('Plan', '   ').linked, false);
  assert.equal(link('', 'Plan').linked, false);
  assert.equal(link('A c++ mention.', 'c++').body, 'A [[c++]] mention.',
    'a title with regex characters is matched literally');
});

test('renaming a note rewrites every link that pointed at the old name', () => {
  const notes = [
    note('a', { title: 'Plan', body: 'the original' }),
    note('b', { title: 'Other', body: 'See [[Plan]] and [[Plan|the plan]].' }),
    note('c', { title: 'Unrelated', body: 'nothing to see' }),
  ];
  const renamed = mutations.renameNoteTitleDrafts(notes, 'a', 'Roadmap', CTX);
  assert.equal(renamed.title, 'Roadmap');
  assert.deepEqual(renamed.dirtyIds, ['a', 'b'], 'only the notes that actually changed are marked dirty');
  assert.equal(renamed.notes.find(n => n.id === 'a').title, 'Roadmap');
  assert.equal(renamed.notes.find(n => n.id === 'b').body, 'See [[Roadmap]] and [[Roadmap|the plan]].');
  assert.equal(renamed.notes.find(n => n.id === 'c'), notes[2], 'an untouched note is the same object');
  assert.equal(renamed.notes.find(n => n.id === 'b').modifiedAt, CTX.now);

  assert.equal(mutations.renameNoteTitleDrafts(notes, 'a', '   ', CTX), null, 'a blank name is not a rename');
  assert.equal(mutations.renameNoteTitleDrafts(notes, 'missing', 'X', CTX), null);
  assert.equal(mutations.renameNoteTitleDrafts(notes, 'a', 'Other', CTX).title, 'Other 2',
    'a rename onto an existing name is numbered');

  // A note held only as blocks still has its links rewritten.
  const blockNotes = [
    note('a', { title: 'Plan' }),
    { id: 'b', title: 'Other', tags: [], blocks: [{ id: 'x', content: 'See [[Plan]].' }] },
  ];
  const fromBlocks = mutations.renameNoteTitleDrafts(blockNotes, 'a', 'Roadmap', CTX);
  assert.equal(fromBlocks.notes.find(n => n.id === 'b').body, 'See [[Roadmap]].');
  assert.ok(mutations.renameNoteTitleDrafts(notes, 'a', 'X', { ...CTX, now: null }).notes[0].modifiedAt);
});

test('a structure tag replaces the other structure tags, not the rest', () => {
  const convert = (tags, tag) => mutations.convertNovelistTypeTags({ tags }, tag, helpers.normalizeTagName);
  assert.deepEqual(convert(['novel-scene', 'work'], 'novel-chapter'), ['work', 'novel-chapter'],
    'a note is a scene or a chapter, never both -- other tags are untouched');
  assert.deepEqual(convert(['novel-act'], 'novel-act'), ['novel-act']);
  assert.deepEqual(convert([], 'Novel Chapter'), ['novel-chapter'], 'the tag is normalised first');
  assert.equal(convert(['novel-scene'], 'work'), null, 'a tag that is not structural changes nothing');
  assert.equal(mutations.convertNovelistTypeTags(null, 'novel-act', helpers.normalizeTagName), null);
});

test('removing a tag touches only the notes that carried it', () => {
  const notes = [note('a', { tags: ['work', 'home'] }), note('b', { tags: ['home'] }), note('c', { tags: [] })];
  const result = mutations.removeTagFromNotes(notes, 'work', CTX.now);
  assert.deepEqual(result.dirtyIds, ['a']);
  assert.deepEqual(result.notes[0].tags, ['home']);
  assert.equal(result.notes[0].modifiedAt, CTX.now);
  assert.equal(result.notes[1], notes[1], 'a note without the tag is returned unchanged');
  assert.deepEqual(mutations.removeTagFromNotes(notes, 'nothing', CTX.now).dirtyIds, []);
  assert.deepEqual(mutations.removeTagFromNotes(null, 'work').notes, []);
  assert.ok(mutations.removeTagFromNotes([note('a', { tags: ['work'] })], 'work').notes[0].modifiedAt);
});

test('the canvas list summarises and reorders by most recently changed', () => {
  const summary = mutations.summarizeCanvas({ id: 'c1', elements: [1, 2, 3], modifiedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(summary.title, 'Untitled canvas');
  assert.equal(summary.elementCount, 3, 'the list shows how much is on a canvas without carrying it all');
  assert.equal(mutations.summarizeCanvas().elementCount, 0);
  assert.equal(mutations.summarizeCanvas({ title: 'Named' }).title, 'Named');

  const list = [
    { id: 'c1', title: 'One', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c2', title: 'Two', modifiedAt: '2026-03-01T00:00:00.000Z' },
  ];
  const upserted = mutations.upsertCanvasList(list, { id: 'c1', title: 'One edited', modifiedAt: '2026-06-01T00:00:00.000Z' });
  assert.deepEqual(upserted.map(c => c.id), ['c1', 'c2'], 'the edited canvas moves to the front');
  assert.equal(upserted[0].title, 'One edited', 'and is replaced rather than duplicated');
  assert.equal(mutations.upsertCanvasList(null, { id: 'c9' }).length, 1);
  assert.equal(mutations.upsertCanvasList(list, {}).length, 3, 'a canvas with no id is still added');
});
