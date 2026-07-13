'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const electronPath = require('electron');
const child = spawn(electronPath, [path.join('scripts', 'benchmark-10000-notes.js')], {
  cwd: root,
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
