const test = require('node:test');
const assert = require('node:assert/strict');

const { withIsolatedStore } = require('./helpers/common.js');

// Two data-loss-class user expectations that until now were covered only by
// source-text greps, not behaviour:
//
// 1. Restoring an old version must be REVERSIBLE: the content you had before
//    the restore must itself survive as a version, or restore is a destroy.
// 2. Delete -> trash -> restore must give the note back exactly as it was.
//
// Both run against the real store on a real temp filesystem.

async function makeVault(store) {
  await store.loadConfig();
  const vault = await store.createVault('Behaviour Vault');
  return vault.id;
}

const NOTE = { id: 'n_behave1', title: 'Version me', body: 'first draft', tags: ['keep'] };

test('restoring an old version does not destroy the content you had', async () => {
  await withIsolatedStore(async (store) => {
    const vaultId = await makeVault(store);
    const first = await store.saveNote(vaultId, { ...NOTE }, { expectedRevision: null });
    const second = await store.saveNote(vaultId, { ...NOTE, body: 'second draft, much longer and more valuable' },
      { expectedRevision: first.diskRevision });

    const versions = await store.listNoteVersions(vaultId, NOTE.id);
    assert.ok(versions.length >= 1, 'saving twice left no version history at all');

    // Restore the oldest version (the first draft).
    const oldest = versions[versions.length - 1];
    await store.restoreNoteVersion(vaultId, NOTE.id, oldest.versionId, { expectedRevision: second.diskRevision });

    const current = await store.getNote(vaultId, NOTE.id);
    assert.match(current.body, /first draft/, 'restore did not bring the old content back');

    // The reversibility expectation: the pre-restore content must still be
    // reachable through history, or the user just lost their newest work.
    const versionsAfter = await store.listNoteVersions(vaultId, NOTE.id);
    let secondDraftSurvives = false;
    for (const v of versionsAfter) {
      const version = await store.getNoteVersion(vaultId, NOTE.id, v.versionId);
      const body = String(version?.body ?? version ?? '');
      if (body.includes('second draft')) secondDraftSurvives = true;
    }
    assert.ok(secondDraftSurvives,
      'restoring an old version silently destroyed the newest content -- it exists in no version');
  });
});

test('a deleted note comes back from the trash exactly as it was', async () => {
  await withIsolatedStore(async (store) => {
    const vaultId = await makeVault(store);
    const saved = await store.saveNote(vaultId,
      { id: 'n_trash1', title: 'Precious', body: 'do not lose me\n\n- [ ] with a task', tags: ['a', 'b'] },
      { expectedRevision: null });
    assert.ok(saved);

    await store.deleteNote(vaultId, 'n_trash1');
    const gone = await store.getNote(vaultId, 'n_trash1');
    assert.equal(gone, null, 'the note is still in the vault after deletion');

    const deleted = await store.listDeletedNotes(vaultId);
    assert.equal(deleted.length, 1, 'the deleted note is not listed in the trash');

    await store.restoreDeletedNote(vaultId, deleted[0].trashId);
    const back = await store.getNote(vaultId, 'n_trash1');
    assert.ok(back, 'restore did not bring the note back');
    assert.equal(back.title, 'Precious');
    assert.match(back.body, /do not lose me/);
    assert.match(back.body, /- \[ \] with a task/, 'the task line was lost in the trash round-trip');
    assert.deepEqual([...back.tags].sort(), ['a', 'b'], 'tags were lost in the trash round-trip');
  });
});

test('purging from the trash is the only way a note truly disappears', async () => {
  await withIsolatedStore(async (store) => {
    const vaultId = await makeVault(store);
    await store.saveNote(vaultId, { id: 'n_purge1', title: 'Ephemeral', body: 'x' }, { expectedRevision: null });
    await store.deleteNote(vaultId, 'n_purge1');
    const deleted = await store.listDeletedNotes(vaultId);
    await store.purgeDeletedNote(vaultId, deleted[0].trashId);
    assert.equal((await store.listDeletedNotes(vaultId)).length, 0, 'purge left the note in the trash');
    assert.equal(await store.getNote(vaultId, 'n_purge1'), null);
  });
});

test('deleting one note leaves its namesakes alone', async () => {
  // Same title, different ids -- deleting one must not touch the other.
  await withIsolatedStore(async (store) => {
    const vaultId = await makeVault(store);
    await store.saveNote(vaultId, { id: 'n_twin_a', title: 'Twin', body: 'keep A' }, { expectedRevision: null });
    await store.saveNote(vaultId, { id: 'n_twin_b', title: 'Twin', body: 'keep B' }, { expectedRevision: null });
    await store.deleteNote(vaultId, 'n_twin_a');
    const survivor = await store.getNote(vaultId, 'n_twin_b');
    assert.ok(survivor, 'deleting one twin deleted the other');
    assert.match(survivor.body, /keep B/);
  });
});
