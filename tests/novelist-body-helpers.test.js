const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// The note-body primitives the whole novelist feature is built on: property
// lines, wiki links, and the normalisation every note passes through on its
// way to and from disk. These are small, but a mistake in any of them silently
// detaches a scene from its chapter, so each rule is stated on its own here.

const mdToBlocks = body => String(body).split('\n').map((content, i) => ({ id: `b${i}`, content }));
const blocksToMd = blocks => blocks.map(b => b.content).join('\n');

test('a property value is read from a line, wherever it sits', () => {
  const body = '# Title\n\nstatus:: DRAFT\n- pov:: Ada\nSTATUS_OTHER:: no';
  assert.equal(helpers.bodyPropertyValue(body, 'status'), 'DRAFT');
  assert.equal(helpers.bodyPropertyValue(body, 'pov'), 'Ada', 'a property may be written as a bullet');
  assert.equal(helpers.bodyPropertyValue(body, 'STATUS'), 'DRAFT', 'the key is matched case-insensitively');
  assert.equal(helpers.bodyPropertyValue(body, 'missing'), '');
  assert.equal(helpers.bodyPropertyValue(body, ''), '', 'no key means no value, not the first line');
  assert.equal(helpers.bodyPropertyValue('', 'status'), '');
  assert.equal(helpers.bodyPropertyValue('status::\nThe next line', 'status'), '',
    'a blank property must not swallow the line below it as its value');
  assert.equal(helpers.bodyPropertyValue('key.with.dots:: v', 'key.with.dots'), 'v',
    'a key with regex characters in it is matched literally');
});

test('a property that names a note resolves to the note title', () => {
  assert.equal(helpers.bodyPropertyTitle('act:: [[Act One]]', 'act'), 'Act One');
  assert.equal(helpers.bodyPropertyTitle('act:: [[Act One|Act I]]', 'act'), 'Act One',
    'an aliased link still names the note it points at');
  assert.equal(helpers.bodyPropertyTitle('act:: [[Act One#Scenes]]', 'act'), 'Act One',
    'so does a link to a heading inside it');
  assert.equal(helpers.bodyPropertyTitle('act:: Act One', 'act'), 'Act One', 'the brackets are optional');
  assert.equal(helpers.bodyPropertyTitle('body with no property', 'act'), '');
  assert.equal(helpers.novelPropertyTitle('act:: [[Act One]]', 'act'), 'Act One');
});

test('setting a property replaces it in place, or inserts it below the heading', () => {
  assert.equal(helpers.setBodyProperty('status:: DRAFT\nprose', 'status', 'FINAL'), 'status:: FINAL\nprose');
  assert.equal(helpers.setBodyProperty('- status:: DRAFT\nprose', 'status', 'FINAL'), 'status:: FINAL\nprose',
    'a bullet property is rewritten as a plain one');
  assert.equal(helpers.setBodyProperty('# Title\nstatus:: A\nprose', 'pov', 'Ada'),
    '# Title\nstatus:: A\npov:: Ada\nprose', 'a new property joins the block below the heading');
  assert.equal(helpers.setBodyProperty('prose only', 'pov', 'Ada'), 'pov:: Ada\nprose only',
    'with no heading the property block starts at the top');
  assert.equal(helpers.setBodyProperty('status:: DRAFT', 'status', '   '), '',
    'setting a property to nothing removes the line');
  assert.equal(helpers.setBodyProperty('prose', '  ', 'x'), 'prose', 'a nameless property changes nothing');
  assert.equal(helpers.setBodyProperty('', 'pov', 'Ada'), 'pov:: Ada\n',
    'an empty body is one empty line, so the property lands above it');

  assert.equal(helpers.removeBodyProperty('status:: A\npov:: B\nprose', 'status'), 'pov:: B\nprose');
  assert.equal(helpers.removeBodyProperty('prose', 'status'), 'prose');
  assert.equal(helpers.removeBodyProperty('prose', ''), 'prose');
  assert.equal(helpers.removeBodyProperty('', 'status'), '');
});

test('property syntax is normalised everywhere except inside a code fence', () => {
  const body = [
    '-  status::   DRAFT  ',
    'pov::Ada',
    '```',
    'not_a::property',
    '```',
    'after::  fence',
    'plain prose',
  ].join('\n');
  assert.equal(helpers.normalizeBodyPropertySyntax(body), [
    'status:: DRAFT',
    'pov:: Ada',
    '```',
    'not_a::property',
    '```',
    'after:: fence',
    'plain prose',
  ].join('\n'));
  assert.equal(helpers.normalizeBodyPropertySyntax(''), '');
  assert.deepEqual(helpers.bodyPropertyParts('- key:: value'), { key: 'key', value: 'value' });
  assert.deepEqual(helpers.bodyPropertyParts('key::'), { key: 'key', value: '' });
  assert.equal(helpers.bodyPropertyParts('9key:: v'), null, 'a property key cannot start with a digit');
  assert.equal(helpers.bodyPropertyParts('just prose'), null);
});

test('a heading that only repeats the title is dropped', () => {
  assert.equal(helpers.stripDuplicateTitleHeading('# My Note\n\nprose', 'My Note'), 'prose');
  assert.equal(helpers.stripDuplicateTitleHeading('\n\n#  my note  \nprose', 'My Note'), 'prose',
    'matching ignores case and space');
  assert.equal(helpers.stripDuplicateTitleHeading('# Other\nprose', 'My Note'), '# Other\nprose',
    'a heading that says something else is content');
  assert.equal(helpers.stripDuplicateTitleHeading('## My Note\nprose', 'My Note'), '## My Note\nprose',
    'only a top-level heading duplicates the title');
  assert.equal(helpers.stripDuplicateTitleHeading('prose', ''), 'prose');
  assert.equal(helpers.stripDuplicateTitleHeading('', 'My Note'), '');
  assert.equal(helpers.normalizeNoteBody('# My Note\n-  status::  A', 'My Note'), 'status:: A',
    'normalising does both jobs at once');
});

test('a scene always ends up with somewhere to put its beats', () => {
  const withPoints = 'status:: DRAFT\n\n::: plot-points\n- A beat\n:::';
  assert.equal(helpers.ensureScenePlotPoints(withPoints, ['novel-scene']), withPoints,
    'a scene that already has beats is left alone');
  assert.match(helpers.ensureScenePlotPoints('status:: DRAFT\nprose', ['novel-scene']),
    /status:: DRAFT\n::: plot-points\n- Opening beat\n:::\nprose/);
  assert.equal(helpers.ensureScenePlotPoints('prose', ['novel-chapter']), 'prose',
    'only a scene gets a plot-points block');
  assert.equal(helpers.ensureScenePlotPoints('prose', []), 'prose');
  assert.equal(helpers.ensureScenePlotPoints('prose'), 'prose');
  assert.equal(helpers.ensureScenePlotPoints('', ['novel-scene']), '::: plot-points\n- Opening beat\n:::\n');
});

test('wiki links are found, matched and renamed without losing their alias', () => {
  assert.deepEqual(helpers.novelWikiTitles('See [[Act One]] and [[ Chapter Two ]] and [[]]'),
    ['Act One', 'Chapter Two']);
  assert.deepEqual(helpers.novelWikiTitles(''), []);
  assert.equal(helpers.novelTitleKey('  Act One|Act I  '), 'act one', 'the key ignores the alias and the case');
  assert.equal(helpers.novelTitleKey('Act One#Scenes'), 'act one');
  assert.equal(helpers.novelTitleKey(null), '');

  assert.equal(helpers.novelHasWikiLink('See [[act ONE]]', 'Act One'), true);
  assert.equal(helpers.novelHasWikiLink('See [[Act Two]]', 'Act One'), false);
  assert.equal(helpers.novelHasWikiLink('', 'Act One'), false);

  const rename = (body, from, to) => helpers.replaceWikiLinkTitle(body, from, to);
  assert.equal(rename('See [[Act One]].', 'Act One', 'Act I'), 'See [[Act I]].');
  assert.equal(rename('See [[Act One|the first act]].', 'Act One', 'Act I'), 'See [[Act I|the first act]].',
    'the alias the writer chose survives the rename');
  assert.equal(rename('See [[Act One#Scenes]].', 'Act One', 'Act I'), 'See [[Act I#Scenes]].');
  assert.equal(rename('See [[Act One#Scenes|here]].', 'Act One', 'Act I'), 'See [[Act I#Scenes|here]].');
  assert.equal(rename('See [[Act One|a|b]].', 'Act One', 'Act I'), 'See [[Act I|a|b]].',
    'only the first pipe separates the alias');
  assert.equal(rename('See [[Act Two]].', 'Act One', 'Act I'), 'See [[Act Two]].');
  assert.equal(rename('See [[Act One]].', '', 'Act I'), 'See [[Act One]].');
  assert.equal(rename('See [[Act One]].', 'Act One', '   '), 'See [[Act One]].',
    'renaming to nothing is not a rename');
});

test('a link is added to a named section, or the section is created', () => {
  const body = '# Act One\n\n## Chapters\n- [[Chapter One]]\n\n## Notes\nprose';
  assert.equal(helpers.novelEnsureWikiLinkInSection(body, 'Chapter One', 'Chapters'), body,
    'a link already in the section is not added twice');
  assert.match(helpers.novelEnsureWikiLinkInSection(body, 'Chapter Two', 'Chapters'),
    /## Chapters\n- \[\[Chapter One\]\]\n\n- \[\[Chapter Two\]\]\n## Notes/,
    'the new link goes at the end of the section, just above the next heading');
  assert.match(helpers.novelEnsureWikiLinkInSection('# Act One\nprose', 'Chapter One', 'Chapters'),
    /## Chapters\n- \[\[Chapter One\]\]$/, 'a missing section is appended');
  assert.equal(helpers.novelEnsureWikiLinkInSection(body, '   ', 'Chapters'), body);
  assert.equal(helpers.novelEnsureWikiLinkInSection('prose', 'Chapter One', ''), 'prose\n- [[Chapter One]]',
    'with no section named the link just goes on the end');
  assert.equal(helpers.novelEnsureWikiLinkInSection('', 'Chapter One', 'Chapters'), '## Chapters\n- [[Chapter One]]');

  assert.equal(helpers.novelEnsureWikiLink('prose', 'Act One'), 'prose\n- [[Act One]]');
  assert.equal(helpers.novelEnsureWikiLink('- [[Act One]]', 'act one'), '- [[Act One]]');
  assert.equal(helpers.novelEnsureWikiLink('prose', '  '), 'prose');
  assert.equal(helpers.novelEnsureWikiLink('', 'Act One'), '- [[Act One]]');

  assert.equal(helpers.novelUpsertPropertyLink('prose', 'act', 'Act One'), 'act:: [[Act One]]\nprose');
  assert.equal(helpers.novelUpsertPropertyLink('act:: [[Old]]\nprose', 'act', 'Act One'), 'act:: [[Act One]]\nprose');
  assert.equal(helpers.novelUpsertPropertyLink('prose', '', 'Act One'), 'prose');
  assert.equal(helpers.novelUpsertPropertyLink('prose', 'act', '  '), 'prose');
});

test('an indented outline reports the depth and ancestors of each link', () => {
  const links = helpers.novelOutlineLinks([
    '- [[Chapter One]]',
    '  - [[Scene A]]',
    '  - [[Scene B]]',
    '- [[Chapter Two]]',
    '\t- [[Scene C]]',
    'prose with no link',
  ].join('\n'));
  assert.deepEqual(links.map(l => [l.title, l.depth]), [
    ['Chapter One', 0], ['Scene A', 1], ['Scene B', 1], ['Chapter Two', 0], ['Scene C', 1],
  ], 'a tab indents the same as two spaces');
  assert.deepEqual(links[1].ancestors.map(a => a.title), ['Chapter One']);
  assert.deepEqual(links[3].ancestors, [], 'a new top-level item has no ancestors');
  assert.deepEqual(helpers.novelOutlineLinks(''), []);
});

test('story notes sort by an explicit order first, then by title', () => {
  const n = (id, title, body = '', over = {}) => ({ id, title, body, ...over });
  const sorted = [
    n('c', 'Charlie'),
    n('a', 'Alpha', 'order:: 2'),
    n('b', 'Bravo', 'order:: 1'),
    n('d', 'delta'),
  ].sort(helpers.compareStoryNotes);
  assert.deepEqual(sorted.map(x => x.id), ['b', 'a', 'c', 'd'],
    'ordered notes come first in their order, then the rest alphabetically');
  assert.equal(helpers.noteOrderValue(n('x', 'X', 'order:: 3')), 3);
  assert.equal(helpers.noteOrderValue(n('x', 'X', 'order:: soon')), null, 'an unreadable order is no order');
  assert.equal(helpers.noteOrderValue(n('x', 'X', 'order::')), null);
  assert.equal(helpers.noteOrderValue(null), null);

  // Same title: the more recently edited wins, then the id decides.
  const tied = [
    n('z', 'Same', '', { modifiedAt: '2026-01-01T00:00:00.000Z' }),
    n('a', 'Same', '', { modifiedAt: '2026-06-01T00:00:00.000Z' }),
  ].sort(helpers.compareStoryNotes);
  assert.deepEqual(tied.map(x => x.id), ['a', 'z']);
  const identical = [n('z', 'Same'), n('a', 'Same')].sort(helpers.compareStoryNotes);
  assert.deepEqual(identical.map(x => x.id), ['a', 'z'], 'with nothing else to go on the id is a stable tiebreak');
});

test('legacy arc vocabulary is rewritten to act on the way in', () => {
  assert.deepEqual(helpers.normalizeNovelistLegacyTags(['novel-arc', 'novel-manuscript', 'novel-storyRoot', 'keep', 'keep']),
    ['novel-act', 'keep'], 'arc becomes act, the retired tags go, and nothing is listed twice');
  assert.deepEqual(helpers.normalizeNovelistLegacyTags(), []);
  assert.equal(helpers.normalizeNovelistLegacyBody('arc:: [[Arc One]]'), 'act:: [[Arc One]]');
  assert.equal(helpers.normalizeNovelistLegacyBody('- ARC:: x'), '- act:: x');
  assert.equal(helpers.normalizeNovelistLegacyBody('## Arcs'), '## Acts');
  assert.equal(helpers.normalizeNovelistLegacyBody('### arcs  '), '### Acts');
  assert.equal(helpers.normalizeNovelistLegacyBody('prose about arcs'), 'prose about arcs',
    'only a heading or a property line is rewritten, never prose');
  assert.equal(helpers.normalizeNovelistLegacyBody(''), '');
});

test('a note is normalised for the screen and for the disk', () => {
  const [normalized] = helpers.normalizeNotes([{
    id: 'n1', title: 'The Meeting', tags: ['novel-arc', 'novel-scene'], body: '# The Meeting\narc:: [[Act One]]\nprose',
  }], mdToBlocks);
  assert.deepEqual(normalized.tags, ['novel-act', 'novel-scene']);
  assert.match(normalized.body, /^act:: \[\[Act One\]\]/, 'the duplicate heading goes and the vocabulary updates');
  assert.match(normalized.body, /::: plot-points/, 'a scene gains its beats block');
  assert.ok(Array.isArray(normalized.blocks));
  assert.deepEqual(helpers.normalizeNotes(null, mdToBlocks), []);
  assert.equal(helpers.normalizeNotes([{ id: 'n', blocks: [{ id: 'x', content: 'kept' }] }], mdToBlocks)[0].blocks[0].content,
    'kept', 'blocks already parsed are not rebuilt');

  const onDisk = helpers.noteForDisk({
    id: 'n1', title: 'The Meeting', tags: ['novel-scene'],
    blocks: [{ id: 'b0', content: '# The Meeting' }, { id: 'b1', content: 'prose' }],
  }, blocksToMd);
  assert.equal(onDisk.pinned, false);
  assert.equal(onDisk.workflowArchived, false);
  assert.equal(onDisk.frontMatter, '');
  assert.ok(onDisk.date, 'a note with no date is stamped so it can be sorted');
  assert.match(onDisk.body, /::: plot-points/);
  assert.ok(!onDisk.body.includes('# The Meeting'), 'the duplicate heading is not written to disk');

  const fromBody = helpers.noteForDisk({ id: 'n2', body: 'prose', tags: 'not a list' }, blocksToMd);
  assert.equal(fromBody.title, 'Untitled');
  assert.deepEqual(fromBody.tags, []);
  assert.equal(fromBody.body, 'prose');
});

test('starter notes are only offered for what the vault does not already have', () => {
  const starters = [
    { title: 'Act 1', tags: ['novel-act'], body: '# Act 1\nprose' },
    { title: 'Chapter 1', tags: ['novel-chapter'], body: 'prose' },
  ];
  const fresh = helpers.buildNovelistStarterNotes([], mdToBlocks, 'v1', starters);
  assert.deepEqual(fresh.map(n => n.title), ['Act 1', 'Chapter 1']);
  assert.equal(fresh[0].pinned, true, 'the first act is pinned so the writer lands on it');
  assert.equal(fresh[1].pinned, false);
  assert.equal(fresh[0].id, 'n_novel_v1_act_1');
  assert.ok(!fresh[0].body.includes('# Act 1'), 'a starter body is normalised like any other');

  assert.deepEqual(helpers.buildNovelistStarterNotes([{ title: 'act 1', tags: [] }], mdToBlocks, 'v1', starters)
    .map(n => n.title), ['Chapter 1'], 'a note of that name already exists');
  assert.deepEqual(helpers.buildNovelistStarterNotes([{ title: 'Other', tags: ['novel-chapter'] }], mdToBlocks, 'v1', starters)
    .map(n => n.title), ['Act 1'], 'or a note already carries that tag');
  assert.deepEqual(helpers.buildNovelistStarterNotes([], mdToBlocks, 'v1', []), []);
  assert.deepEqual(helpers.buildNovelistStarterNotes(), []);
});

test('note ids and tag names are slugged predictably', () => {
  assert.equal(helpers.novelistNoteId('Act One', 'My Vault'), 'n_novel_my_vault_act_one');
  assert.equal(helpers.novelistNoteId('Act One'), 'n_novel_act_one', 'with no vault the id has no vault segment');
  assert.equal(helpers.novelistNoteId('!!!', '', 'fallback'), 'n_novel_fallback',
    'a title with nothing sluggable falls back rather than producing a bare prefix');

  assert.equal(helpers.normalizeTagName('  #Work Item  '), 'work-item');
  assert.equal(helpers.normalizeTagName('---'), '');
  assert.equal(helpers.normalizeTagName('x'.repeat(100)).length, 64);
  assert.equal(helpers.normalizeTagName(null), '');
  assert.deepEqual(helpers.parseDefaultTags(' work, Work , home ,, '), ['work', 'home']);
  assert.deepEqual(helpers.parseDefaultTags(''), []);
  assert.equal(helpers.dirtyNoteKey('v1', 'n1'), 'v1::n1');
  assert.equal(helpers.dirtyNoteKey(), '::');
  assert.equal(helpers.isNovelistNote({ tags: ['novel-scene'] }), true);
  assert.equal(helpers.isNovelistNote({ tags: ['other'] }), false);
  assert.equal(helpers.isNovelistNote(null), false);
});

test('novelist tags are added without disturbing the ones already there', () => {
  const existing = [{ name: 'novel-act', color: 'red' }, { name: 'other' }];
  const merged = helpers.ensureNovelistTags(existing, [{ name: 'novel-act', color: 'blue' }, { name: 'novel-scene' }]);
  assert.deepEqual(merged.map(t => t.name), ['novel-act', 'other', 'novel-scene']);
  assert.equal(merged[0].color, 'red', 'a tag the user already has keeps its own colour');
  assert.deepEqual(helpers.ensureNovelistTags(), []);
  assert.deepEqual(helpers.ensureNovelistTags(null, [{ name: 'a' }]).map(t => t.name), ['a']);
});

test('a reminder says when it is due and what state it is in', () => {
  assert.equal(helpers.reminderStatusLabel('due'), 'Due');
  assert.equal(helpers.reminderStatusLabel('snoozed'), 'Snoozed');
  assert.equal(helpers.reminderStatusLabel('anything else'), 'Upcoming');
  assert.equal(helpers.reminderDisplayDate({}), '');
  assert.equal(helpers.reminderDisplayDate(null), '');
  assert.ok(helpers.reminderDisplayDate({ remindAt: { at: new Date('2026-09-01T10:00:00') } }).length > 0);
});
