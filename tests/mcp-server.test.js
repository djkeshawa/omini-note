const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMcpServer, SUPPORTED_PROTOCOL_VERSIONS } = require('../lib/mcp/server.js');
const { createVaultTools } = require('../lib/mcp/tools.js');

async function withMcpServer(options, fn) {
  const previousVispnoteHome = process.env.VISPNOTE_HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-mcp-'));
  const storePath = require.resolve('../lib/store');
  const indexPath = require.resolve('../lib/index');
  delete require.cache[storePath];
  delete require.cache[indexPath];
  process.env.VISPNOTE_HOME = tmpHome;
  try {
    const store = require('../lib/store');
    const idx = require('../lib/index');
    const cfg = await store.loadConfig();
    const server = createMcpServer({
      name: 'vispnote',
      version: '0.0.0-test',
      tools: createVaultTools({ store, idx, allowWrites: !!options.allowWrites }),
    });
    return await fn({ server, store, idx, vaultId: cfg.vaults[0].id, tmpHome });
  } finally {
    try { require('../lib/index').close(); } catch {}
    delete require.cache[indexPath];
    delete require.cache[storePath];
    if (previousVispnoteHome === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previousVispnoteHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

let nextId = 1;
async function call(server, method, params) {
  return server.handleMessage({ jsonrpc: '2.0', id: nextId++, method, params });
}

async function callTool(server, name, args) {
  const res = await call(server, 'tools/call', { name, arguments: args });
  const payload = res.result;
  const text = payload.content?.[0]?.text || '';
  let value = text;
  try { value = JSON.parse(text); } catch {}
  return { isError: !!payload.isError, value, text };
}

test('MCP lifecycle: initialize, ping, tools/list, unknown method', async () => {
  await withMcpServer({}, async ({ server }) => {
    const init = await call(server, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    assert.equal(init.result.protocolVersion, '2024-11-05');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.equal(init.result.serverInfo.name, 'vispnote');

    const unknownVersion = await call(server, 'initialize', { protocolVersion: '1999-01-01' });
    assert.equal(unknownVersion.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);

    const ping = await call(server, 'ping', {});
    assert.deepEqual(ping.result, {});

    const list = await call(server, 'tools/list', {});
    const names = list.result.tools.map(t => t.name);
    assert.ok(names.includes('search_notes'));
    assert.ok(names.includes('get_note'));
    assert.ok(names.includes('get_backlinks'));
    assert.ok(names.includes('get_unlinked_mentions'));
    assert.ok(names.includes('list_notes_by_tag'));
    assert.ok(!names.includes('create_note'), 'writes are excluded by default');
    for (const tool of list.result.tools) {
      assert.equal(typeof tool.description, 'string');
      assert.equal(tool.inputSchema.type, 'object');
    }

    const missing = await call(server, 'nope/nothing', {});
    assert.equal(missing.error.code, -32601);

    const notification = await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notification, null);
  });
});

test('MCP read tools search and fetch real vault notes', async () => {
  await withMcpServer({}, async ({ server, store, idx, vaultId }) => {
    const saved = await store.saveNote(vaultId, {
      id: 'mcp1', title: 'Quarterly Plan', tags: ['work'],
      body: 'Ship the roadmap. See [[Budget Review]].',
    });
    idx.indexNote(vaultId, saved);
    const budget = await store.saveNote(vaultId, {
      id: 'mcp2', title: 'Budget Review', tags: [],
      body: 'Numbers pending. The Quarterly Plan drives this.',
    });
    idx.indexNote(vaultId, budget);

    const vaults = await callTool(server, 'list_vaults', {});
    assert.ok(vaults.value.vaults.some(v => v.id === vaultId && v.active));

    const search = await callTool(server, 'search_notes', { query: 'roadmap' });
    assert.equal(search.isError, false);
    assert.ok(search.value.results.some(r => r.id === 'mcp1'));
    assert.ok(!search.text.includes('<mark>'));

    const byId = await callTool(server, 'get_note', { noteId: 'mcp1' });
    assert.equal(byId.value.title, 'Quarterly Plan');
    assert.match(byId.value.body, /Ship the roadmap/);

    const byTitle = await callTool(server, 'get_note', { title: 'budget review' });
    assert.equal(byTitle.value.id, 'mcp2');

    const backlinks = await callTool(server, 'get_backlinks', { title: 'Budget Review' });
    assert.ok(backlinks.value.backlinks.some(b => b.id === 'mcp1'));

    const mentions = await callTool(server, 'get_unlinked_mentions', { title: 'Quarterly Plan' });
    assert.ok(mentions.value.mentions.some(m => m.id === 'mcp2'));

    const tagged = await callTool(server, 'list_notes_by_tag', { tag: 'work' });
    assert.deepEqual(tagged.value.notes.map(n => n.id), ['mcp1']);

    const missingNote = await callTool(server, 'get_note', { noteId: 'nope' });
    assert.equal(missingNote.isError, true);

    const badVault = await callTool(server, 'search_notes', { query: 'x', vault: 'no-such-vault' });
    assert.equal(badVault.isError, true);
    assert.match(badVault.text, /list_vaults/);
  });
});

test('MCP write tools are gated and persist to disk when enabled', async () => {
  await withMcpServer({ allowWrites: true }, async ({ server, store, vaultId, tmpHome }) => {
    const list = await call(server, 'tools/list', {});
    const names = list.result.tools.map(t => t.name);
    assert.ok(names.includes('create_note'));
    assert.ok(names.includes('append_to_note'));

    const created = await callTool(server, 'create_note', {
      title: 'Agent Log', body: 'First entry.', tags: ['agent'],
    });
    assert.equal(created.isError, false);
    const noteId = created.value.created.id;
    const cfg = await store.loadConfig();
    const slug = cfg.vaults.find(v => v.id === vaultId).slug;
    assert.ok(fs.existsSync(path.join(tmpHome, slug, `${noteId}.md`)));

    const appended = await callTool(server, 'append_to_note', { noteId, markdown: 'Second entry.' });
    assert.equal(appended.isError, false);
    const onDisk = await store.getNote(vaultId, noteId);
    assert.match(onDisk.body, /First entry\.\n\nSecond entry\./);

    const searchable = await callTool(server, 'search_notes', { query: 'second entry' });
    assert.ok(searchable.value.results.some(r => r.id === noteId));

    const badAppend = await callTool(server, 'append_to_note', { noteId: 'missing', markdown: 'x' });
    assert.equal(badAppend.isError, true);
  });
});

test('MCP read tools lazily rescan a vault whose index is empty', async () => {
  await withMcpServer({}, async ({ server, store, vaultId }) => {
    // Note written to disk but never indexed — as when the app has not run.
    await store.saveNote(vaultId, {
      id: 'coldstart', title: 'Cold Start', tags: [],
      body: 'Indexless zebra content.',
    });
    const search = await callTool(server, 'search_notes', { query: 'zebra' });
    assert.equal(search.isError, false);
    assert.ok(search.value.results.some(r => r.id === 'coldstart'));
  });
});

test('MCP write tools are absent without --allow-writes', async () => {
  await withMcpServer({}, async ({ server }) => {
    const created = await callTool(server, 'create_note', { title: 'Sneaky' });
    assert.equal(created.isError, true);
    assert.match(created.text, /Unknown tool/);
  });
});
