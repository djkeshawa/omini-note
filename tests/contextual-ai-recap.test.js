const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// The Today recap and the digest sections that feed it: which notes count as
// "today", which open loops are stale, what resurfaces and why, and what the
// recap says when the AI returns nothing useful. contextual-ai-helpers.test.js
// pins the edit-safety guard; this pins everything that builds the recap.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-05T12:00:00.000Z');
const TODAY = helpers.todayIsoDate(NOW);
const ago = days => new Date(NOW.getTime() - days * DAY).toISOString();

const note = (id, over = {}) => ({
  id,
  title: over.title ?? `Note ${id}`,
  body: over.body ?? '',
  tags: over.tags ?? [],
  date: over.date ?? ago(0),
  modifiedAt: over.modifiedAt ?? over.date ?? ago(0),
  ...over,
});

const todo = (noteId, label, over = {}) => ({
  type: 'todo', noteId, label, text: label, checked: false, noteTitle: `Note ${noteId}`, ...over,
});

test('provider metadata reads a config, a status or a bare provider name', () => {
  assert.deepEqual(helpers.contextualAiProviderMeta({}), {
    provider: 'ollama',
    providerLabel: 'Ollama',
    model: '',
    providerModelLabel: 'Ollama',
    hosted: false,
    piiReduction: true,
  }, 'the local provider is the default and is never treated as hosted');

  const nested = helpers.contextualAiProviderMeta({ config: { provider: 'OpenAI', chatModel: 'gpt-x', piiReduction: false } });
  assert.equal(nested.provider, 'openai', 'the provider name is normalised');
  assert.equal(nested.providerLabel, 'OpenAI');
  assert.equal(nested.providerModelLabel, 'OpenAI - gpt-x');
  assert.equal(nested.hosted, true, 'anything other than Ollama leaves the machine');
  assert.equal(nested.piiReduction, false);

  assert.equal(helpers.contextualAiProviderMeta({ provider: 'openrouter', model: 'mix' }).providerModelLabel,
    'OpenRouter - mix', 'a flat status object works the same as a config');
  assert.equal(helpers.contextualAiProviderMeta({ provider: 'mystery' }).providerLabel, 'AI provider',
    'an unknown provider still gets a label to show');
  assert.equal(helpers.contextualAiProviderMeta({ provider: '   ' }).provider, 'ollama');
  assert.equal(helpers.contextualAiProviderMeta({ config: 'not an object', provider: 'anthropic' }).provider, 'anthropic');
});

test('a note becomes a citable source, or is refused for having no id', () => {
  assert.equal(helpers.contextualAiSourceFromNote(null), null);
  assert.equal(helpers.contextualAiSourceFromNote('a string'), null);
  assert.equal(helpers.contextualAiSourceFromNote({ title: 'No id' }), null,
    'a source with no id could not be linked back to, so it is not a source');
  assert.equal(helpers.contextualAiSourceFromNote({ title: 'No id' }, { requireId: false }).title, 'No id',
    'a caller that only wants the text can waive the id');

  const source = helpers.contextualAiSourceFromNote({ id: 'n1', title: 'Plan', body: 'first line\nsecond line', modifiedAt: ago(1) });
  assert.equal(source.type, 'note');
  assert.equal(source.noteId, 'n1');
  assert.match(source.snippet, /first line/);

  assert.equal(helpers.contextualAiSourceFromNote({ noteId: 'n2', noteTitle: 'From an action' }).id, 'n2',
    'an action item names the note differently but is still a source');
  assert.equal(helpers.contextualAiSourceFromNote({ id: 'n3' }).title, 'Untitled');
  assert.equal(helpers.contextualAiSourceFromNote({ id: 'n4', date: ago(3) }).modifiedAt, ago(3),
    'a note never modified is dated by its creation');
  assert.equal(helpers.contextualAiSourceFromNote({ id: 'n5', snippet: 'explicit' }).snippet, 'explicit');
  assert.equal(helpers.contextualAiSourceFromNote({ id: 'n6', __searchSnippet: 'matched text' }).snippet, 'matched text');
  assert.equal(helpers.contextualAiSourceFromNote({ id: 'n7', body: 'x'.repeat(400) }, { snippetLimit: 10 }).snippet.length, 13,
    'a snippet is cut to the limit and marked as cut');
  assert.equal(helpers.contextualAiSourceFromNote({ id: 'n8', body: 'x'.repeat(4000) }, { snippetLimit: 9999 }).snippet.length, 1003,
    'the snippet limit itself is capped');
});

test('a list of sources is deduplicated and capped', () => {
  const notes = [
    note('n1', { title: 'One' }),
    note('n1', { title: 'One again' }),
    { title: 'No id at all' },
    note('n2', { title: 'Two' }),
  ];
  const sources = helpers.contextualAiSourcesFromNotes(notes);
  assert.deepEqual(sources.map(s => s.id), ['n1', 'n2'], 'the same note twice is one source, and an id-less note is dropped');
  assert.equal(helpers.contextualAiSourcesFromNotes(notes, { limit: 1 }).length, 1);
  assert.equal(helpers.contextualAiSourcesFromNotes(
    Array.from({ length: 60 }, (_, i) => note(`n${i}`)), { limit: 999 }).length, 40,
    'the limit is capped at 40 however many are asked for');
  assert.deepEqual(helpers.contextualAiSourcesFromNotes(null), []);
  // Without ids, dedupe falls back to the title.
  const untitled = helpers.contextualAiSourcesFromNotes(
    [{ title: 'Same' }, { title: 'same' }, { title: 'Other' }], { requireId: false });
  assert.deepEqual(untitled.map(s => s.title), ['Same', 'Other']);
});

test('a result section is normalised whatever it is called', () => {
  assert.deepEqual(helpers.contextualAiNormalizeSections([{ content: 'a fact' }]),
    [{ kind: 'fact', title: 'Facts', content: 'a fact', sourceIds: [] }],
    'an unlabelled section is a fact');
  assert.equal(helpers.contextualAiNormalizeSections([{ kind: 'suggestion', text: 'try this' }])[0].title, 'Suggestions');
  assert.equal(helpers.contextualAiNormalizeSections([{ kind: 'preview', content: 'x' }])[0].title, 'Preview');
  assert.equal(helpers.contextualAiNormalizeSections([{ kind: 'invented', content: 'x' }])[0].kind, 'fact',
    'an unknown kind is a fact rather than a section the UI cannot render');
  assert.deepEqual(helpers.contextualAiNormalizeSections([{ content: 'x', sourceIds: ['a', '', 'b'] }])[0].sourceIds, ['a', 'b']);
  assert.deepEqual(helpers.contextualAiNormalizeSections([{ content: 'x', sourceIds: 'a' }])[0].sourceIds, []);
  assert.deepEqual(helpers.contextualAiNormalizeSections([{ title: '', content: '' }]),
    [{ kind: 'fact', title: 'Facts', content: '', sourceIds: [] }],
    'an empty section keeps its default heading, so the reader sees the AI had nothing to say');

  // The grouped shape is the other way a caller may supply sections.
  const grouped = helpers.contextualAiNormalizeSections({
    facts: [{ content: 'f' }],
    suggestions: [{ content: 's' }],
    previews: [{ content: 'p' }],
  });
  assert.deepEqual(grouped.map(s => s.kind), ['fact', 'suggestion', 'preview']);
  assert.deepEqual(helpers.contextualAiNormalizeSections({}), []);
});

test('a contextual result always carries provider provenance and a timestamp', () => {
  const result = helpers.contextualAiResult({
    status: { provider: 'anthropic', chatModel: 'claude' },
    title: 'A result',
    sources: [note('n1')],
    sections: [{ content: 'body' }],
    createdAt: '2026-08-05T00:00:00.000Z',
  });
  assert.equal(result.type, 'contextual-ai-result');
  assert.equal(result.outputKind, 'contextual', 'the default output kind is the generic one');
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.hosted, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sections.length, 1);
  assert.equal(result.createdAt, '2026-08-05T00:00:00.000Z');

  const bare = helpers.contextualAiResult({});
  assert.equal(bare.title, 'Contextual AI result');
  assert.deepEqual(bare.sources, []);
  assert.deepEqual(bare.sections, []);
  assert.ok(Date.parse(bare.createdAt), 'a result with no timestamp is stamped now');
  assert.equal(helpers.contextualAiResult({ sources: 'not a list' }).sources.length, 0);
  assert.equal(helpers.contextualAiResult({ kind: 'today-recap' }).outputKind, 'today-recap');
});

test('stale todos are the open ones in notes nobody has touched', () => {
  const notes = [
    note('fresh', { modifiedAt: ago(1) }),
    note('old', { modifiedAt: ago(30) }),
    note('older', { modifiedAt: ago(60) }),
  ];
  const tasks = [
    todo('fresh', 'Recent work'),
    todo('old', 'Forgotten thing'),
    todo('older', 'Really forgotten'),
    todo('old', 'Already done', { checked: true }),
    { type: 'reminder', noteId: 'old', label: 'Not a todo' },
    todo('missing-note', 'Orphaned'),
  ];
  const stale = helpers.digestStaleTodoItems(tasks, notes, { now: NOW });
  assert.deepEqual(stale.map(s => s.label), ['Really forgotten', 'Forgotten thing'],
    'oldest first, and only unchecked todos whose notes are past the cutoff');
  assert.ok(stale[0].staleSince, 'each stale todo says when its note was last touched');
  assert.equal(helpers.digestStaleTodoItems(tasks, notes, { now: NOW, limit: 1 }).length, 1);
  assert.equal(helpers.digestStaleTodoItems(tasks, notes, { now: NOW, staleDays: 90 }).length, 0,
    'a longer staleness window means nothing is stale yet');
  assert.deepEqual(helpers.digestStaleTodoItems(null, null, { now: NOW }), []);
});

test('unlinked recent notes exclude daily notes and anything already wired up', () => {
  const notes = [
    note('a', { title: 'Loose idea', modifiedAt: ago(1) }),
    note('b', { title: 'Linked idea', modifiedAt: ago(1) }),
    note('c', { title: 'Older idea', modifiedAt: ago(30) }),
    note('d', { title: TODAY, modifiedAt: ago(1) }),
    note('e', { title: 'Newest', modifiedAt: ago(0) }),
    { title: 'No id', modifiedAt: ago(1) },
  ];
  const links = [{ source: 'b', target: 'z' }];
  const found = helpers.digestUnlinkedRecentNotes(notes, links, { now: NOW });
  assert.deepEqual(found.map(n => n.id), ['e', 'a'],
    'most recently edited first; linked, old, date-titled and id-less notes all drop out');
  assert.equal(found[0].title, 'Newest');
  assert.equal(helpers.digestUnlinkedRecentNotes(notes, links, { now: NOW, limit: 1 }).length, 1);
  assert.equal(helpers.digestUnlinkedRecentNotes(notes, links, { now: NOW, days: 60 }).length, 3,
    'a wider window reaches further back');
  assert.deepEqual(helpers.digestUnlinkedRecentNotes(null, null, { now: NOW }), []);
});

test('resurfaced notes explain themselves and are ordered by why they matter', () => {
  const notes = [
    note('pin', { title: 'Pinned one', modifiedAt: ago(10), pinned: true }),
    note('loop', { title: 'Has a loop', modifiedAt: ago(10), body: '- [ ] unfinished' }),
    note('conn', { title: 'Connected', modifiedAt: ago(10) }),
    note('plain', { title: 'Just old', modifiedAt: ago(10) }),
    note('toonew', { title: 'Yesterday', modifiedAt: ago(1) }),
    note('tooold', { title: 'Ancient', modifiedAt: ago(200) }),
    note('daily', { title: TODAY, modifiedAt: ago(10) }),
    note('skipme', { title: 'Excluded', modifiedAt: ago(10) }),
  ];
  const links = [{ source: 'conn', target: 'other' }, { target: 'conn' }, { source: 'conn' }];
  const found = helpers.digestResurfacedNotes(notes, links, { now: NOW, excludeIds: ['skipme'] });
  assert.deepEqual(found.map(n => n.id), ['pin', 'loop', 'conn', 'plain'],
    'pinned outranks an open loop, which outranks connections, which outranks mere age');
  assert.deepEqual(found.map(n => n.reason), ['Pinned', 'Open loop', 'Connected context', 'Recently changed'],
    'every resurfaced note says why it came back');
  assert.ok(!found.some(n => 'score' in n), 'the ranking score is internal and is not shown');
  assert.equal(helpers.digestResurfacedNotes(notes, links, { now: NOW, limit: 2 }).length, 2);
  assert.deepEqual(helpers.digestResurfacedNotes(null, null, { now: NOW }), []);
  assert.equal(helpers.digestResurfacedNotes(notes, links, { now: NOW, minDays: 100, maxDays: 300 })
    .map(n => n.id).includes('tooold'), true, 'a wider window reaches the ancient note');
});

test('the recap context gathers today from three different date signals', () => {
  const notes = [
    note('byTitle', { title: TODAY, modifiedAt: ago(40) }),
    note('byCreated', { title: 'Created today', date: NOW.toISOString(), modifiedAt: ago(40) }),
    note('byModified', { title: 'Edited today', date: ago(40), modifiedAt: NOW.toISOString() }),
    note('neither', { title: 'Old', date: ago(40), modifiedAt: ago(40) }),
  ];
  const context = helpers.contextualAiBuildTodayRecapContext({ notes, now: NOW });
  assert.equal(context.today, TODAY);
  assert.deepEqual(new Set(context.notes.map(n => n.id)), new Set(['byTitle', 'byCreated', 'byModified']),
    'a note counts as today if its title, its creation or its last edit says so');
  assert.ok(context.sources.length, 'the notes of the day are the sources of the recap');

  const empty = helpers.contextualAiBuildTodayRecapContext({ now: NOW });
  assert.deepEqual(empty.notes, []);
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(empty.tasks, []);
  assert.deepEqual(empty.staleTodos, []);
  assert.equal(helpers.contextualAiBuildTodayRecapContext({ notes, now: NOW, limit: 1 }).notes.length, 1);
  assert.equal(helpers.contextualAiBuildTodayRecapContext({ notes, now: NOW, limit: 999 }).notes.length, 3,
    'the limit is capped rather than trusted');
});

test('the recap prompt says "none" rather than leaving a heading empty', () => {
  const empty = helpers.contextualAiBuildTodayRecapPrompt({ today: TODAY });
  assert.match(empty, /Source notes:\n- No source notes today\./);
  assert.equal((empty.match(/^- None\.$/gm) || []).length, 5,
    'tasks, reminders, agenda, stale todos and unlinked notes each say None rather than nothing');
  assert.match(empty, /Recently edited notes with no links in or out:\n- None\./);

  const filled = helpers.contextualAiBuildTodayRecapPrompt({
    today: TODAY,
    sources: [{ title: 'Plan', snippet: 'the snippet' }, { title: 'Bare' }],
    tasks: [todo('n1', 'Do the thing')],
    reminders: [{ label: 'Call back', noteId: 'n2' }],
    agendaItems: [{ text: 'Standup', noteTitle: 'Work' }],
    staleTodos: [todo('n3', 'Old thing')],
    unlinkedNotes: [{ title: 'Loose idea' }],
  });
  assert.match(filled, /- Plan: the snippet/);
  assert.match(filled, /- Bare$/m, 'a source with no snippet is listed without a trailing colon');
  assert.match(filled, /- Do the thing \(Note n1\)/);
  assert.match(filled, /- Call back \(n2\)/, 'an item with no note title falls back to the note id');
  assert.match(filled, /- Standup \(Work\)/);
  assert.match(filled, /- Loose idea/);
  assert.ok(!filled.includes('- None.'));
  assert.ok(helpers.contextualAiBuildTodayRecapPrompt().includes('- None.'), 'a prompt with no context at all still builds');
});

test('the recap reads the AI headings, and falls back section by section', () => {
  const context = {
    today: TODAY,
    sources: [{ id: 'n1', title: 'Plan', snippet: 'the snippet' }],
    tasks: [todo('n1', 'Do the thing')],
    reminders: [],
    agendaItems: [],
  };
  const aiText = [
    '## Changed today',
    'You wrote the plan.',
    '## Open loops',
    'One thing is open.',
    '## Tomorrow planning suggestions',
    'Start with the plan.',
  ].join('\n');
  const result = helpers.contextualAiBuildTodayRecapResult({ aiText, context });
  assert.equal(result.outputKind, 'today-recap');
  assert.equal(result.title, `Today AI recap - ${TODAY}`);
  assert.deepEqual(result.sections.map(s => s.title), ['Changed today', 'Open loops', 'Tomorrow planning suggestions']);
  assert.deepEqual(result.sections.map(s => s.kind), ['fact', 'fact', 'suggestion']);
  assert.equal(result.sections[0].content, 'You wrote the plan.');
  assert.deepEqual(result.sections[0].sourceIds, ['n1']);

  // No AI text at all: every section falls back to what the vault already knows.
  const fallback = helpers.contextualAiBuildTodayRecapResult({ context });
  assert.equal(fallback.sections[0].content, 'Plan: the snippet');
  assert.equal(fallback.sections[1].content, '- Do the thing');
  assert.equal(fallback.sections[2].content, '- Plan Do the thing');

  // Nothing at all: the recap still renders, and says so.
  const nothing = helpers.contextualAiBuildTodayRecapResult({});
  assert.equal(nothing.sections[0].content, 'No source notes were captured today.');
  assert.equal(nothing.sections[1].content, 'No open loops found for today.');
  assert.equal(nothing.sections[2].content, '- Review today and choose one next action.');

  // Prose with no headings is used as the "changed" section rather than lost.
  const prose = helpers.contextualAiBuildTodayRecapResult({ aiText: 'Just a paragraph.', context });
  assert.equal(prose.sections[0].content, 'Just a paragraph.');
  assert.equal(prose.sections[1].content, '- Do the thing', 'the other sections still fall back');
});

test('the end-day recap writes every heading, filled or not', () => {
  const empty = helpers.rollupBuildEndDayRecap({ now: NOW });
  assert.match(empty, new RegExp(`^## End-day recap - ${TODAY}`));
  assert.match(empty, /### Highlights\n- No notes captured today\./);
  assert.match(empty, /### Open loops\n- No open loops captured\./);
  assert.match(empty, /### Tomorrow candidates\n- No tomorrow candidates yet\./);

  const filled = helpers.rollupBuildEndDayRecap({
    now: NOW,
    notes: [note('n1', { title: 'Today note', date: NOW.toISOString(), body: 'A decision was made to ship.' })],
    tasks: [
      todo('n1', 'Open thing'),
      todo('n1', 'Done thing', { checked: true }),
      { type: 'reminder', noteId: 'n1', label: 'Not a task', isReminderOnly: true },
    ],
  });
  assert.match(filled, /### Highlights\n- \[\[Today note\]\]/);
  assert.match(filled, /### Decisions\n- \[\[Today note\]\]: A decision was made to ship\./);
  assert.match(filled, /- \[ \] Open thing \(Note n1\)/);
  assert.ok(!filled.includes('Done thing'), 'a finished task is not an open loop');
  assert.ok(!filled.includes('Not a task'), 'a reminder is not an open loop either');

  const appended = helpers.rollupAppendEndDayRecap('Existing body.', { now: NOW });
  assert.match(appended, /^Existing body\./);
  assert.match(appended, /## End-day recap/);
});

test('a reminder that has not come due yet is a tomorrow candidate', () => {
  // The section asks for reminders it can still act on, so it has to look
  // forward. Asking only for today's reminders left it permanently empty.
  const tomorrow = helpers.todayIsoDate(new Date(NOW.getTime() + DAY));
  const recap = helpers.rollupBuildEndDayRecap({
    now: NOW,
    notes: [note('n1', { title: 'Today note', date: NOW.toISOString() })],
    reminders: [
      { noteId: 'n1', noteTitle: 'Today note', label: 'Call the plumber',
        remindAt: { date: tomorrow, time: '', at: new Date(`${tomorrow}T09:00:00`) } },
      { noteId: 'n1', noteTitle: 'Today note', label: 'Already overdue',
        remindAt: { date: helpers.todayIsoDate(new Date(NOW.getTime() - DAY)), time: '', at: new Date(NOW.getTime() - DAY) } },
    ],
  });
  const candidates = recap.split('### Tomorrow candidates')[1];
  assert.match(candidates, /- \[ \] Call the plumber \(Today note\)/,
    'a reminder due tomorrow belongs in tomorrow candidates');
  assert.ok(!candidates.includes('Already overdue'),
    'an overdue reminder is a today problem, not a tomorrow candidate');
  assert.ok(!candidates.includes('No tomorrow candidates yet.'));
});
