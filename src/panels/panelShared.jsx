// Shared panel components.

function SectionHead({ label, count, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11,
      color: T.inkDim,
    }}>
      <span>{label}</span>
      <span>{count}</span>
      <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
    </div>
  );
}


export { SectionHead };
