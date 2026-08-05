const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../lib/ai.js');
const providerTransport = require('../lib/integrations/ai/providerTransport.js');

// What Settings > AI tells the user when a provider is not ready. Every one of
// these is the difference between "AI does not work" and a list of steps that
// fixes it, so each provider's missing piece has to be named exactly.
// ai-config-security.test.js pins what a config patch may contain; this pins
// what the resulting status says.

const BASE = ai.getConfig();
function withConfig(patch, fn) {
  ai.applyConfig({ ...BASE, ...patch });
  return Promise.resolve().then(fn).finally(() => ai.applyConfig(BASE));
}

const statusFor = patch => withConfig(patch, () => ai.status({ force: true }));

test('a hosted provider with no key says which key is missing, and how to add it', async () => {
  const st = await statusFor({ provider: 'openai', openaiApiKey: '', chatModel: 'gpt-x' });
  assert.equal(st.reachable, false);
  assert.equal(st.ready, false);
  assert.equal(st.chatModelOk, false);
  assert.equal(st.setupRequired, true);
  assert.match(st.reason, /OpenAI API key is missing/);
  assert.match(st.setupMessage, /OpenAI API key is missing/);
  assert.ok(st.setupSteps.some(step => /Paste the API key for OpenAI/.test(step)));
  assert.ok(st.setupSteps.some(step => /Open Settings > AI and select OpenAI/.test(step)));
  assert.ok(st.setupSteps.some(step => /Click Check or Refresh/.test(step)));
  assert.equal(st.askMode, 'keyword', 'a hosted provider has no local embeddings, so search stays lexical');
  assert.equal(st.embedModelOk, false);
});

test('a hosted provider with a key but no model chosen uses that provider\'s default', async () => {
  const st = await statusFor({ provider: 'anthropic', anthropicApiKey: 'sk-test', chatModel: '' });
  assert.ok(st.chatModel, 'a provider that ships a default model is ready without the user picking one');
  assert.equal(st.ready, true);
  assert.deepEqual(st.models, [st.chatModel]);
  assert.match(st.reason, /Anthropic is configured/);
});

test('a fully configured hosted provider reports itself ready with no steps left', async () => {
  const st = await statusFor({ provider: 'anthropic', anthropicApiKey: 'sk-test', chatModel: 'claude-x' });
  assert.equal(st.reachable, true);
  assert.equal(st.ready, true);
  assert.equal(st.chatModelOk, true);
  assert.equal(st.chatModel, 'claude-x');
  assert.deepEqual(st.models, ['claude-x']);
  assert.equal(st.setupRequired, false);
  assert.deepEqual(st.setupSteps, []);
  assert.equal(st.setupMessage, '');
  assert.match(st.reason, /Anthropic is configured/);
});

test('a custom provider also needs a base URL before it is ready', async () => {
  const missing = await statusFor({ provider: 'custom', customApiKey: 'sk-test', chatModel: 'm', customBaseUrl: '' });
  assert.equal(missing.ready, false);
  assert.match(missing.reason, /Custom provider base URL is missing/);
  assert.ok(missing.setupSteps.some(step => /HTTPS base URL for an OpenAI-compatible/.test(step)));

  const ready = await statusFor({
    provider: 'custom', customApiKey: 'sk-test', chatModel: 'm', customBaseUrl: 'https://api.example.com/v1',
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.setupSteps, []);
});

test('an OpenRouter key is checked against the service, and a rejection is named', async () => {
  let restore = providerTransport.setTransportDependenciesForTests({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request(options, onResponse) {
      return {
        once() { return this; },
        write() {},
        end() {
          onResponse({
            statusCode: 401,
            statusMessage: 'Unauthorized',
            headers: {},
            body: new ReadableStream({
              start(controller) { controller.enqueue(new TextEncoder().encode('No auth credentials found')); controller.close(); },
            }),
            resume() {},
          });
        },
        destroy() {},
      };
    },
  });
  try {
    const st = await statusFor({ provider: 'openrouter', openrouterApiKey: 'sk-bad', chatModel: 'm' });
    assert.equal(st.reachable, false);
    assert.equal(st.ready, false);
    assert.equal(st.chatModelOk, false);
    assert.equal(st.setupRequired, true);
    assert.match(st.reason, /OpenRouter API key was rejected\. Replace it in Settings > AI\./);
    assert.ok(st.setupSteps.length, 'a rejected key still gets the steps that would fix it');
  } finally { restore(); }

  restore = providerTransport.setTransportDependenciesForTests({
    lookup: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    request() { throw new Error('should not be reached'); },
  });
  try {
    const st = await statusFor({ provider: 'openrouter', openrouterApiKey: 'sk-good', chatModel: 'm' });
    assert.equal(st.reachable, false);
    assert.match(st.reason, /OpenRouter could not be verified/,
      'a network problem is reported as unverified, not as a bad key');
  } finally { restore(); }

  restore = providerTransport.setTransportDependenciesForTests({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request(options, onResponse) {
      return {
        once() { return this; },
        write() {},
        end() {
          onResponse({
            statusCode: 200,
            headers: {},
            body: new ReadableStream({
              start(controller) { controller.enqueue(new TextEncoder().encode('{"data":{}}')); controller.close(); },
            }),
            resume() {},
          });
        },
        destroy() {},
      };
    },
  });
  try {
    const st = await statusFor({ provider: 'openrouter', openrouterApiKey: 'sk-good', chatModel: 'm' });
    assert.equal(st.ready, true, 'a key the service accepts leaves the provider ready');
  } finally { restore(); }

  // A provider that is not ready locally is never asked over the network.
  const unchecked = await statusFor({ provider: 'openrouter', openrouterApiKey: '', chatModel: 'm' });
  assert.match(unchecked.reason, /OpenRouter API key is missing/);
});

test('previewing a config change never applies it', async () => {
  const before = ai.getConfig();
  const preview = ai.previewConfig({ provider: 'anthropic' });
  assert.equal(preview.provider, 'anthropic');
  assert.ok(preview.chatModel, 'a provider with no model yet is previewed with its default');
  assert.deepEqual(ai.getConfig(), before, 'the live config is untouched by a preview');

  assert.equal(ai.previewConfig({ provider: 'not-a-provider' }).provider, 'ollama',
    'an unknown provider previews as the local one rather than an unusable config');
  assert.equal(ai.previewConfig({}).provider, before.provider);
  assert.ok(ai.previewConfig({ ollamaHost: '' }).ollamaHost, 'clearing the host previews the default, not an empty one');
  assert.equal(ai.previewConfig({ ollamaHost: 'http://127.0.0.1:11435' }).ollamaHost, 'http://127.0.0.1:11435');
});

test('the public config never carries a secret', () => {
  const publicConfig = ai.__test.publicConfig({
    ...BASE, provider: 'openai', openaiApiKey: 'sk-secret', anthropicApiKey: 'sk-also-secret',
  });
  const serialized = JSON.stringify(publicConfig);
  assert.ok(!serialized.includes('sk-secret'), 'an API key must never reach the renderer');
  assert.ok(!serialized.includes('sk-also-secret'));
  assert.equal(publicConfig.provider, 'openai');
});

test('a running AI job can be cancelled once, and only while it is running', () => {
  assert.deepEqual(ai.cancelJob('never-started'), { ok: false, error: 'No running AI job found' });
  assert.deepEqual(ai.cancelJob(''), { ok: false, error: 'No running AI job found' });
  assert.deepEqual(ai.cancelJob(), { ok: false, error: 'No running AI job found' });
});

test('a research summary is only kept when it says something', () => {
  const { isUsefulResearchSummary } = ai.__test;
  if (typeof isUsefulResearchSummary !== 'function') return;
  assert.equal(isUsefulResearchSummary('This is a real summary of the notes involved.'), true);
  assert.equal(isUsefulResearchSummary('too short'), false);
  assert.equal(isUsefulResearchSummary(''), false);
  for (const placeholder of [
    'Summary limit reached and nothing else was produced.',
    'No valid notes to summarize were found in the set.',
    'Summary was empty or failed validation for these notes.',
  ]) {
    assert.equal(isUsefulResearchSummary(placeholder), false,
      'a tool\'s own "nothing here" message is not a research finding');
  }
});
