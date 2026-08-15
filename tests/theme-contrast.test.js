const assert = require('node:assert/strict');
const test = require('node:test');

const { loadRendererModule } = require('./helpers/rendererModule.js');

// WCAG AA for dim text. The tokens are authored in oklch, so the ratio has to
// be computed the way a browser would: oklch -> Oklab -> linear sRGB (clamped
// into gamut, which is what the compositor does with an out-of-gamut colour)
// -> relative luminance.
function parseOklch(value) {
  const match = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+(-?[\d.]+)/i.exec(String(value || ''));
  if (!match) return null;
  const lightness = match[1].endsWith('%') ? Number(match[1].slice(0, -1)) / 100 : Number(match[1]);
  return { L: lightness, C: Number(match[2]), H: Number(match[3]) };
}

function oklchToLinearRgb({ L, C, H }) {
  const hue = (H * Math.PI) / 180;
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);
  const long = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short,
  ].map(channel => Math.min(1, Math.max(0, channel)));
}

function relativeLuminance(value) {
  const parsed = parseOklch(value);
  assert.ok(parsed, `expected an oklch() token, got ${value}`);
  const [r, g, b] = oklchToLinearRgb(parsed);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('the contrast helper reproduces the reference black-on-white ratio', () => {
  const ratio = contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)');
  assert.ok(Math.abs(ratio - 21) < 0.01, `expected 21:1, got ${ratio}`);
});

test('every shipped theme keeps inkDim, warn and success at WCAG AA on both canvases', () => {
  const { MN_THEMES } = loadRendererModule('src/shared/theme.jsx');
  const themeNames = Object.keys(MN_THEMES);
  assert.ok(themeNames.length >= 3, 'expected the shipped theme table to be loaded');

  // Iterating the table rather than a hardcoded list is the point: a fourth
  // theme cannot ship below AA without failing here.
  for (const name of themeNames) {
    const T = MN_THEMES[name];
    for (const token of ['inkDim', 'warn', 'success']) {
      for (const surface of ['bg', 'bgSub']) {
        const ratio = contrastRatio(T[token], T[surface]);
        assert.ok(
          ratio >= 4.5,
          `${name}.${token} on ${name}.${surface} is ${ratio.toFixed(2)}:1, below the 4.5:1 AA floor`,
        );
      }
    }
  }
});

test('mnThemeColorScheme reads the background lightness, not theme identity', () => {
  const { MN_THEMES, mnThemeColorScheme } = loadRendererModule('src/shared/theme.jsx');
  assert.equal(mnThemeColorScheme(MN_THEMES.light), 'light');
  assert.equal(mnThemeColorScheme(MN_THEMES.dark), 'dark');
  assert.equal(mnThemeColorScheme(MN_THEMES.pastel), 'light');
  // An imported custom theme is a plain object; it must resolve on its own bg.
  assert.equal(mnThemeColorScheme({ bg: 'oklch(0.17 0.01 250)' }), 'dark');
  assert.equal(mnThemeColorScheme({ bg: 'oklch(88% 0.01 250)' }), 'light');
  // Hex too: custom themes are hand-authored, and reading only oklch gave a
  // hex-written dark theme light scrollbars on its own dark canvas.
  assert.equal(mnThemeColorScheme({ bg: '#101010' }), 'dark');
  assert.equal(mnThemeColorScheme({ bg: '#000' }), 'dark');
  assert.equal(mnThemeColorScheme({ bg: '#fafafa' }), 'light');
  assert.equal(mnThemeColorScheme({ bg: '#fff' }), 'light');
  assert.equal(mnThemeColorScheme({ bg: 'rebeccapurple' }), 'light');
  assert.equal(mnThemeColorScheme(null), 'light');
});
