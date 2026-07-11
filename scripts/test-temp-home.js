const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function configureIsolatedUserData(app, home) {
  const userData = path.join(home, 'electron-user-data');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  return userData;
}

function isOwnedTestHome(target) {
  const resolved = path.resolve(String(target || ''));
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
    && path.basename(resolved).startsWith('vispnote-');
}

function scheduleTempCleanupAfterExit(target) {
  if (!isOwnedTestHome(target)) return false;
  const helper = path.join(__dirname, 'cleanup-temp-after-exit.js');
  const executable = process.env.npm_node_execpath || process.execPath;
  const child = childProcess.spawn(executable, [helper, String(process.pid), path.resolve(target)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });
  child.unref();
  return true;
}

module.exports = {
  configureIsolatedUserData,
  isOwnedTestHome,
  scheduleTempCleanupAfterExit,
};
