// The arithmetic behind moving the graph around.
//
// Three gestures — drag a node, pan the canvas, zoom the wheel — and the parts
// of them that are easy to get subtly wrong live here rather than inside the
// panel, so they can be tested without a browser. The panel keeps the pointer
// plumbing; this file keeps the maths.
//
// The canvas transform is `{ tx, ty, k }`, read as "translate then scale". A
// node's own coordinates never change when you pan or zoom: the same numbers
// are simply drawn somewhere else. That separation is what lets the exported
// SVG stay a picture of the graph rather than of the current viewport.

// Far enough out to take in a large vault, far enough in to read one cluster.
const MN_GRAPH_ZOOM = { min: 0.25, max: 4 };
const MN_GRAPH_VIEW = { tx: 0, ty: 0, k: 1 };

// How much of a wheel turn is a doubling. Exponential rather than linear, so
// zooming feels the same wherever you already are.
const MN_GRAPH_ZOOM_STEP = 0.0016;

// A press that never travels this far is a click, not a drag. Without it, the
// hand tremor in a normal click registers as a one-pixel drag and the node
// inspector stops opening.
const MN_GRAPH_DRAG_SLOP = 3;

function mnGraphClampScale(k) {
  if (!Number.isFinite(k)) return MN_GRAPH_VIEW.k;
  return Math.min(MN_GRAPH_ZOOM.max, Math.max(MN_GRAPH_ZOOM.min, k));
}

// Screen-space point (already mapped into the SVG's own coordinates) back to
// the graph coordinates the nodes are stored in.
function mnGraphPoint(view = MN_GRAPH_VIEW, localX = 0, localY = 0) {
  const k = mnGraphClampScale(view?.k ?? 1);
  return { x: (localX - (view?.tx || 0)) / k, y: (localY - (view?.ty || 0)) / k };
}

function mnGraphPanBy(view = MN_GRAPH_VIEW, dx = 0, dy = 0) {
  return { tx: (view?.tx || 0) + dx, ty: (view?.ty || 0) + dy, k: mnGraphClampScale(view?.k ?? 1) };
}

// Zoom about a point: whatever sits under the pointer must still sit under it
// afterwards, which is the whole difference between zooming and rescaling.
// Solve the placement for the new scale rather than nudging the translation,
// so the anchor holds exactly even when the scale clamps mid-gesture.
function mnGraphZoomAt(view = MN_GRAPH_VIEW, factor = 1, localX = 0, localY = 0) {
  const current = mnGraphClampScale(view?.k ?? 1);
  const next = mnGraphClampScale(current * (Number.isFinite(factor) && factor > 0 ? factor : 1));
  const anchor = mnGraphPoint(view, localX, localY);
  return { tx: localX - anchor.x * next, ty: localY - anchor.y * next, k: next };
}

function mnGraphZoomFactor(deltaY = 0) {
  return Math.exp(-(Number.isFinite(deltaY) ? deltaY : 0) * MN_GRAPH_ZOOM_STEP);
}

function mnGraphPassedSlop(dx = 0, dy = 0) {
  return Math.abs(dx) > MN_GRAPH_DRAG_SLOP || Math.abs(dy) > MN_GRAPH_DRAG_SLOP;
}

// A held node is an input to the simulation rather than an exception to it: it
// is placed where the grip says and its velocity is cleared, but it stays in
// the node list pushing its neighbours, which is what makes them follow.
function mnGraphHoldNode(nodes, id, x, y) {
  if (!Array.isArray(nodes) || !id) return nodes;
  return nodes.map(node => (node.id === id
    ? { ...node, x, y, hx: x, hy: y, vx: 0, vy: 0 }
    : node));
}

// Releasing forgets the grip so the layout reclaims the node from wherever it
// was let go. This is what a node does when it is unpinned, not what happens
// at the end of a drag — see mnGraphPin.
function mnGraphReleaseNode(nodes, id) {
  if (!Array.isArray(nodes) || !id) return nodes;
  return nodes.map(node => (node.id === id
    ? { ...node, hx: null, hy: null, vx: 0, vy: 0 }
    : node));
}

// Where you put a node is where it stays.
//
// The layout's own arrangement is a guess about what belongs together; moving
// a node by hand is a statement about it, and a statement that dissolves the
// moment you let go is not worth making. So a dropped node keeps its position
// and goes on pushing its neighbours from there, and the pins outlive the node
// list — which is rebuilt whenever a note changes or the pane resizes.
function mnGraphPin(pins, id, x, y) {
  if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return pins || {};
  return { ...(pins || {}), [id]: { x, y } };
}

function mnGraphUnpin(pins, id) {
  if (!pins || !id || !(id in pins)) return pins || {};
  const next = { ...pins };
  delete next[id];
  return next;
}

// Applied to a freshly built node list. The position is restored exactly:
// with the walls gone there is nothing to clamp against, and a pin quietly
// moved to fit a smaller pane would be the app overruling a placement you
// made on purpose. Anything left out of view is one Fit away.
function mnGraphApplyPins(nodes, pins) {
  if (!Array.isArray(nodes) || !pins) return nodes;
  if (!Object.keys(pins).length) return nodes;
  return nodes.map(node => {
    const pin = pins[node.id];
    if (!pin) return node;
    return { ...node, x: pin.x, y: pin.y, hx: pin.x, hy: pin.y, vx: 0, vy: 0 };
  });
}

function mnGraphIsPinned(pins, id) {
  return Boolean(pins && id && pins[id]);
}

// Frame the whole graph in the pane.
//
// Removing the walls means a node can settle anywhere, so there has to be one
// gesture that says "show me everything" — otherwise a graph that spread past
// the edges would look like a graph that had lost half its notes. Each node's
// radius is counted so the outermost circles land inside the padding rather
// than half over the edge.
function mnGraphFitView(nodes, W = 900, H = 600, padding = 46) {
  const points = (nodes || []).filter(node => Number.isFinite(node?.x) && Number.isFinite(node?.y));
  if (!points.length) return MN_GRAPH_VIEW;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const node of points) {
    const r = Number.isFinite(node.r) ? node.r : 0;
    if (node.x - r < minX) minX = node.x - r;
    if (node.x + r > maxX) maxX = node.x + r;
    if (node.y - r < minY) minY = node.y - r;
    if (node.y + r > maxY) maxY = node.y + r;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const room = (size, span) => Math.max(1, size - padding * 2) / span;
  // One scale for both axes, or the graph would be stretched rather than
  // framed. A single node has no span worth zooming into, so it sits at 1.
  const k = mnGraphClampScale(points.length === 1 ? 1 : Math.min(room(W, spanX), room(H, spanY)));
  return { tx: W / 2 - ((minX + maxX) / 2) * k, ty: H / 2 - ((minY + maxY) / 2) * k, k };
}

export {
  mnGraphPoint, mnGraphPanBy, mnGraphZoomAt, mnGraphZoomFactor, mnGraphClampScale,
  mnGraphPassedSlop, mnGraphHoldNode, mnGraphReleaseNode,
  mnGraphPin, mnGraphUnpin, mnGraphApplyPins, mnGraphIsPinned, mnGraphFitView,
  MN_GRAPH_ZOOM, MN_GRAPH_VIEW, MN_GRAPH_DRAG_SLOP,
};
