export function propertyParts(content = '') {
  const match = String(content || '').match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
  return match ? { key: match[1], value: match[2] || '' } : null;
}

export function splitPropertyBlocks(blocks = []) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  let index = 0;
  const propertyBlocks = [];
  while (index < safeBlocks.length) {
    const block = safeBlocks[index];
    const property = block?.kind === 'paragraph' ? propertyParts(block.content) : null;
    if (!property) break;
    propertyBlocks.push(block);
    index++;
  }
  return {
    propertyBlocks,
    contentBlocks: safeBlocks.slice(index),
    properties: propertyBlocks.map(block => ({ ...propertyParts(block.content), block })),
  };
}

export function cleanPropertyKey(raw = '') {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
}

export function createPropertyBlock(key = '', value = '', createBlock) {
  const content = `${key}:: ${value || ''}`.trimEnd();
  if (typeof createBlock === 'function') return createBlock({ kind: 'paragraph', content });
  return {
    id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'paragraph', content, level: 0, checked: null, children: [], collapsed: false,
    annotations: [], workflow: null, language: '',
  };
}
