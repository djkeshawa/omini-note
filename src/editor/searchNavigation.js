// Search highlighting and result navigation for an opened note.
// The matching helpers stay DOM-free so behavior is testable in Node.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const ALL_HIGHLIGHT = 'mn-search-all';
  const ACTIVE_HIGHLIGHT = 'mn-search-active';

  function normalizeSearchQuery(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function textMatchOffsets(text, query, limit = 500) {
    const source = String(text == null ? '' : text);
    const needle = normalizeSearchQuery(query).toLocaleLowerCase();
    if (!needle) return [];
    const haystack = source.toLocaleLowerCase();
    const matches = [];
    let cursor = 0;
    const max = Math.max(1, Number(limit) || 500);
    while (cursor <= haystack.length - needle.length && matches.length < max) {
      const start = haystack.indexOf(needle, cursor);
      if (start < 0) break;
      matches.push({ start, end: start + needle.length });
      cursor = start + Math.max(1, needle.length);
    }
    return matches;
  }

  function clearEditorSearchHighlights(root = globalThis) {
    const highlights = root?.CSS?.highlights;
    if (highlights?.delete) {
      highlights.delete(ALL_HIGHLIGHT);
      highlights.delete(ACTIVE_HIGHLIGHT);
    }
    root?.document?.querySelectorAll?.('[data-mn-search-match]')?.forEach(node => {
      node.removeAttribute('data-mn-search-match');
      node.removeAttribute('data-mn-search-active');
    });
  }

  function searchableTextNodes(scope, root = globalThis) {
    if (!scope || !root?.document?.createTreeWalker || !root?.NodeFilter) return [];
    const walker = root.document.createTreeWalker(scope, root.NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node?.nodeValue?.trim()) return root.NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest('[data-mn-search-toolbar], script, style, textarea, input, select, button')) {
          return root.NodeFilter.FILTER_REJECT;
        }
        return root.NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function applyEditorSearchHighlights(scope, query, activeIndex = 0, root = globalThis) {
    clearEditorSearchHighlights(root);
    const clean = normalizeSearchQuery(query);
    if (!scope || !clean) return { count: 0, activeIndex: -1, targets: [] };

    const entries = [];
    searchableTextNodes(scope, root).forEach(node => {
      textMatchOffsets(node.nodeValue, clean).forEach(offset => entries.push({ node, ...offset }));
    });
    if (!entries.length) return { count: 0, activeIndex: -1, targets: [] };

    const normalizedIndex = ((Number(activeIndex) || 0) % entries.length + entries.length) % entries.length;
    const targets = entries.map(entry => entry.node.parentElement?.closest?.('[data-block-id]') || entry.node.parentElement).filter(Boolean);
    const HighlightCtor = root?.Highlight;
    const highlights = root?.CSS?.highlights;
    if (HighlightCtor && highlights?.set && root?.document?.createRange) {
      const ranges = entries.map(entry => {
        const range = root.document.createRange();
        range.setStart(entry.node, entry.start);
        range.setEnd(entry.node, entry.end);
        return range;
      });
      highlights.set(ALL_HIGHLIGHT, new HighlightCtor(...ranges));
      highlights.set(ACTIVE_HIGHLIGHT, new HighlightCtor(ranges[normalizedIndex]));
    } else {
      targets.forEach((target, index) => {
        target.setAttribute('data-mn-search-match', 'true');
        if (index === normalizedIndex) target.setAttribute('data-mn-search-active', 'true');
      });
    }
    return { count: entries.length, activeIndex: normalizedIndex, targets };
  }

  return {
    ALL_HIGHLIGHT,
    ACTIVE_HIGHLIGHT,
    normalizeSearchQuery,
    textMatchOffsets,
    clearEditorSearchHighlights,
    applyEditorSearchHighlights,
  };
});
