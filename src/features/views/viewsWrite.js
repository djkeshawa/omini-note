// Turning a view row back into something writable.
//
// A row rendered in a view came from parsing a note, and it remembers where:
// `source.blockId` points at the very block the extraction walked, in the same
// in-memory blocks array a save will clone. That is an exact anchor, not a
// guess, so a write from a view is as precise as one from the agenda.
//
// The planning actions expect those fields at the top level, so this flattens
// them. Without that, every write fell through to replace-unique-text, which
// returns the body unchanged when the same line appears twice — meaning
// ticking one of two identical tasks silently did nothing.

// Ambiguity here is not recoverable: if the same text appears more than once
// and the blockId is gone, any choice is a coin flip against the user's note.
// Refusing and saying so is the only honest answer.
function mnViewsLocateBlockId(note, text, walk) {
  const target = String(text || '').trim();
  if (!target || typeof walk !== 'function' || !Array.isArray(note?.blocks)) return { ok: false, reason: 'unlocatable' };
  const hits = [];
  walk(note.blocks, (block) => {
    if (String(block?.content || '').trim() === target) hits.push(block.id);
  });
  if (hits.length === 1) return { ok: true, blockId: hits[0] };
  return { ok: false, reason: hits.length ? 'ambiguous' : 'unlocatable' };
}

function mnViewsActionItem(result, { note, walk } = {}) {
  if (!result || !result.noteId) return { ok: false, reason: 'unlocatable' };
  const source = result.source || {};
  const item = {
    noteId: result.noteId,
    label: result.label ?? result.title ?? '',
    text: result.text || source.text || '',
    checked: !!result.checked,
    remindAt: result.remindAt || null,
    deferUntil: result.deferUntil || '',
    blockId: source.blockId || '',
    line: source.line ?? null,
  };
  if (item.blockId || item.line != null) return { ok: true, item };

  // No anchor survived: try to find the line again, but only if it is unique.
  const located = mnViewsLocateBlockId(note, item.text, walk);
  if (!located.ok) return located;
  return { ok: true, item: { ...item, blockId: located.blockId } };
}

export { mnViewsActionItem, mnViewsLocateBlockId };
