import searchModel from './searchModel.js';

const { useEffect, useMemo, useRef, useState } = React;
const { filterAndSortNotes } = searchModel;

export function useSearchController({ query, activeVaultId, notes, dirtyNotes, hasDisk, search, view, selectedTag, selectedWorkflow, workflowData, tweaks, decorate }) {
  const [hits, setHits] = useState(null);
  const [details, setDetails] = useState(new Map());
  const sequence = useRef(0);

  // notes and dirtyNotes both get a fresh identity on every keystroke — notes
  // because notesWithBody remaps, dirtyNotes because markDirty allocates a new
  // Map. Depending on them re-armed this effect, and its 150ms debounce, on
  // every character typed anywhere in the app: with a query active the indexed
  // search never fired until typing stopped completely. The effect reads both
  // through refs instead and depends only on what should actually restart it.
  const notesRef = useRef(notes);
  const dirtyNotesRef = useRef(dirtyNotes);
  notesRef.current = notes;
  dirtyNotesRef.current = dirtyNotes;

  useEffect(() => {
    const requestId = ++sequence.current;
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setHits(null);
      setDetails(new Map());
      return;
    }
    const hasUnsavedNotes = [...dirtyNotesRef.current.values()].some(entry => entry.vaultId === activeVaultId);
    if (!hasDisk || !activeVaultId || hasUnsavedNotes) {
      const handle = setTimeout(() => {
        const lowerQuery = cleanQuery.toLowerCase();
        const ids = notesRef.current.filter(note => note.title.toLowerCase().includes(lowerQuery)
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
  }, [activeVaultId, hasDisk, query, search]);

  const hitIds = hits?.vaultId === activeVaultId && hits.query === query.trim() ? hits.ids : null;
  const filteredNotes = useMemo(() => filterAndSortNotes({ notes, view, selectedTag, selectedWorkflow, workflowData, hitIds, details, tweaks, decorate }),
    [decorate, details, hitIds, notes, selectedTag, selectedWorkflow, tweaks, view, workflowData]);
  return { filteredNotes };
}
