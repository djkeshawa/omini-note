import LATEST_WRITE_QUEUE from '../../shared/latestWriteQueue.js';

const { createLatestWriteQueue } = LATEST_WRITE_QUEUE;
const { useCallback, useRef } = React;

export function useCanvasController({
  activeVaultId,
  activeCanvas,
  canvases,
  notes,
  hasDisk,
  platform,
  canvasActions,
  canvasModel,
  newCanvas,
  upsertCanvasList,
  setCanvases,
  setVaults,
  setActiveCanvas,
  setSelectedTag,
  setSelectedWorkflow,
  setQuery,
  navigateView,
  showNotice,
}) {
  const writeQueueRef = useRef(null);
  const deletingKeysRef = useRef(new Set());
  const diskRevisionRef = useRef(new Map());
  const failedWritesRef = useRef(new Map());
  const openSequenceRef = useRef(0);
  const activeVaultIdRef = useRef(activeVaultId);
  if (!writeQueueRef.current) writeQueueRef.current = createLatestWriteQueue();
  activeVaultIdRef.current = activeVaultId;
  for (const canvas of [...(canvases || []), ...(activeCanvas ? [activeCanvas] : [])]) {
    if (activeVaultId && canvas?.id && canvas.diskRevision) {
      diskRevisionRef.current.set(`${activeVaultId}:${canvas.id}`, canvas.diskRevision);
    }
  }

  const actionContext = useCallback((overrides = {}) => ({
    activeVaultId,
    activeCanvas,
    canvases,
    hasDisk,
    mn: platform,
    newCanvas,
    upsertCanvasList,
    setCanvases,
    setVaults,
    setActiveCanvas,
    setSelectedTag,
    setSelectedWorkflow,
    setQuery,
    navigateView,
    showAppNotice: showNotice,
    logError: (...args) => console.error(...args),
    ...overrides,
  }), [activeCanvas, activeVaultId, canvases, hasDisk, navigateView, newCanvas, platform, setActiveCanvas, setCanvases, setQuery, setSelectedTag, setSelectedWorkflow, setVaults, showNotice, upsertCanvasList]);

  const openDashboard = useCallback(() => {
    openSequenceRef.current++;
    return canvasActions.openCanvasDashboard(actionContext());
  }, [actionContext, canvasActions]);

  const openCanvas = useCallback((canvasId) => {
    const requestId = ++openSequenceRef.current;
    const requestVaultId = activeVaultId;
    return canvasActions.openCanvas(canvasId, actionContext({
      isOperationCurrent: () => (
        requestId === openSequenceRef.current &&
        requestVaultId === activeVaultIdRef.current
      ),
    })).then(canvas => {
      if (canvas?.diskRevision) diskRevisionRef.current.set(`${requestVaultId}:${canvas.id}`, canvas.diskRevision);
      return canvas;
    });
  }, [activeVaultId, actionContext, canvasActions]);

  const createCanvas = useCallback(async (title = 'Untitled canvas', options = {}) => {
    const canvas = await canvasActions.createCanvas(title, options, actionContext());
    if (canvas?.diskRevision && activeVaultId) {
      diskRevisionRef.current.set(`${activeVaultId}:${canvas.id}`, canvas.diskRevision);
    }
    return canvas;
  }, [activeVaultId, actionContext, canvasActions]);

  const saveCanvas = useCallback((canvas) => {
    if (!canvas?.id || !activeVaultId) return Promise.resolve(null);
    const requestVaultId = activeVaultId;
    const key = `${requestVaultId}:${canvas.id}`;
    if (deletingKeysRef.current.has(key)) return Promise.resolve(null);
    return writeQueueRef.current.enqueue(key, canvas, async (latestCanvas, operation) => {
      if (deletingKeysRef.current.has(key)) return null;
      const expectedRevision = diskRevisionRef.current.get(key) ?? latestCanvas.diskRevision ?? null;
      const saved = await canvasActions.saveCanvas(latestCanvas, actionContext({
        activeVaultId: requestVaultId,
        expectedRevision,
        shouldCommitResult: operation.isLatest,
      }));
      if (saved?.diskRevision) {
        diskRevisionRef.current.set(key, saved.diskRevision);
        failedWritesRef.current.delete(key);
      } else if (operation.isLatest()) {
        failedWritesRef.current.set(key, latestCanvas);
      }
      return saved;
    }).then(result => result.value);
  }, [activeVaultId, actionContext, canvasActions]);

  const deleteCanvas = useCallback(async (canvasId) => {
    if (!canvasId || !activeVaultId) return null;
    const requestVaultId = activeVaultId;
    const key = `${requestVaultId}:${canvasId}`;
    deletingKeysRef.current.add(key);
    await writeQueueRef.current.flush(key);
    const result = await canvasActions.deleteCanvas(canvasId, actionContext({
      activeVaultId: requestVaultId,
      expectedRevision: diskRevisionRef.current.get(key) ?? activeCanvas?.diskRevision ?? null,
    }));
    if (result) {
      diskRevisionRef.current.delete(key);
      failedWritesRef.current.delete(key);
    }
    else deletingKeysRef.current.delete(key);
    return result;
  }, [activeCanvas?.diskRevision, activeVaultId, actionContext, canvasActions]);

  const addNote = useCallback(async (noteId, canvasId = null) => {
    const note = notes.find(item => item.id === noteId);
    if (!note || !canvasModel?.mnCanvasAddNoteCard) return { ok: false, message: 'Note not found.' };
    let target = canvasId ? canvases.find(canvas => canvas.id === canvasId) || null : null;
    if (!target && !canvasId) {
      target = [...canvases].sort((a, b) =>
        (Date.parse(b.modifiedAt || '') || 0) - (Date.parse(a.modifiedAt || '') || 0))[0] || null;
    }
    let document = null;
    if (!target) {
      document = await createCanvas('Untitled canvas', { open: false });
      if (!document) return { ok: false, message: 'Could not create a canvas.' };
    } else if (hasDisk && activeVaultId) {
      try {
        const response = await platform.canvas.getCanvas(activeVaultId, target.id);
        if (!response.ok) throw new Error(response.error);
        document = response.value;
      } catch (error) {
        return { ok: false, message: `Could not load canvas: ${error.message || String(error)}` };
      }
    } else {
      document = target;
    }
    const placed = canvasModel.mnCanvasAddNoteCard(document, note);
    const affected = [{ type: 'canvas', id: document.id, title: document.title || 'Untitled canvas' }];
    if (placed.existing) return { message: `"${note.title || 'Untitled'}" is already on "${document.title || 'Untitled canvas'}".`, affected };
    const saved = await saveCanvas(placed.canvas);
    if (!saved) return { ok: false, message: 'Could not save canvas.' };
    return {
      message: `Added "${note.title || 'Untitled'}" to "${saved.title || 'Untitled canvas'}".`,
      affected: [{ type: 'canvas', id: saved.id, title: saved.title || 'Untitled canvas' }],
    };
  }, [activeVaultId, canvases, canvasModel, createCanvas, hasDisk, notes, platform, saveCanvas]);

  return { openDashboard, openCanvas, createCanvas, saveCanvas, deleteCanvas, addNote };
}
