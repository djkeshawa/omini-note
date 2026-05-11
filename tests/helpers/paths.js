const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

const projectPaths = {
  root: ROOT,
  html: path.join(ROOT, 'vispnote.html'),
  packageJson: path.join(ROOT, 'package.json'),
  mainProcess: path.join(ROOT, 'main.js'),
  preload: path.join(ROOT, 'preload.js'),
  scripts: {
    buildRenderer: path.join(ROOT, 'scripts', 'build-renderer.js'),
    smokeElectron: path.join(ROOT, 'scripts', 'smoke-electron.js'),
    regressionElectron: path.join(ROOT, 'scripts', 'regression-electron.js'),
  },
  srcRoot: SRC,
  src: {
    main: path.join(SRC, 'main.jsx'),
    app: path.join(SRC, 'app.jsx'),
    appShell: path.join(SRC, 'appShell.jsx'),
    editor: path.join(SRC, 'editor.jsx'),
    outliner: path.join(SRC, 'outliner.jsx'),
    ai: path.join(SRC, 'ai.jsx'),
    panels: path.join(SRC, 'panels.jsx'),
    canvas: path.join(SRC, 'canvas.jsx'),
    settings: path.join(SRC, 'settings.jsx'),
  },
  lib: {
    store: path.join(ROOT, 'lib', 'store.js'),
    index: path.join(ROOT, 'lib', 'index.js'),
    ai: path.join(ROOT, 'lib', 'ai.js'),
    ollama: path.join(ROOT, 'lib', 'ollama.js'),
  },
  assets: {
    icon: path.join(ROOT, 'assets', 'vispnote-icon.png'),
    loadingLogo: path.join(ROOT, 'assets', 'vispnote-loading-transparent.png'),
    linuxIcons: path.join(ROOT, 'assets', 'linux-icons'),
  },
};

module.exports = projectPaths;
