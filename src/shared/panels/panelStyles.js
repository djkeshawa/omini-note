function mnPanelButton(T, primary = false) {
  return {
    minHeight: 34,
    borderRadius: 7,
    border: `1px solid ${primary ? T.ink : T.line}`,
    background: primary ? T.ink : T.bg,
    color: primary ? T.bg : T.inkMed,
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '7px 11px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function mnPanelMiniButton(T) {
  return {
    minHeight: 26,
    borderRadius: 6,
    border: `1px solid ${T.lineSub}`,
    background: T.bgSub,
    color: T.inkMed,
    fontFamily: 'var(--mn-ui)',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '4px 8px',
  };
}

function mnPanelInputStyle(T) {
  return {
    minHeight: 32,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 6,
    background: T.bg,
    color: T.ink,
    padding: '6px 8px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    outline: 'none',
    boxSizing: 'border-box',
  };
}

function mnPanelTextareaStyle(T) {
  return {
    width: '100%',
    minHeight: 76,
    resize: 'vertical',
    border: `1px solid ${T.lineSub}`,
    borderRadius: 6,
    background: T.bg,
    color: T.ink,
    padding: '7px 8px',
    fontFamily: 'var(--mn-body)',
    fontSize: 12.5,
    lineHeight: 1.45,
    outline: 'none',
    boxSizing: 'border-box',
  };
}

function mnPanelMenuItem(T) {
  return {
    width: '100%',
    border: 'none',
    borderRadius: 5,
    background: 'transparent',
    color: T.ink,
    cursor: 'pointer',
    padding: '8px 10px',
    textAlign: 'left',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
  };
}

// ────────────────────────────────────────────────────────────
// Workflow aggregate panel
// ────────────────────────────────────────────────────────────

export { mnPanelButton, mnPanelMiniButton, mnPanelInputStyle, mnPanelTextareaStyle, mnPanelMenuItem };
