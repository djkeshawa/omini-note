// Canvas model helpers and constants.

const MN_CANVAS_TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'pen', label: 'Pen' },
  { id: 'text', label: 'Text' },
  { id: 'sticky', label: 'Sticky' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'eraser', label: 'Eraser' },
];

const MN_CANVAS_COLORS = [
  '#1f2937',
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#f59e0b',
  '#ffffff',
  '#fef3c7',
  '#dbeafe',
  '#dcfce7',
];

const MN_CANVAS_DEFAULT_STYLE = {
  stroke: '#1f2937',
  fill: '#ffffff',
  strokeWidth: 2,
};

function mnCloneCanvasState(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function mnCanvasId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
}

function mnNewCanvas(title = 'Untitled canvas') {
  const now = new Date().toISOString();
  return {
    id: `c_${Date.now().toString(36)}`,
    title,
    createdAt: now,
    modifiedAt: now,
    viewport: { x: 0, y: 0, scale: 1 },
    elements: [],
  };
}

function mnCanvasElement(type, point, style = MN_CANVAS_DEFAULT_STYLE) {
  const base = {
    id: mnCanvasId('ce'),
    type,
    x: point.x,
    y: point.y,
    stroke: style.stroke || MN_CANVAS_DEFAULT_STYLE.stroke,
    fill: style.fill || MN_CANVAS_DEFAULT_STYLE.fill,
    strokeWidth: style.strokeWidth || MN_CANVAS_DEFAULT_STYLE.strokeWidth,
  };
  if (type === 'text') return { ...base, w: 180, h: 46, text: 'Text', fill: 'transparent' };
  if (type === 'sticky') return { ...base, w: 170, h: 110, text: 'Sticky note', fill: style.fill || '#fef3c7' };
  if (type === 'ellipse') return { ...base, w: 1, h: 1, text: '' };
  if (type === 'line' || type === 'arrow') return { ...base, x2: point.x, y2: point.y, text: '', fill: 'transparent' };
  if (type === 'pen') return { ...base, points: [point], text: '', fill: 'transparent' };
  if (type === 'diamond' || type === 'triangle') return { ...base, w: 1, h: 1, text: '' };
  return { ...base, type: 'rect', w: 1, h: 1, text: '' };
}

// A live note placed on the canvas as a card. Only the note id is stored;
// title/preview render from the current note so cards never go stale.
function mnCanvasNoteElement(point, note = {}) {
  return {
    id: mnCanvasId('ce'),
    type: 'note',
    x: point.x,
    y: point.y,
    w: 250,
    h: 150,
    noteId: String(note.id || ''),
    text: String(note.title || 'Untitled'),
    stroke: '#1f2937',
    fill: '#ffffff',
    strokeWidth: 1.6,
  };
}

// Plain-text preview of a note body for canvas cards: drops properties,
// code fences, embeds, and markdown syntax, keeping readable prose.
function mnCanvasNotePreview(note, maxLength = 220) {
  return String(note?.body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter(line => !/^[a-zA-Z][a-zA-Z0-9_-]*::/.test(line.trim()))
    .join(' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]\n]+)\]\]/g, (_match, target) => {
      const pipeIndex = String(target).indexOf('|');
      return pipeIndex >= 0 ? String(target).slice(pipeIndex + 1) : String(target);
    })
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~|]+/g, ' ')
    .replace(/(^|\s)-\s+\[[ xX]\]\s+/g, '$1')
    .replace(/(^|\s)-\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxLength));
}

function mnCanvasDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function mnCanvasPreviewElements(canvas) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements.slice(0, 5) : [];
  if (elements.length) return elements;
  const count = canvas?.elementCount || 0;
  if (!count) return [];
  return [
    { id: 'preview-rect', type: 'rect', x: 26, y: 24, w: 92, h: 38, stroke: '#2563eb', fill: '#dbeafe', strokeWidth: 2 },
    { id: 'preview-sticky', type: 'sticky', x: 126, y: 22, w: 76, h: 58, stroke: '#92400e', fill: '#fef3c7', strokeWidth: 1.6 },
    { id: 'preview-line', type: 'arrow', x: 76, y: 76, x2: 168, y2: 96, stroke: '#16a34a', fill: 'transparent', strokeWidth: 2 },
  ].slice(0, Math.min(3, Math.max(1, count)));
}

function mnCanvasCloneElement(element, offset = 24) {
  const clone = {
    ...element,
    id: mnCanvasId('ce'),
    x: (element.x || 0) + offset,
    y: (element.y || 0) + offset,
  };
  if (element.x2 != null) clone.x2 = element.x2 + offset;
  if (element.y2 != null) clone.y2 = element.y2 + offset;
  if (Array.isArray(element.points)) {
    clone.points = element.points.map(point => ({ x: point.x + offset, y: point.y + offset }));
  }
  return clone;
}

function mnCanvasRange(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const raw of values || []) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 0 };
}

function mnCanvasBounds(element) {
  if (element.type === 'line' || element.type === 'arrow') {
    return {
      x: Math.min(element.x, element.x2),
      y: Math.min(element.y, element.y2),
      w: Math.abs(element.x2 - element.x),
      h: Math.abs(element.y2 - element.y),
    };
  }
  if (element.type === 'pen') {
    const points = element.points || [];
    if (!points.length) return { x: element.x || 0, y: element.y || 0, w: 0, h: 0 };
    const xs = mnCanvasRange(points.map(p => p.x));
    const ys = mnCanvasRange(points.map(p => p.y));
    return {
      x: xs.min,
      y: ys.min,
      w: xs.max - xs.min,
      h: ys.max - ys.min,
    };
  }
  return { x: element.x || 0, y: element.y || 0, w: element.w || 0, h: element.h || 0 };
}

function mnCanvasSelectionBounds(elements) {
  const bounds = (elements || []).map(mnCanvasBounds).filter(b => Number.isFinite(b.x) && Number.isFinite(b.y));
  if (!bounds.length) return null;
  const xs = mnCanvasRange(bounds.flatMap(b => [b.x, b.x + b.w]));
  const ys = mnCanvasRange(bounds.flatMap(b => [b.y, b.y + b.h]));
  const left = xs.min;
  const top = ys.min;
  const right = xs.max;
  const bottom = ys.max;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function mnCanvasMoveElement(element, dx, dy) {
  const next = { ...element, x: (element.x || 0) + dx, y: (element.y || 0) + dy };
  if (element.x2 != null) next.x2 = element.x2 + dx;
  if (element.y2 != null) next.y2 = element.y2 + dy;
  if (Array.isArray(element.points)) next.points = element.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  return next;
}


const MN_CANVAS_MODEL_API = {
  MN_CANVAS_TOOLS,
  MN_CANVAS_COLORS,
  MN_CANVAS_DEFAULT_STYLE,
  mnCloneCanvasState,
  mnCanvasId,
  mnNewCanvas,
  mnCanvasElement,
  mnCanvasNoteElement,
  mnCanvasNotePreview,
  mnCanvasDate,
  mnCanvasPreviewElements,
  mnCanvasCloneElement,
  mnCanvasRange,
  mnCanvasBounds,
  mnCanvasSelectionBounds,
  mnCanvasMoveElement,
};
if (typeof window !== 'undefined') {
  window.MN_CANVAS_MODEL = MN_CANVAS_MODEL_API;
  window.mnNewCanvas = mnNewCanvas;
}
if (typeof module === 'object' && module.exports) module.exports = MN_CANVAS_MODEL_API;
