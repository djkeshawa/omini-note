const BLOCK_KINDS = new Set(['paragraph', 'heading', 'bullet', 'ordered', 'todo', 'quote', 'code', 'table', 'divider', 'plot-points']);

export const BLOCK_CLIPBOARD_TYPE = 'application/x-omininote-blocks';

export function isClipboardBlock(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.content === 'string'
    && (!value.kind || BLOCK_KINDS.has(value.kind))
    && (!value.children || Array.isArray(value.children));
}

export function reidBlocks(blocks, cloneBlocks) {
  let sequence = 0;
  const nextId = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${sequence++}`;
  const next = cloneBlocks(blocks || []);
  const reid = (block) => {
    block.id = nextId();
    (block.children || []).forEach(reid);
  };
  next.forEach(reid);
  return next;
}

export function normalizeClipboardMarkdown(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function looksLikeBlockMarkdown(text) {
  const normalized = normalizeClipboardMarkdown(text);
  const lines = normalized.split('\n').filter(line => line.trim());
  if (lines.length < 2) return false;
  if (/\n\s*\n/.test(normalized)) return true;
  return lines.some(line => /^(#{1,3}\s+|>\s+|---+$|\s*(?:-|\d+[.)])\s+|\|.+\|)/.test(line));
}
