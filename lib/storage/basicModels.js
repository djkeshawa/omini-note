const PACK_IDS = new Set(['planning', 'canvas', 'research', 'writer', 'agents', 'labs']);

function createBasicModels({ isPlainObject, validateCanvasId, cleanString, maxTitleLength, randomUUID }) {
  function normalizeEnabledPacks(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(item => String(item || '').trim().toLowerCase()).filter(id => PACK_IDS.has(id)))];
  }

  function extractWikiTargets(body = '') {
    const targets = [];
    const pattern = /\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|[^\]\n]+)?\]\]/g;
    let match;
    while ((match = pattern.exec(String(body || '')))) {
      const title = cleanString(match[1], '', maxTitleLength);
      if (title) targets.push(title);
    }
    return targets;
  }

  function normalizeCanvasViewport(viewport) {
    const raw = isPlainObject(viewport) ? viewport : {};
    const x = Number(raw.x);
    const y = Number(raw.y);
    const scale = Number(raw.scale);
    return {
      x: Number.isFinite(x) ? Math.max(-100000, Math.min(100000, x)) : 0,
      y: Number.isFinite(y) ? Math.max(-100000, Math.min(100000, y)) : 0,
      scale: Number.isFinite(scale) ? Math.max(0.1, Math.min(8, scale)) : 1,
    };
  }

  function normalizeCanvas(canvas = {}) {
    const now = new Date().toISOString();
    return {
      id: validateCanvasId(canvas.id || `c_${Date.now().toString(36)}`),
      title: String(canvas.title || 'Untitled canvas').trim() || 'Untitled canvas',
      createdAt: canvas.createdAt || now, modifiedAt: canvas.modifiedAt || now,
      viewport: normalizeCanvasViewport(canvas.viewport),
      elements: Array.isArray(canvas.elements) ? canvas.elements : [],
    };
  }

  function uniqueSafetyId(prefix, id) {
    const safeId = String(id || 'item').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'item';
    return `${prefix}_${safeId}_${safetyStamp()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function safetyStamp() {
    return new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-+$/g, '');
  }

  function uniqueImportedEntityId(rawId, usedIds, validateId, fallbackPrefix) {
    const fallback = `${fallbackPrefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const base = validateId(rawId || fallback);
    if (!usedIds.has(base)) { usedIds.add(base); return base; }
    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidate = validateId(`${base}_imported_${randomUUID().replace(/-/g, '').slice(0, 12)}`);
      if (!usedIds.has(candidate)) { usedIds.add(candidate); return candidate; }
    }
    throw new Error('Could not allocate imported item id');
  }

  return { normalizeEnabledPacks, extractWikiTargets, normalizeCanvas, safetyStamp, uniqueSafetyId, uniqueImportedEntityId };
}

module.exports = { createBasicModels };
