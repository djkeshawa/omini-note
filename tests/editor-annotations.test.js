const test = require('node:test');
const assert = require('node:assert/strict');

const ops = require('../src/editor/editorOps.js');

// Inline formatting is stored as ranges over the block's text, so every edit
// has to move those ranges with it. A range left behind bolds the wrong words;
// a range past the end of the text is dropped on the next render. These pin
// the arithmetic. editor-ops.test.js pins the block operations built on it.

const ann = (start, end, kind = 'bold') => ({ start, end, kind });

test('annotation ranges are clamped, ordered and pruned', () => {
  assert.deepEqual(ops.normalizeAnnotations([ann(2, 5), ann(0, 3)], 10), [ann(0, 3), ann(2, 5)],
    'ranges come back in document order');
  assert.deepEqual(ops.normalizeAnnotations([ann(-5, 99)], 10), [ann(0, 10)], 'a range is clamped to the text');
  assert.deepEqual(ops.normalizeAnnotations([ann(5, 5)], 10), [], 'an empty range formats nothing');
  assert.deepEqual(ops.normalizeAnnotations([ann(5, 2)], 10), [], 'a backwards range is not a range');
  assert.deepEqual(ops.normalizeAnnotations([{ start: 0, end: 3 }], 10), [], 'a range with no kind formats nothing');
  assert.deepEqual(ops.normalizeAnnotations([ann(0, 3)], 0), [], 'nothing can be formatted in empty text');
  assert.deepEqual(ops.normalizeAnnotations(null, 10), []);
  assert.deepEqual(ops.normalizeAnnotations([{ start: 'x', end: 'y', kind: 'bold' }], 10), []);
  assert.deepEqual(ops.normalizeAnnotations([ann(0, 3, 'italic'), ann(0, 3, 'bold')], 10),
    [ann(0, 3, 'bold'), ann(0, 3, 'italic')], 'two ranges at the same place sort by kind, so the order is stable');
});

test('formats of the same family replace each other, others stack', () => {
  assert.equal(ops.sameFormatFamily('hi-yellow', 'hi-blue'), true, 'two highlights are one choice');
  assert.equal(ops.sameFormatFamily('color-red', 'color-blue'), true);
  assert.equal(ops.sameFormatFamily('fs-14', 'fs-18'), true);
  assert.equal(ops.sameFormatFamily('bold', 'bold'), true);
  assert.equal(ops.sameFormatFamily('hi-yellow', 'bold'), false);
  assert.equal(ops.sameFormatFamily('bold', 'italic'), false);
  assert.equal(ops.sameFormatFamily('color-red', 'hi-red'), false);

  const highlighted = ops.applyAnnotationRange([ann(0, 10, 'hi-yellow')], 2, 5, 'hi-blue', 10);
  assert.deepEqual(highlighted, [ann(0, 2, 'hi-yellow'), ann(2, 5, 'hi-blue'), ann(5, 10, 'hi-yellow')],
    'a new highlight cuts a hole in the old one rather than layering over it');
  const stacked = ops.applyAnnotationRange([ann(0, 10, 'bold')], 2, 5, 'italic', 10);
  assert.deepEqual(stacked, [ann(0, 10, 'bold'), ann(2, 5, 'italic')], 'bold and italic coexist');
  assert.deepEqual(ops.applyAnnotationRange([ann(0, 5)], 5, 5, 'italic', 10), [ann(0, 5)],
    'applying a format to nothing changes nothing');
  assert.deepEqual(ops.applyAnnotationRange([ann(0, 5)], 0, 5, '', 10), [ann(0, 5)]);
});

test('clearing a range splits, trims or removes what it overlaps', () => {
  assert.deepEqual(ops.clearAnnotationRange([ann(0, 10)], 2, 5, 10), [ann(0, 2), ann(5, 10)], 'a hole in the middle');
  assert.deepEqual(ops.clearAnnotationRange([ann(0, 10)], 0, 5, 10), [ann(5, 10)], 'trimmed from the front');
  assert.deepEqual(ops.clearAnnotationRange([ann(0, 10)], 5, 10, 10), [ann(0, 5)], 'trimmed from the back');
  assert.deepEqual(ops.clearAnnotationRange([ann(2, 5)], 0, 10, 10), [], 'covered entirely, so gone');
  assert.deepEqual(ops.clearAnnotationRange([ann(0, 3)], 5, 8, 10), [ann(0, 3)], 'a range it does not touch is untouched');
  assert.deepEqual(ops.clearAnnotationRange([ann(0, 3)], 5, 5, 10), [ann(0, 3)], 'clearing nothing clears nothing');
  assert.deepEqual(ops.clearAnnotationRange([ann(0, 3)], 8, 5, 10), [ann(0, 3)]);
});

test('typing inside formatted text extends the format, typing after it does not', () => {
  const change = (annotations, start, end, insertedLength, oldLength, newLength) =>
    ops.adjustAnnotationsForTextChange(annotations, start, end, insertedLength, oldLength, newLength);

  assert.deepEqual(change([ann(2, 6)], 4, 4, 3, 10, 13), [ann(2, 9)],
    'a character typed inside a bold word stays bold');
  assert.deepEqual(change([ann(2, 6)], 6, 6, 3, 10, 13), [ann(2, 9)],
    'typing at the very end of a bold word continues it');
  assert.deepEqual(change([ann(2, 6)], 0, 0, 3, 10, 13), [ann(5, 9)],
    'typing before it moves it along without changing what it covers');
  assert.deepEqual(change([ann(2, 6)], 8, 8, 3, 10, 13), [ann(2, 6)],
    'typing after it leaves it exactly where it was');

  // Deleting and replacing.
  assert.deepEqual(change([ann(4, 8)], 0, 2, 0, 10, 8), [ann(2, 6)], 'deleting before it slides it back');
  assert.deepEqual(change([ann(0, 4)], 6, 8, 0, 10, 8), [ann(0, 4)], 'deleting after it leaves it alone');
  assert.deepEqual(change([ann(2, 8)], 4, 6, 0, 10, 8), [ann(2, 4), ann(4, 6)],
    'deleting from the middle closes the gap on both sides');
  assert.deepEqual(change([ann(2, 8)], 0, 10, 0, 10, 0), [], 'deleting everything removes every format');
  assert.deepEqual(change([ann(0, 10)], 2, 5, 1, 10, 8), [ann(0, 2), ann(3, 8)],
    'replacing part of a formatted run splits it around the replacement');
});

test('a text change is derived from what actually differs', () => {
  assert.deepEqual(ops.deriveTextChange('hello world', 'hello brave world'),
    { start: 6, end: 6, replacement: 'brave ' }, 'only the inserted words are the change');
  assert.deepEqual(ops.deriveTextChange('hello world', 'hello'), { start: 5, end: 11, replacement: '' });
  assert.deepEqual(ops.deriveTextChange('hello', 'hello'), { start: 5, end: 5, replacement: '' },
    'no change is an empty change');
  assert.deepEqual(ops.deriveTextChange('', 'new'), { start: 0, end: 0, replacement: 'new' });
  assert.deepEqual(ops.deriveTextChange('old', ''), { start: 0, end: 3, replacement: '' });
  assert.deepEqual(ops.deriveTextChange(null, null), { start: 0, end: 0, replacement: '' });
  assert.deepEqual(ops.deriveTextChange('abc', 'axc'), { start: 1, end: 2, replacement: 'x' });
});

test('replacing a range rewrites the text and the formats together', () => {
  const result = ops.replaceTextRange('hello world', [ann(0, 5)], 6, 11, 'there');
  assert.equal(result.content, 'hello there');
  assert.deepEqual(result.annotations, [ann(0, 5)], 'a format before the change is unaffected');

  assert.equal(ops.replaceTextRange('hello', [], -5, 99, 'x').content, 'x', 'the range is clamped to the text');
  assert.equal(ops.replaceTextRange('hello', [], 4, 2, '').content, 'hello',
    'a backwards range collapses to a no-op rather than reversing the text');
  assert.equal(ops.replaceTextRange(null, [], 0, 0, null).content, '');
  assert.equal(ops.replaceTextRange('hello', null, 0, 0, 'x').content, 'xhello');
});

test('splitting a block divides its formats at the caret', () => {
  const split = ops.splitAnnotations([ann(0, 4), ann(2, 8), ann(6, 10)], 5, 10);
  assert.deepEqual(split.before, [ann(0, 4), ann(2, 5)], 'a format crossing the caret is cut in two');
  assert.deepEqual(split.after, [ann(0, 3), ann(1, 5)], 'and the far half is rebased on the new block');
  assert.deepEqual(ops.splitAnnotations([ann(0, 4)], 0, 10).before, [], 'splitting at the start leaves nothing behind');
  assert.deepEqual(ops.splitAnnotations([ann(0, 4)], 10, 10).after, []);
  assert.deepEqual(ops.splitAnnotations([], 5, 10), { before: [], after: [] });
  assert.deepEqual(ops.splitAnnotations(null, -5, 10).before, []);

  const block = { content: 'hello world', annotations: [ann(0, 11)] };
  const next = ops.splitBlock(block, 5, { content: '', annotations: [] });
  assert.equal(block.content, 'hello');
  assert.equal(next.content, ' world');
  assert.deepEqual(block.annotations, [ann(0, 5)]);
  assert.deepEqual(next.annotations, [ann(0, 6)]);
  const atEnd = ops.splitBlock({ content: 'hello', annotations: [] }, 99, { content: '', annotations: [] });
  assert.equal(atEnd.content, '', 'a caret past the end splits off nothing');
});

test('merging two blocks shifts the second block\'s formats along', () => {
  assert.deepEqual(ops.mergeAnnotations([ann(0, 5)], [ann(0, 6)], 5, 11), [ann(0, 5), ann(5, 11)]);
  assert.deepEqual(ops.mergeAnnotations(null, null, 0, 0), []);
  assert.deepEqual(ops.mergeAnnotations([ann(0, 5)], [], 5, 5), [ann(0, 5)]);

  const target = { content: 'hello', annotations: [ann(0, 5)] };
  ops.mergeBlockContent(target, { content: ' world', annotations: [ann(1, 6, 'italic')] });
  assert.equal(target.content, 'hello world');
  assert.deepEqual(target.annotations, [ann(0, 5), ann(6, 11, 'italic')],
    'the joined block keeps both blocks\' formatting over the right words');
  const emptyMerge = ops.mergeBlockContent({ content: '', annotations: [] }, { content: '', annotations: [] });
  assert.equal(emptyMerge.content, '');
});

test('editing a block updates its text and formats in place', () => {
  const block = { content: 'hello world', annotations: [ann(6, 11)] };
  ops.updateBlockContent(block, 'hello brave world');
  assert.equal(block.content, 'hello brave world');
  assert.deepEqual(block.annotations, [ann(6, 17)],
    'typing at the very start of a bold run extends it, the same as typing inside it');

  const after = { content: 'hello world', annotations: [ann(0, 5)] };
  ops.updateBlockContent(after, 'hello world again');
  assert.deepEqual(after.annotations, [ann(0, 5)], 'typing past a bold run leaves it alone');

  const cleared = { content: 'hello', annotations: [ann(0, 5)] };
  ops.updateBlockContent(cleared, '');
  assert.equal(cleared.content, '');
  assert.deepEqual(cleared.annotations, []);
  const fromNothing = { content: '', annotations: [] };
  ops.updateBlockContent(fromNothing, 'typed');
  assert.equal(fromNothing.content, 'typed');
  assert.deepEqual(ops.updateBlockContent({}, 'x').content, 'x');
});

test('a blocks change may be a list or a function of the previous list', () => {
  const previous = [{ id: 'b1' }];
  assert.equal(ops.resolveBlocksChange(previous, [{ id: 'b2' }])[0].id, 'b2');
  assert.equal(ops.resolveBlocksChange(previous, prev => [...prev, { id: 'b2' }]).length, 2);
  assert.equal(ops.resolveBlocksChange(previous, null), null);
});
