const test = require('node:test');
const assert = require('node:assert/strict');

const novelist = require('../src/app/appNovelist.js');

// Novelist mode's note plumbing: stable ids, tag scaffolding, body properties
// (status:: lines) and wiki-link maintenance. Each wrapper is exercised
// against realistic input so both the delegation and the behaviour underneath
// are pinned by one tripwire.

test('novelist note ids are stable and vault-scoped', () => {
  const a1 = novelist.mnNovelistNoteId('Story Structure', 'vault-a');
  const a2 = novelist.mnNovelistNoteId('Story Structure', 'vault-a');
  const b = novelist.mnNovelistNoteId('Story Structure', 'vault-b');
  assert.equal(a1, a2, 'the same title in the same vault must map to the same note');
  assert.notEqual(a1, b, 'two vaults must not collide on novelist note ids');
});

test('ensuring novelist tags adds the missing ones without duplicating', () => {
  const ensured = novelist.mnEnsureNovelistTags(['novel-scene', 'custom']);
  assert.ok(ensured.includes('custom'), 'user tags must survive');
  assert.equal(new Set(ensured).size, ensured.length, 'tags were duplicated');
  for (const tag of novelist.MN_NOVELIST_TAGS) {
    assert.ok(ensured.includes(tag), `scaffold tag ${tag} missing`);
  }
});

test('novelist notes are detected by their tags', () => {
  assert.equal(novelist.mnIsNovelistNote({ tags: ['novel-scene'] }), true);
  assert.equal(novelist.mnIsNovelistNote({ tags: ['groceries'] }), false);
  assert.equal(novelist.mnIsNovelistNote({}), false);
});

test('starter notes are only created for missing titles', () => {
  const mdToBlocks = () => [];
  const fresh = novelist.mnBuildNovelistStarterNotes([], mdToBlocks, 'v1');
  assert.ok(fresh.length >= 3, 'a fresh novelist vault should receive starter notes');
  const titles = fresh.map(n => n.title);
  const again = novelist.mnBuildNovelistStarterNotes(fresh, mdToBlocks, 'v1');
  assert.equal(again.length, 0, 'starters were recreated over existing notes');
  assert.equal(new Set(titles).size, titles.length);
});

test('scene bodies gain plot points exactly once', () => {
  const withPoints = novelist.mnEnsureScenePlotPoints('Some prose.', ['novel-scene']);
  assert.match(withPoints, /::: plot-points/, 'a scene should be scaffolded with a plot-points block');
  const second = novelist.mnEnsureScenePlotPoints(withPoints, ['novel-scene']);
  assert.equal(second, withPoints, 'plot points were added twice');
  const nonScene = novelist.mnEnsureScenePlotPoints('Some prose.', ['novel-act']);
  assert.equal(nonScene, 'Some prose.', 'only scenes get plot points');
});

test('body properties read, write and remove as status:: lines', () => {
  const withStatus = novelist.mnSetBodyProperty('First line of prose.', 'status', 'DRAFT');
  assert.equal(novelist.mnBodyPropertyValue(withStatus, 'status'), 'DRAFT');
  const updated = novelist.mnSetBodyProperty(withStatus, 'status', 'FINAL');
  assert.equal(novelist.mnBodyPropertyValue(updated, 'status'), 'FINAL');
  assert.equal((updated.match(/status::/g) || []).length, 1, 'updating a property must not duplicate the line');
  assert.match(updated, /First line of prose\./, 'the prose must survive property edits');
  const removed = novelist.mnRemoveBodyProperty(updated, 'status');
  assert.equal(novelist.mnBodyPropertyValue(removed, 'status'), '', 'the property should be gone');
  assert.match(removed, /First line of prose\./);
});

test('property titles unwrap wiki links', () => {
  const body = novelist.mnSetBodyProperty('', 'act', '[[Act One|the opening]]');
  assert.equal(novelist.mnBodyPropertyTitle(body, 'act'), 'Act One',
    'the linked note title, not the alias, identifies the act');
});

test('wiki titles are collected and renamed with aliases preserved', () => {
  const body = 'See [[Act One]] and [[Scene A|the meeting]] plus [[Act One#beat]].';
  const titles = novelist.mnNovelWikiTitles(body);
  // Raw targets are returned; novelTitleKey is the normaliser.
  const keys = [...new Set(titles.map(novelist.mnNovelTitleKey))].sort();
  assert.deepEqual(keys, ['act one', 'scene a']);
  const renamed = novelist.mnReplaceWikiLinkTitle(body, 'Act One', 'Act 1 - Setup');
  assert.ok(renamed.includes('[[Act 1 - Setup]]'), 'the plain link was not renamed');
  assert.ok(renamed.includes('[[Act 1 - Setup#beat]]'), 'the heading link lost its anchor');
  assert.ok(renamed.includes('[[Scene A|the meeting]]'), 'an unrelated aliased link was disturbed');
  assert.equal(novelist.mnNovelTitleKey('  Act One  '), novelist.mnNovelTitleKey('act one'),
    'title matching must be case- and space-insensitive');
});

test('legacy novelist tags and bodies normalise to the current scheme', () => {
  const tags = novelist.mnNormalizeNovelistLegacyTags(['novel-arc', 'novel-manuscript', 'keep-me', 'keep-me']);
  assert.ok(tags.includes('keep-me'));
  assert.ok(tags.includes('novel-act'), 'the legacy novel-arc tag must migrate to novel-act');
  assert.ok(!tags.includes('novel-arc'), 'the legacy spelling must not survive alongside');
  assert.ok(!tags.includes('novel-manuscript'), 'retired tags must be dropped');
  assert.equal(new Set(tags).size, tags.length, 'normalisation must dedupe');
  const body = novelist.mnNormalizeNovelistLegacyBody('act:: [[Act One]]\nprose');
  assert.equal(typeof body, 'string');
  assert.match(body, /prose/);
});

test('dirty note keys are namespaced by vault', () => {
  assert.notEqual(novelist.mnDirtyNoteKey('v1', 'n1'), novelist.mnDirtyNoteKey('v2', 'n1'));
});
