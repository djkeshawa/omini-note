const VAULT_ICON_SRC = 'assets/vispnote-icon.png';

export function VaultIcon({ T, size = 22, active = false }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.24)),
      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: active ? T.bg : T.bgSub,
      border: `1px solid ${active ? T.line : T.lineSub}`,
      padding: Math.max(1, Math.round(size * 0.12)),
    }}>
      <img src={VAULT_ICON_SRC} alt="" aria-hidden="true" style={{
        width: '100%', height: '100%', display: 'block', objectFit: 'contain',
      }} />
    </span>
  );
}
