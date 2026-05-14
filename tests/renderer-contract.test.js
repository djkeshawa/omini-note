const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./helpers/paths.js');

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
  assert.match(entry, /import '\.\/app\/app\.jsx';/);
});

test('renderer modules declare cross-file globals explicitly during migration', () => {
  const app = read(paths.src.app);
  const editor = read(paths.src.editor);
  const outliner = read(paths.src.outliner);

  assert.match(app, /const \{[\s\S]*MnSidebar[\s\S]*MnSettingsModal[\s\S]*\} = window;/);
  assert.match(editor, /const MnOutliner = window\.MnOutliner;/);
  assert.match(outliner, /const MnWorkflowPill = window\.MnWorkflowPill;/);
  assert.match(outliner, /const MnCanvasEmbed = window\.MnCanvasEmbed;/);
});

test('renderer globals are explicitly allowlisted until ESM migration removes them', () => {
  const allowedGlobals = new Set([
    'MN_AI_REPORT',
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
    'MnApp',
    'MnAskAI',
    'MnBlockContextMenu',
    'MnBlockEmbed',
    'MnBlockRef',
    'MnBlockRow',
    'MnCanvasEmbed',
    'MnCanvasPanel',
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
  assert.ok(assignedGlobals.has('MnApp'));
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
