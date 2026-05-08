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
