const test = require('node:test');
const assert = require('node:assert/strict');

const { loadRendererModule } = require('./helpers/rendererModule.js');
const { loadOutlineForTest } = require('./helpers/common.js');

const { createEditorHistory, shareBlockTree } = loadRendererModule('src/editor/outlinerHistory.js');
const outline = loadOutlineForTest();

// Undo is the user's safety net. The expectations under test: undo walks
// backward through edits in order, redo replays them, a new edit forgets the
// redo future, history depth is bounded, and -- the one that silently loses
// work if it breaks -- a snapshot in the stack is immune to later edits.

const para = (id, content) => ({ id, kind: 'paragraph', content, children: [] });

test('undo returns states in reverse order and redo replays them', () => {
  const history = createEditorHistory();
  const v1 = [para('a', 'one')];
  const v2 = [para('a', 'one two')];
  const v3 = [para('a', 'one two three')];
  history.record(v1);
  history.record(v2);

  const back1 = history.undo(v3);
  assert.equal(back1[0].content, 'one two', 'first undo should return the second state');
  const back2 = history.undo(back1);
  assert.equal(back2[0].content, 'one', 'second undo should return the first state');

  const fwd1 = history.redo(back2);
  assert.equal(fwd1[0].content, 'one two', 'redo should walk forward again');
  const fwd2 = history.redo(fwd1);
  assert.equal(fwd2[0].content, 'one two three', 'redo should end at the newest state');
});

test('a new edit after undo forgets the redo future', () => {
  // Standard editor semantics: undo, then type something new -- redo must not
  // resurrect the abandoned branch.
  const history = createEditorHistory();
  history.record([para('a', 'v1')]);
  history.record([para('a', 'v2')]);
  history.undo([para('a', 'v3')]);
  assert.ok(history.redoStack.length > 0, 'undo should have armed redo');
  history.record([para('a', 'v2-alternate')]);
  assert.equal(history.redoStack.length, 0, 'a new edit must clear the redo stack');
  assert.equal(history.redo([para('a', 'x')]), null, 'redo after a new edit must do nothing');
});

test('history depth is bounded and drops the oldest state, not the newest', () => {
  const history = createEditorHistory(5);
  for (let i = 1; i <= 9; i++) history.record([para('a', `v${i}`)]);
  assert.equal(history.undoStack.length, 5, 'the cap was not applied');
  // Walk all the way back: the oldest reachable state must be v5 (v1-v4 dropped).
  let state = [para('a', 'v10')];
  let last = null;
  for (;;) {
    const prior = history.undo(state);
    if (!prior) break;
    last = prior;
    state = prior;
  }
  assert.equal(last[0].content, 'v5', `deepest undo reached ${last[0].content}, so the cap dropped the wrong end`);
});

test('undo and redo on empty stacks do nothing rather than corrupting state', () => {
  const history = createEditorHistory();
  assert.equal(history.undo([para('a', 'x')]), null);
  assert.equal(history.redo([para('a', 'x')]), null);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0, 'a no-op undo must not push onto redo');
});

test('clear empties both stacks (switching notes must not leak history)', () => {
  const history = createEditorHistory();
  history.record([para('a', 'v1')]);
  history.undo([para('a', 'v2')]);
  history.clear();
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
  assert.equal(history.undo([para('a', 'x')]), null, 'cleared history still had something to undo');
});

test('a snapshot in the undo stack is immune to later edits', () => {
  // The editor snapshots with mnCloneBlocks before mutating a fresh clone. If
  // either clone is shallow, editing "two" would rewrite the stored snapshot
  // and undo would return the CURRENT text -- undo that undoes nothing.
  const history = createEditorHistory();
  const current = [para('a', 'one'), { ...para('b', 'nested parent'), children: [para('c', 'child')] }];
  history.record(outline.mnCloneBlocks(current));
  // Simulate the post-snapshot in-place edit mutate() performs on its clone.
  const working = outline.mnCloneBlocks(current);
  working[0].content = 'one EDITED';
  working[1].children[0].content = 'child EDITED';
  const restored = history.undo(working);
  assert.equal(restored[0].content, 'one', 'the top-level snapshot was corrupted by a later edit');
  assert.equal(restored[1].children[0].content, 'child', 'the nested snapshot was corrupted by a later edit');
});

test('shareBlockTree keeps identity for unchanged blocks and replaces changed ones', () => {
  // Structural sharing is what keeps 80 snapshots of a large note affordable;
  // it must share exactly the unchanged blocks and nothing else.
  const prev = [para('a', 'same'), { ...para('b', 'parent'), children: [para('c', 'child')] }];
  const next = [para('a', 'same'), { ...para('b', 'parent'), children: [para('c', 'child CHANGED')] }];
  const shared = shareBlockTree(prev, next);
  assert.equal(shared[0], prev[0], 'an unchanged block should keep its identity');
  assert.notEqual(shared[1], prev[1], 'a block whose child changed must be a new object');
  assert.equal(shared[1].children[0].content, 'child CHANGED', 'the change itself was lost');
  // Fully identical trees collapse to the previous reference entirely.
  const same = shareBlockTree(prev, [para('a', 'same'), { ...para('b', 'parent'), children: [para('c', 'child')] }]);
  assert.equal(same, prev, 'an identical tree should return the previous array itself');
});

test('shareBlockTree treats added and removed blocks as changes', () => {
  const prev = [para('a', 'one'), para('b', 'two')];
  const grown = shareBlockTree(prev, [para('a', 'one'), para('b', 'two'), para('c', 'three')]);
  assert.equal(grown.length, 3);
  assert.equal(grown[0], prev[0], 'existing blocks should still share identity when the list grows');
  const shrunk = shareBlockTree(prev, [para('a', 'one')]);
  assert.equal(shrunk.length, 1, 'a removed block came back');
});
