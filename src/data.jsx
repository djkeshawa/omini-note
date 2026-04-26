// Seed data for OminiNote prototype — realistic notes, tags, todos.

const SEED_TAGS = [
  { name: 'research',   hue: 232 },
  { name: 'product',    hue: 168 },
  { name: 'journal',    hue: 32  },
  { name: 'reading',    hue: 290 },
  { name: 'ideas',      hue: 12  },
  { name: 'errands',    hue: 200 },
];

const SEED_NOTES = [
  {
    id: 'n1',
    title: 'Weekly review — Apr 19',
    date: '2026-04-19T09:12:00',
    tags: ['journal', 'product'],
    pinned: true,
    body:
`type:: weekly-review
status:: published
mood:: focused

Three things that mattered this week, three that didn't.

## Shipped
- DONE Final pass on the [[Graph overlay spec]]
- DONE Interviewed 4 users about tag habits
- DOING @remind 2026-04-22 10:00 Write up the tag-vs-folder findings

## Stuck
The [[Backlinks panel]] still feels noisy below 12 notes. Worth revisiting after we have #research from next week.

## Reading
- Finished [[How to take smart notes]] — see pullquotes under #reading
- LATER Started [[Thinking in systems]]
- WAIT Pending: peer review notes from Sasha

> Notes are a conversation with your future self.

{{embed [[Graph overlay spec]]}}`
  },
  {
    id: 'n2',
    title: 'Graph overlay spec',
    date: '2026-04-17T14:03:00',
    tags: ['product', 'research'],
    body:
`## Goal
Let people see the shape of their thinking without leaving the editor.

## Constraints
- Must open in < 80ms from any note
- Respect the current tag filter
- Nodes sized by backlinks, not by length

## Open questions
- [ ] Do we animate into the focused node, or cut?
- [ ] What's the empty state when a note has 0 links?

Related: [[Backlinks panel]], [[Weekly review — Apr 19]]`
  },
  {
    id: 'n3',
    title: 'Backlinks panel',
    date: '2026-04-15T10:48:00',
    tags: ['product'],
    body:
`Keep it flat. One line per reference, with surrounding context.

## Sections
- Linked mentions
- Unlinked mentions (text match)

Tomorrow: [[Graph overlay spec]] integration.`
  },
  {
    id: 'n4',
    title: 'How to take smart notes',
    date: '2026-04-12T20:15:00',
    tags: ['reading'],
    body:
`Sönke Ahrens. Zettelkasten in plain language.

## Pullquotes
> Writing is not what you do after thinking. Writing is thinking.
> A note is only useful if you can find it again.

## My take
The hard part isn't capture — it's the weekly reshuffle where loose notes find their home.`
  },
  {
    id: 'n5',
    title: 'Ideas — onboarding reshape',
    date: '2026-04-11T16:30:00',
    tags: ['ideas', 'product'],
    body:
`- What if we showed the graph on day 2, not day 1?
- A "pick 3 tags" starter flow instead of asking people to configure folders
- [ ] @remind 2026-04-25 Draft three variants

See [[Graph overlay spec]] for the rendering piece.`
  },
  {
    id: 'n6',
    title: 'Groceries + errands',
    date: '2026-04-20T08:02:00',
    tags: ['errands'],
    body:
`- [ ] Dry cleaning by Thursday
- [ ] Return library books — [[How to take smart notes]]
- [x] Coffee beans
- [ ] @remind 2026-04-22 17:00 Pick up prescription`
  },
  {
    id: 'n7',
    title: 'Morning pages',
    date: '2026-04-20T07:10:00',
    tags: ['journal'],
    body:
`A quiet morning. The rain sounds like a good excuse to not check slack.

What I want to think about today: whether the [[Graph overlay spec]] is ready enough to ship behind a flag.`
  },
  {
    id: 'n8',
    title: 'Thinking in systems',
    date: '2026-04-09T19:40:00',
    tags: ['reading', 'ideas'],
    body:
`Meadows. Still in chapter two.

Stocks, flows, feedback loops. The tag graph in #product is itself a system — changes in one tag ripple.`
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

window.MN_DATA = { SEED_TAGS, SEED_NOTES, buildLinks };
