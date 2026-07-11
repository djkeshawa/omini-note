

function MnDeleteNoteDialog({ note, T, onCancel, onConfirm }) {
  const cancelRef = useRefA(null);
  const mountedRef = useRefA(false);

  useEffectA(() => {
    mountedRef.current = true;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => { if (mountedRef.current) cancelRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [onCancel]);

  if (!note) return null;
  const blockCount = (window.MN_OUTLINE?.mnFlatten?.(note.blocks || [], 0, false) || []).length;
  const tagText = (note.tags || []).length
    ? (note.tags || []).map(t => `#${t}`).join(' ')
    : 'No tags';

  const btnBase = {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
  };

  return (
    <div
      className="mn-delete-note-dialog"
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 30%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-delete-note-title"
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
            <div id="mn-delete-note-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>Delete note?</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
            }}>This moves the note to Recently deleted for 30 days.</div>
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
            }}>{note.title || 'Untitled'}</div>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: T.inkDim,
            }}>
              <span>{blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>
              <span style={{ color: T.line }}>•</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tagText}</span>
            </div>
          </div>
          <div style={{
            marginTop: 11,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            lineHeight: 1.45,
            color: T.inkMed,
          }}>You can restore this note from Recently deleted.</div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px 16px',
        }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              ...btnBase,
              background: T.bg,
              color: T.inkMed,
              border: `1px solid ${T.line}`,
            }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...btnBase,
              background: T.danger,
              color: T.bg,
              border: `1px solid ${T.danger}`,
              boxShadow: `0 8px 20px color-mix(in oklab, ${T.danger} 20%, transparent)`,
            }}>
            Move to trash
          </button>
        </div>
      </div>
    </div>
  );
}

export { MnDeleteNoteDialog };
