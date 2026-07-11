const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const { optionalPlatformCall } = loadRendererModule('src/platform/desktopBridge.js');

test('optional platform calls tolerate missing and synchronous bridge failures', async () => {
  assert.equal(await optionalPlatformCall(), null);
  assert.equal(await optionalPlatformCall(() => { throw new Error('unavailable'); }), null);
});

test('optional platform calls preserve successful values and absorb rejections', async () => {
  assert.deepEqual(await optionalPlatformCall(async () => ({ ok: true, value: 1 })), { ok: true, value: 1 });
  assert.equal(await optionalPlatformCall(async () => { throw new Error('offline'); }), null);
});
