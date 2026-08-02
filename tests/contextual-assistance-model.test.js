const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/features/assistance/contextualAssistanceModel.js');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const { buildLinks } = loadRendererModule('src/shared/data.jsx');

// src/features/assistance/contextualAssistanceModel.js was at 100% line but only
// 47% branch coverage -- every conditional executed, none of them varied. It
// builds a new note whose whole value is the "## Source" backlink to the note it
// was generated from, so that link has to actually resolve.

const build = (title, text = 'generated content') =>
  model.buildOutput({ actionId: 'brief', sourceNote: { id: 'src', title }, text });

// Resolution uses the app's real link builder rather than a regex of our own,
// so this test tracks how VispNote actually follows [[links]].
function linksBetween(sourceTitle) {
  const output = build(sourceTitle);
  const notes = [
    { id: 'src', title: sourceTitle, body: 'the original note' },
    { id: 'gen', title: output.title, body: output.body },
  ];
  return buildLinks(notes).filter(l => l.source === 'gen' && l.target === 'src');
}

test('the Source backlink resolves for ordinary titles', () => {
  for (const title of ['Meeting notes', 'Q1 planning', 'Café résumé', '日本語のノート']) {
    assert.equal(linksBetween(title).length, 1, `no backlink built for ${JSON.stringify(title)}`);
  }
});

test('a Source link never points at a note other than the source', () => {
  // cleanSourceTitle strips [ and ], but '|' and '#' are wiki-link syntax too:
  // mnLinkTargetsForNote (src/shared/data.jsx:112) does
  // .split('|')[0].split('#')[0], so "[[Bug #42 triage]]" addresses a note
  // called "Bug". Linking to an unrelated note is worse than not linking, so
  // such a title must be named in plain text instead.
  const misdirected = [];
  for (const title of ['Q1 | Q2 review', 'Bug #42 triage', 'A | B # C', 'Roadmap #2026']) {
    const output = build(title);
    const decoy = { id: 'decoy', title: title.split(/[|#]/)[0].trim(), body: 'unrelated note' };
    const notes = [
      { id: 'src', title, body: 'the original note' },
      decoy,
      { id: 'gen', title: output.title, body: output.body },
    ];
    const wrong = buildLinks(notes).filter(l => l.source === 'gen' && l.target !== 'src');
    if (wrong.length) misdirected.push(`${title} -> linked to ${wrong.map(w => w.target).join(', ')}`);
  }
  assert.deepEqual(misdirected, [],
    `the generated note linked to the wrong note:\n  ${misdirected.join('\n  ')}`);
});

test('a title that cannot be linked is still named in the Source section', () => {
  for (const title of ['Bug #42 triage', 'Q1 | Q2 review']) {
    const body = build(title).body;
    assert.ok(body.includes(title), `the source name was lost for ${JSON.stringify(title)}`);
    assert.doesNotMatch(body, /\[\[/, `still emitted a wiki link for ${JSON.stringify(title)}`);
  }
});

test('brackets and newlines are removed from the title', () => {
  assert.equal(model.cleanSourceTitle('Title [with] brackets'), 'Title with brackets');
  assert.equal(model.cleanSourceTitle('line one\nline two'), 'line one line two');
  assert.equal(model.cleanSourceTitle('  padded   spaces  '), 'padded spaces');
});

test('an empty or missing title falls back to Untitled', () => {
  for (const value of ['', '   ', null, undefined, '[[]]']) {
    assert.equal(model.cleanSourceTitle(value), 'Untitled', `got something else for ${JSON.stringify(value)}`);
  }
});

test('a very long title is capped', () => {
  assert.equal(model.cleanSourceTitle('x'.repeat(500)).length, 180);
});

test('a fenced markdown reply is unwrapped', () => {
  assert.equal(model.cleanMarkdown('```markdown\n# Heading\n\ntext\n```'), '# Heading\n\ntext');
  assert.equal(model.cleanMarkdown('```md\ncontent\n```'), 'content');
  assert.equal(model.cleanMarkdown('```\ncontent\n```'), 'content');
  // A fence that is only part of the reply is real content and must survive.
  assert.match(model.cleanMarkdown('prose\n\n```js\ncode()\n```'), /code\(\)/);
});

test('a Sources section the model was told not to add is removed', () => {
  assert.equal(model.cleanMarkdown('body text\n\n## Sources\n- [[Something]]'), 'body text');
  assert.equal(model.cleanMarkdown('body text\n\n# Source\n- [[Something]]'), 'body text');
});

test('an unsupported action is refused', () => {
  for (const actionId of ['', null, undefined, 'nope', 'BRIEF']) {
    assert.throws(() => model.buildOutput({ actionId, sourceNote: { title: 'T' }, text: 'x' }),
      /Unsupported assistance action/, `accepted ${JSON.stringify(actionId)}`);
  }
});

test('an empty reply is refused rather than saved as a blank note', () => {
  // Creating an empty note and telling the user it worked is worse than failing.
  for (const text of ['', '   ', '```\n\n```', '## Sources\n- [[x]]']) {
    assert.throws(() => model.buildOutput({ actionId: 'brief', sourceNote: { title: 'T' }, text }),
      /no Markdown/, `accepted ${JSON.stringify(text)}`);
  }
});

test('every declared action produces a distinctly titled note', () => {
  const titles = model.ACTIONS.map(a =>
    model.buildOutput({ actionId: a.id, sourceNote: { title: 'Note' }, text: 'x' }).title);
  assert.equal(new Set(titles).size, model.ACTIONS.length, 'two actions produce the same note title');
  for (const action of model.ACTIONS) {
    assert.ok(action.instruction && action.label && action.suffix, `${action.id} is missing metadata`);
  }
});

test('actionById is exact, not fuzzy', () => {
  assert.equal(model.actionById('brief').id, 'brief');
  assert.equal(model.actionById('Brief'), null);
  assert.equal(model.actionById(''), null);
  assert.equal(model.actionById(null), null);
});
