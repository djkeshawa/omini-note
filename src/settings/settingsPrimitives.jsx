

function uniqueOptions(values) {
  return [...new Set(values.filter(Boolean))];
}

function mnAiInput(T, minWidth = 220) {
  return {
    padding: '6px 10px',
    borderRadius: 6,
    border: `1px solid ${T.line}`,
    background: T.bg,
    color: T.ink,
    fontFamily: 'var(--mn-mono)',
    fontSize: 12,
    minWidth,
    outline: 'none',
  };
}

function mnSettingsInput(T, options = {}) {
  return {
    width: options.width,
    flex: options.flex,
    minWidth: options.minWidth ?? 180,
    padding: '6px 10px',
    borderRadius: 6,
    border: options.border || `1px solid ${T.line}`,
    background: T.bg,
    color: T.ink,
    fontFamily: options.fontFamily || 'var(--mn-ui)',
    fontSize: 12,
    outline: 'none',
  };
}

function BtnOutline({ T, children, danger, disabled, onClick }) {
  return (
    <button disabled={disabled} onClick={onClick} style={{
      minHeight: 30,
      padding: '6px 12px',
      borderRadius: 6,
      cursor: disabled ? 'default' : 'pointer',
      background: T.bg,
      border: `1px solid ${danger ? T.danger : T.line}`,
      color: disabled ? T.inkDim : danger ? T.danger : T.inkMed,
      fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
      opacity: disabled ? 0.62 : 1,
    }}>{children}</button>
  );
}

function StaticValue({ T, children }) {
  return (
    <span style={{
      minHeight: 28,
      display: 'inline-flex',
      alignItems: 'center',
      padding: '5px 10px',
      borderRadius: 6,
      border: `1px solid ${T.lineSub}`,
      background: T.bgSub,
      color: T.inkMed,
      fontFamily: 'var(--mn-ui)',
      fontSize: 12,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

export { uniqueOptions, mnAiInput, mnSettingsInput, BtnOutline, StaticValue };
