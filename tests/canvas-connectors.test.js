const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/canvas/canvasModel.js');

function card(id, x, y, w = 100, h = 60, type = 'rect') {
  return { id, type, x, y, w, h };
}

function arrow(id, x, y, x2, y2, extra = {}) {
  return { id, type: 'arrow', x, y, x2, y2, ...extra };
}

test('mnCanvasAnchorTargetAt picks the topmost anchorable element under a point', () => {
  const under = card('under', 0, 0, 200, 200);
  const over = card('over', 50, 50, 100, 100, 'sticky');
  const pen = { id: 'pen', type: 'pen', points: [{ x: 60, y: 60 }, { x: 90, y: 90 }] };
  const elements = [under, over, pen];
  assert.equal(model.mnCanvasAnchorTargetAt(elements, { x: 75, y: 75 })?.id, 'over');
  assert.equal(model.mnCanvasAnchorTargetAt(elements, { x: 10, y: 10 })?.id, 'under');
  assert.equal(model.mnCanvasAnchorTargetAt(elements, { x: 500, y: 500 }), null);
  assert.equal(model.mnCanvasAnchorTargetAt(elements, { x: 75, y: 75 }, 'over')?.id, 'under');
});

test('mnCanvasAnchorTargetAt ignores connectors and pen strokes', () => {
  const elements = [arrow('a1', 0, 0, 100, 100)];
  assert.equal(model.mnCanvasAnchorTargetAt(elements, { x: 50, y: 50 }), null);
});

test('mnCanvasAnchorPoint lands on the element border toward the target', () => {
  const el = card('c', 0, 0, 100, 100);
  const right = model.mnCanvasAnchorPoint(el, { x: 300, y: 50 });
  assert.equal(right.x, 100);
  assert.equal(right.y, 50);
  const above = model.mnCanvasAnchorPoint(el, { x: 50, y: -200 });
  assert.equal(above.x, 50);
  assert.equal(above.y, 0);
  const center = model.mnCanvasAnchorPoint(el, { x: 50, y: 50 });
  assert.deepEqual(center, { x: 50, y: 50 });
});

test('mnCanvasResolveConnector follows anchored elements and keeps free endpoints', () => {
  const a = card('a', 0, 0, 100, 100);
  const b = card('b', 300, 0, 100, 100);
  const link = arrow('l', 5, 5, 305, 5, { startAnchorId: 'a', endAnchorId: 'b' });
  const byId = new Map([[a.id, a], [b.id, b], [link.id, link]]);
  const resolved = model.mnCanvasResolveConnector(link, byId);
  assert.equal(resolved.x, 100, 'start touches the right edge of a');
  assert.equal(resolved.y, 50);
  assert.equal(resolved.x2, 300, 'end touches the left edge of b');
  assert.equal(resolved.y2, 50);

  const half = arrow('h', 5, 5, 500, 400, { startAnchorId: 'a' });
  const partial = model.mnCanvasResolveConnector(half, byId);
  assert.equal(partial.x2, 500, 'free endpoint keeps stored coordinates');
  assert.equal(partial.y2, 400);
  assert.ok(partial.x >= 0 && partial.x <= 100);

  const dangling = arrow('d', 5, 5, 40, 40, { startAnchorId: 'missing' });
  const kept = model.mnCanvasResolveConnector(dangling, byId);
  assert.deepEqual(kept, { x: 5, y: 5, x2: 40, y2: 40 });
});

test('mnCanvasSyncConnectors writes followed endpoints back after a card moves', () => {
  const a = card('a', 0, 0, 100, 100);
  const b = card('b', 300, 0, 100, 100);
  const link = arrow('l', 100, 50, 300, 50, { startAnchorId: 'a', endAnchorId: 'b' });
  const movedB = model.mnCanvasMoveElement(b, 0, 400);
  const synced = model.mnCanvasSyncConnectors([a, movedB, link]);
  const syncedLink = synced.find(el => el.id === 'l');
  assert.notEqual(syncedLink, link, 'connector was updated');
  assert.ok(syncedLink.y2 > 300, 'endpoint followed the moved card');
  assert.equal(syncedLink.startAnchorId, 'a');
});

test('mnCanvasSyncConnectors drops anchors whose target was deleted and is a no-op otherwise', () => {
  const a = card('a', 0, 0, 100, 100);
  const link = arrow('l', 100, 50, 300, 50, { startAnchorId: 'a', endAnchorId: 'gone' });
  const synced = model.mnCanvasSyncConnectors([a, link]);
  const syncedLink = synced.find(el => el.id === 'l');
  assert.equal(syncedLink.endAnchorId, null);
  assert.equal(syncedLink.x2, 300, 'dangling endpoint keeps its last position');

  const stable = model.mnCanvasSyncConnectors(synced);
  assert.equal(stable, synced, 'unchanged input returns the same array');
});

test('mnCanvasCloneElements remaps connector anchors inside the cloned set', () => {
  const a = card('a', 0, 0, 100, 100);
  const b = card('b', 300, 0, 100, 100);
  const link = arrow('l', 100, 50, 300, 50, { startAnchorId: 'a', endAnchorId: 'b' });
  const clones = model.mnCanvasCloneElements([a, b, link]);
  const [cloneA, cloneB, cloneLink] = clones;
  assert.notEqual(cloneA.id, 'a');
  assert.equal(cloneLink.startAnchorId, cloneA.id);
  assert.equal(cloneLink.endAnchorId, cloneB.id);

  const partial = model.mnCanvasCloneElements([link]);
  assert.equal(partial[0].startAnchorId, null, 'anchor outside the set is dropped');
  assert.equal(partial[0].endAnchorId, null);
});

test('mnCanvasAddNoteCard places a card near the viewport center and dedupes', () => {
  const canvas = { id: 'c1', title: 'Board', viewport: { x: 0, y: 0, scale: 1 }, elements: [] };
  const note = { id: 'n1', title: 'Idea' };
  const first = model.mnCanvasAddNoteCard(canvas, note);
  assert.equal(first.existing, false);
  assert.equal(first.element.type, 'note');
  assert.equal(first.element.noteId, 'n1');
  assert.equal(first.canvas.elements.length, 1);
  assert.equal(canvas.elements.length, 0, 'input canvas is not mutated');

  const again = model.mnCanvasAddNoteCard(first.canvas, note);
  assert.equal(again.existing, true);
  assert.equal(again.canvas.elements.length, 1);

  const second = model.mnCanvasAddNoteCard(first.canvas, { id: 'n2', title: 'Other' });
  assert.equal(second.canvas.elements.length, 2);
  const [e1, e2] = second.canvas.elements;
  assert.notEqual(`${e1.x},${e1.y}`, `${e2.x},${e2.y}`, 'cards cascade instead of stacking');
});

test('mnCanvasAddNoteCard respects a panned/zoomed viewport', () => {
  const canvas = { id: 'c1', viewport: { x: -1000, y: -500, scale: 2 }, elements: [] };
  const { element } = model.mnCanvasAddNoteCard(canvas, { id: 'n1', title: 'Idea' }, { width: 800, height: 600 });
  assert.ok(Math.abs(element.x - ((800 / 2 + 1000) / 2 - 125)) < 1);
  assert.ok(Math.abs(element.y - ((600 / 2 + 500) / 2 - 75)) < 1);
});
