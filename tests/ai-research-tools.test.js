const test = require('node:test');
const assert = require('node:assert/strict');

const { createResearchDomain } = require('../lib/ai/research.js');

// The read-only tools the note-research planner is allowed to call, the
// traversal that decides which notes are even candidates, and the memory
// bridge. ai-research-helpers.test.js pins the context budget; this pins what
// the planner can see and what it is refused.

function makeDomain(overrides = {}) {
  return createResearchDomain({
    CONFIG: { enabled: true, embedModel: 'nomic', ragTopK: 5 },
    MAX_CONTEXT_CHARS: 6000,
    MAX_NOTE_BODY_CHARS: 2000,
    MAX_RAG_PROMPT_CHARS: 8000,
    NOTE_RESEARCH_ARG_CHARS: 120,
    NOTE_RESEARCH_MAX_NOTES: 10,
    NOTE_RESEARCH_MAX_ROUNDS: 3,
    NOTE_RESEARCH_MAX_SUMMARIES: 2,
    NOTE_RESEARCH_MAX_TOOL_CALLS: 8,
    NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND: 3,
    NOTE_RESEARCH_TOOL_RESULT_CHARS: 1000,
    QUERY_CACHE_MS: 1000,
    SELECTED_NOTE_LIMIT: 12,
    TRAVERSAL_MAX_NOTES: 20,
    TRAVERSAL_SEED_LIMIT: 5,
    TRAVERSAL_SHARED_TAG_LIMIT: 5,
    WHOLE_VAULT_MAX_CHARS: 20000,
    WHOLE_VAULT_MAX_NOTES: 50,
    idx: {},
    retrievalCache: new Map(),
    vaultStore: {},
    isUsefulResearchSummary: summary => String(summary || '').trim().length > 3,
    providerChat: async () => ({ text: 'a subset summary' }),
    ...overrides,
  });
}

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? '',
  tags: over.tags ?? [], modifiedAt: over.modifiedAt ?? '2026-01-01T00:00:00.000Z', ...over,
});

const VAULT = [
  note('hub', { title: 'Project Hub', body: 'Links to [[Alpha Spec]] and [[Beta Plan]].', tags: ['work'] }),
  note('alpha', { title: 'Alpha Spec', body: 'sqlite details here', tags: ['work', 'spec'] }),
  note('beta', { title: 'Beta Plan', body: 'plan text', tags: ['spec'] }),
  note('back', { title: 'Backlinker', body: 'See [[Alpha Spec]] too.', tags: [] }),
  note('lonely', { title: 'Lonely', body: 'nothing to see', tags: [] }),
];

const stateFor = (domain, over = {}) => {
  const corpus = domain.buildNoteResearchCorpus(VAULT);
  return {
    corpus, byId: corpus.byId, byTitle: corpus.byTitle,
    query: 'sqlite', signal: null,
    evidence: new Map(), summaries: [], summaryCount: 0,
    ...over,
  };
};

test('a greeting is answered without touching the vault', () => {
  const d = makeDomain();
  for (const hello of ['hi', 'Hello!', 'hey', 'Good morning.', 'yo', 'sup']) {
    assert.match(d.fastChatAnswer(hello), /^Hello\./, `${hello} should be answered instantly`);
  }
  for (const thanks of ['thanks', 'Thank you!', 'ok', 'okay', 'cool', 'nice']) {
    assert.equal(d.fastChatAnswer(thanks), 'Done.');
  }
  for (const meta of ['help', 'what can you do', 'who are you', 'how do you work']) {
    assert.match(d.fastChatAnswer(meta), /VispNote's AI assistant/);
  }
  assert.equal(d.fastChatAnswer('what did I write about sqlite'), '',
    'a real question is not short-circuited');
  assert.equal(d.fastChatAnswer(''), '');
  assert.equal(d.fastChatAnswer(null), '');
});

test('recency and broad-summary questions are told apart', () => {
  const d = makeDomain();
  assert.equal(d.isRecencyQuery('what are my most recent notes'), true);
  assert.equal(d.isRecencyQuery('what changed in my vault'), true);
  assert.equal(d.isRecencyQuery('the latest weather'), false, 'recency alone is not a note question');
  assert.equal(d.isRecencyQuery('what is in my notes'), false);
  assert.equal(d.isRecencyQuery(''), false);

  assert.equal(d.isBroadVaultSummaryQuery('summarise all my notes'), true);
  assert.equal(d.isBroadVaultSummaryQuery('give me an overview of the whole vault'), true);
  assert.equal(d.isBroadVaultSummaryQuery('recap everything'), true);
  assert.equal(d.isBroadVaultSummaryQuery('summarise my recent notes'), false,
    'a recency question is answered from recent notes, not by reading the whole vault');
  assert.equal(d.isBroadVaultSummaryQuery('summarise the Alpha Spec'), false);
  assert.equal(d.isBroadVaultSummaryQuery(''), false);
});

test('recursive research is opt-in and never used for a whole-vault summary', () => {
  const d = makeDomain();
  assert.equal(d.shouldUseRecursiveNoteResearch('what links to Alpha', [], { recursiveResearch: true }), true);
  assert.equal(d.shouldUseRecursiveNoteResearch('summarise all my notes', [], { recursiveResearch: true }), false,
    'reading the whole vault is a different job from traversing it');
  assert.equal(d.shouldUseRecursiveNoteResearch('anything', [], { recursiveResearch: false }), false);
  assert.equal(d.shouldUseRecursiveNoteResearch('anything', []), false, 'the default is off');
});

test('memory recall degrades to nothing rather than failing an answer', async () => {
  const d = makeDomain();
  assert.deepEqual(await d.recallMemoryContext('q'), [], 'with no bridge installed there are no memories');

  d.setMemoryRecallProvider(async () => [
    { id: 'm1', content: '  Use WAL mode.  ', layer: 'semantic', category: 'pattern', importance: '0.7', tags: ['sqlite'], createdAt: '2026-01-01' },
    { id: 'm2', content: '   ' },
    { content: 'no id but real content' },
  ]);
  const memories = await d.recallMemoryContext('q');
  assert.deepEqual(memories.map(m => m.content), ['Use WAL mode.', 'no id but real content'],
    'a memory with no content is not a memory');
  assert.equal(memories[0].importance, 0.7);
  assert.deepEqual(memories[0].tags, ['sqlite']);
  assert.equal(memories[1].id, '');

  d.setMemoryRecallProvider(async () => { throw new Error('server down'); });
  assert.deepEqual(await d.recallMemoryContext('q'), [], 'an unreachable memory server is not an error');
  d.setMemoryRecallProvider(async () => 'not a list');
  assert.deepEqual(await d.recallMemoryContext('q'), []);
  d.setMemoryRecallProvider('not a function');
  assert.deepEqual(await d.recallMemoryContext('q'), [], 'a bad provider is the same as none');
});

test('a memory is given a title and a citable source shape', () => {
  const d = makeDomain();
  assert.equal(d.memoryTitle({ content: '\n\n  The first real line\nmore' }), 'The first real line');
  assert.equal(d.memoryTitle({ content: '', category: 'pattern' }), 'pattern',
    'a memory with no content is named by its category');
  assert.equal(d.memoryTitle({}), 'Memory');
  assert.equal(d.memoryTitle({ content: 'x'.repeat(200) }).length, 80);

  const [source] = d.memorySources([{ id: 'm1', content: 'x'.repeat(300), createdAt: '2026-01-01', importance: 0.5 }]);
  assert.equal(source.kind, 'memory');
  assert.equal(source.id, 'memory:m1', 'a memory id is namespaced so it cannot collide with a note id');
  assert.equal(source.snippet.length, 200);
  assert.equal(d.memorySources([{ content: 'no id' }])[0].id, '');
  assert.deepEqual(d.memorySources(), []);
});

test('a corpus indexes notes by id, title, tag and backlink', () => {
  const d = makeDomain();
  const corpus = d.buildNoteResearchCorpus(VAULT);
  assert.equal(corpus.byId.get('alpha').title, 'Alpha Spec');
  assert.equal(corpus.byTitle.get('alpha spec').id, 'alpha', 'titles are indexed case-insensitively');
  assert.deepEqual(corpus.notesByTag.get('spec').map(n => n.id), ['alpha', 'beta']);
  assert.deepEqual(corpus.backlinksByTitle.get('alpha spec').map(n => n.id), ['hub', 'back']);
  assert.equal(corpus.metaList.length, VAULT.length);
  assert.deepEqual(corpus.metaById.get('hub').outgoingTitleKeys, ['alpha spec', 'beta plan']);
  assert.equal(corpus.metaById.get('alpha').bodyLower, 'sqlite details here');

  const empty = d.buildNoteResearchCorpus();
  assert.equal(empty.byId.size, 0);
  assert.deepEqual(empty.metaList, []);
  const untitled = d.buildNoteResearchCorpus([note('u', { title: '' })]);
  assert.equal(untitled.byTitle.size, 0, 'a note with no title cannot be found by title');
});

test('traversal ranks seeds, then their links, backlinks and tag-mates', () => {
  const d = makeDomain();
  const ranked = d.expandTraversalCandidates(['hub'], VAULT, 'sqlite');
  const ids = ranked.map(r => r.note.id);
  assert.equal(ids[0], 'hub', 'the seed itself ranks highest');
  assert.ok(ids.includes('alpha') && ids.includes('beta'), 'notes the seed links to are reached');
  assert.ok(!ids.includes('lonely'), 'a note connected to nothing is not dragged in');
  assert.deepEqual(ranked.find(r => r.note.id === 'alpha').reasons, ['linked from Project Hub', 'shares #work'],
    'a candidate reached more than one way lists every reason it was picked');

  const fromAlpha = d.expandTraversalCandidates(['alpha'], VAULT, 'q');
  const backlinker = fromAlpha.find(r => r.note.id === 'back');
  assert.deepEqual(backlinker.reasons, ['backlinks to Alpha Spec']);
  assert.ok(fromAlpha.find(r => r.note.id === 'beta').reasons.some(r => r.startsWith('shares #')),
    'a note sharing a tag with the seed is a candidate');

  // The current note only joins in when the question is about it.
  const withCurrent = d.expandTraversalCandidates(['alpha'], VAULT, 'what is on this page', { currentNoteId: 'lonely' });
  assert.equal(withCurrent[0].note.id, 'lonely', 'the note being read outranks everything else');
  assert.deepEqual(withCurrent[0].reasons, ['current note']);
  const withoutCurrent = d.expandTraversalCandidates(['alpha'], VAULT, 'what about sqlite', { currentNoteId: 'lonely' });
  assert.ok(!withoutCurrent.some(r => r.note.id === 'lonely'));
  assert.equal(d.expandTraversalCandidates(['nope'], VAULT, 'q').length, 0, 'an unknown seed adds nothing');
  assert.deepEqual(d.expandTraversalCandidates([], VAULT, 'q'), []);
});

test('a note is compacted to what the planner needs and nothing more', () => {
  const d = makeDomain();
  const compact = d.compactNoteForResearch(note('n1', {
    title: 'The Note', tags: ['work'],
    body: 'status:: DRAFT\nSee [[Alpha Spec|the spec]] and [[Beta Plan#Section]].',
  }));
  assert.equal(compact.id, 'n1');
  assert.deepEqual(compact.links, ['Alpha Spec', 'Beta Plan']);
  assert.equal(compact.preview, 'See the spec and Beta Plan.',
    'the preview reads as prose: properties gone, links shown as their alias');
  assert.ok(!('body' in compact), 'the full body is never handed to the planner');
  assert.equal(d.compactNoteForResearch({ id: 'x' }).title, 'Untitled');
  assert.equal(d.compactNoteForResearch({ id: 'x', date: '2026-02-02' }).modifiedAt, '2026-02-02');
  assert.equal(d.compactNoteForResearch({ id: 'x' }).modifiedAt, null);
  assert.equal(d.notePreview(note('n', { body: 'x'.repeat(500) })).length, 240);
  assert.equal(d.notePreview(null), '');
});

test('planner output is parsed out of whatever the model wraps it in', () => {
  const d = makeDomain();
  assert.deepEqual(d.parseResearchToolCalls('[{"tool":"finish"}]'), [{ tool: 'finish', args: { tool: 'finish' } }]);
  assert.deepEqual(d.parseResearchToolCalls('```json\n[{"tool":"finish"}]\n```').length, 1,
    'a fenced code block is unwrapped');
  assert.deepEqual(d.parseResearchToolCalls('Here you go:\n[{"tool":"finish"}]\nhope that helps').length, 1,
    'an array buried in prose is still found');
  assert.deepEqual(d.parseResearchToolCalls('{"calls":[{"tool":"finish"}]}').length, 1,
    'the model may wrap the array in an object');
  assert.deepEqual(d.parseResearchToolCalls('[{"name":"get_note","args":{"id":"n1"}}]'),
    [{ tool: 'get_note', args: { id: 'n1' } }], 'name is an accepted spelling of tool');
  assert.deepEqual(d.parseResearchToolCalls('[{"action":"finish"}]')[0].tool, 'finish');
  assert.deepEqual(d.parseResearchToolCalls('[{"tool":"FINISH"}]')[0].tool, 'finish');
  assert.deepEqual(d.parseResearchToolCalls('[{"noTool":1}]'), [], 'a call with no tool named is not a call');
  assert.deepEqual(d.parseResearchToolCalls('not json at all'), []);
  assert.deepEqual(d.parseResearchToolCalls('[not, json]'), []);
  assert.deepEqual(d.parseResearchToolCalls(''), []);
  assert.deepEqual(d.parseResearchToolCalls('{"nope":1}'), []);
  assert.equal(d.parseResearchToolCalls(JSON.stringify(Array.from({ length: 9 }, () => ({ tool: 'finish' })))).length, 3,
    'the number of calls per round is capped');

  assert.deepEqual(d.normalizeResearchToolCalls([{ tool: ' GET_NOTE ', args: { id: 'n1' } }]),
    [{ tool: 'get_note', args: { id: 'n1' } }]);
  assert.deepEqual(d.normalizeResearchToolCalls([{ tool: 'x', args: 'not an object' }]), [{ tool: 'x', args: {} }]);
  assert.deepEqual(d.normalizeResearchToolCalls([{}]), []);
  assert.deepEqual(d.normalizeResearchToolCalls('[{"tool":"finish"}]').length, 1,
    'a raw string is parsed first');
  assert.equal(d.capResearchArg('x'.repeat(300)).length, 120);
  assert.equal(d.capResearchArg(null), '');
});

test('every research tool returns evidence or says plainly that it found none', async () => {
  const d = makeDomain();
  const run = async (call, state) => (await d.executeResearchCall(call, state)).result;

  const finish = await d.executeResearchCall({ tool: 'finish' }, stateFor(d));
  assert.equal(finish.done, true);

  const search = await run({ tool: 'search_notes', args: { query: 'sqlite' } }, stateFor(d));
  assert.equal(search.tool, 'search_notes');
  assert.equal(search.count, 1);
  assert.equal(search.items[0].id, 'alpha');
  assert.ok(!('body' in search.items[0]), 'the tool returns compact notes, never full bodies');
  assert.equal((await run({ tool: 'search_notes', args: { query: 'nothingmatches' } }, stateFor(d))).count, 0);

  const got = await run({ tool: 'get_note', args: { id: 'alpha' } }, stateFor(d));
  assert.equal(got.count, 1);
  assert.equal((await run({ tool: 'get_note', args: { id: 'nope' } }, stateFor(d))).summary, 'Note not found.');
  assert.equal((await run({ tool: 'get_note', args: {} }, stateFor(d))).count, 0);

  const links = await run({ tool: 'get_links', args: { id: 'hub' } }, stateFor(d));
  assert.deepEqual(links.items.map(i => i.id), ['alpha', 'beta']);
  assert.equal((await run({ tool: 'get_links', args: { id: 'lonely' } }, stateFor(d))).summary, 'No resolved links.');
  assert.equal((await run({ tool: 'get_links', args: { id: 'nope' } }, stateFor(d))).count, 0);

  const backlinks = await run({ tool: 'get_backlinks', args: { id: 'alpha' } }, stateFor(d));
  assert.deepEqual(backlinks.items.map(i => i.id), ['hub', 'back']);
  assert.equal((await run({ tool: 'get_backlinks', args: { id: 'lonely' } }, stateFor(d))).summary, 'No backlinks.');

  const tagged = await run({ tool: 'get_notes_by_tag', args: { tag: '#SPEC' } }, stateFor(d));
  assert.deepEqual(tagged.items.map(i => i.id), ['alpha', 'beta'], 'a tag is matched without its hash and case');
  assert.equal((await run({ tool: 'get_notes_by_tag', args: { tag: '  ' } }, stateFor(d))).summary, 'No notes for tag.');
  assert.equal((await run({ tool: 'get_notes_by_tag', args: { tag: 'unknown' } }, stateFor(d))).count, 0);

  const limited = await run({ tool: 'get_notes_by_tag', args: { tag: 'spec', limit: 1 } }, stateFor(d));
  assert.equal(limited.count, 1);
  assert.equal((await run({ tool: 'get_notes_by_tag', args: { tag: 'spec', limit: 99 } }, stateFor(d))).count, 2,
    'an absurd limit is clamped rather than obeyed');

  assert.equal((await run({ tool: 'run_shell', args: {} }, stateFor(d))).summary, 'Rejected unknown note research tool.',
    'a tool the planner invented is refused, not attempted');
});

test('a tool call records the evidence it found, up to the cap', async () => {
  const d = makeDomain();
  const state = stateFor(d);
  await d.executeResearchCall({ tool: 'get_note', args: { id: 'alpha' } }, state);
  assert.deepEqual([...state.evidence.keys()], ['alpha']);
  assert.equal(state.evidence.get('alpha').reason, 'get_note');
  await d.executeResearchCall({ tool: 'get_note', args: { id: 'alpha' } }, state);
  assert.equal(state.evidence.size, 1, 'the same note is not collected twice');

  const full = stateFor(d, { evidence: new Map(Array.from({ length: 10 }, (_, i) => [`x${i}`, {}])) });
  await d.executeResearchCall({ tool: 'get_note', args: { id: 'alpha' } }, full);
  assert.equal(full.evidence.size, 10, 'once the evidence budget is full nothing more is added');
});

test('summarising a subset is bounded, validated and recorded', async () => {
  const d = makeDomain();
  const state = stateFor(d);
  const first = await d.executeResearchCall({ tool: 'summarize_subset', args: { noteIds: ['alpha', 'beta'], question: 'why' } }, state);
  assert.equal(first.result.count, 2);
  assert.equal(first.result.summary, 'a subset summary');
  assert.equal(state.summaries.length, 1);
  assert.deepEqual(state.summaries[0].noteIds, ['alpha', 'beta']);
  assert.equal(state.evidence.size, 2, 'summarised notes count as evidence');

  const noIds = await d.executeResearchCall({ tool: 'summarize_subset', args: { noteIds: ['nope'] } }, stateFor(d));
  assert.equal(noIds.result.summary, 'No valid notes to summarize.');
  assert.equal((await d.executeResearchCall({ tool: 'summarize_subset', args: {} }, stateFor(d))).result.count, 0);

  const capped = stateFor(d, { summaryCount: 2 });
  assert.equal((await d.executeResearchCall({ tool: 'summarize_subset', args: { noteIds: ['alpha'] } }, capped)).result.summary,
    'Summary limit reached.');

  const useless = makeDomain({ providerChat: async () => ({ text: '  ' }) });
  const rejected = await useless.executeResearchCall(
    { tool: 'summarize_subset', args: { noteIds: ['alpha'] } }, stateFor(useless));
  assert.equal(rejected.result.summary, 'Summary was empty or failed validation.');
  assert.equal(rejected.result.count, 0);
});

test('the planner prompt shows compact evidence and the recent tool log only', () => {
  const d = makeDomain();
  const messages = d.buildResearchPlannerMessages(
    'what links to Alpha',
    Array.from({ length: 15 }, (_, i) => note(`n${i}`, { body: 'body text' })),
    Array.from({ length: 12 }, (_, i) => ({ tool: 'get_note', count: 1, summary: `summary ${i}` })),
    2
  );
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /read-only note research planner/);
  assert.match(messages[0].content, /Do not request code execution, shell commands, plugins, filesystem access, or network access\./);
  assert.match(messages[1].content, /Question: what links to Alpha/);
  assert.match(messages[1].content, /Round: 2/);
  assert.match(messages[1].content, /Evidence notes \(10\)/, 'the evidence handed over is capped');
  assert.ok(!messages[1].content.includes('summary 3'), 'only the last few tool results are replayed');
  assert.ok(messages[1].content.includes('summary 11'));
  assert.ok(!messages[1].content.includes('"body"'), 'note bodies never reach the planner prompt');
});

test('lexical scoring prefers a title match over a body mention', () => {
  const d = makeDomain();
  const corpus = d.buildNoteResearchCorpus(VAULT);
  const alpha = corpus.metaById.get('alpha');
  assert.ok(d.lexicalScoreMeta(alpha, 'alpha') > d.lexicalScoreMeta(alpha, 'details'),
    'a word in the title is worth more than a word in the body');
  assert.ok(d.lexicalScoreMeta(alpha, 'spec') > d.lexicalScoreMeta(alpha, 'details'),
    'a tag match outranks a body match too');
  assert.equal(d.lexicalScoreMeta(alpha, 'nothingmatches'), 0);
  assert.equal(d.lexicalScoreMeta(alpha, 'a'), 0, 'single letters are not search terms');
  assert.equal(d.lexicalScoreMeta(alpha, ''), 0);
});

test('wiki links and titles are read consistently everywhere', () => {
  const d = makeDomain();
  assert.deepEqual(d.extractWikiLinkTitles('[[One]] and [[ Two ]] and [[One]]'), ['One', 'Two'],
    'a repeated link is listed once');
  assert.deepEqual(d.extractWikiLinkTitles('[[One#Section|alias]]'), ['One']);
  assert.deepEqual(d.extractWikiLinkTitles(''), []);
  assert.deepEqual(d.extractWikiLinkTitles(null), []);
  assert.equal(d.titleKey('  Alpha Spec  '), 'alpha spec');
  assert.equal(d.titleKey(null), '');

  assert.equal(d.queryMentionsCurrentNote('what is on this page'), true);
  assert.equal(d.queryMentionsCurrentNote('summarise the current note'), true);
  assert.equal(d.queryMentionsCurrentNote('add it in this'), true);
  assert.equal(d.queryMentionsCurrentNote('what is in my vault'), false);

  assert.equal(d.stripPromptPropertyLines('status:: DRAFT\nreal text'), 'real text');
  assert.equal(d.stripPromptPropertyLines(null), '');
  assert.deepEqual(d.sortByModified([note('a', { modifiedAt: '2026-01-01' }), note('b', { modifiedAt: '2026-06-01' })])
    .map(n => n.id), ['b', 'a']);
  assert.deepEqual(d.sortByModified([note('a', { modifiedAt: null, date: '2026-06-01' }), note('b', { modifiedAt: '2026-01-01' })])
    .map(n => n.id), ['a', 'b'], 'a note never modified is dated by its creation');
  assert.ok(d.noteTextLength({ title: 'T', body: 'B', tags: ['x'] }) > 0);
});
