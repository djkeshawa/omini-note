const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// The read side of the search index: backlinks, unlinked mentions, tag
// listings and the health report the AI panel shows. index.test.js pins
// indexing and the embedding lifecycle; this pins what the vault reads back,
// including the queries that must return nothing rather than throw.

async function withIsolatedIndex(fn) {
  const previousVispnoteHome = process.env.VISPNOTE_HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-index-q-'));
  const storePath = require.resolve('../lib/store');
  const indexPath = require.resolve('../lib/index');
  delete require.cache[storePath];
  delete require.cache[indexPath];
  process.env.VISPNOTE_HOME = tmpHome;
  try {
    const store = require('../lib/store');
    await store.loadConfig();
    return await fn(require('../lib/index'), store);
  } finally {
    try { require('../lib/index').close(); } catch {}
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

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, date: over.date ?? '2026-01-01',
  tags: over.tags ?? [], body: over.body ?? '', ...over,
});

test('opening the index twice returns the same connection, and closing is safe', async () => {
  await withIsolatedIndex(async (idx) => {
    const first = idx.init();
    assert.equal(idx.init(), first, 'a second init reuses the open database');
    idx.close();
    idx.close();
    // Every query opens the index on demand, so working after a close is fine.
    assert.deepEqual(idx.tagCounts('vault_a'), []);
  });
});

test('backlinks list the notes that link to a title, and never the note itself', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      note('hub', { title: 'Project Hub', body: 'See [[Alpha Spec]] for detail.' }),
      note('other', { title: 'Other', body: 'Also [[alpha spec]] here.' }),
      note('alpha', { title: 'Alpha Spec', body: 'Self reference [[Alpha Spec]].' }),
      note('aliased', { title: 'Aliased', body: 'An [[Alpha Spec|aliased]] link.' }),
      note('anchored', { title: 'Anchored', body: 'An [[Alpha Spec#Section]] link.' }),
      note('none', { title: 'None', body: 'no links at all' }),
    ]);
    const links = idx.backlinks('vault_a', 'Alpha Spec');
    assert.deepEqual(new Set(links.map(l => l.id)), new Set(['hub', 'other', 'aliased', 'anchored']),
      'a link is a link whatever its case, alias or anchor -- but a note does not link to itself');
    assert.match(links.find(l => l.id === 'hub').context, /See \[\[Alpha Spec\]\] for detail\./,
      'each backlink quotes the line it appeared on');
    assert.deepEqual(idx.backlinks('vault_a', 'Nothing Here'), []);
    assert.deepEqual(idx.backlinks('vault_b', 'Alpha Spec'), [], 'backlinks never cross a vault');
    assert.equal(idx.backlinks('vault_a', 'Alpha Spec', 1).length, 1, 'the limit is honoured');
    assert.equal(idx.backlinks('vault_a', 'Alpha Spec', 9999).length, 4, 'and an absurd limit is clamped');
    assert.equal(idx.backlinks('vault_a', 'Alpha Spec', 'lots').length, 4);
  });
});

test('unlinked mentions find prose that names a note without linking it', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      note('plain', { title: 'Plain', body: 'We discussed the Alpha Spec yesterday.' }),
      note('linked', { title: 'Linked', body: 'We read [[Alpha Spec]] instead.' }),
      note('inside', { title: 'Inside', body: 'Only [[Alpha Spec|the spec]] appears here.' }),
      note('stemmed', { title: 'Stemmed', body: 'The alpha specs were long.' }),
      note('alpha', { title: 'Alpha Spec', body: 'The Alpha Spec itself.' }),
    ]);
    const found = idx.unlinkedMentions('vault_a', 'Alpha Spec');
    assert.deepEqual(found.map(m => m.id), ['plain'],
      'a note that already links, one that only mentions it inside a link, a stemmed near-match and the note itself all drop out');
    assert.ok(found[0].snippet, 'a mention comes with the text around it');

    assert.deepEqual(idx.unlinkedMentions('vault_a', '   '), [], 'an empty title mentions nothing');
    assert.deepEqual(idx.unlinkedMentions('vault_a', 'Nothing Here'), []);
    assert.equal(idx.unlinkedMentions('vault_a', 'Alpha Spec', 0).length, 1, 'the limit has a floor of one');
    assert.deepEqual(idx.unlinkedMentions('vault_a', 'quote " mark'), [],
      'a quote in the title cannot break the phrase query');
  });
});

test('tags are listed and counted per vault', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      note('n1', { tags: ['work', 'urgent'], date: '2026-01-03' }),
      note('n2', { tags: ['work'], date: '2026-01-01' }),
      note('n3', { tags: [] }),
    ]);
    idx.rescanVault('vault_b', [note('m1', { tags: ['work'] })]);
    assert.deepEqual(idx.notesByTag('vault_a', 'work'), ['n1', 'n2'], 'newest first');
    assert.deepEqual(idx.notesByTag('vault_a', 'urgent'), ['n1']);
    assert.deepEqual(idx.notesByTag('vault_a', 'nothing'), []);
    assert.deepEqual(idx.tagCounts('vault_a'), [{ tag: 'work', count: 2 }, { tag: 'urgent', count: 1 }],
      'counts are per vault and ordered by how common the tag is');
    assert.deepEqual(idx.tagCounts('vault_b'), [{ tag: 'work', count: 1 }]);
    assert.deepEqual(idx.tagCounts('vault_c'), []);
  });
});

test('detailed search says which field matched, and reports its own failures', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      note('t', { title: 'Zorbulax plan', body: 'nothing special', tags: [] }),
      note('b', { title: 'Other', body: 'the zorbulax lives here', tags: [] }),
      note('g', { title: 'Tagged', body: 'unrelated words', tags: ['zorbulax'] }),
    ]);
    const rows = idx.searchDetailed('vault_a', 'zorbulax');
    assert.deepEqual(new Set(rows.map(r => r.id)), new Set(['t', 'b', 'g']));
    assert.deepEqual(rows.find(r => r.id === 't').matchedFields, ['title']);
    assert.deepEqual(rows.find(r => r.id === 'b').matchedFields, ['body']);
    assert.deepEqual(rows.find(r => r.id === 'g').matchedFields, ['tags']);
    assert.deepEqual(rows.find(r => r.id === 'g').tags, ['zorbulax']);
    assert.ok(rows[0].snippet);
    assert.equal(rows[0].pinned, false);
    assert.ok(rows[0].date);

    const status = idx.searchDetailedStatus('vault_a', 'zorbulax');
    assert.equal(status.ok, true);
    assert.equal(status.results.length, 3);
    assert.deepEqual(idx.searchDetailed('vault_a', ''), [], 'an empty query is not a search');
    assert.equal(idx.searchDetailedStatus('vault_a', '').ok, true);
    assert.deepEqual(idx.searchDetailed('vault_a', { not: 'a string' }), []);
  });
});

test('lexical context search feeds Ask AI when there are no embeddings', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      note('n1', { title: 'WAL mode', body: 'Use WAL mode for concurrent sqlite readers.' }),
      note('n2', { title: 'Titles only' }),
    ]);
    const hits = idx.lexicalContextSearch('vault_a', 'sqlite');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].noteId, 'n1');
    assert.equal(hits[0].mode, 'keyword', 'the caller can tell this was not a semantic hit');
    assert.equal(hits[0].chunkIdx, 0);
    assert.ok(hits[0].chunkText);

    const titleOnly = idx.lexicalContextSearch('vault_a', 'Titles');
    assert.equal(titleOnly[0].chunkText, 'Titles only', 'a note with no body falls back to its title');
    assert.deepEqual(idx.lexicalContextSearch('vault_a', 'nothingmatches'), []);
    assert.deepEqual(idx.lexicalContextSearch('vault_a', ''), []);
    assert.equal(idx.lexicalContextSearch('vault_a', 'sqlite', 9999).length, 1, 'the limit is clamped');
  });
});

test('removing a vault clears its notes, tags, links, text and vectors', async () => {
  await withIsolatedIndex(async (idx) => {
    const kept = note('m1', { title: 'Kept', tags: ['work'], body: 'zorbulax elsewhere' });
    idx.rescanVault('vault_a', [note('n1', { title: 'Gone', tags: ['work'], body: 'zorbulax here [[Kept]]' })]);
    idx.rescanVault('vault_b', [kept]);
    const target = note('n1', { title: 'Gone', tags: ['work'], body: 'zorbulax here [[Kept]]' });
    idx.setNoteEmbeddings('vault_a', target, idx.chunkNote(target).map((_c, i) => vec(i, 1)), 'nomic-embed-text');
    assert.ok(idx.embeddingStats().some(row => row.vaultId === 'vault_a'));

    idx.removeVault('vault_a');
    assert.deepEqual(idx.search('vault_a', 'zorbulax'), []);
    assert.deepEqual(idx.tagCounts('vault_a'), []);
    assert.deepEqual(idx.backlinks('vault_a', 'Kept'), []);
    assert.equal(idx.embeddingStats().some(row => row.vaultId === 'vault_a'), false);
    assert.equal(idx.search('vault_b', 'zorbulax').length, 1, 'the other vault is untouched');
  });
});

test('removing one note leaves the rest of the vault alone', async () => {
  await withIsolatedIndex(async (idx) => {
    const doomed = note('n1', { title: 'Doomed', tags: ['work'], body: 'zorbulax one' });
    idx.rescanVault('vault_a', [doomed, note('n2', { title: 'Safe', tags: ['work'], body: 'zorbulax two' })]);
    idx.setNoteEmbeddings('vault_a', doomed, idx.chunkNote(doomed).map((_c, i) => vec(i, 1)), 'nomic-embed-text');
    idx.removeNote('vault_a', 'n1');
    assert.deepEqual(idx.search('vault_a', 'zorbulax').map(r => r.id), ['n2']);
    assert.deepEqual(idx.tagCounts('vault_a'), [{ tag: 'work', count: 1 }]);
    assert.deepEqual(idx.vectorSearch('vault_a', vec(0), 5), [], 'its vectors go with it');
    assert.doesNotThrow(() => idx.removeNote('vault_a', 'never-existed'));

    // indexNote replaces a note wholesale rather than adding a second copy.
    idx.indexNote('vault_a', note('n2', { title: 'Safe', tags: ['other'], body: 'rewritten body' }));
    assert.deepEqual(idx.search('vault_a', 'zorbulax'), []);
    assert.deepEqual(idx.search('vault_a', 'rewritten').map(r => r.id), ['n2']);
    assert.deepEqual(idx.tagCounts('vault_a'), [{ tag: 'other', count: 1 }]);
  });
});

test('a note is chunked for embedding without its property lines', async () => {
  await withIsolatedIndex(async (idx) => {
    const chunks = idx.chunkNote({
      title: '  The Meeting  ',
      body: 'status:: DRAFT\npov:: Ada\n\nFirst paragraph.\n\nSecond paragraph.',
    });
    assert.equal(chunks[0], 'The Meeting', 'the title is always the first chunk, so titles are searchable');
    assert.deepEqual(chunks.slice(1), ['First paragraph.', 'Second paragraph.']);
    assert.ok(!chunks.some(c => c.includes('status::')), 'property lines are metadata, not content');

    assert.deepEqual(idx.chunkNote({ title: '   ', body: '' }), [], 'a note with nothing in it has no chunks');
    assert.deepEqual(idx.chunkNote({ title: 'Only a title' }), ['Only a title']);

    // A long paragraph is split by sentence, and a single unsplittable
    // sentence is hard-capped rather than sent whole.
    const long = idx.chunkNote({ title: 'T', body: `${'Sentence here. '.repeat(80)}` });
    assert.ok(long.length > 2);
    assert.ok(long.every(chunk => chunk.length <= 600));
    const oneSentence = idx.chunkNote({ title: 'T', body: 'x'.repeat(2000) });
    assert.ok(oneSentence.every(chunk => chunk.length <= 600));
    assert.equal(oneSentence.length, 5, 'the title plus four capped pieces');
  });
});

test('an embedding must be the right size and must mean something', async () => {
  await withIsolatedIndex(async (idx) => {
    const target = note('n1', { title: 'Vectors', body: 'A body.' });
    idx.rescanVault('vault_a', [target]);
    const chunks = idx.chunkNote(target);
    assert.throws(() => idx.setNoteEmbeddings('vault_a', target, [vec(0)], 'nomic-embed-text'),
      /Chunk\/embedding count mismatch/);
    assert.throws(() => idx.setNoteEmbeddings('vault_a', target, chunks.map(() => new Float32Array(10)), 'nomic-embed-text'),
      /Embedding dim mismatch: got 10, expected 768/);
    assert.throws(() => idx.setNoteEmbeddings('vault_a', target, chunks.map(() => new Float32Array(768)), 'nomic-embed-text'),
      /Embedding vector is empty/, 'an all-zero vector has no direction and cannot be compared');

    // A plain array is accepted alongside a Float32Array.
    const asArrays = chunks.map((_c, i) => Array.from(vec(i, 2)));
    assert.equal(idx.setNoteEmbeddings('vault_a', target, asArrays, 'nomic-embed-text').committed, true);
    const hits = idx.vectorSearch('vault_a', vec(0), 5);
    assert.equal(hits[0].noteId, 'n1');
    assert.equal(hits[0].chunkIdx, 0);
    assert.equal(hits[0].title, 'Vectors');
    assert.equal(idx.vectorSearch('vault_b', vec(0), 5).length, 0, 'vectors never cross a vault');
    assert.equal(idx.vectorSearch('vault_a', vec(0), 9999).length <= 32, true, 'the neighbour count is capped');
    assert.equal(idx.vectorSearch('vault_a', vec(0), 'lots').length > 0, true);

    idx.removeEmbeddings('vault_a', 'n1');
    assert.deepEqual(idx.vectorSearch('vault_a', vec(0), 5), []);
    assert.deepEqual(idx.notesNeedingEmbeddings('vault_a', 'nomic-embed-text'), ['n1']);
    assert.doesNotThrow(() => idx.removeEmbeddings('vault_a', 'never-existed'));
  });
});

test('the health report says exactly what the index is missing', async () => {
  await withIsolatedIndex(async (idx) => {
    const embedded = note('n1', { title: 'Embedded', body: 'A body.' });
    idx.rescanVault('vault_a', [embedded, note('n2', { title: 'Bare', body: 'Another body.' })]);
    idx.setNoteEmbeddings('vault_a', embedded, idx.chunkNote(embedded).map((_c, i) => vec(i, 1)), 'nomic-embed-text');

    const health = idx.indexHealth('vault_a', 'nomic-embed-text');
    assert.equal(health.vaultId, 'vault_a');
    assert.equal(health.model, 'nomic-embed-text');
    assert.equal(health.indexedNoteCount, 2);
    assert.equal(health.ftsIndexedNoteCount, 2);
    assert.equal(health.embeddingNoteCount, 1);
    assert.ok(health.embeddingChunkCount > 0);
    assert.equal(health.missingEmbeddingCount, 1);
    assert.deepEqual(health.missingEmbeddingNoteIds, ['n2']);
    assert.equal(health.modelMismatchNoteCount, 0);
    assert.equal(typeof health.reindexNeeded, 'boolean');
    assert.equal(typeof health.failureReason, 'string');
    assert.ok(health.checkedAt);

    // Asking about a different model makes every existing vector a mismatch.
    const other = idx.indexHealth('vault_a', 'some-other-model');
    assert.equal(other.modelMismatchNoteCount, 1);
    assert.equal(other.missingEmbeddingCount, 2);
    assert.equal(other.embeddingNoteCount, 0);

    const emptyVault = idx.indexHealth('vault_zzz');
    assert.equal(emptyVault.indexedNoteCount, 0);
    assert.equal(emptyVault.missingEmbeddingCount, 0);
    assert.ok(emptyVault.model, 'a health check with no model named still reports one');

    idx.markEmbeddingsNormalized();
    assert.equal(idx.indexHealth('vault_a', 'nomic-embed-text').reindexNeeded, false);
  });
});
