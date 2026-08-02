// The pointer plumbing behind the graph's three gestures.
//
// Drag a node, drag the canvas to pan, turn the wheel to zoom. The arithmetic
// lives in graphView.js; this is the part that has to talk to the browser —
// mapping client coordinates through the SVG's own matrix, capturing the
// pointer so a release outside the pane still ends the gesture, and telling a
// drag apart from a click afterwards.
//
// `warmLayout` comes from the panel because the simulation loop is the panel's
// to own: a drag has to wake a layout that has already settled, or grabbing a
// node would move it while nothing else responded.

import {
  mnGraphPoint, mnGraphPanBy, mnGraphZoomAt, mnGraphZoomFactor,
  mnGraphPassedSlop, mnGraphHoldNode,
} from './graphView.js';

const { useCallback: useCallbackG, useEffect: useEffectG, useRef: useRefG, useState: useStateG } = React;

// Client coordinates into the SVG's own. This has to ask the browser rather
// than do arithmetic: the canvas is drawn with a non-uniform
// preserveAspectRatio, so the two axes do not share a scale factor.
function mnGraphLocalPoint(svg, event) {
  const ctm = svg?.getScreenCTM?.();
  if (!ctm) return null;
  const point = typeof DOMPoint === 'function'
    ? new DOMPoint(event.clientX, event.clientY)
    : Object.assign(svg.createSVGPoint(), { x: event.clientX, y: event.clientY });
  const mapped = point.matrixTransform(ctm.inverse());
  return { x: mapped.x, y: mapped.y };
}

// Capturing keeps a gesture alive when the pointer leaves the pane, but it is
// an optimisation, not the mechanism: a pointer id with nothing active behind
// it — a synthetic event, or one already released — makes the call throw, and
// an exception here would take the whole drag down with it.
function mnGraphCapture(el, pointerId) {
  if (!el || pointerId == null) return;
  try { el.setPointerCapture?.(pointerId); } catch { /* nothing to capture */ }
}

function mnGraphReleaseCapture(el, pointerId) {
  if (!el || pointerId == null) return;
  try {
    if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
  } catch { /* already gone */ }
}

function useGraphGestures({ view, setView, setNodes, warmLayout, onPin }) {
  // A callback ref as well as state: the SVG only exists once there is
  // something to draw, and the wheel listener must attach the moment it
  // appears rather than on every simulation frame.
  const [svgEl, setSvgEl] = useStateG(null);
  const svgRef = useRefG(null);
  const gestureRef = useRefG(null);
  const suppressClickRef = useRefG(false);

  // Stable, and deliberately so. React calls a ref callback with null and then
  // with the element again whenever the callback's identity changes — and an
  // inline arrow changes on every render. Each render therefore queued two
  // more state writes, which queued another render: the graph would climb its
  // own update depth until React gave up and the error boundary replaced the
  // whole panel with "This view ran into a problem". The identity check is the
  // second belt: re-attaching the same element must not be a state change.
  const attachSvg = useCallbackG((el) => {
    svgRef.current = el;
    setSvgEl(current => (current === el ? current : el));
  }, []);
  const localPoint = (event) => mnGraphLocalPoint(svgRef.current, event);
  const graphPoint = (event) => {
    const local = localPoint(event);
    return local ? mnGraphPoint(view, local.x, local.y) : null;
  };

  const startNodeDrag = (event, node) => {
    if (event.button != null && event.button !== 0) return;
    const at = graphPoint(event);
    if (!at) return;
    // The press stops here rather than reaching the canvas, or grabbing a node
    // would pan the whole graph underneath it at the same time.
    event.stopPropagation();
    gestureRef.current = {
      mode: 'node',
      id: node.id,
      // Carry the node by the point it was grabbed at, not by its centre, so
      // it does not jump under the cursor the moment it is picked up.
      dx: node.x - at.x,
      dy: node.y - at.y,
      startX: event.clientX,
      startY: event.clientY,
      startGraphX: node.x,
      startGraphY: node.y,
      lastGraphX: node.x,
      lastGraphY: node.y,
      moved: false,
    };
    setNodes(prev => mnGraphHoldNode(prev, node.id, node.x, node.y));
    warmLayout?.();
    mnGraphCapture(svgRef.current, event.pointerId);
  };

  const startPan = (event) => {
    if (event.button != null && event.button !== 0) return;
    const local = localPoint(event);
    if (!local) return;
    gestureRef.current = {
      mode: 'pan',
      lastX: local.x,
      lastY: local.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    mnGraphCapture(svgRef.current, event.pointerId);
  };

  const moveGesture = (event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (!gesture.moved && mnGraphPassedSlop(event.clientX - gesture.startX, event.clientY - gesture.startY)) {
      gesture.moved = true;
    }
    if (gesture.mode === 'pan') {
      const local = localPoint(event);
      if (!local) return;
      // The delta is worked out here and handed over as two numbers. Reading
      // `gesture.lastX` inside the updater instead looked equivalent and was
      // not: React runs an updater when it renders, by which point the lines
      // below have already moved `lastX` to this event's position, so the
      // subtraction came out zero and the canvas never panned at all.
      const dx = local.x - gesture.lastX;
      const dy = local.y - gesture.lastY;
      gesture.lastX = local.x;
      gesture.lastY = local.y;
      setView(current => mnGraphPanBy(current, dx, dy));
      return;
    }
    const at = graphPoint(event);
    if (!at) return;
    // Same rule for the node being carried: pass the position, do not let the
    // updater read a field that later events are still writing to.
    const nextX = at.x + gesture.dx;
    const nextY = at.y + gesture.dy;
    gesture.lastGraphX = nextX;
    gesture.lastGraphY = nextY;
    setNodes(prev => mnGraphHoldNode(prev, gesture.id, nextX, nextY));
    // Warm on every move rather than holding the loop open for the length of
    // the gesture. The layout then stays lively exactly while the pointer is
    // actually moving, and a gesture that never gets its pointerup — a lost
    // pointer, a blurred window — cools and stops instead of spinning a
    // requestAnimationFrame loop for the rest of the session.
    warmLayout?.();
  };

  const endGesture = (event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    // A press that travelled was a drag, and the click the browser is about to
    // synthesise from it must not also open the inspector.
    suppressClickRef.current = gesture.moved;
    if (gesture.mode === 'node') {
      // A node that was actually carried stays where it was dropped; the pin
      // is what makes the arrangement yours rather than the layout's. A press
      // that never moved pins nothing, so clicking to inspect does not quietly
      // freeze whatever you clicked.
      if (gesture.moved) onPin?.(gesture.id, gesture.lastGraphX, gesture.lastGraphY);
      else setNodes(prev => mnGraphHoldNode(prev, gesture.id, gesture.startGraphX, gesture.startGraphY));
      warmLayout?.();
    }
    mnGraphReleaseCapture(svgRef.current, event?.pointerId);
  };

  // True when the click that follows should be swallowed because it was the
  // tail of a drag. Asking clears it, so the next real click gets through.
  const claimClick = () => {
    if (!suppressClickRef.current) return true;
    suppressClickRef.current = false;
    return false;
  };

  // Wheel has to be a native non-passive listener: React's onWheel cannot
  // preventDefault, and without that the pane scrolls while the graph zooms.
  useEffectG(() => {
    if (!svgEl) return;
    const onWheel = (event) => {
      event.preventDefault();
      const local = mnGraphLocalPoint(svgEl, event);
      if (!local) return;
      setView(current => mnGraphZoomAt(current, mnGraphZoomFactor(event.deltaY), local.x, local.y));
    };
    svgEl.addEventListener('wheel', onWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', onWheel);
  }, [svgEl]);

  return { attachSvg, svgRef, startNodeDrag, startPan, moveGesture, endGesture, claimClick };
}

export { useGraphGestures, mnGraphLocalPoint };
