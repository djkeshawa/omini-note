// Canvas dashboard, freeform editor, and note embed cards.

const { useState: useStateC, useEffect: useEffectC, useMemo: useMemoC, useRef: useRefC } = React;

const MN_CANVAS_TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'text', label: 'Text' },
  { id: 'sticky', label: 'Sticky' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
];

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

function mnCanvasElement(type, point) {
  const id = `ce_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
  if (type === 'text') return { id, type, x: point.x, y: point.y, w: 180, h: 46, text: 'Text' };
  if (type === 'sticky') return { id, type, x: point.x, y: point.y, w: 170, h: 110, text: 'Sticky note' };
  if (type === 'ellipse') return { id, type, x: point.x, y: point.y, w: 150, h: 92, text: '' };
  if (type === 'line') return { id, type, x: point.x, y: point.y, x2: point.x + 180, y2: point.y, text: '' };
  return { id, type: 'rect', x: point.x, y: point.y, w: 160, h: 96, text: '' };
}

function mnCanvasDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
  const dragRef = useRefC(null);
  const svgRef = useRefC(null);

  useEffectC(() => {
    setDraft(canvas);
    setSelectedId(null);
    setTool('select');
  }, [canvas?.id]);

  const persist = (updater) => {
    setDraft(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const saved = { ...next, modifiedAt: new Date().toISOString() };
      onSave && onSave(saved);
      return saved;
    });
  };

  const toCanvasPoint = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    const viewport = draft.viewport || { x: 0, y: 0, scale: 1 };
    return {
      x: (event.clientX - rect.left - viewport.x) / viewport.scale,
      y: (event.clientY - rect.top - viewport.y) / viewport.scale,
    };
  };

  const addElement = (type, point) => {
    const element = mnCanvasElement(type, point);
    persist(prev => ({ ...prev, elements: [...(prev.elements || []), element] }));
    setSelectedId(element.id);
    setTool('select');
  };

  const updateElement = (id, patch) => {
    persist(prev => ({
      ...prev,
      elements: (prev.elements || []).map(el => el.id === id ? { ...el, ...patch } : el),
    }));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    persist(prev => ({
      ...prev,
      elements: (prev.elements || []).filter(el => el.id !== selectedId),
    }));
    setSelectedId(null);
  };

  const editText = (el) => {
    if (!['text', 'sticky'].includes(el.type)) return;
    const value = window.prompt('Edit text', el.text || '');
    if (value == null) return;
    updateElement(el.id, { text: value });
  };

  const onStageDown = (e) => {
    if (e.target !== svgRef.current) return;
    const point = toCanvasPoint(e);
    setSelectedId(null);
    if (tool !== 'select') addElement(tool, point);
  };

  const onElementDown = (e, el) => {
    e.stopPropagation();
    setSelectedId(el.id);
    const point = toCanvasPoint(e);
    dragRef.current = {
      id: el.id,
      start: point,
      original: { ...el },
    };
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toCanvasPoint(e);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (drag.original.type === 'line') {
      updateElement(drag.id, {
        x: drag.original.x + dx,
        y: drag.original.y + dy,
        x2: drag.original.x2 + dx,
        y2: drag.original.y2 + dy,
      });
      return;
    }
    updateElement(drag.id, {
      x: drag.original.x + dx,
      y: drag.original.y + dy,
    });
  };

  const onWheel = (e) => {
    e.preventDefault();
    const current = draft.viewport || { x: 0, y: 0, scale: 1 };
    const nextScale = Math.max(0.45, Math.min(2.2, current.scale + (e.deltaY > 0 ? -0.08 : 0.08)));
    persist(prev => ({ ...prev, viewport: { ...current, scale: nextScale } }));
  };

  const viewport = draft.viewport || { x: 0, y: 0, scale: 1 };

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: '100%',
      background: T.bg,
      display: 'flex',
      flexDirection: 'column',
      color: T.ink,
    }}>
      <div style={{
        height: 54,
        borderBottom: `1px solid ${T.line}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 18px',
        background: T.bg,
      }}>
        <button onClick={onBack} title="Back to canvases" style={mnCanvasIconButton(T)}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M10 3L5 8L10 13" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          value={draft.title || ''}
          onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
          onBlur={() => persist(prev => ({ ...prev, title: prev.title || 'Untitled canvas' }))}
          style={{
            width: 260,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: T.ink,
            fontFamily: 'var(--mn-ui)',
            fontSize: 16,
            fontWeight: 600,
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
        <div style={{ flex: 1 }} />
        <button onClick={removeSelected} disabled={!selectedId} style={mnCanvasToolButton(T)}>Delete</button>
        <button
          onClick={() => {
            if (window.confirm('Delete this canvas?')) onDelete && onDelete(draft.id);
          }}
          style={{ ...mnCanvasToolButton(T), color: T.danger }}>
          Delete canvas
        </button>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: T.bgSub }}>
        <svg
          ref={svgRef}
          onPointerDown={onStageDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerLeave={() => { dragRef.current = null; }}
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
        }}>Wheel zoom · double-click text to edit</div>
      </div>
    </div>
  );
}

function MnCanvasElement({ element, selected, onPointerDown, onDoubleClick, T }) {
  const stroke = selected ? T.accent : T.inkDim;
  if (element.type === 'line') {
    return (
      <g onPointerDown={onPointerDown}>
        <line x1={element.x} y1={element.y} x2={element.x2} y2={element.y2}
          stroke={stroke} strokeWidth={selected ? 3 : 2} strokeLinecap="round" />
      </g>
    );
  }
  if (element.type === 'ellipse') {
    return (
      <g onPointerDown={onPointerDown}>
        <ellipse cx={element.x + element.w / 2} cy={element.y + element.h / 2}
          rx={element.w / 2} ry={element.h / 2}
          fill={T.bg} stroke={stroke} strokeWidth={selected ? 2 : 1.4} />
      </g>
    );
  }
  const isSticky = element.type === 'sticky';
  const isText = element.type === 'text';
  return (
    <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
      {!isText && (
        <rect x={element.x} y={element.y} width={element.w} height={element.h} rx={isSticky ? 7 : 5}
          fill={isSticky ? 'oklch(0.94 0.08 94)' : T.bg}
          stroke={stroke}
          strokeWidth={selected ? 2 : 1.4} />
      )}
      {(isText || isSticky) && (
        <foreignObject x={element.x + (isText ? 0 : 10)} y={element.y + (isText ? 0 : 10)}
          width={element.w - (isText ? 0 : 20)} height={element.h - (isText ? 0 : 20)}
          style={{ pointerEvents: 'none' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{
            width: '100%',
            height: '100%',
            color: isSticky ? '#3b3420' : T.ink,
            fontFamily: isText ? 'var(--mn-body)' : 'var(--mn-ui)',
            fontSize: isText ? 18 : 13,
            lineHeight: 1.35,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
          }}>{element.text || ''}</div>
        </foreignObject>
      )}
      {selected && (
        <rect x={element.x - 4} y={element.y - 4} width={(element.w || 0) + 8} height={(element.h || 0) + 8}
          fill="none" stroke={T.accent} strokeDasharray="4 3" strokeWidth="1.2" pointerEvents="none" />
      )}
    </g>
  );
}

function MnCanvasEmbed({ canvasId, canvases, onOpenCanvas, T }) {
  const canvas = (canvases || []).find(c => c.id === canvasId);
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
        {canvas?.title || `Canvas ${canvasId.slice(-6)}`}
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

window.MnCanvasPanel = MnCanvasPanel;
window.MnCanvasEmbed = MnCanvasEmbed;
window.mnNewCanvas = mnNewCanvas;
