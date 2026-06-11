const fs = require('fs');
const path = require('path');

const THEME_FORMAT = 'vispnote.theme.v1';
const MAX_THEME_FILE_BYTES = 64 * 1024;
const MAX_CUSTOM_THEMES = 48;
const RESERVED_THEME_IDS = new Set(['light', 'dark', 'pastel']);
const THEME_TOKEN_KEYS = Object.freeze([
  'bgOuter',
  'bg',
  'bgSub',
  'bgElevated',
  'bgInput',
  'bgHover',
  'bgActive',
  'line',
  'lineSub',
  'lineStrong',
  'ink',
  'inkMed',
  'inkDim',
  'accent',
  'accentSoft',
  'danger',
  'dangerSoft',
  'success',
  'successSoft',
  'warn',
  'warnSoft',
  'selBg',
  'selLine',
  'focus',
  'overlay',
  'shadowSoft',
  'shadowElevated',
]);
const THEME_TOKEN_SET = new Set(THEME_TOKEN_KEYS);
const THEME_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const SAFE_TOKEN_VALUE_RE = /^[A-Za-z0-9#().,%\s+/_-]+$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const THEME_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);
const THEME_PREVIEW_SWATCHES = Object.freeze({
  background: 'bg',
  surface: 'bgElevated',
  text: 'ink',
  accent: 'accent',
  success: 'success',
  warning: 'warn',
  danger: 'danger',
  focus: 'focus',
});
const THEME_CONTRAST_CHECKS = Object.freeze([
  { foreground: 'ink', background: 'bg', minDelta: 0.45, label: 'body text' },
  { foreground: 'inkMed', background: 'bg', minDelta: 0.34, label: 'secondary text' },
  { foreground: 'ink', background: 'bgInput', minDelta: 0.45, label: 'input text' },
  { foreground: 'accent', background: 'bg', minDelta: 0.24, label: 'accent actions' },
  { foreground: 'danger', background: 'bg', minDelta: 0.24, label: 'danger actions' },
  { foreground: 'success', background: 'bg', minDelta: 0.24, label: 'success actions' },
  { foreground: 'warn', background: 'bg', minDelta: 0.20, label: 'warning actions' },
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unsafeFileError(message) {
  const error = new Error(message);
  error.code = 'UNSAFE_FILE';
  return error;
}

function assertSafeKey(key, label) {
  if (UNSAFE_KEYS.has(key)) throw new Error(`Unsafe ${label} key: ${key}`);
}

function cleanString(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maxLength) throw new Error(`${label} is too long`);
  return text;
}

function cleanThemeId(value) {
  const id = cleanString(value, 'Theme id', 64);
  if (!THEME_ID_RE.test(id)) throw new Error('Theme id must start with a lowercase letter and use only lowercase letters, numbers, hyphens, or underscores');
  if (RESERVED_THEME_IDS.has(id)) throw new Error(`Theme id "${id}" is reserved`);
  return id;
}

function cleanTokenValue(value, token) {
  const text = cleanString(value, `Theme token ${token}`, 180);
  const lower = text.toLowerCase();
  if (!SAFE_TOKEN_VALUE_RE.test(text)) throw new Error(`Unsafe theme token value for ${token}`);
  if (lower.includes('url(') || lower.includes('@import') || lower.includes('expression(') || lower.includes('javascript')) {
    throw new Error(`Unsafe theme token value for ${token}`);
  }
  return text;
}

function cleanOptionalString(value, maxLength) {
  return value == null ? '' : String(value || '').replace(/\0/g, '').trim().slice(0, maxLength);
}

function themeTokenCoverage(tokens = {}) {
  const keys = isPlainObject(tokens) ? Object.keys(tokens) : [];
  const keySet = new Set(keys);
  const present = THEME_TOKEN_KEYS.filter(key => keySet.has(key));
  const missing = THEME_TOKEN_KEYS.filter(key => !keySet.has(key));
  const unsupported = keys.filter(key => !THEME_TOKEN_SET.has(key));
  return {
    required: THEME_TOKEN_KEYS.length,
    present: present.length,
    percent: Math.round((present.length / THEME_TOKEN_KEYS.length) * 100),
    complete: missing.length === 0 && unsupported.length === 0,
    missing,
    unsupported,
  };
}

function parseHexLightness(value) {
  const hex = String(value || '').trim();
  const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const raw = match[1].length === 3
    ? match[1].split('').map(ch => ch + ch).join('')
    : match[1];
  const channels = [0, 2, 4].map(index => parseInt(raw.slice(index, index + 2), 16) / 255);
  const linear = channels.map(channel => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function parseOklchLightness(value) {
  const match = String(value || '').trim().match(/^oklch\(\s*([0-9.]+)\s*%?/i);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  const lightness = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, lightness));
}

function themeColorLightness(value) {
  return parseOklchLightness(value) ?? parseHexLightness(value);
}

function themeContrastReport(tokens = {}) {
  const checks = THEME_CONTRAST_CHECKS.map(check => {
    const foregroundLightness = themeColorLightness(tokens[check.foreground]);
    const backgroundLightness = themeColorLightness(tokens[check.background]);
    const delta = foregroundLightness == null || backgroundLightness == null
      ? null
      : Math.abs(foregroundLightness - backgroundLightness);
    const passed = delta != null && delta >= check.minDelta;
    return {
      ...check,
      foregroundValue: tokens[check.foreground] || '',
      backgroundValue: tokens[check.background] || '',
      delta: delta == null ? null : Number(delta.toFixed(3)),
      passed,
    };
  });
  return {
    passed: checks.every(check => check.passed),
    checks,
    failures: checks.filter(check => !check.passed),
  };
}

function assertThemeContrast(tokens = {}) {
  const report = themeContrastReport(tokens);
  if (!report.passed) {
    const names = report.failures.map(check => check.label).join(', ');
    throw new Error(`Theme contrast is too low for ${names}`);
  }
  return report;
}

function themeSwatches(tokens = {}) {
  return Object.fromEntries(Object.entries(THEME_PREVIEW_SWATCHES)
    .map(([name, token]) => [name, tokens[token] || ''])
    .filter(([, value]) => value));
}

function themePreview(theme) {
  const coverage = themeTokenCoverage(theme.tokens);
  const contrast = themeContrastReport(theme.tokens);
  return {
    id: theme.id,
    name: theme.name,
    author: theme.author || '',
    source: theme.source || '',
    description: theme.description || '',
    swatches: themeSwatches(theme.tokens),
    coverage,
    contrast: {
      passed: contrast.passed,
      failures: contrast.failures.map(check => ({
        label: check.label,
        foreground: check.foreground,
        background: check.background,
        delta: check.delta,
        minDelta: check.minDelta,
      })),
    },
  };
}

function sanitizeTheme(rawTheme, options = {}) {
  if (!isPlainObject(rawTheme)) throw new Error('Theme file must contain an object');
  for (const key of Object.keys(rawTheme)) assertSafeKey(key, 'theme');
  const format = cleanString(rawTheme.format, 'Theme format', 80);
  if (format !== THEME_FORMAT) throw new Error(`Unsupported theme format: ${format}`);
  const id = cleanThemeId(rawTheme.id);
  const name = cleanString(rawTheme.name, 'Theme name', 80);
  const description = cleanOptionalString(rawTheme.description, 240);
  const author = cleanOptionalString(rawTheme.author, 120);
  const source = cleanOptionalString(rawTheme.source || options.source, 180);
  const tokens = rawTheme.tokens;
  if (!isPlainObject(tokens)) throw new Error('Theme tokens are required');
  const coverage = themeTokenCoverage(tokens);
  if (coverage.unsupported.length) throw new Error(`Unsupported theme token: ${coverage.unsupported[0]}`);
  if (coverage.missing.length) throw new Error(`Missing theme token: ${coverage.missing[0]}`);
  for (const key of Object.keys(tokens)) {
    assertSafeKey(key, 'theme token');
  }
  const cleanTokens = {};
  for (const key of THEME_TOKEN_KEYS) {
    cleanTokens[key] = cleanTokenValue(tokens[key], key);
  }
  assertThemeContrast(cleanTokens);
  const theme = {
    id,
    name,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(source ? { source } : {}),
    tokens: cleanTokens,
  };
  return { ...theme, preview: themePreview(theme) };
}

function sanitizeStoredThemes(themes) {
  const clean = [];
  const seen = new Set();
  if (!Array.isArray(themes)) return clean;
  for (const theme of themes) {
    try {
      const next = sanitizeTheme({ format: THEME_FORMAT, ...theme });
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      clean.push(next);
      if (clean.length >= MAX_CUSTOM_THEMES) break;
    } catch {}
  }
  return clean;
}

function upsertCustomTheme(currentThemes, rawTheme) {
  const theme = sanitizeTheme(rawTheme?.format ? rawTheme : { format: THEME_FORMAT, ...rawTheme });
  const current = sanitizeStoredThemes(currentThemes);
  const index = current.findIndex(item => item.id === theme.id);
  if (index >= 0) throw new Error(`Theme id "${theme.id}" is already installed`);
  if (current.length >= MAX_CUSTOM_THEMES) throw new Error(`Only ${MAX_CUSTOM_THEMES} custom themes can be installed`);
  current.push(theme);
  return { theme, customThemes: current };
}

function parseYamlScalar(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.startsWith('"')) return JSON.parse(text);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function parseThemeYaml(text) {
  const root = {};
  let activeMapKey = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    if (/^\t/.test(rawLine)) throw new Error('Theme YAML cannot use tabs for indentation');
    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) throw new Error(`Unsupported theme YAML line: ${line.slice(0, 80)}`);
    const key = match[1];
    const value = match[2] || '';
    assertSafeKey(key, 'YAML');
    if (indent === 0) {
      if (value === '') {
        root[key] = {};
        activeMapKey = key;
      } else {
        root[key] = parseYamlScalar(value);
        activeMapKey = null;
      }
      continue;
    }
    if (indent < 2 || !activeMapKey || !isPlainObject(root[activeMapKey])) {
      throw new Error(`Unsupported theme YAML indentation near ${key}`);
    }
    root[activeMapKey][key] = parseYamlScalar(value);
  }
  return root;
}

function parseThemeText(text, fileName = 'theme.json') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!THEME_EXTENSIONS.has(ext)) throw new Error('Unsupported theme file type');
  const rawTheme = ext === '.json' ? JSON.parse(String(text || '')) : parseThemeYaml(text);
  return sanitizeTheme(rawTheme, { source: path.basename(String(fileName || '')) });
}

async function readThemeFile(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (!THEME_EXTENSIONS.has(ext)) throw new Error('Unsupported theme file type');
  const stat = await fs.promises.lstat(filePath);
  if (stat.isSymbolicLink()) throw unsafeFileError('Theme file cannot be a symlink');
  if (!stat.isFile()) throw unsafeFileError('Theme file must be a regular file');
  if (stat.size > MAX_THEME_FILE_BYTES) throw new Error('Theme file is too large');
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle = null;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_THEME_FILE_BYTES) throw new Error('Theme file is too large');
    return parseThemeText(text, filePath);
  } catch (e) {
    if (e?.code === 'ELOOP') throw unsafeFileError('Theme file cannot be a symlink');
    throw e;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

module.exports = {
  THEME_FORMAT,
  THEME_TOKEN_KEYS,
  MAX_THEME_FILE_BYTES,
  parseThemeText,
  parseThemeYaml,
  readThemeFile,
  sanitizeTheme,
  sanitizeStoredThemes,
  themeTokenCoverage,
  themeContrastReport,
  themePreview,
  upsertCustomTheme,
};
