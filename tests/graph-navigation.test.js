const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const view = () => loadRendererModule('src/panels/graphView.js');

test('zooming about a point keeps that point under the pointer', () => {
  const { mnGraphZoomAt, mnGraphPoint, MN_GRAPH_VIEW } = view();
  // The graph coordinate under the cursor before the wheel turn must still be
  // under it afterwards — that is the whole difference between zooming and
  // rescaling, and it is what makes the wheel feel aimed.
  const before = mnGraphPoint(MN_GRAPH_VIEW, 300, 200);
  const zoomed = mnGraphZoomAt(MN_GRAPH_VIEW, 1.8, 300, 200);
  const after = mnGraphPoint(zoomed, 300, 200);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
  assert.ok(zoomed.k > MN_GRAPH_VIEW.k, 'a positive factor zooms in');

  // Still exact from an already panned and zoomed canvas.
  const start = { tx: -140, ty: 62, k: 2.3 };
  const anchored = mnGraphZoomAt(start, 0.55, 88, 410);
  const held = mnGraphPoint(anchored, 88, 410);
  const original = mnGraphPoint(start, 88, 410);
  assert.ok(Math.abs(held.x - original.x) < 1e-9 && Math.abs(held.y - original.y) < 1e-9);
});

test('the scale stays inside its bounds however far the wheel is turned', () => {
  const { mnGraphZoomAt, mnGraphZoomFactor, MN_GRAPH_ZOOM, MN_GRAPH_VIEW } = view();
  let out = MN_GRAPH_VIEW;
  for (let i = 0; i < 200; i += 1) out = mnGraphZoomAt(out, 0.8, 400, 300);
  assert.equal(out.k, MN_GRAPH_ZOOM.min, 'zooming out cannot shrink the graph into nothing');
  let far = MN_GRAPH_VIEW;
  for (let i = 0; i < 200; i += 1) far = mnGraphZoomAt(far, 1.25, 400, 300);
  assert.equal(far.k, MN_GRAPH_ZOOM.max);

  // Even clamped, the anchor still holds — the placement is solved for the
  // scale that was actually applied, not the one that was asked for.
  const { mnGraphPoint } = view();
  const atLimit = { tx: 10, ty: 10, k: MN_GRAPH_ZOOM.max };
  const clamped = mnGraphZoomAt(atLimit, 4, 250, 150);
  assert.deepEqual(mnGraphPoint(clamped, 250, 150), mnGraphPoint(atLimit, 250, 150));

  // A wheel turn away from the user zooms in, toward the user zooms out.
  assert.ok(mnGraphZoomFactor(-120) > 1);
  assert.ok(mnGraphZoomFactor(120) < 1);
  assert.equal(mnGraphZoomFactor(0), 1);
});

test('panning offsets the canvas without touching the scale', () => {
  const { mnGraphPanBy, mnGraphPoint } = view();
  const panned = mnGraphPanBy({ tx: 12, ty: -4, k: 1.5 }, 30, 45);
  assert.deepEqual(panned, { tx: 42, ty: 41, k: 1.5 });
  // Panning by a delta moves the graph point under a fixed screen position by
  // that delta in graph units, which is what makes a pan track the pointer.
  const before = mnGraphPoint({ tx: 0, ty: 0, k: 2 }, 100, 100);
  const after = mnGraphPoint(mnGraphPanBy({ tx: 0, ty: 0, k: 2 }, 20, 0), 100, 100);
  assert.equal(before.x - after.x, 10);
});

test('holding a node moves that node alone and releasing hands it back', () => {
  const { mnGraphHoldNode, mnGraphReleaseNode } = view();
  const nodes = [
    { id: 'a', x: 10, y: 10, vx: 5, vy: -5, hx: null, hy: null },
    { id: 'b', x: 50, y: 50, vx: 1, vy: 1, hx: null, hy: null },
  ];
  const held = mnGraphHoldNode(nodes, 'a', 120, 80);
  assert.deepEqual(
    { x: held[0].x, y: held[0].y, hx: held[0].hx, hy: held[0].hy, vx: held[0].vx, vy: held[0].vy },
    { x: 120, y: 80, hx: 120, hy: 80, vx: 0, vy: 0 },
    'the held node is placed where the grip says with its momentum cleared'
  );
  assert.deepEqual(held[1], nodes[1], 'every other node is untouched');
  assert.notEqual(held, nodes, 'the list is replaced rather than mutated, so React sees the change');

  const released = mnGraphReleaseNode(held, 'a');
  assert.equal(released[0].hx, null);
  assert.equal(released[0].hy, null);
  assert.deepEqual(
    { x: released[0].x, y: released[0].y }, { x: 120, y: 80 },
    'releasing forgets the grip but keeps the position, so the layout reclaims it from there'
  );

  // An id that is not on screen changes nothing rather than throwing.
  assert.equal(mnGraphHoldNode(nodes, 'missing', 1, 1).length, 2);
  assert.equal(mnGraphHoldNode(null, 'a', 1, 1), null);
});

test('a node stays where it was dropped, and pins survive a rebuilt node list', () => {
  const { mnGraphPin, mnGraphUnpin, mnGraphApplyPins, mnGraphIsPinned } = view();
  const pinned = mnGraphPin({}, 'a', 240, 160);
  assert.deepEqual(pinned, { a: { x: 240, y: 160 } });
  assert.equal(mnGraphIsPinned(pinned, 'a'), true);
  assert.equal(mnGraphIsPinned(pinned, 'b'), false);

  // The node list is rebuilt whenever a note changes or the pane resizes, so
  // an arrangement that only lived on the nodes would not survive an autosave.
  const rebuilt = [
    { id: 'a', x: 999, y: 999, vx: 4, vy: 4, r: 8, hx: null, hy: null },
    { id: 'b', x: 100, y: 100, vx: 1, vy: 1, r: 8, hx: null, hy: null },
  ];
  const applied = mnGraphApplyPins(rebuilt, pinned, 900, 600);
  assert.deepEqual(
    { x: applied[0].x, y: applied[0].y, hx: applied[0].hx, vx: applied[0].vx },
    { x: 240, y: 160, hx: 240, vx: 0 }
  );
  assert.deepEqual(applied[1], rebuilt[1], 'an unpinned node is left to the layout');

  // A pin made before the pane shrank must not strand the node off screen,
  // where it could be neither seen nor released.
  const tight = mnGraphApplyPins(rebuilt, mnGraphPin({}, 'a', 5000, 5000), 400, 300);
  assert.ok(tight[0].x <= 400 && tight[0].y <= 300);

  assert.deepEqual(mnGraphUnpin(pinned, 'a'), {});
  assert.deepEqual(mnGraphUnpin(pinned, 'missing'), pinned, 'unpinning what is not pinned changes nothing');
  assert.deepEqual(mnGraphPin({}, 'a', Number.NaN, 10), {}, 'a position that is not a number pins nothing');
});

test('a press that never moved is a click, not a zero-length drag', () => {
  const { mnGraphPassedSlop, MN_GRAPH_DRAG_SLOP } = view();
  assert.equal(mnGraphPassedSlop(0, 0), false, 'an exact press opens the inspector');
  assert.equal(mnGraphPassedSlop(MN_GRAPH_DRAG_SLOP, MN_GRAPH_DRAG_SLOP), false,
    'hand tremor inside the slop is still a click');
  assert.equal(mnGraphPassedSlop(MN_GRAPH_DRAG_SLOP + 1, 0), true);
  assert.equal(mnGraphPassedSlop(0, -(MN_GRAPH_DRAG_SLOP + 1)), true, 'slop is measured either way along both axes');
});

test('a held node stays exactly where the grip put it while the layout ticks', () => {
  const { mnGraphTick } = loadRendererModule('src/panels/graphForces.js');
  const nodes = [
    { id: 'a', x: 400, y: 300, vx: 0, vy: 0, r: 8, hx: 400, hy: 300 },
    { id: 'b', x: 430, y: 300, vx: 0, vy: 0, r: 8, hx: null, hy: null },
  ];
  let out = nodes;
  for (let i = 0; i < 12; i += 1) out = mnGraphTick(out, { edges: [], W: 900, H: 600, ticks: i }).nodes;
  const held = out.find(n => n.id === 'a');
  assert.deepEqual({ x: held.x, y: held.y }, { x: 400, y: 300 }, 'the held node does not drift');
  assert.equal(held.vx, 0);
  // Its neighbour was pushed away, which is the held node still exerting its
  // forces — that is what makes a drag carry the graph around with it.
  const free = out.find(n => n.id === 'b');
  assert.ok(free.x > 430, 'the neighbour is pushed by the node being held');
});

test('a held node is not clamped back inside the viewport, but a free one is', () => {
  const { mnGraphTick } = loadRendererModule('src/panels/graphForces.js');
  // Dragged well past the right edge. The clamp exists to stop the layout
  // throwing nodes off screen; applied to a held node it fights the pointer.
  const outside = [{ id: 'a', x: 1400, y: 900, vx: 0, vy: 0, r: 8, hx: 1400, hy: 900 }];
  const heldTick = mnGraphTick(outside, { edges: [], W: 900, H: 600, ticks: 1 }).nodes[0];
  assert.deepEqual({ x: heldTick.x, y: heldTick.y }, { x: 1400, y: 900 });

  const released = [{ id: 'a', x: 1400, y: 900, vx: 0, vy: 0, r: 8, hx: null, hy: null }];
  const freeTick = mnGraphTick(released, { edges: [], W: 900, H: 600, ticks: 1 }).nodes[0];
  assert.ok(freeTick.x <= 900 - 8 - 18 && freeTick.y <= 600 - 8 - 22,
    'once released the layout pulls it back inside the pane');
});

test('the layout still reports when it has come to rest', () => {
  const { mnGraphTick } = loadRendererModule('src/panels/graphForces.js');
  const still = [{ id: 'a', x: 450, y: 300, vx: 0, vy: 0, r: 8, hx: null, hy: null }];
  // One node sitting on the centre has nothing pulling it, so the loop should
  // be allowed to stop rather than burn its whole tick budget.
  assert.equal(mnGraphTick(still, { edges: [], W: 900, H: 600, ticks: 1 }).settled, true);
  const scattered = [
    { id: 'a', x: 100, y: 100, vx: 0, vy: 0, r: 8, hx: null, hy: null },
    { id: 'b', x: 108, y: 104, vx: 0, vy: 0, r: 8, hx: null, hy: null },
  ];
  assert.equal(mnGraphTick(scattered, { edges: [], W: 900, H: 600, ticks: 1 }).settled, false);
});

test('the graph canvas gestures have regression coverage that drives them', () => {
  const harness = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');
  assert.match(harness, /dragging a graph node carries it/);
  assert.match(harness, /the wheel zooms the graph canvas/);
  assert.match(harness, /dragging the canvas pans the graph/);
  assert.match(harness, /clicking a graph node still opens the inspector/);
  assert.match(harness, /a dropped graph node stays where it was put/);
});
