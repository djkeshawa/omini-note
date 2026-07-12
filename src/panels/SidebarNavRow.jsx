function SidebarNavRow({ icon, label, count, active, onClick, accent, T, pad }) {
  const activate = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick?.();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      aria-label={`${label}${count != null ? `, ${count}` : ''}`}
      onClick={onClick}
      onKeyDown={activate}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: `${pad.py}px 10px`, margin: '0 6px', borderRadius: 6,
        minHeight: 28, boxSizing: 'border-box', cursor: 'pointer', userSelect: 'none',
        background: active ? T.selBg : 'transparent',
        border: `1px solid ${active ? T.selLine : 'transparent'}`,
        color: active ? T.ink : T.inkMed,
        fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: active ? 500 : 400,
        transition: 'background 80ms',
      }}
      onMouseEnter={event => !active && (event.currentTarget.style.background = T.bgHover)}
      onMouseLeave={event => !active && (event.currentTarget.style.background = 'transparent')}>
      <span style={{
        width: 14, height: 14, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', color: accent || T.inkDim,
      }}>{icon}</span>
      <span style={{ flex: 1, color: 'inherit' }}>{label}</span>
      {count != null && (
        <span style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          padding: '1px 5px', borderRadius: 3,
          background: active ? 'transparent' : T.bgSub,
        }}>{count}</span>
      )}
    </div>
  );
}

export { SidebarNavRow };
