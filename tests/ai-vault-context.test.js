const test = require('node:test');
const assert = require('node:assert/strict');

const { createResearchDomain } = require('../lib/ai/research.js');

// Which notes Ask AI is allowed to see for a given question, and why. The
// answer is only as good as this selection, and the `mode` and `reason` it
// reports are what the UI shows the user -- so a selection that silently left
// notes out while claiming otherwise is the failure being guarded against.

function makeDomain(over = {}) {
  const calls = { retrieval: [], planner: [] };
  const domain = createResearchDomain({
    CONFIG: { enabled: true, embedModel: 'nomic', ragTopK: 5 },
    MAX_CONTEXT_CHARS: 6000,
    MAX_NOTE_BODY_CHARS: 2000,
    MAX_RAG_PROMPT_CHARS: 20000,
    NOTE_RESEARCH_ARG_CHARS: 120,
    NOTE_RESEARCH_MAX_NOTES: 4,
    NOTE_RESEARCH_MAX_ROUNDS: 2,
    NOTE_RESEARCH_MAX_SUMMARIES: 2,
    NOTE_RESEARCH_MAX_TOOL_CALLS: 3,
    NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND: 2,
    NOTE_RESEARCH_TOOL_RESULT_CHARS: 1000,
    QUERY_CACHE_MS: 1000,
    SELECTED_NOTE_LIMIT: 3,
    TRAVERSAL_MAX_NOTES: 20,
    TRAVERSAL_SEED_LIMIT: 5,
    TRAVERSAL_SHARED_TAG_LIMIT: 5,
    WHOLE_VAULT_MAX_CHARS: 2000,
    WHOLE_VAULT_MAX_NOTES: 3,
    idx: {
      vectorSearch: () => [],
      lexicalContextSearch: (vaultId, query) => { calls.retrieval.push(query); return []; },
    },
    retrievalCache: new Map(),
    vaultStore: {},
    isUsefulResearchSummary: summary => String(summary || '').trim().length > 3,
    providerChat: async () => ({ text: '[]' }),
    embedQueryCached: async () => [1, 2, 3],
    ...over,
  });
  return { domain, calls };
}

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? 'body',
  tags: over.tags ?? [], modifiedAt: over.modifiedAt ?? '2026-01-01T00:00:00.000Z', ...over,
});
const storeWith = notes => ({ loadVault: async () => ({ notes }) });
const ST = { embedModelOk: false };

test('a question about recent notes is answered from the newest, in order', async () => {
  const { domain, calls } = makeDomain();
  const notes = [
    note('old', { modifiedAt: '2026-01-01T00:00:00.000Z' }),
    note('new', { modifiedAt: '2026-06-01T00:00:00.000Z' }),
    note('mid', { modifiedAt: '2026-03-01T00:00:00.000Z' }),
    note('older', { modifiedAt: '2025-01-01T00:00:00.000Z' }),
  ];
  const context = await domain.buildVaultContext('v1', 'what are my latest notes?', ST, storeWith(notes));
  assert.equal(context.mode, 'recent');
  assert.deepEqual(context.notes.map(n => n.id), ['new', 'mid', 'old'], 'newest first, up to the selection limit');
  assert.equal(context.totalNotes, 4);
  assert.equal(context.capped, true, 'a note left out is declared, not hidden');
  assert.match(context.reason, /context item 1 is the latest saved note/,
    'the prompt tells the model what the ordering means');
  assert.equal(calls.retrieval.length, 0, 'a recency question needs no retrieval at all');
});

test('a small vault is included whole', async () => {
  const { domain } = makeDomain();
  const notes = [note('a', { body: 'short' }), note('b', { body: 'short' })];
  const context = await domain.buildVaultContext('v1', 'what is in here?', ST, storeWith(notes));
  assert.equal(context.mode, 'whole-vault');
  assert.deepEqual(context.notes.map(n => n.id).sort(), ['a', 'b']);
  assert.equal(context.capped, false);
  assert.match(context.reason, /small enough to include in full/);
});

test('a whole-vault summary reads as far as the prompt budget allows, and says so', async () => {
  const { domain } = makeDomain();
  const notes = Array.from({ length: 10 }, (_, i) => note(`n${i}`, {
    body: 'x'.repeat(400), modifiedAt: `2026-0${(i % 9) + 1}-01T00:00:00.000Z`,
  }));
  const context = await domain.buildVaultContext('v1', 'summarise all my notes', ST, storeWith(notes));
  assert.equal(context.mode, 'broad-summary', 'a vault too big to include whole is still summarised over');
  assert.equal(context.totalNotes, 10);
  assert.match(context.reason, /whole-vault summary/);
  assert.ok(context.notes.length > 0);

  // A vault that is small enough is simply the whole vault, however it is asked.
  const small = await makeDomain().domain.buildVaultContext('v1', 'summarise all my notes', ST,
    storeWith([note('a', { body: 'short' })]));
  assert.equal(small.mode, 'whole-vault');
});

test('an ordinary question retrieves, then traverses what it found', async () => {
  const notes = [
    note('hub', { title: 'Project Hub', body: 'Links to [[Alpha Spec]].', tags: ['work'] }),
    note('alpha', { title: 'Alpha Spec', body: 'x'.repeat(600), tags: ['work'] }),
    note('far', { title: 'Unrelated', body: 'x'.repeat(600) }),
    note('far2', { title: 'Also unrelated', body: 'x'.repeat(600) }),
  ];
  const { domain } = makeDomain({
    idx: { vectorSearch: () => [], lexicalContextSearch: () => [{ noteId: 'hub' }] },
  });
  const context = await domain.buildVaultContext('v1', 'what is the hub about?', ST, storeWith(notes));
  assert.equal(context.mode, 'traversal', 'reaching a linked note is a traversal, not a plain keyword hit');
  assert.ok(context.notes.some(n => n.id === 'hub'));
  assert.ok(context.notes.some(n => n.id === 'alpha'), 'the note the hub links to comes along');
  assert.equal(context.researchToolCalls, 0);
  assert.deepEqual(context.researchSummaries, []);
  assert.match(context.reason, /related wiki-links, backlinks, and shared tags were traversed/);
});

test('a retrieval hit with nothing around it is reported as a plain match', async () => {
  const notes = [
    note('lonely', { title: 'Lonely', body: 'x'.repeat(600) }),
    note('other', { title: 'Other', body: 'x'.repeat(600) }),
    note('third', { title: 'Third', body: 'x'.repeat(600) }),
    note('fourth', { title: 'Fourth', body: 'x'.repeat(600) }),
  ];
  const keyword = await makeDomain({
    idx: { vectorSearch: () => [], lexicalContextSearch: () => [{ noteId: 'lonely' }] },
  }).domain.buildVaultContext('v1', 'what about it?', { embedModelOk: false }, storeWith(notes));
  assert.equal(keyword.mode, 'keyword');
  assert.deepEqual(keyword.notes.map(n => n.id), ['lonely']);

  const semantic = await makeDomain({
    idx: { vectorSearch: () => [{ noteId: 'lonely' }], lexicalContextSearch: () => [] },
  }).domain.buildVaultContext('v1', 'what about it?', { embedModelOk: true }, storeWith(notes));
  assert.equal(semantic.mode, 'semantic', 'the same selection made by embeddings is named differently');
});

test('a question that matches nothing falls back to recent notes and admits it', async () => {
  const notes = Array.from({ length: 6 }, (_, i) => note(`n${i}`, { body: 'x'.repeat(600) }));
  const { domain } = makeDomain();
  const context = await domain.buildVaultContext('v1', 'nothing matches this', ST, storeWith(notes));
  assert.equal(context.mode, 'recent-fallback');
  assert.equal(context.notes.length, 3, 'the selection limit still applies to the fallback');
  assert.equal(context.capped, true);
  assert.match(context.reason, /no direct match was found, so recent notes were used/);
});

test('an empty vault produces an empty context rather than failing', async () => {
  const { domain } = makeDomain();
  const context = await domain.buildVaultContext('v1', 'anything', ST, storeWith([]));
  assert.deepEqual(context.notes, []);
  assert.equal(context.totalNotes, 0);
  assert.equal(context.capped, false);
  assert.deepEqual((await domain.buildVaultContext('v1', 'anything', ST, { loadVault: async () => ({}) })).notes, []);
});

test('recursive research runs when asked, and reports what it did', async () => {
  const notes = [
    note('hub', { title: 'Project Hub', body: 'Links to [[Alpha Spec]].', tags: ['work'] }),
    note('alpha', { title: 'Alpha Spec', body: 'x'.repeat(600), tags: ['work'] }),
    note('far', { title: 'Unrelated', body: 'x'.repeat(600) }),
    note('far2', { title: 'Also unrelated', body: 'x'.repeat(600) }),
  ];
  const rounds = [];
  const { domain } = makeDomain({
    idx: { vectorSearch: () => [], lexicalContextSearch: () => [{ noteId: 'hub' }] },
  });
  const context = await domain.buildVaultContext('v1', 'what is the hub about?', ST, storeWith(notes), {
    recursiveResearch: true,
    planNoteResearch: async ({ round }) => {
      rounds.push(round);
      return round === 1 ? [{ tool: 'get_note', args: { id: 'far' } }] : [{ tool: 'finish' }];
    },
  });
  assert.equal(context.mode, 'recursive-traversal');
  assert.equal(context.researchToolCalls, 2, 'the tool call and the finish both count');
  assert.deepEqual(rounds, [1, 2], 'the planner is asked again until it finishes');
  assert.ok(context.notes.some(n => n.id === 'far'), 'a note the planner asked for joins the context');
  assert.match(context.reason, /bounded read-only note research loop/);
});

test('the research loop is bounded by rounds, calls and evidence', async () => {
  const notes = Array.from({ length: 12 }, (_, i) => note(`n${i}`));
  const seedIds = notes.map(n => n.id);

  // A planner that never finishes is stopped by the call ceiling.
  let asked = 0;
  const runaway = await makeDomain().domain.runRecursiveNoteResearch({
    query: 'q', allNotes: notes, seedIds: [],
    options: {
      planNoteResearch: async () => { asked++; return [{ tool: 'search_notes', args: { query: 'note' } }, { tool: 'get_note', args: { id: 'n0' } }]; },
    },
  });
  assert.equal(runaway.toolCalls, 2,
    'a round that fills the evidence budget ends the loop before the call ceiling is reached');
  assert.equal(asked, 1, 'so the planner is only asked once');
  assert.equal(runaway.toolLog.length, 2);
  assert.equal(runaway.notes.length, 4);

  // A planner that returns nothing ends the loop immediately.
  const quiet = await makeDomain().domain.runRecursiveNoteResearch({
    query: 'q', allNotes: notes, seedIds: [], options: { planNoteResearch: async () => [] },
  });
  assert.equal(quiet.toolCalls, 0);
  assert.deepEqual(quiet.toolLog, []);

  // A planner that throws ends the loop with whatever it already had.
  const broken = await makeDomain().domain.runRecursiveNoteResearch({
    query: 'q', allNotes: notes, seedIds: ['n0'],
    options: { planNoteResearch: async () => { throw new Error('planner exploded'); } },
  });
  assert.deepEqual(broken.notes.map(n => n.id), ['n0'], 'the seeds are still evidence');
  assert.equal(broken.toolCalls, 0);

  // Seeds alone can fill the evidence budget, and the loop stops there.
  const seeded = await makeDomain().domain.runRecursiveNoteResearch({
    query: 'q', allNotes: notes, seedIds,
    options: { planNoteResearch: async () => [{ tool: 'search_notes', args: { query: 'note' } }] },
  });
  assert.equal(seeded.notes.length, 4, 'the evidence budget is the cap on what the model sees');
});

test('the note being read joins the research when the question is about it', async () => {
  const notes = [note('current'), note('other')];
  const withCurrent = await makeDomain().domain.runRecursiveNoteResearch({
    query: 'what is on this page?', allNotes: notes, seedIds: ['other'],
    options: { currentNoteId: 'current', planNoteResearch: async () => [] },
  });
  assert.deepEqual(withCurrent.notes.map(n => n.id).sort(), ['current', 'other']);

  const without = await makeDomain().domain.runRecursiveNoteResearch({
    query: 'what about the roadmap?', allNotes: notes, seedIds: ['other'],
    options: { currentNoteId: 'current', planNoteResearch: async () => [] },
  });
  assert.deepEqual(without.notes.map(n => n.id), ['other']);

  const missing = await makeDomain().domain.runRecursiveNoteResearch({
    query: 'q', allNotes: notes, seedIds: ['nowhere'], options: { planNoteResearch: async () => [] },
  });
  assert.deepEqual(missing.notes, [], 'a seed naming no note contributes nothing');
});

test('the default planner reads the model reply, and a bad one ends the loop', async () => {
  const notes = [note('n0'), note('n1')];
  const replies = ['[{"tool":"get_note","args":{"id":"n1"}}]', '[{"tool":"finish"}]'];
  let index = 0;
  const planned = await makeDomain({ providerChat: async () => ({ text: replies[index++] }) })
    .domain.runRecursiveNoteResearch({ query: 'q', allNotes: notes, seedIds: [], options: {} });
  assert.deepEqual(planned.notes.map(n => n.id), ['n1'], 'the model chose a note and it became evidence');
  assert.equal(planned.toolCalls, 2);

  const junk = await makeDomain({ providerChat: async () => ({ text: 'I cannot do that' }) })
    .domain.runRecursiveNoteResearch({ query: 'q', allNotes: notes, seedIds: [], options: {} });
  assert.equal(junk.toolCalls, 0, 'a reply with no tool calls in it ends the loop rather than looping blind');
});

test('retrieval ids are cached per vault, query and search mode', async () => {
  let lexical = 0;
  let vector = 0;
  const { domain } = makeDomain({
    idx: {
      vectorSearch: () => { vector++; return [{ noteId: 'a' }]; },
      lexicalContextSearch: () => { lexical++; return [{ noteId: 'b' }]; },
    },
  });
  const ids = await domain.retrievalNoteIds('v1', 'a question', { embedModelOk: true });
  assert.deepEqual(ids, ['a', 'b'], 'semantic hits come first, then keyword ones');
  await domain.retrievalNoteIds('v1', 'a question', { embedModelOk: true });
  assert.equal(lexical, 1, 'the same question in the same vault is not searched twice');
  assert.equal(vector, 1);

  await domain.retrievalNoteIds('v1', 'a question', { embedModelOk: false });
  assert.equal(lexical, 2, 'the same question in keyword mode is a different search');
  assert.equal(vector, 1, 'and does not touch the vector index');
  await domain.retrievalNoteIds('v2', 'a question', { embedModelOk: true });
  assert.equal(lexical, 3, 'nor is a different vault answered from the first one\'s cache');

  const failing = makeDomain({
    embedQueryCached: async () => { throw new Error('embedding failed'); },
    idx: { vectorSearch: () => [], lexicalContextSearch: () => [{ noteId: 'b' }] },
  });
  assert.deepEqual(await failing.domain.retrievalNoteIds('v1', 'q', { embedModelOk: true }), ['b'],
    'a failed embedding still leaves the keyword results');
});
