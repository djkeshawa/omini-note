const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./helpers/paths.js');
const { outlinerSource } = require('./helpers/source.js');

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

test('renderer modules declare cross-file globals explicitly during migration', () => {
  const app = read(paths.src.app);
  const editor = read(paths.src.editor);
  const outliner = outlinerSource(__dirname);

  assert.match(app, /import \{ MnSettingsModal \} from '\.\.\/settings\/settings\.jsx';/);
  assert.match(editor, /import \{ MnOutliner \} from '\.\/outliner\.jsx';/);
  assert.match(outliner, /const MnWorkflowPill = window\.MnWorkflowPill;/);
  assert.match(outliner, /import \{ MnCanvasEmbed \} from '\.\.\/features\/canvas\/index\.js';/);
});

test('renderer globals are explicitly allowlisted until ESM migration removes them', () => {
  const allowedGlobals = new Set([
    'MN_ACTIVE_VAULT_ID',
    'MN_AI_REPORT',
    'MnQuickSwitcher',
    'MN_AI_UI',
    'MN_APP_ACTIONS',
    'MN_APP_RUNTIME',
    'MN_APP_SHELL',
    'MN_CANVAS_MODEL',
    'MN_CODE_HIGHLIGHTER',
    'MN_CODE_LANGUAGES',
    'MN_DATA',
    'MN_FONTS',
    'MN_LOGSEQ',
    'MN_MARKDOWN_INLINE_RENDERERS',
    'MN_OUTLINE',
    'MN_OUTLINER_RENDERERS',
    'MN_OUTLINER_HISTORY',
    'MN_PANEL_COMPONENTS',
    'MN_PLUGINS',
    'MN_REMIND',
    'MN_RUNTIME',
    'MN_SETTINGS_CONTROLS',
    'MN_THEMES',
    'MnAiChatHistory',
    'MnAskAI',
    'MnBlockContextMenu',
    'MnBlockEmbed',
    'MnBlockRef',
    'MnBlockRow',
    'MnCanvasEmbed',
    'MnCanvasPanel',
    'MnCalendarPanel',
    'MnEditor',
    'MnGraph',
    'MnInline',
    'MnMarkdown',
    'MnMathBlock',
    'MnMemoBlockRow',
    'MnMermaidBlock',
    'MnNoteList',
    'MnNovelistPanel',
    'MnOutliner',
    'MnPageEmbed',
    'MnPanelGrip',
    'MnPanelGripPeek',
    'MnPropertyRow',
    'MnQuickCapture',
    'MnRecentlyDeletedPanel',
    'MnReminderToast',
    'MnSettingsModal',
    'MnSidebar',
    'MnTodayPanel',
    'MnTodosPanel',
    'MnWorkflowPanel',
    'MnWorkflowPill',
    'MnZoomBar',
    'mkBlock',
    'mnBlocksToMd',
    'mnCloneBlocks',
    'mnCodeLanguageLabel',
    'mnFormatDate',
    'mnGetTagBg',
    'mnGetTagColor',
    'mnHighlight',
    'mnIconButtonStyle',
    'mnLocate',
    'mnMdToBlocks',
    'mnNewCanvas',
    'mnNormalizeCodeLanguage',
    'mnParse',
    'mnRenderCode',
    'mnShadow',
    'mnWalk',
  ]);
  const assignedGlobals = new Set();

  for (const file of srcFiles()) {
    const source = read(file);
    for (const match of source.matchAll(/\bwindow\.([A-Za-z0-9_]+)\s*=/g)) {
      assignedGlobals.add(match[1]);
    }
  }

  const unexpected = [...assignedGlobals].filter(name => !allowedGlobals.has(name)).sort();
  assert.deepEqual(unexpected, []);
  assert.ok(!assignedGlobals.has('MnApp'));
  assert.ok(assignedGlobals.has('MN_AI_REPORT'));
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
  const app = read(path.join(paths.srcRoot, 'app/app.jsx'));
  const features = ['ai', 'boot', 'canvas', 'navigation', 'overlays', 'planning', 'preferences', 'reference', 'search', 'today', 'trash', 'writer'];
  for (const feature of features) {
    const entry = path.join(paths.srcRoot, `features/${feature}/index.js`);
    assert.ok(fs.existsSync(entry), `${feature} is missing its public entry point`);
    assert.match(app, new RegExp(`from ['\"]\\.\\.\\/features\\/${feature}\\/index\\.js['\"]`));
  }
  assert.doesNotMatch(app, /from ['"]\.\.\/features\/(?![^/]+\/index\.js)[^'"]+['"]/);
  assert.ok(app.split(/\r?\n/).length <= 3433, 'app composition root regrew beyond the Phase 4 budget');
});

test('trash state mutations stay behind the feature controller', () => {
  const app = read(path.join(paths.srcRoot, 'app/app.jsx'));
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
