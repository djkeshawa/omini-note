const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');

function loadModule(relativePath, exportNames) {
  const loaded = loadRendererModule(relativePath);
  return Object.fromEntries(exportNames.map(name => [name, loaded[name]]));
}

function locate(blocks, id, parent = null) {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.id === id) return { block, arr: blocks, idx: index, parent };
    const nested = locate(block.children || [], id, block);
    if (nested) return nested;
  }
  return null;
}

test('editor feature models parse metadata and slash commands independently', () => {
  const metadata = loadModule('src/features/editor/metadata/model.js', [
    'propertyParts', 'splitPropertyBlocks', 'cleanPropertyKey', 'createPropertyBlock',
  ]);
  const slash = loadModule('src/features/editor/outliner/slashCommands.js', [
    'BASE_SLASH_COMMANDS', 'slashCommands', 'findSlashCommandTrigger', 'slashCommandScore',
  ]);
  const blocks = [
    { id: 'p1', kind: 'paragraph', content: 'status:: active' },
    { id: 'n1', kind: 'paragraph', content: 'Body' },
  ];

  assert.deepEqual(metadata.propertyParts(blocks[0].content), { key: 'status', value: 'active' });
  assert.equal(metadata.splitPropertyBlocks(blocks).contentBlocks[0].id, 'n1');
  assert.equal(metadata.cleanPropertyKey(' Project Status! '), 'project-status');
  assert.deepEqual(slash.findSlashCommandTrigger('Try /hea', 8), { query: 'hea', start: 4, end: 8 });
  assert.ok(slash.slashCommandScore({ id: 'h1', label: 'Heading 1', hint: 'Title', kbd: '#' }, 'head') < Infinity);
});

test('clipboard model normalizes markdown and regenerates block ids', () => {
  const clipboard = loadModule('src/features/editor/outliner/clipboardModel.js', [
    'BLOCK_CLIPBOARD_TYPE', 'isClipboardBlock', 'reidBlocks', 'normalizeClipboardMarkdown', 'looksLikeBlockMarkdown',
  ]);
  const source = [{ id: 'old', kind: 'paragraph', content: 'One', children: [] }];
  const copied = clipboard.reidBlocks(source, value => structuredClone(value));

  assert.notEqual(copied[0].id, 'old');
  assert.equal(source[0].id, 'old');
  assert.equal(clipboard.normalizeClipboardMarkdown('One  \r\n\r\n\r\nTwo'), 'One\n\nTwo');
  assert.equal(clipboard.looksLikeBlockMarkdown('- one\n- two'), true);
  assert.equal(clipboard.isClipboardBlock(source[0]), true);
});

test('block operations mutate only the supplied block tree', () => {
  const operations = loadModule('src/features/editor/outliner/blockOperations.js', [
    'changeBlockKind', 'toggleBlockCollapse', 'toggleBlockCheck', 'indentBlock', 'outdentBlock',
    'splitBlockAt', 'insertBlocksAt', 'mergeBlockWithPrevious', 'deleteBlock', 'moveBlock',
  ]);
  const blocks = [
    { id: 'a', kind: 'paragraph', content: 'A', collapsed: false, children: [] },
    { id: 'b', kind: 'todo', content: 'B', checked: false, collapsed: false, children: [] },
  ];

  operations.indentBlock(blocks, 'b', locate);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].children[0].id, 'b');
  operations.toggleBlockCheck(blocks, 'b', locate);
  assert.equal(blocks[0].children[0].checked, true);
  operations.outdentBlock(blocks, 'b', locate);
  assert.deepEqual(blocks.map(block => block.id), ['a', 'b']);
  operations.moveBlock(blocks, 'b', 'a', 'up', locate);
  assert.deepEqual(blocks.map(block => block.id), ['b', 'a']);
});
