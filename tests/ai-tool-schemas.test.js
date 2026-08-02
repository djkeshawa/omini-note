const test = require('node:test');
const assert = require('node:assert/strict');

const schemas = require('../lib/integrations/ai/toolSchemas.js');

// lib/integrations/ai/toolSchemas.js parses the tool calls a model asks for --
// the quick-command path. It sat at 56% branch coverage. A malformed reply here
// reaches the tool runner as arguments, so the parsing contract matters.

test('parseJsonObject reads plain, fenced, and prose-wrapped JSON', () => {
  assert.deepEqual(schemas.parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(schemas.parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(schemas.parseJsonObject('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(schemas.parseJsonObject('Sure! Here you go:\n{"a":1}\nHope that helps.'), { a: 1 });
});

test('parseJsonObject returns null rather than throwing on junk', () => {
  for (const input of ['', '   ', null, undefined, 'not json at all', '{ broken', '{{{']) {
    assert.doesNotThrow(() => schemas.parseJsonObject(input), `threw on ${JSON.stringify(input)}`);
    assert.equal(schemas.parseJsonObject(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

test('parseJsonObject does not hand back a non-object as if it were an object', () => {
  // Callers destructure the result. An array or scalar reaching them reads as
  // an object with no keys at best, and throws at worst.
  for (const input of ['[1,2,3]', '"just a string"', '42', 'true', 'null']) {
    const out = schemas.parseJsonObject(input);
    const isPlainObject = out !== null && typeof out === 'object' && !Array.isArray(out);
    assert.ok(out === null || isPlainObject,
      `parseJsonObject(${input}) returned ${JSON.stringify(out)}, which is neither an object nor null`);
  }
});

test('normalizeToolCalls accepts the shapes the three providers actually send', () => {
  const calls = schemas.normalizeToolCalls([
    { name: 'search_notes', args: { query: 'x' } },
    { tool: 'create_note', input: { title: 'y' } },
    { function: { name: 'open_note', arguments: '{"id":"n1"}' } },
  ]);
  assert.deepEqual(calls.map(c => c.name), ['search_notes', 'create_note', 'open_note']);
  assert.deepEqual(calls[2].args, { id: 'n1' });
  assert.ok(calls.every(c => c.id), 'every call needs an id for the runner to track it');
});

test('normalizeToolCalls drops calls whose name is unusable', () => {
  const calls = schemas.normalizeToolCalls([
    { name: '', args: {} },
    { name: '../../etc/passwd', args: {} },
    { name: 'has space', args: {} },
    { name: 'x'.repeat(200), args: {} },
    { name: 'good_name', args: {} },
  ]);
  assert.deepEqual(calls.map(c => c.name), ['good_name']);
});

test('normalizeToolCalls caps how many tools one reply can invoke', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ name: `tool_${i}`, args: {} }));
  assert.equal(schemas.normalizeToolCalls(many).length, 8);
});

test('normalizeToolCalls survives junk instead of throwing', () => {
  for (const input of [null, undefined, 'string', 42, {}, [null], [undefined], [{}], [[]]]) {
    assert.doesNotThrow(() => schemas.normalizeToolCalls(input), `threw on ${JSON.stringify(input)}`);
    assert.ok(Array.isArray(schemas.normalizeToolCalls(input)), 'must always return an array');
  }
});

test('tool arguments are always a plain object, however the model phrased them', () => {
  // The object branch of parseToolArgs rejects arrays; the string branch does
  // not. So '[1,2]' as a JSON *string* yields an array where {} is expected,
  // and '42' yields a number -- both reach the tool runner as `args`.
  const cases = [
    { label: 'json array string', call: { name: 'a', args: '[1,2,3]' } },
    { label: 'json scalar string', call: { name: 'a', args: '42' } },
    { label: 'json string string', call: { name: 'a', args: '"hello"' } },
    { label: 'json null string', call: { name: 'a', args: 'null' } },
    { label: 'array object', call: { name: 'a', args: [1, 2, 3] } },
    { label: 'unparseable string', call: { name: 'a', args: 'not json' } },
    { label: 'missing', call: { name: 'a' } },
  ];
  const bad = [];
  for (const { label, call } of cases) {
    const [out] = schemas.normalizeToolCalls([call]);
    const args = out && out.args;
    const isPlainObject = args !== null && typeof args === 'object' && !Array.isArray(args);
    if (!isPlainObject) bad.push(`${label}: args=${JSON.stringify(args)} (${Array.isArray(args) ? 'array' : typeof args})`);
  }
  assert.deepEqual(bad, [], `tool args were not a plain object:\n  ${bad.join('\n  ')}`);
});

test('provider tool definitions keep name, description and schema intact', () => {
  const tools = [{ name: 'search', description: 'Find notes', inputSchema: { type: 'object', properties: {} } }];
  const openai = schemas.openAiToolDefinitions(tools);
  assert.equal(openai[0].function.name, 'search');
  assert.deepEqual(openai[0].function.parameters, tools[0].inputSchema);
  const anthropic = schemas.anthropicToolDefinitions(tools);
  assert.equal(anthropic[0].name, 'search');
  assert.deepEqual(anthropic[0].input_schema, tools[0].inputSchema);
  const gemini = schemas.geminiToolDefinitions(tools);
  assert.equal(gemini[0].functionDeclarations[0].name, 'search');
  assert.deepEqual(gemini[0].functionDeclarations[0].parameters, tools[0].inputSchema);
});
