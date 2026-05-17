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
