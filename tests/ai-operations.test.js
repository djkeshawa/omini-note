const test = require('node:test');
const assert = require('node:assert/strict');

const { createOperationDomain } = require('../lib/ai/operations.js');

// The Ask AI entry points. The rule these all share is that a missing or
// unreachable model must never look like an answer: the user is told what to
// install, and gets whatever the vault can still give them locally. The second
// rule is that an empty model reply is never applied over their text.

function makeDomain(over = {}) {
  const calls = { chat: [], stream: [], plan: [], jobs: [], finished: [], tokens: [] };
  const domain = createOperationDomain({
    ASK_MAX_TOKENS: 500,
    CHAT_MAX_TOKENS: 400,
    CHAT_SYSTEM_PROMPT: 'CHAT SYSTEM',
    EDIT_SYSTEM_PROMPT: 'EDIT SYSTEM',
    TOOL_PLAN_MAX_TOKENS: 300,
    TOOL_PLAN_TIMEOUT_MS: 200,
    CONFIG: { enabled: true, provider: 'ollama', chatModel: 'llama3' },
    ollama: { getHost: () => 'http://localhost:11434' },
    currentProviderMeta: () => ({ label: 'OpenAI' }),
    providerSetupMessage: reason => `SETUP: ${reason}`,
    beginCancellableJob: jobId => { calls.jobs.push(jobId); return { aborted: false }; },
    finishCancellableJob: jobId => calls.finished.push(jobId),
    status: async () => ({ reachable: true, chatModelOk: true, chatModel: 'llama3' }),
    buildVaultContext: async () => ({ notes: [], mode: 'retrieval', capped: false }),
    recallMemoryContext: async () => [],
    memorySources: memories => memories.map(m => ({ kind: 'memory', id: m.id })),
    buildRagPrompt: (query, context) => [{ role: 'user', content: `${query}|${context.notes.length}` }],
    notePreview: (note, n) => String(note.body || '').slice(0, n),
    fastChatAnswer: () => '',
    normalizeToolCalls: calls_ => calls_,
    sanitizeAiTools: tools => tools,
    summarizeVaultInternal: async () => ({ ok: true, answer: 'a summary' }),
    providerChat: async (messages, options) => { calls.chat.push({ messages, options }); return { text: 'an answer' }; },
    providerChatStream: async (messages, options) => {
      calls.stream.push({ messages, options });
      options.onToken?.('an answer');
      return { text: 'an answer' };
    },
    providerToolPlan: async (messages, tools, options) => {
      calls.plan.push({ messages, tools, options });
      return { toolCalls: [{ name: 'x' }] };
    },
    vaultStore: {},
    ...over,
  });
  return { domain, calls };
}

const OFFLINE = { status: async () => ({ reachable: false, reason: 'Ollama is not running' }) };
const NO_MODEL = { status: async () => ({ reachable: true, chatModelOk: false }) };

test('an unreachable provider is explained in the words of the provider it is', async () => {
  const { domain } = makeDomain(OFFLINE);
  assert.equal(domain.providerUnavailableError({ reason: 'Ollama is not running' }), 'SETUP: Ollama is not running');
  assert.equal(domain.providerUnavailableError({}), 'SETUP: Ollama not reachable at http://localhost:11434',
    'with no reason given the local host is named');

  const hosted = makeDomain({ CONFIG: { enabled: true, provider: 'openai', chatModel: 'gpt' } }).domain;
  assert.equal(hosted.providerUnavailableError({}), 'SETUP: OpenAI is not configured');
  assert.equal(hosted.providerUnavailableError({ reason: 'no key' }), 'SETUP: no key');
});

test('a missing chat model tells the user the command that installs it', () => {
  const { domain } = makeDomain();
  assert.equal(domain.chatUnavailableReason({ reachable: true }),
    'SETUP: Local chat model is not installed: ollama pull llama3');
  assert.equal(domain.chatUnavailableReason({ reachable: false }), 'SETUP: Ollama not reachable at http://localhost:11434',
    'an unreachable provider is reported before a missing model');
  assert.equal(domain.chatUnavailableReason(), 'SETUP: Ollama not reachable at http://localhost:11434');

  const hosted = makeDomain({ CONFIG: { enabled: true, provider: 'openai', chatModel: 'gpt' } }).domain;
  assert.equal(hosted.chatUnavailableReason({ reachable: true }), 'SETUP: Chat model is not configured');
  assert.equal(hosted.chatUnavailableReason({ reachable: true, reason: 'wrong key' }), 'SETUP: wrong key');
});

test('without a model the answer is the notes the vault found, not a refusal', () => {
  const { domain } = makeDomain();
  const answer = domain.buildModelSetupAnswer('what changed?', {
    notes: [
      { id: 'n1', title: 'The Meeting', body: 'We decided to ship.' },
      { id: 'n2', title: '', body: '' },
    ],
  }, { reachable: true });
  assert.match(answer, /^SETUP: Local chat model is not installed/);
  assert.match(answer, /VispNote can still search your notes locally/);
  assert.match(answer, /1\. The Meeting — We decided to ship\./);
  assert.match(answer, /2\. Untitled — \(empty note\)/);
  assert.match(answer, /Requested question: what changed\?/);

  assert.match(domain.buildModelSetupAnswer('q', { notes: [] }, {}), /No matching notes were found yet\./);
  assert.match(domain.buildModelSetupAnswer('q', {}, {}), /No matching notes were found yet\./);
  assert.equal(domain.buildModelSetupAnswer('q', { notes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, title: `T${i}` })) }, {})
    .match(/^\d+\. /gm).length, 5, 'at most five notes are listed');

  const hosted = makeDomain({ CONFIG: { enabled: true, provider: 'openai', chatModel: 'gpt' } }).domain;
  assert.match(hosted.buildModelSetupAnswer('q', { notes: [] }, {}), /Configure the selected AI provider in Settings > AI/);
  assert.ok(!hosted.buildModelSetupAnswer('q', { notes: [] }, {}).includes('Requested question'),
    'a hosted provider is configured, not installed, so the retry instruction differs');
});

test('the chat setup answer names the install step for the provider in use', () => {
  const { domain } = makeDomain();
  assert.match(domain.buildChatSetupAnswer({ reachable: true }), /ollama pull llama3/);
  const hosted = makeDomain({ CONFIG: { enabled: true, provider: 'openai', chatModel: 'gpt' } }).domain;
  assert.match(hosted.buildChatSetupAnswer({ reachable: true }), /Configure the selected AI provider/);
});

test('AI turned off is reported as off by every entry point', async () => {
  const off = { CONFIG: { enabled: false, provider: 'ollama', chatModel: 'llama3' } };
  const { domain } = makeDomain(off);
  const expected = { ok: false, error: 'AI is disabled in settings' };
  assert.deepEqual(await domain.ask('v1', 'q'), expected);
  assert.deepEqual(await domain.askStream('v1', 'q'), expected);
  assert.deepEqual(await domain.summarizeVault('v1', 'q'), expected);
  assert.deepEqual(await domain.chat({ text: 'q' }), expected);
  assert.deepEqual(await domain.chatStream({ text: 'q' }), expected);
  assert.deepEqual(await domain.editText({ text: 'x' }), expected);
  assert.deepEqual(await domain.editTextStream({ text: 'x' }), expected);
  assert.deepEqual(await domain.toolPlan({ text: 'q' }), expected);
});

test('every entry point opens and closes its cancellable job', async () => {
  const { domain, calls } = makeDomain();
  await domain.ask('v1', 'q', {}, { jobId: 'j1' });
  await domain.chat({ text: 'q', jobId: 'j2' });
  await domain.editText({ text: 'x', jobId: 'j3' });
  assert.deepEqual(calls.jobs, ['j1', 'j2', 'j3']);
  assert.deepEqual(calls.finished, ['j1', 'j2', 'j3'], 'a job is released even on the paths that return early');

  const failing = makeDomain({ status: async () => { throw new Error('boom'); } });
  await assert.rejects(failing.domain.ask('v1', 'q', {}, { jobId: 'j4' }));
  assert.deepEqual(failing.calls.finished, ['j4'], 'a job is released when the call throws too');
});

test('asking with no model falls back to a local keyword answer', async () => {
  const { domain, calls } = makeDomain({
    ...NO_MODEL,
    buildVaultContext: async (vaultId, query, st, storeApi, options) => {
      calls.chat.push({ st, options });
      return { notes: [{ id: 'n1', title: 'T', body: 'body', modifiedAt: '2026-01-01' }], capped: true };
    },
  });
  const result = await domain.ask('v1', 'what changed?');
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'keyword-setup');
  assert.equal(result.setupRequired, true);
  assert.equal(result.contextCapped, true);
  assert.deepEqual(result.sources, [{ id: 'n1', title: 'T', modifiedAt: '2026-01-01', snippet: 'body' }]);
  assert.match(result.answer, /1\. T — body/);
  assert.equal(calls.chat[0].st.embedModelOk, false, 'the fallback never asks for a semantic search');
  assert.equal(calls.chat[0].st.askMode, 'keyword');
  assert.equal(calls.chat[0].options.recursiveResearch, false, 'nor for recursive research');

  // The streaming variant emits the same fallback so the panel is not blank.
  const streamed = makeDomain({ ...NO_MODEL });
  const tokens = [];
  const fallback = await streamed.domain.askStream('v1', 'q', {}, { onToken: t => tokens.push(t) });
  assert.equal(fallback.setupRequired, true);
  assert.equal(tokens.length, 1);
  assert.match(tokens[0], /^SETUP:/);
});

test('asking with nothing to go on says so rather than guessing', async () => {
  const { domain, calls } = makeDomain();
  const empty = await domain.ask('v1', 'q');
  assert.deepEqual(empty, { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] });
  assert.equal(calls.chat.length, 0, 'the model is not called when there is no context to give it');
  assert.deepEqual(await domain.askStream('v1', 'q'), empty);

  // A memory on its own is enough context to be worth asking about.
  const withMemory = makeDomain({ recallMemoryContext: async () => [{ id: 'm1', content: 'remembered' }] });
  const answered = await withMemory.domain.ask('v1', 'q');
  assert.equal(answered.answer, 'an answer');
  assert.equal(answered.memoryCount, 1);
  assert.deepEqual(answered.sources, [{ kind: 'memory', id: 'm1' }]);
});

test('an answer cites the notes it used and the mode it used them in', async () => {
  const withNotes = {
    buildVaultContext: async () => ({
      notes: [{ id: 'n1', title: 'T', body: 'x'.repeat(500), modifiedAt: '2026-01-01' }],
      mode: 'traversal', capped: true,
    }),
  };
  const { domain, calls } = makeDomain(withNotes);
  const result = await domain.ask('v1', 'q', {}, { maxTokens: 42, timeoutMs: 7 });
  assert.equal(result.answer, 'an answer');
  assert.equal(result.mode, 'traversal');
  assert.equal(result.contextCapped, true);
  assert.equal(result.memoryCount, 0);
  assert.equal(result.sources[0].kind, 'note');
  assert.equal(result.sources[0].snippet.length, 200, 'a source snippet is capped');
  assert.equal(calls.chat[0].options.maxTokens, 42);
  assert.equal(calls.chat[0].options.timeoutMs, 7);
  assert.equal(calls.chat[0].options.model, 'llama3');

  const streamed = makeDomain(withNotes);
  const tokens = [];
  const streamedResult = await streamed.domain.askStream('v1', 'q', {}, { onToken: t => tokens.push(t) });
  assert.equal(streamedResult.answer, 'an answer');
  assert.deepEqual(tokens, ['an answer'], 'the panel receives the text as it arrives');
  assert.equal(streamed.calls.stream[0].options.maxTokens, 500, 'the ask budget is the default');
});

test('an edit is refused rather than applied when there is nothing to apply', async () => {
  const { domain, calls } = makeDomain();
  const edited = await domain.editText({ text: 'the original', instruction: 'Tighten it', scope: 'selection' });
  assert.deepEqual(edited, { ok: true, text: 'an answer' });
  assert.equal(calls.chat[0].messages[0].content, 'EDIT SYSTEM');
  assert.match(calls.chat[0].messages[1].content, /Scope: selection/);
  assert.match(calls.chat[0].messages[1].content, /Instruction: Tighten it/);
  assert.match(calls.chat[0].messages[1].content, /Text:\nthe original/);

  const defaults = makeDomain();
  await defaults.domain.editText({ text: 'x' });
  assert.match(defaults.calls.chat[0].messages[1].content, /Scope: text/);
  assert.match(defaults.calls.chat[0].messages[1].content, /Instruction: Improve the writing\./);

  const custom = makeDomain();
  await custom.domain.editText({ text: 'x', systemMessage: '  MY SYSTEM  ', model: ' other-model ' });
  assert.equal(custom.calls.chat[0].messages[0].content, 'MY SYSTEM');
  assert.equal(custom.calls.chat[0].options.model, 'other-model');
  const blankSystem = makeDomain();
  await blankSystem.domain.editText({ text: 'x', systemMessage: '   ', model: '   ' });
  assert.equal(blankSystem.calls.chat[0].messages[0].content, 'EDIT SYSTEM');
  assert.equal(blankSystem.calls.chat[0].options.model, 'llama3');

  for (const empty of ['', '   ', undefined]) {
    assert.deepEqual(await makeDomain().domain.editText({ text: empty }),
      { ok: false, error: 'No text selected for AI editing' });
  }
  const blank = makeDomain({ providerChat: async () => ({ text: '   ' }) });
  assert.deepEqual(await blank.domain.editText({ text: 'the original' }),
    { ok: false, error: 'The model returned an empty edit, so your text was left unchanged.' },
    'replacing the selection with nothing would delete the user\'s text');

  assert.deepEqual(await makeDomain(OFFLINE).domain.editText({ text: 'x' }),
    { ok: false, error: 'SETUP: Ollama is not running', setupRequired: true });
  assert.deepEqual(await makeDomain(NO_MODEL).domain.editText({ text: 'x' }),
    { ok: false, error: 'SETUP: Local chat model is not installed: ollama pull llama3', setupRequired: true });
});

test('a streamed edit follows the same rules as a plain one', async () => {
  const { domain, calls } = makeDomain();
  const tokens = [];
  assert.deepEqual(await domain.editTextStream({ text: 'x', onToken: t => tokens.push(t) }), { ok: true, text: 'an answer' });
  assert.deepEqual(tokens, ['an answer']);
  assert.equal(calls.stream[0].messages[0].content, 'EDIT SYSTEM');
  assert.deepEqual(await makeDomain().domain.editTextStream({ text: '  ' }),
    { ok: false, error: 'No text selected for AI editing' });
  assert.deepEqual(await makeDomain(OFFLINE).domain.editTextStream({ text: 'x' }),
    { ok: false, error: 'SETUP: Ollama is not running', setupRequired: true });
  assert.deepEqual(await makeDomain(NO_MODEL).domain.editTextStream({ text: 'x' }),
    { ok: false, error: 'SETUP: Local chat model is not installed: ollama pull llama3', setupRequired: true });
  const blank = makeDomain({ providerChatStream: async () => ({ text: '' }) });
  assert.equal((await blank.domain.editTextStream({ text: 'x' })).ok, false);
});

test('chat answers greetings instantly and keeps only the recent turns', async () => {
  const fast = makeDomain({ fastChatAnswer: text => (text === 'hi' ? 'Hello.' : '') });
  assert.deepEqual(await fast.domain.chat({ text: 'hi' }), { ok: true, answer: 'Hello.', fast: true });
  assert.equal(fast.calls.chat.length, 0, 'a greeting never reaches the model');
  const tokens = [];
  assert.deepEqual(await fast.domain.chatStream({ text: 'hi', onToken: t => tokens.push(t) }),
    { ok: true, answer: 'Hello.', fast: true });
  assert.deepEqual(tokens, ['Hello.']);

  const { domain, calls } = makeDomain();
  await domain.chat({ messages: [
    { role: 'system', content: 'ignored' },
    ...Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `turn ${i}` })),
    { role: 'user', content: '   ' },
    null,
  ] });
  const sent = calls.chat[0].messages;
  assert.equal(sent[0].content, 'CHAT SYSTEM');
  assert.equal(sent.length, 9, 'the system prompt plus the last eight turns');
  assert.equal(sent[1].content, 'turn 4');
  assert.equal(calls.chat[0].options.maxTokens, 400);

  const plain = makeDomain();
  await plain.domain.chat('just a string');
  assert.equal(plain.calls.chat[0].messages[1].content, 'just a string',
    'a bare string is treated as the whole conversation');
  assert.equal((await makeDomain().domain.chat({ text: 'q' })).answer, 'an answer');
});

test('chat explains a missing model instead of failing', async () => {
  const setup = await makeDomain(NO_MODEL).domain.chat({ text: 'q' });
  assert.equal(setup.setupRequired, true);
  assert.match(setup.answer, /ollama pull llama3/);

  const tokens = [];
  const streamed = await makeDomain(NO_MODEL).domain.chatStream({ text: 'q', onToken: t => tokens.push(t) });
  assert.equal(streamed.setupRequired, true);
  assert.equal(tokens.length, 1);

  // Ollama reports a model it does not have at request time, not at status time.
  const notFound = makeDomain({ providerChat: async () => { throw new Error('model "llama3" not found'); } });
  const recovered = await notFound.domain.chat({ text: 'q' });
  assert.equal(recovered.setupRequired, true);
  assert.match(recovered.answer, /ollama pull llama3/);

  const notFoundStream = makeDomain({ providerChatStream: async () => { throw new Error('model llama3 not found'); } });
  const streamTokens = [];
  const recoveredStream = await notFoundStream.domain.chatStream({ text: 'q', onToken: t => streamTokens.push(t) });
  assert.equal(recoveredStream.setupRequired, true);
  assert.equal(streamTokens.length, 1);

  // Any other failure is a real failure and must not be disguised as setup.
  const broken = makeDomain({ providerChat: async () => { throw new Error('connection reset'); } });
  await assert.rejects(broken.domain.chat({ text: 'q' }), /connection reset/);
  const brokenStream = makeDomain({ providerChatStream: async () => { throw new Error('connection reset'); } });
  await assert.rejects(brokenStream.domain.chatStream({ text: 'q' }), /connection reset/);
  const hostedNotFound = makeDomain({
    CONFIG: { enabled: true, provider: 'openai', chatModel: 'gpt' },
    providerChat: async () => { throw new Error('model "gpt" not found'); },
  });
  await assert.rejects(hostedNotFound.domain.chat({ text: 'q' }), /not found/,
    'the pull-the-model recovery only makes sense for the local provider');
});

test('a tool plan needs a request, tools and a working model', async () => {
  const { domain, calls } = makeDomain();
  const planned = await domain.toolPlan({ text: 'do it', tools: [{ name: 'x' }] });
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.toolCalls, [{ name: 'x' }]);
  assert.equal(planned.mode, 'tool_call', 'the mode is inferred when the planner does not state one');
  assert.equal(planned.provider, 'ollama');
  assert.equal(planned.native, false);
  assert.equal(calls.plan[0].options.maxTokens, 300);
  assert.equal(calls.plan[0].options.timeoutMs, 200);
  assert.equal(calls.plan[0].options.nativeOnly, false);

  assert.deepEqual(await domain.toolPlan({ text: '   ', tools: [{ name: 'x' }] }),
    { ok: false, error: 'No user request was provided' });
  assert.deepEqual(await domain.toolPlan({ text: 'do it', tools: [] }),
    { ok: false, error: 'No tools were provided' });
  assert.equal((await makeDomain(NO_MODEL).domain.toolPlan({ text: 'q', tools: [{ name: 'x' }] })).setupRequired, true);

  const direct = makeDomain({ providerToolPlan: async () => ({ answer: 'just an answer', native: true, provider: 'openai' }) });
  const answered = await direct.domain.toolPlan({ text: 'q', tools: [{ name: 'x' }] });
  assert.equal(answered.mode, 'direct_answer');
  assert.equal(answered.native, true);
  assert.equal(answered.provider, 'openai');

  const unclear = makeDomain({ providerToolPlan: async () => ({}) });
  assert.equal((await unclear.domain.toolPlan({ text: 'q', tools: [{ name: 'x' }] })).mode, 'clarify');
  const stated = makeDomain({ providerToolPlan: async () => ({ mode: 'refused', error: '  nope  ' }) });
  const refusal = await stated.domain.toolPlan({ text: 'q', tools: [{ name: 'x' }] });
  assert.equal(refusal.mode, 'refused');
  assert.equal(refusal.error, 'nope');
});

test('summarising the vault delegates once the model is known to be there', async () => {
  const { domain } = makeDomain();
  assert.deepEqual(await domain.summarizeVault('v1', 'q'), { ok: true, answer: 'a summary' });
  const passed = makeDomain({ summarizeVaultInternal: async (vaultId, query, st, storeApi, options) => ({ vaultId, query, st, options }) });
  const result = await passed.domain.summarizeVault('v1', 'q', {}, { jobId: 'j1', limit: 3 });
  assert.equal(result.vaultId, 'v1');
  assert.equal(result.st.chatModelOk, true, 'the status is resolved once and handed down');
  assert.equal(result.options.limit, 3);
  assert.ok(result.options.signal, 'the cancellation signal travels with it');
});
