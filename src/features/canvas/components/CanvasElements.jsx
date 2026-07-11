const {
  MN_CANVAS_TOOLS, MN_CANVAS_COLORS, MN_CANVAS_DEFAULT_STYLE, mnCloneCanvasState, mnCanvasId,
  mnNewCanvas, mnCanvasElement, mnCanvasNoteElement, mnCanvasNotePreview, mnCanvasDate,
  mnCanvasPreviewElements, mnCanvasCloneElement, mnCanvasBounds, mnCanvasSelectionBounds,
  mnCanvasMoveElement, mnCanvasIsConnector, mnCanvasAnchorTargetAt, mnCanvasResolveConnector,
  mnCanvasSyncConnectors, mnCanvasCloneElements,
} = window.MN_CANVAS_MODEL || {};

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

function MnCanvasElement({ element, note = null, selected, onPointerDown, onDoubleClick, T }) {
  const stroke = selected ? T.accent : (element.stroke || T.inkDim);
  const strokeWidth = selected ? Math.max(2, (element.strokeWidth || 2) + 1) : (element.strokeWidth || 2);
  const fill = element.fill || 'transparent';
  if (element.type === 'note') {
    const missing = !note;
    const title = note?.title || 'Note not found';
    const preview = note && mnCanvasNotePreview ? mnCanvasNotePreview(note) : '';
    return (
      <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} style={{ cursor: 'move' }}>
        <rect x={element.x} y={element.y} width={element.w} height={element.h} rx={9}
          fill={missing ? 'transparent' : (element.fill || T.bg)}
          stroke={missing ? T.warn : stroke}
          strokeDasharray={missing ? '5 4' : undefined}
          strokeWidth={strokeWidth} />
        <foreignObject x={element.x + 12} y={element.y + 10} width={Math.max(0, element.w - 24)} height={Math.max(0, element.h - 20)}
          style={{ pointerEvents: 'none' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{
            width: '100%', height: '100%', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', gap: 5,
          }}>
            <div style={{
              fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 700,
              color: missing ? '#b45309' : '#1f2430', lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{title}</div>
            {!missing && (
              <div style={{
                fontFamily: 'var(--mn-body)', fontSize: 11.5, lineHeight: 1.45,
                color: '#4b5563', overflow: 'hidden', flex: 1,
              }}>{preview || 'Empty note'}</div>
            )}
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 9, color: '#9ca3af' }}>
              {missing ? 'the linked note was deleted' : 'note · double-click to open'}
            </div>
          </div>
        </foreignObject>
        {selected && (
          <rect x={element.x - 4} y={element.y - 4} width={(element.w || 0) + 8} height={(element.h || 0) + 8}
            fill="none" stroke={T.accent} strokeDasharray="4 3" strokeWidth="1.2" pointerEvents="none" />
        )}
      </g>
    );
  }
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

export { MnCanvasElement, MnCanvasEmbed };
