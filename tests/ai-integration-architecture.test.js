const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const transport = require('../lib/integrations/ai/providerTransport');
const toolSchemas = require('../lib/integrations/ai/toolSchemas');

function fakeRequest(responses, onRequest = () => {}) {
  const queue = responses.slice();
  return (options, callback) => {
    onRequest(options);
    const request = new EventEmitter();
    request.write = () => {};
    request.destroy = error => {
      if (error) queueMicrotask(() => request.emit('error', error));
    };
    request.end = () => {
      queueMicrotask(() => {
        const spec = queue.shift();
        if (spec instanceof Error) {
          request.emit('error', spec);
          return;
        }
        const response = Readable.from([Buffer.from(spec?.body || '')]);
        response.statusCode = spec?.status || 200;
        response.statusMessage = spec?.statusText || '';
        response.headers = spec?.headers || {};
        callback(response);
      });
    };
    return request;
  };
}

test('AI provider transport redacts secrets and normalizes failures', async () => {
  assert.equal(
    transport.scrubSecretText('authorization: Bearer secret-token x-api-key: hidden'),
    'authorization: Bearer [redacted] x-api-key: [redacted]'
  );
  assert.equal(
    transport.scrubSecretText('https://provider.invalid?api_key=hidden {"access_token":"also-hidden"}'),
    'https://provider.invalid?api_key=[redacted] {"access_token":"[redacted]"}'
  );

  await assert.rejects(
    transport.providerFetch('https://provider.invalid/chat', {}, 'Hosted AI', {
      dependencies: {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: fakeRequest([{
          status: 401,
          statusText: 'Unauthorized',
          body: 'authorization: Bearer secret-token',
        }]),
      },
    }),
    error => /Hosted AI 401 Unauthorized/.test(error.message) && !error.message.includes('secret-token')
  );
});

test('AI provider transport validates DNS, pins the approved address, and rejects unsafe redirects', async () => {
  let requestCount = 0;
  await assert.rejects(
    transport.providerFetch('https://provider.invalid/chat', {}, 'Hosted AI', {
      dependencies: {
        lookup: async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
        request: () => {
          requestCount++;
          throw new Error('request should not start');
        },
      },
    }),
    /resolved to a non-global address/
  );
  assert.equal(requestCount, 0);

  let pinnedAddress = null;
  const data = await transport.providerFetch('https://provider.invalid/chat', {}, 'Hosted AI', {
    dependencies: {
      lookup: async () => [{ address: '8.8.4.4', family: 4 }],
      request: fakeRequest([{ body: '{"ok":true}' }], options => {
        requestCount++;
        options.lookup('provider.invalid', {}, (_error, address) => {
          pinnedAddress = address;
        });
      }),
    },
  });
  assert.deepEqual(data, { ok: true });
  assert.equal(pinnedAddress, '8.8.4.4');

  await assert.rejects(
    transport.providerFetch('https://provider.invalid/chat', {}, 'Hosted AI', {
      dependencies: {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: fakeRequest([{
          status: 307,
          headers: { location: 'https://other.invalid/chat' },
        }]),
      },
    }),
    /cross-origin redirects are not allowed/
  );
});

test('AI provider transport classifies non-global address ranges', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.0.2.1', '192.168.0.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1', 'fd00::1',
    'fe80::1', '2001::1', '2001:20::1', '2001:db8::1', '2002:7f00:1::', '::ffff:127.0.0.1',
  ]) {
    assert.equal(transport.isNonGlobalIp(address), true, address);
  }
  assert.equal(transport.isNonGlobalIp('8.8.8.8'), false);
  assert.equal(transport.isNonGlobalIp('2606:4700:4700::1111'), false);
});

test('AI tool schemas sanitize nested contracts and tool calls', () => {
  const tools = toolSchemas.sanitizeAiTools([{
    name: 'read-note',
    description: 'Read one note',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', maxLength: 50000 } },
      required: ['id'],
    },
  }]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].inputSchema.properties.id.maxLength, 20000);
  assert.deepEqual(toolSchemas.normalizeToolCalls([{ name: 'read-note', args: '{"id":"n1"}' }])[0].args, { id: 'n1' });
  assert.equal(toolSchemas.sanitizeAiTools([{ name: 'unsafe name' }]).length, 0);
});

test('external clients live under integrations without compatibility facades', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const aiRoot = path.join(root, 'lib/ai');
  const ai = [
    fs.readFileSync(path.join(root, 'lib/ai.js'), 'utf8'),
    ...fs.readdirSync(aiRoot).sort().map(name => fs.readFileSync(path.join(aiRoot, name), 'utf8')),
  ].join('\n');
  const rendererAiRoot = path.join(root, 'src/ai');
  const rendererAi = fs.readdirSync(rendererAiRoot)
    .filter(name => name === 'ai.jsx' || /^(?:ai.+|AskAi.+|create.+)\.(?:js|jsx)$/.test(name))
    .sort()
    .map(name => fs.readFileSync(path.join(rendererAiRoot, name), 'utf8'))
    .join('\n');

  assert.match(main, /lib\/integrations\/memory\/client/);
  assert.match(main, /lib\/integrations\/telemetry\/featureUsage/);
  assert.match(main, /lib\/integrations\/zotero\/client/);
  assert.match(ai, /integrations\/ai\/providerTransport/);
  assert.match(ai, /integrations\/ai\/toolSchemas/);
  assert.match(rendererAi, /features\/ai\/index\.js/);
  assert.equal(fs.existsSync(path.join(root, 'lib/zotero.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'lib/llmMemory.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'lib/featureUsage.js')), false);
});
