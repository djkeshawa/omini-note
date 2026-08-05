const test = require('node:test');
const assert = require('node:assert/strict');

const transport = require('../lib/integrations/ai/providerTransport.js');

// The hosted-provider transport is the only place VispNote opens a socket to
// somewhere the user typed. Everything here is a boundary: the URL guard that
// stops a "provider" pointing back at the machine, the DNS pin that stops a
// rebind between check and connect, the redirect rules, and the scrubber that
// keeps an API key out of an error message shown in the UI.

function streamFromText(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(String(text || '')));
      controller.close();
    },
  });
}

// A fake https.request that answers from `handler(url, init)`. Returning null
// means "never answer", which is how the idle timeout is exercised.
function installTransport(handler, lookup) {
  return transport.setTransportDependenciesForTests({
    lookup: lookup || (async () => [{ address: '93.184.216.34', family: 4 }]),
    request(options, onResponse) {
      let requestBody = '';
      let onError = () => {};
      // The real https.request aborts and emits 'error' when its signal fires;
      // without that a request nobody answers would hang instead of timing out.
      options.signal?.addEventListener?.('abort', () => {
        onError(options.signal.reason || new Error('aborted'));
      }, { once: true });
      return {
        once(event, listener) { if (event === 'error') onError = listener; return this; },
        write(chunk) { requestBody += String(chunk); },
        end() {
          const port = options.port && Number(options.port) !== 443 ? `:${options.port}` : '';
          const url = `https://${options.hostname}${port}${options.path || '/'}`;
          Promise.resolve(handler(url, { method: options.method, headers: options.headers, body: requestBody }))
            .then(mocked => {
              if (!mocked) return;
              onResponse({
                body: mocked.body || streamFromText(mocked.text ?? ''),
                headers: mocked.headers || {},
                statusCode: mocked.status ?? 200,
                statusMessage: mocked.statusText,
                resume() {},
              });
            })
            .catch(onError);
        },
        destroy() {},
      };
    },
  });
}

test('secrets are scrubbed out of anything that could be shown or logged', () => {
  assert.equal(transport.scrubSecretText('https://api.test/v1?key=sk-12345&model=x'),
    'https://api.test/v1?key=[redacted]&model=x');
  assert.equal(transport.scrubSecretText('GET /v1?api_key=abc'), 'GET /v1?api_key=[redacted]');
  assert.equal(transport.scrubSecretText('?access-token=abc'), '?access-token=[redacted]');
  assert.equal(transport.scrubSecretText('authorization: Bearer sk-abc123'), 'authorization: Bearer [redacted]');
  assert.equal(transport.scrubSecretText('x-api-key: sk-abc123'), 'x-api-key: [redacted]');
  assert.equal(transport.scrubSecretText('api-key: sk-abc123'), 'api-key: [redacted]');
  assert.equal(transport.scrubSecretText('{"api_key":"sk-abc123"}'), '{"api_key":"[redacted]"}');
  assert.equal(transport.scrubSecretText('{"authorization":"Bearer x"}'), '{"authorization":"[redacted]"}');
  assert.equal(transport.scrubSecretText('nothing secret here'), 'nothing secret here');
  assert.equal(transport.scrubSecretText(null), '');
});

test('every address that is not on the public internet is refused', () => {
  const nonGlobal = [
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.19.0.1',
    '198.51.100.1', '203.0.113.1', '100.64.0.1', '100.127.255.255', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:127.0.0.1',
    'fc00::1', 'fe80::1', '2001:db8::1', '2001::1', '2001:2::1', '2001:10::1', '2001:20::1',
    '2002:7f00:1::1', '3fff::1', 'not-an-ip',
  ];
  for (const address of nonGlobal) {
    assert.equal(transport.isNonGlobalIp(address), true, `${address} should not be reachable`);
  }
  for (const address of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2001:4860::1']) {
    assert.equal(transport.isNonGlobalIp(address), false, `${address} is an ordinary public address`);
  }
  assert.equal(transport.isNonGlobalIp('::ffff:8.8.8.8'), false, 'a mapped public address is still public');
});

test('a hostname that resolves to the machine is refused before any request', () => {
  for (const host of ['localhost', 'API.LOCALHOST', 'x.localhost', '', '127.0.0.1', '[::1]', '127.0.0.1.']) {
    assert.equal(transport.isUnsafeHostname(host), true, `${host} should be refused`);
  }
  // Wildcard DNS services encode an address in the name itself.
  for (const host of ['127.0.0.1.nip.io', '10-0-0-1.nip.io', 'app-192-168-1-1.sslip.io']) {
    assert.equal(transport.isUnsafeHostname(host), true, `${host} points back at a private address`);
  }
  assert.equal(transport.isUnsafeHostname('8.8.8.8.nip.io'), false, 'a wildcard name for a public address is fine');
  assert.equal(transport.isUnsafeHostname('999.1.1.1.nip.io'), false, 'a name that is not really an address is just a name');
  assert.equal(transport.isUnsafeHostname('api.openai.com'), false);
  assert.equal(transport.isUnsafeHostname('notlocalhost.com'), false);
});

test('a provider URL must be https, credential-free and public', () => {
  assert.equal(transport.assertSafeProviderUrl('https://api.openai.com/v1/chat').hostname, 'api.openai.com');
  assert.equal(transport.assertSafeProviderUrl(new URL('https://api.openai.com/v1')).protocol, 'https:');
  assert.throws(() => transport.assertSafeProviderUrl('not a url'), /Invalid hosted provider URL/);
  assert.throws(() => transport.assertSafeProviderUrl(''), /Invalid hosted provider URL/);
  assert.throws(() => transport.assertSafeProviderUrl('http://api.openai.com'), /must use HTTPS/);
  assert.throws(() => transport.assertSafeProviderUrl('https://user:pass@api.openai.com'), /cannot contain credentials/);
  assert.throws(() => transport.assertSafeProviderUrl('https://user@api.openai.com'), /cannot contain credentials/);
  assert.throws(() => transport.assertSafeProviderUrl('https://localhost/v1'), /local or non-global host/);
  assert.throws(() => transport.assertSafeProviderUrl('https://169.254.169.254/latest/meta-data'), /local or non-global host/);
});

test('the idle timeout re-arms on activity and reports why it fired', async () => {
  const outer = new AbortController();
  const timeout = transport.withProviderTimeoutSignal(outer.signal, 10000);
  assert.equal(timeout.timedOut(), false);
  timeout.touch();
  outer.abort(new Error('user cancelled'));
  assert.equal(timeout.signal.aborted, true, 'cancelling the caller cancels the request');
  assert.equal(timeout.timedOut(), false, 'a cancel is not a timeout');
  timeout.touch();
  timeout.cleanup();

  const already = new AbortController();
  already.abort(new Error('gone'));
  const late = transport.withProviderTimeoutSignal(already.signal, 10000);
  assert.equal(late.signal.aborted, true, 'a request made with an already-cancelled signal starts cancelled');
  late.cleanup();

  const fired = transport.withProviderTimeoutSignal(undefined, 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fired.timedOut(), true);
  assert.equal(fired.signal.aborted, true);
  fired.touch();
  assert.equal(fired.timedOut(), true, 'a timed-out request cannot be revived by late activity');
  fired.cleanup();
});

test('a hosted call returns JSON and reports a failure with the body, scrubbed', async () => {
  let seen = null;
  let restore = installTransport((url, init) => {
    seen = { url, init };
    return { status: 200, text: JSON.stringify({ ok: true }) };
  });
  try {
    const json = await transport.providerFetch('https://api.test/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'evil.test', host: 'evil.test' },
      body: '{"model":"x"}',
    }, 'Test provider');
    assert.deepEqual(json, { ok: true });
    assert.equal(seen.url, 'https://api.test/v1/chat');
    assert.equal(seen.init.body, '{"model":"x"}');
    assert.equal('Host' in seen.init.headers, false, 'a caller cannot override the Host header');
    assert.equal('host' in seen.init.headers, false);
  } finally { restore(); }

  restore = installTransport(() => ({ status: 401, statusText: 'Unauthorized', text: 'bad key: sk-abcdef' }));
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'),
      /Test provider 401 Unauthorized: bad key: sk-abcdef/);
  } finally { restore(); }

  restore = installTransport(() => ({ status: 500, text: 'authorization: Bearer sk-secret' }));
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'), err => {
      assert.match(err.message, /Test provider 500 Internal Server Error/, 'a missing status text is filled in');
      assert.ok(!err.message.includes('sk-secret'), 'a key echoed back by the provider is not shown to the user');
      return true;
    });
  } finally { restore(); }

  restore = installTransport(() => ({ status: 200, text: 'not json' }));
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'), /Unexpected token/);
  } finally { restore(); }
});

test('a request that goes quiet is reported as a timeout, not a broken socket', async () => {
  const restore = installTransport(() => null);
  try {
    await assert.rejects(
      transport.providerFetch('https://api.test/v1', {}, 'Test provider', { timeoutMs: 20 }),
      /Test provider request timed out/);
    await assert.rejects(
      transport.providerFetchStream('https://api.test/v1', {}, 'Test provider', { timeoutMs: 20 }),
      /Test provider request timed out/);
  } finally { restore(); }
});

test('a hostname is resolved once and the connection is pinned to that address', async () => {
  let lookups = 0;
  let restore = installTransport(() => ({ status: 200, text: '{}' }), async () => {
    lookups++;
    return [{ address: '93.184.216.34', family: 4 }];
  });
  try {
    await transport.providerFetch('https://api.test/v1', {}, 'Test provider');
    assert.equal(lookups, 1, 'the address checked is the address connected to');
  } finally { restore(); }

  // A hostname that resolves anywhere private is refused, even if it also
  // resolves somewhere public.
  restore = installTransport(() => ({ status: 200, text: '{}' }),
    async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'),
      /resolved to a non-global address/);
  } finally { restore(); }

  restore = installTransport(() => ({ status: 200, text: '{}' }), async () => []);
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'), /did not resolve/);
  } finally { restore(); }

  // A lookup that answers with one record rather than a list is still read.
  restore = installTransport(() => ({ status: 200, text: '{"ok":1}' }),
    async () => ({ address: '93.184.216.34', family: 4 }));
  try {
    assert.deepEqual(await transport.providerFetch('https://api.test/v1', {}, 'Test provider'), { ok: 1 });
  } finally { restore(); }

  // A URL that is already an address needs no lookup at all.
  let called = 0;
  restore = installTransport(() => ({ status: 200, text: '{"ok":1}' }), async () => { called++; return []; });
  try {
    await transport.providerFetch('https://93.184.216.34/v1', {}, 'Test provider');
    assert.equal(called, 0);
  } finally { restore(); }
});

test('redirects are followed only when they stay put and stay safe', async () => {
  const redirectTo = (location, status = 302) => ({ status, headers: { location } });

  let hops = [];
  let restore = installTransport(url => {
    hops.push(url);
    return url.endsWith('/final') ? { status: 200, text: '{"ok":1}' } : redirectTo('/final');
  });
  try {
    assert.deepEqual(await transport.providerFetch('https://api.test/v1', {}, 'Test provider'), { ok: 1 });
    assert.deepEqual(hops, ['https://api.test/v1', 'https://api.test/final']);
  } finally { restore(); }

  restore = installTransport(() => redirectTo('https://elsewhere.test/v1'));
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'),
      /cross-origin redirects are not allowed/);
  } finally { restore(); }

  restore = installTransport(() => redirectTo('https://localhost/v1'));
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'),
      /local or non-global host/, 'a redirect cannot reach somewhere the first request could not');
  } finally { restore(); }

  let bounce = 0;
  restore = installTransport(() => redirectTo(`/hop${bounce++}`));
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'),
      /redirected too many times/);
  } finally { restore(); }

  // A 302 on a POST would silently turn it into a GET; only 307/308 preserve it.
  restore = installTransport(url => (url.endsWith('/final') ? { status: 200, text: '{"ok":1}' } : redirectTo('/final', 302)));
  try {
    await assert.rejects(transport.providerFetch('https://api.test/v1', { method: 'POST' }, 'Test provider'),
      /unsafe method-changing redirect/);
  } finally { restore(); }

  restore = installTransport(url => (url.endsWith('/final') ? { status: 200, text: '{"ok":1}' } : redirectTo('/final', 308)));
  try {
    assert.deepEqual(await transport.providerFetch('https://api.test/v1', { method: 'POST' }, 'Test provider'), { ok: 1 });
  } finally { restore(); }

  restore = installTransport(url => (url.endsWith('/final') ? { status: 200, text: '{"ok":1}' } : redirectTo('/final', 303)));
  try {
    assert.deepEqual(await transport.providerFetch('https://api.test/v1', { method: 'GET' }, 'Test provider'), { ok: 1 },
      'a GET may be redirected by any of the redirect codes');
  } finally { restore(); }
});

test('a streamed response is handed back with the timer still running', async () => {
  let restore = installTransport(() => ({ status: 200, text: 'data: hello\n\n' }));
  try {
    const stream = await transport.providerFetchStream('https://api.test/v1', {}, 'Test provider');
    assert.equal(stream.response.ok, true);
    assert.equal(stream.response.status, 200);
    assert.equal(stream.res, stream.response, 'the older name for the response still works');
    assert.equal(typeof stream.touch, 'function', 'the reader re-arms the idle timer as chunks arrive');
    assert.equal(stream.timedOut(), false);
    const reader = stream.response.body.getReader();
    const { value } = await reader.read();
    assert.equal(new TextDecoder().decode(value), 'data: hello\n\n');
    stream.cleanup();
  } finally { restore(); }

  restore = installTransport(() => ({ status: 429, statusText: 'Too Many Requests', text: 'slow down' }));
  try {
    await assert.rejects(transport.providerFetchStream('https://api.test/v1', {}, 'Test provider'),
      /Test provider 429 Too Many Requests: slow down/);
  } finally { restore(); }
});

test('a response larger than the cap is refused rather than buffered', async () => {
  const huge = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6 * 1024 * 1024));
      controller.enqueue(new Uint8Array(6 * 1024 * 1024));
      controller.close();
    },
  });
  const restore = installTransport(() => ({ status: 500, body: huge }));
  try {
    // The error path reads the body to quote it; the cap must still hold.
    await assert.rejects(transport.providerFetch('https://api.test/v1', {}, 'Test provider'),
      /Test provider 500/);
  } finally { restore(); }
});

test('streamed tokens are only released once no placeholder can still be spanning', () => {
  const restore = (text, replacements) => replacements.reduce(
    (out, item) => out.split(item.placeholder).join(item.value), text);

  assert.doesNotThrow(() => transport.createPiiTokenEmitter([], null, restore).push('x'),
    'with nowhere to send tokens the emitter is a no-op');
  transport.createPiiTokenEmitter([], null, restore).flush();

  const direct = [];
  const passthrough = transport.createPiiTokenEmitter([], t => direct.push(t), restore);
  passthrough.push('hello ');
  passthrough.push('world');
  passthrough.flush();
  assert.deepEqual(direct, ['hello ', 'world'], 'with nothing redacted every chunk goes straight through');

  const out = [];
  const replacements = [{ placeholder: '[EMAIL_1]', value: 'ada@example.org' }];
  const emitter = transport.createPiiTokenEmitter(replacements, t => out.push(t), restore);
  for (const chunk of ['Write to [EM', 'AIL_1] about the plan, ', 'and then to [EMAIL_1] again.']) {
    emitter.push(chunk);
  }
  emitter.flush();
  const joined = out.join('');
  assert.equal(joined, 'Write to ada@example.org about the plan, and then to ada@example.org again.',
    'a placeholder split across two chunks is still restored');
  assert.ok(!joined.includes('[EMAIL_1]'), 'no placeholder is ever shown to the reader');
});
