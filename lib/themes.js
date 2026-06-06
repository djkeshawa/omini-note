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

function sanitizeTheme(rawTheme) {
  if (!isPlainObject(rawTheme)) throw new Error('Theme file must contain an object');
  for (const key of Object.keys(rawTheme)) assertSafeKey(key, 'theme');
  const format = cleanString(rawTheme.format, 'Theme format', 80);
  if (format !== THEME_FORMAT) throw new Error(`Unsupported theme format: ${format}`);
  const id = cleanThemeId(rawTheme.id);
  const name = cleanString(rawTheme.name, 'Theme name', 80);
  const description = rawTheme.description == null ? '' : String(rawTheme.description || '').trim().slice(0, 240);
  const author = rawTheme.author == null ? '' : String(rawTheme.author || '').trim().slice(0, 120);
  const tokens = rawTheme.tokens;
  if (!isPlainObject(tokens)) throw new Error('Theme tokens are required');
  for (const key of Object.keys(tokens)) {
    assertSafeKey(key, 'theme token');
    if (!THEME_TOKEN_SET.has(key)) throw new Error(`Unsupported theme token: ${key}`);
  }
  const cleanTokens = {};
  for (const key of THEME_TOKEN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(tokens, key)) throw new Error(`Missing theme token: ${key}`);
    cleanTokens[key] = cleanTokenValue(tokens[key], key);
  }
  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    tokens: cleanTokens,
  };
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
  if (index >= 0) current[index] = theme;
  else {
    if (current.length >= MAX_CUSTOM_THEMES) throw new Error(`Only ${MAX_CUSTOM_THEMES} custom themes can be installed`);
    current.push(theme);
  }
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
  return sanitizeTheme(rawTheme);
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
  upsertCustomTheme,
};
