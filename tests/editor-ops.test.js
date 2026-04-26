const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ops = require('../src/editorOps.js');
const tableOps = require('../src/tableOps.js');

function block(content, annotations = []) {
  return { id: Math.random().toString(36).slice(2), content, annotations, children: [] };
}

test('Enter in the middle splits content and annotations without duplicating the tail', () => {
  const first = block('hello world', [
    { start: 0, end: 5, kind: 'bold' },
    { start: 6, end: 11, kind: 'italic' },
    { start: 3, end: 8, kind: 'hi-yellow' },
  ]);
  const second = block('');

  ops.splitBlock(first, 5, second);

  assert.equal(first.content, 'hello');
  assert.equal(second.content, ' world');
  assert.deepEqual(first.annotations, [
    { start: 0, end: 5, kind: 'bold' },
    { start: 3, end: 5, kind: 'hi-yellow' },
  ]);
  assert.deepEqual(second.annotations, [
    { start: 0, end: 3, kind: 'hi-yellow' },
    { start: 1, end: 6, kind: 'italic' },
  ]);
});

test('Undo after Enter restores one original block snapshot', () => {
  const original = [block('hello world', [{ start: 0, end: 11, kind: 'bold' }])];
  const undoStack = [structuredClone(original)];
  const draft = structuredClone(original);
  const next = block('');

  ops.splitBlock(draft[0], 5, next);
  draft.splice(1, 0, next);
  const restored = undoStack.pop();

  assert.equal(draft.length, 2);
  assert.deepEqual(restored, original);
});

test('Backspace merge preserves annotations from both blocks with shifted offsets', () => {
  const first = block('hello', [{ start: 0, end: 5, kind: 'bold' }]);
  const second = block(' world', [{ start: 1, end: 6, kind: 'italic' }]);

  ops.mergeBlockContent(first, second);

  assert.equal(first.content, 'hello world');
  assert.deepEqual(first.annotations, [
    { start: 0, end: 5, kind: 'bold' },
    { start: 6, end: 11, kind: 'italic' },
  ]);
});

test('Clear formatting trims and splits overlapping annotation ranges', () => {
  const cleared = ops.clearAnnotationRange([
    { start: 0, end: 10, kind: 'bold' },
    { start: 12, end: 16, kind: 'italic' },
  ], 3, 7, 20);

  assert.deepEqual(cleared, [
    { start: 0, end: 3, kind: 'bold' },
    { start: 7, end: 10, kind: 'bold' },
    { start: 12, end: 16, kind: 'italic' },
  ]);
});

test('Applying highlight or color replaces only same-family overlap', () => {
  const highlighted = ops.applyAnnotationRange([
    { start: 0, end: 10, kind: 'hi-yellow' },
    { start: 0, end: 10, kind: 'bold' },
  ], 3, 7, 'hi-blue', 10);

  assert.deepEqual(highlighted, [
    { start: 0, end: 3, kind: 'hi-yellow' },
    { start: 0, end: 10, kind: 'bold' },
    { start: 3, end: 7, kind: 'hi-blue' },
    { start: 7, end: 10, kind: 'hi-yellow' },
  ]);

  const colored = ops.applyAnnotationRange([
    { start: 0, end: 10, kind: 'color-red' },
    { start: 0, end: 10, kind: 'italic' },
  ], 2, 4, 'color-blue', 10);

  assert.deepEqual(colored, [
    { start: 0, end: 2, kind: 'color-red' },
    { start: 0, end: 10, kind: 'italic' },
    { start: 2, end: 4, kind: 'color-blue' },
    { start: 4, end: 10, kind: 'color-red' },
  ]);
});

test('Text insert and delete adjust annotation offsets', () => {
  const inserted = ops.replaceTextRange('hello world', [
    { start: 6, end: 11, kind: 'italic' },
  ], 0, 0, 'say ');

  assert.equal(inserted.content, 'say hello world');
  assert.deepEqual(inserted.annotations, [{ start: 10, end: 15, kind: 'italic' }]);

  const deleted = ops.replaceTextRange('say hello world', [
    { start: 4, end: 9, kind: 'bold' },
    { start: 10, end: 15, kind: 'italic' },
  ], 4, 10, '');

  assert.equal(deleted.content, 'say world');
  assert.deepEqual(deleted.annotations, [{ start: 4, end: 9, kind: 'italic' }]);
});

test('Functional block updates compose in one event', () => {
  let state = [{ id: 'a', content: 'a' }];
  const setBlocks = (change) => {
    state = ops.resolveBlocksChange(state, change);
  };

  setBlocks(prev => prev.map(b => b.id === 'a' ? { ...b, content: 'ab' } : b));
  setBlocks(prev => [...prev, { id: 'b', content: 'c' }]);

  assert.deepEqual(state, [
    { id: 'a', content: 'ab' },
    { id: 'b', content: 'c' },
  ]);
});

test('Clipboard tables convert to normalized markdown tables', () => {
  assert.equal(
    tableOps.clipboardToMarkdownTable({ text: 'Name\tRole\nAda\tEngineer\nLinus\tMaintainer' }),
    '| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Linus | Maintainer |'
  );

  assert.equal(
    tableOps.clipboardToMarkdownTable({
      html: '<table><tr><th>Item</th><th>Count</th></tr><tr><td>Pipes | escaped</td><td>2</td></tr></table>',
    }),
    '| Item | Count |\n| --- | --- |\n| Pipes \\| escaped | 2 |'
  );
});

test('Markdown table rows round-trip through table helpers', () => {
  const markdown = '| Name | Notes |\n| --- | --- |\n| Ada | Pipes \\| stay |\n| Grace | Compiler |';

  assert.deepEqual(tableOps.markdownTableToRows(markdown), [
    ['Name', 'Notes'],
    ['Ada', 'Pipes | stay'],
    ['Grace', 'Compiler'],
  ]);
  assert.match(tableOps.markdownTableToHtml(markdown), /<table><thead><tr><th>Name<\/th><th>Notes<\/th><\/tr><\/thead>/);
});

test('AI menu buttons open option menus instead of running Improve directly', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(outliner, /if \(scope === 'section-menu'\)[\s\S]*setAiMenu\(\{ scope: 'section'/);
  assert.match(outliner, /onOpenAiMenu && onOpenAiMenu\(e\)/);
  assert.match(outliner, /if \(e\.key === 'ArrowDown'\)[\s\S]*setActiveIdx/);
  assert.match(outliner, /document\.addEventListener\('mousedown', onDown\)/);
  assert.match(outliner, /window\.addEventListener\('keydown', onKey, true\)/);
  assert.match(outliner, /undoActionRef\.current && undoActionRef\.current\(\)/);
  assert.match(outliner, /if \(!undoStack\.current\.length\) return false/);
  assert.match(outliner, /if \(!redoStack\.current\.length\) return false/);
  assert.match(outliner, /stopImmediatePropagation/);
  assert.match(outliner, /scope === 'section' \? 'What should AI write in this section\?'/);
  assert.match(outliner, /onClick=\{\(e\) => \{[\s\S]*pickAction\(a\.id\);/);
  assert.doesNotMatch(outliner, /onPick\('improve'\)/);
});

test('Advertised keyboard shortcuts are wired to handlers', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');

  assert.match(app, /const isBackslashKey = key === '\\\\' \|\| key === '\|'/);
  assert.match(app, /e\.code === 'Backslash'/);
  assert.match(outliner, /const isBlockZoom = isMod && key === 'Enter'/);
  assert.match(outliner, /const isBlockMoveUp = e\.altKey && !isMod && key === 'ArrowUp'/);
  assert.match(outliner, /const isBlockMoveDown = e\.altKey && !isMod && key === 'ArrowDown'/);
  assert.match(outliner, /const isBlockDuplicate = isMod && lowerKey === 'd'/);
  assert.match(outliner, /const isBlockDelete = isMod && \(key === 'Backspace' \|\| key === 'Delete'\)/);
  assert.match(outliner, /moveBlockRef\.current && moveBlockRef\.current\(activeBlockId\(\), activeBlockId\(\), 'up'\)/);
  assert.match(outliner, /duplicateBlockRef\.current && duplicateBlockRef\.current\(activeBlockId\(\)\)/);
  assert.match(outliner, /deleteBlockRef\.current && deleteBlockRef\.current\(activeBlockId\(\)\)/);
  assert.match(outliner, /zoomBlockRef\.current && zoomBlockRef\.current\(activeBlockId\(\)\)/);
  assert.match(outliner, /if \(srcId === destId && position !== 'up' && position !== 'down'\) return/);
  assert.match(settings, /⌘ K/);
  assert.match(settings, /⌘ Z/);
  assert.match(settings, /⌥ ↑ \/ ⌥ ↓/);
});

test('Block area selection can delete as one undoable operation and redo it', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(outliner, /selectedBlockIds/);
  assert.match(outliner, /selectedAsArea/);
  assert.match(outliner, /const deleteSelection = \(\) =>/);
  assert.match(outliner, /const isAreaDelete = \(key === 'Backspace' \|\| key === 'Delete'\) && selectionRef\.current && !isMod/);
  assert.match(outliner, /deleteSelectionRef\.current && deleteSelectionRef\.current\(\)/);
  assert.match(outliner, /onUndo=\{undo\}/);
  assert.match(outliner, /onRedo=\{redo\}/);
});

test('Typing in a section groups into one undo entry per edit session', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(outliner, /contentEditHistoryRef/);
  assert.match(outliner, /const pushHistory = !grouped \|\| contentEditHistoryRef\.current\.armed/);
  assert.match(outliner, /if \(grouped\) contentEditHistoryRef\.current\.armed = false/);
  assert.match(outliner, /onBeginContentEdit && onBeginContentEdit\(block\.id\)/);
  assert.match(outliner, /onEndContentEdit && onEndContentEdit\(block\.id\)/);
});

test('Clicking rendered text enters edit mode at the clicked caret offset', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(outliner, /displayTextRef/);
  assert.match(outliner, /pendingCaretRef/);
  assert.match(outliner, /document\.caretPositionFromPoint/);
  assert.match(outliner, /document\.caretRangeFromPoint/);
  assert.match(outliner, /textOffsetFromPoint\(displayTextRef\.current, e\.clientX, e\.clientY, fallback\)/);
});

test('Note tag picker can create new tags from the editor', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/sidebar.jsx'), 'utf8');

  assert.match(editor, /onCreateTag/);
  assert.match(editor, /placeholder="new tag"/);
  assert.match(editor, /createAndApplyTag\(\)/);
  assert.match(app, /normalizeTagName/);
  assert.match(app, /onCreateTag=\{\(raw\) =>/);
  assert.match(sidebar, /creatingTag/);
  assert.match(sidebar, /submitTag/);
  assert.match(sidebar, /onNewTag && onNewTag\(name\)/);
  assert.match(sidebar, /if \(newTagName\.trim\(\)\) return/);
  assert.match(sidebar, /tagCreatorRef\.current\?\.contains\(e\.target\)/);
  assert.match(sidebar, /top: 42/);
});

test('Vaults can be created and deleted from settings with backend cleanup', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');

  assert.match(store, /async function deleteVault\(id\)/);
  assert.match(store, /Create another vault before deleting this one/);
  assert.match(store, /fsp\.rm\(vaultDir\(v\.slug\), \{ recursive: true, force: true \}\)/);
  assert.match(store, /deleteVault, setActiveVault/);
  assert.match(main, /ipcMain\.handle\('mn:deleteVault'/);
  assert.match(main, /idx\.removeVault\(vaultId\)/);
  assert.match(preload, /deleteVault: \(id\) => ipcRenderer\.invoke\('mn:deleteVault', id\)/);
  assert.match(app, /const deleteVault = useCallbackA\(async \(id\) =>/);
  assert.match(app, /onCreateVault=\{createVault\}/);
  assert.match(app, /onDeleteVault=\{deleteVault\}/);
  assert.match(settings, /label="Create vault"/);
  assert.match(settings, /label="Delete current vault"/);
  assert.match(settings, /Type \$\{currentVault\.name\}/);
  assert.match(settings, /Delete permanently/);
  assert.match(settings, /This cannot be undone/);
});

test('Visible block context menu options are wired to real operations', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(outliner, /position === 'up'/);
  assert.match(outliner, /position === 'down'/);
  assert.match(outliner, /loc\.arr\.splice\(loc\.idx \+ 1, 0, clone\)/);
});

test('Table blocks are parsed, rendered, copied, and pasted as formatted markdown', () => {
  const html = fs.readFileSync(path.join(__dirname, '../OminiNote.html'), 'utf8');
  const outline = fs.readFileSync(path.join(__dirname, '../src/outline.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(html, /src="src\/tableOps\.js"/);
  assert.match(outline, /readMarkdownTable\(lines, i\)/);
  assert.match(outline, /kind: 'table'/);
  assert.match(outline, /b\.kind === 'table'/);
  assert.match(outliner, /id: 'table'/);
  assert.match(outliner, /const handlePaste = \(e\) =>/);
  assert.match(outliner, /mnClipboardEventToMarkdownTable && mnClipboardEventToMarkdownTable\(e\)/);
  assert.match(outliner, /const handleCopy = \(e\) =>/);
  assert.match(outliner, /mnMarkdownTableToHtml\(block\.content \|\| ''\)/);
  assert.match(outliner, /function MnMarkdownTable/);
  assert.match(outliner, /onPaste=\{handlePaste\}/);
  assert.match(outliner, /onCopy=\{handleCopy\}/);
  assert.match(outliner, /onInsertBlocksAt/);
});

test('Selection toolbar closes on outside click and keeps overflow actions in More', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(outliner, /mn-selection-toolbar/);
  assert.match(outliner, /setSelection\(null\)/);
  assert.match(outliner, /moreOpen/);
  assert.match(outliner, /fs-small/);
  assert.match(outliner, /fs-x-large/);
});

test('Note delete confirmation uses themed in-app dialog', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');

  assert.match(app, /function MnDeleteNoteDialog/);
  assert.match(app, /className="mn-delete-note-dialog"/);
  assert.match(app, /role="dialog"/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /setDeleteTargetId\(id\)/);
  assert.match(app, /onDelete=\{\(\) => requestDeleteNote\(selectedNote\.id\)\}/);
  assert.match(app, /onConfirm=\{\(\) => deleteNote\(deleteTargetNote\.id\)\}/);
  assert.match(app, /background: T\.danger/);
  assert.doesNotMatch(app, /confirm\(/);
});

test('Launch screen uses OminiNote pastel blooming light design', () => {
  const html = fs.readFileSync(path.join(__dirname, '../OminiNote.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');

  assert.match(html, /<title>OminiNote<\/title>/);
  assert.match(html, /@keyframes mnLightBloom/);
  assert.match(html, /@keyframes mnLightWash/);
  assert.match(html, /@keyframes mnPastelRipple/);
  assert.match(html, /mn-boot-light-field/);
  assert.match(html, /mn-light-bloom/);
  assert.match(html, /mn-light-ripple/);
  assert.match(html, /width: min\(76vw, 76vh\)/);
  assert.match(html, /radial-gradient\(circle at center/);
  assert.doesNotMatch(html, /filter: blur/);
  assert.doesNotMatch(html, /vmax/);
  assert.doesNotMatch(html, /mn-pastel-float/);
  assert.doesNotMatch(html, /mn-boot-neural-field/);
  assert.doesNotMatch(html, /animateMotion/);
  assert.match(html, /mn-boot-title">OminiNote/);
  assert.match(html, /Connecting your workspace/);
  assert.match(app, /<div className="mn-boot-title">OminiNote<\/div>/);
  assert.match(app, /MN_LAUNCH_BLOOMS/);
  assert.match(app, /MN_LAUNCH_RIPPLES/);
  assert.match(app, /className="mn-boot-light-field"/);
  assert.match(app, /className="mn-light-bloom"/);
  assert.match(app, /className="mn-light-ripple"/);
  assert.doesNotMatch(app, /MN_LAUNCH_FLOATS/);
  assert.doesNotMatch(app, /MN_LAUNCH_NEURAL_PATHS/);
});

test('App and editor font size settings use stepper controls', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(settings, /function FontSizeStepper/);
  assert.match(settings, /label="App font size"/);
  assert.match(settings, /label="Font size"/);
  assert.match(app, /"appFontSize": "default"/);
  assert.match(app, /const appScale = tweaks\.appFontSize === 'small'/);
  assert.match(app, /transform: `scale\(\$\{appScale\}\)`/);
  assert.match(app, /width: `calc\(100vw \/ \$\{appScale\}\)`/);
  assert.match(outliner, /mnEditorFontScale/);
});
