

function MnAppNoticeDialog({ notice, T, onClose }) {
  const closeRef = useRefA(null);
  const mountedRef = useRefA(false);

  useEffectA(() => {
    if (!notice) return;
    mountedRef.current = true;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => { if (mountedRef.current) closeRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [notice, onClose]);

  if (!notice) return null;
  const title = notice.title || 'Something went wrong';
  const message = notice.message || notice.error || 'The operation could not be completed.';

  return (
    <div
      className="mn-app-notice-dialog"
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 92,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 26%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mn-app-notice-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '17px 18px 14px',
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
            color: notice.tone === 'warn' ? T.warn : T.danger,
            background: `color-mix(in oklab, ${notice.tone === 'warn' ? T.warn : T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${notice.tone === 'warn' ? T.warn : T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M8 2L14 13H2L8 2Z" strokeLinejoin="round"/>
              <path d="M8 6V9M8 11.7V11.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-app-notice-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>{title}</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}>{message}</div>
          </div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '12px 18px 16px',
        }}>
          <button
            ref={closeRef}
            onClick={onClose}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              fontWeight: 650,
              background: T.ink,
              color: T.bg,
              border: `1px solid ${T.ink}`,
            }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export { MnAppNoticeDialog };
const { useEffect: useEffectA, useRef: useRefA } = React;
