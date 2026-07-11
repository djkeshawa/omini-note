const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  configureIsolatedUserData,
  isOwnedTestHome,
  scheduleTempCleanupAfterExit,
} = require('../scripts/test-temp-home');

test('Electron regressions isolate userData inside an owned temporary home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-test-home-'));
  let configured = null;
  try {
    const userData = configureIsolatedUserData({
      setPath(name, value) {
        configured = [name, value];
      },
    }, home);
    assert.deepEqual(configured, ['userData', userData]);
    assert.equal(userData, path.join(home, 'electron-user-data'));
    assert.equal(fs.statSync(userData).isDirectory(), true);
    assert.equal(isOwnedTestHome(home), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('post-exit cleanup rejects caller-owned and non-temporary paths', () => {
  const callerOwned = path.resolve(__dirname, 'caller-owned-vispnote-home');
  assert.equal(isOwnedTestHome(callerOwned), false);
  assert.equal(scheduleTempCleanupAfterExit(callerOwned), false);
  assert.equal(isOwnedTestHome(os.tmpdir()), false);
});
