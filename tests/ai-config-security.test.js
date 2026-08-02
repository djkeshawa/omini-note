const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../lib/ai.js');
const guards = ai.__test;

// The AI config is the one place the renderer can point the main process at a
// network endpoint or hand it a secret. These are the security behaviours:
// hosted provider URLs cannot be aimed at private hosts (SSRF), the local
// Ollama host cannot be aimed anywhere but localhost, secrets never leave via
// publicConfig, and the Ollama child process inherits an allowlisted
// environment rather than the whole one.

test('hosted provider URLs cannot target local or private hosts', () => {
  // A renderer compromise that pointed openaiBaseUrl at the cloud metadata
  // endpoint would exfiltrate credentials with the app's own fetch.
  for (const url of [
    'https://127.0.0.1/steal', 'https://localhost/x', 'https://10.0.0.5/api',
    'https://192.168.1.1/api', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x',
  ]) {
    assert.throws(() => guards.sanitizeConfigPatch({ openaiBaseUrl: url }),
      /cannot target local or private hosts/, `${url} was accepted`);
  }
  assert.throws(() => guards.sanitizeConfigPatch({ openaiBaseUrl: 'http://api.example.com/v1' }),
    /HTTPS/, 'a plaintext hosted endpoint was accepted');
  const ok = guards.sanitizeConfigPatch({ openaiBaseUrl: 'https://api.example.com/v1/' });
  assert.equal(ok.openaiBaseUrl, 'https://api.example.com/v1', 'a legitimate HTTPS endpoint should pass, normalised');
});

test('the Ollama host is locked to localhost and its port range', () => {
  for (const url of [
    'http://evil.example.com:11434', 'http://192.168.1.20:11434',
    'http://127.0.0.1:8080', 'https://127.0.0.1:11434',
  ]) {
    assert.throws(() => guards.sanitizeConfigPatch({ ollamaHost: url }),
      /local and use port/, `${url} was accepted as an Ollama host`);
  }
  const ok = guards.sanitizeConfigPatch({ ollamaHost: 'http://127.0.0.1:11435' });
  assert.equal(ok.ollamaHost, 'http://127.0.0.1:11435');
});

test('junk protocols and malformed URLs are refused', () => {
  for (const url of ['file:///etc/passwd', 'ftp://x.example.com', 'not a url', 'javascript:alert(1)']) {
    assert.throws(() => guards.sanitizeConfigPatch({ openaiBaseUrl: url }), /Invalid/,
      `${url} slipped through`);
  }
  assert.equal(guards.sanitizeConfigPatch({ openaiBaseUrl: '' }).openaiBaseUrl, '',
    'clearing an endpoint must remain possible');
});

test('unknown config fields are rejected and unknown providers fall back safely', () => {
  assert.throws(() => guards.sanitizeConfigPatch({ notAField: 1 }), /Unsupported AI config field/);
  assert.throws(() => guards.sanitizeConfigPatch(null), /Invalid AI config patch/);
  assert.throws(() => guards.sanitizeConfigPatch([]), /Invalid AI config patch/);
  assert.equal(guards.sanitizeConfigPatch({ provider: 'evil-provider' }).provider, 'ollama',
    'an unknown provider must fall back to local, never to a hosted default');
});

test('secrets are stripped of control characters and never echoed by publicConfig', () => {
  const cleaned = guards.sanitizeConfigPatch({ openaiApiKey: '  sk-abc\x00\x1fdef  ' });
  assert.equal(cleaned.openaiApiKey, 'sk-abcdef');
  const shown = guards.publicConfig({ provider: 'openai', openaiApiKey: 'sk-super-secret', enabled: true });
  assert.equal(shown.openaiApiKey, 'configured', 'the raw key must never cross to the renderer');
  const empty = guards.publicConfig({ provider: 'openai', openaiApiKey: '', enabled: true });
  assert.equal(empty.openaiApiKey, '', 'an unset key should read as unset, not as configured');
});

test('the Ollama child process gets an allowlisted environment', () => {
  process.env.MN_TEST_FAKE_SECRET = 'should-not-leak';
  try {
    const env = guards.ollamaServeEnv();
    assert.equal(env.MN_TEST_FAKE_SECRET, undefined,
      'arbitrary environment variables leak into the ollama child process');
    assert.ok(env.OLLAMA_HOST, 'the child needs to know which host to serve on');
    assert.match(env.OLLAMA_HOST, /^(127\.0\.0\.1|localhost|\[::1\]|::1):\d+$/,
      `OLLAMA_HOST escaped localhost: ${env.OLLAMA_HOST}`);
  } finally {
    delete process.env.MN_TEST_FAKE_SECRET;
  }
});

test('PII reduction replaces identifiers and restores them exactly', () => {
  const text = 'Mail alice@example.com or call +1 (555) 123-4567 today.';
  const { messages, replacements } = guards.reducePiiMessages([{ role: 'user', content: text }], true);
  const reduced = messages[0].content;
  assert.ok(!reduced.includes('alice@example.com'), 'the email survived reduction');
  assert.ok(replacements.length >= 1, 'no replacements were recorded');
  const restored = guards.restorePiiText(reduced, replacements);
  assert.equal(restored, text, 'the round trip did not restore the original text');
  // With reduction off, the text passes through untouched.
  const off = guards.reducePiiMessages([{ role: 'user', content: text }], false);
  assert.equal(off.messages[0].content, text);
  assert.equal(off.replacements.length, 0);
});

test('research planner JSON is parsed leniently but never invents calls', () => {
  const fenced = guards.parseResearchToolCalls('```json\n[{"tool":"search_notes","query":"x"}]\n```');
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].tool, 'search_notes');
  for (const junk of ['', 'no json here', '{"answer":"prose"}']) {
    const calls = guards.parseResearchToolCalls(junk);
    assert.ok(Array.isArray(calls) && calls.length === 0, `invented calls from ${JSON.stringify(junk)}`);
  }
});
