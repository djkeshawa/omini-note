// Theme + design tokens for VispNote.
// Cool minimal: near-white canvas, slate ink, mono indigo accent.

const MN_THEMES = {
  light: {
    bgOuter: 'oklch(0.935 0.012 248)',     // desk behind window
    bg:      'oklch(0.992 0.004 255)',     // primary canvas
    bgSub:   'oklch(0.968 0.008 252)',     // sidebar / list pane
    bgElevated: 'oklch(1 0.003 255)',
    bgInput: 'oklch(0.982 0.006 252)',
    bgHover: 'oklch(0.948 0.012 252)',
    bgActive:'oklch(0.925 0.018 258)',
    line:    'oklch(0.875 0.010 250)',
    lineSub: 'oklch(0.925 0.008 250)',
    lineStrong: 'oklch(0.78 0.018 248)',
    ink:     'oklch(0.20 0.016 252)',
    inkMed:  'oklch(0.43 0.016 252)',
    inkDim:  'oklch(0.59 0.014 252)',
    accent:  'oklch(0.52 0.14 258)',       // indigo
    accentSoft: 'oklch(0.93 0.04 258)',
    danger:  'oklch(0.58 0.18 25)',
    dangerSoft: 'oklch(0.96 0.035 25)',
    success: 'oklch(0.60 0.13 160)',
    successSoft: 'oklch(0.95 0.035 160)',
    warn:    'oklch(0.72 0.14 70)',
    warnSoft: 'oklch(0.965 0.045 72)',
    selBg:   'oklch(0.955 0.012 258)',
    selLine: 'oklch(0.88 0.03 258)',
    focus:   'oklch(0.60 0.16 258)',
    overlay: 'oklch(0.22 0.012 250 / 0.32)',
    shadowSoft: 'color-mix(in oklab, oklch(0.20 0.016 252) 9%, transparent)',
    shadowElevated: 'color-mix(in oklab, oklch(0.20 0.016 252) 20%, transparent)',
  },
  dark: {
    bgOuter: 'oklch(0.14 0.010 250)',
    bg:      'oklch(0.185 0.012 250)',
    bgSub:   'oklch(0.158 0.012 250)',
    bgElevated: 'oklch(0.215 0.014 250)',
    bgInput: 'oklch(0.135 0.012 250)',
    bgHover: 'oklch(0.235 0.016 250)',
    bgActive:'oklch(0.30 0.026 258)',
    line:    'oklch(0.31 0.016 250)',
    lineSub: 'oklch(0.255 0.014 250)',
    lineStrong: 'oklch(0.39 0.018 250)',
    ink:     'oklch(0.94 0.006 250)',
    inkMed:  'oklch(0.76 0.012 250)',
    inkDim:  'oklch(0.61 0.012 250)',
    accent:  'oklch(0.74 0.13 258)',
    accentSoft: 'oklch(0.31 0.065 258)',
    danger:  'oklch(0.68 0.17 25)',
    dangerSoft: 'oklch(0.25 0.06 25)',
    success: 'oklch(0.72 0.13 160)',
    successSoft: 'oklch(0.25 0.055 160)',
    warn:    'oklch(0.80 0.14 80)',
    warnSoft: 'oklch(0.27 0.06 78)',
    selBg:   'oklch(0.27 0.045 258)',
    selLine: 'oklch(0.46 0.085 258)',
    focus:   'oklch(0.78 0.14 258)',
    overlay: 'oklch(0.08 0.006 250 / 0.48)',
    shadowSoft: 'color-mix(in oklab, black 18%, transparent)',
    shadowElevated: 'color-mix(in oklab, black 34%, transparent)',
  },
  pastel: {
    bgOuter: 'oklch(0.945 0.035 248)',
    bg:      'oklch(0.990 0.014 45)',
    bgSub:   'oklch(0.966 0.026 292)',
    bgElevated: 'oklch(0.998 0.012 35)',
    bgInput: 'oklch(0.978 0.020 326)',
    bgHover: 'oklch(0.952 0.028 248)',
    bgActive:'oklch(0.930 0.040 292)',
    line:    'oklch(0.862 0.030 286)',
    lineSub: 'oklch(0.920 0.020 26)',
    lineStrong: 'oklch(0.760 0.045 286)',
    ink:     'oklch(0.245 0.030 278)',
    inkMed:  'oklch(0.455 0.032 278)',
    inkDim:  'oklch(0.615 0.028 278)',
    accent:  'oklch(0.570 0.140 286)',
    accentSoft: 'oklch(0.930 0.055 292)',
    danger:  'oklch(0.60 0.16 18)',
    dangerSoft: 'oklch(0.955 0.052 18)',
    success: 'oklch(0.58 0.12 158)',
    successSoft: 'oklch(0.94 0.050 158)',
    warn:    'oklch(0.72 0.13 55)',
    warnSoft: 'oklch(0.955 0.052 55)',
    selBg:   'oklch(0.940 0.045 330)',
    selLine: 'oklch(0.820 0.065 300)',
    focus:   'oklch(0.600 0.150 286)',
    overlay: 'oklch(0.320 0.040 278 / 0.30)',
    shadowSoft: 'color-mix(in oklab, oklch(0.34 0.050 300) 10%, transparent)',
    shadowElevated: 'color-mix(in oklab, oklch(0.34 0.050 300) 22%, transparent)',
  }
};

const MN_FONTS = {
  'Editorial (Newsreader + Inter)': {
    ui: `'Inter Tight', ui-sans-serif, system-ui, -apple-system, sans-serif`,
    body: `'Newsreader', Georgia, 'Times New Roman', serif`,
    mono: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`,
  },
  'Neutral (Inter only)': {
    ui: `'Inter Tight', ui-sans-serif, system-ui, sans-serif`,
    body: `'Inter Tight', ui-sans-serif, system-ui, sans-serif`,
    mono: `'JetBrains Mono', ui-monospace, Menlo, monospace`,
  },
  'Technical (IBM Plex)': {
    ui: `'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif`,
    body: `'IBM Plex Serif', Georgia, serif`,
    mono: `'IBM Plex Mono', ui-monospace, Menlo, monospace`,
  },
  'Quiet (Instrument Serif)': {
    ui: `'Inter Tight', ui-sans-serif, system-ui, sans-serif`,
    body: `'Instrument Serif', Georgia, serif`,
    mono: `'JetBrains Mono', ui-monospace, Menlo, monospace`,
  },
};

function mnGetTagColor(hue, theme) {
  if (theme === 'dark') return `oklch(0.72 0.10 ${hue})`;
  return `oklch(0.52 0.12 ${hue})`;
}
function mnGetTagBg(hue, theme) {
  if (theme === 'dark') return `oklch(0.28 0.05 ${hue})`;
  return `oklch(0.96 0.03 ${hue})`;
}

function mnTagHueMap(tags = []) {
  return new Map((Array.isArray(tags) ? tags : [])
    .filter(tag => tag && typeof tag.name === 'string')
    .map(tag => [tag.name, tag.hue]));
}

function mnShadow(T, level = 'soft') {
  if (level === 'elevated') return `0 18px 46px ${T.shadowElevated || `color-mix(in oklab, ${T.ink} 18%, transparent)`}`;
  if (level === 'popover') return `0 12px 32px ${T.shadowElevated || `color-mix(in oklab, ${T.ink} 18%, transparent)`}, 0 1px 2px ${T.shadowSoft || `color-mix(in oklab, ${T.ink} 8%, transparent)`}`;
  return `0 8px 22px ${T.shadowSoft || `color-mix(in oklab, ${T.ink} 8%, transparent)`}`;
}

function mnIconButtonStyle(T, active = false, size = 28) {
  return {
    width: size,
    height: size,
    borderRadius: 6,
    border: `1px solid ${active ? T.selLine : T.lineSub}`,
    background: active ? T.accentSoft : T.bgElevated || T.bg,
    color: active ? T.accent : T.inkMed,
    cursor: 'pointer',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: active ? mnShadow(T, 'soft') : 'none',
  };
}

export { MN_FONTS, MN_THEMES, mnGetTagBg, mnGetTagColor, mnIconButtonStyle, mnShadow, mnTagHueMap };
