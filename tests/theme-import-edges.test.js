const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const themes = require('../lib/themes.js');

// Community themes are files from the internet that end up as CSS variables,
// so every rejection here is a security boundary, not a nicety. store-safety
// pins the happy import; this pins what happens to a file that is wrong, and
// to the contrast report that decides whether a theme is readable at all.

function tokens(over = {}) {
  const hue = 260;
  return {
    bgOuter: `oklch(0.97 0.02 ${hue})`,
    bg: `oklch(0.96 0.02 ${hue})`,
    bgSub: `oklch(0.92 0.02 ${hue})`,
    bgElevated: `oklch(0.99 0.01 ${hue})`,
    bgInput: `oklch(0.98 0.01 ${hue})`,
    bgHover: `oklch(0.90 0.03 ${hue})`,
    bgActive: `oklch(0.86 0.04 ${hue})`,
    line: `oklch(0.72 0.04 ${hue})`,
    lineSub: `oklch(0.82 0.03 ${hue})`,
    lineStrong: `oklch(0.58 0.06 ${hue})`,
    ink: `oklch(0.18 0.03 ${hue})`,
    inkMed: `oklch(0.34 0.03 ${hue})`,
    inkDim: `oklch(0.48 0.03 ${hue})`,
    accent: `oklch(0.42 0.12 ${hue})`,
    accentSoft: `oklch(0.88 0.05 ${hue})`,
    danger: 'oklch(0.44 0.12 24)',
    dangerSoft: 'oklch(0.91 0.05 24)',
    success: 'oklch(0.40 0.10 145)',
    successSoft: 'oklch(0.90 0.04 145)',
    warn: 'oklch(0.44 0.10 84)',
    warnSoft: 'oklch(0.90 0.04 84)',
    selBg: `oklch(0.86 0.06 ${hue})`,
    selLine: `oklch(0.55 0.10 ${hue})`,
    focus: `oklch(0.40 0.14 ${hue})`,
    overlay: 'color-mix(in oklab, black 32%, transparent)',
    shadowSoft: 'color-mix(in oklab, black 12%, transparent)',
    shadowElevated: 'color-mix(in oklab, black 20%, transparent)',
    ...over,
  };
}

const theme = (over = {}) => ({
  format: themes.THEME_FORMAT, id: 'community_test', name: 'Community Test', tokens: tokens(), ...over,
});

test('a theme file must be an object in the format we understand', () => {
  for (const bad of [null, 'a string', 42, ['array']]) {
    assert.throws(() => themes.sanitizeTheme(bad), /must contain an object/);
  }
  assert.throws(() => themes.sanitizeTheme(theme({ format: undefined })), /Theme format is required/);
  assert.throws(() => themes.sanitizeTheme(theme({ format: 'vispnote.theme.v99' })), /Unsupported theme format/);
  assert.throws(() => themes.sanitizeTheme(theme({ format: 'x'.repeat(100) })), /Theme format is too long/);
  assert.throws(() => themes.sanitizeTheme(theme({ tokens: undefined })), /Theme tokens are required/);
  assert.throws(() => themes.sanitizeTheme(theme({ tokens: ['not an object'] })), /Theme tokens are required/);
});

test('a theme id must be safe to use as a key and cannot shadow a built-in', () => {
  assert.throws(() => themes.sanitizeTheme(theme({ id: '' })), /Theme id is required/);
  assert.throws(() => themes.sanitizeTheme(theme({ id: 'Community' })), /must start with a lowercase letter/);
  assert.throws(() => themes.sanitizeTheme(theme({ id: '1theme' })), /must start with a lowercase letter/);
  assert.throws(() => themes.sanitizeTheme(theme({ id: 'has space' })), /must start with a lowercase letter/);
  assert.throws(() => themes.sanitizeTheme(theme({ id: 'a'.repeat(70) })), /Theme id is too long/);
  for (const reserved of ['light', 'dark', 'pastel']) {
    assert.throws(() => themes.sanitizeTheme(theme({ id: reserved })), /is reserved/);
  }
  assert.throws(() => themes.sanitizeTheme(theme({ name: '   ' })), /Theme name is required/);
  assert.throws(() => themes.sanitizeTheme(theme({ name: 'x'.repeat(100) })), /Theme name is too long/);
});

test('a theme cannot smuggle a prototype key past the importer', () => {
  const withProto = JSON.parse(`{"format":"${themes.THEME_FORMAT}","id":"p","name":"P","__proto__":{"x":1}}`);
  assert.throws(() => themes.sanitizeTheme(withProto), /Unsafe theme key/);
  assert.throws(() => themes.sanitizeTheme(theme({ constructor: 'x' })), /Unsafe theme key: constructor/);
  assert.throws(() => themes.parseThemeYaml('constructor: x'), /Unsafe YAML key/);
});

test('a token value cannot carry anything that would execute', () => {
  for (const value of [
    'url(https://example.test/x)',
    'URL(x)',
    '@import "evil.css"',
    'expression(alert(1))',
    'javascript:alert(1)',
    '<script>',
    'rgb(0,0,0);}body{',
  ]) {
    assert.throws(() => themes.sanitizeTheme(theme({ tokens: tokens({ bgSub: value }) })),
      /Unsafe theme token value/, `${value} was accepted as a colour`);
  }
  assert.throws(() => themes.sanitizeTheme(theme({ tokens: tokens({ bgSub: '' }) })),
    /Theme token bgSub is required/);
  assert.throws(() => themes.sanitizeTheme(theme({ tokens: tokens({ bgSub: 'a'.repeat(200) }) })),
    /Theme token bgSub is too long/);
});

test('a theme must define every token and nothing more', () => {
  const missing = tokens();
  delete missing.overlay;
  assert.throws(() => themes.sanitizeTheme(theme({ tokens: missing })), /Missing theme token: overlay/);
  assert.throws(() => themes.sanitizeTheme(theme({ tokens: tokens({ notAToken: '#fff' }) })),
    /Unsupported theme token: notAToken/);

  const coverage = themes.themeTokenCoverage(missing);
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.missing, ['overlay']);
  assert.deepEqual(coverage.unsupported, []);
  assert.equal(coverage.present, coverage.required - 1);
  assert.equal(coverage.percent, Math.round((coverage.present / coverage.required) * 100));

  const none = themes.themeTokenCoverage();
  assert.equal(none.present, 0);
  assert.equal(none.percent, 0);
  assert.equal(none.complete, false);
  assert.equal(themes.themeTokenCoverage('not an object').present, 0);
  assert.equal(themes.themeTokenCoverage(tokens()).complete, true);
});

test('contrast is measured in oklch or hex, and unreadable pairs are named', () => {
  const report = themes.themeContrastReport(tokens());
  assert.equal(report.passed, true);
  assert.equal(report.failures.length, 0);
  assert.equal(report.checks.length, 7);
  assert.ok(report.checks[0].delta > 0);

  const flat = themes.themeContrastReport(tokens({ ink: 'oklch(0.96 0.02 260)' }));
  assert.equal(flat.passed, false);
  assert.deepEqual(flat.failures.map(f => f.label), ['body text', 'input text']);
  assert.equal(flat.failures[0].delta, 0, 'text the same colour as its background has no contrast at all');
  assert.throws(() => themes.sanitizeTheme(theme({ tokens: tokens({ ink: 'oklch(0.96 0.02 260)' }) })),
    /Theme contrast is too low for body text, input text/);

  // Hex is read too, in both lengths.
  const hex = themes.themeContrastReport({ ink: '#000', bg: '#ffffff' });
  assert.equal(hex.checks[0].passed, true);
  assert.ok(hex.checks[0].delta > 0.9, 'black on white is the widest contrast there is');

  // A colour we cannot read is reported as unknown rather than assumed fine.
  const unknown = themes.themeContrastReport({ ink: 'color-mix(in oklab, black 50%, white)', bg: '#fff' });
  assert.equal(unknown.checks[0].delta, null);
  assert.equal(unknown.checks[0].passed, false);
  assert.equal(themes.themeContrastReport().passed, false);
  // A percentage lightness and an out-of-range one both resolve.
  assert.ok(themes.themeContrastReport({ ink: 'oklch(18% 0.03 260)', bg: '#fff' }).checks[0].delta > 0.5);
  assert.equal(themes.themeContrastReport({ ink: 'oklch(abc)', bg: '#fff' }).checks[0].delta, null);
});

test('a theme preview shows only the swatches it has', () => {
  const preview = themes.themePreview({ id: 't', name: 'T', tokens: tokens() });
  assert.deepEqual(Object.keys(preview.swatches).sort(),
    ['accent', 'background', 'danger', 'focus', 'success', 'surface', 'text', 'warning']);
  assert.equal(preview.author, '', 'a theme with no author says so rather than showing undefined');
  assert.equal(preview.source, '');
  assert.equal(preview.description, '');
  assert.equal(preview.contrast.passed, true);

  const partial = themes.themePreview({ id: 't', name: 'T', tokens: { bg: '#fff' } });
  assert.deepEqual(partial.swatches, { background: '#fff' });
  assert.equal(partial.coverage.complete, false);
  assert.ok(partial.contrast.failures.length);
  assert.equal(typeof partial.contrast.failures[0].minDelta, 'number');

  const described = themes.sanitizeTheme(theme({ description: '  A calm theme  ', author: 'Someone', source: 'x.json' }));
  assert.equal(described.description, 'A calm theme');
  assert.equal(described.preview.author, 'Someone');
  assert.equal(described.preview.source, 'x.json');
  assert.equal(themes.sanitizeTheme(theme(), { source: 'from-options.json' }).source, 'from-options.json',
    'the file it came from is recorded when the theme does not name one');
});

test('stored themes are re-validated on read and bad ones simply vanish', () => {
  const good = theme({ id: 'good_one' });
  const clean = themes.sanitizeStoredThemes([good, { id: 'bad one' }, null, theme({ id: 'good_one' })]);
  assert.deepEqual(clean.map(t => t.id), ['good_one'],
    'an unusable stored theme is dropped and a duplicate id is kept once');
  assert.deepEqual(themes.sanitizeStoredThemes(null), []);
  assert.deepEqual(themes.sanitizeStoredThemes('nonsense'), []);

  const many = Array.from({ length: 60 }, (_, i) => theme({ id: `theme_${i}` }));
  assert.equal(themes.sanitizeStoredThemes(many).length, 48, 'the number of installed themes is capped');
});

test('installing a theme refuses a name already taken and a full shelf', () => {
  const first = themes.upsertCustomTheme([], theme({ id: 'first_one' }));
  assert.equal(first.theme.id, 'first_one');
  assert.equal(first.customThemes.length, 1);

  const second = themes.upsertCustomTheme(first.customThemes, theme({ id: 'second_one' }));
  assert.deepEqual(second.customThemes.map(t => t.id), ['first_one', 'second_one']);

  assert.throws(() => themes.upsertCustomTheme(second.customThemes, theme({ id: 'first_one' })),
    /already installed/);
  const full = Array.from({ length: 48 }, (_, i) => theme({ id: `theme_${i}` }));
  assert.throws(() => themes.upsertCustomTheme(full, theme({ id: 'one_more' })),
    /Only 48 custom themes can be installed/);

  // A theme handed over without its format line is still accepted on install.
  const noFormat = { ...theme({ id: 'no_format' }) };
  delete noFormat.format;
  assert.equal(themes.upsertCustomTheme([], noFormat).theme.id, 'no_format');
});

test('theme YAML is parsed strictly, with quoting and comments', () => {
  const yaml = [
    '# a community theme',
    '',
    `format: ${themes.THEME_FORMAT}`,
    'id: community_rose',
    "name: 'Rose''s Theme'",
    'description: "A quoted description"',
    'tokens:',
    ...themes.THEME_TOKEN_KEYS.map(key => `  ${key}: ${tokens()[key]}`),
  ].join('\n');
  const parsed = themes.parseThemeText(yaml, 'rose.yml');
  assert.equal(parsed.name, "Rose's Theme", 'a doubled quote inside single quotes is one quote');
  assert.equal(parsed.description, 'A quoted description');
  assert.equal(parsed.source, 'rose.yml', 'the file name is recorded as the source');

  assert.throws(() => themes.parseThemeYaml('id: a\n\tname: b'), /cannot use tabs/);
  assert.throws(() => themes.parseThemeYaml('id = a'), /Unsupported theme YAML line/);
  assert.throws(() => themes.parseThemeYaml('id: a\n  name: b'), /Unsupported theme YAML indentation/);
  assert.throws(() => themes.parseThemeYaml('tokens:\n name: b'), /indentation/);
  assert.deepEqual(themes.parseThemeYaml(''), {});
  assert.deepEqual(themes.parseThemeYaml('tokens:\n  bg: "#fff"'), { tokens: { bg: '#fff' } });
});

test('only a real, small, non-symlink theme file is read from disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-theme-'));
  try {
    const good = path.join(dir, 'good.json');
    fs.writeFileSync(good, JSON.stringify(theme({ id: 'from_disk' })));
    assert.equal((await themes.readThemeFile(good)).id, 'from_disk');

    await assert.rejects(themes.readThemeFile(path.join(dir, 'good.txt')), /Unsupported theme file type/);

    const link = path.join(dir, 'link.json');
    fs.symlinkSync(good, link);
    await assert.rejects(themes.readThemeFile(link), err => {
      assert.equal(err.code, 'UNSAFE_FILE');
      assert.match(err.message, /cannot be a symlink/);
      return true;
    }, 'a symlink could point anywhere on the disk');

    const asDir = path.join(dir, 'adir.json');
    fs.mkdirSync(asDir);
    await assert.rejects(themes.readThemeFile(asDir), err => {
      assert.equal(err.code, 'UNSAFE_FILE');
      assert.match(err.message, /must be a regular file/);
      return true;
    });

    const big = path.join(dir, 'big.json');
    fs.writeFileSync(big, 'x'.repeat(themes.MAX_THEME_FILE_BYTES + 1));
    await assert.rejects(themes.readThemeFile(big), /Theme file is too large/);

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    await assert.rejects(themes.readThemeFile(broken), SyntaxError);

    await assert.rejects(themes.readThemeFile(path.join(dir, 'missing.json')), { code: 'ENOENT' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
