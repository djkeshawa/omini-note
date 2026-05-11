const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const tableOps = require('../../src/tableOps.js');

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
  const code = fs.readFileSync(path.join(__dirname, '../../src/outline.jsx'), 'utf8');
  const sandbox = {
    React: {
      useState() {},
      useEffect() {},
      useRef() {},
      useCallback() {},
      useMemo() {},
    },
    window: { MN_TABLE_OPS: tableOps },
  };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.MN_OUTLINE;
}

function block(content, annotations = []) {
  return { id: Math.random().toString(36).slice(2), content, annotations, children: [] };
}

module.exports = {
  block,
  loadOutlineForTest,
  withIsolatedStore,
};
