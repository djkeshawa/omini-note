const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const electronPath = require('electron');
const testDir = path.join(ROOT, 'tests');
const files = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.test.js'))
  .sort()
  .map(file => path.join('tests', file));

const child = spawn(electronPath, ['--test', ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
