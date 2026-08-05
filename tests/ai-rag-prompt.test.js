const test = require('node:test');
const assert = require('node:assert/strict');

const { createProviderDomain } = require('../lib/ai/providers.js');

// The prompt Ask AI actually sends. Everything the model is allowed to know
// about the vault passes through here, so this pins two things: that the
// selection is described honestly (how many notes, whether anything was cut),
// and that the prompt cannot grow past its budget however large the notes are.

function makeDomain(over = {}) {
  return createProviderDomain({
    CONFIG: { enabled: true, provider: 'ollama', chatModel: 'm' },
    MAX_RAG_PROMPT_CHARS: 1200,
    MEMORY_PROMPT_CHARS: 60,
    SYSTEM_PROMPT: 'SYSTEM PROMPT',
    TOOL_PLAN_MAX_TOKENS: 100,
    TOOL_PLAN_TIMEOUT_MS: 100,
    ollama: { getHost: () => 'http://localhost:11434' },
    currentProviderMeta: () => ({ label: 'Ollama', baseUrl: 'http://localhost:11434/v1' }),
    reducePiiMessages: messages => ({ messages, replacements: [] }),
    shouldReducePiiForProvider: () => false,
    restorePiiText: t => t,
    stripPromptPropertyLines: body => String(body || '').replace(/^\w+::.*$/gm, '').trim(),
    ...over,
  });
}

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? 'A body.',
  tags: over.tags ?? [], date: over.date ?? '2026-01-01', modifiedAt: over.modifiedAt ?? '2026-02-01', ...over,
});

const context = (over = {}) => ({
  notes: [], mode: 'retrieval', reason: 'top matches', totalNotes: 0, capped: false, ...over,
});

const userText = messages => messages[1].content;

test('the prompt states the system prompt, the question and the answering rule', () => {
  const d = makeDomain();
  const messages = d.buildRagPrompt('what changed?', context({ notes: [note('n1')], totalNotes: 1 }));
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: 'system', content: 'SYSTEM PROMPT' });
  assert.equal(messages[1].role, 'user');
  assert.match(userText(messages), /Question: what changed\?/);
  assert.match(userText(messages), /Answer using only the context above\.$/,
    'the instruction not to invent anything is the last thing the model reads');
});

test('the selection block says how the notes were chosen and how many there are', () => {
  const d = makeDomain();
  const text = userText(d.buildRagPrompt('q', context({
    notes: [note('n1'), note('n2')], mode: 'traversal', reason: 'linked from the current note', totalNotes: 40,
  })));
  assert.match(text, /Selection mode: traversal/);
  assert.match(text, /Selection reason: linked from the current note/);
  assert.match(text, /Notes provided: 2 of 40/, 'the model is told it is seeing a subset');
  assert.match(text, /Context capped: no/);
  assert.ok(!text.includes('Memory items provided'), 'a line is omitted when there is nothing to say');
  assert.ok(!text.includes('Read-only research tool calls'));
  assert.ok(!text.includes('Research summaries'));

  const capped = userText(d.buildRagPrompt('q', context({ notes: [note('n1')], totalNotes: 40, capped: true })));
  assert.match(capped, /Context capped: yes/, 'a capped selection is declared, not hidden');
  const researched = userText(d.buildRagPrompt('q', context({ notes: [note('n1')], researchToolCalls: 3 })));
  assert.match(researched, /Read-only research tool calls: 3/);
});

test('each note is labelled with everything needed to cite it', () => {
  const d = makeDomain();
  const text = userText(d.buildRagPrompt('q', context({
    notes: [note('n1', { title: 'The Meeting', tags: ['work', 'urgent'], body: 'status:: DRAFT\nReal content.' })],
    totalNotes: 1,
  })));
  assert.match(text, /--- Context item 1 ---/);
  assert.match(text, /title: The Meeting/);
  assert.match(text, /id: n1/);
  assert.match(text, /noteDate: 2026-01-01/);
  assert.match(text, /modifiedAt: 2026-02-01/);
  assert.match(text, /tags: #work #urgent/);
  assert.match(text, /Real content\./);
  assert.ok(!text.includes('status::'), 'property lines are metadata, not content for the model to quote');

  const bare = userText(d.buildRagPrompt('q', context({ notes: [{ id: 'n2' }], totalNotes: 1 })));
  assert.match(bare, /title: Untitled/);
  assert.match(bare, /noteDate: unknown/);
  assert.match(bare, /modifiedAt: unknown/);
  assert.match(bare, /tags: none/);
  assert.match(bare, /\(empty note\)/, 'a note with no body says so rather than leaving a blank');

  const none = userText(d.buildRagPrompt('q', context()));
  assert.match(none, /\(no matching notes\)/, 'a question with no context says so plainly');
  assert.match(none, /Notes provided: 0 of 0/);
});

test('a prompt that would exceed its budget is truncated and admits it', () => {
  const d = makeDomain();
  const text = userText(d.buildRagPrompt('q', context({
    notes: [note('n1', { body: 'x'.repeat(5000) }), note('n2', { body: 'y'.repeat(5000) })],
    totalNotes: 2,
  })));
  assert.match(text, /\.\.\.\[truncated for prompt budget\]/);
  assert.match(text, /Context capped: yes/,
    'truncating inside the prompt counts as capping, even when the selection itself was not capped');
  assert.match(text, /Prompt budget: context was truncated to stay within the model prompt budget/);
  assert.ok(text.length < 12000, 'the prompt stays near its budget rather than sending both notes whole');

  const small = userText(d.buildRagPrompt('q', context({ notes: [note('n1', { body: 'short' })], totalNotes: 1 })));
  assert.ok(!small.includes('truncated for prompt budget'), 'a prompt that fits is not marked as cut');
  assert.match(small, /Context capped: no/);
});

test('research summaries are quoted with the notes they came from', () => {
  const d = makeDomain();
  const text = userText(d.buildRagPrompt('q', context({
    notes: [note('n1')],
    researchSummaries: [
      { noteIds: ['n1', 'n2'], summary: 'The first finding.' },
      { noteIds: ['n3'], summary: 'The second finding.' },
    ],
  })));
  assert.match(text, /Research summaries:/);
  assert.match(text, /Summary 1 from notes n1, n2:\nThe first finding\./);
  assert.match(text, /Summary 2 from notes n3:\nThe second finding\./);
  assert.ok(text.indexOf('Research summaries') < text.indexOf('Context from my notes'),
    'what the planner already worked out comes before the raw notes');
  assert.ok(!userText(d.buildRagPrompt('q', context({ notes: [note('n1')], researchSummaries: [] })))
    .includes('Research summaries'));
});

test('memories are quoted separately and told to be cited as memories', () => {
  const d = makeDomain();
  const text = userText(d.buildRagPrompt('q', context({
    notes: [note('n1')],
    memories: [
      { content: 'Use WAL mode.', category: 'pattern', layer: 'semantic', tags: ['sqlite'], createdAt: '2026-01-01' },
      { content: 'A bare memory.', category: '', layer: '', tags: [], createdAt: '' },
    ],
  })));
  assert.match(text, /Memory items provided: 2/);
  assert.match(text, /cite as \[Memory\], not a note title/,
    'a memory is not a note, and the model must not attribute it to one');
  assert.match(text, /--- Memory item 1 ---/);
  assert.match(text, /kind: pattern\/semantic/);
  assert.match(text, /recorded: 2026-01-01/);
  assert.match(text, /tags: #sqlite/);
  assert.match(text, /Use WAL mode\./);
  assert.match(text, /--- Memory item 2 ---\n\nA bare memory\./,
    'a memory with no kind, date or tags writes none of those lines');

  const long = userText(d.buildRagPrompt('q', context({
    notes: [], memories: [{ content: 'z'.repeat(500), category: '', layer: '', tags: [], createdAt: '' }],
  })));
  assert.match(long, /\.\.\.\[truncated for prompt budget\]/, 'a long memory is cut to its own budget');
  assert.ok(!long.includes('z'.repeat(200)));

  assert.ok(!userText(d.buildRagPrompt('q', context({ notes: [note('n1')], memories: [] }))).includes('Memory item'));
  assert.ok(!userText(d.buildRagPrompt('q', context({ notes: [note('n1')], memories: 'not a list' })))
    .includes('Memory item'), 'a memory list that is not a list contributes nothing');
});
