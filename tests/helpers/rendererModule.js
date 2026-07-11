const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');

function reactStub() {
  return {
    createElement: (...args) => ({ jsx: args }),
    Fragment: Symbol('Fragment'),
    memo: value => value,
    useCallback: value => value,
    useEffect() {},
    useLayoutEffect() {},
    useMemo: value => value(),
    useRef: value => ({ current: value }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
  };
}

function loadRendererModule(relativePath, overrides = {}) {
  const result = esbuild.buildSync({
    absWorkingDir: ROOT,
    entryPoints: [relativePath],
    bundle: true,
    format: 'cjs',
    jsx: 'transform',
    logLevel: 'silent',
    platform: 'node',
    write: false,
  });
  const module = { exports: {} };
  const context = { React: reactStub(), window: {}, ...overrides };
  const execute = new Function('module', 'exports', 'require', 'React', 'window', result.outputFiles[0].text);
  execute(module, module.exports, require, context.React, context.window);
  return module.exports;
}

module.exports = { loadRendererModule };
