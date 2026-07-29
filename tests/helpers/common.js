const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRendererModule } = require('./rendererModule.js');

async function withIsolatedStore(fn) {
  const previousVispnoteHome = process.env.VISPNOTE_HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-store-'));
  const storePath = require.resolve('../../lib/store');
  delete require.cache[storePath];
  process.env.VISPNOTE_HOME = tmpHome;
  try {
    const store = require('../../lib/store');
    return await fn(store, tmpHome);
  } finally {
    delete require.cache[storePath];
    if (previousVispnoteHome === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previousVispnoteHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function loadOutlineForTest() {
  return loadRendererModule('src/editor/outline.jsx');
}

function block(content, annotations = []) {
  return { id: Math.random().toString(36).slice(2), content, annotations, children: [] };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 2) {
  for (let index = 0; index < turns; index++) await Promise.resolve();
}

module.exports = {
  block,
  deferred,
  flushMicrotasks,
  loadOutlineForTest,
  withIsolatedStore,
};
