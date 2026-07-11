

function MnAiNotice({ notice, onOpen, onDismiss, T }) {
  if (!notice) return null;
  const isError = !!notice.error;
  return (
    <div style={{
      position: 'absolute',
      right: 18,
      bottom: 18,
      zIndex: 80,
      width: 330,
      maxWidth: 'calc(100vw - 36px)',
      border: `1px solid ${isError ? `color-mix(in oklab, ${T.warn} 42%, ${T.line})` : T.line}`,
      borderRadius: 8,
      background: T.bg,
      color: T.ink,
      boxShadow: `0 18px 48px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      overflow: 'hidden',
      fontFamily: 'var(--mn-ui)',
      animation: 'mnSlideUp 160ms ease',
    }}>
      <button
        onClick={onOpen}
        style={{
          width: '100%',
          border: 'none',
          background: isError ? `color-mix(in oklab, ${T.warn} 8%, ${T.bg})` : T.bg,
          color: T.ink,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '12px 13px',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}>
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${isError ? T.warn : T.selLine}`,
          background: isError ? `color-mix(in oklab, ${T.warn} 14%, transparent)` : T.accentSoft,
          color: isError ? T.warn : T.accent,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
            {isError ? (
              <path d="M8 3V8M8 11.4V11.5M3.4 13H12.6L8 2.8L3.4 13Z" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: T.ink }}>
            {isError ? 'AI task needs attention' : 'AI response ready'}
          </span>
          <span style={{
            display: 'block',
            marginTop: 3,
            fontSize: 12.5,
            lineHeight: 1.35,
            color: T.inkDim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {notice.query || 'Open Ask AI to view the result'}
          </span>
        </span>
      </button>
      <button
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss AI notification"
        style={{
          position: 'absolute',
          top: 7,
          right: 7,
          width: 24,
          height: 24,
          borderRadius: 5,
          border: `1px solid ${T.lineSub}`,
          background: T.bg,
          color: T.inkDim,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export { MnAiNotice };
