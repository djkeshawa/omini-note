const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// How the novelist outline is inferred. A writer never declares the hierarchy:
// it is read back from tags, `act::`/`chapter::` properties, indented outlines
// and plain wiki links, in that order of authority. Getting it wrong silently
// detaches a scene from its chapter, so each source of structure is pinned.

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? '', tags: over.tags ?? [],
  modifiedAt: over.modifiedAt ?? '2026-01-01T00:00:00.000Z', ...over,
});

const structure = notes => helpers.buildNovelistStructure(notes);
const ids = list => list.map(n => n.id);

test('tags alone are enough to place a note at its stage', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'] }),
    note('c', { title: 'Chapter One', tags: ['novel-chapter'] }),
    note('s', { title: 'The Meeting', tags: ['novel-scene'] }),
    note('other', { title: 'Ordinary', tags: ['work'] }),
  ]);
  assert.deepEqual(ids(built.acts), ['a']);
  assert.deepEqual(ids(built.chapters), ['c']);
  assert.deepEqual(ids(built.scenes), ['s']);
  assert.deepEqual(ids(built.novelNotes), ['a', 'c', 's'], 'a note with no novel tag is not part of the story');
  assert.equal(built.stageByNoteId.a, 'act');
  assert.deepEqual(built.pathByNoteId.a.map(n => n.id), ['a'], 'an act is its own whole path');
  assert.deepEqual(structure([]).acts, []);
  assert.deepEqual(structure().acts, []);
});

test('act and chapter properties wire the hierarchy together', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'] }),
    note('c', { title: 'Chapter One', tags: ['novel-chapter'], body: 'act:: [[Act One]]' }),
    note('s', { title: 'The Meeting', tags: ['novel-scene'], body: 'act:: [[Act One]]\nchapter:: [[Chapter One]]' }),
  ]);
  assert.equal(built.parentByChapterId.c, 'a');
  assert.equal(built.parentBySceneId.s, 'c');
  assert.deepEqual(built.childrenByActId.a, ['c']);
  assert.deepEqual(built.childrenByChapterId.c, ['s']);
  assert.deepEqual(built.pathByNoteId.s.map(n => n.id), ['a', 'c', 's'],
    'a scene knows its chapter and, through it, its act');
  assert.deepEqual(built.pathByNoteId.c.map(n => n.id), ['a', 'c']);

  // An aliased or anchored property link resolves to the same note.
  const aliased = structure([
    note('a', { title: 'Act One', tags: ['novel-act'] }),
    note('c', { title: 'Chapter One', tags: ['novel-chapter'], body: 'act:: [[Act One|Act I]]' }),
  ]);
  assert.equal(aliased.parentByChapterId.c, 'a', 'an alias must not detach a chapter from its act');
  const anchored = structure([
    note('a', { title: 'Act One', tags: ['novel-act'] }),
    note('c', { title: 'Chapter One', tags: ['novel-chapter'], body: 'act:: [[Act One#Chapters]]' }),
  ]);
  assert.equal(anchored.parentByChapterId.c, 'a');

  // A property naming a note that does not exist leaves the chapter unplaced.
  const dangling = structure([note('c', { title: 'Chapter One', tags: ['novel-chapter'], body: 'act:: [[Nowhere]]' })]);
  assert.equal(dangling.parentByChapterId.c, undefined);
  assert.deepEqual(dangling.pathByNoteId.c.map(n => n.id), ['c']);
});

test('an act lists its chapters from an indented outline', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'], body: [
      '## Chapters',
      '- [[Chapter One]]',
      '  - [[The Meeting]]',
      '  - [[The Parting]]',
      '- [[Chapter Two]]',
    ].join('\n') }),
    note('c1', { title: 'Chapter One' }),
    note('c2', { title: 'Chapter Two' }),
    note('s1', { title: 'The Meeting' }),
    note('s2', { title: 'The Parting' }),
  ]);
  assert.deepEqual(ids(built.chapters), ['c1', 'c2'], 'a top-level outline entry is a chapter');
  assert.deepEqual(new Set(ids(built.scenes)), new Set(['s1', 's2']), 'an indented one is a scene');
  assert.deepEqual(built.childrenByActId.a, ['c1', 'c2']);
  assert.deepEqual(built.childrenByChapterId.c1, ['s1', 's2']);
  assert.deepEqual(built.pathByNoteId.s1.map(n => n.id), ['a', 'c1', 's1'],
    'a scene reached through the outline still knows its act');
});

test('a flat list of links under an act is read as its chapters', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'], body: 'See [[Chapter One]] and [[Chapter Two]].' }),
    note('c1', { title: 'Chapter One' }),
    note('c2', { title: 'Chapter Two' }),
  ]);
  assert.deepEqual(ids(built.chapters), ['c1', 'c2'],
    'with no indented outline, whatever the act links to are its chapters');
  assert.deepEqual(built.childrenByActId.a, ['c1', 'c2']);

  // A note already known to be a scene is not promoted to a chapter.
  const withScene = structure([
    note('a', { title: 'Act One', tags: ['novel-act'], body: 'See [[The Meeting]].' }),
    note('s', { title: 'The Meeting', tags: ['novel-scene'] }),
  ]);
  assert.deepEqual(ids(withScene.chapters), []);
  assert.deepEqual(ids(withScene.scenes), ['s']);
});

test('a chapter claims the notes it links to as its scenes', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'] }),
    note('c', { title: 'Chapter One', tags: ['novel-chapter'], body: 'act:: [[Act One]]\n\nSee [[The Meeting]].' }),
    note('s', { title: 'The Meeting' }),
  ]);
  assert.deepEqual(ids(built.scenes), ['s']);
  assert.equal(built.parentBySceneId.s, 'c');
  assert.deepEqual(built.pathByNoteId.s.map(n => n.id), ['a', 'c', 's']);

  // An act or another chapter linked from a chapter is not demoted to a scene.
  const noDemotion = structure([
    note('a', { title: 'Act One', tags: ['novel-act'] }),
    note('c1', { title: 'Chapter One', tags: ['novel-chapter'], body: 'See [[Act One]] and [[Chapter Two]].' }),
    note('c2', { title: 'Chapter Two', tags: ['novel-chapter'] }),
  ]);
  assert.deepEqual(ids(noDemotion.scenes), []);
  assert.deepEqual(new Set(ids(noDemotion.chapters)), new Set(['c1', 'c2']));
});

test('an explicit tag always wins over what a link would imply', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'], body: 'See [[Also An Act]].' }),
    note('a2', { title: 'Also An Act', tags: ['novel-act'] }),
  ]);
  assert.deepEqual(new Set(ids(built.acts)), new Set(['a', 'a2']),
    'an act linked from another act stays an act, it does not become its chapter');
  assert.deepEqual(built.childrenByActId.a, undefined);

  const scene = structure([
    note('c', { title: 'Chapter One', tags: ['novel-chapter'], body: 'See [[The Meeting]].' }),
    note('s', { title: 'The Meeting', tags: ['novel-scene'] }),
  ]);
  assert.equal(scene.parentBySceneId.s, 'c', 'a tagged scene is still linked, just never re-staged');
  assert.deepEqual(ids(scene.chapters), ['c']);
});

test('a note cannot become its own parent', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'], body: 'act:: [[Act One]]\nSee [[Act One]].' }),
  ]);
  assert.equal(built.parentByChapterId.a, undefined);
  assert.deepEqual(built.childrenByActId.a, undefined);
  assert.deepEqual(ids(built.acts), ['a']);
});

test('children are ordered by their own order property, then by title', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'] }),
    note('c3', { title: 'Zulu', tags: ['novel-chapter'], body: 'act:: [[Act One]]' }),
    note('c1', { title: 'Bravo', tags: ['novel-chapter'], body: 'act:: [[Act One]]\norder:: 1' }),
    note('c2', { title: 'Alpha', tags: ['novel-chapter'], body: 'act:: [[Act One]]\norder:: 2' }),
  ]);
  assert.deepEqual(built.childrenByActId.a, ['c1', 'c2', 'c3'],
    'ordered chapters come first in their order, then the rest alphabetically');
  assert.deepEqual(ids(built.chapters), ['c1', 'c2', 'c3'], 'the flat list is sorted the same way');
});

test('a note whose id is an Object.prototype member still builds an outline', () => {
  const built = structure([
    note('constructor', { title: 'Act One', tags: ['novel-act'] }),
    note('toString', { title: 'Chapter One', tags: ['novel-chapter'], body: 'act:: [[Act One]]' }),
    note('__proto__', { title: 'The Meeting', tags: ['novel-scene'], body: 'chapter:: [[Chapter One]]' }),
  ]);
  assert.deepEqual(built.childrenByActId.constructor, ['toString'],
    'a bucket keyed by a prototype member must be a real list, not an inherited function');
  assert.deepEqual(built.childrenByChapterId.toString, ['__proto__']);
  assert.equal(built.parentBySceneId.__proto__, 'toString');
  assert.deepEqual(ids(built.acts), ['constructor']);
});

test('a scene knows its act even when its chapter does not', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'], body: [
      '## Chapters',
      '- [[Chapter One]]',
      '  - [[The Meeting]]',
    ].join('\n') }),
    note('c', { title: 'Chapter One' }),
    note('s', { title: 'The Meeting' }),
  ]);
  assert.deepEqual(built.pathByNoteId.s.map(n => n.id), ['a', 'c', 's']);
  assert.equal(built.parentByChapterId.c, 'a', 'placing a scene under an act also places its chapter');
});

test('an outline entry that names no note in the vault is skipped', () => {
  const built = structure([
    note('a', { title: 'Act One', tags: ['novel-act'], body: '- [[Chapter One]]\n- [[A Missing Chapter]]' }),
    note('c', { title: 'Chapter One' }),
  ]);
  assert.deepEqual(built.childrenByActId.a, ['c']);
  assert.deepEqual(ids(built.chapters), ['c']);
});
