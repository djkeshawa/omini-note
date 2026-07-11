const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;

function MnReminderToast({ toast, onDismiss, onSnooze, onOpen, T, variant }) {
  if (!toast) return null;
  const compact = typeof window !== 'undefined' && window.innerWidth <= 1180;

  if (variant === 'banner') {
    return (
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
        background: `color-mix(in oklab, ${T.warn} 14%, ${T.bg})`,
        borderBottom: `1px solid color-mix(in oklab, ${T.warn} 30%, transparent)`,
        fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink,
        animation: 'mnSlideDown 200ms ease',
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={T.warn} strokeWidth="1.5">
          <circle cx="8" cy="9" r="5.5"/><path d="M8 6V9L10 10" strokeLinecap="round"/>
          <path d="M3 3L4.5 4.5M13 3L11.5 4.5" strokeLinecap="round"/>
        </svg>
        <span style={{ fontWeight: 500 }}>Reminder:</span>
        <span style={{ color: T.inkMed }}>{toast.text}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => onOpen(toast.noteId)} style={{
          padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
          background: 'transparent', border: `1px solid ${T.line}`, color: T.inkMed,
          fontFamily: 'var(--mn-ui)', fontSize: 11.5,
        }}>Open note</button>
        <button onClick={onDismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: T.inkDim, padding: 4, fontSize: 14,
        }}>✕</button>
      </div>
    );
  }

  // Default: card toast bottom-right
  return (
    <div style={{
      position: 'absolute', bottom: compact ? 12 : 18, right: compact ? 12 : 18, zIndex: 50,
      width: compact ? 280 : 300,
      maxWidth: 'calc(100vw - 28px)',
      background: T.bgElevated || T.bg,
      borderRadius: 9,
      border: `1px solid ${T.line}`,
      boxShadow: typeof mnShadow === 'function'
        ? mnShadow(T, 'elevated')
        : `0 12px 40px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      padding: compact ? 11 : 13,
      animation: 'mnSlideUp 220ms cubic-bezier(.2,.8,.2,1)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--mn-mono)', fontSize: 9.5,
        color: T.warn, letterSpacing: '0.1em', textTransform: 'uppercase',
        marginBottom: compact ? 6 : 8, fontWeight: 600,
      }}>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="9" r="5.5"/><path d="M8 6V9L10 10" strokeLinecap="round"/>
        </svg>
        Reminder
        <div style={{ flex: 1 }} />
        <button onClick={onDismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: T.inkDim, padding: 0, fontSize: 14,
        }}>✕</button>
      </div>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: compact ? 13.2 : 14, color: T.ink,
        lineHeight: 1.5, marginBottom: 4,
      }}>{toast.text}</div>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
        marginBottom: compact ? 8 : 10,
      }}>from {toast.noteTitle}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onOpen(toast.noteId)} style={{
          flex: 1, padding: compact ? '4px 10px' : '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.ink, color: T.bg, border: 'none',
          fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
        }}>Open note</button>
        <button onClick={onSnooze || onDismiss} style={{
          padding: compact ? '4px 9px' : '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.bg, color: T.inkMed, border: `1px solid ${T.line}`,
          fontFamily: 'var(--mn-ui)', fontSize: 12,
        }}>Snooze</button>
      </div>
    </div>
  );
}

export { MnReminderToast };
