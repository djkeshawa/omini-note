function MnContextualTip({ tip, onDismiss, T, compact = false }) {
  if (!tip) return null;
  return (
    <aside
      role="note"
      aria-label={tip.title}
      data-mn-onboarding-tip={tip.id}
      style={{
        margin: compact ? '8px 0 2px' : '0 0 14px',
        padding: compact ? '9px 10px' : '10px 12px',
        border: `1px solid ${T.accentSoft || T.line}`,
        borderRadius: 8,
        background: `color-mix(in oklab, ${T.accentSoft || T.bgSub} 72%, ${T.bg})`,
        color: T.inkMed,
        display: 'flex',
        alignItems: compact ? 'flex-start' : 'center',
        gap: 10,
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: compact ? 11.5 : 12.5, fontWeight: 700, color: T.ink }}>
          {tip.title}
        </div>
        <div style={{ marginTop: 2, fontFamily: 'var(--mn-body)', fontSize: compact ? 11 : 12, lineHeight: 1.45 }}>
          {tip.body}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Dismiss ${tip.id} tip`}
        onClick={() => onDismiss?.(tip.id)}
        style={{
          minHeight: 28,
          padding: '4px 8px',
          borderRadius: 6,
          border: `1px solid ${T.lineSub}`,
          background: T.bg,
          color: T.inkMed,
          cursor: 'pointer',
          fontFamily: 'var(--mn-ui)',
          fontSize: 11,
          fontWeight: 650,
          flexShrink: 0,
        }}>
        Got it
      </button>
    </aside>
  );
}

export { MnContextualTip };
