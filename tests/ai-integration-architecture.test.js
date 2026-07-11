const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const transport = require('../lib/integrations/ai/providerTransport');
const toolSchemas = require('../lib/integrations/ai/toolSchemas');

test('AI provider transport redacts secrets and normalizes failures', async () => {
  assert.equal(
    transport.scrubSecretText('authorization: Bearer secret-token x-api-key: hidden'),
    'authorization: Bearer [redacted] x-api-key: [redacted]'
  );

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'authorization: Bearer secret-token',
  });
  try {
    await assert.rejects(
      transport.providerFetch('https://provider.invalid/chat', {}, 'Hosted AI'),
      error => /Hosted AI 401 Unauthorized/.test(error.message) && !error.message.includes('secret-token')
    );
  } finally {
    global.fetch = originalFetch;
  }
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

test('external clients live under integrations with compatibility facades', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const ai = fs.readFileSync(path.join(root, 'lib/ai.js'), 'utf8');
  const rendererAi = fs.readFileSync(path.join(root, 'src/ai/ai.jsx'), 'utf8');

  assert.match(main, /lib\/integrations\/memory\/client/);
  assert.match(main, /lib\/integrations\/telemetry\/featureUsage/);
  assert.match(main, /lib\/integrations\/zotero\/client/);
  assert.match(ai, /integrations\/ai\/providerTransport/);
  assert.match(ai, /integrations\/ai\/toolSchemas/);
  assert.match(rendererAi, /features\/ai\/index\.js/);
  assert.match(fs.readFileSync(path.join(root, 'lib/zotero.js'), 'utf8'), /integrations\/zotero\/client/);
  assert.match(fs.readFileSync(path.join(root, 'lib/llmMemory.js'), 'utf8'), /integrations\/memory\/client/);
  assert.match(fs.readFileSync(path.join(root, 'lib/featureUsage.js'), 'utf8'), /integrations\/telemetry\/featureUsage/);
});
