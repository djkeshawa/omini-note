const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const geometry = loadRendererModule('src/features/canvas/components/CanvasEditorGeometry.js');

test('canvas editor geometry converts between client, canvas, and screen coordinates', () => {
  const viewport = { x: 100, y: 50, scale: 2 };
  const fallbackSvg = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  assert.deepEqual(
    geometry.canvasEventPoint({ clientX: 150, clientY: 110 }, fallbackSvg, viewport),
    { x: 20, y: 20 }
  );
  assert.deepEqual(geometry.canvasPointToScreen({ x: 20, y: 20 }, viewport), { x: 140, y: 90 });

  const transformedSvg = {
    createSVGPoint: () => ({
      x: 0,
      y: 0,
      matrixTransform: () => ({ x: 80, y: 60 }),
    }),
    getScreenCTM: () => ({ inverse: () => ({}) }),
  };
  assert.deepEqual(
    geometry.canvasEventPoint({ clientX: 0, clientY: 0 }, transformedSvg, { x: 20, y: 10, scale: 2 }),
    { x: 30, y: 25 }
  );
});

test('canvas editor geometry normalizes marquee bounds and finds intersecting elements', () => {
  const rect = geometry.canvasRectFromPoints({ x: 80, y: 60 }, { x: 20, y: 10 });
  assert.deepEqual(rect, { x: 20, y: 10, w: 60, h: 50 });

  const elements = [
    { id: 'inside', type: 'rect', x: 30, y: 20, w: 10, h: 10 },
    { id: 'edge', type: 'rect', x: 80, y: 60, w: 20, h: 20 },
    { id: 'outside', type: 'rect', x: 101, y: 81, w: 10, h: 10 },
  ];
  assert.deepEqual(geometry.canvasElementsInRect(elements, rect).map(element => element.id), ['inside', 'edge']);
  assert.deepEqual(geometry.canvasElementsInRect(null, rect), []);
});

test('canvas editor geometry preserves resize constraints', () => {
  const original = { id: 'box', type: 'rect', x: 10, y: 20, w: 100, h: 80 };
  assert.deepEqual(
    geometry.canvasResizePatch(original, 'se', { x: 0, y: 0 }, { x: 25, y: 15 }),
    { x: 10, y: 20, w: 125, h: 95 }
  );
  assert.deepEqual(
    geometry.canvasResizePatch(original, 'nw', { x: 0, y: 0 }, { x: 200, y: 200 }),
    { x: 98, y: 88, w: 12, h: 12 }
  );
  assert.equal(
    geometry.canvasResizePatch({ type: 'line', x: 0, y: 0, x2: 10, y2: 10 }, 'se', { x: 0, y: 0 }, { x: 2, y: 2 }),
    null
  );
});
