const test = require('node:test');
const assert = require('node:assert/strict');

const { loadOutlineForTest } = require('./helpers/common.js');

const outline = loadOutlineForTest();
const { mkBlock, mnMdToBlocks, mnBlocksToMd } = outline;

// Compare on the structural fields only: `id` is generated per call, so a deep
// equal against the input blocks would fail on identity alone. `workflow` and
// `labels` are in here because they are the fields a block loses silently: the
// state word or the label reappears as ordinary text at the front of the
// content, which reads as "my note is fine" to a shape check that only looks at
// kind/content. Label ids are generated per parse, so only text and colour are
// compared.
const shapeOf = blocks => blocks.map(b => ({
  kind: b.kind,
  content: b.content,
  checked: b.checked,
  workflow: b.workflow || null,
  labels: (b.labels || []).map(label => ({ text: label.text, color: label.color })),
  children: shapeOf(b.children || []),
}));

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

test('an intra-block line break survives serialize and re-parse in one block', () => {
  // Shift+Enter puts a \n inside one block's content. Written as a bare newline
  // it re-parsed as a second, stray top-level block -- the user's paragraph
  // silently split in half on the next save.
  const blocks = [
    mkBlock({ kind: 'paragraph', content: 'para line one\npara line two' }),
    mkBlock({
      kind: 'bullet',
      content: 'bullet line one\nbullet line two',
      children: [mkBlock({ kind: 'todo', content: 'todo line one\ntodo line two', checked: false })],
    }),
    mkBlock({ kind: 'quote', content: 'quote line one\nquote line two' }),
  ];
  const md = mnBlocksToMd(blocks);
  assert.deepEqual(shapeOf(mnMdToBlocks(md)), shapeOf(blocks));
  // The break marker is an on-disk detail; it must never reach block.content,
  // because MnOutlinerView renders block.content directly.
  for (const b of mnMdToBlocks(md)) {
    assert.ok(!/\\$/m.test(b.content), `break marker leaked into content: ${JSON.stringify(b.content)}`);
  }
  assertStable(md, 'intra-block line breaks');
});

// REPLACES the round-1 test 'a heading section ends so a de-indented sibling
// stays a sibling'. That test asserted the double-blank-line section terminator,
// which is exactly what this round reverts: the terminator changed the bytes of
// every note that already contained a blank line inside a heading section, and
// it could not tell a de-indented sibling from a child anyway. The assertion was
// not weakened to make something pass — the behaviour it pinned is gone on
// purpose, and what replaces it is asserted here instead.
test('the children of a heading section stay its children across a blank-line run', () => {
  const parsed = mnMdToBlocks('# Section\n\npara one\n\n\npara two');
  assert.equal(parsed.length, 1, 'a blank-line run split the section');
  assert.equal(parsed[0].kind, 'heading');
  assert.deepEqual(parsed[0].children.map(b => b.content), ['para one', 'para two']);
  assertStable('# Section\n\npara one\n\n\npara two', 'heading with a blank-line run');
});

test('a paragraph after a heading section is re-nested — the known limitation', () => {
  // Pre-existing and deliberately not fixed: nothing on disk distinguishes a
  // sibling of the heading from its last child. This test exists so the
  // limitation is visible and a future fix is a deliberate act, not a surprise.
  const blocks = [
    mkBlock({ kind: 'heading', level: 2, content: 'Section', children: [mkBlock({ kind: 'paragraph', content: 'first child' })] }),
    mkBlock({ kind: 'paragraph', content: 'top level sibling' }),
  ];
  const md = mnBlocksToMd(blocks);
  const parsed = mnMdToBlocks(md);
  assert.equal(parsed.length, 1, 'the on-disk format gained a section terminator');
  assert.deepEqual(parsed[0].children.map(b => b.content), ['first child', 'top level sibling']);
  assertStable(md, 'heading then sibling');
});

test('a divider after a paragraph never re-parses as a setext heading', () => {
  const md = mnBlocksToMd([
    mkBlock({ kind: 'paragraph', content: 'Some text' }),
    mkBlock({ kind: 'divider' }),
  ]);
  assert.ok(/Some text\n\n---/.test(md), `no blank line before the divider: ${JSON.stringify(md)}`);
  const parsed = mnMdToBlocks(md);
  assert.deepEqual(parsed.map(b => b.kind), ['paragraph', 'divider']);
  assert.equal(parsed[0].content, 'Some text');
  assertStable(md, 'paragraph then divider');
});

test('a heading, code fence or table directly after a paragraph is separated', () => {
  // NB: the table needs two columns — readMarkdownTable only recognizes a
  // separator row with >= 2 cells, so a one-column fixture degrades to a
  // paragraph and the assertion below would test nothing.
  const cases = [
    [mkBlock({ kind: 'heading', level: 3, content: 'Later' }), 'heading'],
    [mkBlock({ kind: 'code', content: 'const x = 1;', language: 'js' }), 'code'],
    [mkBlock({ kind: 'table', content: '| A | B |\n| --- | --- |\n| 1 | 2 |' }), 'table'],
  ];
  for (const [next, kind] of cases) {
    const md = mnBlocksToMd([mkBlock({ kind: 'paragraph', content: 'Some text' }), next]);
    assert.ok(/^Some text\n\n/.test(md), `${kind} not separated from the paragraph: ${JSON.stringify(md)}`);
    const parsed = mnMdToBlocks(md);
    assert.equal(parsed[0].kind, 'paragraph', `${kind} absorbed the paragraph`);
    assert.equal(parsed[1] && parsed[1].kind, kind, `the ${kind} did not survive as a ${kind}`);
    assertStable(md, `paragraph then ${kind}`);
  }
});

// Every block kind whose first line sits flush against the line above it, so a
// paragraph ending in a backslash is written directly next to each of them.
const flushAdjacent = () => ({
  heading: mkBlock({ kind: 'heading', level: 2, content: 'Later' }),
  bullet: mkBlock({ kind: 'bullet', content: 'item one' }),
  ordered: mkBlock({ kind: 'ordered', content: 'first', listNumber: 1 }),
  todo: mkBlock({ kind: 'todo', content: 'open item', checked: false }),
  quote: mkBlock({ kind: 'quote', content: 'a quote line' }),
  code: mkBlock({ kind: 'code', content: 'const x = 1;', language: 'js' }),
  table: mkBlock({ kind: 'table', content: '| A | B |\n| --- | --- |\n| 1 | 2 |' }),
  divider: mkBlock({ kind: 'divider' }),
  'plot-points': mkBlock({ kind: 'plot-points', content: 'Plot Points', beats: ['a beat'] }),
});

test('a paragraph ending in one or two literal backslashes never swallows the block after it', () => {
  // The writer doubles the content's own trailing run and appends the soft-break
  // marker, so the run the reader sees is odd only when a marker is really
  // there. Before that, "see C:\notes\" ate the bullet on the next line.
  for (const tail of ['see C:\\notes\\', 'ends in two\\\\']) {
    for (const [kind, next] of Object.entries(flushAdjacent())) {
      const md = mnBlocksToMd([mkBlock({ kind: 'paragraph', content: tail }), next]);
      const parsed = mnMdToBlocks(md);
      assert.equal(parsed.length, 2, `${kind} after ${JSON.stringify(tail)} merged into one block: ${JSON.stringify(md)}`);
      assert.equal(parsed[0].content, tail, `paragraph content changed before a ${kind}`);
      assert.equal(parsed[1].kind, kind, `the ${kind} did not survive`);
      assertStable(md, `${JSON.stringify(tail)} then ${kind}`);
    }
  }
});

test('the reported reproducer round-trips to two blocks with the path byte-identical', () => {
  const blocks = [
    mkBlock({ kind: 'paragraph', content: 'see C:\\notes\\' }),
    mkBlock({ kind: 'bullet', content: 'item one' }),
  ];
  const parsed = mnMdToBlocks(mnBlocksToMd(blocks));
  assert.equal(parsed.length, 2, 'the bullet was folded into the paragraph');
  assert.equal(parsed[0].content, 'see C:\\notes\\');
  assert.deepEqual(shapeOf(parsed), shapeOf(blocks));
});

test('bytes written by 0.2.5 still parse to the tree 0.2.5 parsed them to', () => {
  // These are on-disk strings from before the soft-break marker existed: the
  // backslash is the user's own text and was written with no doubling. The
  // reader must not read the last one as a marker and eat the next block.
  const legacy = [
    ['para\\' + '\n' + '---' + '\n', ['paragraph', 'divider'], 'para\\'],
    ['para\\' + '\n\n' + '---', ['paragraph', 'divider'], 'para\\'],
    ['see C:\\notes\\' + '\n' + '- item one', ['paragraph', 'bullet'], 'see C:\\notes\\'],
    ['ends here\\' + '\n' + '# Heading', ['paragraph', 'heading'], 'ends here\\'],
    ['ends here\\' + '\n' + '> quoted', ['paragraph', 'quote'], 'ends here\\'],
  ];
  for (const [md, kinds, content] of legacy) {
    const parsed = mnMdToBlocks(md);
    assert.deepEqual(parsed.map(b => b.kind), kinds, `legacy bytes re-read wrong: ${JSON.stringify(md)}`);
    assert.equal(parsed[0].content, content, `legacy backslash lost: ${JSON.stringify(md)}`);
  }
});

test('a continuation line that reads as another block is escaped on write and folded on read', () => {
  // Both defences have to hold. The reader refuses to fold into a construct
  // (that is what protects the legacy bytes above), so the writer has to escape
  // a continuation line that would look like one, or a genuine Shift+Enter
  // break before "- not a bullet" would split the block in two.
  for (const content of [
    'intro:\n- not a bullet',
    'intro:\n# not a heading',
    'intro:\n> not a quote',
    'intro:\n1. not an ordered item',
    'intro:\n- [ ] not a todo',
    'intro:\n---',
    'intro:\n| not | a table |',
    'intro:\n```',
    'intro:\n::: plot-points',
    'intro:\n\\- an escaped bullet the user typed',
    'intro:\n\nblank line between',
  ]) {
    const md = mnBlocksToMd([mkBlock({ kind: 'paragraph', content })]);
    const parsed = mnMdToBlocks(md);
    assert.equal(parsed.length, 1, `${JSON.stringify(content)} split into ${parsed.length} blocks: ${JSON.stringify(md)}`);
    assert.equal(parsed[0].content, content, `content changed: ${JSON.stringify(md)}`);
    assertStable(md, JSON.stringify(content));
  }
});

test('a workflow state survives a soft break instead of leaking into the text', () => {
  // Pre-A3 splitWorkflow matched with `.*`, which stops at \n: the block came
  // back with workflow null and the literal word TODO as its first word, and the
  // workflow pill disappeared from the row.
  const blocks = [
    mkBlock({ kind: 'paragraph', content: 'call the vet\nask about the dose', workflow: 'TODO' }),
    mkBlock({ kind: 'todo', content: 'first line\nsecond line', checked: false, workflow: 'DOING' }),
  ];
  const md = mnBlocksToMd(blocks);
  const parsed = mnMdToBlocks(md);
  assert.deepEqual(shapeOf(parsed), shapeOf(blocks));
  assert.equal(parsed[0].workflow, 'TODO');
  assert.equal(parsed[1].workflow, 'DOING');
  for (const b of parsed) {
    assert.ok(!/TODO|DOING/.test(b.content), `the state word leaked into content: ${JSON.stringify(b.content)}`);
  }
  assertStable(md, 'workflow with a soft break');
});

test('a content-final newline is normalized away, never written as a marker', () => {
  // UI spec section 6: under pre-wrap a trailing \n is a blank line the user
  // cannot see or confirm, and preserving it would mean folding a marker into a
  // blank line — the signal a real paragraph break uses. 'a\n' becomes 'a'.
  for (const [content, expected] of [['a\n', 'a'], ['a\n\n', 'a'], ['a\nb\n', 'a\nb']]) {
    const md = mnBlocksToMd([mkBlock({ kind: 'paragraph', content })]);
    assert.ok(!/\\$/.test(md), `a trailing newline became a stray marker: ${JSON.stringify(md)}`);
    const parsed = mnMdToBlocks(md);
    assert.equal(parsed.length, 1, `${JSON.stringify(content)} split into ${parsed.length} blocks`);
    assert.equal(parsed[0].content, expected);
    assertStable(md, `trailing newline in ${JSON.stringify(content)}`);
  }
});

// The codec that encodes a Shift+Enter break must only ever touch the block
// kinds the writer escapes. Two earlier attempts ran it over every line, and
// each raw-emitting kind — heading, table, plot-points, property line — became
// a separate silent-corruption case. These lock the boundary in both
// directions: fresh round-trips, and the bytes VispNote 0.2.5 already wrote.

test('a raw-emitted kind never has its backslash run decoded', () => {
  // The writer emits heading content verbatim, so the reader must not halve it.
  const blocks = [mkBlock({
    kind: 'heading', level: 2, content: 'notes in C:\\',
    children: [mkBlock({ kind: 'paragraph', content: 'text' })],
  })];
  const md = mnBlocksToMd(blocks);
  const parsed = mnMdToBlocks(md);
  assert.equal(parsed.length, 1, 'the heading was swallowed into prose');
  assert.equal(parsed[0].kind, 'heading');
  assert.equal(parsed[0].content, 'notes in C:\\');
  assert.equal(parsed[0].children.length, 1, 'the first child was eaten by the fold');
  assertStable(md, 'heading ending in a backslash');

  // 0.2.5 bytes: a heading whose text genuinely ended in two backslashes must
  // come back with both, not halved to one.
  assert.equal(mnMdToBlocks('## ends\\\\\n')[0].content, 'ends\\\\');
});

test('a marked line never folds into the block that follows it', () => {
  // Every shape that opens a new block, including the two the fold guard
  // originally missed: a pipe-less table row, and a property line.
  const followers = [
    ['- item one', 'bullet'],
    ['1. item one', 'ordered'],
    ['- [ ] task', 'todo'],
    ['# Heading', 'heading'],
    ['> quoted', 'quote'],
    ['---', 'divider'],
    ['```\ncode\n```', 'code'],
    ['| A | B |\n| --- | --- |\n| 1 | 2 |', 'table'],
    ['A | B\n--- | ---\n1 | 2', 'table'],
    ['arc:: onboarding', 'paragraph'],
  ];
  for (const [tail, kind] of followers) {
    // Legacy bytes: a 0.2.5 paragraph whose text ended in one backslash.
    const parsed = mnMdToBlocks(`para\\\n${tail}`);
    assert.ok(parsed.length >= 2, `the ${kind} after a backslash was deleted: ${JSON.stringify(parsed)}`);
    assert.equal(parsed[0].kind, 'paragraph');
    assert.equal(parsed[0].content, 'para\\', 'the legacy backslash was rewritten');
    assert.equal(parsed[1].kind, kind, `the ${kind} did not survive as a ${kind}`);
  }
});

test('every carrier kind survives a literal trailing backslash before every follower', () => {
  // The earlier fixture matrix varied only the FOLLOWING block and always used
  // a paragraph as the carrier, which is why five corruptions stayed green.
  const carriers = ['paragraph', 'bullet', 'todo', 'quote', 'ordered'];
  const followers = ['paragraph', 'bullet', 'todo', 'quote', 'heading', 'divider'];
  for (const carrier of carriers) {
    for (const tail of ['a C:\\', 'a C:\\\\', 'a\nb C:\\']) {
      for (const follower of followers) {
        const blocks = [
          mkBlock({ kind: carrier, content: tail, level: 2 }),
          mkBlock({ kind: follower, content: 'after', level: 2 }),
        ];
        const md = mnBlocksToMd(blocks);
        const parsed = mnMdToBlocks(md);
        const label = `${carrier} ${JSON.stringify(tail)} then ${follower}`;
        assert.equal(parsed.length, 2, `${label}: became ${parsed.length} blocks`);
        assert.equal(parsed[0].content, tail, `${label}: carrier content changed`);
        assert.equal(parsed[1].kind, follower, `${label}: follower kind changed`);
        assertStable(md, label);
      }
    }
  }
});

test('a state word alone on a block first line is not a workflow pill', () => {
  // The separator was `\s+`, and `\s` matches \n, so a break after a bare
  // "TODO" handed the user a pill they never set and ate the line break.
  const md = mnBlocksToMd([mkBlock({ kind: 'paragraph', content: 'TODO\nbuy milk' })]);
  const parsed = mnMdToBlocks(md);
  assert.equal(parsed[0].workflow, null, 'a workflow pill appeared from nowhere');
  assert.equal(parsed[0].content, 'TODO\nbuy milk');
  assertStable(md, 'bare state word before a soft break');
});

test('an untouched note writes the same bytes on every save', () => {
  // 'a\n ' stranded the marker on 'a', writing 'a\', which the next save then
  // doubled to 'a\\'. Saving a note nobody edited must be a fixed point.
  for (const content of ['a\n ', 'a\n\t', 'a\nb\n  ', 'C:\\\n ']) {
    const first = mnBlocksToMd([mkBlock({ kind: 'paragraph', content })]);
    const second = mnBlocksToMd(mnMdToBlocks(first));
    assert.equal(second, first, `${JSON.stringify(content)} wrote different bytes on the second save`);
  }
});
