const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every id the store is handed becomes a file path under the vault folder, and
// every write can collide with the file watcher or another window. These are
// the guards: an id that could escape the folder is refused outright, and a
// write that would clobber a newer copy is refused with a conflict.

async function withIsolatedStore(fn) {
  const previous = process.env.VISPNOTE_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-store-ids-'));
  const storePath = require.resolve('../lib/store');
  delete require.cache[storePath];
  process.env.VISPNOTE_HOME = home;
  try {
    return await fn(require('../lib/store'), home);
  } finally {
    delete require.cache[storePath];
    if (previous === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const HOSTILE_IDS = ['', '..', '../escape', 'a/b', 'with space', 'nul ', '.', '~/escape', 'a.b'];

test('an id that could escape the vault folder is refused before any file is touched', async () => {
  await withIsolatedStore(async (store) => {
    const t = store.__test;
    for (const id of HOSTILE_IDS) {
      assert.throws(() => t.validateNoteId(id), /Invalid note id/, `note id ${JSON.stringify(id)} was accepted`);
      assert.throws(() => t.validateCanvasId(id), /Invalid canvas id/);
      assert.throws(() => t.validateTrashId(id), /Invalid trash id/);
      assert.throws(() => t.validateVersionId(id), /Invalid version id/);
    }
    assert.equal(t.validateNoteId('note_123-abc'), 'note_123-abc');
    assert.equal(t.validateCanvasId('canvas_1'), 'canvas_1');
    assert.equal(t.validateTrashId('trash_1'), 'trash_1');
    assert.equal(t.validateVersionId('v_1'), 'v_1');
  });
});

test('the public API refuses a hostile id at every entry point', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    for (const id of ['../escape', 'a/b', '']) {
      await assert.rejects(store.getNote(vault.id, id), /Invalid note id/);
      await assert.rejects(store.saveNote(vault.id, { id, title: 'T', body: '' }), /Invalid note id/);
      await assert.rejects(store.deleteNote(vault.id, id), /Invalid note id/);
      await assert.rejects(store.listNoteVersions(vault.id, id), /Invalid note id/);
      await assert.rejects(store.getCanvas(vault.id, id), /Invalid canvas id/);
      await assert.rejects(store.deleteCanvas(vault.id, id), /Invalid canvas id/);
      await assert.rejects(store.restoreDeletedNote(vault.id, id), /Invalid trash id/);
      await assert.rejects(store.purgeDeletedNote(vault.id, id), /Invalid trash id/);
      await assert.rejects(store.restoreDeletedCanvas(vault.id, id), /Invalid trash id/);
      await assert.rejects(store.purgeDeletedCanvas(vault.id, id), /Invalid trash id/);
    }
    await assert.rejects(store.getNoteVersion(vault.id, 'n1', '../escape'), /Invalid version id/);
    await assert.rejects(store.restoreNoteVersion(vault.id, 'n1', 'a/b'), /Invalid version id/);
  });
});

test('a write is refused when the copy on disk is not the one it was based on', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const saved = await store.saveNote(vault.id, { id: 'n1', title: 'First', body: 'one' });
    assert.ok(saved.diskRevision, 'a saved note carries the revision it was written as');

    // The same revision saves cleanly; a stale one is a conflict.
    const second = await store.saveNote(vault.id, { id: 'n1', title: 'Second', body: 'two' },
      { expectedRevision: saved.diskRevision });
    assert.equal(second.title, 'Second');
    await assert.rejects(
      store.saveNote(vault.id, { id: 'n1', title: 'Third', body: 'three' }, { expectedRevision: saved.diskRevision }),
      err => {
        assert.match(String(err.message), /conflict|changed/i);
        return true;
      },
      'a save based on a revision that is no longer on disk must not overwrite it');
    assert.equal((await store.getNote(vault.id, 'n1')).title, 'Second', 'and the newer copy survives');

    // Only a real revision string is accepted as a precondition.
    for (const bad of ['not-a-revision', 'abc', 'z'.repeat(64), 123]) {
      await assert.rejects(
        store.saveNote(vault.id, { id: 'n2', title: 'T', body: '' }, { expectedRevision: bad }),
        /Invalid expected revision/, `${bad} was accepted as a revision`);
    }
    assert.ok(await store.saveNote(vault.id, { id: 'n3', title: 'New', body: '' }, { expectedRevision: null }),
      'an explicit null means "this note is new"');
    await assert.rejects(
      store.saveNote(vault.id, { id: 'n1', title: 'Clobber', body: '' }, { expectedRevision: null }),
      /changed on disk/i, 'claiming a note is new when it is not must not overwrite it');
  });
});

test('a note body larger than the store will write is refused, not truncated', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const huge = 'x'.repeat(store.__test.MAX_NOTE_BODY_BYTES + 10);
    await assert.rejects(store.saveNote(vault.id, { id: 'big', title: 'Big', body: huge }), /too large|exceeds/i);
    assert.equal(await store.getNote(vault.id, 'big'), null, 'nothing is left behind by a refused write');
  });
});

test('vault metadata patches cannot carry a prototype key', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const patch = JSON.parse(`{"${key}": {"polluted": true}}`);
      await assert.rejects(store.saveVaultMeta(vault.id, patch), /Unsupported|Invalid/i,
        `${key} was accepted into vault metadata`);
    }
    assert.equal({}.polluted, undefined, 'nothing reached Object.prototype');
    await assert.rejects(store.saveVaultMeta(vault.id, 'not an object'), /Invalid|Unsupported/i);
  });
});

test('a vault folder name is slugged, and a taken one is numbered', async () => {
  await withIsolatedStore(async (store, home) => {
    const first = await store.createVault('My Notes!');
    assert.match(first.slug, /^my-notes$/);
    const second = await store.createVault('My Notes');
    assert.notEqual(second.slug, first.slug, 'two vaults never share a folder');
    assert.match(second.slug, /^my-notes-\d+$/);
    const unnamed = await store.createVault('!!!');
    assert.ok(unnamed.slug, 'a name with nothing sluggable still gets a folder');
    assert.ok(fs.existsSync(path.join(home, first.slug)));
  });
});

test('a note round-trips through the trash and back', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await store.saveNote(vault.id, { id: 'n1', title: 'Doomed', body: 'body' });
    const deleted = await store.deleteNote(vault.id, 'n1');
    assert.ok(deleted, 'deleting reports what it moved');
    assert.equal(await store.getNote(vault.id, 'n1'), null);

    const trashed = await store.listDeletedNotes(vault.id);
    assert.equal(trashed.length, 1);
    assert.equal(trashed[0].title, 'Doomed');
    const restored = await store.restoreDeletedNote(vault.id, trashed[0].trashId || trashed[0].id);
    assert.ok(restored);
    assert.equal((await store.getNote(vault.id, 'n1')).title, 'Doomed');
    assert.deepEqual(await store.listDeletedNotes(vault.id), []);

    await store.deleteNote(vault.id, 'n1');
    const again = await store.listDeletedNotes(vault.id);
    await store.purgeDeletedNote(vault.id, again[0].trashId || again[0].id);
    assert.deepEqual(await store.listDeletedNotes(vault.id), [], 'a purged note is gone for good');
  });
});

test('a revision is the hash of exactly what was written', async () => {
  await withIsolatedStore(async (store) => {
    const { calculateDiskRevision } = store.__test;
    const a = calculateDiskRevision('some content');
    assert.match(a, /^[a-f0-9]{64}$/);
    assert.equal(calculateDiskRevision(Buffer.from('some content', 'utf8')), a,
      'a buffer and the same text hash identically');
    assert.notEqual(calculateDiskRevision('some content '), a);
    assert.equal(calculateDiskRevision(''), calculateDiskRevision(null),
      'nothing and an empty string are the same nothing');
  });
});
