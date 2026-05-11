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

test('Chat returns setup guidance instead of failing when Ollama is unavailable', async () => {
  const ai = require('../lib/ai');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  ai.setConfig({ provider: 'ollama', chatModel: 'gemma3', enabled: true }, { rejectUnknown: false });
  try {
    const result = await ai.chat({ text: 'hello' });
    assert.equal(result.ok, true);
    assert.equal(result.setupRequired, true);
    assert.match(result.answer, /enable generated chat responses/i);
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
