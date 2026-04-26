// Theme + design tokens for OminiNote.
// Cool minimal: near-white canvas, slate ink, mono indigo accent.

const MN_THEMES = {
  light: {
    bgOuter: 'oklch(0.955 0.004 240)',     // desk behind window
    bg:      'oklch(0.991 0.003 240)',     // primary canvas
    bgSub:   'oklch(0.975 0.004 240)',     // sidebar / list pane
    bgHover: 'oklch(0.955 0.006 240)',
    bgActive:'oklch(0.935 0.010 250)',
    line:    'oklch(0.905 0.006 240)',
    lineSub: 'oklch(0.945 0.005 240)',
    ink:     'oklch(0.22 0.012 250)',
    inkMed:  'oklch(0.45 0.012 250)',
    inkDim:  'oklch(0.62 0.010 250)',
    accent:  'oklch(0.52 0.14 258)',       // indigo
    accentSoft: 'oklch(0.93 0.04 258)',
    danger:  'oklch(0.58 0.18 25)',
    success: 'oklch(0.60 0.13 160)',
    warn:    'oklch(0.72 0.14 70)',
    selBg:   'oklch(0.955 0.012 258)',
    selLine: 'oklch(0.88 0.03 258)',
  },
  dark: {
    bgOuter: 'oklch(0.14 0.010 250)',
    bg:      'oklch(0.18 0.012 250)',
    bgSub:   'oklch(0.16 0.012 250)',
    bgHover: 'oklch(0.22 0.014 250)',
    bgActive:'oklch(0.27 0.020 258)',
    line:    'oklch(0.27 0.014 250)',
    lineSub: 'oklch(0.23 0.012 250)',
    ink:     'oklch(0.94 0.006 250)',
    inkMed:  'oklch(0.72 0.012 250)',
    inkDim:  'oklch(0.54 0.012 250)',
    accent:  'oklch(0.74 0.13 258)',
    accentSoft: 'oklch(0.28 0.06 258)',
    danger:  'oklch(0.68 0.17 25)',
    success: 'oklch(0.72 0.13 160)',
    warn:    'oklch(0.80 0.14 80)',
    selBg:   'oklch(0.26 0.04 258)',
    selLine: 'oklch(0.42 0.08 258)',
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

window.MN_THEMES = MN_THEMES;
window.MN_FONTS = MN_FONTS;
window.mnGetTagColor = mnGetTagColor;
window.mnGetTagBg = mnGetTagBg;
