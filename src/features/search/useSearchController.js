const { useEffect, useMemo, useRef, useState } = React;

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

export function useSearchController({ query, activeVaultId, notes, dirtyNotes, hasDisk, search, view, selectedTag, selectedWorkflow, workflowData, tweaks, decorate }) {
  const [hits, setHits] = useState(null);
  const [details, setDetails] = useState(new Map());
  const sequence = useRef(0);

  useEffect(() => {
    const requestId = ++sequence.current;
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setHits(null);
      setDetails(new Map());
      return;
    }
    const hasUnsavedNotes = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
    if (!hasDisk || !activeVaultId || hasUnsavedNotes) {
      const handle = setTimeout(() => {
        const lowerQuery = cleanQuery.toLowerCase();
        const ids = notes.filter(note => note.title.toLowerCase().includes(lowerQuery)
          || (note.body || '').toLowerCase().includes(lowerQuery)
          || note.tags.some(tag => tag.toLowerCase().includes(lowerQuery))).map(note => note.id);
        if (requestId === sequence.current) {
          setHits({ vaultId: activeVaultId || '', query: cleanQuery, ids });
          setDetails(new Map());
        }
      }, 150);
      return () => clearTimeout(handle);
    }
    const handle = setTimeout(async () => {
      try {
        const response = await search(activeVaultId, cleanQuery, 100);
        if (requestId !== sequence.current) return;
        if (response.ok) {
          const rows = response.value || [];
          setHits({ vaultId: activeVaultId || '', query: cleanQuery, ids: rows.map(row => row.id) });
          setDetails(new Map(rows.map(row => [row.id, row])));
        } else {
          setHits({ vaultId: activeVaultId || '', query: cleanQuery, ids: [] });
          setDetails(new Map());
          console.error('search failed', response.error);
        }
      } catch (error) {
        console.error('search failed', error);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [activeVaultId, dirtyNotes, hasDisk, notes, query, search]);

  const hitIds = hits?.vaultId === activeVaultId && hits.query === query.trim() ? hits.ids : null;
  const filteredNotes = useMemo(() => filterAndSortNotes({ notes, view, selectedTag, selectedWorkflow, workflowData, hitIds, details, tweaks, decorate }),
    [decorate, details, hitIds, notes, selectedTag, selectedWorkflow, tweaks, view, workflowData]);
  return { filteredNotes };
}
