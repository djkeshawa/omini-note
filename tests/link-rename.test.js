const test = require('node:test');
const assert = require('node:assert/strict');

const linkRename = require('../lib/linkRename.js');
const notesVaultsService = require('../src/app/notesVaultsService.js');
const { withIsolatedStore } = require('./helpers/common.js');

test('rewriteWikiLinks rewrites plain, alias, and heading links case-insensitively', () => {
  const { body, count } = linkRename.rewriteWikiLinks(
    'See [[Old Title]] plus [[old title|the alias]] and [[Old Title#section]] but not [[Older Title]].',
    'Old Title',
    'New Title'
  );
  assert.equal(body, 'See [[New Title]] plus [[New Title|the alias]] and [[New Title#section]] but not [[Older Title]].');
  assert.equal(count, 3);
});

test('rewriteWikiLinks leaves embeds targets and unrelated text intact', () => {
  const { body, count } = linkRename.rewriteWikiLinks(
    '{{embed [[Old Title]]}} and plain Old Title text and ((blockref))',
    'Old Title',
    'New Title'
  );
  assert.equal(body, '{{embed [[New Title]]}} and plain Old Title text and ((blockref))');
  assert.equal(count, 1);

  const noop = linkRename.rewriteWikiLinks('nothing to do', 'Old', 'New');
  assert.equal(noop.body, 'nothing to do');
  assert.equal(noop.count, 0);
});

test('shouldRenameLinks skips empty and case-only changes', () => {
  assert.equal(linkRename.shouldRenameLinks('Old', 'New'), true);
  assert.equal(linkRename.shouldRenameLinks('Old', 'old'), false);
  assert.equal(linkRename.shouldRenameLinks('', 'New'), false);
  assert.equal(linkRename.shouldRenameLinks('Old', ''), false);
  assert.equal(linkRename.shouldRenameLinks('  Old  ', 'Old'), false);
});

test('renameNoteLinks rewrites linking notes on disk and skips the renamed note', async () => {
  await withIsolatedStore(async (store) => {
    const cfg = await store.loadConfig();
    const vaultId = cfg.vaults[0].id;
    await store.saveNote(vaultId, { id: 'target1', title: 'New Title', body: 'renamed note body [[New Title]]' });
    await store.saveNote(vaultId, { id: 'src1', title: 'Source', body: 'Link [[Old Title]] and [[old title|alias]]' });
    await store.saveNote(vaultId, { id: 'other1', title: 'Other', body: 'Unrelated [[Different Note]]' });

    const result = await linkRename.renameNoteLinks(store, vaultId, {
      renamedNoteId: 'target1',
      oldTitle: 'Old Title',
      newTitle: 'New Title',
    });

    assert.deepEqual(result.updatedNotes.map(n => n.id), ['src1']);
    assert.equal(result.linkCount, 2);
    assert.deepEqual(result.skippedNotes, []);

    const updated = await store.getNote(vaultId, 'src1');
    assert.equal(updated.body, 'Link [[New Title]] and [[New Title|alias]]');
    const untouched = await store.getNote(vaultId, 'other1');
    assert.equal(untouched.body, 'Unrelated [[Different Note]]');
  });
});

test('renameNoteLinks leaves links alone while another note still has the old title', async () => {
  await withIsolatedStore(async (store) => {
    const cfg = await store.loadConfig();
    const vaultId = cfg.vaults[0].id;
    await store.saveNote(vaultId, { id: 'renamed1', title: 'New Title', body: 'was Old Title' });
    await store.saveNote(vaultId, { id: 'twin1', title: 'Old Title', body: 'still owns the old title' });
    await store.saveNote(vaultId, { id: 'src1', title: 'Source', body: 'Link [[Old Title]]' });

    const result = await linkRename.renameNoteLinks(store, vaultId, {
      renamedNoteId: 'renamed1',
      oldTitle: 'Old Title',
      newTitle: 'New Title',
    });

    assert.deepEqual(result.updatedNotes, []);
    const source = await store.getNote(vaultId, 'src1');
    assert.equal(source.body, 'Link [[Old Title]]');
  });
});

test('renameLinksAfterSave detects the rename and reports updated notes', async () => {
  await withIsolatedStore(async (store) => {
    const cfg = await store.loadConfig();
    const vaultId = cfg.vaults[0].id;
    await store.saveNote(vaultId, { id: 'note1', title: 'Old Title', body: 'body' });
    await store.saveNote(vaultId, { id: 'src1', title: 'Source', body: '[[Old Title#part|alias]] link' });

    const previousNote = await store.getNote(vaultId, 'note1');
    const savedNote = await store.saveNote(vaultId, { id: 'note1', title: 'Brand New', body: 'body' });

    const seen = [];
    const updates = await linkRename.renameLinksAfterSave({
      store,
      vaultId,
      previousNote,
      savedNote,
      onNoteUpdated: (n) => { seen.push(n.id); },
    });
    assert.deepEqual(updates.map(n => n.id), ['src1']);
    assert.deepEqual(seen, ['src1']);
    const source = await store.getNote(vaultId, 'src1');
    assert.equal(source.body, '[[Brand New#part|alias]] link');

    // No-op when the title did not change.
    const again = await linkRename.renameLinksAfterSave({
      store,
      vaultId,
      previousNote: savedNote,
      savedNote,
    });
    assert.deepEqual(again, []);
  });
});

test('notesVaultsService.saveNote passes linked-note updates and rename titles through', async () => {
  const contractBridge = {
    notesVaults: {
      saveNote: async () => ({
        ok: true,
        data: {
          note: { id: 'n1', title: 'New' },
          linkedNoteUpdates: [{ id: 'n2', title: 'Src', body: '[[New]]' }],
          linkedNoteRename: { oldTitle: 'Old', newTitle: 'New' },
        },
      }),
    },
  };
  const res = await notesVaultsService.saveNote(contractBridge, 'v1', { id: 'n1' });
  assert.equal(res.ok, true);
  assert.equal(res.value.id, 'n1');
  assert.deepEqual(res.linkedNoteUpdates.map(n => n.id), ['n2']);
  assert.deepEqual(res.linkedNoteRename, { oldTitle: 'Old', newTitle: 'New' });

  const legacyBridge = {
    saveNote: async () => ({
      ok: true,
      value: {
        id: 'n1', title: 'New',
        linkedNoteUpdates: [{ id: 'n2' }],
        linkedNoteRename: { oldTitle: 'Old', newTitle: 'New' },
      },
    }),
  };
  const legacy = await notesVaultsService.saveNote(legacyBridge, 'v1', { id: 'n1' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.linkedNoteUpdates, undefined, 'extra fields are stripped from the note value');
  assert.deepEqual(legacy.linkedNoteUpdates.map(n => n.id), ['n2']);
  assert.deepEqual(legacy.linkedNoteRename, { oldTitle: 'Old', newTitle: 'New' });
});
