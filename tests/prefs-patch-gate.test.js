const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('../lib/connectors/ipc/preferenceValidation.js');

const sanitize = gate.sanitizePrefsPatchFromIpc;

// sanitizePrefsPatchFromIpc is the single gate between the renderer and
// prefs.json. Two behaviours matter: a real settings change passes through
// with its values intact, and a malicious or corrupted patch cannot smuggle
// anything past the whitelist -- prototype pollution being the sharp case,
// since prefs.json is parsed at boot on every start.

test('a legitimate settings change survives the gate intact', () => {
  const clean = sanitize({
    activeVaultId: 'vault-42',
    localUsageMetrics: true,
    tweaks: { weekStart: 'monday', snoozeMinutes: '15' },
  });
  assert.equal(clean.activeVaultId, 'vault-42');
  assert.equal(clean.localUsageMetrics, true);
  assert.equal(clean.tweaks.weekStart, 'monday');
  assert.equal(clean.tweaks.snoozeMinutes, '15');
});

test('prototype pollution cannot travel through a prefs patch', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => sanitize({ [key]: { polluted: true } }), /Unsupported/,
      `top-level ${key} was accepted`);
    assert.throws(() => sanitize({ tweaks: { [key]: { polluted: true } } }), /Unsupported/,
      `tweak ${key} was accepted`);
    assert.throws(() => sanitize({ aiConfig: { [key]: 'x' } }), /Invalid AI config/,
      `aiConfig ${key} was accepted`);
  }
  assert.equal(({}).polluted, undefined, 'Object.prototype was actually polluted during the test');
});

test('unknown fields are rejected loudly, not silently dropped', () => {
  // Silent dropping would make a typo in a settings write look like success.
  assert.throws(() => sanitize({ notARealPref: 1 }), /Unsupported preferences field/);
  assert.throws(() => sanitize({ tweaks: { notARealTweak: true } }), /Unsupported tweak field/);
});

test('non-object patches are refused', () => {
  for (const bad of [null, undefined, 'string', 42, [], () => {}]) {
    assert.throws(() => sanitize(bad), /Invalid preferences patch/, `accepted ${typeof bad}`);
  }
});

test('boolean prefs only accept booleans', () => {
  for (const value of ['true', 1, null, {}]) {
    assert.throws(() => sanitize({ localUsageMetrics: value }), /Invalid/,
      `localUsageMetrics accepted ${JSON.stringify(value)}`);
  }
  assert.equal(sanitize({ anonymousUsageSharing: false }).anonymousUsageSharing, false);
});

test('workflow states are size-capped and shape-checked', () => {
  const state = { id: 'todo', next: 'doing', color: '#fff', bg: '#000' };
  const ok = sanitize({ tweaks: { workflowStates: [state] } });
  assert.deepEqual(ok.tweaks.workflowStates, [state]);
  assert.throws(() => sanitize({ tweaks: { workflowStates: Array(21).fill(state) } }), /Invalid workflowStates/,
    '21 workflow states should exceed the cap');
  assert.throws(() => sanitize({ tweaks: { workflowStates: ['not-an-object'] } }), /Invalid workflowStates/);
  const nulled = sanitize({ tweaks: { workflowStates: null } });
  assert.equal(nulled.tweaks.workflowStates, null, 'null resets to defaults and must pass');
});

test('plugins outside the type whitelist are refused', () => {
  const plugin = { id: 'p1', name: 'P', type: 'note-template', config: {} };
  const ok = sanitize({ tweaks: { plugins: [plugin] } });
  assert.equal(ok.tweaks.plugins[0].type, 'note-template');
  assert.throws(() => sanitize({ tweaks: { plugins: [{ ...plugin, type: 'shell-command' }] } }), /Invalid plugin type/,
    'an unknown plugin type must never reach prefs.json');
  assert.throws(() => sanitize({ tweaks: { plugins: Array(31).fill(plugin) } }), /Invalid plugins/,
    '31 plugins should exceed the cap');
});

test('plugin ids are flattened to a safe slug', () => {
  const out = sanitize({ tweaks: { plugins: [{ id: '../..//etc passwd!', name: 'X', type: 'open-url', config: {} }] } });
  assert.match(out.tweaks.plugins[0].id, /^[A-Za-z0-9_-]+$/,
    `plugin id survived with unsafe characters: ${out.tweaks.plugins[0].id}`);
  const blank = sanitize({ tweaks: { plugins: [{ id: '///', name: 'X', type: 'open-url', config: {} }] } });
  assert.ok(blank.tweaks.plugins[0].id.length > 0, 'a fully-stripped id must still get a fallback name');
});

test('enabled packs are deduplicated and limited to real pack ids', () => {
  const out = sanitize({ enabledPacks: ['views', 'views', 'labs'] });
  assert.deepEqual(out.enabledPacks, ['views', 'labs']);
  const filtered = sanitize({ enabledPacks: ['views', 'not-a-pack'] });
  assert.deepEqual(filtered.enabledPacks, ['views'], 'an unknown pack id should be filtered out');
  assert.throws(() => sanitize({ enabledPacks: 'views' }), /Invalid enabled packs/);
});

test('oversized strings are refused rather than truncated into a different value', () => {
  assert.throws(() => sanitize({ activeVaultId: 'v'.repeat(200) }), /activeVaultId/,
    'a 200-char vault id should exceed the 120 cap');
});

test('ai config accepts scalars only and caps secrets', () => {
  const ok = sanitize({ aiConfig: { provider: 'ollama', enabled: true, temperature: 0.5, apiKey: null } });
  assert.deepEqual(ok.aiConfig, { provider: 'ollama', enabled: true, temperature: 0.5, apiKey: null });
  assert.throws(() => sanitize({ aiConfig: { nested: { object: true } } }), /Invalid AI config field/);
  assert.throws(() => sanitize({ aiConfig: { apiKey: 'k'.repeat(5000) } }), /apiKey/,
    'an api key beyond the secret limit should be refused');
});
