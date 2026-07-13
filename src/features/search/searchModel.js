// Pure note filtering/sorting model, shared by the renderer and benchmarks.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function decorateSearchResults(notes, details, decorate) {
    if (decorate) return decorate(notes, details);
    return notes.map(note => {
      const detail = details.get(note.id);
      return detail ? { ...note, __searchSnippet: detail.snippet, __matchedFields: detail.matchedFields } : note;
    });
  }

  function filterAndSortNotes({ notes, view, selectedTag, selectedWorkflow, workflowData, hitIds, details, tweaks, decorate }) {
    let next = [...notes];
    if (view === 'pinned') next = next.filter(note => note.pinned);
    if (selectedTag) next = next.filter(note => note.tags.includes(selectedTag));
    if (selectedWorkflow) {
      const ids = workflowData.noteIdsByState[selectedWorkflow] || new Set();
      next = next.filter(note => ids.has(note.id));
    }
    if (hitIds != null) {
      const order = new Map(hitIds.map((id, index) => [id, index]));
      next = decorateSearchResults(next.filter(note => order.has(note.id)), details, decorate);
      next.sort((a, b) => order.get(a.id) - order.get(b.id));
      return next;
    }
    next.sort((a, b) => {
      if (tweaks.pinnedFirst !== false) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      if ((tweaks.sortBy || 'modified') === 'title') return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      if ((tweaks.sortBy || 'modified') === 'created') return new Date(b.date || 0) - new Date(a.date || 0);
      return new Date(b.modifiedAt || b.date || 0) - new Date(a.modifiedAt || a.date || 0);
    });
    return next;
  }

  return { decorateSearchResults, filterAndSortNotes };
});
