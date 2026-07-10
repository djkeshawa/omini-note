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
