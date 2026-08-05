const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// How the index decides a row matched, and what it does when the thing it is
// asked about is not quite there. index-queries.test.js pins the read paths;
// this pins the matching rules inside them -- word boundaries, stale vectors,
// and the queries that must come back empty rather than throw.

async function withIsolatedIndex(fn) {
  const previous = process.env.VISPNOTE_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-index-m-'));
  const storePath = require.resolve('../lib/store');
  const indexPath = require.resolve('../lib/index');
  delete require.cache[storePath];
  delete require.cache[indexPath];
  process.env.VISPNOTE_HOME = home;
  try {
    const store = require('../lib/store');
    await store.loadConfig();
    return await fn(require('../lib/index'));
  } finally {
    try { require('../lib/index').close(); } catch {}
    delete require.cache[indexPath];
    delete require.cache[storePath];
    if (previous === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const vec = (dim, value = 1) => { const out = new Float32Array(768); out[dim] = value; return out; };
const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, date: over.date ?? '2026-01-01',
  tags: over.tags ?? [], body: over.body ?? '', ...over,
});

test('an unlinked mention has to stand as its own word', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      note('exact', { title: 'Exact', body: 'We discussed the Plan today.' }),
      note('inside', { title: 'Inside', body: 'Planning takes a while.' }),
      note('joined', { title: 'Joined', body: 'The subPlan is separate.' }),
      note('punctuated', { title: 'Punctuated', body: 'About the "Plan", briefly.' }),
      note('plan', { title: 'Plan', body: 'The plan itself.' }),
    ]);
    const found = idx.unlinkedMentions('vault_a', 'Plan').map(m => m.id).sort();
    assert.deepEqual(found, ['exact', 'punctuated'],
      'a title inside a longer word is not a mention of it; punctuation around it is');
    assert.equal(idx.unlinkedMentions('vault_a', 'Plan').every(m => m.title && m.snippet), true,
      'each mention comes back ready to render');
  });
});

test('a mention hidden inside a wiki link does not count as an unlinked one', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      note('only-link', { title: 'Only link', body: 'See [[Alpha Spec]] for detail.' }),
      note('link-and-text', { title: 'Both', body: 'See [[Beta]] and also Alpha Spec in prose.' }),
      note('alpha', { title: 'Alpha Spec', body: 'itself' }),
      note('beta', { title: 'Beta', body: 'other' }),
    ]);
    assert.deepEqual(idx.unlinkedMentions('vault_a', 'Alpha Spec').map(m => m.id), ['link-and-text'],
      'a note that only names the title inside a link has nothing left to link');
  });
});

test('detailed search reports body as the field when nothing else matched', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [note('n1', { title: 'Plain title', body: 'zorbulax appears here', tags: ['other'] })]);
    const [row] = idx.searchDetailed('vault_a', 'zorbulax');
    assert.deepEqual(row.matchedFields, ['body']);

    // A row that FTS matched but the literal query does not appear in still
    // says "body" rather than claiming no field matched at all.
    const [stemmed] = idx.searchDetailed('vault_a', 'appearing');
    if (stemmed) assert.deepEqual(stemmed.matchedFields, ['body']);

    const multi = idx.searchDetailed('vault_a', 'plain');
    assert.deepEqual(multi[0].matchedFields, ['title']);
  });
});

test('a search for nothing returns nothing rather than everything', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [note('n1', { body: 'some body' })]);
    for (const query of ['', '   ', null, undefined, { bad: true }, []]) {
      assert.deepEqual(idx.search('vault_a', query), [], `${JSON.stringify(query)} should match nothing`);
      assert.deepEqual(idx.searchDetailed('vault_a', query), []);
      assert.deepEqual(idx.lexicalContextSearch('vault_a', query), []);
      assert.equal(idx.searchDetailedStatus('vault_a', query).ok, true);
    }
    assert.doesNotThrow(() => idx.search('vault_a', 42), 'a non-string query is stringified, not rejected');
    assert.deepEqual(idx.search('vault_a', '"unbalanced'), [],
      'a query FTS cannot parse yields no results rather than an error');
    assert.equal(idx.search('vault_a', 'AND OR NOT').length, 1,
      'FTS keywords are escaped into ordinary terms, so they search rather than break the query');
  });
});

test('a vector hit whose note has since changed is not shown', async () => {
  await withIsolatedIndex(async (idx) => {
    const original = note('n1', { title: 'Vectors', body: 'The first body.' });
    idx.rescanVault('vault_a', [original]);
    const chunks = idx.chunkNote(original);
    idx.setNoteEmbeddings('vault_a', original, chunks.map((_c, i) => vec(i, 1)), 'nomic-embed-text');
    assert.equal(idx.vectorSearch('vault_a', vec(0), 5).length > 0, true);

    // Rewriting the note leaves the old vectors behind; they must not surface.
    idx.rescanVault('vault_a', [{ ...original, body: 'A different body entirely.' }]);
    assert.deepEqual(idx.vectorSearch('vault_a', vec(0), 5), [],
      'a chunk that describes text no longer in the note is not a result');
    assert.deepEqual(idx.notesNeedingEmbeddings('vault_a', 'nomic-embed-text'), ['n1']);
  });
});

test('embedding a note that is not indexed is refused rather than orphaned', async () => {
  await withIsolatedIndex(async (idx) => {
    const stranger = note('ghost', { body: 'A body.' });
    const result = idx.setNoteEmbeddings('vault_a', stranger,
      idx.chunkNote(stranger).map((_c, i) => vec(i, 1)), 'nomic-embed-text');
    assert.deepEqual(result, { committed: false, currentContentHash: null },
      'there is no note to attach these vectors to');
    assert.deepEqual(idx.vectorSearch('vault_a', vec(0), 5), []);
  });
});

test('a note with no tags, links or body indexes without complaint', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [
      { id: 'bare' },
      { id: 'titled', title: 'Has a title' },
      { id: 'tagless', title: 'Tagless', body: 'words here', tags: null },
    ]);
    assert.deepEqual(idx.tagCounts('vault_a'), []);
    assert.deepEqual(idx.backlinks('vault_a', 'Has a title'), []);
    assert.deepEqual(idx.search('vault_a', 'words').map(r => r.id), ['tagless']);
    assert.equal(idx.indexHealth('vault_a').indexedNoteCount, 3);
    assert.equal(idx.indexHealth('vault_a').ftsIndexedNoteCount, 3);
  });
});

test('rescanning the same vault twice changes nothing the second time', async () => {
  await withIsolatedIndex(async (idx) => {
    const notes = [note('n1', { body: 'one', tags: ['a'] }), note('n2', { body: 'two [[Note n1]]' })];
    idx.rescanVault('vault_a', notes);
    const first = idx.searchDetailed('vault_a', 'one');
    idx.rescanVault('vault_a', notes);
    const second = idx.searchDetailed('vault_a', 'one');
    assert.deepEqual(second.map(r => r.id), first.map(r => r.id));
    assert.deepEqual(idx.tagCounts('vault_a'), [{ tag: 'a', count: 1 }], 'a tag is not counted twice');
    assert.equal(idx.backlinks('vault_a', 'Note n1').length, 1, 'nor is a link recorded twice');
    assert.equal(idx.indexHealth('vault_a').indexedNoteCount, 2);
  });
});

test('note ids are stored per vault and read back without their prefix', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.rescanVault('vault_a', [note('shared', { body: 'zorbulax in a' })]);
    idx.rescanVault('vault_b', [note('shared', { body: 'zorbulax in b' })]);
    assert.deepEqual(idx.search('vault_a', 'zorbulax').map(r => r.id), ['shared']);
    assert.deepEqual(idx.search('vault_b', 'zorbulax').map(r => r.id), ['shared']);
    assert.match(idx.searchDetailed('vault_a', 'zorbulax')[0].snippet, /in a/,
      'two vaults may hold the same note id without their rows merging');
    idx.removeVault('vault_a');
    assert.equal(idx.search('vault_b', 'zorbulax').length, 1);
  });
});
