const { useCallback, useEffect, useRef, useState } = React;

export function useReferencePaneController({
  activeVaultId,
  notes,
  selectedId,
  selectedNote,
  noteListHidden,
  navigateView,
  setNoteListVisible,
  recordUsage,
  storage,
}) {
  const [open, setOpen] = useState(false);
  const [noteId, setNoteId] = useState('');
  const restoreNoteListRef = useRef(false);
  const storageKey = `mn:referenceNote:${activeVaultId || 'local'}`;

  const openPane = useCallback((requestedNoteId = '') => {
    const storedId = storage?.getJson?.(storageKey, '') || '';
    const target = notes.find(note => note.id === requestedNoteId)
      || notes.find(note => note.id === storedId && note.id !== selectedId)
      || notes.find(note => note.id !== selectedId)
      || selectedNote
      || null;
    if (!target) return { ok: false, message: 'Create a note before opening the reference pane.' };
    setNoteId(target.id);
    setOpen(true);
    navigateView('notes');
    storage?.setJson?.(storageKey, target.id);
    if (!noteListHidden) {
      restoreNoteListRef.current = true;
      setNoteListVisible(false);
    }
    recordUsage('reference_pane', 'opened');
    return { message: `Opened ${target.title || 'Untitled'} as a reference.` };
  }, [navigateView, noteListHidden, notes, recordUsage, selectedId, selectedNote, setNoteListVisible, storage, storageKey]);

  const closePane = useCallback(() => {
    setOpen(false);
    if (restoreNoteListRef.current) {
      restoreNoteListRef.current = false;
      setNoteListVisible(true);
    }
  }, [setNoteListVisible]);

  const selectNote = useCallback((nextNoteId) => {
    const target = notes.find(note => note.id === nextNoteId);
    if (!target) return;
    setNoteId(target.id);
    storage?.setJson?.(storageKey, target.id);
    recordUsage('reference_pane', 'used');
  }, [notes, recordUsage, storage, storageKey]);

  useEffect(() => {
    if (restoreNoteListRef.current) setNoteListVisible(true);
    setOpen(false);
    setNoteId(storage?.getJson?.(storageKey, '') || '');
    restoreNoteListRef.current = false;
  }, [activeVaultId, setNoteListVisible, storage, storageKey]);

  return { open, noteId, openPane, closePane, selectNote };
}
