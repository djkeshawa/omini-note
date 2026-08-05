const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// Importing an outline written elsewhere into novelist notes. Every candidate
// arrives from an AI or a file and may be spelled any number of ways, so the
// normaliser is the whole safety story: an unrecognised kind imports nothing
// rather than a note nobody can find. Existing notes are merged into, never
// overwritten.

const NOW = '2026-08-05T09:00:00.000Z';
const plan = (candidates, notes = [], options = {}) =>
  helpers.buildNovelImportPlan(candidates, notes, { now: NOW, vaultId: 'v1', ...options });

test('a candidate kind is recognised under every name it is written with', () => {
  const cases = {
    act: ['act', 'Part', 'ACT'],
    chapter: ['chapter'],
    scene: ['scene', 'story', 'draft'],
    character: ['character', 'cast'],
    location: ['location', 'setting', 'place'],
    plot: ['plot', 'thread', 'outline'],
    research: ['research', 'worldbuilding', 'world building'],
    revision: ['revision', 'todo', 'note'],
  };
  for (const [kind, spellings] of Object.entries(cases)) {
    for (const spelling of spellings) {
      assert.equal(helpers.normalizeNovelImportKind(spelling), kind, `${spelling} should mean ${kind}`);
      assert.equal(helpers.novelImportTagForKind(spelling), helpers.NOVEL_IMPORT_KIND_TAGS[kind]);
    }
  }
  for (const unknown of ['', 'prologue', 'appendix', null, 42]) {
    assert.equal(helpers.normalizeNovelImportKind(unknown), '', `${unknown} should not be a kind`);
    assert.equal(helpers.novelImportTagForKind(unknown), '');
  }
});

test('candidates are read from a list or from the wrapper an AI returns', () => {
  const one = { kind: 'scene', title: 'The Meeting' };
  assert.equal(helpers.normalizeNovelImportCandidates([one]).length, 1);
  assert.equal(helpers.normalizeNovelImportCandidates({ notes: [one] }).length, 1);
  assert.equal(helpers.normalizeNovelImportCandidates({ candidates: [one] }).length, 1);
  assert.equal(helpers.normalizeNovelImportCandidates({ items: [one] }).length, 1);
  assert.deepEqual(helpers.normalizeNovelImportCandidates({ other: [one] }), []);
  assert.deepEqual(helpers.normalizeNovelImportCandidates(null), []);
  assert.deepEqual(helpers.normalizeNovelImportCandidates('a string'), []);
  assert.deepEqual(helpers.normalizeNovelImportCandidates([null, 'x', { kind: 'unknown' }, { title: 'no kind' }]), [],
    'anything without a recognisable kind is not imported at all');
});

test('a candidate is read whatever the field names are, and is length-capped', () => {
  const [candidate] = helpers.normalizeNovelImportCandidates([{
    type: 'scene',
    name: '## [[The Meeting]]  ',
    content: 'Some prose.',
    act: '[[Act One]]',
    chapter: '[[Chapter Two]]',
    pointOfView: 'Ada',
    goal: 'Establish the stakes.',
    source: 'outline.md',
    beats: ['They meet', '- they argue', 'They meet', ''],
    order: '3',
    confidence: 'high',
  }]);
  assert.equal(candidate.title, 'The Meeting', 'wiki brackets and heading marks are not part of a title');
  assert.equal(candidate.kind, 'scene');
  assert.equal(candidate.tag, 'novel-scene');
  assert.equal(candidate.body, 'Some prose.');
  assert.equal(candidate.actTitle, 'Act One');
  assert.equal(candidate.chapterTitle, 'Chapter Two');
  assert.equal(candidate.pov, 'Ada');
  assert.equal(candidate.purpose, 'Establish the stakes.');
  assert.equal(candidate.sourceFile, 'outline.md');
  assert.deepEqual(candidate.plotPoints, ['They meet', 'they argue'],
    'bullets are stripped, blanks dropped, and a repeat listed once');

  const [fallback] = helpers.normalizeNovelImportCandidates([{ kind: 'chapter' }]);
  assert.equal(fallback.title, 'Imported chapter 1', 'a candidate with no title is named by its kind and position');
  const [bulleted] = helpers.normalizeNovelImportCandidates([{ kind: 'scene', outline: 'one;two\nthree' }]);
  assert.deepEqual(bulleted.plotPoints, ['one', 'two', 'three'],
    'a plain string of beats splits on newlines and semicolons');
  const [long] = helpers.normalizeNovelImportCandidates([{ kind: 'scene', title: 'x'.repeat(200) }]);
  assert.equal(long.title.length, 120);
});

test('an imported act, chapter and scene each get the body their kind needs', () => {
  const candidates = helpers.normalizeNovelImportCandidates([
    { kind: 'act', title: 'Act One', order: '1', purpose: 'Set up.' },
    { kind: 'chapter', title: 'Chapter One', act: 'Act One', order: '1' },
    { kind: 'scene', title: 'The Meeting', act: 'Act One', chapter: 'Chapter One', pov: 'Ada', plotPoints: ['They meet'] },
  ]);
  const built = plan(candidates);
  const body = title => built.notes.find(n => n.title === title).body;

  assert.match(body('Act One'), /status:: OUTLINE/);
  assert.match(body('Act One'), /order:: 1/);
  assert.match(body('Act One'), /purpose:: Set up\./);
  assert.match(body('Act One'), /## Chapters\n- \[\[Chapter One\]\]/,
    'an act lists the chapters that named it, not a placeholder');

  assert.match(body('Chapter One'), /act:: \[\[Act One\]\]/);
  assert.match(body('Chapter One'), /## Scenes\n- \[\[The Meeting\]\]/);

  assert.match(body('The Meeting'), /status:: DRAFT/, 'a scene starts as a draft, not an outline');
  assert.match(body('The Meeting'), /pov:: Ada/);
  assert.match(body('The Meeting'), /chapter:: \[\[Chapter One\]\]/);
  assert.match(body('The Meeting'), /::: plot-points\n- They meet\n:::/);
});

test('an act, chapter or scene with no children still gets a usable skeleton', () => {
  const built = plan([
    { kind: 'act', title: 'Lonely Act' },
    { kind: 'chapter', title: 'Lonely Chapter' },
    { kind: 'scene', title: 'Lonely Scene' },
    { kind: 'character', title: 'Ada' },
  ]);
  const body = title => built.notes.find(n => n.title === title).body;
  assert.match(body('Lonely Act'), /## Chapters\n- Major turn/, 'an empty act suggests what goes there');
  assert.match(body('Lonely Chapter'), /## Scenes\n- Scene list/);
  assert.match(body('Lonely Scene'), /::: plot-points\n- Opening beat\n:::/);
  assert.match(body('Lonely Scene'), /Draft the scene here\./);
  assert.match(body('Ada'), /- Imported character detail/,
    'a note that is not part of the structure gets a single starter line');
});

test('the source file is recorded as a property or as detail, by kind', () => {
  const built = plan([
    { kind: 'scene', title: 'A Scene', source: 'draft.md', body: 'Prose here.' },
    { kind: 'research', title: 'Some Research', source: 'notes.md', body: 'Findings.' },
  ]);
  const body = title => built.notes.find(n => n.title === title).body;
  // A scene's property block is reserved for the story structure, so its
  // source line is written below the plot points rather than at the top.
  assert.ok(body('A Scene').indexOf('source:: draft.md') > body('A Scene').indexOf(':::'));
  assert.match(body('A Scene'), /source:: draft\.md/);
  assert.match(body('A Scene'), /Prose here\./);
  assert.match(body('Some Research'), /source:: notes\.md/);
  assert.match(body('Some Research'), /Findings\./);
});

test('an import creates notes, pins the first act, and never collides', () => {
  const built = plan([
    { kind: 'act', title: 'Act One' },
    { kind: 'act', title: 'Act Two' },
    { kind: 'character', title: 'Ada' },
  ]);
  assert.equal(built.summary.candidates, 3);
  assert.equal(built.summary.created, 3);
  assert.equal(built.summary.updated, 0);
  assert.equal(built.created.length, 3);
  assert.equal(built.changedIds.length, 3);
  assert.equal(new Set(built.notes.map(n => n.id)).size, 3, 'every created note has its own id');
  const acts = built.notes.filter(n => n.tags.includes('novel-act'));
  assert.deepEqual(acts.map(a => a.pinned), [false, true],
    'only the first act imported is pinned; the vault does not need two pinned acts');
  assert.equal(built.notes[0].date, NOW);

  // A title already in the vault is numbered rather than reused.
  const withExisting = plan([{ kind: 'character', title: 'Ada' }], [
    { id: 'x', title: 'Ada', tags: ['other'], body: '' },
    { id: 'y', title: 'Ada 2', tags: ['other'], body: '' },
  ]);
  assert.equal(withExisting.created[0].title, 'Ada 3',
    'an incompatible note of the same name is left alone and the import is numbered past it');
});

test('an existing novelist note is merged into, not replaced', () => {
  const existing = {
    id: 'scene1',
    title: 'The Meeting',
    tags: ['novel-scene'],
    body: 'status:: DRAFT\n\n::: plot-points\n- The original beat\n:::\n\nThe prose I already wrote.',
    modifiedAt: '2026-01-01T00:00:00.000Z',
  };
  const built = plan([{
    kind: 'scene', title: 'The Meeting', act: 'Act One', chapter: 'Chapter One',
    pov: 'Ada', purpose: 'Raise the stakes.', order: '2',
  }], [existing]);

  assert.equal(built.summary.updated, 1);
  assert.equal(built.summary.created, 0);
  const merged = built.notes.find(n => n.id === 'scene1');
  assert.match(merged.body, /The prose I already wrote\./, 'existing prose survives an import');
  assert.match(merged.body, /- The original beat/, 'so do the beats already written');
  assert.match(merged.body, /act:: \[\[Act One\]\]/, 'and the new structure is filled in around them');
  assert.match(merged.body, /chapter:: \[\[Chapter One\]\]/);
  assert.match(merged.body, /pov:: Ada/);
  assert.match(merged.body, /order:: 2/);
  assert.equal(merged.modifiedAt, NOW);
  assert.deepEqual(built.updated[0], { id: 'scene1', title: 'The Meeting', kind: 'scene', tag: 'novel-scene' });
});

test('an import that would change nothing is skipped, not rewritten', () => {
  const first = plan([{ kind: 'character', title: 'Ada', body: 'A programmer.' }]);
  const note = first.notes.find(n => n.title === 'Ada');
  const second = plan([{ kind: 'character', title: 'Ada', body: 'A programmer.' }], [note]);
  assert.equal(second.summary.skipped, 1);
  assert.equal(second.summary.updated, 0);
  assert.deepEqual(second.skipped[0], { title: 'Ada', kind: 'character', reason: 'No safe changes' });
  assert.deepEqual(second.changedIds, []);
});

test('merging an act or chapter adds the links and properties it is missing', () => {
  const act = { id: 'a1', title: 'Act One', tags: ['novel-act'], body: 'status:: OUTLINE\n\n## Chapters\n- [[Chapter One]]' };
  const chapter = { id: 'c1', title: 'Chapter One', tags: ['novel-chapter'], body: 'status:: OUTLINE\n\n## Scenes\n- Scene list' };
  const built = plan([
    { kind: 'act', title: 'Act One', order: '1', purpose: 'Set up.' },
    { kind: 'chapter', title: 'Chapter One', act: 'Act One', order: '1' },
    { kind: 'chapter', title: 'Chapter Two', act: 'Act One' },
    { kind: 'scene', title: 'The Meeting', chapter: 'Chapter One' },
  ], [act, chapter]);

  const mergedAct = built.notes.find(n => n.id === 'a1');
  assert.match(mergedAct.body, /order:: 1/);
  assert.match(mergedAct.body, /purpose:: Set up\./);
  assert.match(mergedAct.body, /- \[\[Chapter One\]\]/, 'the chapter already listed is not listed twice');
  assert.equal((mergedAct.body.match(/\[\[Chapter One\]\]/g) || []).length, 1);
  assert.match(mergedAct.body, /- \[\[Chapter Two\]\]/, 'the new chapter is added to the act');

  const mergedChapter = built.notes.find(n => n.id === 'c1');
  assert.match(mergedChapter.body, /act:: \[\[Act One\]\]/);
  assert.match(mergedChapter.body, /- \[\[The Meeting\]\]/);
});

test('merging a plain note appends its detail once, never twice', () => {
  const note = { id: 'r1', title: 'Ada', tags: ['novel-character'], body: 'Existing notes about Ada.' };
  const once = helpers.mergeNovelImportBody(note,
    helpers.normalizeNovelImportCandidates([{ kind: 'character', title: 'Ada', body: 'She writes the first program.' }])[0], {});
  assert.match(once, /Existing notes about Ada\./);
  assert.match(once, /## Imported Details\nShe writes the first program\./);

  const twice = helpers.mergeNovelImportBody({ ...note, body: once },
    helpers.normalizeNovelImportCandidates([{ kind: 'character', title: 'Ada', body: 'She writes the first program.' }])[0], {});
  assert.equal((twice.match(/She writes the first program\./g) || []).length, 1,
    're-importing the same detail must not stack it up');

  const nothingToAdd = helpers.mergeNovelImportBody(note,
    helpers.normalizeNovelImportCandidates([{ kind: 'character', title: 'Ada' }])[0], {});
  assert.ok(!nothingToAdd.includes('## Imported Details'), 'a candidate with no detail adds no heading');
});

test('an empty import is a valid, empty plan', () => {
  const built = plan([]);
  assert.deepEqual(built.candidates, []);
  assert.deepEqual(built.created, []);
  assert.deepEqual(built.changedIds, []);
  assert.deepEqual(built.summary, { candidates: 0, created: 0, updated: 0, skipped: 0 });
  assert.deepEqual(helpers.buildNovelImportPlan().notes, []);
  assert.equal(helpers.buildNovelImportPlan([{ kind: 'act', title: 'A' }], null).created.length, 1);
});
