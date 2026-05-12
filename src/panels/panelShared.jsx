// Shared panel components.

function SectionHead({ label, count, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      fontFamily: 'var(--mn-mono)', fontSize: 10,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: T.inkDim,
    }}>
      <span>{label}</span>
      <span>{count}</span>
      <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
    </div>
  );
}


window.MN_PANEL_COMPONENTS = {
  ...(window.MN_PANEL_COMPONENTS || {}),
  SectionHead,
};
