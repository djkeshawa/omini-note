const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;
const {
  MN_CANVAS_TOOLS, MN_CANVAS_COLORS, MN_CANVAS_DEFAULT_STYLE, mnCloneCanvasState, mnCanvasId,
  mnNewCanvas, mnCanvasElement, mnCanvasNoteElement, mnCanvasNotePreview, mnCanvasDate,
  mnCanvasPreviewElements, mnCanvasCloneElement, mnCanvasBounds, mnCanvasSelectionBounds,
  mnCanvasMoveElement, mnCanvasIsConnector, mnCanvasAnchorTargetAt, mnCanvasResolveConnector,
  mnCanvasSyncConnectors, mnCanvasCloneElements,
} = window.MN_CANVAS_MODEL || {};
import { mnCanvasDialogButton } from './CanvasStyles.js';

function MnCanvasNotePicker({ notes = [], onPick, onClose, T }) {
  const [query, setQuery] = useStateC('');
  const [active, setActive] = useStateC(0);
  const inputRef = useRefC(null);
  useEffectC(() => {
    const handle = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, []);
  const items = useMemoC(() => {
    const model = window.MN_QUICK_SWITCHER_MODEL;
    if (model?.mnQuickSwitcherResults) {
      return model.mnQuickSwitcherResults({ notes, query, recentIds: [], limit: 10 }).items;
    }
    const q = query.trim().toLowerCase();
    return (notes || [])
      .filter(n => !q || String(n.title || '').toLowerCase().includes(q))
      .slice(0, 10);
  }, [notes, query]);
  useEffectC(() => setActive(0), [query]);
  return (
    <div role="presentation" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 260,
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 30%, transparent)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '12vh 18px 18px',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Add note to canvas" onClick={e => e.stopPropagation()} style={{
        width: 'min(520px, 100%)', background: T.bg, color: T.ink,
        border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden',
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 30%, transparent)`,
      }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); if (items[active]) onPick?.(items[active]); }
          }}
          placeholder="Add a note to the canvas..."
          style={{
            width: '100%', border: 'none', borderBottom: `1px solid ${T.lineSub}`,
            outline: 'none', background: T.bg, color: T.ink,
            padding: '13px 15px', fontFamily: 'var(--mn-ui)', fontSize: 14,
          }}
        />
        <div style={{ maxHeight: 320, overflow: 'auto', padding: 6 }}>
          {items.map((note, index) => (
            <button
              key={note.id}
              onMouseEnter={() => setActive(index)}
              onClick={() => onPick?.(note)}
              style={{
                width: '100%', display: 'block', border: 'none', borderRadius: 7,
                background: index === active ? T.selBg : 'transparent', color: T.ink,
                padding: '9px 11px', textAlign: 'left', cursor: 'pointer',
                fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
              {note.title || 'Untitled'}
            </button>
          ))}
          {!items.length && (
            <div style={{ padding: 16, color: T.inkDim, fontSize: 13, textAlign: 'center' }}>No matching notes</div>
          )}
        </div>
      </div>
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

function MnCanvasActionButton({ icon, label, onClick, disabled = false, T, tone = 'default', expanded, hasPopup = false }) {
  const isExpandedToggle = typeof expanded === 'boolean';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-expanded={isExpandedToggle ? expanded : undefined}
      aria-haspopup={hasPopup ? 'menu' : undefined}
      style={{
        ...mnCanvasIconToolButton(T),
        background: isExpandedToggle && expanded ? T.selBg : T.bg,
        borderColor: isExpandedToggle && expanded ? T.accent : T.lineSub,
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
  if (id === 'more') return <svg {...common}><circle cx="4.5" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="11.5" cy="8" r="1"/></svg>;
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
  if (id === 'note') return (
    <svg {...common}><rect x="2.6" y="3" width="10.8" height="10" rx="1.4"/><path d="M4.8 5.8H11.2M4.8 8H11.2M4.8 10.2H8.6" strokeLinecap="round"/></svg>
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

export { MnCanvasNotePicker, MnCanvasColorControl, MnCanvasToolButton, MnCanvasActionButton, MnCanvasActionIcon, MnCanvasDivider, MnCanvasStatusPill, MnCanvasResizeHandles, MnCanvasToolIcon, MnCanvasContextMenu, MnCanvasDeleteDialog };
