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

// Releasing only forgets the grip. The node keeps the position it was left at
// and the layout reclaims it from there — which is why a released node settles
// back rather than staying pinned.
function mnGraphReleaseNode(nodes, id) {
  if (!Array.isArray(nodes) || !id) return nodes;
  return nodes.map(node => (node.id === id
    ? { ...node, hx: null, hy: null, vx: 0, vy: 0 }
    : node));
}

export {
  mnGraphPoint, mnGraphPanBy, mnGraphZoomAt, mnGraphZoomFactor, mnGraphClampScale,
  mnGraphPassedSlop, mnGraphHoldNode, mnGraphReleaseNode,
  MN_GRAPH_ZOOM, MN_GRAPH_VIEW, MN_GRAPH_DRAG_SLOP,
};
