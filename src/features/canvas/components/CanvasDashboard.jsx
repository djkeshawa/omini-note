const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;
const {
  MN_CANVAS_TOOLS, MN_CANVAS_COLORS, MN_CANVAS_DEFAULT_STYLE, mnCloneCanvasState, mnCanvasId,
  mnNewCanvas, mnCanvasElement, mnCanvasNoteElement, mnCanvasNotePreview, mnCanvasDate,
  mnCanvasPreviewElements, mnCanvasCloneElement, mnCanvasBounds, mnCanvasSelectionBounds,
  mnCanvasMoveElement, mnCanvasIsConnector, mnCanvasAnchorTargetAt, mnCanvasResolveConnector,
  mnCanvasSyncConnectors, mnCanvasCloneElements,
} = window.MN_CANVAS_MODEL || {};
import { mnCanvasPrimaryButton, mnCanvasDialogButton } from './CanvasStyles.js';

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
      // Extra top inset clears the floating reminder bell (fixed at top:14,
      // right:18) so it never overlaps the "Canvas name" box in the top-right.
      padding: '52px 38px 32px',
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

export { MnCanvasDashboard };
