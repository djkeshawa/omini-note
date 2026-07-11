(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function cloneAnnotation(a) {
    return { start: a.start, end: a.end, kind: a.kind };
  }

  function normalizeAnnotations(annotations, textLength) {
    const max = Math.max(0, Number(textLength) || 0);
    return (annotations || [])
      .map(a => ({
        start: Math.max(0, Math.min(max, Number(a.start) || 0)),
        end: Math.max(0, Math.min(max, Number(a.end) || 0)),
        kind: a.kind,
      }))
      .filter(a => a.kind && a.end > a.start)
      .sort((a, b) => a.start - b.start || a.end - b.end || String(a.kind).localeCompare(String(b.kind)));
  }

  function sameFormatFamily(kind, otherKind) {
    if (String(kind).startsWith('hi-')) return String(otherKind).startsWith('hi-');
    if (String(kind).startsWith('color-')) return String(otherKind).startsWith('color-');
    if (String(kind).startsWith('fs-')) return String(otherKind).startsWith('fs-');
    return kind === otherKind;
  }

  function subtractRangeFromAnnotation(annotation, start, end) {
    const a = cloneAnnotation(annotation);
    if (end <= start || a.end <= start || a.start >= end) return [a];
    const parts = [];
    if (a.start < start) parts.push({ ...a, end: start });
    if (a.end > end) parts.push({ ...a, start: end });
    return parts.filter(x => x.end > x.start);
  }

  function clearAnnotationRange(annotations, start, end, textLength) {
    if (end <= start) return normalizeAnnotations(annotations, textLength);
    const out = [];
    for (const a of normalizeAnnotations(annotations, textLength)) {
      out.push(...subtractRangeFromAnnotation(a, start, end));
    }
    return normalizeAnnotations(out, textLength);
  }

  function applyAnnotationRange(annotations, start, end, kind, textLength) {
    if (end <= start || !kind) return normalizeAnnotations(annotations, textLength);
    const out = [];
    for (const a of normalizeAnnotations(annotations, textLength)) {
      if (sameFormatFamily(kind, a.kind)) out.push(...subtractRangeFromAnnotation(a, start, end));
      else out.push(a);
    }
    out.push({ start, end, kind });
    return normalizeAnnotations(out, textLength);
  }

  function splitAnnotations(annotations, cursor, textLength) {
    const left = [];
    const right = [];
    const pos = Math.max(0, Math.min(Number(textLength) || 0, Number(cursor) || 0));
    for (const a of normalizeAnnotations(annotations, textLength)) {
      if (a.end <= pos) {
        left.push(a);
      } else if (a.start >= pos) {
        right.push({ ...a, start: a.start - pos, end: a.end - pos });
      } else {
        left.push({ ...a, end: pos });
        right.push({ ...a, start: 0, end: a.end - pos });
      }
    }
    return {
      before: normalizeAnnotations(left, pos),
      after: normalizeAnnotations(right, Math.max(0, (Number(textLength) || 0) - pos)),
    };
  }

  function shiftAnnotations(annotations, offset) {
    return (annotations || []).map(a => ({
      ...a,
      start: a.start + offset,
      end: a.end + offset,
    }));
  }

  function mergeAnnotations(firstAnnotations, secondAnnotations, firstTextLength, mergedTextLength) {
    return normalizeAnnotations([
      ...(firstAnnotations || []).map(cloneAnnotation),
      ...shiftAnnotations(secondAnnotations || [], Number(firstTextLength) || 0),
    ], mergedTextLength);
  }

  function replaceTextRange(content, annotations, start, end, replacement) {
    const text = String(content || '');
    const safeStart = Math.max(0, Math.min(text.length, Number(start) || 0));
    const safeEnd = Math.max(safeStart, Math.min(text.length, Number(end) || 0));
    const insert = String(replacement || '');
    const nextContent = text.slice(0, safeStart) + insert + text.slice(safeEnd);
    const nextAnnotations = adjustAnnotationsForTextChange(
      annotations || [],
      safeStart,
      safeEnd,
      insert.length,
      text.length,
      nextContent.length
    );
    return { content: nextContent, annotations: nextAnnotations };
  }

  function adjustAnnotationsForTextChange(annotations, start, end, insertedLength, oldLength, newLength) {
    const delta = insertedLength - (end - start);
    const out = [];
    for (const a of normalizeAnnotations(annotations, oldLength)) {
      if (start === end) {
        if (a.end < start) out.push(a);
        else if (a.start > start) out.push({ ...a, start: a.start + delta, end: a.end + delta });
        else out.push({ ...a, end: a.end + delta });
        continue;
      }
      if (a.end <= start) {
        out.push(a);
      } else if (a.start >= end) {
        out.push({ ...a, start: a.start + delta, end: a.end + delta });
      } else {
        if (a.start < start) out.push({ ...a, end: start });
        if (a.end > end) out.push({ ...a, start: start + insertedLength, end: a.end + delta });
      }
    }
    return normalizeAnnotations(out, newLength);
  }

  function deriveTextChange(oldText, newText) {
    const oldValue = String(oldText || '');
    const newValue = String(newText || '');
    let start = 0;
    while (start < oldValue.length && start < newValue.length && oldValue[start] === newValue[start]) start++;
    let oldEnd = oldValue.length;
    let newEnd = newValue.length;
    while (oldEnd > start && newEnd > start && oldValue[oldEnd - 1] === newValue[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    return { start, end: oldEnd, replacement: newValue.slice(start, newEnd) };
  }

  function updateBlockContent(block, nextContent) {
    const oldContent = String(block.content || '');
    const change = deriveTextChange(oldContent, nextContent);
    const replaced = replaceTextRange(oldContent, block.annotations || [], change.start, change.end, change.replacement);
    block.content = replaced.content;
    block.annotations = replaced.annotations;
    return block;
  }

  function splitBlock(block, cursor, nextBlock) {
    const text = String(block.content || '');
    const pos = Math.max(0, Math.min(text.length, Number(cursor) || 0));
    const split = splitAnnotations(block.annotations || [], pos, text.length);
    block.content = text.slice(0, pos);
    block.annotations = split.before;
    nextBlock.content = text.slice(pos);
    nextBlock.annotations = split.after;
    return nextBlock;
  }

  function mergeBlockContent(targetBlock, sourceBlock) {
    const first = String(targetBlock.content || '');
    const second = String(sourceBlock.content || '');
    targetBlock.content = first + second;
    targetBlock.annotations = mergeAnnotations(
      targetBlock.annotations || [],
      sourceBlock.annotations || [],
      first.length,
      targetBlock.content.length
    );
    return targetBlock;
  }

  function resolveBlocksChange(previousBlocks, blocksOrUpdater) {
    return typeof blocksOrUpdater === 'function'
      ? blocksOrUpdater(previousBlocks)
      : blocksOrUpdater;
  }

  return {
    normalizeAnnotations,
    sameFormatFamily,
    clearAnnotationRange,
    applyAnnotationRange,
    splitAnnotations,
    mergeAnnotations,
    replaceTextRange,
    adjustAnnotationsForTextChange,
    deriveTextChange,
    updateBlockContent,
    splitBlock,
    mergeBlockContent,
    resolveBlocksChange,
  };
});
