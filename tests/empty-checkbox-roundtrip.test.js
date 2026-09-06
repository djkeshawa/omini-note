const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOutlineForTest } = require('./helpers/common.js');

const { mkBlock, mnMdToBlocks, mnBlocksToMd } = loadOutlineForTest();

for (const checked of [false, true]) {
  test(`an empty ${checked ? 'completed' : 'open'} checkbox remains a checkbox after saving and reopening`, () => {
    const original = mkBlock({ kind: 'todo', checked, content: '' });
    const saved = mnBlocksToMd([original]);
    const [reopened] = mnMdToBlocks(saved);
    assert.equal(reopened.kind, 'todo');
    assert.equal(reopened.checked, checked);
    assert.equal(reopened.content, '');
    assert.equal(mnBlocksToMd([reopened]), saved);
  });
}

test('empty nested checkboxes preserve their parent and completion state', () => {
  const [parent] = mnMdToBlocks('- Parent\n  - [ ]\n  - [X]');
  assert.equal(parent.kind, 'bullet');
  assert.deepEqual(parent.children.map(({ kind, checked, content }) => ({ kind, checked, content })), [
    { kind: 'todo', checked: false, content: '' },
    { kind: 'todo', checked: true, content: '' },
  ]);
});

test('bracket text attached to a word stays literal', () => {
  const [block] = mnMdToBlocks('- [x]coordinate');
  assert.equal(block.kind, 'bullet');
  assert.equal(block.content, '[x]coordinate');
});
