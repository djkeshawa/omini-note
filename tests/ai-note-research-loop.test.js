const test = require('node:test');
const assert = require('node:assert/strict');

const { createResearchDomain } = require('../lib/ai/research.js');

// The recursive note-research loop lets a model steer read-only tools over the
// vault. Two kinds of behaviour matter: the tools answer correctly from the
// notes, and every budget genuinely stops the loop -- a planner (a model!)
// that misbehaves must be contained, never obeyed.

function makeDomain({ chatReply = 'a useful subset summary with details' } = {}) {
  const calls = { chats: 0 };
  const domain = createResearchDomain({
    CONFIG: { enabled: true, embedModel: '' },
    MAX_CONTEXT_CHARS: 8000, MAX_NOTE_BODY_CHARS: 2000, MAX_RAG_PROMPT_CHARS: 8000,
    NOTE_RESEARCH_ARG_CHARS: 200, NOTE_RESEARCH_MAX_NOTES: 6, NOTE_RESEARCH_MAX_ROUNDS: 3,
    NOTE_RESEARCH_MAX_SUMMARIES: 2, NOTE_RESEARCH_MAX_TOOL_CALLS: 8,
    NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND: 4, NOTE_RESEARCH_TOOL_RESULT_CHARS: 500,
    QUERY_CACHE_MS: 1000, SELECTED_NOTE_LIMIT: 12,
    TRAVERSAL_MAX_NOTES: 20, TRAVERSAL_SEED_LIMIT: 3, TRAVERSAL_SHARED_TAG_LIMIT: 5,
    WHOLE_VAULT_MAX_CHARS: 50000, WHOLE_VAULT_MAX_NOTES: 50,
    idx: {}, retrievalCache: new Map(), vaultStore: {},
    providerChat: async () => { calls.chats += 1; return { text: chatReply }; },
    isUsefulResearchSummary: s => String(s || '').length > 10,
  });
  return { domain, calls };
}

const NOTES = [
  { id: 'hub', title: 'Project Hub', body: 'Links: [[Alpha Spec]] and [[Beta Plan]]', tags: ['project'], modifiedAt: '2026-05-01T00:00:00Z' },
  { id: 'alpha', title: 'Alpha Spec', body: 'The alpha specification covers the parser.', tags: ['project', 'spec'], modifiedAt: '2026-04-01T00:00:00Z' },
  { id: 'beta', title: 'Beta Plan', body: 'Beta rollout plan, see [[Alpha Spec]].', tags: ['plan'], modifiedAt: '2026-03-01T00:00:00Z' },
  { id: 'diary', title: 'Diary', body: 'Unrelated musings about weather.', tags: ['personal'], modifiedAt: '2026-02-01T00:00:00Z' },
];

const run = (domain, planner, extra = {}) => domain.runRecursiveNoteResearch({
  query: 'what is the alpha parser plan?',
  allNotes: NOTES,
  options: { planNoteResearch: planner },
  ...extra,
});

test('a search-then-finish plan gathers matching notes as evidence', async () => {
  const { domain } = makeDomain();
  const result = await run(domain, async ({ round }) => round === 1
    ? [{ tool: 'search_notes', args: { query: 'alpha', limit: 5 } }]
    : [{ tool: 'finish' }]);
  const ids = result.notes.map(n => n.id);
  assert.ok(ids.includes('alpha'), 'the obviously matching note was not gathered');
  assert.ok(!ids.includes('diary'), 'an unrelated note was dragged into evidence');
  assert.ok(result.toolLog.some(e => e.tool === 'search_notes'));
  assert.ok(result.toolLog.some(e => e.tool === 'finish'), 'the finish call should be logged');
});

test('links and backlinks resolve through real wiki-link syntax', async () => {
  const { domain } = makeDomain();
  const links = await run(domain, async ({ round }) => round === 1
    ? [{ tool: 'get_links', args: { id: 'hub' } }] : []);
  assert.deepEqual(links.notes.map(n => n.id).sort(), ['alpha', 'beta'],
    'the hub links to Alpha Spec and Beta Plan');
  const backlinks = await run(domain, async ({ round }) => round === 1
    ? [{ tool: 'get_backlinks', args: { id: 'alpha' } }] : []);
  assert.deepEqual(backlinks.notes.map(n => n.id).sort(), ['beta', 'hub'],
    'both hub and beta link to Alpha Spec');
});

test('tag lookup accepts the # form and unknown ids answer honestly', async () => {
  const { domain } = makeDomain();
  const tagged = await run(domain, async ({ round }) => round === 1
    ? [{ tool: 'get_notes_by_tag', args: { tag: '#spec' } }] : []);
  assert.deepEqual(tagged.notes.map(n => n.id), ['alpha']);
  const missing = await run(domain, async ({ round }) => round === 1
    ? [{ tool: 'get_note', args: { id: 'nope' } }] : []);
  assert.equal(missing.notes.length, 0);
  assert.match(missing.toolLog[0].summary, /not found/i);
});

test('a tool outside the whitelist is rejected, not executed', async () => {
  // The planner is model output. If it asks for something dangerous, the only
  // acceptable response is a refusal recorded in the log.
  const { domain } = makeDomain();
  const result = await run(domain, async ({ round }) => round === 1
    ? [{ tool: 'run_shell', args: { cmd: 'rm -rf /' } }, { tool: 'finish' }] : []);
  assert.ok(result.toolLog.some(e => /Rejected unknown/i.test(e.summary)),
    'the unknown tool was not visibly rejected');
  assert.equal(result.notes.length, 0);
});

test('the tool-call budget stops a planner that never finishes', async () => {
  const { domain } = makeDomain();
  let plannerRounds = 0;
  const result = await run(domain, async () => {
    plannerRounds += 1;
    return [
      { tool: 'search_notes', args: { query: 'alpha' } },
      { tool: 'search_notes', args: { query: 'beta' } },
      { tool: 'search_notes', args: { query: 'plan' } },
      { tool: 'search_notes', args: { query: 'spec' } },
    ];
  });
  assert.ok(result.toolCalls <= 8, `budget breached: ${result.toolCalls} calls`);
  assert.ok(plannerRounds <= 3, `round cap breached: ${plannerRounds} rounds`);
});

test('a crashing planner ends the loop with the evidence gathered so far', async () => {
  const { domain } = makeDomain();
  const result = await run(domain, async ({ round }) => {
    if (round === 1) return [{ tool: 'get_note', args: { id: 'alpha' } }];
    throw new Error('planner exploded');
  });
  assert.deepEqual(result.notes.map(n => n.id), ['alpha'],
    'evidence from before the crash must survive');
});

test('seed notes and "this note" references start as evidence', async () => {
  const { domain } = makeDomain();
  const seeded = await run(domain, async () => [], { seedIds: ['diary'] });
  assert.deepEqual(seeded.notes.map(n => n.id), ['diary']);
  const current = await domain.runRecursiveNoteResearch({
    query: 'summarise this note',
    allNotes: NOTES,
    options: { planNoteResearch: async () => [], currentNoteId: 'hub' },
  });
  assert.deepEqual(current.notes.map(n => n.id), ['hub'],
    'a question about "this note" must include the open note');
});

test('evidence is capped so a broad search cannot flood the context', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`, title: `Match ${i}`, body: 'alpha alpha alpha', tags: [], modifiedAt: '2026-01-01T00:00:00Z',
  }));
  const { domain } = makeDomain();
  const result = await domain.runRecursiveNoteResearch({
    query: 'alpha',
    allNotes: many,
    options: { planNoteResearch: async ({ round }) => round <= 2
      ? [{ tool: 'search_notes', args: { query: 'alpha', limit: 10 } }] : [] },
  });
  assert.ok(result.notes.length <= 6, `evidence grew to ${result.notes.length}, past the cap of 6`);
});

test('subset summaries are budgeted and empty ones are not kept', async () => {
  const { domain, calls } = makeDomain();
  const result = await run(domain, async ({ round }) => round === 1
    ? [
      { tool: 'summarize_subset', args: { noteIds: ['alpha'], question: 'q1' } },
      { tool: 'summarize_subset', args: { noteIds: ['beta'], question: 'q2' } },
      { tool: 'summarize_subset', args: { noteIds: ['hub'], question: 'q3' } },
    ] : []);
  assert.equal(result.summaries.length, 2, 'the summary budget of 2 was not enforced');
  assert.equal(calls.chats, 2, 'the model was called for a summary beyond the budget');
  const useless = makeDomain({ chatReply: 'short' });
  const empty = await run(useless.domain, async ({ round }) => round === 1
    ? [{ tool: 'summarize_subset', args: { noteIds: ['alpha'] } }] : []);
  assert.equal(empty.summaries.length, 0, 'a failed-validation summary was kept as evidence');
});
