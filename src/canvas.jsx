// Canvas dashboard, freeform editor, and note embed cards.

const { useState: useStateC, useEffect: useEffectC, useRef: useRefC } = React;

const MN_CANVAS_TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'pen', label: 'Pen' },
  { id: 'text', label: 'Text' },
  { id: 'sticky', label: 'Sticky' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
];

const MN_CANVAS_COLORS = [
  '#1f2937',
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#f59e0b',
  '#ffffff',
  '#fef3c7',
  '#dbeafe',
  '#dcfce7',
];

const MN_CANVAS_DEFAULT_STYLE = {
  stroke: '#1f2937',
  fill: '#ffffff',
  strokeWidth: 2,
};

function mnCanvasId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
}

function mnNewCanvas(title = 'Untitled canvas') {
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

function mnCanvasElement(type, point, style = MN_CANVAS_DEFAULT_STYLE) {
  const base = {
    id: mnCanvasId('ce'),
    type,
    x: point.x,
    y: point.y,
    stroke: style.stroke || MN_CANVAS_DEFAULT_STYLE.stroke,
    fill: style.fill || MN_CANVAS_DEFAULT_STYLE.fill,
    strokeWidth: style.strokeWidth || MN_CANVAS_DEFAULT_STYLE.strokeWidth,
  };
  if (type === 'text') return { ...base, w: 180, h: 46, text: 'Text', fill: 'transparent' };
  if (type === 'sticky') return { ...base, w: 170, h: 110, text: 'Sticky note', fill: style.fill || '#fef3c7' };
  if (type === 'ellipse') return { ...base, w: 1, h: 1, text: '' };
  if (type === 'line') return { ...base, x2: point.x, y2: point.y, text: '', fill: 'transparent' };
  if (type === 'pen') return { ...base, points: [point], text: '', fill: 'transparent' };
  return { ...base, type: 'rect', w: 1, h: 1, text: '' };
}

function mnCanvasDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function mnCanvasCloneElement(element, offset = 24) {
  const clone = {
    ...element,
    id: mnCanvasId('ce'),
    x: (element.x || 0) + offset,
    y: (element.y || 0) + offset,
  };
  if (element.x2 != null) clone.x2 = element.x2 + offset;
  if (element.y2 != null) clone.y2 = element.y2 + offset;
  if (Array.isArray(element.points)) {
    clone.points = element.points.map(point => ({ x: point.x + offset, y: point.y + offset }));
  }
  return clone;
}

function mnCanvasBounds(element) {
  if (element.type === 'line') {
    return {
      x: Math.min(element.x, element.x2),
      y: Math.min(element.y, element.y2),
      w: Math.abs(element.x2 - element.x),
      h: Math.abs(element.y2 - element.y),
    };
  }
  if (element.type === 'pen') {
    const points = element.points || [];
    if (!points.length) return { x: element.x || 0, y: element.y || 0, w: 0, h: 0 };
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: element.x || 0, y: element.y || 0, w: element.w || 0, h: element.h || 0 };
}

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
      T={T}
    />
  );
}

function MnCanvasDashboard({ canvases, onCreate, onOpen, T }) {
  const [title, setTitle] = useStateC('');
  const submit = () => {
    const name = title.trim() || 'Untitled canvas';
    setTitle('');
    onCreate && onCreate(name);
  };
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: '100%',
      overflow: 'auto',
      background: T.bg,
      padding: '28px 36px',
      color: T.ink,
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 24, fontWeight: 650, color: T.ink }}>Canvas</div>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkDim, marginTop: 3 }}>
              {canvases.length} canvas{canvases.length === 1 ? '' : 'es'} in this vault
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 5,
            border: `1px solid ${T.line}`,
            borderRadius: 7,
            background: T.bgSub,
          }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="Canvas name"
              style={{
                width: 190,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12.5,
                padding: '5px 6px',
              }}
            />
            <button onClick={submit} style={mnCanvasPrimaryButton(T)}>Create</button>
          </div>
        </div>

        {canvases.length === 0 ? (
          <div style={{
            border: `1px dashed ${T.line}`,
            borderRadius: 8,
            padding: '42px 24px',
            textAlign: 'center',
            background: T.bgSub,
            color: T.inkDim,
            fontFamily: 'var(--mn-ui)',
          }}>
            <div style={{ fontSize: 15, color: T.inkMed, marginBottom: 8 }}>No canvases yet</div>
            <button onClick={() => onCreate && onCreate('Untitled canvas')} style={mnCanvasPrimaryButton(T)}>Create canvas</button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}>
            {canvases.map(canvas => (
              <button
                key={canvas.id}
                onClick={() => onOpen && onOpen(canvas.id)}
                style={{
                  minHeight: 150,
                  textAlign: 'left',
                  border: `1px solid ${T.line}`,
                  borderRadius: 8,
                  background: T.bg,
                  color: T.ink,
                  padding: 14,
                  cursor: 'pointer',
                  boxShadow: `0 6px 18px color-mix(in oklab, ${T.ink} 6%, transparent)`,
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = T.bg}>
                <div style={{
                  height: 72,
                  borderRadius: 6,
                  border: `1px solid ${T.lineSub}`,
                  background:
                    `linear-gradient(${T.lineSub} 1px, transparent 1px), linear-gradient(90deg, ${T.lineSub} 1px, transparent 1px), ${T.bgSub}`,
                  backgroundSize: '18px 18px',
                  marginBottom: 11,
                }} />
                <div style={{
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 14,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>{canvas.title || 'Untitled canvas'}</div>
                <div style={{
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10.5,
                  color: T.inkDim,
                  marginTop: 5,
                }}>{canvas.elementCount || 0} item{canvas.elementCount === 1 ? '' : 's'} · {mnCanvasDate(canvas.modifiedAt)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MnCanvasEditor({ canvas, onBack, onSave, onDelete, T }) {
  const [draft, setDraft] = useStateC(canvas);
  const [tool, setTool] = useStateC('select');
  const [selectedId, setSelectedId] = useStateC(null);
  const [style, setStyle] = useStateC(MN_CANVAS_DEFAULT_STYLE);
  const [contextMenu, setContextMenu] = useStateC(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useStateC(false);
  const draftRef = useRefC(canvas);
  const actionRef = useRefC(null);
  const clipboardRef = useRefC([]);
  const svgRef = useRefC(null);
  const rootRef = useRefC(null);

  const selectedElement = (draft.elements || []).find(el => el.id === selectedId) || null;

  const setDraftLocal = (next) => {
    draftRef.current = next;
    setDraft(next);
  };

  useEffectC(() => {
    draftRef.current = canvas;
    setDraft(canvas);
    setSelectedId(null);
    setTool('select');
    setContextMenu(null);
    setDeleteDialogOpen(false);
  }, [canvas?.id]);

  const persistCanvas = (next) => {
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

  const saveTitle = () => {
    persistCanvas({
      ...draftRef.current,
      title: (draftRef.current.title || '').trim() || 'Untitled canvas',
    });
  };

  const toCanvasPoint = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    const viewport = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    return {
      x: (event.clientX - rect.left - viewport.x) / viewport.scale,
      y: (event.clientY - rect.top - viewport.y) / viewport.scale,
    };
  };

  const selectedIds = () => selectedId ? [selectedId] : [];

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
    if (ids.includes(selectedId)) setSelectedId(null);
    setContextMenu(null);
  };

  const copyElements = async (ids = selectedIds(), cut = false) => {
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
      if (parsed?.type === 'omini/canvas-elements' && Array.isArray(parsed.elements)) return parsed.elements;
    } catch (e) {}
    return clipboardRef.current || [];
  };

  const pasteElements = async () => {
    const elements = await readClipboardElements();
    if (!elements.length) return;
    const clones = elements.map(el => mnCanvasCloneElement(el));
    updateDraft(prev => ({ ...prev, elements: [...(prev.elements || []), ...clones] }), true);
    setSelectedId(clones[clones.length - 1]?.id || null);
    setContextMenu(null);
  };

  const applyColor = (key, value) => {
    setStyle(prev => ({ ...prev, [key]: value }));
    if (!selectedElement) return;
    updateElementById(selectedElement.id, { [key]: value }, true);
  };

  const applyStrokeWidth = (value) => {
    const width = Number(value) || 1;
    setStyle(prev => ({ ...prev, strokeWidth: width }));
    if (!selectedElement) return;
    updateElementById(selectedElement.id, { strokeWidth: width }, true);
  };

  const editText = (el) => {
    if (!['text', 'sticky'].includes(el.type)) return;
    const value = window.prompt('Edit text', el.text || '');
    if (value == null) return;
    updateElementById(el.id, { text: value }, true);
  };

  const beginCreate = (e, point) => {
    const element = mnCanvasElement(tool, point, style);
    if (tool === 'text' || tool === 'sticky') {
      updateDraft(prev => ({ ...prev, elements: [...(prev.elements || []), element] }), true);
      setSelectedId(element.id);
      setTool('select');
      return;
    }
    updateDraft(prev => ({ ...prev, elements: [...(prev.elements || []), element] }), false);
    setSelectedId(element.id);
    actionRef.current = { mode: 'create', id: element.id, type: tool, start: point };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onStageDown = (e) => {
    rootRef.current?.focus();
    if (e.button === 2) {
      e.preventDefault();
      setSelectedId(null);
      setContextMenu({ kind: 'stage', x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button !== 0 || e.target !== svgRef.current) return;
    const point = toCanvasPoint(e);
    setContextMenu(null);
    setSelectedId(null);
    if (tool !== 'select') beginCreate(e, point);
  };

  const onElementDown = (e, el) => {
    e.stopPropagation();
    rootRef.current?.focus();
    if (e.button === 2) {
      e.preventDefault();
      setSelectedId(el.id);
      setContextMenu({ kind: 'element', id: el.id, x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button !== 0 || tool !== 'select') return;
    setContextMenu(null);
    setSelectedId(el.id);
    const point = toCanvasPoint(e);
    actionRef.current = {
      mode: 'move',
      id: el.id,
      start: point,
      original: { ...el, points: Array.isArray(el.points) ? el.points.map(p => ({ ...p })) : null },
    };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const updateCreateAction = (action, point) => {
    if (action.type === 'line') {
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
    if (action.original.type === 'line') {
      updateElementById(action.id, {
        x: action.original.x + dx,
        y: action.original.y + dy,
        x2: action.original.x2 + dx,
        y2: action.original.y2 + dy,
      }, false);
      return;
    }
    if (action.original.type === 'pen') {
      updateElementById(action.id, {
        x: action.original.x + dx,
        y: action.original.y + dy,
        points: (action.original.points || []).map(p => ({ x: p.x + dx, y: p.y + dy })),
      }, false);
      return;
    }
    updateElementById(action.id, {
      x: action.original.x + dx,
      y: action.original.y + dy,
    }, false);
  };

  const onPointerMove = (e) => {
    const action = actionRef.current;
    if (!action) return;
    const point = toCanvasPoint(e);
    if (action.mode === 'create') updateCreateAction(action, point);
    if (action.mode === 'move') updateMoveAction(action, point);
  };

  const finishPointerAction = (e) => {
    const action = actionRef.current;
    if (!action) return;
    actionRef.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    persistCanvas(draftRef.current);
    if (action.mode === 'create') setTool('select');
  };

  const onWheel = (e) => {
    e.preventDefault();
    const current = draftRef.current.viewport || { x: 0, y: 0, scale: 1 };
    const nextScale = Math.max(0.45, Math.min(2.2, current.scale + (e.deltaY > 0 ? -0.08 : 0.08)));
    updateDraft(prev => ({ ...prev, viewport: { ...current, scale: nextScale } }), true);
  };

  useEffectC(() => {
    const onKey = async (e) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const isMod = e.metaKey || e.ctrlKey;
      const key = (e.key || '').toLowerCase();
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        e.preventDefault();
        removeElements([selectedId]);
        return;
      }
      if (isMod && key === 'c') {
        e.preventDefault();
        await copyElements();
      } else if (isMod && key === 'x') {
        e.preventDefault();
        await copyElements(selectedIds(), true);
      } else if (isMod && key === 'v') {
        e.preventDefault();
        await pasteElements();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const viewport = draft.viewport || { x: 0, y: 0, scale: 1 };
  const activeStroke = selectedElement?.stroke || style.stroke;
  const activeFill = selectedElement?.fill || style.fill;
  const activeStrokeWidth = selectedElement?.strokeWidth || style.strokeWidth;

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
        minHeight: 54,
        borderBottom: `1px solid ${T.line}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 18px',
        background: T.bg,
        flexWrap: 'wrap',
      }}>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { saveTitle(); onBack && onBack(); }}
          title="Back to canvases"
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
            width: 260,
            border: `1px solid ${T.lineSub}`,
            borderRadius: 6,
            outline: 'none',
            background: T.bgSub,
            color: T.ink,
            fontFamily: 'var(--mn-ui)',
            fontSize: 15,
            fontWeight: 600,
            padding: '5px 8px',
          }}
        />
        <div style={{ width: 1, height: 24, background: T.lineSub, margin: '0 5px' }} />
        {MN_CANVAS_TOOLS.map(item => (
          <button
            key={item.id}
            onClick={() => setTool(item.id)}
            title={item.label}
            style={{
              ...mnCanvasToolButton(T),
              background: tool === item.id ? T.selBg : 'transparent',
              color: tool === item.id ? T.ink : T.inkMed,
            }}>
            {item.label}
          </button>
        ))}
        <div style={{ width: 1, height: 24, background: T.lineSub, margin: '0 5px' }} />
        <MnCanvasColorControl label="Stroke" value={activeStroke} onChange={(v) => applyColor('stroke', v)} T={T} />
        <MnCanvasColorControl label="Fill" value={activeFill === 'transparent' ? '#ffffff' : activeFill} onChange={(v) => applyColor('fill', v)} T={T} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
          Width
          <input
            type="range"
            min="1"
            max="10"
            value={activeStrokeWidth}
            onChange={(e) => applyStrokeWidth(e.target.value)}
            style={{ width: 72 }}
          />
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={() => selectedId && copyElements(selectedIds(), true)} disabled={!selectedId} style={mnCanvasToolButton(T)}>Cut</button>
        <button onClick={() => copyElements()} disabled={!selectedId} style={mnCanvasToolButton(T)}>Copy</button>
        <button onClick={pasteElements} style={mnCanvasToolButton(T)}>Paste</button>
        <button onClick={() => removeElements(selectedIds())} disabled={!selectedId} style={mnCanvasToolButton(T)}>Delete</button>
        <button
          onClick={() => setDeleteDialogOpen(true)}
          style={{ ...mnCanvasToolButton(T), color: T.danger }}>
          Delete canvas
        </button>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: T.bgSub }}>
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
            cursor: tool === 'select' ? 'default' : 'crosshair',
            backgroundImage: `linear-gradient(${T.lineSub} 1px, transparent 1px), linear-gradient(90deg, ${T.lineSub} 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
          }}>
          <g transform={`translate(${viewport.x || 0} ${viewport.y || 0}) scale(${viewport.scale || 1})`}>
            {(draft.elements || []).map(el => (
              <MnCanvasElement
                key={el.id}
                element={el}
                selected={selectedId === el.id}
                onPointerDown={(e) => onElementDown(e, el)}
                onDoubleClick={() => editText(el)}
                T={T}
              />
            ))}
          </g>
        </svg>
        <div style={{
          position: 'absolute',
          left: 16,
          bottom: 14,
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          color: T.inkDim,
          background: T.bg,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 5,
          padding: '4px 7px',
          pointerEvents: 'none',
        }}>Drag to draw · right-click objects for actions · wheel zoom</div>
        {contextMenu && (
          <MnCanvasContextMenu
            menu={contextMenu}
            canPaste={true}
            onCopy={() => copyElements(contextMenu.id ? [contextMenu.id] : selectedIds())}
            onCut={() => copyElements(contextMenu.id ? [contextMenu.id] : selectedIds(), true)}
            onPaste={pasteElements}
            onDelete={() => contextMenu.id && removeElements([contextMenu.id])}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{label}</span>
      <input
        type="color"
        value={value || '#000000'}
        onChange={(e) => onChange && onChange(e.target.value)}
        title={`${label} color`}
        style={{ width: 24, height: 24, padding: 0, border: `1px solid ${T.lineSub}`, borderRadius: 5, background: T.bg, cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', gap: 3 }}>
        {MN_CANVAS_COLORS.slice(0, 6).map(color => (
          <button
            key={`${label}-${color}`}
            onClick={() => onChange && onChange(color)}
            title={color}
            style={{
              width: 15,
              height: 15,
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

function MnCanvasElement({ element, selected, onPointerDown, onDoubleClick, T }) {
  const stroke = selected ? T.accent : (element.stroke || T.inkDim);
  const strokeWidth = selected ? Math.max(2, (element.strokeWidth || 2) + 1) : (element.strokeWidth || 2);
  const fill = element.fill || 'transparent';
  if (element.type === 'line') {
    return (
      <g onPointerDown={onPointerDown} style={{ cursor: 'move' }}>
        <line x1={element.x} y1={element.y} x2={element.x2} y2={element.y2}
          stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
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
    borderRadius: 5,
    padding: '6px 11px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
  };
}

function mnCanvasIconButton(T) {
  return {
    width: 28,
    height: 28,
    borderRadius: 5,
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
    background: 'transparent',
    color: T.inkMed,
    borderRadius: 5,
    padding: '5px 8px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
  };
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
window.mnNewCanvas = mnNewCanvas;
