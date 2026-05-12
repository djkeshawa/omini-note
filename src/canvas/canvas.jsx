// Canvas dashboard, freeform editor, and note embed cards.

const { useState: useStateC, useEffect: useEffectC, useRef: useRefC } = React;

const {
  MN_CANVAS_TOOLS,
  MN_CANVAS_COLORS,
  MN_CANVAS_DEFAULT_STYLE,
  mnCloneCanvasState,
  mnCanvasId,
  mnNewCanvas,
  mnCanvasElement,
  mnCanvasDate,
  mnCanvasPreviewElements,
  mnCanvasCloneElement,
  mnCanvasBounds,
  mnCanvasSelectionBounds,
  mnCanvasMoveElement,
} = window.MN_CANVAS_MODEL || {};

function MnCanvasPanel({ canvases, activeCanvas, onCreate, onOpen, onBack, onSave, onDelete, T }) {
  if (activeCanvas) {
    return (
      <MnCanvasEditor
        canvas={activeCanvas}
        onBack={onBack}
        onSave={onSave}
        onDelete={onDelete}
        T={T}
      />
    );
  }
  return (
    <MnCanvasDashboard
      canvases={canvases}
      onCreate={onCreate}
      onOpen={onOpen}
      onDelete={onDelete}
      T={T}
    />
  );
}

function MnCanvasDashboard({ canvases, onCreate, onOpen, onDelete, T }) {
  const [title, setTitle] = useStateC('');
  const [cardMenu, setCardMenu] = useStateC(null);
  const [deleteTarget, setDeleteTarget] = useStateC(null);
  const submit = () => {
    const name = title.trim() || 'Untitled canvas';
    setTitle('');
    onCreate && onCreate(name);
  };
  const openCanvasCardMenu = (event, canvas) => {
    event.preventDefault();
    event.stopPropagation();
    setCardMenu({ x: event.clientX, y: event.clientY, canvas });
  };
  const requestDeleteCard = (canvas) => {
    setCardMenu(null);
    setDeleteTarget(canvas);
  };
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: '100%',
      overflow: 'auto',
      background: `linear-gradient(180deg, ${T.bg} 0%, ${T.bgSub} 100%)`,
      padding: '32px 38px',
      color: T.ink,
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 26 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 26, fontWeight: 700, letterSpacing: 0, color: T.ink }}>Canvas</div>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkDim, marginTop: 5 }}>
              {canvases.length} canvas{canvases.length === 1 ? '' : 'es'} in this vault
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: 6,
            border: `1px solid ${T.line}`,
            borderRadius: 8,
            background: T.bg,
            boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 7%, transparent)`,
          }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="Canvas name"
              style={{
                width: 210,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12.5,
                padding: '6px 8px',
              }}
            />
            <button onClick={submit} style={mnCanvasPrimaryButton(T)}>Create</button>
          </div>
        </div>

        {canvases.length === 0 ? (
          <div style={{
            border: `1px dashed ${T.line}`,
            borderRadius: 8,
            padding: '46px 24px',
            textAlign: 'center',
            background: T.bg,
            color: T.inkDim,
            fontFamily: 'var(--mn-ui)',
            boxShadow: `inset 0 1px 0 color-mix(in oklab, ${T.bg} 80%, white)`,
          }}>
            <div style={{
              width: 68,
              height: 52,
              margin: '0 auto 14px',
              borderRadius: 7,
              border: `1px solid ${T.line}`,
              background: mnCanvasStageBackground(T, 18),
            }} />
            <div style={{ fontSize: 15, fontWeight: 650, color: T.inkMed, marginBottom: 10 }}>No canvases yet</div>
            <button onClick={() => onCreate && onCreate('Untitled canvas')} style={mnCanvasPrimaryButton(T)}>Create canvas</button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))',
            gap: 16,
          }}>
            {canvases.map(canvas => (
              <button
                key={canvas.id}
                onClick={() => onOpen && onOpen(canvas.id)}
                onContextMenu={(e) => openCanvasCardMenu(e, canvas)}
                style={{
                  minHeight: 132,
                  textAlign: 'left',
                  border: `1px solid ${T.line}`,
                  borderRadius: 8,
                  background: T.bg,
                  color: T.ink,
                  padding: 14,
                  cursor: 'pointer',
                  boxShadow: `0 12px 30px color-mix(in oklab, ${T.ink} 7%, transparent)`,
                  transition: 'transform 120ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) 154px',
                  alignItems: 'stretch',
                  gap: 14,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = T.bgHover;
                  e.currentTarget.style.borderColor = T.selLine;
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = `0 16px 38px color-mix(in oklab, ${T.ink} 10%, transparent)`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = T.bg;
                  e.currentTarget.style.borderColor = T.line;
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = `0 12px 30px color-mix(in oklab, ${T.ink} 7%, transparent)`;
                }}>
                <div style={{
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: '3px 0',
                }}>
                  <div>
                    <div style={{
                      fontFamily: 'var(--mn-ui)',
                      fontSize: 15,
                      fontWeight: 700,
                      lineHeight: 1.25,
                      color: T.ink,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>{canvas.title || 'Untitled canvas'}</div>
                  </div>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    alignSelf: 'flex-start',
                    gap: 7,
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10.5,
                    color: T.inkDim,
                    padding: '5px 8px',
                    borderRadius: 999,
                    border: `1px solid ${T.lineSub}`,
                    background: T.bgSub,
                    maxWidth: '100%',
                  }}>
                    <span>{canvas.elementCount || 0} item{canvas.elementCount === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <MnCanvasMiniPreview canvas={canvas} T={T} />
              </button>
            ))}
          </div>
        )}
      </div>
      {cardMenu && (
        <MnCanvasCardMenu
          menu={cardMenu}
          T={T}
          onOpen={() => {
            const id = cardMenu.canvas?.id;
            setCardMenu(null);
            id && onOpen && onOpen(id);
          }}
          onDelete={() => requestDeleteCard(cardMenu.canvas)}
          onClose={() => setCardMenu(null)}
        />
      )}
      {deleteTarget && (
        <MnCanvasDeleteDialog
          canvas={deleteTarget}
          T={T}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const id = deleteTarget.id;
            setDeleteTarget(null);
            id && onDelete && onDelete(id);
          }}
        />
      )}
    </div>
  );
}

function MnCanvasMiniPreview({ canvas, T }) {
  const elements = mnCanvasPreviewElements(canvas);
  const bounds = mnCanvasSelectionBounds(elements);
  const scale = bounds ? Math.min(1, 184 / Math.max(1, bounds.w), 62 / Math.max(1, bounds.h)) : 1;
  const transform = bounds ? {
    scale,
    x: 116 - (bounds.x + bounds.w / 2) * scale,
    y: 46 - (bounds.y + bounds.h / 2) * scale,
  } : { scale: 1, x: 0, y: 0 };
  return (
    <div style={{
      width: '100%',
      height: '100%',
      minHeight: 104,
      borderRadius: 7,
      border: `1px solid ${T.lineSub}`,
      background: mnCanvasStageBackground(T, 18),
      overflow: 'hidden',
      position: 'relative',
    }}>
      <svg width="100%" height="100%" viewBox="0 0 232 92" preserveAspectRatio="none" style={{ display: 'block' }}>
        {elements.length ? elements.map((el, index) => (
          <MnCanvasPreviewShape key={el.id || index} element={el} transform={transform} />
        )) : (
          <g opacity="0.58">
            <rect x="56" y="28" width="120" height="36" rx="7" fill={T.bg} stroke={T.line} strokeWidth="1" />
            <path d="M82 42H150M82 51H130" stroke={T.line} strokeWidth="2" strokeLinecap="round" />
          </g>
        )}
      </svg>
    </div>
  );
}

function MnCanvasCardMenu({ menu, T, onOpen, onDelete, onClose }) {
  useEffectC(() => {
    const close = (e) => {
      if (e.target.closest?.('.mn-canvas-card-menu')) return;
      onClose && onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = (label, action, danger = false) => (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        action && action();
      }}
      style={{
        width: '100%',
        border: 'none',
        background: 'transparent',
        color: danger ? T.danger : T.ink,
        borderRadius: 5,
        padding: '7px 9px',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'var(--mn-ui)',
        fontSize: 12.5,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = T.bgHover)}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {label}
    </button>
  );

  return (
    <div
      className="mn-canvas-card-menu"
      style={{
        position: 'fixed',
        left: menu.x,
        top: menu.y,
        zIndex: 110,
        width: 168,
        padding: 5,
        borderRadius: 8,
        border: `1px solid ${T.line}`,
        background: T.bg,
        boxShadow: `0 16px 42px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        fontFamily: 'var(--mn-ui)',
      }}>
      <div style={{
        padding: '6px 9px 7px',
        borderBottom: `1px solid ${T.lineSub}`,
        marginBottom: 4,
        color: T.inkDim,
        fontSize: 11,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>{menu.canvas?.title || 'Untitled canvas'}</div>
      {item('Open canvas', onOpen)}
      {item('Delete canvas', onDelete, true)}
    </div>
  );
}

function MnCanvasPreviewShape({ element, transform }) {
  const stroke = element.stroke || '#64748b';
  const fill = element.fill || 'transparent';
  const strokeWidth = Math.max(1, element.strokeWidth || 1.6);
  const scale = transform?.scale || 1;
  const mapPoint = (point) => ({
    x: (point.x ?? 0) * scale + (transform?.x || 0),
    y: (point.y ?? 0) * scale + (transform?.y || 0),
  });
  const origin = mapPoint({ x: element.x ?? 0, y: element.y ?? 0 });
  const x = origin.x;
  const y = origin.y;
  const w = Math.max(14, (element.w || 44) * scale);
  const h = Math.max(10, (element.h || 28) * scale);
  if (element.type === 'ellipse') {
    return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (element.type === 'line' || element.type === 'arrow') {
    const end = mapPoint({ x: element.x2 ?? element.x ?? 0, y: element.y2 ?? element.y ?? 0 });
    return (
      <g>
        <line x1={x} y1={y} x2={end.x} y2={end.y} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        {element.type === 'arrow' && <polygon points={mnCanvasArrowHead(x, y, end.x, end.y, 7)} fill={stroke} />}
      </g>
    );
  }
  if (element.type === 'pen') {
    const points = (element.points || []).map(mapPoint);
    const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    return d ? <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" /> : null;
  }
  if (element.type === 'diamond') {
    const points = [`${x + w / 2},${y}`, `${x + w},${y + h / 2}`, `${x + w / 2},${y + h}`, `${x},${y + h / 2}`].join(' ');
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (element.type === 'triangle') {
    const points = [`${x + w / 2},${y}`, `${x + w},${y + h}`, `${x},${y + h}`].join(' ');
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  return <rect x={x} y={y} width={w} height={h} rx={element.type === 'sticky' ? 6 : 4} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function MnCanvasEditor({ canvas, onBack, onSave, onDelete, T }) {
  const [draft, setDraft] = useStateC(canvas);
  const [tool, setTool] = useStateC('select');
  const [selectedIds, setSelectedIds] = useStateC([]);
  const [style, setStyle] = useStateC(MN_CANVAS_DEFAULT_STYLE);
  const [contextMenu, setContextMenu] = useStateC(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useStateC(false);
  const [editingTextId, setEditingTextId] = useStateC(null);
  const [spaceDown, setSpaceDown] = useStateC(false);
  const [marquee, setMarquee] = useStateC(null);
  const [historyVersion, setHistoryVersion] = useStateC(0);
  const draftRef = useRefC(canvas);
  const actionRef = useRefC(null);
  const clipboardRef = useRefC([]);
  const undoRef = useRefC([]);
  const redoRef = useRefC([]);
  const svgRef = useRefC(null);
  const rootRef = useRefC(null);
  const selectedIdsRef = useRefC([]);
  const handlersRef = useRefC({});

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

  useEffectC(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffectC(() => {
    draftRef.current = canvas;
    setDraft(canvas);
    setSelectedIds([]);
    setTool('select');
    setContextMenu(null);
    setDeleteDialogOpen(false);
    setEditingTextId(null);
    setMarquee(null);
    undoRef.current = [];
    redoRef.current = [];
    setHistoryVersion(v => v + 1);
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
    onSave && onSave(saved);
    return saved;
  };

  const updateDraft = (updater, persist = false) => {
    const prev = draftRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (persist) return persistCanvas(next);
    setDraftLocal(next);
    return next;
  };

  const undoCanvas = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(mnCloneCanvasState(draftRef.current));
    const restored = { ...previous, modifiedAt: new Date().toISOString() };
    setDraftLocal(restored);
    onSave && onSave(restored);
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
    onSave && onSave(restored);
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
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).filter(el => !ids.includes(el.id)),
    }), true);
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
    const clones = elements.map(el => mnCanvasCloneElement(el));
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

  const applyStrokeWidth = (value) => {
    const width = Number(value) || 1;
    setStyle(prev => ({ ...prev, strokeWidth: width }));
    if (!selectedIds.length) return;
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => selectedIds.includes(el.id) ? { ...el, strokeWidth: width } : el),
    }), true);
  };

  const editText = (el) => {
    if (!['text', 'sticky'].includes(el.type)) return;
    rememberCanvas();
    setSelectedIds([el.id]);
    setEditingTextId(el.id);
  };

  const alignSelected = (mode) => {
    if (selectedElements.length < 2) return;
    const bounds = mnCanvasSelectionBounds(selectedElements);
    if (!bounds) return;
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => {
        if (!selectedIds.includes(el.id)) return el;
        const b = mnCanvasBounds(el);
        if (mode === 'left') return mnCanvasMoveElement(el, bounds.x - b.x, 0);
        if (mode === 'right') return mnCanvasMoveElement(el, bounds.x + bounds.w - (b.x + b.w), 0);
        if (mode === 'top') return mnCanvasMoveElement(el, 0, bounds.y - b.y);
        if (mode === 'bottom') return mnCanvasMoveElement(el, 0, bounds.y + bounds.h - (b.y + b.h));
        if (mode === 'center-x') return mnCanvasMoveElement(el, bounds.x + bounds.w / 2 - (b.x + b.w / 2), 0);
        if (mode === 'center-y') return mnCanvasMoveElement(el, 0, bounds.y + bounds.h / 2 - (b.y + b.h / 2));
        return el;
      }),
    }), true);
  };

  const distributeSelected = (axis) => {
    if (selectedElements.length < 3) return;
    const sorted = [...selectedElements].sort((a, b) => {
      const ba = mnCanvasBounds(a);
      const bb = mnCanvasBounds(b);
      return axis === 'x' ? ba.x - bb.x : ba.y - bb.y;
    });
    const first = mnCanvasBounds(sorted[0]);
    const last = mnCanvasBounds(sorted[sorted.length - 1]);
    const start = axis === 'x' ? first.x + first.w / 2 : first.y + first.h / 2;
    const end = axis === 'x' ? last.x + last.w / 2 : last.y + last.h / 2;
    const step = (end - start) / (sorted.length - 1);
    const targetCenters = new Map(sorted.map((el, i) => [el.id, start + step * i]));
    updateDraft(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => {
        if (!targetCenters.has(el.id)) return el;
        const b = mnCanvasBounds(el);
        return axis === 'x'
          ? mnCanvasMoveElement(el, targetCenters.get(el.id) - (b.x + b.w / 2), 0)
          : mnCanvasMoveElement(el, 0, targetCenters.get(el.id) - (b.y + b.h / 2));
      }),
    }), true);
  };

  const setZoom = (nextScale) => {
    const current = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    const scale = Math.max(0.25, Math.min(3, nextScale));
    updateDraft(prev => ({ ...prev, viewport: { ...current, scale } }), true);
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
    }), true);
  };

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
    persistCanvas(draftRef.current, { history: false });
  };

  const onWheel = (e) => {
    e.preventDefault();
    const current = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    const nextScale = Math.max(0.45, Math.min(2.2, current.scale + (e.deltaY > 0 ? -0.08 : 0.08)));
    const saved = { ...draftRef.current, viewport: { ...current, scale: nextScale }, modifiedAt: new Date().toISOString() };
    setDraftLocal(saved);
    onSave && onSave(saved);
  };

  useEffectC(() => {
    const onKeyDown = async (e) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      if (e.code === 'Space') {
        setSpaceDown(true);
        if (e.target === rootRef.current || e.target === document.body) e.preventDefault();
      }
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const isMod = e.metaKey || e.ctrlKey;
      const key = (e.key || '').toLowerCase();
      if (isMod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handlersRef.current.redoCanvas?.();
        else handlersRef.current.undoCanvas?.();
        return;
      }
      if (isMod && key === 'y') {
        e.preventDefault();
        handlersRef.current.redoCanvas?.();
        return;
      }
      const currentSelectedIds = selectedIdsRef.current || [];
      if ((e.key === 'Backspace' || e.key === 'Delete') && currentSelectedIds.length) {
        e.preventDefault();
        handlersRef.current.removeElements?.(currentSelectedIds);
        return;
      }
      if (isMod && key === 'c') {
        e.preventDefault();
        await handlersRef.current.copyElements?.(selectedIdsRef.current || []);
      } else if (isMod && key === 'x') {
        e.preventDefault();
        await handlersRef.current.copyElements?.(selectedIdsRef.current || [], true);
      } else if (isMod && key === 'v') {
        e.preventDefault();
        await handlersRef.current.pasteElements?.();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const viewport = draft.viewport || { x: 0, y: 0, scale: 1 };
  const activeStroke = selectedElement?.stroke || style.stroke;
  const activeFill = selectedElement?.fill || style.fill;
  const activeStrokeWidth = selectedElement?.strokeWidth || style.strokeWidth;
  const editingOrigin = editingElement ? canvasPointToScreen({ x: editingElement.x || 0, y: editingElement.y || 0 }) : null;
  const showSelectionUi = tool === 'select';

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
      <div style={{
        borderBottom: `1px solid ${T.line}`,
        background: `color-mix(in oklab, ${T.bg} 94%, ${T.bgSub})`,
        boxShadow: `0 1px 0 color-mix(in oklab, ${T.bg} 84%, white) inset`,
      }}>
        <div style={{
          minHeight: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 18px 7px',
        }}>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { saveTitle(); onBack && onBack(); }}
            title="Back to canvases"
            aria-label="Back to canvases"
            style={mnCanvasIconButton(T)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M10 3L5 8L10 13" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            value={draft.title || ''}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => updateDraft(prev => ({ ...prev, title: e.target.value }), false)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                updateDraft(prev => ({ ...prev, title: canvas.title || 'Untitled canvas' }), false);
                e.currentTarget.blur();
              }
            }}
            style={{
              width: 330,
              maxWidth: '38vw',
              border: '1px solid transparent',
              borderRadius: 6,
              outline: 'none',
              background: 'transparent',
              color: T.ink,
              fontFamily: 'var(--mn-ui)',
              fontSize: 16,
              fontWeight: 700,
              padding: '5px 7px',
            }}
            onFocus={e => {
              e.currentTarget.style.background = T.bg;
              e.currentTarget.style.borderColor = T.lineSub;
            }}
            onBlurCapture={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }}
          />
          <MnCanvasStatusPill T={T}>{(draft.elements || []).length} object{(draft.elements || []).length === 1 ? '' : 's'}</MnCanvasStatusPill>
          <MnCanvasStatusPill T={T}>{selectedIds.length ? `${selectedIds.length} selected` : 'No selection'}</MnCanvasStatusPill>
          <div style={{ flex: 1 }} />
          <MnCanvasActionButton icon="canvas-trash" label="Delete canvas" onClick={() => setDeleteDialogOpen(true)} T={T} tone="danger" />
        </div>
        <div style={{
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 18px 10px',
          overflowX: 'auto',
        }}>
          <div style={mnCanvasToolbarGroup(T)}>
            {MN_CANVAS_TOOLS.map(item => (
              <MnCanvasToolButton
                key={item.id}
                tool={item}
                active={tool === item.id}
                onClick={() => setTool(item.id)}
                T={T}
              />
            ))}
          </div>
          <div style={mnCanvasToolbarGroup(T)}>
            <MnCanvasColorControl label="Stroke" value={activeStroke} onChange={(v) => applyColor('stroke', v)} T={T} />
            <MnCanvasColorControl label="Fill" value={activeFill === 'transparent' ? '#ffffff' : activeFill} onChange={(v) => applyColor('fill', v)} T={T} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
              Width
              <input
                type="range"
                min="1"
                max="10"
                value={activeStrokeWidth}
                onChange={(e) => applyStrokeWidth(e.target.value)}
                style={{ width: 74, accentColor: T.accent }}
              />
            </label>
          </div>
          <div style={mnCanvasToolbarGroup(T)}>
            <MnCanvasActionButton icon="undo" label="Undo" onClick={undoCanvas} disabled={!canUndo} T={T} />
            <MnCanvasActionButton icon="redo" label="Redo" onClick={redoCanvas} disabled={!canRedo} T={T} />
            <MnCanvasDivider T={T} />
            <MnCanvasActionButton icon="zoom-out" label="Zoom out" onClick={() => setZoom((viewport.scale || 1) - 0.15)} T={T} />
            <span style={{ minWidth: 42, textAlign: 'center', fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
              {Math.round((viewport.scale || 1) * 100)}%
            </span>
            <MnCanvasActionButton icon="zoom-in" label="Zoom in" onClick={() => setZoom((viewport.scale || 1) + 0.15)} T={T} />
            <MnCanvasActionButton icon="fit" label="Fit to screen" onClick={fitToScreen} disabled={!(draft.elements || []).length} T={T} />
          </div>
          <div style={mnCanvasToolbarGroup(T)}>
            <MnCanvasActionButton icon="align-left" label="Align left" onClick={() => alignSelected('left')} disabled={selectedIds.length < 2} T={T} />
            <MnCanvasActionButton icon="align-center" label="Align center" onClick={() => alignSelected('center-x')} disabled={selectedIds.length < 2} T={T} />
            <MnCanvasActionButton icon="align-right" label="Align right" onClick={() => alignSelected('right')} disabled={selectedIds.length < 2} T={T} />
            <MnCanvasActionButton icon="align-top" label="Align top" onClick={() => alignSelected('top')} disabled={selectedIds.length < 2} T={T} />
            <MnCanvasActionButton icon="align-middle" label="Align middle" onClick={() => alignSelected('center-y')} disabled={selectedIds.length < 2} T={T} />
            <MnCanvasActionButton icon="align-bottom" label="Align bottom" onClick={() => alignSelected('bottom')} disabled={selectedIds.length < 2} T={T} />
            <MnCanvasDivider T={T} />
            <MnCanvasActionButton icon="distribute-x" label="Distribute horizontally" onClick={() => distributeSelected('x')} disabled={selectedIds.length < 3} T={T} />
            <MnCanvasActionButton icon="distribute-y" label="Distribute vertically" onClick={() => distributeSelected('y')} disabled={selectedIds.length < 3} T={T} />
          </div>
          <div style={mnCanvasToolbarGroup(T)}>
            <MnCanvasActionButton icon="cut" label="Cut" onClick={() => selectedIds.length && copyElements(currentSelectionIds(), true)} disabled={!selectedIds.length} T={T} />
            <MnCanvasActionButton icon="copy" label="Copy" onClick={() => copyElements()} disabled={!selectedIds.length} T={T} />
            <MnCanvasActionButton icon="paste" label="Paste" onClick={pasteElements} T={T} />
            <MnCanvasActionButton icon="trash" label="Delete" onClick={() => removeElements(currentSelectionIds())} disabled={!selectedIds.length} T={T} tone="danger" />
          </div>
        </div>
      </div>
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(180deg, ${T.bgSub}, ${T.bg})`,
      }}>
        <svg
          ref={svgRef}
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
            {(draft.elements || []).map(el => (
              <MnCanvasElement
                key={el.id}
                element={el}
                selected={showSelectionUi && selectedIds.includes(el.id)}
                onPointerDown={(e) => onElementDown(e, el)}
                onDoubleClick={() => editText(el)}
                T={T}
              />
            ))}
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
        {editingElement && editingOrigin && (
          <textarea
            autoFocus
            value={editingElement.text || ''}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => updateElementById(editingElement.id, { text: e.target.value }, false)}
            onBlur={() => {
              setEditingTextId(null);
              persistCanvas(draftRef.current, { history: false });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditingTextId(null);
                persistCanvas(draftRef.current, { history: false });
              }
              if (editingElement.type === 'text' && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            style={{
              position: 'absolute',
              left: editingOrigin.x,
              top: editingOrigin.y,
              width: Math.max(80, (editingElement.w || 160) * (viewport.scale || 1)),
              height: Math.max(42, (editingElement.h || 60) * (viewport.scale || 1)),
              resize: 'none',
              border: `1px solid ${T.accent}`,
              borderRadius: editingElement.type === 'sticky' ? 7 : 4,
              outline: 'none',
              padding: editingElement.type === 'sticky' ? 9 : 3,
              background: editingElement.type === 'sticky' ? (editingElement.fill || '#fef3c7') : T.bg,
              color: editingElement.stroke || T.ink,
              fontFamily: editingElement.type === 'text' ? 'var(--mn-body)' : 'var(--mn-ui)',
              fontSize: (editingElement.type === 'text' ? 18 : 13) * (viewport.scale || 1),
              lineHeight: 1.35,
              zIndex: 12,
              boxShadow: `0 10px 26px color-mix(in oklab, ${T.ink} 14%, transparent)`,
            }}
          />
        )}
        <div style={{
          position: 'absolute',
          left: 16,
          bottom: 14,
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          color: T.inkDim,
          background: `color-mix(in oklab, ${T.bg} 88%, transparent)`,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 999,
          padding: '5px 9px',
          pointerEvents: 'none',
          boxShadow: `0 8px 22px color-mix(in oklab, ${T.ink} 7%, transparent)`,
        }}>{MN_CANVAS_TOOLS.find(item => item.id === tool)?.label || 'Select'} · {Math.round((viewport.scale || 1) * 100)}%</div>
        {contextMenu && (
          <MnCanvasContextMenu
            menu={contextMenu}
            canPaste={true}
            onCopy={() => copyElements(contextMenu.ids || (contextMenu.id ? [contextMenu.id] : currentSelectionIds()))}
            onCut={() => copyElements(contextMenu.ids || (contextMenu.id ? [contextMenu.id] : currentSelectionIds()), true)}
            onPaste={pasteElements}
            onDelete={() => removeElements(contextMenu.ids || (contextMenu.id ? [contextMenu.id] : []))}
            onClose={() => setContextMenu(null)}
            T={T}
          />
        )}
      </div>
      {deleteDialogOpen && (
        <MnCanvasDeleteDialog
          canvas={draft}
          T={T}
          onCancel={() => setDeleteDialogOpen(false)}
          onConfirm={() => {
            setDeleteDialogOpen(false);
            onDelete && onDelete(draft.id);
          }}
        />
      )}
    </div>
  );
}

function MnCanvasColorControl({ label, value, onChange, T }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{label}</span>
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange && onChange(e.target.value)}
        title={`${label} color`}
        style={{ width: 26, height: 26, padding: 2, border: `1px solid ${T.lineSub}`, borderRadius: 6, background: T.bg, cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', gap: 3 }}>
        {MN_CANVAS_COLORS.slice(0, 6).map(color => (
          <button
            key={`${label}-${color}`}
            onClick={() => onChange && onChange(color)}
            title={color}
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              border: `1px solid ${T.lineSub}`,
              background: color,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function MnCanvasToolButton({ tool, active, onClick, T }) {
  return (
    <button
      onClick={onClick}
      title={tool.label}
      aria-label={tool.label}
      style={{
        ...mnCanvasIconToolButton(T),
        background: active ? T.selBg : 'transparent',
        borderColor: active ? T.accent : T.lineSub,
        color: active ? T.accent : T.inkMed,
      }}>
      <MnCanvasToolIcon id={tool.id} />
    </button>
  );
}

function MnCanvasActionButton({ icon, label, onClick, disabled = false, T, tone = 'default' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        ...mnCanvasIconToolButton(T),
        color: disabled ? T.inkDim : tone === 'danger' ? T.danger : T.inkMed,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}>
      <MnCanvasActionIcon id={icon} />
    </button>
  );
}

function MnCanvasActionIcon({ id }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.45 };
  if (id === 'undo') return <svg {...common}><path d="M6 5H3V2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.4 5C4.5 3.7 6.1 3 8 3C11 3 13 5 13 8C13 11 11 13 8 13C6.5 13 5.2 12.5 4.2 11.6" strokeLinecap="round"/></svg>;
  if (id === 'redo') return <svg {...common}><path d="M10 5H13V2" strokeLinecap="round" strokeLinejoin="round"/><path d="M12.6 5C11.5 3.7 9.9 3 8 3C5 3 3 5 3 8C3 11 5 13 8 13C9.5 13 10.8 12.5 11.8 11.6" strokeLinecap="round"/></svg>;
  if (id === 'zoom-in') return <svg {...common}><circle cx="7" cy="7" r="4.3"/><path d="M7 4.8V9.2M4.8 7H9.2M10.5 10.5L13.3 13.3" strokeLinecap="round"/></svg>;
  if (id === 'zoom-out') return <svg {...common}><circle cx="7" cy="7" r="4.3"/><path d="M4.8 7H9.2M10.5 10.5L13.3 13.3" strokeLinecap="round"/></svg>;
  if (id === 'fit') return <svg {...common}><path d="M3 6V3H6M10 3H13V6M13 10V13H10M6 13H3V10" strokeLinecap="round" strokeLinejoin="round"/><rect x="5.4" y="5.4" width="5.2" height="5.2" rx="1"/></svg>;
  if (id === 'align-left') return <svg {...common}><path d="M3 3V13M5.5 5H13M5.5 9H10.5" strokeLinecap="round"/></svg>;
  if (id === 'align-center') return <svg {...common}><path d="M8 3V13M3.5 5H12.5M5.5 9H10.5" strokeLinecap="round"/></svg>;
  if (id === 'align-right') return <svg {...common}><path d="M13 3V13M3 5H10.5M5.5 9H10.5" strokeLinecap="round"/></svg>;
  if (id === 'align-top') return <svg {...common}><path d="M3 3H13M5 5.5V13M10 5.5V10.5" strokeLinecap="round"/></svg>;
  if (id === 'align-middle') return <svg {...common}><path d="M3 8H13M5 3.5V12.5M10 5.5V10.5" strokeLinecap="round"/></svg>;
  if (id === 'align-bottom') return <svg {...common}><path d="M3 13H13M5 3V10.5M10 5.5V10.5" strokeLinecap="round"/></svg>;
  if (id === 'distribute-x') return <svg {...common}><path d="M3 3V13M13 3V13M5.2 8H10.8M6 5V11M10 5V11" strokeLinecap="round"/></svg>;
  if (id === 'distribute-y') return <svg {...common}><path d="M3 3H13M3 13H13M8 5.2V10.8M5 6H11M5 10H11" strokeLinecap="round"/></svg>;
  if (id === 'cut') return <svg {...common}><circle cx="4.4" cy="4.4" r="1.8"/><circle cx="4.4" cy="11.6" r="1.8"/><path d="M6 5.4L13 12M6 10.6L13 4" strokeLinecap="round"/></svg>;
  if (id === 'copy') return <svg {...common}><rect x="5" y="5" width="8" height="8" rx="1.4"/><path d="M3 10.5V3H10.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (id === 'paste') return <svg {...common}><path d="M6 3H10L10.7 4.5H12.5V13H3.5V4.5H5.3L6 3Z" strokeLinejoin="round"/><path d="M6 7.2H10M6 10H9" strokeLinecap="round"/></svg>;
  if (id === 'trash' || id === 'canvas-trash') return <svg {...common}><path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/></svg>;
  return null;
}

function MnCanvasDivider({ T }) {
  return <span aria-hidden="true" style={{ width: 1, height: 21, background: T.lineSub, margin: '0 2px' }} />;
}

function MnCanvasStatusPill({ children, T }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 24,
      border: `1px solid ${T.lineSub}`,
      borderRadius: 999,
      padding: '0 9px',
      background: T.bgSub,
      color: T.inkDim,
      fontFamily: 'var(--mn-mono)',
      fontSize: 10.5,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function MnCanvasResizeHandles({ bounds, onPointerDown, T }) {
  const size = 7;
  const x = bounds.x;
  const y = bounds.y;
  const w = bounds.w || 0;
  const h = bounds.h || 0;
  const handles = [
    { id: 'nw', x, y, cursor: 'nwse-resize' },
    { id: 'n', x: x + w / 2, y, cursor: 'ns-resize' },
    { id: 'ne', x: x + w, y, cursor: 'nesw-resize' },
    { id: 'e', x: x + w, y: y + h / 2, cursor: 'ew-resize' },
    { id: 'se', x: x + w, y: y + h, cursor: 'nwse-resize' },
    { id: 's', x: x + w / 2, y: y + h, cursor: 'ns-resize' },
    { id: 'sw', x, y: y + h, cursor: 'nesw-resize' },
    { id: 'w', x, y: y + h / 2, cursor: 'ew-resize' },
  ];
  return (
    <g>
      {handles.map(handle => (
        <rect
          key={handle.id}
          x={handle.x - size / 2}
          y={handle.y - size / 2}
          width={size}
          height={size}
          rx="1.5"
          fill={T.bg}
          stroke={T.accent}
          strokeWidth="1.2"
          style={{ cursor: handle.cursor }}
          onPointerDown={(e) => onPointerDown(e, handle.id)}
        />
      ))}
    </g>
  );
}

function MnCanvasToolIcon({ id }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.45 };
  if (id === 'select') return (
    <svg {...common}><path d="M4 2.5L11.8 8L8.6 8.7L10.6 12.3L8.9 13.2L7 9.6L4.8 11.9L4 2.5Z" strokeLinejoin="round"/></svg>
  );
  if (id === 'pen') return (
    <svg {...common}><path d="M3 12.5L4.1 9.1L10.8 2.4L13.6 5.2L6.9 11.9L3 12.5Z" strokeLinejoin="round"/><path d="M9.7 3.5L12.5 6.3" strokeLinecap="round"/></svg>
  );
  if (id === 'text') return (
    <svg {...common}><path d="M3 4V2.8H13V4M8 3V13M5.6 13H10.4" strokeLinecap="round"/></svg>
  );
  if (id === 'sticky') return (
    <svg {...common}><path d="M3 3H13V10L10 13H3V3Z" strokeLinejoin="round"/><path d="M10 13V10H13" strokeLinejoin="round"/></svg>
  );
  if (id === 'rect') return (
    <svg {...common}><rect x="3" y="4" width="10" height="8" rx="1.2"/></svg>
  );
  if (id === 'ellipse') return (
    <svg {...common}><ellipse cx="8" cy="8" rx="5.2" ry="3.7"/></svg>
  );
  if (id === 'line') return (
    <svg {...common}><path d="M3 12L13 4" strokeLinecap="round"/></svg>
  );
  if (id === 'arrow') return (
    <svg {...common}><path d="M3 12L12 3" strokeLinecap="round"/><path d="M7.8 3H12V7.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  );
  if (id === 'diamond') return (
    <svg {...common}><path d="M8 2.8L13.2 8L8 13.2L2.8 8L8 2.8Z" strokeLinejoin="round"/></svg>
  );
  if (id === 'triangle') return (
    <svg {...common}><path d="M8 2.8L13.3 12.5H2.7L8 2.8Z" strokeLinejoin="round"/></svg>
  );
  if (id === 'eraser') return (
    <svg {...common}><path d="M5.4 11.7L2.8 9.1L8.6 3.3C9.1 2.8 9.9 2.8 10.4 3.3L12.7 5.6C13.2 6.1 13.2 6.9 12.7 7.4L8.4 11.7H5.4Z" strokeLinejoin="round"/><path d="M7 5L11 9M3 13H13" strokeLinecap="round"/></svg>
  );
  return null;
}

function MnCanvasContextMenu({ menu, canPaste, onCopy, onCut, onPaste, onDelete, onClose, T }) {
  useEffectC(() => {
    const close = (e) => {
      if (e.target.closest?.('.mn-canvas-context-menu')) return;
      onClose && onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  const item = (label, action, disabled = false, danger = false) => (
    <button
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) action && action();
      }}
      style={{
        width: '100%',
        border: 'none',
        background: 'transparent',
        color: disabled ? T.inkDim : danger ? T.danger : T.ink,
        borderRadius: 5,
        padding: '7px 9px',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--mn-ui)',
        fontSize: 12.5,
      }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.background = T.bgHover)}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {label}
    </button>
  );

  return (
    <div
      className="mn-canvas-context-menu"
      style={{
        position: 'fixed',
        left: menu.x,
        top: menu.y,
        zIndex: 90,
        width: 160,
        padding: 5,
        borderRadius: 8,
        border: `1px solid ${T.line}`,
        background: T.bg,
        boxShadow: `0 16px 42px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      }}>
      {menu.kind === 'element' && item('Cut', onCut)}
      {menu.kind === 'element' && item('Copy', onCopy)}
      {item('Paste', onPaste, !canPaste)}
      {menu.kind === 'element' && <div style={{ height: 1, background: T.lineSub, margin: '4px 3px' }} />}
      {menu.kind === 'element' && item('Delete object', onDelete, false, true)}
    </div>
  );
}

function MnCanvasDeleteDialog({ canvas, T, onCancel, onConfirm }) {
  const cancelRef = useRefC(null);

  useEffectC(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [onCancel]);

  return (
    <div
      className="mn-canvas-delete-dialog"
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 30%, transparent)`,
        backdropFilter: 'blur(2px)',
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-delete-canvas-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 26%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: T.bgSub,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: T.danger,
            background: `color-mix(in oklab, ${T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-delete-canvas-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>Delete canvas?</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
            }}>This removes the canvas from the current vault.</div>
          </div>
        </div>
        <div style={{ padding: '16px 18px 10px' }}>
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: '11px 12px',
          }}>
            <div style={{
              fontSize: 13.5,
              fontWeight: 650,
              color: T.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 5,
            }}>{canvas.title || 'Untitled canvas'}</div>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: T.inkDim,
            }}>
              <span>{(canvas.elements || []).length} {(canvas.elements || []).length === 1 ? 'object' : 'objects'}</span>
              <span style={{ color: T.line }}>-</span>
              <span>{mnCanvasDate(canvas.modifiedAt)}</span>
            </div>
          </div>
          <div style={{
            marginTop: 11,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            lineHeight: 1.45,
            color: T.inkMed,
          }}>This action cannot be undone.</div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px 16px',
        }}>
          <button ref={cancelRef} onClick={onCancel} style={mnCanvasDialogButton(T)}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...mnCanvasDialogButton(T),
              background: T.danger,
              color: T.bg,
              border: `1px solid ${T.danger}`,
              boxShadow: `0 8px 20px color-mix(in oklab, ${T.danger} 20%, transparent)`,
            }}>
            Delete canvas
          </button>
        </div>
      </div>
    </div>
  );
}

function mnCanvasArrowHead(x1, y1, x2, y2, size = 11) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const wing = Math.PI / 7;
  const p1 = {
    x: x2 - size * Math.cos(angle - wing),
    y: y2 - size * Math.sin(angle - wing),
  };
  const p2 = {
    x: x2 - size * Math.cos(angle + wing),
    y: y2 - size * Math.sin(angle + wing),
  };
  return `${x2},${y2} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

function MnCanvasElement({ element, selected, onPointerDown, onDoubleClick, T }) {
  const stroke = selected ? T.accent : (element.stroke || T.inkDim);
  const strokeWidth = selected ? Math.max(2, (element.strokeWidth || 2) + 1) : (element.strokeWidth || 2);
  const fill = element.fill || 'transparent';
  if (element.type === 'line' || element.type === 'arrow') {
    return (
      <g onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <line x1={element.x} y1={element.y} x2={element.x2} y2={element.y2}
          stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        {element.type === 'arrow' && (
          <polygon points={mnCanvasArrowHead(element.x, element.y, element.x2, element.y2, Math.max(10, strokeWidth * 4))}
            fill={stroke} />
        )}
        <line x1={element.x} y1={element.y} x2={element.x2} y2={element.y2}
          stroke="transparent" strokeWidth={Math.max(12, strokeWidth + 8)} strokeLinecap="round" />
      </g>
    );
  }
  if (element.type === 'pen') {
    const points = element.points || [];
    const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const bounds = mnCanvasBounds(element);
    return (
      <g onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        {points.length <= 1 ? (
          <circle cx={points[0]?.x || element.x || 0} cy={points[0]?.y || element.y || 0} r={Math.max(2, strokeWidth / 2)}
            fill={stroke} />
        ) : (
          <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {points.length > 1 && (
          <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, strokeWidth + 8)} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {selected && (
          <rect x={bounds.x - 5} y={bounds.y - 5} width={bounds.w + 10} height={bounds.h + 10}
            fill="none" stroke={T.accent} strokeDasharray="4 3" strokeWidth="1.2" pointerEvents="none" />
        )}
      </g>
    );
  }
  if (element.type === 'ellipse') {
    return (
      <g onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <ellipse cx={element.x + element.w / 2} cy={element.y + element.h / 2}
          rx={element.w / 2} ry={element.h / 2}
          fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </g>
    );
  }
  if (element.type === 'diamond') {
    const points = [
      `${element.x + element.w / 2},${element.y}`,
      `${element.x + element.w},${element.y + element.h / 2}`,
      `${element.x + element.w / 2},${element.y + element.h}`,
      `${element.x},${element.y + element.h / 2}`,
    ].join(' ');
    return (
      <g onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        {selected && (
          <rect x={element.x - 4} y={element.y - 4} width={(element.w || 0) + 8} height={(element.h || 0) + 8}
            fill="none" stroke={T.accent} strokeDasharray="4 3" strokeWidth="1.2" pointerEvents="none" />
        )}
      </g>
    );
  }
  if (element.type === 'triangle') {
    const points = [
      `${element.x + element.w / 2},${element.y}`,
      `${element.x + element.w},${element.y + element.h}`,
      `${element.x},${element.y + element.h}`,
    ].join(' ');
    return (
      <g onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        {selected && (
          <rect x={element.x - 4} y={element.y - 4} width={(element.w || 0) + 8} height={(element.h || 0) + 8}
            fill="none" stroke={T.accent} strokeDasharray="4 3" strokeWidth="1.2" pointerEvents="none" />
        )}
      </g>
    );
  }
  const isSticky = element.type === 'sticky';
  const isText = element.type === 'text';
  return (
    <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} style={{ cursor: 'move' }}>
      {!isText && (
        <rect x={element.x} y={element.y} width={element.w} height={element.h} rx={isSticky ? 7 : 5}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth} />
      )}
      {(isText || isSticky) && (
        <foreignObject x={element.x + (isText ? 0 : 10)} y={element.y + (isText ? 0 : 10)}
          width={element.w - (isText ? 0 : 20)} height={element.h - (isText ? 0 : 20)}
          style={{ pointerEvents: 'none' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{
            width: '100%',
            height: '100%',
            color: element.stroke || T.ink,
            fontFamily: isText ? 'var(--mn-body)' : 'var(--mn-ui)',
            fontSize: isText ? 18 : 13,
            lineHeight: 1.35,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
          }}>{element.text || ''}</div>
        </foreignObject>
      )}
      {selected && !['pen'].includes(element.type) && (
        <rect x={element.x - 4} y={element.y - 4} width={(element.w || 0) + 8} height={(element.h || 0) + 8}
          fill="none" stroke={T.accent} strokeDasharray="4 3" strokeWidth="1.2" pointerEvents="none" />
      )}
    </g>
  );
}

function MnCanvasEmbed({ canvasId, canvases, onOpenCanvas, T }) {
  const canvas = (canvases || []).find(c => c.id === canvasId);
  const label = canvasId ? `Canvas ${String(canvasId).slice(-6)}` : 'Canvas';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpenCanvas && onOpenCanvas(canvasId);
      }}
      style={{
        width: 'min(420px, 100%)',
        border: `1px solid ${T.line}`,
        borderRadius: 8,
        background: T.bgSub,
        color: T.ink,
        padding: 10,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--mn-ui)',
      }}>
      <div style={{
        height: 54,
        borderRadius: 6,
        border: `1px solid ${T.lineSub}`,
        background:
          `linear-gradient(${T.lineSub} 1px, transparent 1px), linear-gradient(90deg, ${T.lineSub} 1px, transparent 1px), ${T.bg}`,
        backgroundSize: '16px 16px',
        marginBottom: 8,
      }} />
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {canvas?.title || label}
      </div>
      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, marginTop: 2 }}>
        {canvas ? `${canvas.elementCount || 0} item${canvas.elementCount === 1 ? '' : 's'} · ${mnCanvasDate(canvas.modifiedAt)}` : 'Canvas not found'}
      </div>
    </button>
  );
}

function mnCanvasPrimaryButton(T) {
  return {
    border: 'none',
    background: T.ink,
    color: T.bg,
    borderRadius: 6,
    padding: '7px 12px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 650,
    boxShadow: `0 8px 18px color-mix(in oklab, ${T.ink} 14%, transparent)`,
  };
}

function mnCanvasIconButton(T) {
  return {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };
}

function mnCanvasToolButton(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    borderRadius: 6,
    padding: '5px 8px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
  };
}

function mnCanvasIconToolButton(T) {
  return {
    width: 31,
    height: 31,
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    borderRadius: 6,
    padding: 0,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function mnCanvasToolbarGroup(T) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 8,
    background: `color-mix(in oklab, ${T.bg} 78%, ${T.bgSub})`,
    flexShrink: 0,
  };
}

function mnCanvasStageBackground(T, size = 28) {
  const lineAt = Math.max(1, size - 1);
  return `repeating-linear-gradient(0deg, transparent 0 ${lineAt}px, ${T.lineSub} ${lineAt}px ${size}px), repeating-linear-gradient(90deg, transparent 0 ${lineAt}px, ${T.lineSub} ${lineAt}px ${size}px), ${T.bgSub}`;
}

function mnCanvasDialogButton(T) {
  return {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
    background: T.bg,
    color: T.inkMed,
    border: `1px solid ${T.line}`,
  };
}

window.MnCanvasPanel = MnCanvasPanel;
window.MnCanvasEmbed = MnCanvasEmbed;
