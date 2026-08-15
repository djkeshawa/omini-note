const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');
const seed = require('../lib/seed.js');

// Deliberately unlike the shared store helper: that one mkdtemps the data root
// before loading the store, which is exactly the condition a fresh install does
// not have. Here the root -- and its parent -- must not exist yet.
async function withMissingDataRoot(fn) {
  const previous = process.env.VISPNOTE_HOME;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-fresh-'));
  const home = path.join(parent, 'nested', 'VispNote');
  const storePath = require.resolve('../lib/store');
  delete require.cache[storePath];
  process.env.VISPNOTE_HOME = home;
  try {
    return await fn(require('../lib/store'), home);
  } finally {
    delete require.cache[storePath];
    if (previous === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previous;
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

test('the first run seeds into a data root that does not exist yet', async () => {
  await withMissingDataRoot(async (store, home) => {
    assert.equal(fs.existsSync(home), false, 'the data root must be missing before the first load');

    const cfg = await store.loadConfig();

    assert.ok(cfg.vaults.length > 0, 'the seed creates at least one vault');
    assert.equal(cfg.activeVaultId, cfg.vaults[0].id);
    for (const vault of cfg.vaults) {
      assert.ok(fs.existsSync(path.join(home, vault.slug, '.meta.json')), `${vault.slug} was written to disk`);
    }
    assert.ok(fs.existsSync(path.join(home, '.config.json')), 'the config was written to the new root');

    const loaded = await store.loadVault(cfg.vaults[0].id);
    assert.ok(loaded.notes.length > 0, 'the seeded vault has its welcome note on disk');
  });
});

test('first-run seed uses the installation timestamp, valid blocks, and an unpinned welcome', () => {
  const now = '2026-07-12T09:30:00.000Z';
  const model = loadRendererModule('src/features/onboarding/onboardingModel.js');
  const [vault] = seed.buildFirstRunSeed({ now });
  const welcome = vault.notes[0];

  assert.equal(welcome.date, now);
  assert.equal(welcome.pinned, false);
  assert.match(welcome.body, /Write · Connect · Act\./);
  assert.doesNotMatch(welcome.body, /^\d+\.\s/m);
  // The copy teaches links and checkboxes by naming them, never by containing
  // one: either would make the classifier below read the seed as the reader's
  // own work on first launch.
  assert.match(welcome.body, /\[\[/);
  assert.match(welcome.body, /\[ \]/);
  assert.doesNotMatch(welcome.body, /^\s*[-*]\s+\[[ xX]\]/m);
  assert.doesNotMatch(welcome.body, /\[\[[^\]\n]+\]\]/);
  assert.doesNotMatch(welcome.body, /Cmd/);
  assert.ok(welcome.body.split('\n').length <= 15, 'the welcome note stays short enough to read');
  assert.equal(model.isOnboardingNote({ id: 'n1', title: welcome.title, body: welcome.body }), true);
});

test('editing the seeded welcome hands it back to the reader and to Today', () => {
  const model = loadRendererModule('src/features/onboarding/onboardingModel.js');
  const [vault] = seed.buildFirstRunSeed({ now: '2026-07-12T09:30:00.000Z' });
  const seeded = vault.notes[0];
  const shipped = { id: 'n1', title: seeded.title, body: seeded.body };
  const edited = { ...shipped, body: `${seeded.body}\n- [ ] ship something` };

  // Guard: a copy edit that puts a real checkbox or link in the seed would make
  // the shipped note look user-authored on first launch, and this fails loudly.
  assert.equal(model.isOnboardingNote(shipped), true);
  assert.equal(model.isOnboardingNote(edited), false);

  const result = model.excludeOnboardingFromToday({
    notes: [edited],
    tasks: [{ noteId: 'n1' }],
  });
  assert.deepEqual(result.notes.map(note => note.id), ['n1']);
  assert.deepEqual(result.tasks, [{ noteId: 'n1' }]);
});

test('optional onboarding modes leave welcome notes unpinned and timestamp generated notes', () => {
  const now = '2026-07-12T09:30:00.000Z';
  for (const mode of seed.onboardingModeChoices()) {
    const built = seed.buildOnboardingModeSeed(mode.id, { now, vaultName: 'Test vault' });
    const welcome = built.notes.find(note => /welcome/i.test(note.title));
    assert.equal(welcome?.pinned, false, mode.id);
    assert.ok(built.notes.every(note => note.date === now), mode.id);
  }
});

test('contextual first-run tips progress without a wizard and remain dismissible', () => {
  const model = loadRendererModule('src/features/onboarding/onboardingModel.js');
  const welcome = {
    id: 'n1',
    title: 'Welcome to VispNote',
    body: '# Welcome\n\nWrite · Connect · Act.',
  };
  const draft = { id: 'user-note', title: 'Untitled', body: '' };
  const legacyWelcome = {
    id: 'n1',
    title: 'Welcome to VispNote',
    body: 'VispNote helps you **write, connect, and act** without setting up a system first.',
  };

  assert.equal(model.isOnboardingNote(legacyWelcome), true);
  assert.equal(model.contextualOnboardingTip({ notes: [welcome], selectedNote: welcome })?.id, 'new-note');
  assert.equal(model.contextualOnboardingTip({ notes: [welcome, draft], selectedNote: draft })?.id, 'linking');
  assert.equal(model.contextualOnboardingTip({
    notes: [welcome, { ...draft, body: 'See [[Welcome to VispNote]]' }],
    selectedNote: { ...draft, body: 'See [[Welcome to VispNote]]' },
  })?.id, 'checkboxes');
  assert.equal(model.dismissOnboardingTip('new-note', 'linking'), 'new-note,linking');
  assert.equal(model.contextualOnboardingTip({
    notes: [welcome, draft],
    selectedNote: draft,
    dismissed: 'new-note,linking,checkboxes',
  }), null);
});

test('Today sources exclude generated onboarding notes and their actions', () => {
  const model = loadRendererModule('src/features/onboarding/onboardingModel.js');
  const welcome = { id: 'onboarding_general_welcome', title: 'Welcome', body: '- [ ] Seed task' };
  const useful = { id: 'useful', title: 'Real note', body: '- [ ] Real task' };
  const result = model.excludeOnboardingFromToday({
    notes: [welcome, useful],
    tasks: [{ noteId: welcome.id }, { noteId: useful.id }],
    reminders: [{ noteId: welcome.id }, { noteId: useful.id }],
    links: [{ source: welcome.id, target: useful.id }, { source: useful.id, target: 'other' }],
  });

  assert.deepEqual(result.notes.map(note => note.id), ['useful']);
  assert.deepEqual(result.tasks.map(item => item.noteId), ['useful']);
  assert.deepEqual(result.reminders.map(item => item.noteId), ['useful']);
  assert.deepEqual(result.links, [{ source: 'useful', target: 'other' }]);
});

test('launch recovery and feedback expose safe user-controlled actions', () => {
  const launch = fs.readFileSync(path.join(__dirname, '../src/app/shell/LaunchScreen.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const feedback = fs.readFileSync(path.join(__dirname, '../src/settings/sections/AboutSections.jsx'), 'utf8');

  assert.match(launch, /Your notes were not changed/);
  assert.match(launch, />Retry</);
  assert.match(launch, />Open data folder</);
  assert.match(launch, /<details/);
  assert.match(launch, /Technical details/);
  assert.doesNotMatch(main, /showErrorBox\('VispNote failed to initialize'/);
  assert.match(main, /shell\.openPath\(store\.ROOT\)/);
  assert.match(preload, /openDataFolder: \(\) => ipcRenderer\.invoke\('mn:openDataFolder'\)/);
  assert.match(feedback, /issues\/new/);
  assert.match(feedback, /onClick=\{openFeedback\}>Send feedback/);
  assert.doesNotMatch(feedback, /body=|attachment=/i);
});
