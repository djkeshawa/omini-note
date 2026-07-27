const { useEffect: useEffectOE } = React;

function MnCanvasPicker({ canvases = [], onPick, onCreate, onClose, T }) {
  useEffectOE(() => {
    const onDown = (e) => {
      if (e.target.closest?.('.mn-canvas-picker')) return;
      onClose && onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      className="mn-canvas-picker"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        zIndex: 1200,
        top: 'calc(100% + 6px)',
        left: 0,
        width: 260,
        maxHeight: 280,
        overflow: 'auto',
        background: T.bg,
        color: T.ink,
        border: `1px solid ${T.line}`,
        borderRadius: 8,
        padding: 6,
        boxShadow: `0 14px 38px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        fontFamily: 'var(--mn-ui)',
      }}>
      <div style={{
        padding: '6px 8px',
        fontFamily: 'var(--mn-ui)', fontWeight: 600,
        fontSize: 11,
        color: T.inkDim,
      }}>Attach canvas</div>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onCreate && onCreate();
        }}
        style={{
          width: '100%',
          border: `1px solid ${T.lineSub}`,
          background: T.bgSub,
          color: T.ink,
          borderRadius: 6,
          padding: '8px 9px',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'var(--mn-ui)',
          fontSize: 12.5,
          fontWeight: 600,
        }}>
        Create new canvas
      </button>
      <div style={{ height: 1, background: T.lineSub, margin: '6px 2px' }} />
      {canvases.length === 0 ? (
        <div style={{
          padding: '10px 8px',
          color: T.inkDim,
          fontSize: 12,
        }}>No existing canvases</div>
      ) : canvases.map(canvas => (
        <button
          key={canvas.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick && onPick(canvas.id);
          }}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: T.ink,
            borderRadius: 6,
            padding: '7px 8px',
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'var(--mn-ui)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {canvas.title || 'Untitled canvas'}
          </div>
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, marginTop: 2 }}>
            {canvas.elementCount || 0} item{canvas.elementCount === 1 ? '' : 's'}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Disclosure triangle ────────────────────────────────────────────────
// The triangle sits in the gutter, not in the text column. It is chrome, and
// reserving 18px of the writing measure for it pushed every line right.
//
// Render it only for a block that actually has children. The row's hover rule
// carries `!important`, so a disclosure on a childless block was revealed on
// hover regardless of its inline opacity — an arrow that appeared on every
// line and did nothing, since the click is guarded on having children.
function MnDisclosure({ open, onClick, T, padTop, left = -18 }) {
  return (
    <button
      onClick={onClick}
      className="mn-disclosure"
      title={open ? 'Collapse' : 'Expand'}
      style={{
        position: 'absolute', left, top: 0,
        width: 18, height: 22, background: 'none', border: 'none',
        padding: 0, flexShrink: 0,
        cursor: 'pointer',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        // Pad so the visible triangle aligns with the text baseline of the
        // first line. Caller passes the same value used for the grip handle.
        paddingTop: (padTop != null ? padTop : 4) - 1,
        // Always visible when collapsed (signals hidden content);
        // hover-revealed when expanded.
        opacity: open ? 0 : 1,
        transition: 'opacity 80ms',
        marginRight: 0,
      }}>
      <svg width="11" height="11" viewBox="0 0 10 10" style={{
        transform: open ? 'rotate(0)' : 'rotate(-90deg)',
        transition: 'transform 120ms cubic-bezier(0.4, 0, 0.2, 1)',
        color: T.ink, display: 'block',
      }}>
        <path d="M2 3.5 L5 6.8 L8 3.5" fill="currentColor" stroke="none"/>
      </svg>
    </button>
  );
}

// ── Slash command catalog ─────────────────────────────────────────────

export { MnCanvasPicker, MnDisclosure };
