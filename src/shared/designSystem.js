// VispNote design system.
//
// Colour tokens stay in theme.jsx and keep their existing names; this module
// owns everything the theme had no rule for: the type ramp, the geometry, and
// the handful of patterns that repeat across every surface.
//
// Rules this encodes, so they only have to be decided once:
//   - Mono is for machine values only: counts, paths, times, word counts,
//     accelerators. Never a section label.
//   - Sentence case everywhere. No Title Case, no ALL CAPS.
//   - Serif is the writing voice: note bodies, snippets, dialog consequences,
//     empty-state headlines. Interface stays sans.
//   - One primary action per surface.

// ── Sentence case ───────────────────────────────────────────────────────────
//
// For labels that arrive from data as identifiers (workflow state ids like
// TODO/DOING, legacy ALL-CAPS names). Leaves already-cased words alone so
// "Ask AI" and "VispNote" survive.

function mnSentenceCase(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  // Only rewrite when the whole string is shouting.
  if (text !== text.toUpperCase() || /[a-z]/.test(text)) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ── Geometry ────────────────────────────────────────────────────────────────

// 6 icon squares · 8 controls · 10 rows and cards · 12 panels and dialogs.
const DS_RADIUS = {
  icon: 6,
  control: 8,
  row: 10,
  panel: 12,
  pill: 999,
};

const DS_HEIGHT = {
  chip: 26,
  toolbar: 28,
  primary: 32,
  navRow: 34,
  appBar: 44,
  paneHeader: 46,
  panelHeader: 52,
};

// Comfortable density matches the design frames. Compact trims 32px, which
// keeps every pane on the 8px grid.
const DS_PANE = {
  sidebar: 248,
  noteList: 336,
  connections: 292,
  aiChatList: 264,
  // Prose column cap. Wider than this and lines stop being readable.
  editorColumn: 656,
};

const DS_COMPACT_TRIM = 32;

function dsPaneWidth(pane, density) {
  const base = DS_PANE[pane];
  if (base == null) return undefined;
  return density === 'compact' ? base - DS_COMPACT_TRIM : base;
}

// ── Type ramp ───────────────────────────────────────────────────────────────

const DS_TYPE = {
  // Newsreader — the writing voice.
  noteTitle: { fontFamily: 'var(--mn-body)', fontSize: 34, fontWeight: 600, lineHeight: 1.15 },
  sectionHead: { fontFamily: 'var(--mn-body)', fontSize: 21, fontWeight: 600, lineHeight: 1.25 },
  prose: { fontFamily: 'var(--mn-body)', fontSize: 15, lineHeight: 1.62 },
  // Inter Tight — the interface.
  paneTitle: { fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600 },
  rowTitle: { fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600 },
  control: { fontFamily: 'var(--mn-ui)', fontSize: 12.5 },
  groupLabel: { fontFamily: 'var(--mn-ui)', fontSize: 11, fontWeight: 600 },
  // JetBrains Mono — machine values only.
  machine: { fontFamily: 'var(--mn-mono)', fontSize: 10.5 },
};

// Replaces every mono ALL-CAPS eyebrow. Sentence case, no letter-spacing.
function dsGroupLabelStyle(T) {
  return { ...DS_TYPE.groupLabel, color: T.inkDim };
}

function dsMachineStyle(T, color) {
  return { ...DS_TYPE.machine, color: color || T.inkDim };
}

// ── Pattern: selected row ───────────────────────────────────────────────────
//
// selBg fill, selLine border, 2.5px accent bar inset left.
// One selected row per pane.

function dsSelectedRow(T, active, { height = DS_HEIGHT.navRow, radius = DS_RADIUS.control } = {}) {
  return {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: height,
    padding: '0 10px 0 8px',
    borderRadius: radius,
    boxSizing: 'border-box',
    cursor: 'pointer',
    userSelect: 'none',
    background: active ? T.selBg : 'transparent',
    border: `1px solid ${active ? T.selLine : 'transparent'}`,
    color: active ? T.ink : T.inkMed,
    ...DS_TYPE.rowTitle,
    fontWeight: active ? 600 : 400,
    transition: 'background 80ms',
  };
}

// The 2.5px accent bar. Render as the first child of a dsSelectedRow.
function dsSelectedBarStyle(T, inset = 7) {
  return {
    position: 'absolute',
    left: 0,
    top: inset,
    bottom: inset,
    width: 2.5,
    borderRadius: 2,
    background: T.accent,
  };
}

// ── Pattern: status pill ────────────────────────────────────────────────────
//
// Dot plus sentence-case word. Never an uppercase mono badge.
// State is stated, not abbreviated.

const DS_TONES = ['neutral', 'success', 'warn', 'danger', 'accent'];

function dsToneColor(T, tone) {
  if (tone === 'success') return T.success;
  if (tone === 'warn') return T.warn;
  if (tone === 'danger') return T.danger;
  if (tone === 'accent') return T.accent;
  return T.inkDim;
}

function dsStatusPillStyle(T, { sunken = false } = {}) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: DS_HEIGHT.chip,
    padding: '0 10px',
    borderRadius: DS_RADIUS.pill,
    background: sunken ? T.bgSub : T.bg,
    border: `1px solid ${T.lineSub}`,
    color: T.inkMed,
    fontFamily: 'var(--mn-ui)',
    fontSize: 11.5,
    whiteSpace: 'nowrap',
  };
}

function dsStatusDotStyle(T, tone) {
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    background: dsToneColor(T, tone),
  };
}

// ── Pattern: tone icon ──────────────────────────────────────────────────────
//
// The rounded square that opens a dialog or heads an empty state.

function dsToneIconStyle(T, tone, size = 34) {
  const color = dsToneColor(T, tone);
  const neutral = tone === 'neutral' || !tone;
  return {
    width: size,
    height: size,
    borderRadius: size >= 32 ? DS_RADIUS.row : 9,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: neutral ? T.inkDim : color,
    background: neutral ? T.bgSub : `color-mix(in oklab, ${color} 12%, transparent)`,
    border: `1px solid ${neutral ? T.lineSub : `color-mix(in oklab, ${color} 24%, ${T.lineSub})`}`,
  };
}

// ── Buttons ─────────────────────────────────────────────────────────────────
//
// One primary action per surface. Everything else is bordered or a ⋯ menu.

function dsButtonStyle(T, variant = 'default', { height = DS_HEIGHT.toolbar } = {}) {
  const base = {
    height,
    padding: `0 ${height >= DS_HEIGHT.primary ? 13 : 11}px`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: DS_RADIUS.control,
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  };
  if (variant === 'primary') {
    return { ...base, border: `1px solid ${T.ink}`, background: T.ink, color: T.bg, fontWeight: 650 };
  }
  if (variant === 'danger') {
    return { ...base, border: `1px solid ${T.danger}`, background: T.danger, color: T.bg, fontWeight: 650 };
  }
  if (variant === 'ghost') {
    return { ...base, border: '1px solid transparent', background: 'transparent', color: T.inkMed };
  }
  return { ...base, border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed };
}

// ── Containers ──────────────────────────────────────────────────────────────

function dsPanelStyle(T) {
  return {
    borderRadius: DS_RADIUS.panel,
    border: `1px solid ${T.lineSub}`,
    background: T.bgSub,
  };
}

function dsCardStyle(T) {
  return {
    borderRadius: DS_RADIUS.row,
    border: `1px solid ${T.lineSub}`,
    background: T.bgElevated || T.bg,
  };
}

// Pane header: the 46px strip at the top of a list pane.
function dsPaneHeaderStyle(T, height = DS_HEIGHT.paneHeader) {
  return {
    height,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    boxSizing: 'border-box',
    borderBottom: `1px solid ${T.lineSub}`,
  };
}

export {
  DS_COMPACT_TRIM,
  DS_HEIGHT,
  DS_PANE,
  DS_RADIUS,
  DS_TONES,
  DS_TYPE,
  dsButtonStyle,
  dsCardStyle,
  dsGroupLabelStyle,
  dsMachineStyle,
  dsPaneHeaderStyle,
  dsPaneWidth,
  dsPanelStyle,
  dsSelectedBarStyle,
  dsSelectedRow,
  dsStatusDotStyle,
  dsStatusPillStyle,
  dsToneColor,
  dsToneIconStyle,
  mnSentenceCase,
};
