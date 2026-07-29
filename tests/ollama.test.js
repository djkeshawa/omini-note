const assert = require('node:assert/strict');
const test = require('node:test');

const providerTransport = require('../lib/integrations/ai/providerTransport');

function streamFromText(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(String(text || '')));
      controller.close();
    },
  });
}

function installHostedFetchMock(handler) {
  return providerTransport.setTransportDependenciesForTests({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request(options, onResponse) {
      let requestBody = '';
      let onError = () => {};
      return {
        once(event, listener) {
          if (event === 'error') onError = listener;
          return this;
        },
        write(chunk) {
          requestBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        },
        end() {
          const port = options.port && Number(options.port) !== 443 ? `:${options.port}` : '';
          const url = `https://${options.hostname}${port}${options.path || '/'}`;
          Promise.resolve(handler(url, {
            method: options.method,
            headers: options.headers,
            body: requestBody,
            signal: options.signal,
          })).then(async mocked => {
            let body = mocked?.body;
            if (!body?.getReader) {
              const text = typeof mocked?.text === 'function'
                ? await mocked.text()
                : typeof mocked?.json === 'function'
                  ? JSON.stringify(await mocked.json())
                  : '';
              body = streamFromText(text);
            }
            onResponse({
              body,
              headers: mocked?.headers || {},
              statusCode: mocked?.status ?? (mocked?.ok === false ? 500 : 200),
              statusMessage: mocked?.statusText || '',
              resume() {
                body.cancel?.().catch?.(() => {});
              },
            });
          }).catch(onError);
        },
        destroy() {},
      };
    },
  });
}

test('AI runtime stays disabled until preferences explicitly enable it', () => {
  const ai = require('../lib/ai');
  assert.equal(ai.getConfig().enabled, false);
});

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

test('AI status explains fresh local setup when Ollama is unavailable', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', embedModel: 'nomic-embed-text', enabled: true }, { rejectUnknown: false });
  try {
    const result = await ai.status({ force: true });
    assert.equal(result.reachable, false);
    assert.equal(result.setupRequired, true);
    assert.match(result.reason, /Ollama not reachable/);
    assert.ok(result.setupSteps.some(step => /Install Ollama/.test(step)));
    assert.ok(result.setupSteps.some(step => /ollama serve/.test(step)));
    assert.ok(result.setupSteps.some(step => /ollama pull gemma3/.test(step)));
    assert.match(result.setupMessage, /To use AI features/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('disabling AI clears queued embeddings without throwing', () => {
  const ai = require('../lib/ai');
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  ai.scheduleEmbed('test-vault', { id: 'queued-note', title: 'Queued note', body: 'Pending embedding work.' });

  assert.doesNotThrow(() => {
    ai.setConfig({ enabled: false }, { rejectUnknown: false });
  });
  assert.equal(ai.getConfig().enabled, false);

  ai.setConfig({ enabled: true }, { rejectUnknown: false });
});

test('AI status explains cloud provider setup when API key is missing', async () => {
  const ai = require('../lib/ai');
  ai.setConfig({
    provider: 'openai',
    openaiApiKey: '',
    chatModel: 'gpt-4o-mini',
    enabled: true,
  }, { rejectUnknown: false });
  const result = await ai.status({ force: true });
  assert.equal(result.reachable, false);
  assert.equal(result.setupRequired, true);
  assert.match(result.reason, /OpenAI API key is missing/);
  assert.ok(result.setupSteps.some(step => /API key for OpenAI/.test(step)));
  assert.ok(result.setupSteps.some(step => /Settings > AI/.test(step)));
  assert.match(result.setupMessage, /To use AI features/);
});

test('AI status verifies OpenRouter credentials before reporting ready', async () => {
  const ai = require('../lib/ai');
  const calls = [];
  const restoreTransport = installHostedFetchMock(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { data: { total_credits: 10, total_usage: 1 } };
      },
      async text() {
        return JSON.stringify({ data: { total_credits: 10, total_usage: 1 } });
      },
    };
  });
  ai.setConfig({
    provider: 'openrouter',
    openrouterApiKey: 'sk-or-v1-test',
    chatModel: 'openai/gpt-4o-mini',
    enabled: true,
  }, { rejectUnknown: false });
  try {
    const result = await ai.status({ force: true });
    assert.equal(result.providerReady, true);
    assert.equal(result.chatModelOk, true);
    assert.equal(result.reason, 'OpenRouter is configured');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/credits');
    assert.equal(calls[0].init.headers.authorization, 'Bearer sk-or-v1-test');
  } finally {
    restoreTransport();
  }
});

test('AI status rejects OpenRouter configuration when API returns 401', async () => {
  const ai = require('../lib/ai');
  const restoreTransport = installHostedFetchMock(async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    async json() {
      return { error: { message: 'User not found.', code: 401 } };
    },
    async text() {
      return JSON.stringify({ error: { message: 'User not found.', code: 401 } });
    },
  }));
  ai.setConfig({
    provider: 'openrouter',
    openrouterApiKey: 'sk-or-v1-bad',
    chatModel: 'openai/gpt-4o-mini',
    enabled: true,
  }, { rejectUnknown: false });
  try {
    const result = await ai.status({ force: true });
    assert.equal(result.providerReady, false);
    assert.equal(result.chatModelOk, false);
    assert.equal(result.setupRequired, true);
    assert.match(result.reason, /OpenRouter API key was rejected/);
    assert.match(result.setupMessage, /Replace it in Settings > AI/);
    assert.equal(result.config.openrouterApiKey, 'configured');
  } finally {
    restoreTransport();
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

test('Latest-note questions use recent context instead of whole-vault summary context', async () => {
  const ai = require('../lib/ai');
  const notes = [
    {
      id: 'older',
      title: 'Older note',
      body: 'Older body',
      modifiedAt: '2026-05-01T09:00:00.000Z',
    },
    {
      id: 'latest',
      title: 'Latest note',
      body: 'Latest body',
      modifiedAt: '2026-05-02T09:00:00.000Z',
    },
  ];
  const storeApi = {
    async loadVault() {
      return { notes };
    },
  };
  const context = await ai.buildVaultContext(
    'vault',
    'what is my latest note?',
    { embedModelOk: false },
    storeApi
  );
  assert.equal(context.mode, 'recent');
  assert.equal(context.notes[0].id, 'latest');
  assert.match(context.reason, /context item 1 is the latest saved note/);
});

test('Vault summaries use bounded map-reduce model calls', async () => {
  const ai = require('../lib/ai');
  let calls = 0;
  const restoreTransport = installHostedFetchMock(async (_url, init = {}) => {
    calls++;
    const body = JSON.parse(init.body || '{}');
    const text = JSON.stringify(body).includes('Combine these batch summaries')
      ? '## Summary of All Notes\n\nCombined final summary with decisions and tasks.'
      : `Batch summary ${calls}.`;
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: text } }] };
      },
    };
  });
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
    assert.match(result.answer, /^# Notes summary/);
    assert.doesNotMatch(result.answer, /## Summary(\s|$)/);
    assert.doesNotMatch(result.answer, /Summary of All Notes/);
    assert.equal(result.sources.length, 5);
  } finally {
    restoreTransport();
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

test('Chat uses the resolved Ollama model tag from status', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  let chatModel = '';
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/api/tags') {
      return {
        ok: true,
        async json() {
          return { models: [{ name: 'gemma3:4b' }] };
        },
      };
    }
    if (parsed.pathname === '/api/chat') {
      const body = JSON.parse(init.body || '{}');
      chatModel = body.model;
      return {
        ok: true,
        async json() {
          return { message: { content: 'resolved model ok' } };
        },
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  try {
    const result = await ai.chat({ text: 'write a short summary' });
    assert.equal(result.ok, true);
    assert.equal(result.answer, 'resolved model ok');
    assert.equal(chatModel, 'gemma3:4b');
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

test('Assistant self-description is answered as chat without waiting for the model', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('status should not be called'); };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  try {
    const chunks = [];
    const result = await ai.chatStream({ text: 'describe yourself', onToken: token => chunks.push(token) });
    assert.equal(result.ok, true);
    assert.equal(result.fast, true);
    assert.match(result.answer, /VispNote's AI assistant/);
    assert.deepEqual(chunks, [result.answer]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Tool planner reports invalid planner output without user-facing fallback text', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  const originalConfig = ai.getConfig();
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/api/chat') {
      return {
        ok: true,
        async json() {
          return { message: { content: 'not json' } };
        },
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  try {
    const result = await ai.__test.providerToolPlan(
      [{ role: 'user', content: 'tag this note as reading' }],
      [{
        name: 'tag-note',
        description: 'Tag a note.',
        inputSchema: {
          type: 'object',
          properties: { tag: { type: 'string' } },
          required: ['tag'],
          additionalProperties: false,
        },
      }]
    );
    assert.equal(result.mode, 'planner_failed');
    assert.equal(result.answer, '');
    assert.match(result.error, /valid JSON/);
  } finally {
    global.fetch = originalFetch;
    ai.setConfig(originalConfig, { rejectUnknown: false });
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
  const restoreTransport = installHostedFetchMock(async (_url, init = {}) => {
    capturedBody = JSON.parse(init.body || '{}');
    return { ok: true, body: stream };
  });
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
    restoreTransport();
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('Hosted provider chat stream cancels open response body after done marker', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Done"}}]}\n\n'));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const restoreTransport = installHostedFetchMock(async () => ({ ok: true, body: stream }));
  ai.setConfig({
    provider: 'openai',
    openaiApiKey: 'test-key',
    chatModel: 'test-model',
    enabled: true,
    piiReduction: false,
  }, { rejectUnknown: false });
  try {
    const result = await ai.__test.providerChatStream(
      [{ role: 'user', content: 'finish' }],
      { onToken() {} }
    );
    assert.equal(result.text, 'Done');
    assert.equal(cancelled, true);
  } finally {
    restoreTransport();
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('Hosted provider chat stream ignores malformed events between valid tokens', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Before "}}]}\n\n'));
      controller.enqueue(enc.encode('data: {bad json}\n\n'));
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"after"}}]}\n\n'));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  const restoreTransport = installHostedFetchMock(async () => ({ ok: true, body: stream }));
  ai.setConfig({ provider: 'openai', openaiApiKey: 'test-key', chatModel: 'test-model', enabled: true, piiReduction: false }, { rejectUnknown: false });
  try {
    const chunks = [];
    const result = await ai.__test.providerChatStream([{ role: 'user', content: 'continue' }], { onToken: token => chunks.push(token) });
    assert.equal(chunks.join(''), 'Before after');
    assert.equal(result.text, 'Before after');
  } finally {
    restoreTransport();
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('Hosted provider chat stream falls back when the stream has no usable text', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  let callCount = 0;
  const restoreTransport = installHostedFetchMock(async () => {
    callCount++;
    if (callCount === 1) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: ping\n\n'));
          controller.close();
        },
      });
      return { ok: true, body: stream };
    }
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Recovered answer' } }] };
      },
    };
  });
  ai.setConfig({ provider: 'openai', openaiApiKey: 'test-key', chatModel: 'test-model', enabled: true, piiReduction: false }, { rejectUnknown: false });
  try {
    const chunks = [];
    const result = await ai.__test.providerChatStream([{ role: 'user', content: 'recover' }], { onToken: token => chunks.push(token) });
    assert.equal(callCount, 2);
    assert.equal(chunks.join(''), 'Recovered answer');
    assert.equal(result.text, 'Recovered answer');
  } finally {
    restoreTransport();
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('Hosted provider tool planner sends native tool schemas and parses calls', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  let capturedBody = null;
  const restoreTransport = installHostedFetchMock(async (_url, init = {}) => {
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
  });
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
    restoreTransport();
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});
