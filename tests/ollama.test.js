const assert = require('node:assert/strict');
const test = require('node:test');

test('Ollama chat stream ignores malformed chunks and keeps valid tokens', async () => {
  const ollama = require('../lib/ollama');
  const originalFetch = global.fetch;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('{"message":{"content":"Hel"}}\n'));
      controller.enqueue(enc.encode('{bad json}\n'));
      controller.enqueue(enc.encode('{"message":{"content":"lo"}}\n'));
      controller.close();
    },
  });
  global.fetch = async () => ({ ok: true, body: stream });
  try {
    const chunks = [];
    const result = await ollama.chatStream('model', [{ role: 'user', content: 'hi' }], {
      onToken: token => chunks.push(token),
    });
    assert.equal(result.text, 'Hello');
    assert.deepEqual(chunks, ['Hel', 'lo']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Ollama chat stream surfaces provider error chunks', async () => {
  const ollama = require('../lib/ollama');
  const originalFetch = global.fetch;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"error":"model failed"}\n'));
      controller.close();
    },
  });
  global.fetch = async () => ({ ok: true, body: stream });
  try {
    await assert.rejects(
      () => ollama.chatStream('model', [{ role: 'user', content: 'hi' }]),
      /model failed/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('Ask AI returns setup guidance with note snippets when Ollama is unavailable', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  const storeApi = {
    async loadVault() {
      return {
        notes: [
          {
            id: 'n1',
            title: 'Certification notes',
            body: 'Microsoft certification should not fail when local AI setup is incomplete.',
            modifiedAt: '2026-05-10T00:00:00.000Z',
          },
        ],
      };
    },
  };
  try {
    const result = await ai.ask('vault', 'What about certification?', storeApi);
    assert.equal(result.ok, true);
    assert.equal(result.setupRequired, true);
    assert.match(result.answer, /Local chat model|Ollama not reachable/);
    assert.match(result.answer, /Certification notes/);
    assert.equal(result.sources.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Broad all-notes summaries use bounded context without recursive planner calls', async () => {
  const ai = require('../lib/ai');
  const notes = Array.from({ length: 30 }, (_, index) => ({
    id: `n${index}`,
    title: `Project note ${index}`,
    body: `Decision ${index}\n`.repeat(120),
    modifiedAt: new Date(Date.UTC(2026, 4, 1, 0, index)).toISOString(),
  }));
  const storeApi = {
    async loadVault() {
      return { notes };
    },
  };
  const context = await ai.buildVaultContext(
    'vault',
    'can you summarise all my notes',
    { embedModelOk: false },
    storeApi,
    {
      recursiveResearch: true,
      planNoteResearch: async () => {
        throw new Error('recursive planner should not run for broad summaries');
      },
    }
  );
  assert.equal(context.mode, 'broad-summary');
  assert.equal(context.totalNotes, 30);
  assert.ok(context.notes.length > 0);
  assert.equal(context.researchToolCalls || 0, 0);
});

test('Vault summaries use bounded map-reduce model calls', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, init = {}) => {
    calls++;
    const body = JSON.parse(init.body || '{}');
    const text = JSON.stringify(body).includes('Combine these batch summaries')
      ? 'Combined final summary with decisions and tasks.'
      : `Batch summary ${calls}.`;
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: text } }] };
      },
    };
  };
  ai.setConfig({
    provider: 'openai',
    openaiApiKey: 'test-key',
    chatModel: 'test-model',
    enabled: true,
  }, { rejectUnknown: false });
  const notes = Array.from({ length: 5 }, (_, index) => ({
    id: `n${index}`,
    title: `Note ${index}`,
    body: `# Heading ${index}\n- [ ] Task ${index}\nDecision ${index}`,
    tags: ['project'],
    modifiedAt: new Date(Date.UTC(2026, 4, 1, 0, index)).toISOString(),
  }));
  const storeApi = {
    async loadVault() {
      return { notes };
    },
  };
  try {
    const result = await ai.summarizeVault('vault', 'summarise all my notes', storeApi, { batchMaxNotes: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'map-reduce-summary');
    assert.equal(result.batches, 3);
    assert.equal(calls, 4);
    assert.match(result.answer, /Combined final summary/);
    assert.equal(result.sources.length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Chat returns setup guidance instead of failing when Ollama is unavailable', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  try {
    const result = await ai.chat({ text: 'write a short poem' });
    assert.equal(result.ok, true);
    assert.equal(result.setupRequired, true);
    assert.match(result.answer, /enable generated chat responses/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Simple greetings are answered locally without waiting for the model', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('status should not be called'); };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  try {
    const chunks = [];
    const result = await ai.chatStream({ text: 'HELLO', onToken: token => chunks.push(token) });
    assert.equal(result.ok, true);
    assert.equal(result.fast, true);
    assert.match(result.answer, /Ask me about your notes/);
    assert.deepEqual(chunks, [result.answer]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('AI edit setup failures are not returned as replacement text', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  try {
    const result = await ai.editText({ text: 'Keep this text', instruction: 'Improve it' });
    assert.equal(result.ok, false);
    assert.equal(result.setupRequired, true);
    assert.equal(result.text, undefined);
    assert.match(result.error, /Ollama not reachable|Local chat model/i);

    const chunks = [];
    const streamed = await ai.editTextStream({
      text: 'Keep this text',
      instruction: 'Improve it',
      onToken: token => chunks.push(token),
    });
    assert.equal(streamed.ok, false);
    assert.equal(streamed.setupRequired, true);
    assert.deepEqual(chunks, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Hosted provider chat stream emits incremental restored tokens', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  const originalFetch = global.fetch;
  let capturedBody = null;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Send to [EMAIL_"}}]}\n\n'));
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"1] now"}}]}\n\n'));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  global.fetch = async (_url, init = {}) => {
    capturedBody = JSON.parse(init.body || '{}');
    return { ok: true, body: stream };
  };
  ai.setConfig({
    provider: 'openai',
    openaiApiKey: 'test-key',
    chatModel: 'test-model',
    enabled: true,
    piiReduction: true,
  }, { rejectUnknown: false });
  try {
    const chunks = [];
    const result = await ai.__test.providerChatStream(
      [{ role: 'user', content: 'Email jane.doe@example.com' }],
      { onToken: token => chunks.push(token) }
    );
    assert.match(JSON.stringify(capturedBody.messages), /\[EMAIL_1\]/);
    assert.doesNotMatch(JSON.stringify(capturedBody.messages), /jane\.doe@example\.com/);
    assert.equal(chunks.join(''), 'Send to jane.doe@example.com now');
    assert.equal(result.text, 'Send to jane.doe@example.com now');
  } finally {
    global.fetch = originalFetch;
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('Hosted provider tool planner sends native tool schemas and parses calls', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (_url, init = {}) => {
    capturedBody = JSON.parse(init.body || '{}');
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'tag-note',
                  arguments: JSON.stringify({ noteTitle: 'daily updates', tag: 'todos' }),
                },
              }],
            },
          }],
        };
      },
    };
  };
  ai.setConfig({
    provider: 'openai',
    openaiApiKey: 'test-key',
    chatModel: 'test-model',
    enabled: true,
  }, { rejectUnknown: false });
  try {
    const result = await ai.toolPlan({
      messages: [{ role: 'user', content: 'tag daily updates note to todos' }],
      tools: [{
        name: 'tag-note',
        title: 'Tag note',
        description: 'Apply a tag to a named note.',
        risk: 'safe',
        inputSchema: {
          type: 'object',
          properties: {
            noteTitle: { type: 'string' },
            tag: { type: 'string' },
          },
          required: ['tag'],
          additionalProperties: false,
        },
      }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.native, true);
    assert.equal(result.toolCalls[0].name, 'tag-note');
    assert.deepEqual(result.toolCalls[0].args, { noteTitle: 'daily updates', tag: 'todos' });
    assert.match(capturedBody.messages[0].content, /draft concise Markdown content/);
    assert.equal(capturedBody.tools[0].type, 'function');
    assert.equal(capturedBody.tools[0].function.name, 'tag-note');
    assert.equal(capturedBody.tool_choice, 'auto');
  } finally {
    global.fetch = originalFetch;
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});
