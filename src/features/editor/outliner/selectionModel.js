export function commitOutlinerSelection(selectionRef, setSelectionState, nextSelection) {
  const resolved = typeof nextSelection === 'function'
    ? nextSelection(selectionRef.current)
    : nextSelection;
  selectionRef.current = resolved;
  setSelectionState(resolved);
  return resolved;
}

export function blockIdsInSelectionRange(orderedIds, anchorId, extentId, fallbackIds = []) {
  const seen = new Set();
  const ids = (orderedIds || []).filter(id => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const anchorIndex = ids.indexOf(anchorId);
  const extentIndex = ids.indexOf(extentId);
  if (anchorIndex >= 0 && extentIndex >= 0) {
    const start = Math.min(anchorIndex, extentIndex);
    const end = Math.max(anchorIndex, extentIndex);
    return ids.slice(start, end + 1);
  }
  const fallback = new Set(fallbackIds || []);
  return ids.filter(id => fallback.has(id));
}

export function removeSelectedBlockTrees(blocks, selectedIds) {
  const selected = new Set(selectedIds || []);
  const removeSelected = (items) => {
    for (let index = items.length - 1; index >= 0; index--) {
      if (selected.has(items[index].id)) items.splice(index, 1);
      else removeSelected(items[index].children || []);
    }
  };
  removeSelected(blocks || []);
}

export function ensureEditableBlock(blocks, createBlock) {
  if (!Array.isArray(blocks) || blocks.length || typeof createBlock !== 'function') return null;
  const emptyBlock = createBlock({ kind: 'paragraph' });
  blocks.push(emptyBlock);
  return emptyBlock.id;
}
