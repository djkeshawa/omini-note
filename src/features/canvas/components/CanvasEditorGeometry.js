import MN_CANVAS_MODEL from '../../../canvas/canvasModel.js';

const { mnCanvasBounds } = MN_CANVAS_MODEL;
const DEFAULT_VIEWPORT = { x: 0, y: 0, scale: 1 };

function canvasEventPoint(event, svg, viewport = DEFAULT_VIEWPORT) {
  if (svg?.createSVGPoint && svg?.getScreenCTM) {
    const screenMatrix = svg.getScreenCTM();
    if (screenMatrix) {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const svgPoint = point.matrixTransform(screenMatrix.inverse());
      return {
        x: (svgPoint.x - viewport.x) / viewport.scale,
        y: (svgPoint.y - viewport.y) / viewport.scale,
      };
    }
  }
  const rect = svg.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - viewport.x) / viewport.scale,
    y: (event.clientY - rect.top - viewport.y) / viewport.scale,
  };
}

function canvasPointToScreen(point, viewport = DEFAULT_VIEWPORT) {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

function canvasRectFromPoints(start, point) {
  return {
    x: Math.min(start.x, point.x),
    y: Math.min(start.y, point.y),
    w: Math.abs(point.x - start.x),
    h: Math.abs(point.y - start.y),
  };
}

function canvasResizePatch(original, handle, start, point) {
  if (!original || ['line', 'arrow', 'pen'].includes(original.type)) return null;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  let x = original.x;
  let y = original.y;
  let w = original.w || 1;
  let h = original.h || 1;
  if (handle.includes('e')) w = Math.max(12, original.w + dx);
  if (handle.includes('s')) h = Math.max(12, original.h + dy);
  if (handle.includes('w')) {
    x = Math.min(original.x + original.w - 12, original.x + dx);
    w = Math.max(12, original.w - dx);
  }
  if (handle.includes('n')) {
    y = Math.min(original.y + original.h - 12, original.y + dy);
    h = Math.max(12, original.h - dy);
  }
  return { x, y, w, h };
}

function canvasElementsInRect(elements, rect) {
  return (elements || []).filter(element => {
    const bounds = mnCanvasBounds(element);
    return bounds.x <= rect.x + rect.w
      && bounds.x + bounds.w >= rect.x
      && bounds.y <= rect.y + rect.h
      && bounds.y + bounds.h >= rect.y;
  });
}

export {
  canvasElementsInRect,
  canvasEventPoint,
  canvasPointToScreen,
  canvasRectFromPoints,
  canvasResizePatch,
};
