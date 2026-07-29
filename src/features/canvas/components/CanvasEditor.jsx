const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;
const {
  MN_CANVAS_TOOLS, MN_CANVAS_COLORS, MN_CANVAS_DEFAULT_STYLE, mnCloneCanvasState, mnCanvasId,
  mnNewCanvas, mnCanvasElement, mnCanvasNoteElement, mnCanvasNotePreview, mnCanvasDate,
  mnCanvasPreviewElements, mnCanvasCloneElement, mnCanvasBounds, mnCanvasSelectionBounds,
  mnCanvasMoveElement, mnCanvasAlign, mnCanvasDistribute, mnCanvasIsConnector,
  mnCanvasAnchorTargetAt, mnCanvasResolveConnector, mnCanvasSyncConnectors, mnCanvasCloneElements,
} = MN_CANVAS_MODEL;
import { MnCanvasNotePicker, MnCanvasActionButton, MnCanvasResizeHandles, MnCanvasContextMenu, MnCanvasDeleteDialog } from './CanvasControls.jsx';
import { MnCanvasElement } from './CanvasElements.jsx';
import { CanvasToolbar } from './CanvasToolbar.jsx';
import { CanvasOverlays } from './CanvasOverlays.jsx';
import { CanvasDialogs } from './CanvasDialogs.jsx';
import { useCanvasKeyboardShortcuts } from '../useCanvasKeyboardShortcuts.js';
import { CanvasToolDock } from './CanvasToolDock.jsx';
import { CanvasStyleBar } from './CanvasStyleBar.jsx';
import { CanvasZoomCluster } from './CanvasZoomCluster.jsx';
import { mnCanvasStageBackground } from './CanvasStyles.js';

function MnCanvasEditor({ canvas, onBack, onSave, onDelete, notes = [], onOpenNote, onTextEditingChange, T }) {
  const [draft, setDraft] = useStateC(canvas);
  const [tool, setTool] = useStateC('select');
  const [notePickerOpen, setNotePickerOpen] = useStateC(false);
  // The note card sits after a divider, as the prototype has it — it places
  // something that already exists rather than drawing something new.
  const dockTools = useMemoC(() => (
    (notes || []).length
      ? [...MN_CANVAS_TOOLS, { id: 'note', label: 'Note card', divider: true }]
      : MN_CANVAS_TOOLS
  ), [notes]);
  const [titleFocused, setTitleFocused] = useStateC(false);
  const [selectedIds, setSelectedIds] = useStateC([]);
  const [style, setStyle] = useStateC(MN_CANVAS_DEFAULT_STYLE);
  const [contextMenu, setContextMenu] = useStateC(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useStateC(false);
  const [editingTextId, setEditingTextId] = useStateC(null);
  const [spaceDown, setSpaceDown] = useStateC(false);
  const [marquee, setMarquee] = useStateC(null);
  const [historyVersion, setHistoryVersion] = useStateC(0);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useStateC(false);
  const draftRef = useRefC(canvas);
  const actionRef = useRefC(null);
  const clipboardRef = useRefC([]);
  const undoRef = useRefC([]);
  const redoRef = useRefC([]);
  const svgRef = useRefC(null);
  const rootRef = useRefC(null);
  const toolbarMenuRef = useRefC(null);
  const selectedIdsRef = useRefC([]);
  const handlersRef = useRefC({});
  const viewportSaveTimerRef = useRefC(null);
  const onSaveRef = useRefC(onSave);
  onSaveRef.current = onSave;

  const selectedElement = (draft.elements || []).find(el => el.id === selectedIds[0]) || null;
  const selectedElements = (draft.elements || []).filter(el => selectedIds.includes(el.id));
  const editingElement = (draft.elements || []).find(el => el.id === editingTextId) || null;
  const selectionBounds = mnCanvasSelectionBounds(selectedElements);
  const canUndo = historyVersion >= 0 && undoRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoRef.current.length > 0;

  const setDraftLocal = (next) => {
    draftRef.current = next;
    setDraft(next);
  };

  const saveCanvasNow = (next) => {
    if (viewportSaveTimerRef.current) {
      clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    return onSaveRef.current?.(next);
  };

  useEffectC(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffectC(() => {
    if (!toolbarMenuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!toolbarMenuRef.current?.contains?.(e.target)) setToolbarMenuOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setToolbarMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toolbarMenuOpen]);

  useEffectC(() => {
    draftRef.current = canvas;
    setDraft(canvas);
    setSelectedIds([]);
    setTool('select');
    setContextMenu(null);
    setDeleteDialogOpen(false);
    setEditingTextId(null);
    setMarquee(null);
    setToolbarMenuOpen(false);
    undoRef.current = [];
    redoRef.current = [];
    setHistoryVersion(v => v + 1);
  }, [canvas?.id]);

  useEffectC(() => () => {
    if (!viewportSaveTimerRef.current) return;
    clearTimeout(viewportSaveTimerRef.current);
    viewportSaveTimerRef.current = null;
    onSaveRef.current?.(draftRef.current);
  }, [canvas?.id]);

  const rememberCanvas = () => {
    undoRef.current.push(mnCloneCanvasState(draftRef.current));
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
    setHistoryVersion(v => v + 1);
  };

  const persistCanvas = (next, options = {}) => {
    if (options.history !== false) rememberCanvas();
    const saved = { ...next, modifiedAt: new Date().toISOString() };
    setDraftLocal(saved);
    saveCanvasNow(saved);
    return saved;
  };

  // persist may be `true` or persistCanvas options — `{ history: false }`
  // saves to disk without spending an undo entry, which is what viewport
  // moves and mid-drag style updates want.
  const updateDraft = (updater, persist = false) => {
    const prev = draftRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (persist) return persistCanvas(next, typeof persist === 'object' ? persist : {});
    setDraftLocal(next);
    return next;
  };

  const noteById = useMemoC(() => new Map((notes || []).map(n => [n.id, n])), [notes]);
  const elementById = useMemoC(() => new Map((draft.elements || []).map(el => [el.id, el])), [draft.elements]);

  // Tell the app when a canvas text box (element text or title) is being
  // edited so floating notifications hold instead of covering the input.
  const textEditingActive = !!editingTextId || titleFocused;
  useEffectC(() => {
    onTextEditingChange?.(textEditingActive);
  }, [textEditingActive]);
  useEffectC(() => () => { onTextEditingChange?.(false); }, []);

  // Places a live note card at the center of the current viewport.
  const addNoteCard = (note) => {
    if (!note?.id || !mnCanvasNoteElement) return;
    const rect = svgRef.current?.getBoundingClientRect?.();
    const vp = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    const scale = vp.scale || 1;
    const point = {
      x: ((rect?.width || 900) / 2 - (vp.x || 0)) / scale - 125,
      y: ((rect?.height || 600) / 2 - (vp.y || 0)) / scale - 75,
    };
    const element = mnCanvasNoteElement(point, note);
    persistCanvas({ ...draftRef.current, elements: [...(draftRef.current.elements || []), element] });
    setSelectedIds([element.id]);
    setNotePickerOpen(false);
    setTool('select');
  };

  const undoCanvas = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(mnCloneCanvasState(draftRef.current));
    const restored = { ...previous, modifiedAt: new Date().toISOString() };
    setDraftLocal(restored);
    saveCanvasNow(restored);
    setSelectedIds([]);
    setContextMenu(null);
    setEditingTextId(null);
    setHistoryVersion(v => v + 1);
  };

  const redoCanvas = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(mnCloneCanvasState(draftRef.current));
    const restored = { ...next, modifiedAt: new Date().toISOString() };
    setDraftLocal(restored);
    saveCanvasNow(restored);
    setSelectedIds([]);
    setContextMenu(null);
    setEditingTextId(null);
    setHistoryVersion(v => v + 1);
  };

  const saveTitle = () => {
    persistCanvas({
      ...draftRef.current,
      title: (draftRef.current.title || '').trim() || 'Untitled canvas',
    });
  };

  const toCanvasPoint = (event) => {
    const svg = svgRef.current;
    const viewport = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    if (svg?.createSVGPoint && svg?.getScreenCTM) {
      const screenMatrix = svg.getScreenCTM();
      if (screenMatrix) {
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const svgPoint = point.matrixTransform(screenMatrix.inverse());
        return {
          x: (svgPoint.x - viewport.x) / viewport.scale,
          y: (svgPoint.y - viewport.y) / viewport.scale,
        };
      }
    }
    const rect = svg.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - viewport.x) / viewport.scale,
      y: (event.clientY - rect.top - viewport.y) / viewport.scale,
    };
  };

  const canvasPointToScreen = (point) => {
    const viewport = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    return {
      x: point.x * viewport.scale + viewport.x,
      y: point.y * viewport.scale + viewport.y,
    };
  };

  const currentSelectionIds = () => selectedIds.length ? selectedIds : [];

  const updateElementById = (id, patch, persist = false) => {
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => el.id === id ? { ...el, ...patch } : el),
    }), persist);
  };

  const removeElements = (ids) => {
    if (!ids.length) return;
    updateDraft(prev => {
      const kept = (prev.elements || []).filter(el => !ids.includes(el.id));
      return { ...prev, elements: mnCanvasSyncConnectors ? mnCanvasSyncConnectors(kept) : kept };
    }, true);
    setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
    setContextMenu(null);
  };

  const copyElements = async (ids = currentSelectionIds(), cut = false) => {
    const elements = (draftRef.current.elements || []).filter(el => ids.includes(el.id));
    if (!elements.length) return false;
    clipboardRef.current = elements;
    try {
      await navigator.clipboard?.writeText?.(JSON.stringify({ type: 'omini/canvas-elements', elements }));
    } catch (e) {}
    if (cut) removeElements(ids);
    setContextMenu(null);
    return true;
  };

  const readClipboardElements = async () => {
    try {
      const raw = await navigator.clipboard?.readText?.();
      const parsed = JSON.parse(raw || '');
      if (parsed?.type === 'omini/canvas-elements' && Array.isArray(parsed.elements)) {
        return parsed.elements.filter(el => el && typeof el === 'object' && el.id && el.type);
      }
    } catch (e) {}
    return clipboardRef.current || [];
  };

  const pasteElements = async () => {
    const elements = await readClipboardElements();
    if (!elements.length) return;
    const clones = mnCanvasCloneElements
      ? mnCanvasCloneElements(elements)
      : elements.map(el => mnCanvasCloneElement(el));
    updateDraft(prev => ({ ...prev, elements: [...(prev.elements || []), ...clones] }), true);
    setSelectedIds(clones.map(el => el.id));
    setContextMenu(null);
  };

  handlersRef.current = { undoCanvas, redoCanvas, removeElements, copyElements, pasteElements };

  const applyColor = (key, value) => {
    setStyle(prev => ({ ...prev, [key]: value }));
    if (!selectedIds.length) return;
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => selectedIds.includes(el.id) ? { ...el, [key]: value } : el),
    }), true);
  };

  // Dragging the width slider fires once per step. History is captured once,
  // at the start of the drag, so the whole gesture is one undo entry instead
  // of nine — and nine saves becomes saves-per-step with no history cost.
  const beginStrokeWidthEdit = () => {
    if (selectedIds.length) rememberCanvas();
  };

  const applyStrokeWidth = (value) => {
    const width = Number(value) || 1;
    setStyle(prev => ({ ...prev, strokeWidth: width }));
    if (!selectedIds.length) return;
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => selectedIds.includes(el.id) ? { ...el, strokeWidth: width } : el),
    }), { history: false });
  };

  const editText = (el) => {
    if (!['text', 'sticky'].includes(el.type)) return;
    rememberCanvas();
    setSelectedIds([el.id]);
    setEditingTextId(el.id);
  };

  const alignSelected = (mode) => {
    if (selectedElements.length < 2) return;
    updateDraft(prev => ({
      ...prev,
      elements: mnCanvasAlign(prev.elements || [], selectedIds, mode),
    }), true);
  };

  const distributeSelected = (axis) => {
    if (selectedElements.length < 3) return;
    updateDraft(prev => ({
      ...prev,
      elements: mnCanvasDistribute(prev.elements || [], selectedIds, axis),
    }), true);
  };

  const setZoom = (nextScale) => {
    const current = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    const scale = Math.max(0.25, Math.min(3, nextScale));
    // Where you are looking is not something to undo. The wheel-zoom path
    // already skips history; the buttons now match it.
    updateDraft(prev => ({ ...prev, viewport: { ...current, scale } }), { history: false });
  };

  const fitToScreen = () => {
    const bounds = mnCanvasSelectionBounds(draftRef.current.elements || []);
    const rect = svgRef.current?.getBoundingClientRect?.();
    if (!bounds || !rect) return;
    const pad = 80;
    const scale = Math.max(0.25, Math.min(2.5, Math.min(
      (rect.width - pad) / Math.max(1, bounds.w),
      (rect.height - pad) / Math.max(1, bounds.h)
    )));
    updateDraft(prev => ({
      ...prev,
      viewport: {
        scale,
        x: rect.width / 2 - (bounds.x + bounds.w / 2) * scale,
        y: rect.height / 2 - (bounds.y + bounds.h / 2) * scale,
      },
    }), { history: false });
  };
  handlersRef.current.fitToScreen = fitToScreen;

  const beginCreate = (e, point) => {
    if (tool === 'eraser') return;
    const element = mnCanvasElement(tool, point, style);
    rememberCanvas();
    if (tool === 'text' || tool === 'sticky') {
      updateDraft(prev => ({ ...prev, elements: [...(prev.elements || []), element] }), false);
      persistCanvas(draftRef.current, { history: false });
      setSelectedIds([element.id]);
      setEditingTextId(element.id);
      return;
    }
    updateDraft(prev => ({ ...prev, elements: [...(prev.elements || []), element] }), false);
    setSelectedIds([element.id]);
    actionRef.current = { mode: 'create', id: element.id, type: tool, start: point };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onStageDown = (e) => {
    rootRef.current?.focus();
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      actionRef.current = {
        mode: 'pan',
        startClient: { x: e.clientX, y: e.clientY },
        viewport: { ...(draftRef.current.viewport || { x: 0, y: 0, scale: 1 }) },
      };
      svgRef.current?.setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      setSelectedIds([]);
      setContextMenu({ kind: 'stage', x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button !== 0 || e.target !== svgRef.current) return;
    const point = toCanvasPoint(e);
    setContextMenu(null);
    setSelectedIds([]);
    if (tool !== 'select') beginCreate(e, point);
    if (tool === 'select') {
      actionRef.current = { mode: 'marquee', start: point };
      setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
      svgRef.current?.setPointerCapture?.(e.pointerId);
    }
  };

  const onElementDown = (e, el) => {
    e.stopPropagation();
    rootRef.current?.focus();
    if (e.button === 0 && tool === 'eraser') {
      removeElements([el.id]);
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      const ids = selectedIds.includes(el.id) ? selectedIds : [el.id];
      setSelectedIds(ids);
      setContextMenu({ kind: 'element', id: el.id, ids, x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button === 0 && tool !== 'select') {
      setContextMenu(null);
      setSelectedIds([]);
      beginCreate(e, toCanvasPoint(e));
      return;
    }
    if (e.button !== 0 || tool !== 'select') return;
    setContextMenu(null);
    if (e.shiftKey) {
      setSelectedIds(prev => prev.includes(el.id) ? prev.filter(id => id !== el.id) : [...prev, el.id]);
      return;
    }
    rememberCanvas();
    const actionIds = selectedIds.includes(el.id) ? selectedIds : [el.id];
    setSelectedIds(actionIds);
    const point = toCanvasPoint(e);
    actionRef.current = {
      mode: 'move',
      ids: actionIds,
      start: point,
      originals: (draftRef.current.elements || [])
        .filter(item => actionIds.includes(item.id))
        .map(item => ({ ...item, points: Array.isArray(item.points) ? item.points.map(p => ({ ...p })) : null })),
    };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onResizeDown = (e, handle) => {
    if (!selectedElement || selectedIds.length !== 1) return;
    e.stopPropagation();
    e.preventDefault();
    rememberCanvas();
    actionRef.current = {
      mode: 'resize',
      id: selectedElement.id,
      handle,
      start: toCanvasPoint(e),
      original: { ...selectedElement },
    };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const updateCreateAction = (action, point) => {
    if (action.type === 'line' || action.type === 'arrow') {
      updateElementById(action.id, { x2: point.x, y2: point.y }, false);
      return;
    }
    if (action.type === 'pen') {
      updateElementById(action.id, {
        points: [...((draftRef.current.elements || []).find(el => el.id === action.id)?.points || []), point],
      }, false);
      return;
    }
    updateElementById(action.id, {
      x: Math.min(action.start.x, point.x),
      y: Math.min(action.start.y, point.y),
      w: Math.max(1, Math.abs(point.x - action.start.x)),
      h: Math.max(1, Math.abs(point.y - action.start.y)),
    }, false);
  };

  const updateMoveAction = (action, point) => {
    const dx = point.x - action.start.x;
    const dy = point.y - action.start.y;
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => {
        const original = (action.originals || []).find(item => item.id === el.id);
        if (!original) return el;
        return mnCanvasMoveElement(original, dx, dy);
      }),
    }), false);
  };

  const updateResizeAction = (action, point) => {
    const original = action.original;
    if (!original || ['line', 'arrow', 'pen'].includes(original.type)) return;
    const dx = point.x - action.start.x;
    const dy = point.y - action.start.y;
    let x = original.x;
    let y = original.y;
    let w = original.w || 1;
    let h = original.h || 1;
    if (action.handle.includes('e')) w = Math.max(12, original.w + dx);
    if (action.handle.includes('s')) h = Math.max(12, original.h + dy);
    if (action.handle.includes('w')) {
      x = Math.min(original.x + original.w - 12, original.x + dx);
      w = Math.max(12, original.w - dx);
    }
    if (action.handle.includes('n')) {
      y = Math.min(original.y + original.h - 12, original.y + dy);
      h = Math.max(12, original.h - dy);
    }
    updateElementById(action.id, { x, y, w, h }, false);
  };

  const onPointerMove = (e) => {
    const action = actionRef.current;
    if (!action) return;
    if (action.mode === 'pan') {
      const dx = e.clientX - action.startClient.x;
      const dy = e.clientY - action.startClient.y;
      updateDraft(prev => ({ ...prev, viewport: { ...action.viewport, x: action.viewport.x + dx, y: action.viewport.y + dy } }), false);
      return;
    }
    const point = toCanvasPoint(e);
    if (action.mode === 'create') updateCreateAction(action, point);
    if (action.mode === 'move') updateMoveAction(action, point);
    if (action.mode === 'resize') updateResizeAction(action, point);
    if (action.mode === 'marquee') {
      setMarquee({
        x: Math.min(action.start.x, point.x),
        y: Math.min(action.start.y, point.y),
        w: Math.abs(point.x - action.start.x),
        h: Math.abs(point.y - action.start.y),
      });
    }
  };

  const finishPointerAction = (e) => {
    const action = actionRef.current;
    if (!action) return;
    actionRef.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    if (action.mode === 'marquee') {
      const point = toCanvasPoint(e);
      const box = {
        x: Math.min(action.start.x, point.x),
        y: Math.min(action.start.y, point.y),
        w: Math.abs(point.x - action.start.x),
        h: Math.abs(point.y - action.start.y),
      };
      setMarquee(null);
      if (box && (box.w > 3 || box.h > 3)) {
        const hits = (draftRef.current.elements || []).filter(el => {
          const b = mnCanvasBounds(el);
          return b.x <= box.x + box.w && b.x + b.w >= box.x && b.y <= box.y + box.h && b.y + b.h >= box.y;
        });
        setSelectedIds(hits.map(el => el.id));
      }
      return;
    }
    // A connector released over cards anchors to them; anchored connectors
    // then keep their stored endpoints in sync with the elements they follow.
    if (action.mode === 'create' && (action.type === 'line' || action.type === 'arrow') && mnCanvasAnchorTargetAt) {
      const el = (draftRef.current.elements || []).find(item => item.id === action.id);
      if (el) {
        const startHit = mnCanvasAnchorTargetAt(draftRef.current.elements, { x: el.x, y: el.y }, el.id);
        const endHit = mnCanvasAnchorTargetAt(draftRef.current.elements, { x: el.x2, y: el.y2 }, el.id);
        if ((startHit || endHit) && startHit?.id !== endHit?.id) {
          updateDraft(prev => ({
            ...prev,
            elements: (prev.elements || []).map(item => item.id === el.id
              ? { ...item, startAnchorId: startHit?.id || null, endAnchorId: endHit?.id || null }
              : item),
          }), false);
        }
      }
    }
    if (mnCanvasSyncConnectors) {
      updateDraft(prev => ({ ...prev, elements: mnCanvasSyncConnectors(prev.elements || []) }), false);
    }
    persistCanvas(draftRef.current, { history: false });
  };

  const onWheel = (e) => {
    e.preventDefault();
    const current = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    const nextScale = Math.max(0.45, Math.min(2.2, current.scale + (e.deltaY > 0 ? -0.08 : 0.08)));
    const saved = { ...draftRef.current, viewport: { ...current, scale: nextScale }, modifiedAt: new Date().toISOString() };
    setDraftLocal(saved);
    if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
    viewportSaveTimerRef.current = setTimeout(() => {
      viewportSaveTimerRef.current = null;
      onSaveRef.current?.(draftRef.current);
    }, 150);
  };

  // The delete-confirm dialog focuses a button, which the INPUT/TEXTAREA
  // guard inside the hook does not catch — so Backspace and Ctrl+Z were still
  // deleting and mutating the board behind the modal.
  const modalOpenRef = useRefC(false);
  modalOpenRef.current = deleteDialogOpen || notePickerOpen;
  useCanvasKeyboardShortcuts({ rootRef, handlersRef, selectedIdsRef, setSpaceDown, modalOpenRef });

  const viewport = draft.viewport || { x: 0, y: 0, scale: 1 };
  const activeStroke = selectedElement?.stroke || style.stroke;
  const activeFill = selectedElement?.fill || style.fill;
  const activeStrokeWidth = selectedElement?.strokeWidth || style.strokeWidth;
  const editingOrigin = editingElement ? canvasPointToScreen({ x: editingElement.x || 0, y: editingElement.y || 0 }) : null;
  const showSelectionUi = tool === 'select';
  const runToolbarMenuCommand = async (command) => {
    await command?.();
    setToolbarMenuOpen(false);
    rootRef.current?.focus?.();
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        background: T.bg,
        display: 'flex',
        flexDirection: 'column',
        color: T.ink,
        outline: 'none',
        position: 'relative',
      }}
      onMouseDown={() => rootRef.current?.focus()}>
      <CanvasToolbar
        T={T}
        saveTitle={saveTitle}
        onBack={onBack}
        draft={draft}
        updateDraft={updateDraft}
        setTitleFocused={setTitleFocused}
        canvas={canvas}
        selectedIds={selectedIds}
        setDeleteDialogOpen={setDeleteDialogOpen}
        undoCanvas={undoCanvas}
        canUndo={canUndo}
        canRedo={canRedo}
        redoCanvas={redoCanvas}
        toolbarMenuRef={toolbarMenuRef}
        setToolbarMenuOpen={setToolbarMenuOpen}
        toolbarMenuOpen={toolbarMenuOpen}
        runToolbarMenuCommand={runToolbarMenuCommand}
        alignSelected={alignSelected}
        distributeSelected={distributeSelected}
        currentSelectionIds={currentSelectionIds}
        copyElements={copyElements}
        pasteElements={pasteElements}
        removeElements={removeElements}
      />
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(180deg, ${T.bgSub}, ${T.bg})`,
      }}>
        <CanvasStyleBar
          strokeColors={MN_CANVAS_COLORS.slice(0, 6)}
          fillColors={MN_CANVAS_COLORS.slice(6)}
          activeStroke={activeStroke}
          activeFill={activeFill}
          activeStrokeWidth={activeStrokeWidth}
          applyColor={applyColor}
          applyStrokeWidth={applyStrokeWidth}
          beginStrokeWidthEdit={beginStrokeWidthEdit}
          selectedIds={selectedIds}
          alignSelected={alignSelected}
          removeElements={removeElements}
          T={T}
        />
        <CanvasZoomCluster
          scale={viewport.scale || 1}
          onZoomIn={() => setZoom((viewport.scale || 1) + 0.15)}
          onZoomOut={() => setZoom((viewport.scale || 1) - 0.15)}
          onFit={fitToScreen}
          fitDisabled={!(draft.elements || []).length}
          T={T}
        />
        <CanvasToolDock
          tools={dockTools}
          tool={tool}
          onSelect={id => (id === 'note' ? setNotePickerOpen(v => !v) : setTool(id))}
          T={T}
        />
        <svg
          ref={svgRef}
          data-mn-canvas-stage="true"
          onPointerDown={onStageDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointerAction}
          onPointerCancel={finishPointerAction}
          onPointerLeave={finishPointerAction}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={onWheel}
          width="100%"
          height="100%"
          style={{
            display: 'block',
            cursor: spaceDown ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'not-allowed' : 'crosshair',
            background: mnCanvasStageBackground(T, 28),
          }}>
          <g transform={`translate(${viewport.x || 0} ${viewport.y || 0}) scale(${viewport.scale || 1})`}>
            {(draft.elements || []).map(el => {
              const anchored = mnCanvasIsConnector?.(el) && (el.startAnchorId || el.endAnchorId) && mnCanvasResolveConnector;
              const display = anchored ? { ...el, ...mnCanvasResolveConnector(el, elementById) } : el;
              return (
                <MnCanvasElement
                  key={el.id}
                  element={display}
                  note={el.type === 'note' ? noteById.get(el.noteId) : null}
                  selected={showSelectionUi && selectedIds.includes(el.id)}
                  onPointerDown={(e) => onElementDown(e, el)}
                  onDoubleClick={() => (el.type === 'note' ? (onOpenNote && onOpenNote(el.noteId)) : editText(el))}
                  T={T}
                />
              );
            })}
            {showSelectionUi && selectedIds.length > 1 && selectionBounds && (
              <rect
                x={selectionBounds.x - 6}
                y={selectionBounds.y - 6}
                width={selectionBounds.w + 12}
                height={selectionBounds.h + 12}
                fill="none"
                stroke={T.accent}
                strokeDasharray="5 4"
                strokeWidth="1.2"
                pointerEvents="none"
              />
            )}
            {showSelectionUi && selectedIds.length === 1 && selectedElement && !['line', 'arrow', 'pen'].includes(selectedElement.type) && (
              <MnCanvasResizeHandles bounds={mnCanvasBounds(selectedElement)} onPointerDown={onResizeDown} T={T} />
            )}
            {marquee && (
              <rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                fill={`color-mix(in oklab, ${T.accent} 10%, transparent)`}
                stroke={T.accent}
                strokeDasharray="4 3"
                strokeWidth="1"
                pointerEvents="none"
              />
            )}
          </g>
        </svg>
        <CanvasOverlays
          editingElement={editingElement}
          editingOrigin={editingOrigin}
          updateElementById={updateElementById}
          setEditingTextId={setEditingTextId}
          persistCanvas={persistCanvas}
          draftRef={draftRef}
          viewport={viewport}
          T={T}
          tool={tool}
          contextMenu={contextMenu}
          copyElements={copyElements}
          currentSelectionIds={currentSelectionIds}
          pasteElements={pasteElements}
          removeElements={removeElements}
          setContextMenu={setContextMenu}
        />
      </div>
      <CanvasDialogs
        deleteDialogOpen={deleteDialogOpen}
        setDeleteDialogOpen={setDeleteDialogOpen}
        draft={draft}
        onDelete={onDelete}
        notePickerOpen={notePickerOpen}
        setNotePickerOpen={setNotePickerOpen}
        notes={notes}
        addNoteCard={addNoteCard}
        T={T}
      />
    </div>
  );
}

export { MnCanvasEditor };
import MN_CANVAS_MODEL from '../../../canvas/canvasModel.js';
