// First-run seed data — written to disk on first launch when no vaults exist.

const SEED_TAGS = [
  { name: 'welcome', hue: 200 },
];

const SEED_NOTES_PERSONAL = [
  {
    id: 'n1',
    title: 'Welcome to VispNote',
    tags: ['welcome'],
    pinned: false,
    body:
`# Welcome to VispNote

**Write · Connect · Act.** Start without setting up a system first.

## Start here
- **Write:** create a note and put one useful thought in it.
- **Connect:** type double square brackets to link that thought to another note.
- **Act:** add one Markdown checkbox as a next action, then review it in Today.

That is enough to begin. Everything else can stay out of the way until you need it.`
  },
];

const SEED_TAGS_NOVELIST = [
  { name: 'novel-act', hue: 30 },
  { name: 'novel-chapter', hue: 220 },
  { name: 'novel-scene', hue: 190 },
];

const SEED_NOTES_NOVELIST = [
  {
    id: 'novel_act_1',
    title: 'Act 1',
    tags: ['novel-act'],
    pinned: true,
    body:
`status:: OUTLINE
order:: 100
purpose:: Establish the promise of the story.

## Chapters
- [[Chapter 1]]

Keep act notes broad: the goal, the major turn, and the unanswered question.`
  },
  {
    id: 'novel_chapter_1',
    title: 'Chapter 1',
    tags: ['novel-chapter'],
    pinned: false,
    body:
`status:: OUTLINE
order:: 110
act:: [[Act 1]]

## Scenes
- [[Scene 1]]

Use chapter notes for pacing, point of view, and what changes by the end.`
  },
  {
    id: 'novel_scene_1',
    title: 'Scene 1',
    tags: ['novel-scene'],
    pinned: false,
    body:
`status:: DRAFT
order:: 111
act:: [[Act 1]]
chapter:: [[Chapter 1]]
pov:: 
purpose:: Introduce the protagonist's ordinary world.

::: plot-points
- Opening image
- Choice or disruption
:::

Draft the scene below this line.`
  },
];

function buildFirstRunSeed(options = {}) {
  const now = options.nowIso || new Date(options.now || Date.now()).toISOString();
  return [{
    name: 'Personal',
    tags: SEED_TAGS.map(tag => ({ ...tag })),
    notes: cloneOnboardingNotes(SEED_NOTES_PERSONAL, { ...options, nowIso: now }),
  }];
}

const SEED_VAULTS = buildFirstRunSeed();

const ONBOARDING_MODES = [
  { id: 'general', title: 'General notes', vaultType: 'notes', sidebarFocus: 'notes', commands: ['Create note', 'Open Today', 'Add quick task'] },
  { id: 'daily', title: 'Daily planner', vaultType: 'notes', sidebarFocus: 'today', commands: ['Open Today', 'Add quick task', 'Add reflection'] },
  { id: 'researcher', title: 'Researcher', vaultType: 'notes', sidebarFocus: 'search', commands: ['Create source note', 'Search Zotero', 'Add reading task'] },
  { id: 'writer', title: 'Writer/novelist', vaultType: 'novelist', sidebarFocus: 'novelist', commands: ['Open novelist board', 'Create scene', 'Add reflection'] },
];

function onboardingDate(options = {}) {
  return (options.date || new Date(options.now || Date.now()).toISOString().slice(0, 10));
}

function normalizeOnboardingMode(value = '') {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return ONBOARDING_MODES.some(mode => mode.id === id) ? id : '';
}

function onboardingModeChoices() {
  return ONBOARDING_MODES.map(mode => ({
    id: mode.id,
    title: mode.title,
    vaultType: mode.vaultType,
    sidebarFocus: mode.sidebarFocus,
    commands: [...mode.commands],
  }));
}

function cloneOnboardingNotes(notes = [], options = {}) {
  const now = options.nowIso || new Date(options.now || Date.now()).toISOString();
  return notes.map(note => ({
    ...note,
    date: note.date || now,
    tags: [...(note.tags || [])],
  }));
}

function buildGeneralOnboarding(date, vaultName) {
  const welcomeTitle = `Welcome to ${vaultName || 'your notes'}`;
  return {
    tags: [
      { name: 'welcome', hue: 200 },
      { name: 'project', hue: 168 },
      { name: 'todo', hue: 32 },
    ],
    notes: [
      {
        id: 'onboarding_general_welcome',
        title: welcomeTitle,
        tags: ['welcome'],
        pinned: false,
        body: `# Welcome to ${vaultName || 'your notes'}\n\nUse this workspace for notes, tasks, links, and project context.\n\n## Start\n- [ ] Capture one idea\n- [ ] Link it to [[Project template]]\n- [ ] Review [[${date}]]\n`,
      },
      {
        id: 'onboarding_general_today',
        title: date,
        tags: ['todo'],
        body: `# ${date}\n\n## Notes\n- First daily note example.\n\n## Tasks\n- [ ] Choose one priority\n`,
      },
      {
        id: 'onboarding_general_project',
        title: 'Project template',
        tags: ['project', 'todo'],
        body: `status:: TODO\n\n## Outcome\n\n## Next actions\n- [ ] Define the next step\n\n## Links\n- [[${welcomeTitle}]]\n`,
      },
    ],
  };
}

function buildDailyOnboarding(date) {
  return {
    tags: [
      { name: 'daily', hue: 205 },
      { name: 'reflection', hue: 285 },
      { name: 'todo', hue: 32 },
    ],
    notes: [
      {
        id: 'onboarding_daily_welcome',
        title: 'Daily planner welcome',
        tags: ['daily'],
        pinned: false,
        body: `# Daily planner welcome\n\nThis vault is organized around Today, open tasks, and short reflections.\n\n## Start\n- [ ] Open [[${date}]]\n- [ ] Add one quick task\n- [ ] End the day with [[Daily reflection template]]\n`,
      },
      {
        id: 'onboarding_daily_today',
        title: date,
        tags: ['daily', 'todo'],
        body: `# ${date}\n\n## Focus\n- \n\n## Notes\n- \n\n## Tasks\n- [ ] Plan the day\n\n## Reflection\n- \n`,
      },
      {
        id: 'onboarding_daily_reflection',
        title: 'Daily reflection template',
        tags: ['daily', 'reflection'],
        body: 'type:: reflection\n\n## Wins\n- \n\n## Open loops\n- [ ] \n\n## Tomorrow\n- \n',
      },
    ],
  };
}

function buildResearcherOnboarding(date) {
  return {
    tags: [
      { name: 'research', hue: 260 },
      { name: 'source', hue: 292 },
      { name: 'reading', hue: 180 },
    ],
    notes: [
      {
        id: 'onboarding_research_welcome',
        title: 'Research workspace welcome',
        tags: ['research'],
        pinned: false,
        body: `# Research workspace welcome\n\nUse this vault for sources, reading notes, and synthesis.\n\n## Start\n- [ ] Create a source note\n- [ ] Add a reading task\n- [ ] Summarize findings in [[Research question template]]\n`,
      },
      {
        id: 'onboarding_research_today',
        title: `${date} research log`,
        tags: ['research', 'reading'],
        body: `# ${date} research log\n\n## Reading\n- \n\n## Questions\n- \n\n## Follow-up\n- [ ] \n`,
      },
      {
        id: 'onboarding_research_question',
        title: 'Research question template',
        tags: ['research', 'source'],
        body: 'type:: research\n\n## Question\n\n## Sources\n- \n\n## Claims\n- \n\n## Next reading\n- [ ] \n',
      },
    ],
  };
}

function buildWriterOnboarding(date) {
  return {
    tags: [
      { name: 'welcome', hue: 200 },
      { name: 'daily', hue: 205 },
      { name: 'novel-act', hue: 30 },
      { name: 'novel-chapter', hue: 220 },
      { name: 'novel-scene', hue: 190 },
    ],
    notes: [
      {
        id: 'onboarding_writer_welcome',
        title: 'Writer workspace welcome',
        tags: ['welcome', 'novel-scene'],
        pinned: false,
        body: `# Writer workspace welcome\n\nThis vault starts with a small story structure and a daily writing log.\n\n## Start\n- [ ] Open [[Scene 1]]\n- [ ] Track progress in [[${date} writing log]]\n- [ ] Review [[Act 1]]\n`,
      },
      {
        id: 'onboarding_writer_today',
        title: `${date} writing log`,
        tags: ['daily'],
        body: `# ${date} writing log\n\n## Session goal\n- \n\n## Draft notes\n- \n\n## Next scene action\n- [ ] \n`,
      },
      ...SEED_NOTES_NOVELIST.map(note => ({ ...note })),
    ],
  };
}

function buildOnboardingModeSeed(modeId, options = {}) {
  const id = normalizeOnboardingMode(modeId) || 'general';
  const mode = ONBOARDING_MODES.find(item => item.id === id) || ONBOARDING_MODES[0];
  const date = onboardingDate(options);
  const vaultName = String(options.vaultName || '').trim();
  const builders = {
    general: () => buildGeneralOnboarding(date, vaultName),
    daily: () => buildDailyOnboarding(date),
    researcher: () => buildResearcherOnboarding(date),
    writer: () => buildWriterOnboarding(date),
  };
  const built = builders[id]();
  return {
    id,
    title: mode.title,
    vaultType: mode.vaultType,
    novelistMode: mode.vaultType === 'novelist',
    suggestedSidebarFocus: mode.sidebarFocus,
    commands: [...mode.commands],
    layoutHints: {
      startupView: mode.sidebarFocus === 'today' ? 'today' : 'notes',
      sidebarFocus: mode.sidebarFocus,
    },
    tags: built.tags.map(tag => ({ ...tag })),
    notes: cloneOnboardingNotes(built.notes, options),
  };
}

module.exports = {
  SEED_VAULTS,
  ONBOARDING_MODES,
  buildFirstRunSeed,
  normalizeOnboardingMode,
  onboardingModeChoices,
  buildOnboardingModeSeed,
};
