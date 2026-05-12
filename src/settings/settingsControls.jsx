// Shared settings controls and section icons.

function H({ T, label, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 22, fontWeight: 750, color: T.ink, letterSpacing: 0 }}>{label}</div>
      {sub && <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13.5, color: T.inkMed, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}

function SettingsCard({ T, children, style = {} }) {
  return (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bgElevated || T.bg,
      overflow: 'hidden',
      boxShadow: typeof mnShadow === 'function'
        ? mnShadow(T, 'soft')
        : `0 12px 30px color-mix(in oklab, ${T.ink} 4%, transparent)`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Row({ T, label, sub, children, last = false }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(210px, max-content)',
      alignItems: 'center',
      gap: 18,
      padding: '14px 16px',
      borderBottom: last ? 'none' : `1px solid ${T.lineSub}`,
      background: T.bg,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.2, fontWeight: 650, color: T.ink }}>{label}</div>
        {sub && <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12, color: T.inkMed, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      <div style={{ minWidth: 0, justifySelf: 'end' }}>{children}</div>
    </div>
  );
}

function Segmented({ T, value, onChange, options }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))`,
      gap: 3,
      background: T.bgSub,
      border: `1px solid ${T.lineSub}`, borderRadius: 7, padding: 3,
      maxWidth: '100%',
      minWidth: options.length > 1 ? 220 : undefined,
      boxSizing: 'border-box',
    }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          minWidth: 0,
          minHeight: 28,
          padding: '5px 10px', borderRadius: 5, border: 'none',
          background: value === o.value ? T.bg : 'transparent',
          color: value === o.value ? T.ink : T.inkMed,
          fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          fontWeight: value === o.value ? 500 : 400,
          boxShadow: value === o.value ? `0 1px 2px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
          textTransform: 'capitalize',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ T, checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: 34, height: 20, borderRadius: 10, border: 'none', padding: 0,
      background: checked ? T.accent : T.line, cursor: 'pointer',
      position: 'relative', transition: 'background 140ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: T.bg, transition: 'left 140ms',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

function Select({ T, value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{
      padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.line}`,
      background: T.bg, color: T.ink, fontFamily: 'var(--mn-ui)', fontSize: 12.5,
      cursor: 'pointer', minWidth: 190,
      outline: 'none',
    }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'x-large', label: 'XL' },
];

function FontSizeStepper({ T, value, onChange }) {
  const current = value || 'default';
  const idx = FONT_SIZE_OPTIONS.findIndex(o => o.value === current);
  const safeIdx = idx === -1 ? 1 : idx;
  const setByDelta = (delta) => {
    const next = Math.max(0, Math.min(FONT_SIZE_OPTIONS.length - 1, safeIdx + delta));
    onChange(FONT_SIZE_OPTIONS[next].value);
  };
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      border: `1px solid ${T.lineSub}`, borderRadius: 6,
      background: T.bgSub, overflow: 'hidden',
    }}>
      <button onClick={() => setByDelta(-1)} disabled={safeIdx === 0} style={stepBtn(T, safeIdx === 0)}>-</button>
      <select value={current} onChange={(e) => onChange(e.target.value)} style={{
        border: 'none', borderLeft: `1px solid ${T.lineSub}`, borderRight: `1px solid ${T.lineSub}`,
        background: T.bg, color: T.ink, fontFamily: 'var(--mn-ui)', fontSize: 12,
        padding: '5px 8px', outline: 'none',
      }}>
        {FONT_SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button onClick={() => setByDelta(1)} disabled={safeIdx === FONT_SIZE_OPTIONS.length - 1} style={stepBtn(T, safeIdx === FONT_SIZE_OPTIONS.length - 1)}>+</button>
    </div>
  );
}

function stepBtn(T, disabled) {
  return {
    width: 28, height: 28,
    border: 'none', background: 'transparent',
    color: disabled ? T.inkDim : T.ink,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'var(--mn-ui)', fontSize: 14,
  };
}

// ───── sections ─────


const iconAppearance = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5V13.5M2.5 8H13.5"/></svg>);
const iconEditor = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 12L12 3L13.5 4.5L4.5 13.5L2.5 14L3 12Z"/></svg>);
const iconNotes = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 2.5H11L13 4.5V13.5H3V2.5Z"/><path d="M11 2.5V4.5H13"/><path d="M5 7H11M5 9.5H11M5 12H9"/></svg>);
const iconBell = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 11V7C4 5 5.5 3.5 8 3.5C10.5 3.5 12 5 12 7V11L13 12.5H3L4 11Z"/><path d="M7 14H9"/></svg>);
const iconAI = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" strokeLinejoin="round"/><path d="M4 3.5L4.8 5.2L6.5 6L4.8 6.8L4 8.5L3.2 6.8L1.5 6L3.2 5.2L4 3.5Z" strokeLinejoin="round"/></svg>);
const iconPlugin = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M6.2 2.5H9.8L10.4 4.4L12.2 3.5L14 6.6L12.4 7.8L14 9L12.2 12.1L10.4 11.2L9.8 13.5H6.2L5.6 11.2L3.8 12.1L2 9L3.6 7.8L2 6.6L3.8 3.5L5.6 4.4L6.2 2.5Z" strokeLinejoin="round"/><circle cx="8" cy="8" r="1.8"/></svg>);
const iconData = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4V8C3 9 5.2 10 8 10S13 9 13 8V4M3 8V12C3 13 5.2 14 8 14S13 13 13 12V8"/></svg>);
const iconKey = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="4" width="12" height="8" rx="1"/><path d="M5 7V7.01M8 7V7.01M11 7V7.01M5 10H11"/></svg>);
const iconInfo = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 7V11M8 5V5.01" strokeLinecap="round"/></svg>);


window.MN_SETTINGS_CONTROLS = {
  H,
  SettingsCard,
  Row,
  Segmented,
  Toggle,
  Select,
  FontSizeStepper,
  icons: {
    iconAppearance,
    iconEditor,
    iconNotes,
    iconBell,
    iconAI,
    iconPlugin,
    iconData,
    iconKey,
    iconInfo,
  },
};
