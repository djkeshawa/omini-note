const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.close();
} catch (e) {
  throw new Error(`SQLite native module is required for index tests. Run npm install or electron-builder install-app-deps for this Node/Electron target. ${e?.message || e}`);
}

async function withIsolatedIndex(fn) {
  const previousVispnoteHome = process.env.VISPNOTE_HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-index-'));
  const storePath = require.resolve('../lib/store');
  const indexPath = require.resolve('../lib/index');
  delete require.cache[storePath];
  delete require.cache[indexPath];
  process.env.VISPNOTE_HOME = tmpHome;
  try {
    const store = require('../lib/store');
    await store.loadConfig();
    const idx = require('../lib/index');
    return await fn(idx, store);
  } finally {
    try {
      const idx = require('../lib/index');
      idx.close();
    } catch {}
    delete require.cache[indexPath];
    delete require.cache[storePath];
    if (previousVispnoteHome === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previousVispnoteHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function vec(dim, value = 1) {
  const out = new Float32Array(768);
  out[dim] = value;
  return out;
}

test('index search handles unicode, tags, and removed notes', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('vault_a', [
      { id: 'n1', title: 'Café research', date: '2026-01-01', tags: ['research'], body: 'Résumé notes about naïve search.' },
      { id: 'n2', title: 'Deleted candidate', date: '2026-01-02', tags: ['archive'], body: 'temporary deleted text' },
    ]);

    assert.equal(idx.search('vault_a', 'cafe', 10)[0].id, 'n1');
    assert.deepEqual(idx.notesByTag('vault_a', 'research'), ['n1']);

    idx.removeNote('vault_a', 'n2');
    assert.deepEqual(idx.search('vault_a', 'temporary', 10), []);
  });
});

test('chunkNote hard-caps long sentences', async () => {
  await withIsolatedIndex(async (idx) => {
    const longSentence = 'x'.repeat(1400);
    const chunks = idx.chunkNote({ title: 'Long note', body: longSentence });
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every(chunk => chunk.length <= 600));
  });
});

test('vector search normalizes stored and query embeddings', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    const note = { id: 'n1', title: 'Vector title', date: '2026-01-01', tags: [], body: 'Vector body paragraph.' };
    idx.rescanVault('vault_a', [note]);
    idx.setNoteEmbeddings('vault_a', note, [vec(0, 10), vec(1, 25)], 'nomic-embed-text');

    const hits = idx.vectorSearch('vault_a', vec(1, 3), 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].noteId, 'n1');
    assert.equal(hits[0].chunkIdx, 1);
  });
});
