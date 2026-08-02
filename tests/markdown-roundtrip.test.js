const test = require('node:test');
const assert = require('node:assert/strict');

const { loadOutlineForTest } = require('./helpers/common.js');

const outline = loadOutlineForTest();
const { mnMdToBlocks, mnBlocksToMd } = outline;

// The behaviour under test is a user expectation, not an implementation detail:
// a note that is opened and saved untouched must come back byte-identical.
// Anything else reads as "my note changed by itself" -- silent corruption that
// compounds on every open/save cycle and pollutes git/Dropbox diffs.
//
// One normalization pass is allowed (md -> blocks -> md may canonicalise), but
// the canonical form must be a fixed point: parsing and serialising it again
// must reproduce it exactly.

const roundtrip = md => mnBlocksToMd(mnMdToBlocks(md));

function assertStable(md, label) {
  const once = roundtrip(md);
  const twice = roundtrip(once);
  assert.equal(twice, once,
    `${label}: not a fixed point.\n  first pass:  ${JSON.stringify(once)}\n  second pass: ${JSON.stringify(twice)}`);
  return once;
}

test('every block kind survives open-and-save untouched', () => {
  const doc = [
    '# Heading one',
    '',
    '## Heading two',
    '',
    'A plain paragraph.',
    '',
    '- a bullet',
    '- another bullet',
    '',
    '1. first ordered',
    '2. second ordered',
    '',
    '- [ ] open todo',
    '- [x] done todo',
    '',
    '> a quote line',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '---',
    '',
    '| Name | Notes |',
    '| --- | --- |',
    '| Ada | fine |',
  ].join('\n');
  const canonical = assertStable(doc, 'full document');
  // The canonical form must still contain every piece of user content.
  for (const fragment of ['Heading one', 'plain paragraph', 'another bullet', 'second ordered',
    'open todo', 'done todo', 'a quote line', 'const x = 1;', 'Ada']) {
    assert.ok(canonical.includes(fragment), `content lost in round-trip: ${fragment}`);
  }
});

test('nested outline structure survives open-and-save', () => {
  const doc = [
    '# Section',
    '',
    'first child',
    '',
    '  nested under first',
    '',
    'second child',
  ].join('\n');
  assertStable(doc, 'nested outline');
  const blocks = mnMdToBlocks(roundtrip(doc));
  const reblocks = mnMdToBlocks(roundtrip(roundtrip(doc)));
  const shape = bs => bs.map(b => `${b.kind}:${b.children.length}`).join(',');
  assert.equal(shape(reblocks), shape(blocks), 'nesting shape changed between passes');
});

test('literal marker characters inside text are not eaten or promoted', () => {
  // Users write about markdown too. A paragraph mentioning "# " or "> " in the
  // middle, or code containing markers, must not become headings or quotes.
  const cases = [
    'The # symbol and > symbol mid-sentence.',
    'Use "- [ ]" to write a todo.',
    'a paragraph with [[Wiki Link]] and #tag',
    '```\n# not a heading\n> not a quote\n- not a bullet\n```',
  ];
  for (const md of cases) {
    const canonical = assertStable(md, JSON.stringify(md.slice(0, 30)));
    const key = md.startsWith('```') ? '# not a heading' : md.slice(0, 12);
    assert.ok(canonical.includes(key), `literal text mangled for ${JSON.stringify(md.slice(0, 30))}`);
  }
});

test('checkbox state survives the round-trip exactly', () => {
  const md = '- [ ] still open\n- [x] finished';
  const canonical = assertStable(md, 'checkboxes');
  assert.ok(/\[ \] still open/.test(canonical), 'open todo became checked or lost its box');
  assert.ok(/\[x\] finished/i.test(canonical), 'checked todo lost its state');
});

test('ordered list numbering survives, including the ")" delimiter form', () => {
  const dot = assertStable('1. one\n2. two\n3. three', 'dot-numbered list');
  assert.ok(dot.includes('one') && dot.includes('three'));
  const paren = assertStable('1) one\n2) two', 'paren-numbered list');
  assert.ok(paren.includes('one') && paren.includes('two'));
});

test('trailing whitespace and blank-line runs settle rather than grow', () => {
  // A pathological but real case: pasted content with messy whitespace. The
  // round-trip may clean it, but must not oscillate or accumulate blank lines.
  const md = 'first line   \n\n\n\nsecond line\n\n\n';
  const once = roundtrip(md);
  const twice = roundtrip(once);
  const thrice = roundtrip(twice);
  assert.equal(twice, once, 'whitespace did not settle after one pass');
  assert.equal(thrice, twice, 'whitespace keeps changing on every save');
  assert.ok(once.length <= md.length + 2, `document grew: ${md.length} -> ${once.length} chars`);
});

test('empty and near-empty notes stay empty', () => {
  for (const md of ['', '\n', '\n\n\n', ' ']) {
    const once = roundtrip(md);
    const twice = roundtrip(once);
    assert.equal(twice, once, `unstable for ${JSON.stringify(md)}`);
    assert.ok(once.trim().length === 0, `content invented from ${JSON.stringify(md)}: ${JSON.stringify(once)}`);
  }
});

test('unicode content is preserved exactly', () => {
  const md = '# Café résumé\n\n日本語のテキスト with émojis 🎉 and 中文';
  const canonical = assertStable(md, 'unicode');
  for (const s of ['Café résumé', '日本語のテキスト', '🎉', '中文']) {
    assert.ok(canonical.includes(s), `unicode mangled: ${s}`);
  }
});
