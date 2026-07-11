const { useCallback } = React;

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

  const openDashboard = useCallback(() => canvasActions.openCanvasDashboard(actionContext()), [actionContext, canvasActions]);
  const openCanvas = useCallback((canvasId) => canvasActions.openCanvas(canvasId, actionContext()), [actionContext, canvasActions]);
  const createCanvas = useCallback((title = 'Untitled canvas', options = {}) => canvasActions.createCanvas(title, options, actionContext()), [actionContext, canvasActions]);
  const saveCanvas = useCallback((canvas) => canvasActions.saveCanvas(canvas, actionContext()), [actionContext, canvasActions]);
  const deleteCanvas = useCallback((canvasId) => canvasActions.deleteCanvas(canvasId, actionContext()), [actionContext, canvasActions]);

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
