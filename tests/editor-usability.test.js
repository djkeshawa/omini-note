const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');

test('shortcut registry formats each supported desktop platform from one spec', () => {
  const shortcuts = loadRendererModule('src/platform/shortcuts.js');

  assert.equal(shortcuts.shortcutLabel('newNote', 'win32', { compact: true }), 'Ctrl+N');
  assert.equal(shortcuts.shortcutLabel('quickCapture', 'linux', { compact: true }), 'Ctrl+Shift+N');
  assert.equal(shortcuts.shortcutLabel('newNote', 'darwin', { compact: true }), '⌘N');
  assert.equal(shortcuts.shortcutLabel('redo', 'darwin'), '⌘ ⇧ Z / ⌘ Y');
  assert.equal(shortcuts.normalizePlatform('MacIntel'), 'darwin');
  assert.equal(shortcuts.normalizePlatform('Windows'), 'win32');
});

test('specialist shortcut help follows feature-pack availability', () => {
  const shortcutsSection = fs.readFileSync(path.join(__dirname, '../src/settings/sections/AboutSections.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings/settings.jsx'), 'utf8');

  assert.match(shortcutsSection, /featureState\.showLabs \? \[\{ k: shortcutLabel\('graph'/);
  assert.match(shortcutsSection, /featureState\.showAskAi \? \[\{ k: shortcutLabel\('askAi'/);
  assert.match(settings, /<SectionShortcuts[^>]*featureState=\{featureState\}/);
});

test('shortcut matching rejects conflicting modifiers and handles backslash layouts', () => {
  const { matchesShortcut } = loadRendererModule('src/platform/shortcuts.js');

  assert.equal(matchesShortcut({ key: 'n', ctrlKey: true }, 'newNote'), true);
  assert.equal(matchesShortcut({ key: 'n', ctrlKey: true, shiftKey: true }, 'newNote'), false);
  assert.equal(matchesShortcut({ key: 'N', metaKey: true, shiftKey: true }, 'quickCapture'), true);
  assert.equal(matchesShortcut({ key: '|', code: 'Backslash', ctrlKey: true }, 'toggleSidebar'), true);
  assert.equal(matchesShortcut({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true }, 'toggleNoteList'), true);
});

test('responsive layout switches the note list below the three-pane threshold', () => {
  const responsive = loadRendererModule('src/shared/layout/useResponsiveLayout.js');

  assert.equal(responsive.DESKTOP_THREE_PANE_MIN_WIDTH, 1200);
  assert.equal(responsive.usesOverlayNoteList(1199), true);
  assert.equal(responsive.usesOverlayNoteList(1200), false);
  assert.equal(responsive.usesOverlayNoteList(1440), false);
});

test('blank-note chrome hides metadata and moves secondary actions into More', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const header = fs.readFileSync(path.join(__dirname, '../src/editor/EditorHeader.jsx'), 'utf8');
  const properties = fs.readFileSync(path.join(__dirname, '../src/features/editor/metadata/PropertiesPanel.jsx'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '../src/app/AppView.jsx'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');

  assert.match(properties, /if \(!expanded\) return null/);
  assert.match(editor, /\+ Property/);
  assert.match(editor, /aria-haspopup="dialog"/);
  assert.match(editor, /aria-controls="mn-properties-panel"/);
  assert.match(editor, /workflowStatusEnabled && hasStatusProperty/);
  assert.match(header, /More note actions/);
  assert.match(header, />Duplicate note<\/MenuItem>/);
  assert.match(header, />Version history<\/MenuItem>/);
  assert.match(header, />Export as Markdown<\/MenuItem>/);
  assert.match(header, />Delete note<\/MenuItem>/);
  assert.match(header, /minHeight: 36/);
  assert.match(view, /data-mn-layout=\{overlayNoteList \? 'compact' : 'three-pane'\}/);
  assert.match(view, /<ResponsiveListPane/);
  assert.doesNotMatch(view, /useResponsiveLayout/);
  assert.match(view, /compactEditorOwnsNoteListTrigger/);
  assert.match(view, /noteListVisible && noteListHidden && !compactEditorOwnsNoteListTrigger/);
  assert.match(view, /aiChatListVisible && noteListHidden && \(/);
  const app = fs.readFileSync(path.join(__dirname, '../src/app/app.jsx'), 'utf8');
  assert.match(app, /const \{ overlayNoteList \} = useResponsiveLayout\(\)/);
  assert.match(app, /openSmartView, overlayNoteList, pendingDirtyKeysRef/);
  assert.match(app, /preferredNoteListHidden \|\| \(overlayNoteList && !compactNoteListOpen\)/);
  assert.match(app, /setCompactNoteListOpen\(!next\)/);
  assert.match(html, /outline: 2px solid var\(--mn-focus, #4f6fd5\) !important/);
});

test('properties panel renders nothing until metadata exists or adding begins', () => {
  const { PropertiesPanel } = loadRendererModule('src/features/editor/metadata/PropertiesPanel.jsx');
  const rendered = PropertiesPanel({
    T: {}, visibleProperties: [], hasStatusRow: false, workflowStatus: '', workflowStates: [],
    onSetWorkflowStatus() {}, removeProperty() {}, updateProperty() {}, spellCheck: true,
    addingProperty: false, setAddingProperty() {}, propertyKeyDraft: '', setPropertyKeyDraft() {},
    propertyValueDraft: '', setPropertyValueDraft() {}, addProperty() {}, cleanPropertyKey: value => value,
  });

  assert.equal(rendered, null);
});

test('preload exposes only normalized app info through the app namespace', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const handlers = fs.readFileSync(path.join(__dirname, '../lib/connectors/ipc/windowHandlers.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(__dirname, '../src/platform/desktopBridge.js'), 'utf8');

  assert.match(preload, /info: \(\) => ipcRenderer\.invoke\('mn:appInfo'\)/);
  assert.match(handlers, /ipcMain\.handle\('mn:appInfo', wrap\(\(\) => getAppInfo\(\)\)\)/);
  assert.match(main, /getAppInfo: \(\) => \(\{ platform: process\.platform \}\)/);
  assert.match(bridge, /'openExternal', 'setTitle', 'info', 'shortcutStatus'/);
});

test('app info IPC returns only the allowlisted platform field', () => {
  const { registerWindowHandlers } = require('../lib/connectors/ipc/windowHandlers.js');
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const wrap = handler => handler;
  registerWindowHandlers(ipcMain, {
    wrap,
    wrapWithEvent: wrap,
    BrowserWindow: { fromWebContents: () => null },
    shell: { openExternal: () => {} },
    autoUpdater: { quitAndInstall: () => {} },
    sanitizeExternalUrl: value => value,
    getAppInfo: () => ({ platform: 'win32' }),
    getShortcutState: () => ({}),
    emitUpdateState: () => ({}),
    checkForUpdates: () => ({}),
    getUpdateState: () => ({ downloaded: false }),
  });

  assert.deepEqual(handlers.get('mn:appInfo')(), { platform: 'win32' });
  assert.deepEqual(Object.keys(handlers.get('mn:appInfo')()), ['platform']);
});
