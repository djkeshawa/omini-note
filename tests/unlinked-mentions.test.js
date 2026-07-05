const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mutations = require('../src/app/appMutations.js');

async function withIsolatedIndex(fn) {
  const previousVispnoteHome = process.env.VISPNOTE_HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-mentions-'));
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
    try { require('../lib/index').close(); } catch {}
    delete require.cache[indexPath];
    delete require.cache[storePath];
    if (previousVispnoteHome === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previousVispnoteHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

test('unlinkedMentions finds plain mentions and excludes linked/self/stemmed matches', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    const vaultId = 'v_test';
    const notes = [
      { id: 'target', title: 'Project Phoenix', body: 'The plan itself.', tags: [], date: '2026-01-01' },
      { id: 'mentions', title: 'Meeting notes', body: 'Discussed project phoenix budget today.', tags: [], date: '2026-01-02' },
      { id: 'linked', title: 'Weekly review', body: 'See [[Project Phoenix]] for details.', tags: [], date: '2026-01-03' },
      { id: 'aliaslink', title: 'Alias user', body: 'Progress in [[Project Phoenix|the big one]].', tags: [], date: '2026-01-04' },
      { id: 'partial', title: 'Partial word', body: 'The Project Phoenixes multiplied.', tags: [], date: '2026-01-05' },
      { id: 'unrelated', title: 'Groceries', body: 'Milk and eggs.', tags: [], date: '2026-01-06' },
    ];
    for (const note of notes) idx.indexNote(vaultId, note);

    const hits = idx.unlinkedMentions(vaultId, 'Project Phoenix', 10);
    assert.deepEqual(hits.map(h => h.id), ['mentions']);
    assert.equal(hits[0].title, 'Meeting notes');
    assert.match(hits[0].snippet, /<mark>/);

    assert.deepEqual(idx.unlinkedMentions(vaultId, '', 10), []);
    assert.deepEqual(idx.unlinkedMentions(vaultId, 'No Such Note', 10), []);
  });
});

test('unlinkedMentions treats a mention inside an alias label as linked text', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    const vaultId = 'v_test';
    idx.indexNote(vaultId, {
      id: 'only-alias', title: 'Alias only',
      body: 'See [[Other Note|Project Phoenix]] here.', tags: [], date: '2026-01-01',
    });
    assert.deepEqual(idx.unlinkedMentions(vaultId, 'Project Phoenix', 10), []);
  });
});

test('linkMentionInBody wraps the first plain mention with word boundaries', () => {
  const { body, linked } = mutations.linkMentionInBody(
    'We discussed project phoenix and then Project Phoenix again.',
    'Project Phoenix'
  );
  assert.equal(linked, true);
  assert.equal(body, 'We discussed [[project phoenix]] and then Project Phoenix again.');
});

test('linkMentionInBody skips wiki links, code fences, and partial words', () => {
  const alreadyLinked = mutations.linkMentionInBody('See [[Project Phoenix]] here.', 'Project Phoenix');
  assert.equal(alreadyLinked.linked, false);

  const aliasLabel = mutations.linkMentionInBody('See [[Other|Project Phoenix]] here.', 'Project Phoenix');
  assert.equal(aliasLabel.linked, false);

  const fenced = mutations.linkMentionInBody('```\nProject Phoenix in code\n```', 'Project Phoenix');
  assert.equal(fenced.linked, false);

  const partial = mutations.linkMentionInBody('The Project Phoenixes multiplied.', 'Project Phoenix');
  assert.equal(partial.linked, false);

  const fencedThenPlain = mutations.linkMentionInBody(
    '```\nProject Phoenix\n```\nReal Project Phoenix mention.',
    'Project Phoenix'
  );
  assert.equal(fencedThenPlain.linked, true);
  assert.equal(fencedThenPlain.body, '```\nProject Phoenix\n```\nReal [[Project Phoenix]] mention.');

  const empty = mutations.linkMentionInBody('anything', '');
  assert.equal(empty.linked, false);
});

test('linkMentionInBody never corrupts image alts, link labels, or inline code', () => {
  const imageAlt = mutations.linkMentionInBody(
    '![Project Phoenix](attachments/a.png) then Project Phoenix.',
    'Project Phoenix'
  );
  assert.equal(imageAlt.linked, true);
  assert.equal(imageAlt.body, '![Project Phoenix](attachments/a.png) then [[Project Phoenix]].');

  const linkLabel = mutations.linkMentionInBody('[Project Phoenix](https://example.com) only.', 'Project Phoenix');
  assert.equal(linkLabel.linked, false, 'markdown link label is untouched');

  const inlineCode = mutations.linkMentionInBody('run `Project Phoenix` command', 'Project Phoenix');
  assert.equal(inlineCode.linked, false, 'inline code is untouched');
});

test('linkMentionInBody offsets survive unicode case folding', () => {
  const { body, linked } = mutations.linkMentionInBody(
    'İstanbul note then Project Phoenix here',
    'Project Phoenix'
  );
  assert.equal(linked, true);
  assert.equal(body, 'İstanbul note then [[Project Phoenix]] here');
});
