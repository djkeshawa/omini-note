const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const features = require('../src/app/featureRegistry');

test('feature registry keeps an explicitly empty pack surface minimal', () => {
  const state = features.deriveFeatureState({ enabledPacks: [], assistanceEnabled: false });
  assert.equal(state.showViews, false);
  assert.equal(state.showAgenda, false);
  assert.equal(state.showWorkflow, false);
  assert.equal(state.showCanvas, false);
  assert.equal(state.showWriter, false);
  assert.equal(state.showAskAi, false);
  for (const actionId of [
    'graph', 'calendar', 'set-workflow-status', 'canvas',
    'create-canvas', 'template-reading', 'template-novel-scene', 'memory-import', 'ask-ai',
  ]) {
    assert.equal(features.isActionAvailable(actionId, state), false, actionId);
  }
  assert.equal(features.isActionAvailable('new-note', state), true);
  assert.equal(features.isViewAvailable('todos', state), false);
});

test('the fresh-install Views pack does not enable planning or Labs', () => {
  const state = features.deriveFeatureState({ enabledPacks: ['views'], assistanceEnabled: false });
  assert.equal(state.showViews, true);
  assert.equal(state.showAgenda, false);
  assert.equal(state.showWorkflow, false);
  assert.equal(state.showLabs, false);
  assert.equal(state.showAskAi, false);
  assert.equal(features.isActionAvailable('views', state), true);
});

test('feature registry infers packs from existing specialist data', () => {
  const state = features.deriveFeatureState({
    enabledPacks: [],
    canvasCount: 1,
    novelistMode: true,
    workflowTotal: 2,
    plugins: [{ type: 'zotero-reader', enabled: true }, { type: 'llm-memory', enabled: true }],
  });
  assert.equal(state.showCanvas, true);
  assert.equal(state.showWriter, true);
  assert.equal(state.showWorkflow, true);
  assert.equal(state.showResearch, true);
  assert.equal(state.showAgents, true);
});

test('feature packs normalize and toggle predictably', () => {
  assert.deepEqual(features.normalizePacks(['canvas', 'bad', 'canvas', 'writer']), ['canvas', 'writer']);
  assert.deepEqual(features.togglePack(['canvas'], 'writer', true), ['canvas', 'writer']);
  assert.deepEqual(features.togglePack(['canvas', 'writer'], 'canvas', false), ['writer']);
});

test('each optional pack exposes only its own registered actions', () => {
  const cases = [
    ['planning', 'calendar', 'canvas'],
    ['canvas', 'create-canvas', 'graph'],
    ['research', 'template-reading', 'memory-import'],
    ['writer', 'template-novel-scene', 'calendar'],
    ['agents', 'memory-import', 'template-reading'],
    ['labs', 'graph', 'create-canvas'],
  ];
  for (const [packId, available, unavailable] of cases) {
    const state = features.deriveFeatureState({ enabledPacks: [packId] });
    assert.equal(features.isActionAvailable(available, state), true, `${packId}:${available}`);
    assert.equal(features.isActionAvailable(unavailable, state), false, `${packId}:${unavailable}`);
  }
});

test('planning data reveals only the capability supported by that data', () => {
  const agenda = features.deriveFeatureState({ agendaCount: 1 });
  assert.equal(agenda.showAgenda, true);
  assert.equal(agenda.showWorkflow, false);
  assert.equal(features.isActionAvailable('calendar', agenda), true);
  assert.equal(features.isViewAvailable('todos', agenda), true);
  assert.equal(features.isActionAvailable('set-workflow-status', agenda), false);

  const workflow = features.deriveFeatureState({ workflowTotal: 1 });
  assert.equal(workflow.showAgenda, false);
  assert.equal(workflow.showWorkflow, true);
});

test('opting into planning reveals the half your data has not asked for yet', () => {
  // Workflow notes infer the planning pack, but Agenda stays hidden because it
  // is gated on agenda data of its own. Explicitly enabling the pack is the way
  // out of that, so the Settings toggle must never be the only route and must
  // never be unclickable — see the toggle assertions in ui-regressions.
  const inferredOnly = features.deriveFeatureState({ workflowTotal: 3, agendaCount: 0 });
  assert.deepEqual(inferredOnly.inferred, ['planning']);
  assert.equal(inferredOnly.showAgenda, false);

  const optedIn = features.deriveFeatureState({ enabledPacks: ['planning'], workflowTotal: 3, agendaCount: 0 });
  assert.equal(optedIn.showAgenda, true);
  assert.equal(optedIn.showWorkflow, true);
  assert.equal(features.isViewAvailable('todos', optedIn), true);
});

test('feature artifacts and plugin actions preserve specialist access for existing data', () => {
  const artifacts = features.detectFeatureArtifacts([
    { body: '{{canvas c1}}\n{{ SMART-VIEW open_tasks}}', tags: [] },
    { body: '::: plot-points\n- Beat\n:::', tags: ['novel-scene'] },
    { body: '', tags: [], blocks: [{ workflow: 'TODO', children: [] }] },
  ]);
  assert.deepEqual(artifacts, {
    canvasArtifactCount: 1,
    smartViewArtifactCount: 1,
    workflowArtifactCount: 1,
    writerArtifactCount: 1,
  });
  const state = features.deriveFeatureState({
    ...artifacts,
    plugins: [
      { id: 'zotero', type: 'zotero-reader', enabled: true },
      { id: 'memory', type: 'llm-memory', enabled: true },
    ],
  });
  assert.equal(state.showCanvas, true);
  assert.equal(state.showLabs, true);
  assert.equal(state.showWorkflow, true);
  assert.equal(state.writerAvailable, true);
  assert.equal(state.showWriter, false);
  assert.equal(features.isActionAvailable('template-novel-scene', state), true);
  assert.equal(features.isViewAvailable('novelist', state), false);
  assert.equal(features.isActionAvailable('plugin-zotero', state), true);
  assert.equal(features.isActionAvailable('plugin-memory', state), true);
  assert.equal(features.isViewAvailable('graph', state), true);
});

test('every pack id is registered in all four places that gate it', () => {
  // A pack id lives in four independent lists. Miss the IPC sanitizer and the
  // Settings toggle appears to work but never persists; miss the telemetry
  // allowlist and usage events are silently dropped. Nothing else catches it.
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const idsFrom = (source, marker) => {
    const line = source.split(/\r?\n/).find(row => row.includes(marker));
    assert.ok(line, `${marker} not found`);
    return new Set([...line.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
  };

  const registryIds = new Set(features.PACKS.map(pack => pack.id));
  const ipcIds = idsFrom(read('lib/connectors/ipc/preferenceValidation.js'), 'FEATURE_PACK_IDS = new Set');
  const storageIds = idsFrom(read('lib/storage/basicModels.js'), 'PACK_IDS = new Set');
  const telemetry = read('lib/integrations/telemetry/featureUsage.js');

  assert.deepEqual([...ipcIds].sort(), [...registryIds].sort(), 'IPC sanitizer must accept exactly the registered packs');
  assert.deepEqual([...storageIds].sort(), [...registryIds].sort(), 'storage model must accept exactly the registered packs');
  for (const id of registryIds) {
    const key = id === 'labs' ? 'smart_views' : id;  // labs reports as smart_views
    assert.ok(telemetry.includes(`'${key}'`), `${id} has no telemetry key`);
  }
});
