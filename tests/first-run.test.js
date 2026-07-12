const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');
const seed = require('../lib/seed.js');

test('first-run seed uses the installation timestamp, valid blocks, and an unpinned welcome', () => {
  const now = '2026-07-12T09:30:00.000Z';
  const [vault] = seed.buildFirstRunSeed({ now });
  const welcome = vault.notes[0];

  assert.equal(welcome.date, now);
  assert.equal(welcome.pinned, false);
  assert.match(welcome.body, /Write · Connect · Act\./);
  assert.doesNotMatch(welcome.body, /^\d+\.\s/m);
  assert.match(welcome.body, /^[-*]\s+\*\*Write:/m);
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
