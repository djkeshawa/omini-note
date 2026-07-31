const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ops = require('../src/editor/editorOps.js');
const tableOps = require('../src/editor/tableOps.js');
const appHelpers = require('../src/app/appHelpers.js');
const appNovelist = require('../src/app/appNovelist.js');
const appMutations = require('../src/app/appMutations.js');
const appCanvasActions = require('../src/app/appCanvasActions.js');
const panelHelpers = require('../src/panels/panelHelpers.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');

test('Markdown round-trip preserves heading children used by novelist links', () => {
  const outlineApi = loadOutlineForTest();
  const md = '# Act 1\n- act:: [[Act One]]\n- [[Chapter 1]]\n  - [[Scene 1]]';
  const blocks = outlineApi.mnMdToBlocks(md);
  const roundTrip = outlineApi.mnBlocksToMd(blocks);

  assert.match(roundTrip, /# Act 1/);
  assert.match(roundTrip, /act:: \[\[Act One\]\]/);
  assert.match(roundTrip, /\[\[Chapter 1\]\]/);
  assert.match(roundTrip, /\[\[Scene 1\]\]/);

  const labelled = outlineApi.mnMdToBlocks('{{label:blue|Needs+work}} Important block');
  assert.equal(labelled[0].labels[0].color, 'blue');
  assert.equal(labelled[0].labels[0].text, 'Needs work');
  assert.equal(labelled[0].content, 'Important block');
  assert.match(outlineApi.mnBlocksToMd(labelled), /\{\{label:blue\|Needs\+work\}\}Important block/);

  const plotBlocks = outlineApi.mnMdToBlocks('::: plot-points\n- Find the key\n  - context:: [[Alice]]\n:::\nDraft text');
  assert.equal(plotBlocks[0].kind, 'plot-points');
  assert.deepEqual(Array.from(plotBlocks[0].beats), ['Find the key']);
  assert.deepEqual(Array.from(plotBlocks[0].contexts), ['[[Alice]]']);
  assert.match(outlineApi.mnBlocksToMd(plotBlocks), /::: plot-points\n- Find the key\n  - context:: \[\[Alice\]\]\n:::/);
});

test('Markdown round-trip preserves adjacent prose paragraphs', () => {
  const outlineApi = loadOutlineForTest();
  const blocks = [
    outlineApi.mkBlock({ kind: 'paragraph', content: 'The room fell quiet.' }),
    outlineApi.mkBlock({ kind: 'paragraph', content: 'Mara counted the seconds before anyone spoke.' }),
  ];

  const markdown = outlineApi.mnBlocksToMd(blocks);
  assert.equal(markdown, 'The room fell quiet.\n\nMara counted the seconds before anyone spoke.');

  const roundTrip = outlineApi.mnMdToBlocks(markdown);
  assert.equal(roundTrip.length, 2);
  assert.equal(roundTrip[0].content, 'The room fell quiet.');
  assert.equal(roundTrip[1].content, 'Mara counted the seconds before anyone spoke.');
});

test('Markdown table import preserves literal backslashes in cells', () => {
  const outlineApi = loadOutlineForTest();
  const blocks = outlineApi.mnMdToBlocks('| Path | Note |\n| --- | --- |\n| C:\\temp\\notes | keep |');

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'table');
  assert.deepEqual(tableOps.markdownTableToRows(blocks[0].content), [
    ['Path', 'Note'],
    ['C:\\temp\\notes', 'keep'],
  ]);
});

test('Markdown headings support levels one through six on import and save', () => {
  const outlineApi = loadOutlineForTest();
  const blocks = outlineApi.mnMdToBlocks('# One\n#### Four\n##### Five\n###### Six');

  assert.equal(blocks[0].kind, 'heading');
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].children[0].kind, 'heading');
  assert.equal(blocks[0].children[0].level, 4);
  assert.equal(blocks[0].children[0].children[0].kind, 'heading');
  assert.equal(blocks[0].children[0].children[0].level, 5);
  assert.equal(blocks[0].children[0].children[0].children[0].kind, 'heading');
  assert.equal(blocks[0].children[0].children[0].children[0].level, 6);
  assert.equal(outlineApi.mnBlocksToMd(blocks), '# One\n#### Four\n##### Five\n###### Six');
});

test('Existing markdown bodies round-trip without storage-format changes', () => {
  const outlineApi = loadOutlineForTest();
  const markdown = [
    '# Heading',
    '',
    'Paragraph with **bold**, *italic*, `code`, ~~strike~~, [[Wiki Page]], #tag, and @remind 2026-06-01 09:00.',
    '',
    '- [ ] Open task',
    '- [x] Done task',
    '  - Nested bullet',
    '',
    '> Quoted text',
    '',
    '---',
  ].join('\n');

  const blocks = outlineApi.mnMdToBlocks(markdown);
  const roundTrip = outlineApi.mnBlocksToMd(blocks);

  assert.match(roundTrip, /^# Heading/m);
  assert.match(roundTrip, /Paragraph with \*\*bold\*\*, \*italic\*, `code`, ~~strike~~, \[\[Wiki Page\]\], #tag, and @remind 2026-06-01 09:00\./);
  assert.match(roundTrip, /- \[ \] Open task/);
  assert.match(roundTrip, /- \[x\] Done task/);
  assert.match(roundTrip, /  - Nested bullet/);
  assert.match(roundTrip, /^> Quoted text/m);
  assert.match(roundTrip, /^---$/m);
});

test('Ordered and mixed nested lists retain numbers, delimiters, and structure', () => {
  const outlineApi = loadOutlineForTest();
  const markdown = [
    '3. Prepare launch',
    '  - Confirm owners',
    '    1) Design',
    '    2) Engineering',
    '4. Ship',
    '  - [ ] Announce',
  ].join('\n');

  const blocks = outlineApi.mnMdToBlocks(markdown);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, 'ordered');
  assert.equal(blocks[0].listNumber, 3);
  assert.equal(blocks[0].children[0].kind, 'bullet');
  assert.equal(blocks[0].children[0].children[0].kind, 'ordered');
  assert.equal(blocks[0].children[0].children[0].listDelimiter, ')');
  assert.equal(blocks[1].children[0].kind, 'todo');
  assert.equal(outlineApi.mnBlocksToMd(blocks), markdown);
});

test('Specialized markdown blocks keep current parse and serialization behavior', () => {
  const outlineApi = loadOutlineForTest();
  const markdown = [
    'Parent',
    '',
    'status:: open',
    '',
    '| Name | Notes |',
    '| --- | --- |',
    '| Ada | Pipes \\| stay |',
    '',
    '```js',
    'const answer = 42;',
    '```',
    '',
    '::: plot-points',
    '- Find the key',
    '  - context:: [[Alice]]',
    ':::',
  ].join('\n');

  const blocks = outlineApi.mnMdToBlocks(markdown);

  assert.equal(blocks.some(block => block.kind === 'table'), true);
  assert.equal(blocks.some(block => block.kind === 'code' && block.language === 'javascript'), true);
  assert.equal(blocks.some(block => block.kind === 'plot-points'), true);
  assert.equal(blocks.some(block => block.content === 'status:: open'), true);

  const roundTrip = outlineApi.mnBlocksToMd(blocks);
  assert.match(roundTrip, /status:: open/);
  assert.match(roundTrip, /\| Ada \| Pipes \\\| stay \|/);
  assert.match(roundTrip, /```javascript\nconst answer = 42;\n```/);
  assert.match(roundTrip, /::: plot-points\n- Find the key\n  - context:: \[\[Alice\]\]\n:::/);
});

test('a code block that quotes a fence survives being written out and read back', () => {
  const outlineApi = loadOutlineForTest();

  // Writing about markdown inside a code block is ordinary in a notes app. A
  // fixed three-backtick fence let the inner ``` close the block early, so the
  // note came back as three blocks with the tail of the code turned into prose.
  for (const content of [
    'Here is a fence:\n```\nend',
    '```',
    'line1\n```\nline2',
    'nested\n````\ndeeper\n```\nx',
  ]) {
    const markdown = outlineApi.mnBlocksToMd([outlineApi.mkBlock({ kind: 'code', content, language: 'javascript' })]);
    const blocks = outlineApi.mnMdToBlocks(markdown);
    assert.equal(blocks.length, 1, `${JSON.stringify(content)} must stay one block`);
    assert.equal(blocks[0].kind, 'code');
    assert.equal(blocks[0].content, content);
  }
});

test('code blocks with no bare fence inside keep the usual three backticks', () => {
  const outlineApi = loadOutlineForTest();

  // Widening the fence for every block would rewrite every existing note, so
  // only a line of nothing but backticks counts as needing a longer one.
  for (const markdown of [
    '```javascript\nconst a = 1;\n```',
    '```\nplain\n```',
    '```javascript\nconst s = "```";\n```',
  ]) {
    assert.equal(outlineApi.mnBlocksToMd(outlineApi.mnMdToBlocks(markdown)), markdown);
  }
});
