const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const validation = require('../lib/connectors/ipc/payloadValidation');
const preferences = require('../lib/connectors/ipc/preferenceValidation');
const { registerWorkspaceHandlers } = require('../lib/connectors/ipc/workspaceHandlers');
const { createIpcRuntime } = require('../main/ipcRuntime');

test('connector payload validation preserves safe attachment and Zotero contracts', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(validation.sanitizeAttachmentPayload({
    name: 'image.png',
    mimeType: 'image/png',
    bytes,
  }), { name: 'image.png', mimeType: 'image/png', bytes });
  assert.deepEqual(validation.sanitizeAttachmentPayload({
    name: 'brief.pdf', mimeType: '', bytes,
  }), { name: 'brief.pdf', mimeType: '', bytes });
  assert.deepEqual(validation.sanitizeAttachmentPayload({
    name: '', mimeType: 'image/png', bytes,
  }), { name: '', mimeType: 'image/png', bytes });
  assert.throws(() => validation.sanitizeAttachmentPayload({ name: '', mimeType: '', bytes }), /Invalid attachment payload/);
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

test('workspace attachment IPC describes and opens only through main-process services', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const { wrap } = createIpcRuntime();
  const descriptor = {
    fileName: 'brief.pdf', relPath: 'attachments/brief.pdf', mimeType: 'application/pdf',
    size: 4, kind: 'document', typeLabel: 'PDF', isImage: false,
  };
  const attachments = {
    saveAttachment: async () => descriptor,
    describeAttachment: async () => descriptor,
    openAttachment: async (_vaultId, _fileName, openPath) => {
      const error = await openPath('C:\\safe-vault\\attachments\\brief.pdf');
      return { opened: !error, descriptor };
    },
  };
  const opened = [];
  registerWorkspaceHandlers(ipcMain, {
    wrap, store: {}, attachments, sanitizeAttachmentPayload: value => value,
    shell: { openPath: async filePath => { opened.push(filePath); return ''; } },
  });
  const described = await handlers.get('mn:describeAttachment')({}, 'vault_a', 'brief.pdf');
  const openResult = await handlers.get('mn:openAttachment')({}, 'vault_a', 'brief.pdf');
  assert.deepEqual(described, { ok: true, value: descriptor });
  assert.equal(openResult.value.opened, true);
  assert.deepEqual(opened, ['C:\\safe-vault\\attachments\\brief.pdf']);
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

test('smart view preferences round-trip both formats and carry the v2 fields', () => {
  // The renderer writes v2 and echoes stored v1 back on boot; the boundary
  // must accept both, or the whole prefs patch is dropped on every launch —
  // which is exactly what happened when this file stayed on v1.
  const v2 = {
    format: 'vispnote.smartView.v2', id: 'open-tasks', title: 'Open tasks', type: 'tasks',
    filters: {}, sort: {}, layout: 'board', group: { by: 'status', direction: 'desc' }, columns: ['status', 'due'],
  };
  const v1 = { format: 'vispnote.smartView.v1', id: 'recent', title: 'Recent', type: 'notes' };
  const clean = preferences.sanitizePrefsPatchFromIpc({ smartViews: [v2, v1] }).smartViews;
  assert.equal(clean[0].format, 'vispnote.smartView.v2');
  assert.equal(clean[0].layout, 'board');
  assert.deepEqual(clean[0].group, { by: 'status', direction: 'desc' });
  assert.deepEqual(clean[0].columns, ['status', 'due']);
  // v1 upgrades on write and gains nothing it did not have
  assert.equal(clean[1].format, 'vispnote.smartView.v2');
  assert.equal(clean[1].layout, undefined);
  assert.equal(clean[1].group, undefined);
  // hostile or malformed v2 fields still throw
  assert.throws(() => preferences.sanitizePrefsPatchFromIpc({ smartViews: [{ ...v2, format: 'vispnote.smartView.v3' }] }), /Unsupported Smart View format/);
  assert.throws(() => preferences.sanitizePrefsPatchFromIpc({ smartViews: [{ ...v2, layout: 'spiral' }] }), /Invalid Smart View layout/);
  assert.throws(() => preferences.sanitizePrefsPatchFromIpc({ smartViews: [{ ...v2, group: { by: 'x', extra: 1 } }] }), /Unsupported Smart View group field/);
  assert.throws(() => preferences.sanitizePrefsPatchFromIpc({ smartViews: [{ ...v2, group: { by: 'x', direction: 'up' } }] }), /Invalid Smart View group direction/);
  assert.throws(() => preferences.sanitizePrefsPatchFromIpc({ smartViews: [{ ...v2, columns: Array(13).fill('c') }] }), /Invalid Smart View columns/);
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
