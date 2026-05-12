// Browser fallback seed data. Keep this aligned with lib/seed.js.

const SEED_TAGS = [
  { name: 'welcome', hue: 200 },
  { name: 'project', hue: 168 },
  { name: 'reading', hue: 290 },
  { name: 'todo', hue: 32 },
];

const SEED_NOTES = [
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
  {
    id: 'v_personal',
    name: 'Personal',
    slug: 'personal',
    path: '~/VispNote/personal',
    notes: SEED_NOTES,
    tags: SEED_TAGS,
    novelistMode: false,
  },
  {
    id: 'v_novel',
    name: 'Novel',
    slug: 'novel',
    path: '~/VispNote/novel',
    notes: SEED_NOTES_NOVELIST,
    tags: SEED_TAGS_NOVELIST,
    novelistMode: true,
  },
];

// Build the link graph by parsing [[wiki-links]]
function buildLinks(notes) {
  const byTitle = new Map(notes.map(n => [n.title.toLowerCase(), n.id]));
  const links = [];
  for (const n of notes) {
    const matches = [...n.body.matchAll(/\[\[([^\]]+)\]\]/g)];
    for (const m of matches) {
      const targetId = byTitle.get(m[1].toLowerCase());
      if (targetId && targetId !== n.id) {
        links.push({ source: n.id, target: targetId });
      }
    }
  }
  return links;
}

window.MN_DATA = { SEED_TAGS, SEED_NOTES, SEED_VAULTS, buildLinks };
