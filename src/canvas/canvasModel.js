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

const MN_CANVAS_ANCHORABLE_TYPES = ['note', 'sticky', 'rect', 'ellipse', 'diamond', 'triangle', 'text'];

function mnCanvasIsConnector(element) {
  return element?.type === 'line' || element?.type === 'arrow';
}

// Topmost anchorable element whose bounds contain the point. Later elements
// draw on top, so scan from the end of the list.
function mnCanvasAnchorTargetAt(elements, point, excludeId = null) {
  const list = Array.isArray(elements) ? elements : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    if (!el || el.id === excludeId || !MN_CANVAS_ANCHORABLE_TYPES.includes(el.type)) continue;
    const b = mnCanvasBounds(el);
    if (point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) return el;
  }
  return null;
}

// Point on the element's bounding-box border along the ray from its center
// toward `toward`, so connectors touch the card edge instead of its middle.
function mnCanvasAnchorPoint(element, toward) {
  const b = mnCanvasBounds(element);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = (toward?.x ?? cx) - cx;
  const dy = (toward?.y ?? cy) - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = 1 / Math.max(Math.abs(dx) / Math.max(1, b.w / 2), Math.abs(dy) / Math.max(1, b.h / 2));
  return { x: cx + dx * t, y: cy + dy * t };
}

// Endpoints of a connector with anchors resolved against the live elements,
// so arrows follow their cards when dragged. Free endpoints and dangling
// anchors (deleted targets) keep the stored coordinates.
function mnCanvasResolveConnector(element, elementsById) {
  const startEl = element.startAnchorId ? elementsById?.get?.(element.startAnchorId) : null;
  const endEl = element.endAnchorId ? elementsById?.get?.(element.endAnchorId) : null;
  const center = (el) => {
    const b = mnCanvasBounds(el);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };
  const startRef = startEl ? center(startEl) : { x: element.x, y: element.y };
  const endRef = endEl ? center(endEl) : { x: element.x2, y: element.y2 };
  const from = startEl ? mnCanvasAnchorPoint(startEl, endRef) : startRef;
  const to = endEl ? mnCanvasAnchorPoint(endEl, startRef) : endRef;
  return { x: from.x, y: from.y, x2: to.x, y2: to.y };
}

// Writes resolved connector endpoints back into stored coordinates (and drops
// anchors whose target was deleted) so bounds, marquee hit-testing, and
// previews see the followed positions. Returns the same array when unchanged.
function mnCanvasSyncConnectors(elements) {
  const list = Array.isArray(elements) ? elements : [];
  const byId = new Map(list.map(el => [el.id, el]));
  let changed = false;
  const next = list.map(el => {
    if (!mnCanvasIsConnector(el) || (!el.startAnchorId && !el.endAnchorId)) return el;
    const patch = {};
    if (el.startAnchorId && !byId.has(el.startAnchorId)) patch.startAnchorId = null;
    if (el.endAnchorId && !byId.has(el.endAnchorId)) patch.endAnchorId = null;
    const resolved = mnCanvasResolveConnector(el, byId);
    if (resolved.x !== el.x || resolved.y !== el.y || resolved.x2 !== el.x2 || resolved.y2 !== el.y2) {
      Object.assign(patch, resolved);
    }
    if (!Object.keys(patch).length) return el;
    changed = true;
    return { ...el, ...patch };
  });
  return changed ? next : list;
}

// Clones a set of elements together: connector anchors are remapped to the
// cloned counterparts when the target is in the set, and dropped otherwise.
function mnCanvasCloneElements(elements, offset = 24) {
  const list = Array.isArray(elements) ? elements : [];
  const idMap = new Map();
  const clones = list.map(el => {
    const clone = mnCanvasCloneElement(el, offset);
    idMap.set(el.id, clone.id);
    return clone;
  });
  return clones.map(clone => {
    if (!mnCanvasIsConnector(clone) || (!clone.startAnchorId && !clone.endAnchorId)) return clone;
    return {
      ...clone,
      startAnchorId: clone.startAnchorId ? (idMap.get(clone.startAnchorId) || null) : clone.startAnchorId,
      endAnchorId: clone.endAnchorId ? (idMap.get(clone.endAnchorId) || null) : clone.endAnchorId,
    };
  });
}

// Adds a live note card to a canvas document without a stage rect (used by
// "Add to canvas" from the palette and note list). Places the card near the
// stored viewport center, cascading so repeated adds don't stack exactly.
function mnCanvasAddNoteCard(canvas, note, stage = {}) {
  const doc = canvas && typeof canvas === 'object' ? canvas : mnNewCanvas();
  const elements = Array.isArray(doc.elements) ? doc.elements : [];
  const noteId = String(note?.id || '');
  const existing = elements.find(el => el.type === 'note' && el.noteId === noteId);
  if (existing) return { canvas: doc, element: existing, existing: true };
  const vp = doc.viewport || { x: 0, y: 0, scale: 1 };
  const scale = vp.scale || 1;
  const cascade = (elements.length % 6) * 26;
  const point = {
    x: ((stage.width || 900) / 2 - (vp.x || 0)) / scale - 125 + cascade,
    y: ((stage.height || 600) / 2 - (vp.y || 0)) / scale - 75 + cascade,
  };
  const element = mnCanvasNoteElement(point, note);
  return {
    canvas: { ...doc, elements: [...elements, element], modifiedAt: new Date().toISOString() },
    element,
    existing: false,
  };
}


// Align every selected element to one edge (or centre line) of the selection's
// own bounding box. Elements outside the selection are returned untouched.
function mnCanvasAlign(elements, ids, mode) {
  const list = Array.isArray(elements) ? elements : [];
  const selected = new Set(ids || []);
  const picked = list.filter(el => selected.has(el.id));
  if (picked.length < 2) return list;
  const box = mnCanvasSelectionBounds(picked);
  if (!box) return list;
  return list.map(el => {
    if (!selected.has(el.id)) return el;
    const b = mnCanvasBounds(el);
    if (mode === 'left') return mnCanvasMoveElement(el, box.x - b.x, 0);
    if (mode === 'right') return mnCanvasMoveElement(el, box.x + box.w - (b.x + b.w), 0);
    if (mode === 'top') return mnCanvasMoveElement(el, 0, box.y - b.y);
    if (mode === 'bottom') return mnCanvasMoveElement(el, 0, box.y + box.h - (b.y + b.h));
    if (mode === 'center-x') return mnCanvasMoveElement(el, box.x + box.w / 2 - (b.x + b.w / 2), 0);
    if (mode === 'center-y') return mnCanvasMoveElement(el, 0, box.y + box.h / 2 - (b.y + b.h / 2));
    return el;
  });
}

// Even out the gaps along one axis: the outermost two stay put and everything
// between them is spread at a constant centre-to-centre step.
function mnCanvasDistribute(elements, ids, axis) {
  const list = Array.isArray(elements) ? elements : [];
  const selected = new Set(ids || []);
  const picked = list.filter(el => selected.has(el.id));
  if (picked.length < 3) return list;
  const sorted = [...picked].sort((a, b) => {
    const ba = mnCanvasBounds(a);
    const bb = mnCanvasBounds(b);
    return axis === 'x' ? ba.x - bb.x : ba.y - bb.y;
  });
  const first = mnCanvasBounds(sorted[0]);
  const last = mnCanvasBounds(sorted[sorted.length - 1]);
  const start = axis === 'x' ? first.x + first.w / 2 : first.y + first.h / 2;
  const end = axis === 'x' ? last.x + last.w / 2 : last.y + last.h / 2;
  const step = (end - start) / (sorted.length - 1);
  const centers = new Map(sorted.map((el, i) => [el.id, start + step * i]));
  return list.map(el => {
    if (!centers.has(el.id)) return el;
    const b = mnCanvasBounds(el);
    return axis === 'x'
      ? mnCanvasMoveElement(el, centers.get(el.id) - (b.x + b.w / 2), 0)
      : mnCanvasMoveElement(el, 0, centers.get(el.id) - (b.y + b.h / 2));
  });
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
  mnCanvasAlign,
  mnCanvasDistribute,
  MN_CANVAS_ANCHORABLE_TYPES,
  mnCanvasIsConnector,
  mnCanvasAnchorTargetAt,
  mnCanvasAnchorPoint,
  mnCanvasResolveConnector,
  mnCanvasSyncConnectors,
  mnCanvasCloneElements,
  mnCanvasAddNoteCard,
};
if (typeof module === 'object' && module.exports) module.exports = MN_CANVAS_MODEL_API;
