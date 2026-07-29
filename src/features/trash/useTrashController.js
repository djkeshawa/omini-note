const { useCallback, useEffect, useRef, useState } = React;

export function useTrashController({
  activeVaultId,
  view,
  hasDisk,
  platform,
  normalizeNote,
  summarizeCanvas,
  upsertCanvasList,
  setNotes,
  setVaults,
  setCanvases,
  setActiveCanvas,
  setSelectedId,
  setSelectedTag,
  setSelectedWorkflow,
  navigateView,
  showNotice,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadSequence = useRef(0);
  const activeVaultIdRef = useRef(activeVaultId);
  activeVaultIdRef.current = activeVaultId;

  const list = useCallback(async () => {
    if (!hasDisk || !activeVaultId) return [];
    const [noteResponse, canvasResponse] = await Promise.all([
      platform.notes.listDeletedNotes(activeVaultId),
      platform.canvas.listDeletedCanvases ? platform.canvas.listDeletedCanvases(activeVaultId) : Promise.resolve({ ok: true, value: [] }),
    ]);
    if (!noteResponse.ok) throw new Error(noteResponse.error || 'Could not load deleted notes');
    if (!canvasResponse.ok) throw new Error(canvasResponse.error || 'Could not load deleted canvases');
    return [...(noteResponse.value || []), ...(canvasResponse.value || [])]
      .sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
  }, [activeVaultId, hasDisk, platform]);

  const refresh = useCallback(async () => {
    const requestVaultId = activeVaultId;
    const requestId = ++loadSequence.current;
    setLoading(true);
    setError('');
    try {
      const next = await list();
      if (requestId === loadSequence.current && requestVaultId === activeVaultIdRef.current) setItems(next);
      return next;
    } catch (loadError) {
      if (requestId === loadSequence.current && requestVaultId === activeVaultIdRef.current) setError(loadError.message || String(loadError));
      return [];
    } finally {
      if (requestId === loadSequence.current && requestVaultId === activeVaultIdRef.current) setLoading(false);
    }
  }, [activeVaultId, list]);

  const restore = useCallback(async (itemOrTrashId) => {
    const trashId = typeof itemOrTrashId === 'string' ? itemOrTrashId : itemOrTrashId?.trashId;
    const sourceType = typeof itemOrTrashId === 'object' ? itemOrTrashId?.sourceType : 'note';
    if (!hasDisk || !activeVaultId || !trashId) return { ok: false, error: 'No active vault.' };
    const requestVaultId = activeVaultId;
    try {
      if (sourceType === 'canvas') {
        const response = await platform.canvas.restoreDeletedCanvas(requestVaultId, trashId);
        if (!response.ok) throw new Error(response.error || 'Could not restore canvas');
        const restored = summarizeCanvas(response.value);
        setVaults(current => current.map(vault => vault.id === requestVaultId
          ? { ...vault, canvases: upsertCanvasList(vault.canvases || [], restored) }
          : vault));
        if (requestVaultId === activeVaultIdRef.current) {
          setCanvases(current => upsertCanvasList(current, restored));
          setActiveCanvas(response.value);
          navigateView('canvas');
          setItems(current => current.filter(item => item.trashId !== trashId));
        }
        return { ok: true, canvas: response.value };
      }
      const response = await platform.notes.restoreDeletedNote(requestVaultId, trashId);
      if (!response.ok) throw new Error(response.error || 'Could not restore note');
      const restored = normalizeNote(response.value);
      if (!restored) throw new Error('Restored note could not be loaded');
      setVaults(current => current.map(vault => vault.id === requestVaultId && Array.isArray(vault.notes)
        ? { ...vault, notes: [restored, ...vault.notes.filter(note => note.id !== restored.id)] }
        : vault));
      if (requestVaultId === activeVaultIdRef.current) {
        setNotes(current => [restored, ...current.filter(note => note.id !== restored.id)]);
        setSelectedId(restored.id);
        setSelectedTag(null);
        setSelectedWorkflow(null);
        navigateView('notes');
        setItems(current => current.filter(item => item.trashId !== trashId));
      }
      return { ok: true, note: restored };
    } catch (restoreError) {
      console.error('restoreDeletedNote failed', restoreError);
      if (requestVaultId === activeVaultIdRef.current) {
        showNotice('Could not restore note', restoreError.message || String(restoreError));
      }
      return { ok: false, error: restoreError.message || String(restoreError) };
    }
  }, [activeVaultId, hasDisk, navigateView, normalizeNote, platform, setActiveCanvas, setCanvases, setNotes, setSelectedId, setSelectedTag, setSelectedWorkflow, setVaults, showNotice, summarizeCanvas, upsertCanvasList]);

  const purge = useCallback(async (itemOrTrashId) => {
    const trashId = typeof itemOrTrashId === 'string' ? itemOrTrashId : itemOrTrashId?.trashId;
    const sourceType = typeof itemOrTrashId === 'object' ? itemOrTrashId?.sourceType : 'note';
    if (!hasDisk || !activeVaultId || !trashId) return { ok: false, error: 'No active vault.' };
    const requestVaultId = activeVaultId;
    try {
      const response = sourceType === 'canvas' && platform.canvas.purgeDeletedCanvas
        ? await platform.canvas.purgeDeletedCanvas(requestVaultId, trashId)
        : await platform.notes.purgeDeletedNote(requestVaultId, trashId);
      if (!response.ok) throw new Error(response.error || `Could not permanently delete ${sourceType === 'canvas' ? 'canvas' : 'note'}`);
      if (requestVaultId === activeVaultIdRef.current) {
        setItems(current => current.filter(item => item.trashId !== trashId));
      }
      return { ok: true };
    } catch (purgeError) {
      console.error('purgeDeletedNote failed', purgeError);
      if (requestVaultId === activeVaultIdRef.current) {
        showNotice('Could not permanently delete note', purgeError.message || String(purgeError));
      }
      return { ok: false, error: purgeError.message || String(purgeError) };
    }
  }, [activeVaultId, hasDisk, platform, showNotice]);

  const prepend = useCallback((item) => {
    if (!item?.trashId) return;
    setItems(current => [item, ...current.filter(existing => existing.trashId !== item.trashId)]);
  }, []);

  useEffect(() => {
    loadSequence.current++;
    setItems([]);
    setLoading(false);
    setError('');
    if (!activeVaultId) {
      return;
    }
    if (view === 'trash') refresh();
  }, [activeVaultId, refresh, view]);

  return { items, loading, error, list, refresh, restore, purge, prepend };
}
