(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function clearCanvasFilters(ctx = {}) {
    ctx.setSelectedTag?.(null);
    ctx.setSelectedWorkflow?.(null);
    ctx.setQuery?.('');
  }

  function cacheCanvases(nextCanvases = [], ctx = {}) {
    ctx.setCanvases(nextCanvases);
    ctx.setVaults(current => (current || []).map(vault =>
      vault.id === ctx.activeVaultId ? { ...vault, canvases: nextCanvases } : vault
    ));
  }

  function upsertCanvasSummary(canvas, ctx = {}) {
    const upsertCanvasList = ctx.upsertCanvasList;
    ctx.setCanvases(current => upsertCanvasList(current, canvas));
    ctx.setVaults(current => (current || []).map(vault =>
      vault.id === ctx.activeVaultId
        ? { ...vault, canvases: upsertCanvasList(vault.canvases || [], canvas) }
        : vault
    ));
  }

  function openCanvasDashboard(ctx = {}) {
    ctx.setActiveCanvas(null);
    clearCanvasFilters(ctx);
    ctx.navigateView('canvas');
  }

  async function openCanvas(canvasId, ctx = {}) {
    if (!canvasId) {
      openCanvasDashboard(ctx);
      return null;
    }

    let canvas = null;
    if (ctx.hasDisk && ctx.activeVaultId) {
      try {
        const res = await ctx.mn.canvas.getCanvas(ctx.activeVaultId, canvasId);
        if (!res.ok) throw new Error(res.error);
        canvas = res.value;
      } catch (e) {
        ctx.logError?.('getCanvas failed', canvasId, e);
      }
    } else {
      canvas = (ctx.canvases || []).find(item => item.id === canvasId) || null;
    }

    if (!canvas) return null;
    ctx.setActiveCanvas(canvas);
    clearCanvasFilters(ctx);
    ctx.navigateView('canvas');
    return canvas;
  }

  function defaultNewCanvas(title = 'Untitled canvas') {
    const now = new Date().toISOString();
    return {
      id: `c_${Date.now().toString(36)}`,
      title,
      createdAt: now,
      modifiedAt: now,
      viewport: { x: 0, y: 0, scale: 1 },
      elements: [],
    };
  }

  async function createCanvas(title = 'Untitled canvas', options = {}, ctx = {}) {
    const makeCanvas = ctx.newCanvas || defaultNewCanvas;
    const initial = makeCanvas(title);
    let saved = initial;

    if (ctx.hasDisk && ctx.activeVaultId) {
      try {
        const res = await ctx.mn.canvas.saveCanvas(ctx.activeVaultId, initial);
        if (!res.ok) throw new Error(res.error);
        saved = res.value;
      } catch (e) {
        ctx.logError?.('saveCanvas failed', e);
        ctx.showAppNotice('Could not create canvas', e.message || String(e));
        return null;
      }
    }

    upsertCanvasSummary(saved, ctx);
    if (options.open !== false) {
      ctx.setActiveCanvas(saved);
      clearCanvasFilters(ctx);
      ctx.navigateView('canvas');
    }
    return saved;
  }

  async function saveCanvas(canvas, ctx = {}) {
    if (!canvas?.id) return null;
    let saved = canvas;

    if (ctx.hasDisk && ctx.activeVaultId) {
      try {
        const res = await ctx.mn.canvas.saveCanvas(ctx.activeVaultId, canvas);
        if (!res.ok) throw new Error(res.error);
        saved = res.value;
      } catch (e) {
        ctx.logError?.('saveCanvas failed', canvas.id, e);
        ctx.showAppNotice('Could not save canvas', e.message || String(e));
        return null;
      }
    }

    ctx.setActiveCanvas(current => current?.id === saved.id ? saved : current);
    upsertCanvasSummary(saved, ctx);
    return saved;
  }

  async function deleteCanvas(canvasId, ctx = {}) {
    if (!canvasId) return null;

    if (ctx.hasDisk && ctx.activeVaultId) {
      try {
        const res = await ctx.mn.canvas.deleteCanvas(ctx.activeVaultId, canvasId);
        if (!res.ok) throw new Error(res.error);
      } catch (e) {
        ctx.logError?.('deleteCanvas failed', canvasId, e);
        ctx.showAppNotice('Could not delete canvas', e.message || String(e));
        return null;
      }
    }

    const next = (ctx.canvases || []).filter(canvas => canvas.id !== canvasId);
    cacheCanvases(next, ctx);
    if (ctx.activeCanvas?.id === canvasId) ctx.setActiveCanvas(null);
    ctx.navigateView('canvas');
    return { ok: true, canvases: next };
  }

  return {
    cacheCanvases,
    upsertCanvasSummary,
    openCanvasDashboard,
    openCanvas,
    createCanvas,
    saveCanvas,
    deleteCanvas,
  };
});
