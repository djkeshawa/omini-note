const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const validation = require('../lib/connectors/ipc/payloadValidation');
const preferences = require('../lib/connectors/ipc/preferenceValidation');

test('connector payload validation preserves safe attachment and Zotero contracts', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(validation.sanitizeAttachmentPayload({
    name: 'image.png',
    mimeType: 'image/png',
    bytes,
  }), { name: 'image.png', mimeType: 'image/png', bytes });
  assert.deepEqual(validation.sanitizeZoteroSearchPayload({ query: 'paper', limit: 99 }), {
    query: 'paper',
    limit: 20,
  });
  assert.deepEqual(validation.sanitizeZoteroReadPayload({ itemKey: 'ABCD_123' }), {
    itemKey: 'ABCD_123',
    includeFullText: true,
  });
  assert.throws(() => validation.sanitizeZoteroReadPayload({ itemKey: '../secret' }), /Invalid Zotero item key/);
});

test('preference connector accepts known fields and rejects unknown or unsafe patches', () => {
  const clean = preferences.sanitizePrefsPatchFromIpc({
    enabledPacks: ['canvas', 'agents', 'canvas'],
    tweaks: { theme: 'dark', showSidebar: false },
  });
  assert.deepEqual(clean.enabledPacks, ['canvas', 'agents']);
  assert.equal(clean.tweaks.theme, 'dark');
  assert.equal(clean.tweaks.showSidebar, false);
  assert.throws(() => preferences.sanitizePrefsPatchFromIpc({ unexpected: true }), /Unsupported preferences field/);
  const unsafe = JSON.parse('{"tweaks":{"__proto__":{"polluted":true}}}');
  assert.throws(() => preferences.sanitizePrefsPatchFromIpc(unsafe), /Invalid|Unsupported/);
});

test('main composition and connector modules respect the phase-two line budget', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.ok(main.split(/\r?\n/).length <= 800, 'main.js must remain a composition module');
  const connectorDir = path.join(__dirname, '../lib/connectors/ipc');
  for (const name of fs.readdirSync(connectorDir).filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(connectorDir, name), 'utf8');
    assert.ok(source.split(/\r?\n/).length <= 500, `${name} exceeds the connector module budget`);
  }
});
