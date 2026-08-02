const test = require('node:test');
const assert = require('node:assert/strict');

const { createProviderDomain } = require('../lib/ai/providers.js');
const integrations = require('../lib/integrations/ai/toolSchemas.js');

// The provider network paths, exercised with an injected transport. The
// behaviours a user depends on: requests are shaped the way each provider
// actually requires, no request leaves without credentials, and -- the
// privacy-critical one -- when PII reduction is on, the real text never
// reaches the wire and the reply comes back restored.

const EMAIL = 'alice@example.com';
const TOKEN = '[[PII_1]]';

function makeDomain({ provider = 'openai', meta = {}, apiKey = 'k-123', model = 'test-model',
  baseUrl = 'https://api.test.dev/v1', reducePii = false, fetchData = {}, ollamaReply = { text: 'local reply' } } = {}) {
  const calls = { fetches: [], ollamaChats: [] };
  const scope = {
    CONFIG: { provider, chatModel: 'cfg-model', enabled: true },
    MAX_RAG_PROMPT_CHARS: 8000, MEMORY_PROMPT_CHARS: 2000, OLLAMA_KEEP_ALIVE: '5m',
    SYSTEM_PROMPT: 'sys', TOOL_PLAN_MAX_TOKENS: 300, TOOL_PLAN_TIMEOUT_MS: 5000,
    chatNumPredict: n => n || 400,
    currentProviderMeta: () => ({ label: 'TestProvider', ...meta }),
    providerApiKey: () => apiKey,
    providerBaseUrl: () => baseUrl,
    providerChatModel: () => model,
    providerFetch: async (url, init, label, opts) => {
      calls.fetches.push({ url, init, label, opts });
      return typeof fetchData === 'function' ? fetchData(url, init) : fetchData;
    },
    providerFetchStream: async () => { throw new Error('stream not under test'); },
    providerTransport: { createPiiTokenEmitter: (reps, onToken, restore) => t => onToken(restore(t, reps)) },
    ollama: { chat: async (m, messages, opts) => { calls.ollamaChats.push({ m, messages, opts }); return ollamaReply; } },
    parseJsonSseEvent: () => null,
    readSseData: async () => '',
    reducePiiMessages: (messages, active) => active
      ? { messages: messages.map(m => ({ ...m, content: String(m.content).split(EMAIL).join(TOKEN) })),
          replacements: [{ token: TOKEN, value: EMAIL }] }
      : { messages, replacements: [] },
    restorePiiText: (text, reps) => (reps || []).reduce((acc, r) => acc.split(r.token).join(r.value), String(text || '')),
    restorePiiResult: (result, reps) => ({ ...result, text: (reps || []).reduce((acc, r) => acc.split(r.token).join(r.value), String(result.text || '')) }),
    shouldReducePiiForProvider: () => reducePii,
    stripPromptPropertyLines: t => String(t || ''),
    integrationAnthropicToolDefinitions: integrations.anthropicToolDefinitions,
    integrationGeminiToolDefinitions: integrations.geminiToolDefinitions,
    integrationOpenAiToolDefinitions: integrations.openAiToolDefinitions,
    integrationNormalizeToolCalls: integrations.normalizeToolCalls,
    integrationSanitizeAiTools: integrations.sanitizeAiTools,
    integrationSanitizeToolSchema: integrations.sanitizeToolSchema,
    integrationToolPlannerSystemPrompt: integrations.toolPlannerSystemPrompt,
    integrationFallbackToolPlannerMessages: integrations.fallbackToolPlannerMessages,
    integrationParseJsonObject: integrations.parseJsonObject,
  };
  return { domain: createProviderDomain(scope), calls };
}

const MESSAGES = [
  { role: 'system', content: 'be helpful' },
  { role: 'user', content: 'hello there' },
];

test('an OpenAI-compatible chat sends the right shape and reads the right field', async () => {
  const { domain, calls } = makeDomain({
    fetchData: { choices: [{ message: { content: '  the reply  ' } }] },
  });
  const result = await domain.providerChat(MESSAGES, {});
  assert.equal(result.text, 'the reply', 'reply text should come from choices[0] and be trimmed');
  assert.equal(calls.fetches.length, 1);
  const { url, init } = calls.fetches[0];
  assert.equal(url, 'https://api.test.dev/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer k-123');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'test-model');
  assert.equal(body.stream, false);
  assert.equal(body.messages.length, 2, 'system message travels inline for OpenAI-style APIs');
});

test('an Anthropic-compatible chat lifts the system prompt and joins text parts', async () => {
  const { domain, calls } = makeDomain({
    meta: { compatible: 'anthropic' },
    fetchData: { content: [{ type: 'text', text: 'part one' }, { type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'part two' }] },
  });
  const result = await domain.providerChat(MESSAGES, {});
  assert.equal(result.text, 'part one\npart two', 'non-text parts must be skipped, text parts joined');
  const { url, init } = calls.fetches[0];
  assert.equal(url, 'https://api.test.dev/v1/v1/messages');
  assert.equal(init.headers['x-api-key'], 'k-123');
  assert.ok(init.headers['anthropic-version'], 'anthropic requires a version header');
  const body = JSON.parse(init.body);
  assert.equal(body.system, 'be helpful', 'the system prompt must be lifted to the top level');
  assert.ok(body.messages.every(m => m.role !== 'system'), 'no system role may remain in messages');
});

test('a Gemini chat maps roles and never puts the key in a header', async () => {
  const { domain, calls } = makeDomain({
    meta: { compatible: 'gemini' },
    fetchData: { candidates: [{ content: { parts: [{ text: 'gem ' }, { text: 'reply' }] } }] },
  });
  const result = await domain.providerChat([
    { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
  ], {});
  assert.equal(result.text, 'gem reply');
  const { url, init } = calls.fetches[0];
  assert.ok(url.includes('test-model'), 'the model belongs in the URL for Gemini');
  assert.ok(url.includes('key=k-123'), 'the key travels as a query parameter');
  assert.equal(init.headers.authorization, undefined, 'no bearer header for Gemini');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user'],
    'assistant turns must be renamed to model');
});

test('Ollama chats stay local and inherit the configured model', async () => {
  const { domain, calls } = makeDomain({ provider: 'ollama' });
  const result = await domain.providerChat(MESSAGES, {});
  assert.equal(result.text, 'local reply');
  assert.equal(calls.fetches.length, 0, 'a local chat must not hit the provider transport');
  assert.equal(calls.ollamaChats[0].m, 'cfg-model', 'the configured chat model is the fallback');
  assert.equal(calls.ollamaChats[0].opts.options.num_predict, 400);
});

test('no request leaves without credentials or a model', async () => {
  for (const [label, opts] of [
    ['missing key', { apiKey: '' }],
    ['missing model', { model: '' }],
    ['custom without base url', { provider: 'custom', baseUrl: '' }],
  ]) {
    const { domain, calls } = makeDomain(opts);
    await assert.rejects(() => domain.providerChat(MESSAGES, {}), /missing/i, `${label} did not throw`);
    assert.equal(calls.fetches.length, 0, `${label}: a request was sent anyway`);
  }
});

test('with PII reduction on, the real text never reaches the wire and the reply is restored', async () => {
  const { domain, calls } = makeDomain({
    reducePii: true,
    fetchData: { choices: [{ message: { content: `Reply about ${TOKEN}` } }] },
  });
  const result = await domain.providerChat([{ role: 'user', content: `Email ${EMAIL} please` }], {});
  const wire = calls.fetches[0].init.body;
  assert.ok(!wire.includes(EMAIL), 'the real email address was sent to the provider');
  assert.ok(wire.includes('PII_1'), 'the placeholder token should travel instead');
  assert.equal(result.text, `Reply about ${EMAIL}`, 'the reply must come back with the PII restored');
});

const TOOLS = [{ name: 'search_notes', description: 'find', inputSchema: { type: 'object', properties: {} } }];

test('a native Anthropic tool plan maps tool_use blocks into calls', async () => {
  const { domain } = makeDomain({
    meta: { compatible: 'anthropic' },
    fetchData: { content: [
      { type: 'text', text: 'Let me search.' },
      { type: 'tool_use', id: 'tu_1', name: 'search_notes', input: { query: 'q' } },
    ] },
  });
  const plan = await domain.providerToolPlan(MESSAGES, TOOLS, {});
  assert.equal(plan.native, true);
  assert.equal(plan.mode, 'tool_call');
  assert.equal(plan.toolCalls.length, 1);
  assert.equal(plan.toolCalls[0].name, 'search_notes');
  assert.deepEqual(plan.toolCalls[0].args, { query: 'q' });
  assert.equal(plan.answer, 'Let me search.');
});

test('a text-only native reply is a direct answer; an empty one asks to clarify', async () => {
  const direct = makeDomain({ meta: { compatible: 'anthropic' }, fetchData: { content: [{ type: 'text', text: 'Just an answer.' }] } });
  assert.equal((await direct.domain.providerToolPlan(MESSAGES, TOOLS, {})).mode, 'direct_answer');
  const empty = makeDomain({ meta: { compatible: 'anthropic' }, fetchData: { content: [] } });
  assert.equal((await empty.domain.providerToolPlan(MESSAGES, TOOLS, {})).mode, 'clarify');
});

test('a native Gemini tool plan maps functionCall parts into calls', async () => {
  const { domain } = makeDomain({
    meta: { compatible: 'gemini' },
    fetchData: { candidates: [{ content: { parts: [{ functionCall: { name: 'search_notes', args: { query: 'g' } } }] } }] },
  });
  const plan = await domain.providerToolPlan(MESSAGES, TOOLS, {});
  assert.equal(plan.mode, 'tool_call');
  assert.deepEqual(plan.toolCalls[0].args, { query: 'g' });
});

test('an Ollama tool plan falls back to the JSON planner and parses its reply', async () => {
  const { domain, calls } = makeDomain({
    provider: 'ollama',
    ollamaReply: { text: '{"toolCalls":[{"name":"search_notes","args":{"query":"local"}}]}' },
  });
  const plan = await domain.providerToolPlan(MESSAGES, TOOLS, {});
  assert.equal(plan.native, false, 'ollama has no native tool API; the JSON planner must be used');
  assert.equal(plan.mode, 'tool_call');
  assert.deepEqual(plan.toolCalls[0].args, { query: 'local' });
  assert.ok(calls.ollamaChats.length >= 1);
});

test('a planner that returns junk yields a failed plan, not a crash', async () => {
  const { domain } = makeDomain({ provider: 'ollama', ollamaReply: { text: 'not json at all' } });
  const plan = await domain.providerToolPlan(MESSAGES, TOOLS, {});
  assert.equal(plan.mode, 'planner_failed');
  assert.deepEqual(plan.toolCalls, []);
  assert.match(plan.error || '', /JSON/i);
});

test('a tool plan with no tools says so instead of calling the model', async () => {
  const { domain, calls } = makeDomain({ meta: { compatible: 'anthropic' } });
  const plan = await domain.providerToolPlan(MESSAGES, [], {});
  assert.equal(plan.mode, 'no_tools');
  assert.equal(calls.fetches.length, 0);
});
