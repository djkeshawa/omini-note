// First-run seed data — written to disk on first launch when no vaults exist.

const SEED_TAGS = [
  { name: 'welcome', hue: 200 },
  { name: 'project', hue: 168 },
  { name: 'reading', hue: 290 },
  { name: 'todo', hue: 32 },
];

const SEED_NOTES_PERSONAL = [
  {
    id: 'n1',
    title: 'Welcome to VispNote',
    date: '2026-04-19T09:12:00',
    tags: ['welcome'],
    pinned: true,
    body:
`# Welcome to VispNote

Use this vault for everyday notes: ideas, meeting notes, tasks, and reading.

## Try the basics
- Link notes with [[Project plan]]
- Add tags like #project or #reading
- Track work with checkboxes

Open [[Reading notes]] to see another linked note.`
  },
  {
    id: 'n2',
    title: 'Project plan',
    date: '2026-04-17T14:03:00',
    tags: ['project', 'todo'],
    body:
`status:: DOING

## Goal
Plan a small project from rough idea to next action.

## Next steps
- [ ] Write the first outline
- [ ] @remind 2026-06-01 10:00 Review the plan
- [ ] Link any useful [[Reading notes]]

Back to [[Welcome to VispNote]].`
  },
  {
    id: 'n3',
    title: 'Reading notes',
    date: '2026-04-12T20:15:00',
    tags: ['reading'],
    body:
`# Reading notes

Use reading notes for short takeaways, quotes, and questions.

## Template
- Source:
- Key idea:
- Question to revisit:

Related: [[Project plan]]`
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
    date: '2026-04-19T09:12:00',
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
    date: '2026-04-19T09:15:00',
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
    date: '2026-04-19T09:18:00',
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

const SEED_VAULTS = [
  { name: 'Personal', tags: SEED_TAGS, notes: SEED_NOTES_PERSONAL },
  {
    name: 'Novel',
    tags: SEED_TAGS_NOVELIST,
    notes: SEED_NOTES_NOVELIST,
    novelistMode: true,
  },
];

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
        pinned: true,
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
        pinned: true,
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
        pinned: true,
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
        pinned: true,
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
  normalizeOnboardingMode,
  onboardingModeChoices,
  buildOnboardingModeSeed,
};
