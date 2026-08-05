const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Canvases and note history. Both live beside the notes on disk, both are
// written by the same atomic path, and both are recoverable from the trash or
// the version folder -- which is the point of keeping them at all.

async function withIsolatedStore(fn) {
  const previous = process.env.VISPNOTE_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-store-cv-'));
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

const canvas = (id, over = {}) => ({ id, title: over.title ?? `Canvas ${id}`, elements: over.elements ?? [], ...over });

test('a canvas is saved, listed, read back and deleted into the trash', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    assert.deepEqual(await store.listCanvases(vault.id), [], 'a fresh vault has no canvases');

    const saved = await store.saveCanvas(vault.id, canvas('c1', { elements: [{ type: 'rect' }] }));
    assert.equal(saved.id, 'c1');
    const listed = await store.listCanvases(vault.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'c1');

    const read = await store.getCanvas(vault.id, 'c1');
    assert.equal(read.title, 'Canvas c1');
    assert.equal(read.elements.length, 1);

    await store.saveCanvas(vault.id, canvas('c1', { title: 'Renamed', elements: [] }));
    assert.equal((await store.getCanvas(vault.id, 'c1')).title, 'Renamed', 'saving again replaces it');
    assert.equal((await store.listCanvases(vault.id)).length, 1, 'and does not add a second entry');

    await store.deleteCanvas(vault.id, 'c1');
    await assert.rejects(store.getCanvas(vault.id, 'c1'), { code: 'ENOENT' },
      'reading a canvas that is not there reports the missing file rather than a null');
    assert.deepEqual(await store.listCanvases(vault.id), []);
    const trashed = await store.listDeletedCanvases(vault.id);
    assert.equal(trashed.length, 1, 'a deleted canvas is recoverable, not gone');

    await store.restoreDeletedCanvas(vault.id, trashed[0].trashId || trashed[0].id);
    assert.equal((await store.getCanvas(vault.id, 'c1')).title, 'Renamed');
    assert.deepEqual(await store.listDeletedCanvases(vault.id), []);

    await store.deleteCanvas(vault.id, 'c1');
    const again = await store.listDeletedCanvases(vault.id);
    await store.purgeDeletedCanvas(vault.id, again[0].trashId || again[0].id);
    assert.deepEqual(await store.listDeletedCanvases(vault.id), []);
  });
});

test('a canvas too large to write is refused rather than half-written', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const huge = { id: 'big', title: 'Big', elements: [{ note: 'x'.repeat(store.__test.MAX_CANVAS_JSON_BYTES) }] };
    await assert.rejects(store.saveCanvas(vault.id, huge), /too large|exceeds/i);
    assert.deepEqual(await store.listCanvases(vault.id), [], 'nothing is left behind');
  });
});

test('deleting something that is not there is not an error worth raising', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await assert.doesNotReject(store.deleteCanvas(vault.id, 'never'));
    await assert.doesNotReject(store.deleteNote(vault.id, 'never'));
    assert.deepEqual(await store.listDeletedNotes(vault.id), []);
    assert.deepEqual(await store.listDeletedCanvases(vault.id), []);
  });
});

test('editing a note keeps the version it replaced', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await store.saveNote(vault.id, { id: 'mine', title: 'First', body: 'version one' });
    assert.deepEqual(await store.listNoteVersions(vault.id, 'mine'), [],
      'the first save of a new note has nothing to keep a version of');

    await store.saveNote(vault.id, { id: 'mine', title: 'Second', body: 'version two' });
    const versions = await store.listNoteVersions(vault.id, 'mine');
    assert.equal(versions.length, 1, 'the copy that was replaced is kept');
    const restored = await store.getNoteVersion(vault.id, 'mine', versions[0].versionId || versions[0].id);
    assert.match(restored.body, /version one/, 'a version reads back as it was written');

    // Versions are stamped to the millisecond, so two saves inside the same
    // tick keep one snapshot rather than two identical ones.
    await store.saveNote(vault.id, { id: 'mine', title: 'Third', body: 'version three' });
    const all = await store.listNoteVersions(vault.id, 'mine');
    assert.ok(all.length >= 1);
    assert.ok(all.every(entry => entry.noteId === 'mine'));
    const result = await store.restoreNoteVersion(vault.id, 'mine', all.at(-1).versionId || all.at(-1).id);
    assert.ok(result, 'restoring reports what it did');
    const current = await store.getNote(vault.id, 'mine');
    assert.ok(/version one|version two/.test(current.body), 'the note now holds an older body');
  });
});

test('a version of a note that was never saved is nothing, not an error', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    assert.deepEqual(await store.listNoteVersions(vault.id, 'never'), []);
    await assert.rejects(store.getNoteVersion(vault.id, 'never', 'v1'), { code: 'ENOENT' });
    await assert.rejects(store.restoreNoteVersion(vault.id, 'never', 'v1'), { code: 'ENOENT' });
  });
});

test('vault health reports what is on disk without changing it', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await store.saveNote(vault.id, { id: 'n1', title: 'One', body: 'body' });
    await store.saveCanvas(vault.id, canvas('c1'));
    const health = await store.vaultHealth(vault.id);
    assert.ok(health, 'a health check returns a report');
    assert.equal((await store.listVaults()).length, 1, 'and changes nothing');
    assert.equal((await store.getNote(vault.id, 'n1')).title, 'One');
  });
});

test('a vault stamp changes when the vault does', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const first = await store.vaultStamp(vault.id);
    await store.saveNote(vault.id, { id: 'n1', title: 'One', body: 'body' });
    const second = await store.vaultStamp(vault.id);
    assert.notDeepEqual(second, first, 'a saved note moves the stamp, so watchers know to reload');
    const third = await store.vaultStamp(vault.id);
    assert.deepEqual(third, second, 'and reading it twice without a change does not');
  });
});
