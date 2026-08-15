import searchModel from './searchModel.js';

const { useEffect, useMemo, useRef, useState } = React;
const { filterAndSortNotes, localSearchIds, searchOutcome } = searchModel;

// Lowercased searchable text, cached per note object. Note identities are
// stable across keystrokes — only the edited note is a new object — so an
// in-memory search re-lowercases one note, not the whole vault.
const mnSearchTextCache = new WeakMap();

function mnSearchTextForNote(note) {
  const hit = mnSearchTextCache.get(note);
  if (hit !== undefined) return hit;
  const text = `${note.title}\n${note.body || ''}\n${(note.tags || []).join('\n')}`.toLowerCase();
  mnSearchTextCache.set(note, text);
  return text;
}

export function useSearchController({ query, activeVaultId, notes, dirtyNotes, hasDisk, search, view, selectedTag, selectedWorkflow, workflowData, tweaks, decorate }) {
  const [hits, setHits] = useState(null);
  const [details, setDetails] = useState(new Map());
  const [searchStatus, setSearchStatus] = useState('idle');
  const sequence = useRef(0);

  useEffect(() => {
    const requestId = ++sequence.current;
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setHits(null);
      setDetails(new Map());
      setSearchStatus('idle');
      return;
    }
    const hasUnsavedNotes = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
    if (!hasDisk || !activeVaultId || hasUnsavedNotes) {
      const handle = setTimeout(() => {
        const ids = localSearchIds(notes, cleanQuery, mnSearchTextForNote);
        if (requestId === sequence.current) {
          setHits({ vaultId: activeVaultId || '', query: cleanQuery, ids });
          setDetails(new Map());
          setSearchStatus('ok');
        }
      }, 150);
      return () => clearTimeout(handle);
    }
    const handle = setTimeout(async () => {
      try {
        const response = await search(activeVaultId, cleanQuery, 100);
        if (requestId !== sequence.current) return;
        if (searchOutcome(response) === 'ok') {
          const rows = response.value || [];
          setHits({ vaultId: activeVaultId || '', query: cleanQuery, ids: rows.map(row => row.id) });
          setDetails(new Map(rows.map(row => [row.id, row])));
          setSearchStatus('ok');
        } else {
          // The index is broken, not empty. An empty list here told the user
          // they had nothing matching, which was a lie the fallback removes.
          setHits({ vaultId: activeVaultId || '', query: cleanQuery, ids: localSearchIds(notes, cleanQuery, mnSearchTextForNote) });
          setDetails(new Map());
          setSearchStatus('index-unavailable');
          console.error('search failed', response?.error);
        }
      } catch (error) {
        if (requestId === sequence.current) {
          setHits({ vaultId: activeVaultId || '', query: cleanQuery, ids: localSearchIds(notes, cleanQuery, mnSearchTextForNote) });
          setDetails(new Map());
          setSearchStatus('index-unavailable');
        }
        console.error('search failed', error);
      }
    }, 150);
    return () => clearTimeout(handle);
    // notes and dirtyNotes stay in the deps deliberately. An earlier attempt
    // read them through refs so typing would not re-arm the debounce — and it
    // made active search results stale: delete or restore a note with a query
    // set and the list kept showing the old answer until you retyped it. The
    // per-keystroke cost lived in re-lowercasing every body, and that is what
    // the cache above removes; the re-arm itself is a timer swap.
  }, [activeVaultId, dirtyNotes, hasDisk, notes, query, search]);

  const hitIds = hits?.vaultId === activeVaultId && hits.query === query.trim() ? hits.ids : null;
  const filteredNotes = useMemo(() => filterAndSortNotes({ notes, view, selectedTag, selectedWorkflow, workflowData, hitIds, details, tweaks, decorate }),
    [decorate, details, hitIds, notes, selectedTag, selectedWorkflow, tweaks, view, workflowData]);
  return { filteredNotes, searchStatus };
}
