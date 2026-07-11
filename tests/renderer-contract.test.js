const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./helpers/paths.js');
const { appSource, outlinerSource } = require('./helpers/source.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function srcFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
    }
  };
  walk(paths.srcRoot);
  return out;
}

test('renderer bundle entry and HTML shell contract stay stable', () => {
  const buildRenderer = read(paths.scripts.buildRenderer);
  const html = read(paths.html);
  const entry = read(paths.src.main);

  assert.match(buildRenderer, /const ENTRY = 'src\/main\.jsx'/);
  assert.match(buildRenderer, /esbuild\.buildSync\(\{/);
  assert.match(buildRenderer, /bundle: true/);
  assert.match(html, /<script src="build\/renderer\/app\.js"><\/script>/);
  assert.match(entry, /import \{ MnApp \} from '\.\/app\/app\.jsx';/);
});

test('renderer modules use explicit imports across feature boundaries', () => {
  const app = appSource(__dirname);
  const editor = read(paths.src.editor);
  const outliner = outlinerSource(__dirname);

  assert.match(app, /import \{ MnSettingsModal \} from '\.\.\/settings\/settings\.jsx';/);
  assert.match(editor, /import \{ MnOutliner \} from '\.\/outliner\.jsx';/);
  assert.match(outliner, /import \{ MnBlockContextMenu, MnBlockEmbed, MnPageEmbed, MnPropertyRow, MnWorkflowPill, MnZoomBar \} from '\.\/blockFeatures\.jsx';/);
  assert.match(outliner, /import \{ MnCanvasEmbed \} from '\.\.\/features\/canvas\/index\.js';/);
});

test('renderer feature globals are fully removed', () => {
  const assignedGlobals = new Set();

  for (const file of srcFiles()) {
    const source = read(file);
    for (const match of source.matchAll(/\bwindow\.([A-Za-z0-9_]+)\s*=/g)) {
      assignedGlobals.add(match[1]);
    }
  }

  assert.deepEqual([...assignedGlobals], []);
});

test('modularization target feature folders exist', () => {
  for (const folder of ['app', 'editor', 'canvas', 'ai', 'settings', 'panels', 'shared']) {
    const dir = path.join(paths.srcRoot, folder);
    assert.ok(fs.statSync(dir).isDirectory(), `${folder} folder is missing`);
    assert.ok(
      fs.readdirSync(dir).some(file => /\.(jsx?|mjs)$/.test(file)),
      `${folder} folder has no source files`
    );
  }
});

test('application composition delegates focused state to feature controllers', () => {
  const app = appSource(__dirname);
  const features = ['ai', 'boot', 'canvas', 'navigation', 'overlays', 'planning', 'preferences', 'reference', 'search', 'today', 'trash', 'writer'];
  for (const feature of features) {
    const entry = path.join(paths.srcRoot, `features/${feature}/index.js`);
    assert.ok(fs.existsSync(entry), `${feature} is missing its public entry point`);
    assert.match(app, new RegExp(`from ['\"]\\.\\.\\/features\\/${feature}\\/index\\.js['\"]`));
  }
  assert.doesNotMatch(app, /from ['"]\.\.\/features\/(?![^/]+\/index\.js)[^'"]+['"]/);
  const appModules = [
    path.join(paths.srcRoot, 'app/app.jsx'),
    path.join(paths.srcRoot, 'app/AppView.jsx'),
    ...fs.readdirSync(path.join(paths.srcRoot, 'app/controllers')).map(name => path.join(paths.srcRoot, 'app/controllers', name)),
  ];
  for (const file of appModules) assert.ok(read(file).split(/\r?\n/).length <= 800, `${path.basename(file)} exceeds the app hard limit`);
});

test('trash state mutations stay behind the feature controller', () => {
  const app = appSource(__dirname);
  const controller = read(path.join(paths.srcRoot, 'features/trash/useTrashController.js'));

  assert.doesNotMatch(app, /\bsetTrash(?:Items|Error)\b/);
  assert.match(app, /prependDeletedItem\(res\.value\)/);
  assert.match(app, /onListDeletedNotes=\{listDeletedItems\}/);
  assert.match(controller, /return \{ items, loading, error, list, refresh, restore, purge, prepend \}/);
});

test('editor feature modules own models, connections, and block mutations', () => {
  const editor = read(path.join(paths.srcRoot, 'editor/editor.jsx'));
  const outliner = outlinerSource(__dirname);
  const connections = read(path.join(paths.srcRoot, 'features/editor/connections/useConnectionsController.js'));
  const operations = read(path.join(paths.srcRoot, 'features/editor/outliner/blockOperations.js'));

  assert.match(editor, /useConnectionsController/);
  assert.doesNotMatch(editor, /window\.mn/);
  assert.match(connections, /platformApi\.search\.backlinks/);
  assert.match(connections, /platformApi\.integrations\.memory/);
  assert.match(outliner, /moveBlock\(bs, srcId, destId, position, mnLocate\)/);
  assert.match(operations, /export function moveBlock/);
  assert.ok(editor.split(/\r?\n/).length <= 945, 'editor shell regrew beyond the Phase 5 budget');
  const outlinerFiles = [
    path.join(paths.srcRoot, 'editor/outliner.jsx'),
    ...fs.readdirSync(path.join(paths.srcRoot, 'editor/outliner')).map(name => path.join(paths.srcRoot, 'editor/outliner', name)),
  ];
  for (const file of outlinerFiles) {
    assert.ok(read(file).split(/\r?\n/).length <= 800, `${path.basename(file)} exceeds the outliner hard limit`);
  }
});
