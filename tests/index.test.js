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

test('index search finds general attachment filenames from ordinary Markdown', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('vault_a', [{
      id: 'n1', title: 'Quarterly review', date: '2026-01-01', tags: [],
      body: '[Workbook](attachments/financial-model-20260713000000.xlsx)',
    }]);
    assert.equal(idx.search('vault_a', 'financial', 10)[0].id, 'n1');
    assert.equal(idx.search('vault_a', 'xlsx', 10)[0].id, 'n1');
  });
});

test('index search clamps oversized limits from callers', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    const notes = Array.from({ length: 250 }, (_unused, index) => ({
      id: `n${index}`,
      title: `Common note ${index}`,
      date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      tags: ['bulk'],
      body: `common body ${index}`,
    }));
    idx.rescanVault('vault_a', notes);

    assert.equal(idx.search('vault_a', 'common', 10000).length, 200);
    assert.equal(idx.searchDetailed('vault_a', 'common', 10000).length, 200);
    assert.equal(idx.lexicalContextSearch('vault_a', 'common', 10000).length, 200);
    assert.equal(idx.search('vault_a', 'common', 0).length, 1);
  });
});

test('index search normalizes non-string and oversized queries', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('vault_a', [
      { id: 'n1', title: 'Common note', date: '2026-01-01', tags: ['bulk'], body: 'common searchable body' },
    ]);

    assert.doesNotThrow(() => idx.search('vault_a', { bad: 'query' }, 10));
    assert.deepEqual(idx.search('vault_a', { bad: 'query' }, 10), []);
    assert.equal(idx.search('vault_a', 'common '.repeat(5000), 5).length, 1);
    assert.equal(idx.searchDetailed('vault_a', 'common '.repeat(5000), 5).length, 1);
    assert.equal(idx.lexicalContextSearch('vault_a', 'common '.repeat(5000), 5).length, 1);
  });
});

test('rescanVault preserves embeddings for notes that have not changed', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    const n1 = { id: 'n1', title: 'Kept', date: '2026-01-01', tags: ['a'], body: 'Body one.' };
    const n2 = { id: 'n2', title: 'Changed', date: '2026-01-02', tags: [], body: 'Body two.' };
    const n3 = { id: 'n3', title: 'Removed', date: '2026-01-03', tags: [], body: 'Body three.' };
    idx.rescanVault('vault_a', [n1, n2, n3]);
    for (const note of [n1, n2, n3]) {
      const chunks = idx.chunkNote(note);
      idx.setNoteEmbeddings('vault_a', note, chunks.map((_chunk, i) => vec(i, 1)), 'nomic-embed-text');
    }
    assert.deepEqual(idx.notesNeedingEmbeddings('vault_a', 'nomic-embed-text'), []);

    // A boot rescan of an unchanged vault must not throw the embeddings away.
    idx.rescanVault('vault_a', [n1, n2, n3]);
    assert.deepEqual(
      idx.notesNeedingEmbeddings('vault_a', 'nomic-embed-text'), [],
      'unchanged notes keep their embeddings across a rescan',
    );

    // A changed note's embedding describes text that no longer exists, so it
    // must be dropped and queued for re-embedding. Untouched notes stay.
    idx.rescanVault('vault_a', [n1, { ...n2, body: 'Body two, rewritten.' }, n3]);
    assert.deepEqual(idx.notesNeedingEmbeddings('vault_a', 'nomic-embed-text'), ['n2']);
    assert.equal(idx.search('vault_a', 'rewritten', 10)[0]?.id, 'n2');

    // A note absent from the scan is gone, along with its chunks.
    idx.rescanVault('vault_a', [n1, { ...n2, body: 'Body two, rewritten.' }]);
    assert.deepEqual(idx.search('vault_a', 'three', 10), []);
    const stats = idx.embeddingStats().filter(row => row.vaultId === 'vault_a');
    assert.equal(stats.reduce((sum, row) => sum + row.notes, 0), 1, 'only n1 keeps chunks');
  });
});

test('rescanVault keeps tags, links and full text in step with the notes it syncs', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('vault_a', [
      { id: 'n1', title: 'Alpha', date: '2026-01-01', tags: ['keep'], body: 'zorbulax to [[Beta]] here' },
      { id: 'n2', title: 'Beta', date: '2026-01-02', tags: ['drop'], body: 'beta body' },
    ]);
    assert.deepEqual(idx.notesByTag('vault_a', 'keep'), ['n1']);
    assert.equal(idx.backlinks('vault_a', 'Beta').length, 1);

    // Retagged, relinked and retitled in one pass.
    idx.rescanVault('vault_a', [
      { id: 'n1', title: 'Alpha renamed', date: '2026-01-01', tags: ['moved'], body: 'no link now' },
      { id: 'n2', title: 'Beta', date: '2026-01-02', tags: ['drop'], body: 'beta body' },
    ]);
    assert.deepEqual(idx.notesByTag('vault_a', 'keep'), [], 'stale tag is gone');
    assert.deepEqual(idx.notesByTag('vault_a', 'moved'), ['n1']);
    assert.equal(idx.backlinks('vault_a', 'Beta').length, 0, 'stale link is gone');
    assert.equal(idx.search('vault_a', 'renamed', 10)[0]?.id, 'n1');
    assert.deepEqual(idx.search('vault_a', 'zorbulax', 10), [], 'stale full text is gone');
  });
});

test('an index written before the fts rowid map migrates without losing search', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('vault_a', [
      { id: 'n1', title: 'Migrated note', date: '2026-01-01', tags: ['old'], body: 'searchable haystack text' },
    ]);
    const dbPath = idx.DB_PATH;
    idx.close();

    // Rewind to the pre-migration shape: no rowid map, schemaVersion back to 1.
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath);
    raw.exec('DELETE FROM fts_map');
    raw.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    raw.close();

    delete require.cache[require.resolve('../lib/index')];
    const reopened = require('../lib/index');
    reopened.init();
    assert.equal(reopened.search('vault_a', 'haystack', 10)[0]?.id, 'n1', 'search survives the migration');

    // The map was backfilled, so the delete finds its row instead of scanning.
    reopened.removeNote('vault_a', 'n1');
    assert.deepEqual(reopened.search('vault_a', 'haystack', 10), [], 'delete by rowid removes the fts row');
    reopened.close();
    const check = new Database(dbPath);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM notes_fts').get().n, 0, 'no orphan fts row left behind');
    check.close();
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
