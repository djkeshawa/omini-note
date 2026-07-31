const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const { createActionRegistryHelpers } = loadRendererModule('src/app/actions/actionRegistryHelpers.js');

function helperContext(overrides = {}) {
  return {
    activeCanvas: null,
    activeVault: null,
    activeVaultId: '',
    canvases: [],
    desktopBridge: {},
    hasDisk: false,
    markDirty() {},
    mutations: { applyNotePatch: (note, patch) => ({ ...note, ...patch }) },
    navigateView() {},
    notesWithBody: [],
    setNotes() {},
    setSelectedTag() {},
    setSelectedWorkflow() {},
    updateNoteBody() {},
    vaults: [],
    ...overrides,
  };
}

test('action registry helpers preserve note update and navigation behavior', () => {
  let notes = [
    { id: 'n1', title: 'First', tags: ['old'] },
    { id: 'n2', title: 'Second', tags: [] },
  ];
  let dirtyId = null;
  let body = 'Existing  ';
  const navigation = [];
  const helpers = createActionRegistryHelpers(helperContext({
    markDirty: id => { dirtyId = id; },
    navigateView: view => navigation.push(view),
    setNotes: updater => { notes = updater(notes); },
    setSelectedTag: value => navigation.push(['tag', value]),
    setSelectedWorkflow: value => navigation.push(['workflow', value]),
    updateNoteBody: (id, updater) => {
      assert.equal(id, 'n1');
      body = updater(body);
    },
  }));

  helpers.updateNoteTagsById('n1', tags => [...tags, 'new']);
  assert.deepEqual(notes[0].tags, ['old', 'new']);
  assert.deepEqual(notes[1].tags, []);
  assert.equal(dirtyId, 'n1');
  assert.equal(helpers.appendToBody(notes[0], '  Added  '), true);
  assert.equal(body, 'Existing\nAdded');
  assert.deepEqual(helpers.openView('graph'), { message: 'Opened graph.' });
  assert.deepEqual(navigation, [['tag', null], ['workflow', null], 'graph']);
});

test('action registry helpers resolve targets and fall back to ranked memory search', async () => {
  const notes = [
    { id: 'n1', title: 'Project Plan', tags: ['work'], body: 'Next quarterly milestone' },
    { id: 'n2', title: 'Reading', tags: ['quarterly'], body: 'Books' },
  ];
  const activeCanvas = { id: 'c0', title: 'Current' };
  const activeVault = { id: 'v0', name: 'Current vault' };
  const helpers = createActionRegistryHelpers(helperContext({
    activeCanvas,
    activeVault,
    activeVaultId: 'v0',
    canvases: [activeCanvas, { id: 'c1', title: 'Research Board' }],
    desktopBridge: { search: { searchDetailedStatus: async () => { throw new Error('offline'); } } },
    hasDisk: true,
    notesWithBody: notes,
    vaults: [activeVault, { id: 'v1', name: 'Research' }],
  }));

  assert.equal(helpers.resolveCanvas({}), activeCanvas);
  assert.equal(helpers.resolveCanvas({ canvasTitle: 'research' }).id, 'c1');
  assert.equal(helpers.resolveVault({ vaultId: 'v1' }).name, 'Research');
  assert.equal(helpers.cleanWikiTitle(' [[Project#Plan]] '), 'ProjectPlan');

  const results = await helpers.searchNotesFast('quarterly', 1);
  assert.deepEqual(results, [{
    id: 'n2',
    title: 'Reading',
    snippet: 'Books',
    score: 8,
  }]);
});
