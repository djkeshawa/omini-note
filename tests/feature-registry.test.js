const test = require('node:test');
const assert = require('node:assert/strict');
const features = require('../src/app/featureRegistry');

test('feature registry keeps the default surface minimal', () => {
  const state = features.deriveFeatureState({ enabledPacks: [], assistanceEnabled: false });
  assert.equal(state.showAgenda, false);
  assert.equal(state.showWorkflow, false);
  assert.equal(state.showCanvas, false);
  assert.equal(state.showWriter, false);
  assert.equal(state.showAskAi, false);
  for (const actionId of [
    'graph', 'smart-views', 'calendar', 'set-workflow-status', 'canvas',
    'create-canvas', 'template-reading', 'template-novel-scene', 'memory-import', 'ask-ai',
  ]) {
    assert.equal(features.isActionAvailable(actionId, state), false, actionId);
  }
  assert.equal(features.isActionAvailable('new-note', state), true);
  assert.equal(features.isViewAvailable('todos', state), false);
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
