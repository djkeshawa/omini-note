// Browser fallback seed data. Keep this aligned with lib/seed.js.

import { shortcutLabel } from '../platform/shortcutFormat.js';

// shortcutLabel defaults to sniffing navigator, which is exactly right here:
// this seed only ever runs in a browser. lib/seed.js passes process.platform.
const seedShortcut = (id) => shortcutLabel(id, undefined, { compact: true });

const SEED_TAGS = [
  { name: 'welcome', hue: 200 },
];
const SEED_CREATED_AT = new Date().toISOString();

const SEED_NOTES = [
  {
    id: 'n1',
    title: 'Welcome to VispNote',
    date: SEED_CREATED_AT,
    tags: ['welcome'],
    pinned: false,
    body:
`# Welcome to VispNote

**Write · Connect · Act.** Nothing to set up first.

- New note — ${seedShortcut('newNote')}. The title is selected, so type over it.
- Connect — type \`[[\` in a block to point at another note.
- Act — start a line with \`- \` then \`[ ]\` to make a checkbox. Open ones show up in Today.
- Capture without leaving what you are doing — ${seedShortcut('quickCapture')}.
- Find any note or action — ${seedShortcut('commandPalette')}.

This note is a Markdown file on disk. Edit it, or delete it — nothing depends on it.`
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
    date: SEED_CREATED_AT,
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
    date: SEED_CREATED_AT,
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
    date: SEED_CREATED_AT,
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
];

// Build the link graph by parsing [[wiki-links]]. Extracted targets are
// cached per note object: the app's per-note normalization keeps unchanged
// note identities stable across keystrokes, so only the edited note is
// re-parsed instead of re-scanning every body in the vault.
const mnNoteLinkTargetsCache = new WeakMap();

function mnLinkTargetsForNote(note) {
  const hit = mnNoteLinkTargetsCache.get(note);
  if (hit) return hit;
  const targets = [...String(note.body || '').matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].split('|')[0].split('#')[0].trim().toLowerCase());
  mnNoteLinkTargetsCache.set(note, targets);
  return targets;
}

function buildLinks(notes) {
  const byTitle = new Map(notes.map(n => [n.title.toLowerCase(), n.id]));
  const links = [];
  for (const n of notes) {
    for (const target of mnLinkTargetsForNote(n)) {
      const targetId = byTitle.get(target);
      if (targetId && targetId !== n.id) {
        links.push({ source: n.id, target: targetId });
      }
    }
  }
  return links;
}

export { SEED_NOTES, SEED_NOTES_NOVELIST, SEED_TAGS, SEED_TAGS_NOVELIST, SEED_VAULTS, buildLinks };
