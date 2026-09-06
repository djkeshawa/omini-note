const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deferred, flushMicrotasks, withIsolatedStore } = require('./helpers/common.js');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const { useAppLifecycleController } = loadRendererModule('src/app/controllers/useAppLifecycleController.js');

test('vault stamps detect edits with preserved mtimes and same-count file replacements', async () => {
  await withIsolatedStore(async (store, home) => {
    const [vault] = await store.listVaults();
    await store.saveNote(vault.id, { id: 'older', title: 'Older', body: 'before' });
    const file = path.join(home, vault.slug, 'older.md');
    const oldTime = new Date('2001-01-01T00:00:00Z');
    fs.utimesSync(file, oldTime, oldTime);
    const before = await store.vaultStamp(vault.id);
    fs.appendFileSync(file, '\nExternal edit');
    fs.utimesSync(file, oldTime, oldTime);
    const edited = await store.vaultStamp(vault.id);
    assert.equal(edited.count, before.count);
    assert.equal(edited.maxMtimeMs, before.maxMtimeMs);
    assert.notDeepEqual(edited, before, 'an older file can change without moving the newest mtime');
    fs.renameSync(file, path.join(home, vault.slug, 'replacement.md'));
    const replaced = await store.vaultStamp(vault.id);
    assert.notDeepEqual(replaced, edited, 'filenames matter even when counts and timestamps match');
    assert.deepEqual(await store.vaultStamp(vault.id), replaced, 'unchanged files produce stable stamps');
  });
});

function refreshHarness() {
  const bundle = deferred();
  const registry = deferred();
  const writes = [];
  let loads = 0;
  const props = {
    HAS_DISK: true, activeVaultId: 'v1', bootState: 'ready',
    notes: [{ id: 'n1', body: 'before' }], tags: [], canvases: [], selectedId: 'n1',
    dirtyNotes: new Map(), dirtyNotesRef: { current: new Map() },
    dirtyRevisionRef: { current: 0 }, tagsRevisionRef: { current: 0 },
    tagsDirty: { current: false }, vaultActivationSeq: { current: 0 },
    MN_NOTES_VAULTS_SERVICE: { listVaults: () => registry.promise },
    loadVaultBundle: () => { loads++; return bundle.promise; },
    desktopBridge: {}, useCallbackA: fn => fn, useEffectA() {},
    useRefA: current => ({ current }), updateDirtyNotes() {},
  };
  for (const key of ['setNotes', 'setTags', 'setCanvases', 'setActiveVaultId', 'setSelectedId', 'setVaults']) {
    props[key] = value => writes.push({ key, value });
  }
  const controller = useAppLifecycleController(props);
  return {
    props, writes, registry, bundle, controller, loads: () => loads,
    finishRegistry: () => registry.resolve({ ok: true, value: [{ id: 'v1' }] }),
    finishBundle: () => bundle.resolve({ notes: [{ id: 'n1', body: 'stale disk copy' }], tags: [], canvases: [] }),
  };
}

for (const phase of ['registry', 'notes']) {
  for (const kind of ['note', 'tags', 'already-saved note']) {
    test(`refresh preserves ${kind} edits made while loading ${phase}`, async () => {
      const h = refreshHarness();
      const refreshing = h.controller.refreshVaultRegistry({ reloadActive: true, reason: 'external-file-change' });
      if (phase === 'notes') {
        h.finishRegistry();
        await flushMicrotasks();
        assert.equal(h.loads(), 1);
      }
      if (kind === 'tags') {
        h.props.tagsRevisionRef.current++;
        h.props.tagsDirty.current = true;
      } else {
        h.props.dirtyRevisionRef.current++;
        if (kind === 'note') h.props.dirtyNotesRef.current.set('v1::n1', { vaultId: 'v1', id: 'n1' });
      }
      h.finishRegistry();
      h.finishBundle();
      await refreshing;
      assert.deepEqual(h.writes, [], 'a stale refresh must not commit any state over new edits');
    });
  }
}

test('a clean vault still accepts external changes', async () => {
  const h = refreshHarness();
  const refreshing = h.controller.refreshVaultRegistry({ reloadActive: true });
  h.finishRegistry();
  h.finishBundle();
  assert.equal((await refreshing).ok, true);
  assert.equal(h.writes.find(item => item.key === 'setNotes').value[0].body, 'stale disk copy');
});
