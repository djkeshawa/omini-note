const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeToolSchema, sanitizeAiTools } = require('../lib/integrations/ai/toolSchemas.js');
const { createProviderDomain } = require('../lib/ai/providers.js');

// lib/ai/providers.js sat at 60.14% branch coverage. These cover the pure
// message- and schema-shaping helpers, which decide what actually reaches a
// provider -- the network paths are exercised by the AI regression suite.

function makeDomain() {
  return createProviderDomain({
    CONFIG: { enabled: true, provider: 'ollama', chatModel: 'm' },
    MAX_RAG_PROMPT_CHARS: 8000,
    TOOL_PLAN_MAX_TOKENS: 100,
    TOOL_PLAN_TIMEOUT_MS: 100,
    ollama: { getHost: () => 'http://localhost:11434' },
    currentProviderMeta: () => ({ label: 'Ollama', baseUrl: 'http://localhost:11434/v1' }),
    providerSetupMessage: r => r,
    reducePiiMessages: messages => ({ messages, replacements: [] }),
    shouldReducePiiForProvider: () => false,
    restorePiiText: t => t,
    fetchWithTimeout: async () => ({ ok: true, json: async () => ({}) }),
    apiKeyForProvider: () => '',
  });
}

test('an endpoint is not double-suffixed when it already names the path', () => {
  const d = makeDomain();
  assert.equal(d.openAiCompatibleEndpoint('https://api.x.com/v1'), 'https://api.x.com/v1/chat/completions');
  // A user pasting the full endpoint must not get .../chat/completions/chat/completions
  assert.equal(d.openAiCompatibleEndpoint('https://api.x.com/v1/chat/completions'), 'https://api.x.com/v1/chat/completions');
  assert.equal(d.openAiCompatibleEndpoint('https://api.x.com/v1/chat/completions/'), 'https://api.x.com/v1/chat/completions/');
});

test('every system message is kept, in order, and blanks are dropped', () => {
  // Losing one would silently drop an instruction the answer depends on.
  const d = makeDomain();
  assert.equal(d.collectSystem([
    { role: 'system', content: 'first' },
    { role: 'user', content: 'ignored' },
    { role: 'system', content: '  second  ' },
    { role: 'system', content: '   ' },
    { role: 'system', content: null },
  ]), 'first\n\nsecond');
  assert.equal(d.collectSystem([]), '');
});

test('only real user and assistant turns are forwarded', () => {
  const d = makeDomain();
  const out = d.nonSystemMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: '   ' },
    { role: 'tool', content: 'nope' },
    null,
    { role: 'user' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]);
});

test('message helpers do not throw on junk input', () => {
  const d = makeDomain();
  for (const input of [[], [null], [undefined], [{}], [{ role: 'user', content: 42 }]]) {
    assert.equal(typeof d.collectSystem(input), 'string', `collectSystem(${JSON.stringify(input)})`);
    assert.ok(Array.isArray(d.nonSystemMessages(input)), `nonSystemMessages(${JSON.stringify(input)})`);
  }
  // Junk entries are dropped, not forwarded to the provider.
  assert.deepEqual(d.nonSystemMessages([null, {}, { role: 'tool', content: 'x' }]), []);
});

test('a tool schema that is not an object degrades to a safe empty object', () => {
  for (const input of [null, undefined, 'string', 42, [], [1, 2]]) {
    assert.deepEqual(sanitizeToolSchema(input), { type: 'object', additionalProperties: false },
      `unsafe schema produced for ${JSON.stringify(input)}`);
  }
});

test('a deeply nested schema is truncated rather than followed forever', () => {
  // A malicious or generated schema must not blow the stack on its way to a provider.
  let deep = { type: 'string' };
  for (let i = 0; i < 200; i++) deep = { type: 'object', properties: { child: deep } };
  let out;
  assert.doesNotThrow(() => { out = sanitizeToolSchema(deep); });
  assert.ok(out && typeof out === 'object');
});

test('a self-referential schema does not hang', () => {
  const cyclic = { type: 'object', properties: {} };
  cyclic.properties.self = cyclic;
  let out;
  assert.doesNotThrow(() => { out = sanitizeToolSchema(cyclic); });
  assert.ok(out && typeof out === 'object');
});

test('sanitizeAiTools drops tools that could not be called', () => {
  const tools = sanitizeAiTools([
    { name: 'good_tool', description: 'ok', inputSchema: { type: 'object' } },
    { name: '', description: 'no name', inputSchema: { type: 'object' } },
    { name: 'bad name', description: 'space', inputSchema: { type: 'object' } },
    null,
    'not a tool',
  ]);
  assert.deepEqual(tools.map(t => t.name), ['good_tool']);
});

test('sanitizeAiTools survives junk instead of throwing', () => {
  for (const input of [null, undefined, 'x', 42, {}, [null], [[]]]) {
    assert.doesNotThrow(() => sanitizeAiTools(input), `threw on ${JSON.stringify(input)}`);
    assert.ok(Array.isArray(sanitizeAiTools(input)));
  }
});
