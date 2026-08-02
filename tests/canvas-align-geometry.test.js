const test = require('node:test');
const assert = require('node:assert/strict');

const canvas = require('../src/canvas/canvasModel.js');

// Multi-select canvas operations: align, distribute, move and duplicate. The
// user expectations are spatial -- edges line up, gaps even out, arrows and
// pen strokes move as one shape -- and none of the operations may touch an
// element that was not selected.

const rect = (id, x, y, w = 40, h = 20) => ({ id, type: 'rect', x, y, w, h });
const bounds = canvas.mnCanvasBounds;

test('align left lines up left edges without vertical drift', () => {
  const elements = [rect('a', 10, 0), rect('b', 50, 100), rect('c', 90, 200)];
  const aligned = canvas.mnCanvasAlign(elements, ['a', 'b', 'c'], 'left');
  for (const el of aligned) {
    assert.equal(bounds(el).x, 10, `${el.id} did not move to the leftmost edge`);
  }
  assert.deepEqual(aligned.map(el => el.y), [0, 100, 200], 'a horizontal align changed vertical positions');
});

test('align right and bottom use far edges, not origins', () => {
  const elements = [rect('a', 0, 0, 100, 50), rect('b', 200, 200, 20, 10)];
  const right = canvas.mnCanvasAlign(elements, ['a', 'b'], 'right');
  assert.equal(bounds(right[0]).x + 100, bounds(right[1]).x + 20, 'right edges do not line up');
  const bottom = canvas.mnCanvasAlign(elements, ['a', 'b'], 'bottom');
  assert.equal(bounds(bottom[0]).y + 50, bounds(bottom[1]).y + 10, 'bottom edges do not line up');
});

test('align centers stack midpoints', () => {
  const elements = [rect('a', 0, 0, 100, 100), rect('b', 300, 300, 20, 20)];
  const centered = canvas.mnCanvasAlign(elements, ['a', 'b'], 'center-x');
  const mid = el => bounds(el).x + bounds(el).w / 2;
  assert.equal(mid(centered[0]), mid(centered[1]), 'horizontal centers differ after center-x align');
});

test('align never touches unselected elements and needs at least two', () => {
  const bystander = rect('bystander', 500, 500);
  const elements = [rect('a', 10, 0), rect('b', 50, 100), bystander];
  const aligned = canvas.mnCanvasAlign(elements, ['a', 'b'], 'left');
  assert.equal(aligned[2], bystander, 'an unselected element was replaced or moved');
  assert.equal(canvas.mnCanvasAlign(elements, ['a'], 'left'), elements, 'a single selection has nothing to align to');
});

test('distribute evens the gaps and keeps the outermost elements fixed', () => {
  const elements = [rect('a', 0, 0), rect('b', 30, 0), rect('c', 200, 0)];
  const spread = canvas.mnCanvasDistribute(elements, ['a', 'b', 'c'], 'x');
  const center = el => bounds(el).x + bounds(el).w / 2;
  assert.equal(center(spread[0]), center(elements[0]), 'the leftmost element moved');
  assert.equal(center(spread[2]), center(elements[2]), 'the rightmost element moved');
  const gap1 = center(spread[1]) - center(spread[0]);
  const gap2 = center(spread[2]) - center(spread[1]);
  assert.equal(gap1, gap2, `gaps are uneven after distribute: ${gap1} vs ${gap2}`);
});

test('distribute needs at least three elements and respects the axis', () => {
  const elements = [rect('a', 0, 0), rect('b', 100, 50)];
  assert.equal(canvas.mnCanvasDistribute(elements, ['a', 'b'], 'x'), elements);
  const tall = [rect('a', 0, 0), rect('b', 0, 20), rect('c', 0, 300)];
  const spread = canvas.mnCanvasDistribute(tall, ['a', 'b', 'c'], 'y');
  assert.deepEqual(spread.map(el => el.x), [0, 0, 0], 'a vertical distribute changed horizontal positions');
});

test('moving a shape moves every part of its geometry', () => {
  const arrow = { id: 'ar', type: 'arrow', x: 0, y: 0, x2: 100, y2: 50 };
  const movedArrow = canvas.mnCanvasMoveElement(arrow, 10, 20);
  assert.deepEqual([movedArrow.x, movedArrow.y, movedArrow.x2, movedArrow.y2], [10, 20, 110, 70],
    'an arrow left one endpoint behind');
  const pen = { id: 'p', type: 'pen', x: 0, y: 0, points: [{ x: 1, y: 1 }, { x: 5, y: 9 }] };
  const movedPen = canvas.mnCanvasMoveElement(pen, 3, 4);
  assert.deepEqual(movedPen.points, [{ x: 4, y: 5 }, { x: 8, y: 13 }], 'a pen stroke tore away from its points');
});

test('bounds are direction-independent for lines and derived from points for pen', () => {
  // A line drawn right-to-left must not report negative width.
  const backwards = { id: 'l', type: 'line', x: 100, y: 80, x2: 20, y2: 10 };
  assert.deepEqual(bounds(backwards), { x: 20, y: 10, w: 80, h: 70 });
  const pen = { id: 'p', type: 'pen', x: 0, y: 0, points: [{ x: 5, y: 40 }, { x: 25, y: 10 }] };
  assert.deepEqual(bounds(pen), { x: 5, y: 10, w: 20, h: 30 });
  const emptyPen = { id: 'p2', type: 'pen', x: 7, y: 8, points: [] };
  assert.deepEqual(bounds(emptyPen), { x: 7, y: 8, w: 0, h: 0 }, 'an empty pen stroke should sit at its origin');
});

test('selection bounds wrap every selected shape', () => {
  const box = canvas.mnCanvasSelectionBounds([
    rect('a', 0, 0, 10, 10),
    { id: 'l', type: 'line', x: 50, y: 5, x2: 90, y2: 45 },
  ]);
  assert.deepEqual(box, { x: 0, y: 0, w: 90, h: 45 });
  assert.equal(canvas.mnCanvasSelectionBounds([]), null, 'an empty selection has no bounds');
});

test('duplicating offsets the copy so it does not hide under the original', () => {
  const original = rect('a', 100, 100);
  const copy = canvas.mnCanvasCloneElement(original);
  assert.notEqual(copy.id, original.id, 'the copy shares the original id');
  assert.equal(copy.x, 124);
  assert.equal(copy.y, 124);
  const arrowCopy = canvas.mnCanvasCloneElement({ id: 'ar', type: 'arrow', x: 0, y: 0, x2: 10, y2: 10 });
  assert.deepEqual([arrowCopy.x2, arrowCopy.y2], [34, 34], 'the far endpoint was not offset with the copy');
});
