const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { appSource, backendAiSource, outlinerSource } = require('./helpers/source.js');
const vm = require('node:vm');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const ops = require('../src/editor/editorOps.js');
const tableOps = require('../src/editor/tableOps.js');
const appHelpers = require('../src/app/appHelpers.js');
const appNovelist = require('../src/app/appNovelist.js');
const appMutations = require('../src/app/appMutations.js');
const appCanvasActions = require('../src/app/appCanvasActions.js');
const themes = require('../lib/themes.js');
const seed = require('../lib/seed.js');
const panelHelpers = require('../src/panels/panelHelpers.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');

function mainProcessSource() {
  const files = [path.join(__dirname, '../main.js')];
  for (const folder of ['../main', '../lib/connectors/ipc']) {
    const root = path.join(__dirname, folder);
    files.push(...fs.readdirSync(root)
      .filter(name => name.endsWith('.js'))
      .sort()
      .map(name => path.join(root, name)));
  }
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

function storeProcessSource() {
  const files = [path.join(__dirname, '../lib/store.js')];
  const root = path.join(__dirname, '../lib/storage');
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith('.js')) files.push(target);
    }
  };
  visit(root);
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

function buildTestThemeTokens(hue = 260) {
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
  };
}

test('First-run seed creates one focused Personal vault', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    assert.equal(vaults.length, 1);
    assert.deepEqual(vaults.map(v => v.name), ['Personal']);

    const personalVault = vaults.find(v => v.name === 'Personal');
    assert.equal(personalVault.novelistMode, false);

    const personal = await store.loadVault(personalVault.id);
    assert.equal(personal.notes.length, 1);
    assert.deepEqual(personal.notes.map(note => note.title), ['Welcome to VispNote']);
    assert.match(personal.notes[0].body, /Write · Connect · Act\./);
    assert.match(personal.notes[0].body, /review it in Today/);
    assert.equal(personal.notes[0].pinned, false);
    assert.ok(Math.abs(Date.now() - Date.parse(personal.notes[0].date)) < 60_000);
    assert.doesNotMatch(personal.notes[0].body, /^\d+\.\s/m);
  });
});

test('Onboarding mode helpers produce deterministic starter modes', () => {
  const choices = seed.onboardingModeChoices();
  assert.deepEqual(choices.map(mode => mode.id), ['general', 'daily', 'researcher', 'writer']);
  assert.equal(seed.normalizeOnboardingMode('Daily'), 'daily');
  assert.equal(seed.normalizeOnboardingMode('bad'), '');

  for (const mode of choices) {
    const setup = seed.buildOnboardingModeSeed(mode.id, {
      vaultName: 'Mode Vault',
      date: '2026-06-07',
      now: '2026-06-07T08:00:00.000Z',
    });
    assert.equal(setup.id, mode.id);
    assert.ok(setup.tags.length >= 3, mode.id);
    assert.ok(setup.notes.length >= 3, mode.id);
    assert.ok(setup.notes.some(note => /^2026-06-07/.test(note.title) || note.title.includes('2026-06-07')), mode.id);
    assert.ok(setup.commands.length >= 3, mode.id);
    assert.equal(typeof setup.suggestedSidebarFocus, 'string');
  }

  const daily = seed.buildOnboardingModeSeed('daily', { date: '2026-06-07' });
  assert.equal(daily.layoutHints.startupView, 'today');
  assert.ok(daily.notes.some(note => note.title === 'Daily reflection template'));

  const researcher = seed.buildOnboardingModeSeed('researcher', { date: '2026-06-07' });
  assert.ok(researcher.notes.some(note => note.title === 'Research question template'));
  assert.ok(researcher.tags.some(tag => tag.name === 'source'));

  const writer = seed.buildOnboardingModeSeed('writer', { date: '2026-06-07' });
  assert.equal(writer.novelistMode, true);
  assert.ok(writer.notes.some(note => note.title === 'Scene 1'));
  assert.ok(writer.tags.some(tag => tag.name === 'novel-scene'));
});

test('New vault creation never reuses stale vault folders', async () => {
  await withIsolatedStore(async (store) => {
    const staleDir = path.join(store.ROOT, 'novel');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, 'n_old.md'),
      '---\nid: n_old\ntitle: Previous Novel\ntags: [novel-scene]\n---\n\nOld scene\n',
      'utf8'
    );
    const seeded = await store.listVaults();
    assert.equal(seeded.some(item => item.slug === 'novel'), false);

    const vault = await store.createVault('Novel', { type: 'novelist' });
    assert.equal(vault.slug, 'novel-2');

    const loaded = await store.loadVault(vault.id);
    assert.equal(loaded.novelistMode, true);
    assert.equal(loaded.notes.some(note => note.id === 'n_old'), false);
    assert.equal(loaded.notes.length, 3);
    assert.deepEqual(loaded.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.equal(loaded.notes.some(note => (note.tags || []).includes('novel-manuscript')), false);
    assert.equal(loaded.notes.some(note => (note.tags || []).includes('novel-arc')), false);
    assert.match(loaded.notes.find(note => note.title === 'Chapter 1').body, /act:: \[\[Act 1\]\]/);
    assert.match(loaded.notes.find(note => note.title === 'Scene 1').body, /::: plot-points/);
  });
});

test('Vault registry repairs externally deleted vault folders', async () => {
  await withIsolatedStore(async (store) => {
    await store.createVault('Second vault');
    const vaults = await store.listVaults();
    assert.ok(vaults.length >= 2);
    const deleted = vaults[0];
    fs.rmSync(path.join(store.ROOT, deleted.slug), { recursive: true, force: true });

    const repaired = await store.listVaults();
    assert.equal(repaired.some(v => v.id === deleted.id), false);
    assert.ok(repaired.length >= 1);

    await assert.rejects(
      () => store.loadVault(deleted.id),
      /Vault not found/
    );
    assert.equal(fs.existsSync(path.join(store.ROOT, deleted.slug)), false);
  });
});

test('Vault registry creates one fallback vault if every folder is externally deleted', async () => {
  await withIsolatedStore(async (store) => {
    await store.createVault('Second vault');
    const vaults = await store.listVaults();
    vaults.forEach(v => fs.rmSync(path.join(store.ROOT, v.slug), { recursive: true, force: true }));

    const repaired = await store.listVaults();
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].name, 'Personal');
    assert.equal(fs.existsSync(path.join(store.ROOT, repaired[0].slug)), true);
    const loaded = await store.loadVault(repaired[0].id);
    assert.equal(loaded.notes.length, 1);
  });
});

test('Explicit onboarding modes seed new vaults without changing default vault creation', async () => {
  await withIsolatedStore(async (store) => {
    const plain = await store.createVault('Plain Vault');
    const plainLoaded = await store.loadVault(plain.id);
    assert.equal(plainLoaded.notes.length, 1);
    assert.equal(plainLoaded.notes[0].title, 'Welcome to Plain Vault');
    assert.equal(plainLoaded.novelistMode, false);

    const daily = await store.createVault('Daily Vault', {
      onboardingMode: 'daily',
      now: '2026-06-07T08:00:00.000Z',
    });
    const dailyLoaded = await store.loadVault(daily.id);
    assert.equal(dailyLoaded.novelistMode, false);
    assert.ok(dailyLoaded.notes.some(note => note.title === '2026-06-07'));
    assert.ok(dailyLoaded.notes.some(note => note.title === 'Daily reflection template'));
    assert.ok(dailyLoaded.tags.some(tag => tag.name === 'daily'));

    const researcher = await store.createVault('Research Vault', {
      onboardingMode: 'researcher',
      now: '2026-06-07T08:00:00.000Z',
    });
    const researcherLoaded = await store.loadVault(researcher.id);
    assert.ok(researcherLoaded.notes.some(note => note.title === 'Research question template'));
    assert.ok(researcherLoaded.tags.some(tag => tag.name === 'research'));

    const writer = await store.createVault('Writer Vault', {
      onboardingMode: 'writer',
      now: '2026-06-07T08:00:00.000Z',
    });
    const writerLoaded = await store.loadVault(writer.id);
    assert.equal(writerLoaded.novelistMode, true);
    assert.ok(writerLoaded.notes.some(note => note.title === 'Writer workspace welcome'));
    assert.ok(writerLoaded.notes.some(note => note.title === 'Scene 1'));
    assert.ok(writerLoaded.tags.some(tag => tag.name === 'novel-scene'));
  });
});

test('New novelist vaults stay isolated and persist novelist AI config', async () => {
  await withIsolatedStore(async (store) => {
    const first = await store.createVault('Novel One', { type: 'novelist' });
    await store.saveNote(first.id, {
      id: 'n_custom_scene',
      title: 'Custom Scene',
      date: new Date().toISOString(),
      tags: ['novel-scene'],
      body: 'status:: DRAFT\nchapter:: [[Chapter 1]]\nOnly in the first vault.',
    });

    const second = await store.createVault('Novel Two', { type: 'novelist' });
    await store.saveVaultMeta(second.id, {
      novelistAiConfig: {
        version: 2,
        wordLimit: 1200,
        prompts: [{ id: 'draft', name: 'Draft', prompt: 'Write a scene.' }],
      },
    });

    const firstLoaded = await store.loadVault(first.id);
    const secondLoaded = await store.loadVault(second.id);
    const listed = await store.listVaults();
    const secondMeta = listed.find(v => v.id === second.id);

    assert.equal(firstLoaded.notes.some(note => note.id === 'n_custom_scene'), true);
    assert.equal(secondLoaded.notes.some(note => note.id === 'n_custom_scene'), false);
    assert.deepEqual(secondLoaded.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.equal(secondLoaded.novelistAiConfig.wordLimit, 1200);
    assert.equal(secondMeta.novelistAiConfig.wordLimit, 1200);
  });
});

test('Global config is private and returns isolated cached snapshots', async () => {
  await withIsolatedStore(async (store) => {
    await store.setPrefs({ tweaks: { density: 'compact' } });
    const configPath = store.__test.CONFIG_FILE;
    const mode = fs.statSync(configPath).mode & 0o777;
    if (process.platform !== 'win32') assert.equal(mode, 0o600);

    const first = await store.loadConfig();
    const second = await store.loadConfig();
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    first.tweaks.density = 'caller-mutation';
    assert.equal((await store.loadConfig()).tweaks.density, 'compact');

    await store.setPrefs({ tweaks: { density: 'comfortable' } });
    const third = await store.loadConfig();
    assert.equal(third.tweaks.density, 'comfortable');
    if (process.platform !== 'win32') assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  });
});

test('Config and vault metadata mutations preserve concurrent updates', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await Promise.all([
      ...Array.from({ length: 20 }, () => store.recordFeatureUsage('canvas', 'opened')),
      store.setPrefs({ tweaks: { density: 'compact' } }),
      store.recordBackupExport('2026-07-29T10:00:00.000Z'),
    ]);
    const prefs = await store.getPrefs();
    assert.equal(prefs.tweaks.density, 'compact');
    assert.equal(prefs.lastBackupAt, '2026-07-29T10:00:00.000Z');
    assert.equal((await store.featureUsageStatus()).report.counters.canvas.opened, 20);

    await Promise.all([
      store.saveVaultMeta(vault.id, { tags: ['serialized-tag'] }),
      store.saveVaultMeta(vault.id, { novelistMode: true }),
    ]);
    const loaded = await store.loadVault(vault.id);
    assert.equal(loaded.tags.some(tag => tag.name === 'serialized-tag'), true);
    assert.equal(loaded.novelistMode, true);
  });
});

test('Theme files parse JSON and simple YAML with strict schema validation', () => {
  const tokens = buildTestThemeTokens(286);
  const jsonTheme = themes.parseThemeText(JSON.stringify({
    format: themes.THEME_FORMAT,
    id: 'community_lavender',
    name: 'Community Lavender',
    author: 'Visp Community',
    source: 'https://example.test/themes/lavender',
    tokens,
  }), 'community-lavender.json');
  assert.equal(jsonTheme.id, 'community_lavender');
  assert.equal(jsonTheme.name, 'Community Lavender');
  assert.deepEqual(Object.keys(jsonTheme.tokens).sort(), themes.THEME_TOKEN_KEYS.slice().sort());
  assert.equal(jsonTheme.preview.id, 'community_lavender');
  assert.equal(jsonTheme.preview.author, 'Visp Community');
  assert.equal(jsonTheme.preview.source, 'https://example.test/themes/lavender');
  assert.equal(jsonTheme.preview.coverage.complete, true);
  assert.equal(jsonTheme.preview.coverage.required, themes.THEME_TOKEN_KEYS.length);
  assert.equal(jsonTheme.preview.swatches.accent, tokens.accent);
  assert.equal(jsonTheme.preview.contrast.passed, true);

  const yaml = [
    `format: ${themes.THEME_FORMAT}`,
    'id: community_rose',
    'name: Community Rose',
    'tokens:',
    ...themes.THEME_TOKEN_KEYS.map(key => `  ${key}: ${tokens[key]}`),
  ].join('\n');
  const yamlTheme = themes.parseThemeText(yaml, 'community-rose.yaml');
  assert.equal(yamlTheme.id, 'community_rose');
  assert.equal(yamlTheme.tokens.accent, tokens.accent);

  assert.throws(
    () => themes.parseThemeText(JSON.stringify({ format: themes.THEME_FORMAT, id: 'light', name: 'Bad', tokens }), 'bad.json'),
    /reserved/
  );
  const missingToken = { ...tokens };
  delete missingToken.focus;
  assert.throws(
    () => themes.parseThemeText(JSON.stringify({ format: themes.THEME_FORMAT, id: 'missing_focus', name: 'Bad', tokens: missingToken }), 'bad.json'),
    /Missing theme token: focus/
  );
  assert.throws(
    () => themes.parseThemeText(JSON.stringify({ format: themes.THEME_FORMAT, id: 'unsafe_theme', name: 'Bad', tokens: { ...tokens, bg: 'url(https://example.test/x)' } }), 'bad.json'),
    /Unsafe theme token value/
  );
  assert.throws(
    () => themes.parseThemeText(JSON.stringify({ format: themes.THEME_FORMAT, id: 'low_contrast', name: 'Bad', tokens: { ...tokens, ink: tokens.bg } }), 'bad.json'),
    /Theme contrast is too low/
  );
  assert.throws(
    () => themes.parseThemeText(JSON.stringify({ format: themes.THEME_FORMAT, id: 'wrong_ext', name: 'Bad', tokens }), 'bad.txt'),
    /Unsupported theme file type/
  );
});

test('Custom theme imports persist and reject unsafe files without mutation', async () => {
  await withIsolatedStore(async (store) => {
    const tokens = buildTestThemeTokens(300);
    const themePath = path.join(store.ROOT, 'community-lavender.json');
    fs.writeFileSync(themePath, JSON.stringify({
      format: themes.THEME_FORMAT,
      id: 'community_lavender',
      name: 'Community Lavender',
      tokens,
    }), 'utf8');

    const installed = await store.importThemeFile(themePath);
    assert.equal(installed.theme.id, 'community_lavender');
    assert.equal(installed.theme.preview.coverage.complete, true);
    assert.equal(installed.customThemes.length, 1);

    const prefs = await store.getPrefs();
    assert.equal(prefs.customThemes.length, 1);
    assert.equal(prefs.customThemes[0].name, 'Community Lavender');
    assert.equal(prefs.customThemes[0].tokens.focus, tokens.focus);

    const reservedPath = path.join(store.ROOT, 'reserved.json');
    fs.writeFileSync(reservedPath, JSON.stringify({
      format: themes.THEME_FORMAT,
      id: 'dark',
      name: 'Reserved',
      tokens,
    }), 'utf8');
    await assert.rejects(() => store.importThemeFile(reservedPath), /reserved/);
    assert.deepEqual((await store.getPrefs()).customThemes, prefs.customThemes);

    const duplicatePath = path.join(store.ROOT, 'duplicate-theme.json');
    fs.writeFileSync(duplicatePath, JSON.stringify({
      format: themes.THEME_FORMAT,
      id: 'community_lavender',
      name: 'Duplicate Lavender',
      tokens,
    }), 'utf8');
    await assert.rejects(() => store.importThemeFile(duplicatePath), /already installed/);
    assert.deepEqual((await store.getPrefs()).customThemes, prefs.customThemes);

    const lowContrastPath = path.join(store.ROOT, 'low-contrast.json');
    fs.writeFileSync(lowContrastPath, JSON.stringify({
      format: themes.THEME_FORMAT,
      id: 'low_contrast',
      name: 'Low Contrast',
      tokens: { ...tokens, ink: tokens.bg },
    }), 'utf8');
    await assert.rejects(() => store.importThemeFile(lowContrastPath), /Theme contrast is too low/);
    assert.deepEqual((await store.getPrefs()).customThemes, prefs.customThemes);

    const unsupportedPath = path.join(store.ROOT, 'theme.txt');
    fs.writeFileSync(unsupportedPath, JSON.stringify({
      format: themes.THEME_FORMAT,
      id: 'bad_extension',
      name: 'Bad Extension',
      tokens,
    }), 'utf8');
    await assert.rejects(() => store.importThemeFile(unsupportedPath), /Unsupported theme file type/);

    if (process.platform !== 'win32') {
      const linkPath = path.join(store.ROOT, 'theme-link.json');
      fs.symlinkSync(themePath, linkPath);
      await assert.rejects(() => store.importThemeFile(linkPath), /Theme file cannot be a symlink/);
    }
  });
});

test('Local Phase 5 metrics persist safely and reject unsafe keys', async () => {
  await withIsolatedStore(async (store) => {
    const first = appHelpers.phase5RecordMetric(null, 'capture_saves', {
      destinationId: 'today',
      templateId: 'task',
    }, { now: '2026-06-07T08:00:00.000Z' });
    await store.setPrefs({ phase5Metrics: first });
    let prefs = await store.getPrefs();
    assert.equal(prefs.phase5Metrics.counters.capture_saves, 1);
    assert.deepEqual(prefs.phase5Metrics.events[0].details, {
      destinationId: 'today',
      templateId: 'task',
    });

    await assert.rejects(
      () => store.setPrefs({ phase5Metrics: { counters: { unsafe_metric: 1 }, events: [] } }),
      /Unsupported Phase 5 metric key/
    );
    assert.equal((await store.getPrefs()).phase5Metrics.counters.capture_saves, 1);

    const tokens = buildTestThemeTokens(320);
    const themePath = path.join(store.ROOT, 'community-metrics.json');
    fs.writeFileSync(themePath, JSON.stringify({
      format: themes.THEME_FORMAT,
      id: 'community_metrics',
      name: 'Community Metrics',
      tokens,
    }), 'utf8');
    await store.importThemeFile(themePath);
    prefs = await store.getPrefs();
    assert.equal(prefs.phase5Metrics.counters.theme_installs, 1);
    assert.equal(prefs.phase5Metrics.events.at(-1).details.themeId, 'community_metrics');

    await store.createVault('Daily Metrics', {
      onboardingMode: 'daily',
      now: '2026-06-07T09:00:00.000Z',
    });
    prefs = await store.getPrefs();
    assert.equal(prefs.phase5Metrics.counters.onboarding_mode_selections, 1);
    assert.equal(prefs.phase5Metrics.events.at(-1).details.onboardingMode, 'daily');
  });
});

test('Feature packs and private usage controls persist without arbitrary event data', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const loaded = await store.loadVault(vault.id);
    const notePath = path.join(store.ROOT, vault.slug, `${loaded.notes[0].id}.md`);
    const noteBeforePreferences = fs.readFileSync(notePath, 'utf8');
    assert.deepEqual((await store.getPrefs()).enabledPacks, ['views']);
    await store.setPrefs({ enabledPacks: [] });
    assert.deepEqual((await store.getPrefs()).enabledPacks, []);
    await store.setPrefs({
      enabledPacks: ['canvas', 'writer', 'canvas', 'unknown'],
      tweaks: {
        showTodayInSidebar: true,
        showThinkingBoardInSidebar: true,
        showWorkflowInSidebar: true,
        showQuickCaptureInSidebar: true,
      },
      localUsageMetrics: true,
      anonymousUsageSharing: false,
    });
    let prefs = await store.getPrefs();
    assert.deepEqual(prefs.enabledPacks, ['canvas', 'writer']);
    assert.equal(prefs.tweaks.showTodayInSidebar, true);
    assert.equal(prefs.tweaks.showThinkingBoardInSidebar, true);
    assert.equal(prefs.tweaks.showWorkflowInSidebar, true);
    assert.equal(prefs.tweaks.showQuickCaptureInSidebar, true);
    assert.equal(prefs.localUsageMetrics, true);
    assert.equal(prefs.anonymousUsageSharing, false);
    assert.equal(fs.readFileSync(notePath, 'utf8'), noteBeforePreferences);

    const recordedBackupAt = await store.recordBackupExport('2026-07-13T04:05:06.000Z');
    assert.equal(recordedBackupAt, '2026-07-13T04:05:06.000Z');
    assert.equal((await store.getPrefs()).lastBackupAt, recordedBackupAt);
    assert.equal(fs.readFileSync(notePath, 'utf8'), noteBeforePreferences);

    const report = await store.recordFeatureUsage('canvas', 'opened');
    assert.equal(report.counters.canvas.opened, 1);
    await assert.rejects(() => store.recordFeatureUsage('private-note-id', 'used'), /Unsupported/);

    await store.setPrefs({ localUsageMetrics: false });
    await store.recordFeatureUsage('canvas', 'opened');
    assert.equal((await store.featureUsageStatus()).report.counters.canvas.opened, 1);

    await store.clearFeatureUsage();
    assert.deepEqual((await store.featureUsageStatus()).report.counters, {});
    prefs = await store.getPrefs();
    assert.equal(prefs.localUsageMetrics, false);
  });
});

test('Note saves create restorable versions and reject stale disk revisions', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes[0];

    const first = await store.saveNote(vault.id, {
      ...note,
      body: 'first saved body',
    }, { expectedRevision: note.diskRevision });

    await store.saveNote(vault.id, {
      ...first,
      body: 'second saved body',
    }, { expectedRevision: first.diskRevision });

    const versions = await store.listNoteVersions(vault.id, note.id);
    // Two saves 12ms apart snapshot once, not twice: autosave fires every
    // half second, and versioning each burst filled history with copies of
    // the same minute. One snapshot per note per minute is the contract now.
    assert.equal(versions.length, 1);
    assert.match(versions[0].versionId, /^ver_/);
    const preview = await store.getNoteVersion(vault.id, note.id, versions[0].versionId);
    assert.equal(preview.noteId, note.id);
    assert.ok(typeof preview.body === 'string');

    await assert.rejects(
      () => store.saveNote(vault.id, {
        ...first,
        body: 'stale overwrite',
      }, { expectedRevision: first.diskRevision }),
      err => err.code === 'NOTE_CONFLICT'
    );

    const restored = await store.restoreNoteVersion(vault.id, note.id, versions[0].versionId);
    assert.equal(restored.id, note.id);
    assert.match(restored.body, /first saved body|Welcome/i);
  });
});

test('Note revisions use exact bytes and serialize save/delete races', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const note = (await store.loadVault(vault.id)).notes[0];
    const notePath = path.join(store.ROOT, vault.slug, `${note.id}.md`);
    const originalStat = fs.statSync(notePath);
    const externallyEdited = `${fs.readFileSync(notePath, 'utf8')}\nexternal edit`;
    fs.writeFileSync(notePath, externallyEdited, 'utf8');
    fs.utimesSync(notePath, originalStat.atime, originalStat.mtime);

    await assert.rejects(
      () => store.saveNote(vault.id, { ...note, body: 'must not overwrite' }, {
        expectedRevision: note.diskRevision,
      }),
      error => error.code === 'NOTE_CONFLICT'
        && error.currentRevision === store.__test.calculateDiskRevision(externallyEdited)
    );

    const current = await store.getNote(vault.id, note.id);
    const competing = await Promise.allSettled([
      store.saveNote(vault.id, { ...current, body: 'winner A' }, { expectedRevision: current.diskRevision }),
      store.saveNote(vault.id, { ...current, body: 'winner B' }, { expectedRevision: current.diskRevision }),
    ]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(competing.filter(result => result.reason?.code === 'NOTE_CONFLICT').length, 1);

    const beforeRace = await store.getNote(vault.id, note.id);
    const [saveResult, deleteResult] = await Promise.allSettled([
      store.saveNote(vault.id, { ...beforeRace, body: 'saved before delete' }, {
        expectedRevision: beforeRace.diskRevision,
      }),
      store.deleteNote(vault.id, note.id, beforeRace, {
        expectedRevision: beforeRace.diskRevision,
      }),
    ]);
    assert.equal(saveResult.status, 'fulfilled');
    assert.equal(deleteResult.status, 'rejected');
    assert.equal(deleteResult.reason.code, 'NOTE_CONFLICT');
    assert.equal((await store.getNote(vault.id, note.id)).body, 'saved before delete');

    const beforeDelete = await store.getNote(vault.id, note.id);
    const exactText = fs.readFileSync(notePath, 'utf8');
    const deleted = await store.deleteNote(vault.id, note.id, beforeDelete, {
      expectedRevision: beforeDelete.diskRevision,
    });
    const trashPath = path.join(store.ROOT, vault.slug, '.trash', 'notes', `${deleted.trashId}.md`);
    assert.equal(fs.readFileSync(trashPath, 'utf8'), exactText);
    const restored = await store.restoreDeletedNote(vault.id, deleted.trashId);
    assert.equal(restored.diskRevision, store.__test.calculateDiskRevision(exactText));

    const deletedAgain = await store.deleteNote(vault.id, restored.id, restored, {
      expectedRevision: restored.diskRevision,
    });
    await store.saveNote(vault.id, {
      id: restored.id,
      title: 'Replacement note',
      body: 'replacement body',
      tags: [],
    }, { expectedRevision: null });
    const collisionRestore = await store.restoreDeletedNote(vault.id, deletedAgain.trashId);
    assert.notEqual(collisionRestore.id, restored.id);
    assert.equal((await store.getNote(vault.id, restored.id)).body, 'replacement body');
    assert.equal(collisionRestore.body, restored.body);

    const reserved = await store.saveNote(vault.id, {
      id: 'n_reserved_fields',
      title: 'Reserved-looking fields',
      body: 'keep exact metadata',
      tags: [],
      frontMatter: [
        'id: n_reserved_fields',
        'title: Reserved-looking fields',
        'originalId: n_not_the_file_id',
        'trashId: user_authored_value',
        'deletedAt: 2025-01-01T00:00:00.000Z',
      ].join('\n'),
    }, { expectedRevision: null });
    const reservedPath = path.join(store.ROOT, vault.slug, `${reserved.id}.md`);
    const reservedText = fs.readFileSync(reservedPath, 'utf8');
    const reservedDeleted = await store.deleteNote(vault.id, reserved.id, reserved, {
      expectedRevision: reserved.diskRevision,
    });
    const reservedRestored = await store.restoreDeletedNote(vault.id, reservedDeleted.trashId);
    assert.equal(reservedRestored.id, reserved.id);
    assert.equal(fs.readFileSync(reservedPath, 'utf8'), reservedText);
  });
});

test('Create-only note writes and never-saved snapshot deletion are explicit', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const note = { id: 'n_create_only', title: 'Create only', body: 'first', tags: [] };
    const saved = await store.saveNote(vault.id, note, { expectedRevision: null });
    assert.match(saved.diskRevision, /^[a-f0-9]{64}$/);
    await assert.rejects(
      () => store.saveNote(vault.id, { ...note, body: 'overwrite' }, { expectedRevision: null }),
      error => error.code === 'NOTE_CONFLICT' && error.expectedRevision === null
    );

    const snapshot = { id: 'n_never_saved', title: 'Unsaved', body: 'recover me', tags: [] };
    const deleted = await store.deleteNote(vault.id, snapshot.id, snapshot, { expectedRevision: null });
    const restored = await store.restoreDeletedNote(vault.id, deleted.trashId);
    assert.equal(restored.body, 'recover me');

    await assert.rejects(
      () => store.deleteNote(vault.id, 'n_oversized_snapshot', {
        id: 'n_oversized_snapshot',
        title: 'Oversized',
        body: 'x'.repeat(store.__test.MAX_NOTE_BODY_BYTES + store.__test.MAX_JSON_WRITE_BYTES + 1),
        tags: [],
      }, { expectedRevision: null }),
      /Deleted note is too large/
    );
  });
});

test('Deleted notes move to trash and can be restored or purged', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes[0];

    const deleted = await store.deleteNote(vault.id, note.id);
    assert.ok(deleted.trashId);
    assert.equal((await store.loadVault(vault.id)).notes.some(n => n.id === note.id), false);

    const trash = await store.listDeletedNotes(vault.id);
    assert.equal(trash.length, 1);
    assert.equal(trash[0].originalId, note.id);

    const restored = await store.restoreDeletedNote(vault.id, trash[0].trashId);
    assert.equal(restored.id, note.id);
    assert.equal((await store.loadVault(vault.id)).notes.some(n => n.id === note.id), true);

    const deletedAgain = await store.deleteNote(vault.id, note.id);
    await store.purgeDeletedNote(vault.id, deletedAgain.trashId);
    assert.equal((await store.listDeletedNotes(vault.id)).some(item => item.trashId === deletedAgain.trashId), false);
  });
});

test('Canvas deletes are soft-deleted into the vault trash folder', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await store.saveCanvas(vault.id, { id: 'c_safety', title: 'Safety canvas', elements: [] });

    const deleted = await store.deleteCanvas(vault.id, 'c_safety');
    assert.ok(deleted.trashId);
    assert.equal((await store.listCanvases(vault.id)).some(canvas => canvas.id === 'c_safety'), false);
    assert.equal(
      fs.existsSync(path.join(store.ROOT, vault.slug, '.trash', 'canvases', `${deleted.trashId}.json`)),
      true
    );

    const trash = await store.listDeletedCanvases(vault.id);
    assert.equal(trash.some(item => item.trashId === deleted.trashId && item.sourceType === 'canvas'), true);
    const restored = await store.restoreDeletedCanvas(vault.id, deleted.trashId);
    assert.equal(restored.id, 'c_safety');
    assert.equal((await store.listCanvases(vault.id)).some(canvas => canvas.id === 'c_safety'), true);
  });
});

test('Canvas saves and deletes use exact revisions under one entity lock', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const created = await store.saveCanvas(vault.id, {
      id: 'c_revision',
      title: 'Revision canvas',
      elements: [],
    }, { expectedRevision: null });
    assert.match(created.diskRevision, /^[a-f0-9]{64}$/);

    const competing = await Promise.allSettled([
      store.saveCanvas(vault.id, { ...created, title: 'Winner A' }, { expectedRevision: created.diskRevision }),
      store.saveCanvas(vault.id, { ...created, title: 'Winner B' }, { expectedRevision: created.diskRevision }),
    ]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(competing.filter(result => result.reason?.code === 'NOTE_CONFLICT').length, 1);

    const current = await store.getCanvas(vault.id, created.id);
    const canvasPath = path.join(store.ROOT, vault.slug, '.canvases', `${created.id}.json`);
    const exactText = fs.readFileSync(canvasPath, 'utf8');
    const deleted = await store.deleteCanvas(vault.id, created.id, {
      expectedRevision: current.diskRevision,
    });
    const trashPath = path.join(store.ROOT, vault.slug, '.trash', 'canvases', `${deleted.trashId}.json`);
    assert.equal(fs.readFileSync(trashPath, 'utf8'), exactText);
    const restored = await store.restoreDeletedCanvas(vault.id, deleted.trashId);
    assert.equal(restored.diskRevision, store.__test.calculateDiskRevision(exactText));

    const deletedAgain = await store.deleteCanvas(vault.id, restored.id, {
      expectedRevision: restored.diskRevision,
    });
    await store.saveCanvas(vault.id, {
      id: restored.id,
      title: 'Replacement canvas',
      elements: [],
    }, { expectedRevision: null });
    const collisionRestore = await store.restoreDeletedCanvas(vault.id, deletedAgain.trashId);
    assert.notEqual(collisionRestore.id, restored.id);
    assert.equal((await store.getCanvas(vault.id, restored.id)).title, 'Replacement canvas');
    assert.equal(collisionRestore.title, restored.title);

    const reservedCanvas = await store.saveCanvas(vault.id, {
      id: 'c_reserved_fields',
      title: 'Reserved-looking fields',
      elements: [],
    }, { expectedRevision: null });
    const reservedPath = path.join(store.ROOT, vault.slug, '.canvases', `${reservedCanvas.id}.json`);
    const reservedRaw = JSON.stringify({
      ...JSON.parse(fs.readFileSync(reservedPath, 'utf8')),
      originalId: 'c_not_the_file_id',
      trashId: 'user_authored_value',
      deletedAt: '2025-01-01T00:00:00.000Z',
    }, null, 2);
    fs.writeFileSync(reservedPath, reservedRaw, 'utf8');
    const reservedCurrent = await store.getCanvas(vault.id, reservedCanvas.id);
    const reservedDeleted = await store.deleteCanvas(vault.id, reservedCanvas.id, {
      expectedRevision: reservedCurrent.diskRevision,
    });
    const reservedRestored = await store.restoreDeletedCanvas(vault.id, reservedDeleted.trashId);
    assert.equal(reservedRestored.id, reservedCanvas.id);
    assert.equal(fs.readFileSync(reservedPath, 'utf8'), reservedRaw);
  });
});

test('Store preserves unreadable metadata and soft-deletes vault folders', async () => {
  await withIsolatedStore(async (store) => {
    await store.createVault('Second vault');
    const vaults = await store.listVaults();
    const first = vaults[0];
    const second = vaults[1];
    const metaPath = path.join(store.ROOT, first.slug, '.meta.json');
    fs.writeFileSync(metaPath, '{bad json', 'utf8');

    const loaded = await store.loadVault(first.id);
    assert.equal(Array.isArray(loaded.notes), true);
    assert.equal(
      fs.readdirSync(path.join(store.ROOT, first.slug)).some(name => name.startsWith('.meta.json.broken.')),
      true
    );

    const originalVaultPath = path.join(store.ROOT, second.slug);
    const deleted = await store.deleteVault(second.id);
    assert.equal(fs.existsSync(originalVaultPath), false);
    assert.equal(fs.existsSync(deleted.deletedPath), true);
    assert.match(path.relative(store.ROOT, deleted.deletedPath), /^\.trash[\\/]vaults[\\/]/);

    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const staleImport = path.join(store.ROOT, '.import-stale');
    const staleTmp = path.join(store.ROOT, '.config.json.123.tmp');
    fs.mkdirSync(staleImport, { recursive: true });
    fs.writeFileSync(staleTmp, 'partial', 'utf8');
    fs.utimesSync(staleImport, oldDate, oldDate);
    fs.utimesSync(staleTmp, oldDate, oldDate);
    store.__test.clearConfigCache();
    await store.loadConfig();
    assert.equal(fs.existsSync(staleImport), false);
    assert.equal(fs.existsSync(staleTmp), false);
  });
});

test('Vault loading falls back from unsafe note front matter ids', async () => {
  await withIsolatedStore(async (store) => {
    const vault = (await store.listVaults()).find(item => item.name === 'Personal');
    const notePath = path.join(store.ROOT, vault.slug, 'n_safe.md');
    fs.writeFileSync(
      notePath,
      '---\nid: ../bad\ntitle: Unsafe front matter\n---\n\nBody survives with safe file id.\n',
      'utf8'
    );

    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes.find(item => item.title === 'Unsafe front matter');
    assert.equal(note.id, 'n_safe');
    assert.equal(note.body.trim(), 'Body survives with safe file id.');
  });
});

test('Saving known fields preserves unknown front matter, comments, and block lists', async () => {
  await withIsolatedStore(async (store) => {
    const vault = (await store.listVaults()).find(item => item.name === 'Personal');
    const notePath = path.join(store.ROOT, vault.slug, 'n_portable.md');
    fs.writeFileSync(notePath, [
      '---',
      '# Imported metadata stays user-owned',
      'id: n_portable',
      'title: Before # visible title comment',
      'tags:',
      '  # keep this list comment',
      '  - alpha',
      'aliases:',
      '  - First alias',
      '  - Second alias',
      'custom:',
      '  nested: true',
      'title: Shadow duplicate',
      '---',
      '',
      'Body with [relative](../reference.md).',
    ].join('\n'), 'utf8');

    const loaded = await store.getNote(vault.id, 'n_portable');
    assert.deepEqual(loaded.tags, ['alpha']);
    const savedNote = await store.saveNote(vault.id, {
      ...loaded,
      title: 'After',
      tags: ['alpha', 'beta', "mom's", '{brace}', '1e3'],
    });
    const saved = fs.readFileSync(notePath, 'utf8');

    assert.match(saved, /title: After # visible title comment/);
    assert.equal((saved.match(/^title:/gm) || []).length, 1);
    assert.match(saved, /tags: \[alpha, beta, "mom's", "\{brace\}", "1e3"\]\n  # keep this list comment/);
    assert.match(saved, /aliases:\n  - First alias\n  - Second alias/);
    assert.match(saved, /custom:\n  nested: true/);
    assert.match(saved, /Body with \[relative\]\(\.\.\/reference\.md\)\./);
    assert.deepEqual((await store.getNote(vault.id, savedNote.id)).tags, ['alpha', 'beta', "mom's", '{brace}', '1e3']);

    const [version] = await store.listNoteVersions(vault.id, 'n_portable');
    assert.ok(version);
    await store.restoreNoteVersion(vault.id, 'n_portable', version.versionId);
    const versionRestored = fs.readFileSync(notePath, 'utf8');
    assert.match(versionRestored, /aliases:\n  - First alias\n  - Second alias/);
    assert.match(versionRestored, /# Imported metadata stays user-owned/);

    const deleted = await store.deleteNote(vault.id, 'n_portable', await store.getNote(vault.id, 'n_portable'));
    await store.restoreDeletedNote(vault.id, deleted.trashId);
    const trashRestored = fs.readFileSync(notePath, 'utf8');
    assert.match(trashRestored, /aliases:\n  - First alias\n  - Second alias/);
    assert.doesNotMatch(trashRestored, /^(?:trashId|deletedAt|originalId|originalTitle):/m);

    const { payload: backup } = await store.exportBackup({ vaultId: vault.id });
    const imported = await store.importBackup(backup, { activate: false, keepNames: false });
    const importedVault = await store.loadVault(imported.importedVaults[0].id);
    assert.match(importedVault.notes.find(note => note.id === 'n_portable').frontMatter, /aliases:\n  - First alias\n  - Second alias/);
  });
});

test('Vault loading and export ignore symlinked note and canvas files', async () => {
  if (process.platform === 'win32') return;
  await withIsolatedStore(async (store) => {
    const vault = (await store.listVaults()).find(item => item.name === 'Personal');
    const secretPath = path.join(store.ROOT, 'outside-secret.txt');
    fs.writeFileSync(secretPath, 'outside secret', 'utf8');
    fs.symlinkSync(secretPath, path.join(store.ROOT, vault.slug, 'n_linked.md'));
    fs.mkdirSync(path.join(store.ROOT, vault.slug, '.canvases'), { recursive: true });
    fs.symlinkSync(secretPath, path.join(store.ROOT, vault.slug, '.canvases', 'c_linked.json'));

    const loaded = await store.loadVault(vault.id);
    assert.equal(loaded.notes.some(note => note.id === 'n_linked' || note.body.includes('outside secret')), false);
    assert.equal(loaded.warnings.some(warning => warning.file === 'n_linked.md' && /symlink/.test(warning.message)), true);
    assert.equal((await store.listCanvases(vault.id)).some(canvas => canvas.id === 'c_linked'), false);
    await assert.rejects(() => store.getCanvas(vault.id, 'c_linked'), /symlink/);

    const backup = await store.exportBackup({ vaultId: vault.id });
    assert.equal(JSON.stringify(backup.payload).includes('outside secret'), false);
    assert.equal(backup.text.includes('outside secret'), false);
  });
});

test('Vault registry ignores symlinked vault folders', async () => {
  if (process.platform === 'win32') return;
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    const linkedVault = vaults.find(item => item.name === 'Personal');
    assert.ok(linkedVault);

    const outsideVault = path.join(store.ROOT, 'outside-vault');
    fs.mkdirSync(outsideVault, { recursive: true });
    fs.writeFileSync(
      path.join(outsideVault, 'n_secret.md'),
      '---\nid: n_secret\ntitle: Outside Secret\n---\n\nleaked secret body',
      'utf8'
    );

    fs.rmSync(path.join(store.ROOT, linkedVault.slug), { recursive: true, force: true });
    fs.symlinkSync(outsideVault, path.join(store.ROOT, linkedVault.slug), 'dir');
    store.__test.clearConfigCache();

    const repaired = await store.listVaults();
    assert.equal(repaired.some(vault => vault.id === linkedVault.id), false);
    assert.equal(JSON.stringify(repaired).includes('Outside Secret'), false);
    await assert.rejects(() => store.loadVault(linkedVault.id), /Vault not found/);
    assert.notEqual((await store.loadConfig()).activeVaultId, linkedVault.id);
  });
});

test('Vault registry ignores unsafe configured vault slugs', async () => {
  await withIsolatedStore(async (store) => {
    const outsideVault = path.join(store.ROOT, '..', `outside-vault-${process.pid}-${Date.now()}`);
    try {
      fs.mkdirSync(outsideVault, { recursive: true });
      fs.writeFileSync(
        path.join(outsideVault, 'n_secret.md'),
        '---\nid: n_secret\ntitle: Outside Secret\n---\n\nleaked secret body',
        'utf8'
      );
      fs.writeFileSync(store.__test.CONFIG_FILE, JSON.stringify({
        vaults: [{ id: 'v_bad', name: 'Bad', slug: `../${path.basename(outsideVault)}`, path: outsideVault }],
        activeVaultId: 'v_bad',
        tweaks: null,
        aiConfig: null,
      }), 'utf8');

      const repaired = await store.listVaults();
      assert.equal(repaired.some(vault => vault.id === 'v_bad'), false);
      assert.equal(JSON.stringify(repaired).includes('Outside Secret'), false);
      assert.equal((await store.loadConfig()).activeVaultId, repaired[0].id);
      await assert.rejects(() => store.loadVault('v_bad'), /Vault not found/);
    } finally {
      fs.rmSync(outsideVault, { recursive: true, force: true });
    }
  });
});

test('Vault registry repairs unsafe configured vault ids and forged paths', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const forgedPath = path.join(store.ROOT, '..', 'forged-vault-path');
    fs.writeFileSync(store.__test.CONFIG_FILE, JSON.stringify({
      vaults: [{ id: '../bad', name: 'Tampered', slug: vault.slug, path: forgedPath }],
      activeVaultId: '../bad',
      tweaks: null,
      aiConfig: null,
    }), 'utf8');
    store.__test.clearConfigCache();

    const repaired = await store.listVaults();
    assert.equal(repaired.length, 1);
    assert.match(repaired[0].id, /^v_personal/);
    assert.equal(repaired[0].path, path.join(store.ROOT, vault.slug));
    assert.equal(repaired[0].path.includes('forged-vault-path'), false);
    assert.equal((await store.loadConfig()).activeVaultId, repaired[0].id);

    const loaded = await store.loadVault(repaired[0].id);
    assert.equal(Array.isArray(loaded.notes), true);
    await assert.rejects(() => store.loadVault('../bad'), /Invalid vault id/);
  });
});

test('Trash, note version, and canvas restore paths reject symlinked files', async () => {
  if (process.platform === 'win32') return;
  await withIsolatedStore(async (store) => {
    const vault = (await store.listVaults()).find(item => item.name === 'Personal');
    const secretNotePath = path.join(store.ROOT, 'outside-note.md');
    fs.writeFileSync(
      secretNotePath,
      '---\nid: n_secret\ntitle: Outside Secret\n---\n\nleaked secret body',
      'utf8'
    );

    const trashNotesDir = path.join(store.ROOT, vault.slug, '.trash', 'notes');
    fs.mkdirSync(trashNotesDir, { recursive: true });
    fs.symlinkSync(secretNotePath, path.join(trashNotesDir, 'trash_link.md'));

    const deletedNotes = await store.listDeletedNotes(vault.id);
    assert.equal(JSON.stringify(deletedNotes).includes('Outside Secret'), false);
    await assert.rejects(() => store.restoreDeletedNote(vault.id, 'trash_link'), /symlink/);

    const versionsDir = path.join(store.ROOT, vault.slug, '.versions', 'notes', 'n_versioned');
    fs.mkdirSync(versionsDir, { recursive: true });
    fs.symlinkSync(secretNotePath, path.join(versionsDir, 'ver_link.md'));

    const versions = await store.listNoteVersions(vault.id, 'n_versioned');
    assert.equal(JSON.stringify(versions).includes('Outside Secret'), false);
    await assert.rejects(() => store.restoreNoteVersion(vault.id, 'n_versioned', 'ver_link'), /symlink/);

    const secretCanvasPath = path.join(store.ROOT, 'outside-canvas.json');
    fs.writeFileSync(
      secretCanvasPath,
      JSON.stringify({ id: 'c_secret', title: 'Outside Canvas', elements: [{ type: 'text', text: 'secret' }] }),
      'utf8'
    );
    const canvasesDir = path.join(store.ROOT, vault.slug, '.canvases');
    fs.mkdirSync(canvasesDir, { recursive: true });
    fs.symlinkSync(secretCanvasPath, path.join(canvasesDir, 'c_linked.json'));
    await assert.rejects(() => store.deleteCanvas(vault.id, 'c_linked'), /symlink/);

    const trashCanvasesDir = path.join(store.ROOT, vault.slug, '.trash', 'canvases');
    fs.mkdirSync(trashCanvasesDir, { recursive: true });
    fs.symlinkSync(secretCanvasPath, path.join(trashCanvasesDir, 'canvas_link.json'));

    const deletedCanvases = await store.listDeletedCanvases(vault.id);
    assert.equal(JSON.stringify(deletedCanvases).includes('Outside Canvas'), false);
    await assert.rejects(() => store.restoreDeletedCanvas(vault.id, 'canvas_link'), /symlink/);
  });
});

test('Store ignores symlinked JSON metadata and config files', async () => {
  if (process.platform === 'win32') return;
  await withIsolatedStore(async (store) => {
    const vault = (await store.listVaults()).find(item => item.name === 'Personal');
    const externalMeta = path.join(store.ROOT, 'outside-meta.json');
    fs.writeFileSync(externalMeta, JSON.stringify({
      tags: [{ name: 'external-secret', hue: 33 }],
      lastSelectedId: null,
    }), 'utf8');
    const metaPath = path.join(store.ROOT, vault.slug, '.meta.json');
    fs.unlinkSync(metaPath);
    fs.symlinkSync(externalMeta, metaPath);

    const loaded = await store.loadVault(vault.id);
    assert.equal(loaded.tags.some(tag => tag.name === 'external-secret'), false);
    const brokenMetaName = fs.readdirSync(path.join(store.ROOT, vault.slug))
      .find(name => name.startsWith('.meta.json.broken.'));
    assert.ok(brokenMetaName);
    assert.equal(fs.lstatSync(path.join(store.ROOT, vault.slug, brokenMetaName)).isSymbolicLink(), true);

    const externalConfig = path.join(store.ROOT, 'outside-config.json');
    fs.writeFileSync(externalConfig, JSON.stringify({ vaults: [] }), 'utf8');
    fs.chmodSync(externalConfig, 0o644);
    fs.unlinkSync(store.__test.CONFIG_FILE);
    fs.symlinkSync(externalConfig, store.__test.CONFIG_FILE);
    store.__test.clearConfigCache();

    const cfg = await store.loadConfig();
    assert.equal(fs.lstatSync(store.__test.CONFIG_FILE).isSymbolicLink(), false);
    assert.equal(fs.statSync(externalConfig).mode & 0o777, 0o644);
    assert.ok(cfg.vaults.length >= 1);
  });
});

test('Vault health resolves wiki links with anchors by note title', async () => {
  await withIsolatedStore(async (store) => {
    const vault = (await store.listVaults()).find(item => item.name === 'Personal');
    const now = new Date().toISOString();
    await store.saveNote(vault.id, {
      id: 'n_anchor_target',
      title: 'Reference Note',
      date: now,
      tags: [],
      body: '# Reference Note\n\n## Section\nBody',
    });
    await store.saveNote(vault.id, {
      id: 'n_anchor_source',
      title: 'Source Note',
      date: now,
      tags: [],
      body: [
        'See [[Reference Note#Section]] and [[Reference Note#Section|section alias]].',
        'Local heading links like [[#Local Section]] should not require a note.',
        'Missing anchored links like [[Missing Note#Section]] should still be reported.',
        '',
        '## Local Section',
      ].join('\n'),
    });

    const health = await store.vaultHealth(vault.id);
    assert.deepEqual(
      health.brokenLinks.filter(item => item.noteId === 'n_anchor_source'),
      [{ noteId: 'n_anchor_source', noteTitle: 'Source Note', target: 'Missing Note' }]
    );
  });
});

test('Security hardening blocks navigation, unsafe metadata, and unsafe AI endpoints', () => {
  const main = mainProcessSource();
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');
  const app = appSource(__dirname);
  const appActions = fs.readFileSync(path.join(__dirname, '../src/app/actions/useAppActionRegistry.js'), 'utf8');
  const markdown = fs.readFileSync(path.join(__dirname, '../src/shared/markdown.jsx'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const outlinerRenderers = fs.readFileSync(path.join(__dirname, '../src/editor/outlinerRenderers.jsx'), 'utf8');
  const markdownInlineRenderers = fs.readFileSync(path.join(__dirname, '../src/editor/markdownInlineRenderers.jsx'), 'utf8');
  const markdownInputRules = fs.readFileSync(path.join(__dirname, '../src/editor/markdownInputRules.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const storeSource = storeProcessSource();
  // The schema, migrations and vec0 table handling live beside the query
  // surface in indexSchema.js; both halves are "the index" for these checks.
  const indexSource = [
    fs.readFileSync(path.join(__dirname, '../lib/index.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../lib/indexSchema.js'), 'utf8'),
  ].join('\n');
  const aiSource = backendAiSource(__dirname);
  const releaseWorkflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release-builds.yml'), 'utf8');
  const store = require('../lib/store');
  const ai = require('../lib/ai');

  assert.match(main, /const \{ fileURLToPath \} = require\('url'\)/);
  assert.match(main, /function hardenWindow\(win\)/);
  assert.match(main, /function ipcErrorResponse\(name, error\)/);
  assert.match(main, /const wrapWithEvent = fn =>/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /webContents\.on\('will-navigate'/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /allowRunningInsecureContent: false/);
  assert.match(main, /async function setPrefsFromIpc\(patch\)/);
  assert.match(main, /function sanitizePrefsPatchFromIpc\(patch\)/);
  assert.match(main, /const PREF_TWEAK_KEYS = new Set\(Object\.keys\(PREF_TWEAK_DEFAULTS\)\)/);
  assert.match(main, /if \(!PREF_TOP_LEVEL_KEYS\.has\(key\)\) throw new Error\('Unsupported preferences field: ' \+ key\)/);
  assert.match(main, /if \(!PREF_TWEAK_KEYS\.has\(key\)\) throw new Error\('Unsupported tweak field: ' \+ key\)/);
  assert.match(main, /const cleanPatch = sanitizePrefsPatchFromIpc\(patch\)/);
  assert.match(main, /Object\.prototype\.hasOwnProperty\.call\(cleanPatch, 'aiConfig'\)/);
  assert.match(main, /const config = ai\.previewConfig\(cleanPatch\.aiConfig\)/);
  assert.match(main, /store\.setPrefs\(\{ \.\.\.cleanPatch, aiConfig: config \}\)/);
  assert.match(main, /ai\.applyConfig\(config\)/);
  assert.match(main, /async function sanitizeAiAskArgs/);
  assert.match(main, /cfg\.vaults\?\.some\(v => v\.id === cleanVaultId\)/);
  assert.match(main, /function sendIpcChunk/);
  assert.match(main, /ipcMain\.handle\('mn:setPrefs',\s+wrap\(setPrefsFromIpc\)\)/);
  assert.doesNotMatch(main, /ipcMain\.handle\('mn:setPrefs',\s+wrap\(store\.setPrefs\)\)/);
  assert.match(main, /ai\.setConfig\(prefs\.aiConfig, \{ rejectUnknown: false \}\)/);
  assert.match(main, /saved AI config ignored/);
  assert.match(main, /idx\.init\(\)/);
  assert.match(main, /function noteSearchIndexFailure\(context, error\)/);
  assert.match(main, /function runOptionalSearchIndexTask\(context, fn\)[\s\S]*?noteSearchIndexFailure\(context, e\)/);
  assert.match(main, /noteSearchIndexFailure\('rebuild vault index', (?:e|error)\)/);
  assert.match(main, /result\?\.config\?\.provider === 'ollama'/);
  assert.match(main, /store\.setPrefs\(\{ aiConfig: ai\.getConfig\(\) \}\)/);
  assert.match(main, /ipcMain\.handle\('mn:ai\.setConfig',\s+wrap\(async (?:\(patch\)|patch) => \{/);
  assert.match(main, /const config = ai\.previewConfig\(patch\)/);
  assert.match(main, /store\.setPrefs\(\{ aiConfig: config \}\)/);
  assert.match(main, /ai\.applyConfig\(config\)/);
  assert.match(main, /ipcMain\.handle\('mn:setTitle', wrapWithEvent/);
  assert.match(main, /function sanitizeExternalUrl\(rawUrl\)/);
  assert.match(main, /function sanitizePluginIdForPrefs\(value, index\)/);
  assert.match(main, /id: sanitizePluginIdForPrefs\(plugin\.id, index\)/);
  assert.match(main, /parsed\.protocol !== 'https:' && parsed\.protocol !== 'mailto:'/);
  assert.match(main, /Backup import file cannot be a symlink/);
  assert.match(main, /Backup export target cannot be a symlink/);
  assert.match(main, /shell\.openExternal\(sanitizeExternalUrl\(url\)\)/);
  assert.match(preload, /openExternal: \(url\) => ipcRenderer\.invoke\('mn:openExternal', url\)/);
  assert.match(main, /ipcMain\.handle\('mn:ai\.editStream', wrapWithEvent/);
  assert.match(main, /idx\.searchDetailed\(vaultId, query, limit\)/);
  assert.match(main, /idx\.searchDetailedStatus\(vaultId, query, limit\)/);
  assert.match(main, /ipcMain\.handle\('mn:searchDetailed'/);
  assert.match(main, /indexReadyPromise = rescanAllVaults\(\)\.catch/);
  assert.match(indexSource, /db\.transaction\(\(\) => \{/);
  assert.match(indexSource, /DROP TABLE note_embeddings/);
  assert.match(indexSource, /function searchDetailed\(vaultId, query, limit = 50\)/);
  assert.match(indexSource, /JOIN notes n ON n\.id = f\.note_id/);
  assert.match(indexSource, /matchedFields/);
  assert.match(indexSource, /LIMIT \?/);
  assert.match(indexSource, /function backlinks\(vaultId, title, limit = 100\)/);
  assert.match(indexSource, /const statements = null|let statements = null/);
  assert.match(appActions, /replace\(\/\[\^A-Z0-9_-\]\+\/g, '-'\)/);

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.doesNotMatch(html, /type="text\/babel"/);
  assert.doesNotMatch(html, /@babel\/standalone/);
  assert.match(html, /react\.production\.min\.js/);
  assert.match(html, /react-dom\.production\.min\.js/);
  assert.match(html, /build\/renderer\/app\.js/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(html, /frame-ancestors/);

  assert.doesNotMatch(markdown, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(markdown, /\.innerHTML\s*=/);
  assert.doesNotMatch(outliner, /ref\.current\.innerHTML\s*=/);
  assert.match(outlinerRenderers, /sandbox=""/);
  assert.match(outlinerRenderers, /function mnMermaidSvgHeight/);
  assert.match(outlinerRenderers, /pointerEvents: 'none'/);
  assert.match(markdownInlineRenderers, /platformApi\.app\.openExternal\(segment\.url\)/);
  assert.match(markdownInlineRenderers, /Load remote image from/);
  assert.match(markdownInlineRenderers, /referrerPolicy="no-referrer"/);
  assert.doesNotMatch(markdownInputRules, /mnMdToBlocks|mnBlocksToMd|dangerouslySetInnerHTML|ipcRenderer|shell\.openExternal|require\('electron'\)/);
  assert.doesNotMatch(markdownInlineRenderers, /dangerouslySetInnerHTML|ipcRenderer|shell\.openExternal|require\('electron'\)/);
  assert.doesNotMatch(aiSource, /env:\s*\{\s*\.\.\.process\.env/);

  assert.match(storeSource, /function sanitizeVaultMetaPatch/);
  assert.match(storeSource, /CONFIG_FILE_MODE = 0o600/);
  assert.match(storeSource, /let configCache = null/);
  assert.match(storeSource, /secureConfigFile/);
  assert.match(storeSource, /writeJson\(CONFIG_FILE, next, \{ mode: CONFIG_FILE_MODE \}\)/);
  assert.match(storeSource, /Unsupported vault metadata field/);
  assert.match(storeSource, /if \(states === null \|\| states === undefined\) return null/);
  assert.match(storeSource, /Unsupported patch field/);
  assert.match(storeSource, /readRegularUtf8File/);
  assert.match(storeSource, /cannot be a symlink/);
  assert.match(storeSource, /MAX_BACKUP_NOTES_PER_VAULT/);
  assert.match(releaseWorkflow, /INPUT_RELEASE_TAG: \$\{\{ inputs\.release_tag \}\}/);
  assert.ok(releaseWorkflow.includes('^v[0-9]+\\.[0-9]+\\.[0-9]+'));
  assert.doesNotMatch(releaseWorkflow, /tag="\$\{\{ inputs\.release_tag \}\}"/);

  const cleanMeta = store.__test.sanitizeVaultMetaPatch({
    tags: [{ name: ' Novel Cast ', hue: 999 }, 'novel-research'],
    lastSelectedId: 'n_valid-1',
    novelistMode: true,
    workflowStates: [],
    novelistAiConfig: { wordLimit: 900, surprise: '<script>', prompts: [{ id: 'draft', prompt: 'Write.' }] },
  });
  assert.deepEqual(cleanMeta.tags, [
    { name: 'novel-cast', hue: 360 },
    { name: 'novel-research', hue: 240 },
  ]);
  assert.equal(cleanMeta.lastSelectedId, 'n_valid-1');
  assert.equal(cleanMeta.novelistMode, true);
  assert.deepEqual(cleanMeta.workflowStates, []);
  assert.equal(cleanMeta.novelistAiConfig.wordLimit, 900);
  assert.equal(cleanMeta.novelistAiConfig.surprise, undefined);
  assert.deepEqual(cleanMeta.novelistAiConfig.prompts, [{ id: 'draft', name: '', prompt: 'Write.' }]);
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ slug: '../x' }), /Unsupported vault metadata field/);
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ lastSelectedId: '../x' }), /Invalid note id/);
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ novelistAiConfig: 'bad' }), /Invalid novelist AI config patch/);

  assert.match(aiSource, /function sanitizeConfigPatch/);
  assert.match(aiSource, /SECRET_CONFIG_KEYS/);
  assert.match(aiSource, /let ollamaSpawnPromise = null/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ ollamaHost: 'http://127.0.0.1:9999' }), /Ollama host/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'http://127.0.0.1:8080/v1' }), /HTTPS/);
  assert.equal(ai.__test.sanitizeConfigPatch({ ollamaHost: 'http://localhost:11434' }).ollamaHost, 'http://localhost:11434');
  const previousOllamaModels = process.env.OLLAMA_MODELS;
  process.env.OLLAMA_MODELS = '/tmp/vispnote-ollama-models';
  assert.equal(ai.__test.ollamaServeEnv().OLLAMA_MODELS, '/tmp/vispnote-ollama-models');
  if (previousOllamaModels == null) delete process.env.OLLAMA_MODELS;
  else process.env.OLLAMA_MODELS = previousOllamaModels;
  assert.match(aiSource, /await ollamaSpawnPromise/);
  assert.equal(ai.__test.sanitizeSecretValue('  sk-test\r\nbad\u0000  '), 'sk-testbad');
  assert.match(aiSource, /piiReduction/);
  assert.match(aiSource, /Invalid \$\{field\} protocol/);
  assert.match(aiSource, /config: publicConfig\(\)/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'file:///tmp/model' }), /Invalid customBaseUrl protocol/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ surprise: true }), /Unsupported AI config field/);
  assert.equal(ai.__test.sanitizeConfigPatch({ piiReduction: false }).piiReduction, false);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'http://localhost:11434/v1/' }), /HTTPS/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'https://localhost./v1' }), /private hosts/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'https://localhost%2E/v1' }), /private hosts/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'https://127.0.0.1./v1' }), /private hosts/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'https://[::ffff:127.0.0.1]/v1' }), /private hosts/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'https://127.0.0.1.nip.io/v1' }), /private hosts/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'https://app.192-168-1-10.sslip.io/v1' }), /private hosts/);
  assert.equal(ai.__test.sanitizeConfigPatch({ customBaseUrl: 'https://api.example.com/v1' }).customBaseUrl, 'https://api.example.com/v1');
  assert.equal(
    ai.__test.publicConfig({ openaiApiKey: 'secret-key', provider: 'openai' }).openaiApiKey,
    'configured'
  );
});

test('AI PII reduction masks hosted provider requests and restores local placeholders', async () => {
  const ai = require('../lib/ai');
  const providerTransport = require('../lib/integrations/ai/providerTransport');
  const originalConfig = ai.getConfig();
  const sensitive = [
    'Email jane.doe@example.com',
    'phone +1 (415) 555-0134',
    'SSN 123-45-6789',
    'card 4111 1111 1111 1111',
    'address 123 Market Street',
    'token sk-1234567890abcdefghijkl',
    'IP 10.0.0.5',
  ].join(', ');
  const reduced = ai.__test.reducePiiMessages([{ role: 'user', content: sensitive }]);
  const redacted = reduced.messages[0].content;

  assert.match(redacted, /\[EMAIL_1\]/);
  assert.match(redacted, /\[PHONE_1\]/);
  assert.match(redacted, /\[SSN_1\]/);
  assert.match(redacted, /\[CARD_1\]/);
  assert.match(redacted, /\[ADDRESS_1\]/);
  assert.match(redacted, /\[SECRET_1\]/);
  assert.match(redacted, /\[IP_1\]/);
  assert.equal(ai.__test.reducePiiText('plain eyJshort.payload.text'), 'plain eyJshort.payload.text');
  assert.equal(ai.__test.isPrivateHost('::1'), true);
  assert.equal(ai.__test.isPrivateHost('fd00::1'), true);
  assert.equal(ai.__test.isPrivateHost('localhost.'), true);
  assert.equal(ai.__test.isPrivateHost('localhost%2E'), true);
  assert.equal(ai.__test.isPrivateHost('api.example.com'), false);
  assert.doesNotMatch(redacted, /jane\.doe@example\.com/);
  assert.equal(
    ai.__test.restorePiiText('Reply to [EMAIL_1] at [PHONE_1].', reduced.replacements),
    'Reply to jane.doe@example.com at +1 (415) 555-0134.'
  );

  let capturedBody = null;
  const resetTransport = providerTransport.setTransportDependenciesForTests({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (_options, callback) => {
      const request = new EventEmitter();
      let body = '';
      request.write = chunk => { body += String(chunk); };
      request.destroy = () => {};
      request.end = () => {
        capturedBody = JSON.parse(body);
        const response = Readable.from([
          Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Use [EMAIL_1] and [PHONE_1].' } }] })),
        ]);
        response.statusCode = 200;
        response.statusMessage = 'OK';
        response.headers = {};
        queueMicrotask(() => callback(response));
      };
      return request;
    },
  });

  try {
    ai.setConfig({
      provider: 'custom',
      customBaseUrl: 'https://example.invalid/v1',
      customApiKey: 'test-key',
      chatModel: 'test-model',
      piiReduction: true,
    });
    const result = await ai.__test.providerChat([{ role: 'user', content: sensitive }]);
    const sentMessages = JSON.stringify(capturedBody.messages);
    assert.match(sentMessages, /\[EMAIL_1\]/);
    assert.match(sentMessages, /\[PHONE_1\]/);
    assert.doesNotMatch(sentMessages, /jane\.doe@example\.com/);
    assert.doesNotMatch(sentMessages, /\+1 \(415\) 555-0134/);
    assert.equal(result.text, 'Use jane.doe@example.com and +1 (415) 555-0134.');

    ai.setConfig({ piiReduction: false });
    await ai.__test.providerChat([{ role: 'user', content: 'Email jane.doe@example.com' }]);
    assert.match(JSON.stringify(capturedBody.messages), /jane\.doe@example\.com/);
  } finally {
    resetTransport();
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('AI note traversal expands seed notes through links backlinks and tags', () => {
  const ai = require('../lib/ai');
  const notes = [
    { id: 'current', title: 'Current', tags: ['focus'], body: 'Current note body' },
    { id: 'seed', title: 'Seed', tags: ['reading'], body: 'See [[Linked]].' },
    { id: 'linked', title: 'Linked', tags: [], body: 'Linked body' },
    { id: 'backlink', title: 'Backlink', tags: [], body: 'Mentions [[Seed]].' },
    { id: 'shared', title: 'Shared tag', tags: ['reading'], body: 'Same category' },
    { id: 'other', title: 'Other', tags: [], body: 'Unrelated' },
  ];
  const expanded = ai.__test.expandTraversalCandidates(['seed'], notes, 'what is related to seed?');
  assert.deepEqual(expanded.map(item => item.note.id).slice(0, 4), ['seed', 'linked', 'backlink', 'shared']);
  assert.ok(expanded.find(item => item.note.id === 'linked').reasons.some(reason => reason.includes('linked from')));
  assert.ok(expanded.find(item => item.note.id === 'backlink').reasons.some(reason => reason.includes('backlinks')));
  assert.ok(expanded.find(item => item.note.id === 'shared').reasons.some(reason => reason.includes('shares #reading')));

  const currentNoteExpanded = ai.__test.expandTraversalCandidates([], notes, 'summarize this note', { currentNoteId: 'current' });
  assert.equal(currentNoteExpanded[0].note.id, 'current');
  assert.ok(currentNoteExpanded[0].reasons.some(reason => reason.includes('current note')));
});

test('AI recursive note research uses only bounded read-only note tools', async () => {
  const ai = require('../lib/ai');
  const notes = [
    { id: 'seed', title: 'Seed', tags: ['topic'], body: 'See [[Linked]].' },
    { id: 'linked', title: 'Linked', tags: [], body: 'Linked body' },
    { id: 'backlink', title: 'Backlink', tags: [], body: 'Mentions [[Seed]].' },
    { id: 'shared', title: 'Shared tag', tags: ['topic'], body: 'Same category' },
    { id: 'other', title: 'Other', tags: [], body: 'Unrelated' },
  ];
  const research = await ai.__test.runRecursiveNoteResearch({
    query: 'explain Seed connections',
    allNotes: notes,
    seedIds: ['seed'],
    options: {
      planNoteResearch: async ({ round }) => round === 1
        ? [
          { tool: 'get_links', args: { id: 'seed' } },
          { tool: 'get_backlinks', args: { id: 'seed' } },
          { tool: 'get_notes_by_tag', args: { tag: 'topic' } },
          { tool: 'read_file', args: { path: '/etc/passwd' } },
        ]
        : [{ tool: 'finish' }],
    },
  });

  assert.deepEqual(research.notes.map(note => note.id).slice(0, 4), ['seed', 'linked', 'backlink', 'shared']);
  assert.equal(research.toolLog.some(entry => entry.tool === 'read_file' && /Rejected unknown/.test(entry.summary)), true);
  assert.equal(research.toolCalls, 5);
});

test('AI recursive note research is gated for simple specific queries unless forced', () => {
  const ai = require('../lib/ai');
  assert.equal(ai.__test.shouldUseRecursiveNoteResearch('open Alpha note', ['a', 'b', 'c'], {}), false);
  assert.equal(ai.__test.shouldUseRecursiveNoteResearch('what did I decide about Alpha?', ['a', 'b', 'c'], {}), false);
  assert.equal(ai.__test.shouldUseRecursiveNoteResearch('open Alpha note', ['a', 'b', 'c'], { recursiveResearch: true }), true);
  assert.equal(ai.__test.shouldUseRecursiveNoteResearch('summarise all my notes', ['a'], { recursiveResearch: true }), false);
  assert.equal(ai.__test.shouldUseRecursiveNoteResearch('what did I decide about Alpha?', ['a'], { recursiveResearch: false }), false);
});

test('AI high-risk capability policy remains disabled by default', () => {
  const { aiActions } = loadRendererModule('src/ai/aiActions.js');
  const action = aiActions.classifyPrompt('run python code over my notes').action;
  assert.equal(action.type, 'high-risk-disabled');
  assert.match(action.reason, /not enabled/);
  assert.match(action.reason, /Settings toggle/);
});

test('Store hardening validates trash ids, merge keys, and backup size', async () => {
  await withIsolatedStore(async (store) => {
    const vault = (await store.listVaults())[0];
    await assert.rejects(
      () => store.purgeDeletedNote(vault.id, '../bad'),
      /Invalid trash id/
    );
    await assert.rejects(
      () => store.setPrefs({ tweaks: { constructor: { polluted: true } } }),
      /Unsupported patch field/
    );
    await assert.rejects(
      () => store.importBackup(' '.repeat(51 * 1024 * 1024)),
      /too large/
    );
    const tooManyNotes = Array.from({ length: store.__test.MAX_BACKUP_NOTES_PER_VAULT + 1 }, (_, index) => ({
      id: `n_many_${index}`,
      title: `Many ${index}`,
      body: '',
    }));
    await assert.rejects(
      () => store.importBackup(JSON.stringify({
        format: 'vispnote.backup.v1',
        vaults: [{ name: 'Too many notes', notes: tooManyNotes, canvases: [] }],
      })),
      /too many notes/
    );
    await assert.rejects(
      () => store.saveNote(vault.id, {
        id: 'n_big',
        title: 'Too big',
        date: new Date().toISOString(),
        tags: [],
        body: 'x'.repeat(store.__test.MAX_NOTE_BODY_BYTES + 1),
      }),
      /Note body is too large/
    );
  });
});

test('Backup import preserves duplicate note and canvas ids without overwriting', async () => {
  await withIsolatedStore(async (store) => {
    const backup = {
      format: 'vispnote.backup.v1',
      app: 'VispNote',
      exportedAt: new Date().toISOString(),
      vaults: [{
        name: 'Imported duplicates',
        meta: { tags: [], lastSelectedId: 'n_same' },
        notes: [
          { id: 'n_same', title: 'First duplicate', date: '2026-05-12T00:00:00.000Z', tags: [], body: 'one' },
          { id: 'n_same', title: 'Second duplicate', date: '2026-05-12T00:00:00.000Z', tags: [], body: 'two' },
          { title: 'Missing id', date: '2026-05-12T00:00:00.000Z', tags: [], body: 'three' },
        ],
        canvases: [
          { id: 'c_same', title: 'First canvas', elements: [] },
          { id: 'c_same', title: 'Second canvas', elements: [] },
          { title: 'Missing canvas id', elements: [] },
        ],
      }],
    };

    const result = await store.importBackup(JSON.stringify(backup));
    const importedVault = result.importedVaults[0];
    const loaded = await store.loadVault(importedVault.id);
    const canvases = await store.listCanvases(importedVault.id);

    assert.equal(loaded.notes.length, 3);
    assert.equal(new Set(loaded.notes.map(note => note.id)).size, 3);
    assert.deepEqual(loaded.notes.map(note => note.title).sort(), ['First duplicate', 'Missing id', 'Second duplicate']);
    assert.equal(canvases.length, 3);
    assert.equal(new Set(canvases.map(canvas => canvas.id)).size, 3);
    assert.deepEqual(canvases.map(canvas => canvas.title).sort(), ['First canvas', 'Missing canvas id', 'Second canvas']);
  });
});

test('Backup commit merges with a concurrent vault creation from fresh config', async () => {
  await withIsolatedStore(async (store) => {
    const backup = {
      format: 'vispnote.backup.v1',
      app: 'VispNote',
      exportedAt: new Date().toISOString(),
      vaults: [{
        name: 'Concurrent vault',
        meta: { tags: [] },
        notes: [{ id: 'n_imported', title: 'Imported', tags: [], body: 'imported' }],
        canvases: [],
      }],
    };

    const [created, imported] = await Promise.all([
      store.createVault('Concurrent vault'),
      store.importBackup(JSON.stringify(backup)),
    ]);
    const vaults = await store.listVaults();
    const importedVault = imported.importedVaults[0];
    assert.equal(vaults.some(vault => vault.id === created.id), true);
    assert.equal(vaults.some(vault => vault.id === importedVault.id), true);
    assert.notEqual(created.slug, importedVault.slug);
  });
});

test('Native file dialog IPC paths report cancel and skipped work explicitly', () => {
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const app = appSource(__dirname);

  assert.match(preload, /exportBackup:\(options\) => ipcRenderer\.invoke\('mn:exportBackup', options\)/);
  assert.match(preload, /importBackup:\(options\) => ipcRenderer\.invoke\('mn:importBackup', options\)/);
  assert.match(preload, /importNovelFiles:\(options\) => ipcRenderer\.invoke\('mn:importNovelFiles', options\)/);

  assert.match(main, /ipcMain\.handle\('mn:exportBackup'/);
  assert.match(main, /ipcMain\.handle\('mn:importBackup'/);
  assert.match(main, /ipcMain\.handle\('mn:importNovelFiles', wrap\(importNovelFilesFromIpc\)\)/);
  assert.match(main, /if \(result\.canceled \|\| !result\.filePath\) return \{ canceled: true \}/);
  assert.match(main, /if \(result\.canceled \|\| !result\.filePaths\?\.\[0\]\) return \{ canceled: true \}/);
  assert.match(main, /if \(result\.canceled \|\| !result\.filePaths\?\.length\) return \{ canceled: true, files: \[\], skipped: \[\] \}/);
  assert.match(main, /Only the first 8 files were imported\./);
  assert.match(main, /File is larger than 750 KB\./);
  assert.match(main, /File does not look like readable UTF-8 text\./);
  assert.match(main, /return \{ canceled: false, files, skipped \}/);

  assert.match(app, /if \(res\.value\?\.canceled\) return/);
  assert.match(app, /showAppNotice\('No files imported', reason, 'warn'\)/);
  assert.match(app, /setNovelImportDialog\(\{ seq: importSeq, phase: 'analyzing', files, skipped/);
});

test('Data safety wiring exposes trash, versions, and save conflict recovery', () => {
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const store = storeProcessSource();
  const app = appSource(__dirname);
  const trashController = fs.readFileSync(path.join(__dirname, '../src/features/trash/useTrashController.js'), 'utf8');
  const settingsRoot = path.join(__dirname, '../src/settings');
  const settings = [
    path.join(settingsRoot, 'settings.jsx'),
    path.join(settingsRoot, 'settingsControls.jsx'),
    path.join(settingsRoot, 'settingsPrimitives.jsx'),
    ...fs.readdirSync(path.join(settingsRoot, 'sections')).sort().map(name => path.join(settingsRoot, 'sections', name)),
  ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');
  const utilityPanels = fs.readFileSync(path.join(__dirname, '../src/features/trash/components/RecentlyDeletedPanel.jsx'), 'utf8');
  const editorHeader = fs.readFileSync(path.join(__dirname, '../src/editor/EditorHeader.jsx'), 'utf8');

  assert.match(store, /atomicWriteFile/);
  assert.match(store, /NOTE_CONFLICT/);
  assert.match(store, /listDeletedNotes/);
  assert.match(store, /restoreNoteVersion/);
  assert.match(store, /restoreDeletedCanvas/);
  assert.match(main, /mn:listDeletedNotes/);
  assert.match(main, /mn:restoreDeletedCanvas/);
  assert.match(main, /mn:restoreNoteVersion/);
  assert.match(preload, /listNoteVersions/);
  assert.match(preload, /listDeletedCanvases/);
  assert.match(preload, /restoreDeletedNote/);

  assert.match(app, /expectedModifiedAt: n\.diskModifiedAt/);
  assert.match(app, /setSelectedId\(current => current === id/);
  assert.match(app, /titleUpdateTimerRef/);
  assert.match(app, /MnSaveConflictDialog/);
  assert.match(app, /MnVersionHistoryDialog/);
  assert.match(app, /MnRecentlyDeletedPanel/);
  assert.match(trashController, /const refresh = useCallback/);
  assert.match(app, /view === 'trash'/);
  assert.match(trashController, /setItems\(current => current\.filter/);
  assert.match(sidebar, /label="Recently deleted"/);
  assert.match(sidebar, /trashActive/);
  assert.match(utilityPanels, /function MnRecentlyDeletedPanel/);
  assert.match(utilityPanels, /Pending cleanup/);
  assert.match(utilityPanels, /Confirm delete/);
  assert.match(store, /MAX_BACKUP_IMPORT_BYTES/);
  assert.match(store, /MAX_NOTE_BODY_BYTES/);
  assert.match(store, /MAX_CANVAS_JSON_BYTES/);
  assert.match(store, /cleanMergePatch/);
  assert.match(store, /validateTrashId\(trashId\)/);
  assert.match(settings, /Recently deleted/);
  assert.match(settings, /onRestoreDeletedNote/);
  assert.match(editorHeader, /Version history/);
});

test('vaultStamp reports change cheaply and saveNote reports the previous title', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    // Seed notes materialize on first load, so load before fingerprinting.
    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes[0];
    const before = await store.vaultStamp(vault.id);
    assert.ok(before.count > 0);
    assert.ok(before.maxMtimeMs > 0);

    await new Promise(resolve => setTimeout(resolve, 12));
    const saved = await store.saveNote(vault.id, { ...note, title: 'Renamed by stamp test', body: 'changed' }, {});

    // The save path reads the old file once and hands the old title back, so
    // the rename-links pass no longer needs its own read of the same file.
    assert.equal(saved.previousTitle, note.title);

    const after = await store.vaultStamp(vault.id);
    assert.equal(after.count, before.count);
    assert.ok(after.maxMtimeMs > before.maxMtimeMs, 'a save moves the fingerprint');
  });
});

// A corrupt .config.json used to be quarantined and replaced by a first-run
// seed, so a user with notes in personal/ booted into an empty personal-2/ and
// believed the vaults were gone. Every vault folder carries its own .meta.json,
// so the vault list can always be rebuilt from disk.
test('a corrupt config rebuilds the vault list from the folders on disk', async () => {
  await withIsolatedStore(async (store, home) => {
    fs.writeFileSync(path.join(home, '.config.json'), '{ "vaults": [ this is not json');
    for (const [slug, title] of [['personal', 'Kept personal note'], ['work', 'Kept work note']]) {
      fs.mkdirSync(path.join(home, slug), { recursive: true });
      fs.writeFileSync(
        path.join(home, slug, '.meta.json'),
        JSON.stringify({ id: `v_${slug}`, slug, tags: [], lastSelectedId: null })
      );
      fs.writeFileSync(
        path.join(home, slug, `n_${slug}.md`),
        `---\nid: n_${slug}\ntitle: ${title}\n---\n\nBody of ${slug}\n`
      );
    }

    const cfg = await store.loadConfig();
    assert.deepEqual(cfg.vaults.map(v => v.slug), ['personal', 'work']);
    // No name in the meta: the folder slug is title-cased rather than invented.
    assert.deepEqual(cfg.vaults.map(v => v.name), ['Personal', 'Work']);
    assert.equal(cfg.activeVaultId, 'v_personal');

    assert.equal(fs.existsSync(path.join(home, 'personal-2')), false, 'booted into a fresh empty vault beside the real one');
    assert.equal(fs.existsSync(path.join(home, 'work-2')), false);

    const personal = await store.loadVault('v_personal');
    assert.deepEqual(personal.notes.map(note => note.title), ['Kept personal note']);
    const work = await store.loadVault('v_work');
    assert.deepEqual(work.notes.map(note => note.title), ['Kept work note']);

    const prefs = await store.getPrefs();
    assert.equal(prefs.configRecovery.vaultCount, 2);
    assert.match(prefs.configRecovery.brokenFile, /\.config\.json\.broken\./);
    assert.ok(fs.existsSync(prefs.configRecovery.brokenFile), 'the damaged file was named but not kept');

    // The rebuilt config is on disk, so the next boot is an ordinary boot.
    const written = JSON.parse(fs.readFileSync(path.join(home, '.config.json'), 'utf8'));
    assert.deepEqual(written.vaults.map(v => v.id), ['v_personal', 'v_work']);
  });
});

test('the boot after a recovery reads the rebuilt config and reports nothing', async () => {
  // The recovery marker lives in main-process memory only. If it leaked into
  // the config, the "your vaults were recovered" notice would greet the user
  // on every launch forever.
  await withIsolatedStore(async (store, home) => {
    fs.writeFileSync(path.join(home, '.config.json'), 'not json');
    fs.mkdirSync(path.join(home, 'personal'), { recursive: true });
    fs.writeFileSync(path.join(home, 'personal', '.meta.json'), JSON.stringify({ id: 'v_personal', slug: 'personal' }));
    fs.writeFileSync(path.join(home, 'personal', 'n_kept.md'), '---\nid: n_kept\ntitle: Kept\n---\n\nBody\n');

    const first = await store.getPrefs();
    assert.equal(first.configRecovery?.vaultCount, 1, 'the recovery boot did not set the marker');

    // Same home, fresh main process: the ordinary next launch.
    const storePath = require.resolve('../lib/store');
    delete require.cache[storePath];
    const rebooted = require('../lib/store');
    const prefs = await rebooted.getPrefs();
    assert.equal(prefs.configRecovery, null, 'the recovery notice would reappear on every boot');
    const vaults = await rebooted.listVaults();
    assert.deepEqual(vaults.map(v => v.id), ['v_personal'], 'the adopted vault did not survive the next boot');
    delete require.cache[storePath];
  });
});

test('an empty root still seeds one Personal vault and reports no recovery', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    assert.deepEqual(vaults.map(v => v.name), ['Personal']);
    const personal = await store.loadVault(vaults[0].id);
    assert.equal(personal.notes.length, 1);

    const prefs = await store.getPrefs();
    assert.equal(prefs.configRecovery, null, 'a fresh install was told its vaults had been recovered');
  });
});

// An unreadable note file used to be dropped silently between loadVault and the
// backup payload, so an incomplete backup looked complete.
test('exportBackup names the note files it could not read', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await store.loadVault(vault.id);
    // A directory where a note file belongs is unreadable in the same way a
    // permission-denied or symlinked note file is.
    fs.mkdirSync(path.join(store.ROOT, vault.slug, 'n_broken.md'), { recursive: true });

    const { payload } = await store.exportBackup({});
    const warning = payload.warnings.find(item => item.file === 'n_broken.md');
    assert.ok(warning, `no warning named the unreadable file: ${JSON.stringify(payload.warnings)}`);
    assert.equal(warning.vaultId, vault.id, 'the warning did not say which vault lost a note');
    assert.equal(payload.vaults.length, 1, 'the backup was withheld instead of being returned with its warning');
  });
});

// exportBackup is driven directly here so the limit arithmetic can be exercised
// without building a vault big enough to breach it.
function makeBackupRepository(overrides = {}) {
  const { createBackupRepository } = require('../lib/storage/repositories/backupRepository.js');
  const vaults = overrides.vaults || [{ id: 'v1', name: 'Personal', slug: 'personal' }];
  const notes = overrides.notes || [{ id: 'n_1', title: 'One', body: 'a' }, { id: 'n_2', title: 'Two', body: 'b' }];
  const loaded = { loadedVaults: [] };
  const repository = createBackupRepository({
    loadConfig: async () => ({ activeVaultId: vaults[0]?.id || null, vaults }),
    loadVault: async id => { loaded.loadedVaults.push(id); return { notes, tags: [], warnings: [] }; },
    listCanvases: async () => [],
    readJsonSafe: async () => ({}),
    vaultMetaFile: slug => `/tmp/${slug}/.meta.json`,
    validateEntityId: value => value,
    backupFormat: 'vispnote.backup.v1',
    appName: 'VispNote',
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
    assertArrayLimit: (items, maxItems, message) => { if (Array.isArray(items) && items.length > maxItems) throw new Error(message); },
    maxImportBytes: overrides.maxImportBytes ?? 50 * 1024 * 1024,
    limits: overrides.limits || { vaults: 50, notes: 1, canvases: 1000 },
  });
  return { repository, loaded };
}

test('exportBackup warns when the payload breaches the limits importBackup enforces', async () => {
  const { repository } = makeBackupRepository();

  const { payload } = await repository.exportBackup({});
  const warning = payload.warnings.find(item => item.type === 'backup-too-large');
  assert.ok(warning, 'a backup that cannot be restored was reported as fine');
  assert.equal(warning.breached, 'notes');
  assert.equal(warning.noteCount, 2, 'the warning did not carry the real note count');
  assert.equal(warning.limit, 1);
  assert.equal(warning.sizeLimitMb, 50);
  assert.equal(typeof warning.sizeMb, 'number');
  assert.equal(payload.vaults[0].notes.length, 2, 'the backup was withheld instead of being written with its warning');
});

// The vault cap is the one breach importBackup refuses outright, so an export
// over it is a hard failure rather than a warning: the user hears about it now
// instead of hours later at restore.
test('exportBackup refuses a payload with more vaults than importBackup would accept', async () => {
  const vaults = Array.from({ length: 51 }, (_, i) => ({ id: `v${i}`, name: `Vault ${i}`, slug: `vault-${i}` }));
  const { repository, loaded } = makeBackupRepository({ vaults, limits: { vaults: 50, notes: 1000, canvases: 1000 } });

  await assert.rejects(
    () => repository.exportBackup({}),
    { message: 'Backup has too many vaults; maximum is 50' },
    'the export did not give the message importBackup gives for the same file'
  );
  assert.deepEqual(loaded.loadedVaults, [], 'the vaults were read before the cap was checked');
});

test('exportBackup accepts a payload exactly at the vault cap', async () => {
  const vaults = Array.from({ length: 50 }, (_, i) => ({ id: `v${i}`, name: `Vault ${i}`, slug: `vault-${i}` }));
  const { repository } = makeBackupRepository({ vaults, limits: { vaults: 50, notes: 1000, canvases: 1000 } });
  const { payload } = await repository.exportBackup({});
  assert.equal(payload.vaults.length, 50, 'the cap was off by one and refused a backup it should have written');
});

// The size the notice quotes has to be the size of the file on disk. Measuring
// before the oversize warning was appended under-reported the bytes written.
test('exportBackup measures the bytes it actually hands back, warnings included', async () => {
  const { repository } = makeBackupRepository();
  const result = await repository.exportBackup({});

  assert.equal(result.sizeBytes, Buffer.byteLength(result.text, 'utf8'),
    'the reported size is not the size of the string the caller writes');
  const warning = result.payload.warnings.find(item => item.type === 'backup-too-large');
  assert.ok(result.text.includes('backup-too-large'), 'the warning is not in the bytes that get written');
  assert.equal(warning.sizeBytes, result.sizeBytes, 'the warning quotes a size the file does not have');
  assert.equal(warning.sizeMb, Math.round((result.sizeBytes / (1024 * 1024)) * 10) / 10);
  assert.equal(result.noteCount, 2);
  assert.equal(result.canvasCount, 0);
});

test('a clean export still serializes the payload it returns', async () => {
  const { repository } = makeBackupRepository({ limits: { vaults: 50, notes: 1000, canvases: 1000 } });
  const result = await repository.exportBackup({});
  assert.deepEqual(result.payload.warnings, [], 'a backup within every limit was warned about');
  assert.equal(result.text, JSON.stringify(result.payload));
  assert.equal(result.sizeBytes, Buffer.byteLength(result.text, 'utf8'));
});

// The recovery scan reads every vault's .meta.json. It used to read them with
// readJsonSafe, which renames an unreadable file to `<file>.broken.<stamp>` —
// correct for our own config, catastrophic here: a recovery pass quarantined
// the user's own vault metadata while trying to rescue it.
function snapshotDir(dir) {
  const names = fs.readdirSync(dir).sort();
  return names.map(name => {
    const target = path.join(dir, name);
    const stat = fs.lstatSync(target);
    return { name, size: stat.size, bytes: stat.isFile() ? fs.readFileSync(target).toString('base64') : null };
  });
}

test('a recovery scan never renames or rewrites a vault meta file it cannot read', async () => {
  await withIsolatedStore(async (store, home) => {
    fs.writeFileSync(path.join(home, '.config.json'), 'not json at all');

    // Two ways readJsonSafe would have quarantined the file: unparseable, and
    // bigger than the 1 MB JSON read cap.
    const corrupt = path.join(home, 'corrupt');
    fs.mkdirSync(corrupt, { recursive: true });
    fs.writeFileSync(path.join(corrupt, '.meta.json'), '{ "id": "v_corrupt", broken');
    const huge = path.join(home, 'huge');
    fs.mkdirSync(huge, { recursive: true });
    fs.writeFileSync(path.join(huge, '.meta.json'), `{"id":"v_huge","slug":"huge","pad":"${'x'.repeat(1024 * 1024 + 64)}"}`);
    // One readable vault, so the scan adopts something and does not fall back
    // to the first-run seed before it ever reaches the broken folders.
    const good = path.join(home, 'good');
    fs.mkdirSync(good, { recursive: true });
    fs.writeFileSync(path.join(good, '.meta.json'), JSON.stringify({ id: 'v_good', slug: 'good' }));

    const before = { corrupt: snapshotDir(corrupt), huge: snapshotDir(huge) };

    const cfg = await store.loadConfig();
    assert.deepEqual(cfg.vaults.map(v => v.slug), ['good'], 'a vault whose meta cannot be read was adopted anyway');

    assert.deepEqual(snapshotDir(corrupt), before.corrupt, 'the unreadable meta file was renamed or rewritten');
    assert.deepEqual(snapshotDir(huge), before.huge, 'the oversized meta file was renamed or rewritten');
    for (const dir of [corrupt, huge]) {
      assert.equal(fs.readdirSync(dir).some(name => name.includes('.broken.')), false,
        `the scan quarantined a user meta file in ${path.basename(dir)}`);
    }
  });
});

test('the recovery marker says the settings file could not be read', async () => {
  await withIsolatedStore(async (store, home) => {
    fs.writeFileSync(path.join(home, '.config.json'), 'not json');
    fs.mkdirSync(path.join(home, 'personal'), { recursive: true });
    fs.writeFileSync(path.join(home, 'personal', '.meta.json'), JSON.stringify({ id: 'v_personal', slug: 'personal' }));

    const prefs = await store.getPrefs();
    assert.equal(prefs.configRecovery.reason, 'unreadable');
    assert.match(prefs.configRecovery.brokenFileName, /^\.config\.json\.broken\./);
    assert.equal(/[\\/]/.test(prefs.configRecovery.brokenFileName), false,
      'the notice would read an absolute path aloud instead of a filename');
    assert.ok(fs.existsSync(prefs.configRecovery.brokenFile), 'brokenFile stopped being the path to the file');
  });
});

test('the recovery marker says the settings file was missing', async () => {
  await withIsolatedStore(async (store, home) => {
    // No .config.json at all: nothing was damaged, so nothing was set aside.
    fs.mkdirSync(path.join(home, 'personal'), { recursive: true });
    fs.writeFileSync(path.join(home, 'personal', '.meta.json'), JSON.stringify({ id: 'v_personal', slug: 'personal' }));

    const prefs = await store.getPrefs();
    assert.equal(prefs.configRecovery.reason, 'missing');
    assert.equal(prefs.configRecovery.brokenFile, null);
    assert.equal(prefs.configRecovery.brokenFileName, null);
    assert.equal(prefs.configRecovery.vaultCount, 1);
  });
});

test('the recovery marker says the settings file listed no vaults', async () => {
  await withIsolatedStore(async (store, home) => {
    // Valid JSON, parsed fine, simply empty. Claiming damage here would be a lie.
    fs.writeFileSync(path.join(home, '.config.json'), JSON.stringify({ vaults: [], activeVaultId: null }));
    fs.mkdirSync(path.join(home, 'personal'), { recursive: true });
    fs.writeFileSync(path.join(home, 'personal', '.meta.json'), JSON.stringify({ id: 'v_personal', slug: 'personal' }));

    const prefs = await store.getPrefs();
    assert.equal(prefs.configRecovery.reason, 'empty');
    assert.equal(prefs.configRecovery.brokenFile, null, 'an empty vault list set a file aside that was never damaged');
    assert.equal(prefs.configRecovery.brokenFileName, null);
  });
});

test('the recovery notice states the reason it fired and names the file in prose', () => {
  const controller = fs.readFileSync(path.join(__dirname, '../src/app/controllers/useAppLifecycleController.js'), 'utf8');
  assert.match(controller, /recovery\.reason === 'missing' \? 'was missing'/);
  assert.match(controller, /recovery\.reason === 'empty' \? 'listed no vaults'/);
  assert.match(controller, /VispNote's settings file \$\{clause\}\./);
  assert.match(controller, /The damaged file was set aside as \$\{brokenName\}\./);
  // The set-aside line is gated on brokenFile, which the 'empty' reason never
  // has, so that reason cannot claim damage.
  assert.match(controller, /recovery\.brokenFile\s*\n\s*\? `\\n\\nThe damaged file was set aside as/);
  assert.doesNotMatch(controller, /set aside as:\\n\$\{recovery\.brokenFile\}/,
    'the notice still prints the absolute path');
});

// QE addition (Lane B / B2): the snapshot body only reaches the trash when the
// note has no file on disk yet — a new note deleted before its first flush.
// That is exactly where the two-argument noteForDisk default used to rewrite
// arc:: to act:: on the way into the trash, so the restore returned a note the
// user never wrote. This drives the real renderer snapshot through the real
// store delete + restore.
test('a never-flushed plain-vault note goes through trash and restore with arc:: intact', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const { createNovelistHelpers } = require('../src/features/writer/novelistHelpers.js');
    const { noteForDisk } = createNovelistHelpers({});
    const note = {
      id: 'n_unflushed',
      title: 'Onboarding',
      date: '2026-05-06T00:00:00.000Z',
      tags: [],
      body: 'arc:: onboarding\n\n## Arcs\n\n- first beat\n',
    };
    const snapshot = noteForDisk(note, () => '', { novelistMode: false });
    const deleted = await store.deleteNote(vault.id, note.id, snapshot, { expectedRevision: null });
    assert.ok(deleted.trashId, 'the unflushed note was not trashed from its snapshot');

    const trashText = fs.readFileSync(
      path.join(store.ROOT, vault.slug, '.trash', 'notes', `${deleted.trashId}.md`), 'utf8');
    assert.match(trashText, /arc:: onboarding/, 'the trash snapshot was migrated to act::');
    assert.match(trashText, /## Arcs/);
    assert.doesNotMatch(trashText, /act:: onboarding/);

    const restored = await store.restoreDeletedNote(vault.id, deleted.trashId);
    assert.match(restored.body, /arc:: onboarding/, 'the restored note is not what the user wrote');
    assert.match(restored.body, /## Arcs/);
    assert.doesNotMatch(restored.body, /act:: onboarding/);
  });
});
