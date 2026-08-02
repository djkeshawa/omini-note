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
  const applied = mnGraphApplyPins(rebuilt, pinned);
  assert.deepEqual(
    { x: applied[0].x, y: applied[0].y, hx: applied[0].hx, vx: applied[0].vx },
    { x: 240, y: 160, hx: 240, vx: 0 }
  );
  assert.deepEqual(applied[1], rebuilt[1], 'an unpinned node is left to the layout');

  // The position is restored exactly. There are no walls to clamp against
  // any more, and quietly moving a pin to fit a smaller pane would be the app
  // overruling a placement made on purpose; Fit recovers anything out of view.
  const far = mnGraphApplyPins(rebuilt, mnGraphPin({}, 'a', 5000, 5000));
  assert.deepEqual({ x: far[0].x, y: far[0].y }, { x: 5000, y: 5000 });

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

test('the layout has no walls: a stray node is drawn back, not snapped back', () => {
  const { mnGraphTick } = loadRendererModule('src/panels/graphForces.js');
  const opts = { center: 0.005, repulsion: 34, linkDistance: 118 };
  // Well outside the pane. Nodes used to be clamped to the viewport, so a
  // graph denser than its pane piled along four invisible edges and the
  // arrangement you saw was the box rather than the links.
  const start = { id: 'a', x: 1400, y: 900, vx: 0, vy: 0, r: 8, hx: null, hy: null };
  const oneTick = mnGraphTick([start], { edges: [], W: 900, H: 600, ticks: 1, opts }).nodes[0];
  assert.ok(oneTick.x > 900, 'one tick does not teleport it inside the pane');
  assert.ok(oneTick.x < 1400 && oneTick.y < 900, 'the centre pull moves it homeward');

  // Given time, the same force brings it home — containment is something the
  // graph can argue with rather than a barrier it cannot cross.
  let out = [start];
  for (let i = 0; i < 400; i += 1) out = mnGraphTick(out, { edges: [], W: 900, H: 600, ticks: 1, opts }).nodes;
  assert.ok(Math.abs(out[0].x - 450) < 200 && Math.abs(out[0].y - 300) < 200,
    'it settles near the middle rather than against an edge');

  // A held node is still exempt: it belongs to the pointer, not the layout.
  const held = [{ ...start, hx: 1400, hy: 900 }];
  const heldTick = mnGraphTick(held, { edges: [], W: 900, H: 600, ticks: 1, opts }).nodes[0];
  assert.deepEqual({ x: heldTick.x, y: heldTick.y }, { x: 1400, y: 900 });
});

test('fit frames every node in the pane, whatever the layout did', () => {
  const { mnGraphFitView, mnGraphPoint, MN_GRAPH_ZOOM, MN_GRAPH_VIEW } = view();
  // A graph that spread well past the pane — which it now can, there being no
  // walls — has to be recoverable in one gesture.
  const nodes = [
    { id: 'a', x: -600, y: -400, r: 10 },
    { id: 'b', x: 1800, y: 1500, r: 10 },
    { id: 'c', x: 400, y: 300, r: 10 },
  ];
  const fitted = mnGraphFitView(nodes, 900, 600, 40);
  // Every node, counting its radius, lands inside the pane.
  for (const node of nodes) {
    const k = fitted.k;
    const sx = node.x * k + fitted.tx;
    const sy = node.y * k + fitted.ty;
    assert.ok(sx - node.r * k >= -0.001 && sx + node.r * k <= 900.001, `${node.id} fits horizontally`);
    assert.ok(sy - node.r * k >= -0.001 && sy + node.r * k <= 600.001, `${node.id} fits vertically`);
  }
  // The graph's midpoint lands on the pane's midpoint.
  const middle = mnGraphPoint(fitted, 450, 300);
  assert.ok(Math.abs(middle.x - 600) < 1 && Math.abs(middle.y - 550) < 1);
  assert.ok(fitted.k >= MN_GRAPH_ZOOM.min && fitted.k <= MN_GRAPH_ZOOM.max);

  // Degenerate inputs answer with the default rather than an infinity.
  assert.deepEqual(mnGraphFitView([], 900, 600), MN_GRAPH_VIEW);
  assert.deepEqual(mnGraphFitView(null, 900, 600), MN_GRAPH_VIEW);
  const single = mnGraphFitView([{ id: 'a', x: 120, y: 90, r: 8 }], 900, 600);
  assert.equal(single.k, 1, 'one node has no span worth zooming into');
  assert.ok(Math.abs(120 * single.k + single.tx - 450) < 0.001, 'and it is centred');
  const noRadius = mnGraphFitView([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 100 }], 900, 600);
  assert.ok(Number.isFinite(noRadius.k) && Number.isFinite(noRadius.tx));
});

test('a blow-up cannot travel through the layout and blank the graph', () => {
  const { mnGraphTick, MN_GRAPH_ROAM } = loadRendererModule('src/panels/graphForces.js');
  const opts = { center: 0.005, repulsion: 34, linkDistance: 118 };
  // Two nodes on the exact same point make the repulsion term enormous. With
  // no bound at all they can reach infinity, and one non-finite position
  // spreads through the repulsion pass until every coordinate is NaN and the
  // graph draws nothing at all.
  let stacked = [
    { id: 'a', x: 400, y: 300, vx: 0, vy: 0, r: 8, hx: null, hy: null },
    { id: 'b', x: 400, y: 300, vx: 0, vy: 0, r: 8, hx: null, hy: null },
  ];
  for (let i = 0; i < 200; i += 1) stacked = mnGraphTick(stacked, { edges: [], W: 900, H: 600, ticks: i, opts }).nodes;
  for (const node of stacked) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), 'every coordinate stays a number');
    assert.ok(Math.abs(node.x) <= 900 * (1 + MN_GRAPH_ROAM) + 1, 'and stays within the roaming backstop');
  }

  // A position that is already broken — a bad date used to produce one — is
  // returned to the middle rather than poisoning its neighbours.
  const poisoned = [
    { id: 'a', x: Number.NaN, y: 10, vx: 0, vy: 0, r: 8, hx: null, hy: null },
    { id: 'b', x: 500, y: 300, vx: 0, vy: 0, r: 8, hx: null, hy: null },
  ];
  const healed = mnGraphTick(poisoned, { edges: [], W: 900, H: 600, ticks: 1, opts }).nodes;
  assert.deepEqual({ x: healed[0].x, y: healed[0].y }, { x: 450, y: 300 });
  assert.ok(Number.isFinite(healed[1].x) && Number.isFinite(healed[1].y));

  // The backstop is far enough out that it never shapes an ordinary layout:
  // a node released just outside the pane is moved by the centre pull, not
  // snapped by the bound.
  const outside = [{ id: 'a', x: 1000, y: 700, vx: 0, vy: 0, r: 8, hx: null, hy: null }];
  const stepped = mnGraphTick(outside, { edges: [], W: 900, H: 600, ticks: 1, opts }).nodes[0];
  assert.ok(stepped.x > 900 && stepped.x < 1000, 'still outside the pane, just nudged homeward');
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

test('the canvas ref callback is stable, so the panel cannot loop itself to death', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/panels/useGraphGestures.js'), 'utf8');
  // React re-runs a ref callback — null, then the element — whenever the
  // callback's identity changes, and an inline arrow changes every render.
  // With a setState inside, each render queued two more writes and another
  // render, until React gave up and the error boundary replaced the graph
  // with "This view ran into a problem". Caught in the Electron regression as
  // a drag against a panel that had vanished.
  assert.match(source, /const attachSvg = useCallbackG\(/);
  assert.match(source, /\}, \[\]\);/, 'and with no dependencies, so it is created once');
  // Re-attaching the same element must not count as a change either.
  assert.match(source, /setSvgEl\(current => \(current === el \? current : el\)\)/);
});

test('the graph canvas gestures have regression coverage that drives them', () => {
  const harness = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');
  assert.match(harness, /dragging a graph node carries it/);
  assert.match(harness, /the wheel zooms the graph canvas/);
  assert.match(harness, /dragging the canvas pans the graph/);
  assert.match(harness, /clicking a graph node still opens the inspector/);
  assert.match(harness, /a dropped graph node stays where it was put/);
  assert.match(harness, /fit brings every graph node inside the pane/);
});
