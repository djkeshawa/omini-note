export function changeBlockKind(blocks, id, patch, { locate, updateContent }) {
  const location = locate(blocks, id);
  if (!location) return;
  if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
    updateContent(location.block, patch.content);
    const { content, ...rest } = patch;
    Object.assign(location.block, rest);
    return;
  }
  Object.assign(location.block, patch);
}

export function toggleBlockCollapse(blocks, id, locate) {
  const location = locate(blocks, id);
  if (location) location.block.collapsed = !location.block.collapsed;
}

export function toggleBlockCheck(blocks, id, locate) {
  const location = locate(blocks, id);
  if (location?.block.kind === 'todo') location.block.checked = !location.block.checked;
}

export function indentBlock(blocks, id, locate) {
  const location = locate(blocks, id);
  if (!location || location.idx === 0) return;
  const previous = location.arr[location.idx - 1];
  if (previous.kind === 'divider') return;
  location.arr.splice(location.idx, 1);
  previous.children.push(location.block);
  previous.collapsed = false;
}

export function outdentBlock(blocks, id, locate) {
  const location = locate(blocks, id);
  if (!location?.parent) return;
  const parentLocation = locate(blocks, location.parent.id);
  if (!parentLocation) return;
  location.arr.splice(location.idx, 1);
  parentLocation.arr.splice(parentLocation.idx + 1, 0, location.block);
}

export function splitBlockAt(blocks, id, cursor, nextBlock, { locate, splitBlock }) {
  const location = locate(blocks, id);
  if (!location) return;
  splitBlock(location.block, cursor, nextBlock);
  location.arr.splice(location.idx + 1, 0, nextBlock);
}

export function insertBlocksAt(blocks, id, start, end, insertedBlocks, dependencies) {
  const { locate, splitAnnotations, cloneBlocks, createBlock } = dependencies;
  const location = locate(blocks, id);
  if (!location || !insertedBlocks?.length) return;
  const text = String(location.block.content || '');
  const safeStart = Math.max(0, Math.min(text.length, Number(start) || 0));
  const safeEnd = Math.max(safeStart, Math.min(text.length, Number(end) || safeStart));
  const beforeSplit = splitAnnotations(location.block.annotations || [], safeStart, text.length);
  const afterSplit = splitAnnotations(location.block.annotations || [], safeEnd, text.length);
  const tailText = text.slice(safeEnd);
  const blocksToInsert = cloneBlocks(insertedBlocks);
  const tailBlocks = tailText ? [createBlock({
    kind: location.block.kind,
    level: location.block.level || 0,
    checked: location.block.checked,
    content: tailText,
    annotations: afterSplit.after,
    workflow: location.block.workflow || null,
    language: location.block.language || '',
    children: safeStart === 0 ? (location.block.children || []) : [],
  })] : [];
  if (safeStart === 0) {
    location.arr.splice(location.idx, 1, ...blocksToInsert, ...tailBlocks);
    return;
  }
  location.block.content = text.slice(0, safeStart);
  location.block.annotations = beforeSplit.before;
  location.arr.splice(location.idx + 1, 0, ...blocksToInsert, ...tailBlocks);
}

export function mergeBlockWithPrevious(blocks, id, { locate, mergeContent }) {
  const location = locate(blocks, id);
  if (!location || location.idx === 0) return null;
  let target = location.arr[location.idx - 1];
  while (target.children.length && !target.collapsed) target = target.children[target.children.length - 1];
  if (target.kind === 'divider') {
    const targetLocation = locate(blocks, target.id);
    if (targetLocation) targetLocation.arr.splice(targetLocation.idx, 1, ...(target.children || []));
    return location.block.id;
  }
  mergeContent(target, location.block);
  target.children = target.children.concat(location.block.children || []);
  location.arr.splice(location.idx, 1);
  return target.id;
}

export function deleteBlock(blocks, id, locate) {
  const location = locate(blocks, id);
  if (!location) return null;
  let focusId = null;
  if (location.idx > 0) {
    let target = location.arr[location.idx - 1];
    while (target.children.length && !target.collapsed) target = target.children[target.children.length - 1];
    focusId = target.id;
  } else if (location.parent) {
    focusId = location.parent.id;
  }
  location.arr.splice(location.idx, 1);
  return focusId;
}

export function moveBlock(blocks, sourceId, destinationId, position, locate) {
  const source = locate(blocks, sourceId);
  if (!source) return;
  if (position === 'up' || position === 'down') {
    const offset = position === 'up' ? -1 : 1;
    const nextIndex = source.idx + offset;
    if (nextIndex < 0 || nextIndex >= source.arr.length) return;
    const [block] = source.arr.splice(source.idx, 1);
    source.arr.splice(nextIndex, 0, block);
    return;
  }
  const contains = (parent, targetId) => parent?.id === targetId
    || (parent?.children || []).some(child => contains(child, targetId));
  if (contains(source.block, destinationId)) return;
  const block = source.block;
  source.arr.splice(source.idx, 1);
  const destination = locate(blocks, destinationId);
  if (!destination) {
    source.arr.splice(source.idx, 0, block);
    return;
  }
  if (position === 'child') {
    destination.block.children.push(block);
    destination.block.collapsed = false;
  } else {
    destination.arr.splice(destination.idx + (position === 'before' ? 0 : 1), 0, block);
  }
}
