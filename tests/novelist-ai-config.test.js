const test = require('node:test');
const assert = require('node:assert/strict');

// Imported as a real ES module (not through the renderer sandbox) so node's
// coverage attributes these executions to the file.
let panel, normalize;
test('load panelHelpers as an ES module', async () => {
  panel = await import('../src/panels/panelHelpers.js');
  normalize = panel.mnNormalizeNovelistAiConfig;
  assert.equal(typeof normalize, 'function');
});

// Novelist AI settings survive app restarts through localStorage, so whatever
// was saved -- by an older version, a different machine, or a corrupted write
// -- must normalise into a config the panel can safely render and send to a
// model. The expectations here are the user's: settings never come back
// broken, and never silently point at things that no longer exist.

test('a fresh install gets a complete, usable config', () => {
  for (const raw of [null, undefined, {}]) {
    const config = normalize(raw);
    assert.equal(config.version, 2);
    assert.ok(config.prompts.length >= 1, 'no prompts to pick from');
    assert.equal(config.defaultPromptId, config.prompts[0].id, 'default prompt must be a real prompt');
    assert.ok(config.modelCollections.length >= 1);
    assert.equal(config.moderation, true, 'moderation must default on');
    assert.ok(config.wordLimit >= 100 && config.wordLimit <= 12000);
  }
});

test('normalising is idempotent -- settings do not drift on every open', () => {
  // If normalize(normalize(x)) differed from normalize(x), the config would
  // rewrite itself each time the panel opens.
  const messy = {
    preset: 'Custom', wordLimit: '473.9', moderation: false,
    prompts: [{ id: 'mine', name: '  My prompt  ', text: 'legacy text field' }],
    modelCollections: [{ id: 'x', name: 'X', models: ['m1', '', ' m2 '] }],
    advanced: { temperature: '0.7' },
  };
  const once = normalize(messy);
  const twice = normalize(once);
  assert.deepEqual(twice, once, 'a second normalisation changed the config');
});

test('the word limit is clamped to something a model can actually take', () => {
  assert.equal(normalize({ wordLimit: 5 }).wordLimit, 100, 'below the floor should clamp up');
  assert.equal(normalize({ wordLimit: 999999 }).wordLimit, 12000, 'above the ceiling should clamp down');
  assert.equal(normalize({ wordLimit: 'lots' }).wordLimit, 800, 'garbage should fall back to the default');
  assert.equal(normalize({ wordLimit: 473.9 }).wordLimit, 474, 'fractions should round, not truncate the config');
});

test('the default prompt never dangles', () => {
  // A user deletes the prompt their default pointed at; the panel must select
  // a real prompt, not send an empty one to the model.
  const config = normalize({
    defaultPromptId: 'deleted-prompt',
    prompts: [{ id: 'still-here', name: 'Keep', prompt: 'text' }],
  });
  assert.equal(config.defaultPromptId, 'still-here');
  const kept = normalize({ defaultPromptId: 'b', prompts: [{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }] });
  assert.equal(kept.defaultPromptId, 'b', 'a valid saved default was discarded');
});

test('legacy prompt text under .text still loads', () => {
  const config = normalize({ prompts: [{ id: 'p1', name: 'Old', text: 'v1 prompt body' }] });
  assert.equal(config.prompts[0].prompt, 'v1 prompt body', 'v1 configs stored prompt text under .text');
});

test('runaway lists are capped so a corrupt config cannot flood the panel', () => {
  const config = normalize({
    prompts: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, prompt: 'x' })),
    modelCollections: Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`, name: `C${i}`, models: Array.from({ length: 100 }, (_, j) => `m${j}`),
    })),
  });
  assert.equal(config.prompts.length, 12);
  assert.equal(config.modelCollections.length, 8);
  assert.equal(config.modelCollections[0].models.length, 24);
});

test('moderation only turns off when explicitly false', () => {
  assert.equal(normalize({ moderation: false }).moderation, false);
  for (const value of [0, '', null, undefined, 'false']) {
    assert.equal(normalize({ moderation: value }).moderation, true,
      `moderation was disabled by ${JSON.stringify(value)}, which is not an explicit false`);
  }
});

test('config keys are isolated per vault', () => {
  const a = panel.mnNovelistAiConfigKey('vault-a');
  const b = panel.mnNovelistAiConfigKey('vault-b');
  const global = panel.mnNovelistAiConfigKey('');
  assert.notEqual(a, b, 'two vaults share a config key');
  assert.notEqual(a, global, 'a vault shares the global config key');
  assert.equal(panel.mnNovelistAiConfigKey('  '), global, 'whitespace vault ids must not mint a new key');
  assert.notEqual(panel.mnNovelistLegacyAiConfigKey('vault-a'), a, 'v1 and v2 keys must not collide');
});
