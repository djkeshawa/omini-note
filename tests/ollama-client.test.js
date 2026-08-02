const test = require('node:test');
const assert = require('node:assert/strict');

const ollama = require('../lib/ollama.js');

// The local Ollama client. Behaviours: requests only ever go to localhost on
// the allowed ports, streaming assembles tokens in order and survives
// malformed chunks, an HTTP error carries the server's own message, and a
// transient failure is retried exactly once.

const realFetch = globalThis.fetch;
function fakeFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return impl(calls.length, url, init); };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}
const jsonResponse = data => ({
  ok: true, status: 200, statusText: 'OK',
  json: async () => data, text: async () => JSON.stringify(data),
});

test.afterEach(() => { globalThis.fetch = realFetch; ollama.setHost(''); });

test('requests refuse to leave localhost', async () => {
  const { calls, restore } = fakeFetch(() => jsonResponse({}));
  try {
    for (const host of ['http://evil.example.com:11434', 'http://192.168.0.9:11434', 'https://127.0.0.1:11434', 'http://127.0.0.1:9999']) {
      ollama.setHost(host);
      await assert.rejects(() => ollama.tags(), /local and use port/, `${host} was contacted`);
    }
    assert.equal(calls.length, 0, 'a request was actually sent to a refused host');
    ollama.setHost('http://127.0.0.1:11434');
    await ollama.tags();
    assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:11434\/api\/tags$/);
  } finally { restore(); }
});

test('chat parses the reply and an HTTP error carries the server message', async () => {
  const good = fakeFetch(() => jsonResponse({ message: { content: 'hello back' } }));
  try {
    const result = await ollama.chat('m', [{ role: 'user', content: 'hi' }]);
    assert.equal(result.text, 'hello back');
    const body = JSON.parse(good.calls[0].init.body);
    assert.equal(body.stream, false);
    assert.equal(body.model, 'm');
  } finally { good.restore(); }

  const bad = fakeFetch(() => ({
    ok: false, status: 404, statusText: 'Not Found',
    text: async () => 'model "m" not found, try pulling it first',
  }));
  try {
    await assert.rejects(() => ollama.chat('m', []), /404.*model "m" not found/s,
      'the server explanation must reach the user, not just a status code');
  } finally { bad.restore(); }
});

test('embeddings validate the response shape', async () => {
  const good = fakeFetch(() => jsonResponse({ embedding: [0.25, 0.5] }));
  try {
    const vec = await ollama.embed('em', 'text');
    assert.ok(vec instanceof Float32Array);
    assert.equal(vec.length, 2);
  } finally { good.restore(); }
  const junk = fakeFetch(() => jsonResponse({ nope: true }));
  try {
    await assert.rejects(() => ollama.embed('em', 'text'), /unexpected response shape/,
      'a malformed embedding must not flow into the vector index');
  } finally { junk.restore(); }
});

test('a transient failure is retried exactly once', async () => {
  const flaky = fakeFetch(n => {
    if (n === 1) throw new Error('ECONNREFUSED');
    return jsonResponse({ models: [{ name: 'm1' }] });
  });
  try {
    const models = await ollama.tags();
    assert.deepEqual(models, [{ name: 'm1' }]);
    assert.equal(flaky.calls.length, 2, 'the first failure should be retried once');
  } finally { flaky.restore(); }
  const dead = fakeFetch(() => { throw new Error('ECONNREFUSED'); });
  try {
    await assert.rejects(() => ollama.tags(), /ECONNREFUSED/);
    assert.equal(dead.calls.length, 2, 'a persistent failure must not retry forever');
  } finally { dead.restore(); }
});

test('ping answers true or false and never throws', async () => {
  const up = fakeFetch(() => jsonResponse({}));
  try { assert.equal(await ollama.ping(), true); } finally { up.restore(); }
  const down = fakeFetch(() => { throw new Error('ECONNREFUSED'); });
  try { assert.equal(await ollama.ping(), false); } finally { down.restore(); }
});

test('streaming assembles tokens in order and skips malformed chunks', async () => {
  const chunks = [
    JSON.stringify({ message: { content: 'Hel' } }) + '\n',
    'this line is not json\n' + JSON.stringify({ message: { content: 'lo ' } }) + '\n',
    JSON.stringify({ message: { content: 'world' } }) + '\n' + JSON.stringify({ done: true }) + '\n',
  ];
  const encoder = new TextEncoder();
  const stream = fakeFetch(() => ({
    ok: true, status: 200, statusText: 'OK',
    body: {
      getReader: () => {
        let i = 0;
        return {
          read: async () => i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
          releaseLock: () => {},
          cancel: async () => {},
        };
      },
    },
  }));
  try {
    const tokens = [];
    const result = await ollama.chatStream('m', [{ role: 'user', content: 'hi' }], { onToken: t => tokens.push(t) });
    assert.equal(result.text, 'Hello world', 'the assembled text must be in order and complete');
    assert.deepEqual(tokens, ['Hel', 'lo ', 'world'], 'each token should be emitted as it arrives');
  } finally { stream.restore(); }
});

test('a streaming response with no body falls back to a plain chat', async () => {
  const noBody = fakeFetch((n) => n === 1
    ? { ok: true, status: 200, statusText: 'OK', body: null }
    : jsonResponse({ message: { content: 'fallback reply' } }));
  try {
    const result = await ollama.chatStream('m', [], {});
    assert.equal(result.text, 'fallback reply');
    assert.equal(noBody.calls.length, 2, 'the client should have retried without streaming');
  } finally { noBody.restore(); }
});
