const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ops = require('../src/editorOps.js');
const tableOps = require('../src/tableOps.js');

function loadOutlineForTest() {
  const code = fs.readFileSync(path.join(__dirname, '../src/outline.jsx'), 'utf8');
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
  assert.match(outliner, /const isBlockDelete = isMod && \(key === 'Backspace' \|\| key === 'Delete'\) && !isFormField/);
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
  assert.match(outliner, /const currentSelection = selectionRef\.current/);
  assert.match(outliner, /const isAreaDelete = \(key === 'Backspace' \|\| key === 'Delete'\) && currentSelection\?\.kind === 'blocks' && !isMod/);
  assert.doesNotMatch(outliner, /const isAreaDelete = \(key === 'Backspace' \|\| key === 'Delete'\) && selectionRef\.current && !isMod/);
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

test('Code blocks preserve language metadata and expose syntax UI', () => {
  const outlineApi = loadOutlineForTest();
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  const blocks = outlineApi.mnMdToBlocks('```js\nconst answer = 42;\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].language, 'javascript');
  assert.equal(blocks[0].content, 'const answer = 42;');
  assert.equal(outlineApi.mnBlocksToMd(blocks), '```javascript\nconst answer = 42;\n```');

  assert.match(outliner, /const MN_CODE_LANGUAGES = \[/);
  assert.match(outliner, /value: 'javascript'/);
  assert.match(outliner, /function mnRenderCode/);
  assert.match(outliner, /<select[\s\S]+Code language/);
  assert.match(outliner, /mnRenderCode\(content, block\.language, T\)/);
});

test('Reminder center and spellcheck wiring are visible in app shell', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const panels = fs.readFileSync(path.join(__dirname, '../src/panels.jsx'), 'utf8');

  assert.match(app, /function MnReminderCenter/);
  assert.match(app, /className="mn-reminder-center"/);
  assert.match(app, /mnCollectReminderItems\(notesWithBody\)/);
  assert.match(app, /reminderDueCount/);
  assert.match(app, /Reminder notifications/);
  assert.match(app, /setReminderCenterOpen\(false\)/);
  assert.match(app, /const visibleItems = items/);
  assert.doesNotMatch(app, /items\.slice\(0, 12\)/);
  assert.match(editor, /padding: '14px 76px 10px 28px'/);

  assert.match(editor, /spellCheck=\{spellCheck\}/);
  assert.match(outliner, /spellCheck=\{block\.kind === 'code' \? false : spellCheck\}/);
  assert.match(panels, /<button onClick=\{onDismiss\}[\s\S]*>✕<\/button>/);
  assert.match(panels, /<button onClick=\{onSnooze \|\| onDismiss\}[\s\S]*>Snooze<\/button>/);
});

test('Canvas workspace is wired through storage, navigation, and note embeds', () => {
  const html = fs.readFileSync(path.join(__dirname, '../OminiNote.html'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/sidebar.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const canvas = fs.readFileSync(path.join(__dirname, '../src/canvas.jsx'), 'utf8');

  assert.match(html, /src="src\/canvas\.jsx"/);
  assert.match(store, /function canvasDir\(slug\)/);
  assert.match(store, /async function listCanvases\(vaultId\)/);
  assert.match(store, /async function saveCanvas\(vaultId, canvas\)/);
  assert.match(store, /async function deleteCanvas\(vaultId, canvasId\)/);
  assert.match(main, /ipcMain\.handle\('mn:listCanvases'/);
  assert.match(main, /ipcMain\.handle\('mn:getCanvas'/);
  assert.match(preload, /listCanvases: \(vaultId\) => ipcRenderer\.invoke\('mn:listCanvases', vaultId\)/);
  assert.match(preload, /saveCanvas: \(vaultId, canvas\) => ipcRenderer\.invoke\('mn:saveCanvas', vaultId, canvas\)/);
  assert.match(sidebar, /label="Canvas"/);
  assert.match(sidebar, /canvasActive/);
  assert.match(app, /const \[canvases, setCanvases\]/);
  assert.match(app, /const \[activeCanvas, setActiveCanvas\]/);
  assert.match(app, /window\.mn\.listCanvases\(activeId\)/);
  assert.match(app, /view === 'canvas'/);
  assert.match(app, /<MnCanvasPanel/);
  assert.match(editor, /allCanvases=\{canvases\}/);
  assert.match(outliner, /id: 'canvas'/);
  assert.match(outliner, /\{\{canvas/);
  assert.match(outliner, /<MnCanvasPicker/);
  assert.match(outliner, /<MnCanvasEmbed/);
  assert.match(canvas, /const MN_CANVAS_TOOLS = \[/);
  assert.match(canvas, /function MnCanvasPanel/);
  assert.match(canvas, /function MnCanvasEditor/);
  assert.match(canvas, /function MnCanvasEmbed/);
});

test('Canvas editor supports expected drawing, color, clipboard, and delete interactions', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '../src/canvas.jsx'), 'utf8');

  assert.match(canvas, /id: 'pen'/);
  assert.match(canvas, /id: 'arrow'/);
  assert.match(canvas, /id: 'diamond'/);
  assert.match(canvas, /id: 'triangle'/);
  assert.match(canvas, /id: 'eraser'/);
  assert.match(canvas, /function MnCanvasToolIcon/);
  assert.match(canvas, /aria-label=\{tool\.label\}/);
  assert.match(canvas, /mnCanvasIconToolButton/);
  assert.match(canvas, /function MnCanvasContextMenu/);
  assert.match(canvas, /onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(canvas, /Delete object/);
  assert.match(canvas, /copyElements/);
  assert.match(canvas, /pasteElements/);
  assert.match(canvas, /navigator\.clipboard/);
  assert.match(canvas, /key === 'c'/);
  assert.match(canvas, /key === 'x'/);
  assert.match(canvas, /key === 'v'/);
  assert.match(canvas, /x2: point\.x/);
  assert.match(canvas, /y2: point\.y/);
  assert.match(canvas, /points: \[/);
  assert.match(canvas, /mnCanvasArrowHead/);
  assert.match(canvas, /element\.type === 'diamond'/);
  assert.match(canvas, /element\.type === 'triangle'/);
  assert.match(canvas, /tool === 'eraser'/);
  assert.match(canvas, /function MnCanvasColorControl/);
  assert.match(canvas, /type="color"/);
  assert.match(canvas, /applyColor\('stroke'/);
  assert.match(canvas, /applyColor\('fill'/);
  assert.match(canvas, /function MnCanvasDeleteDialog/);
  assert.match(canvas, /role="dialog"/);
  assert.doesNotMatch(canvas, /window\.confirm\('Delete this canvas\?'\)/);
  assert.match(canvas, /setPointerCapture/);
  assert.match(canvas, /releasePointerCapture/);
  assert.match(canvas, /rootRef\.current\?\.focus\(\)/);
  assert.match(canvas, /saveTitle\(\); onBack && onBack\(\)/);

  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  assert.match(app, /setActiveCanvas\(current => current\?\.id === saved\.id \? saved : current\)/);
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
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="assets\/omini-note-icon\.svg" \/>/);
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
  assert.match(html, /mn-boot-brand/);
  assert.match(html, /mn-boot-logo/);
  assert.match(html, /mn-boot-title mn-boot-wordmark/);
  assert.match(html, /mn-word-omni">Omini/);
  assert.match(html, /mn-word-note">Note/);
  assert.match(html, /Capture<\/span><i><\/i><span>Organize<\/span><i><\/i><span>Remember/);
  assert.doesNotMatch(html, /@keyframes mnBootLogoTrace/);
  assert.doesNotMatch(html, /@keyframes mnBootLogoGlow/);
  assert.doesNotMatch(html, /@keyframes mnBootWordGlow/);
  assert.doesNotMatch(html, /mnBootLogoFloat/);
  assert.doesNotMatch(html, /mnBootWordGlow/);
  assert.match(html, /Connecting your workspace/);
  assert.match(app, /function MnBootLogo/);
  assert.match(app, /className="mn-boot-title mn-boot-wordmark"/);
  assert.match(app, /className="mn-word-omni">Omini/);
  assert.match(app, /className="mn-word-note">Note/);
  assert.match(app, /<MnBootLogo \/>/);
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

test('Review fixes wire settings, rollup, reminders, and safe note paths', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const panels = fs.readFileSync(path.join(__dirname, '../src/panels.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/sidebar.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const markdown = fs.readFileSync(path.join(__dirname, '../src/markdown.jsx'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');

  assert.match(app, /tweaks\.sortBy/);
  assert.match(app, /tweaks\.pinnedFirst/);
  assert.match(app, /mnParseDefaultTags\(tweaks\.defaultTags\)/);
  assert.match(app, /toggleCheckFromAggregate = \(it\) =>/);
  assert.match(app, /it\.blockId/);
  assert.match(app, /mnCollectReminderItems\(notesWithBody\)/);
  assert.match(app, /mnWriteSnoozedReminder/);

  assert.match(outliner, /spellCheck=\{block\.kind === 'code' \? false : spellCheck\}/);
  assert.match(outliner, /indentGuides && Array\.from/);
  assert.match(outliner, /autoLink \? before\.match/);
  assert.match(outliner, /collapseByDefault && cmd\.kind === 'heading'/);
  assert.match(outliner, /window\.MN_REMIND\?\.defaultText/);
  assert.doesNotMatch(outliner, /@remind\(tomorrow 9am\)/);

  assert.match(markdown, /window\.MN_REMIND/);
  assert.match(markdown, /function mnDefaultReminderText/);
  assert.match(panels, /blockId: block\.id/);
  assert.match(panels, /isReminderOnly/);
  assert.match(panels, /onSnooze \|\| onDismiss/);
  assert.match(panels, /rollupFormat === 'short'/);
  assert.match(sidebar, /label="Daily rollup"/);
  assert.match(sidebar, /const rollupCount = notes\.length/);

  assert.match(settings, /<StaticValue T=\{T\}>Markdown<\/StaticValue>/);
  assert.match(settings, /<StaticValue T=\{T\}>Local only<\/StaticValue>/);
  assert.match(settings, /<StaticValue T=\{T\}>Always on<\/StaticValue>/);
  assert.match(store, /function validateNoteId/);
  assert.match(store, /\^\[A-Za-z0-9_-\]\+\$/);
  assert.match(store, /path\.relative\(dir, file\)/);
});

test('Electron installs native edit context menu for right-click copy paste cut', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../OminiNote.html'), 'utf8');
  const icon = fs.readFileSync(path.join(__dirname, '../assets/omini-note-icon.svg'), 'utf8');

  assert.match(main, /APP_ICON_PATH = path\.join\(__dirname, 'assets', 'omini-note-icon\.svg'\)/);
  assert.match(main, /const fs = require\('fs'\)/);
  assert.match(main, /fs\.readFileSync\(APP_ICON_PATH, 'utf8'\)/);
  assert.match(main, /function createAppIcon\(\)/);
  assert.match(main, /function createFallbackIcon\(\)/);
  assert.match(main, /if \(!image\.isEmpty\(\)\) return image/);
  assert.match(main, /nativeImage\.createFromDataURL/);
  assert.match(main, /new Tray\(createAppIcon\(\)\)/);
  assert.match(main, /icon: createAppIcon\(\)/);
  assert.match(main, /app\.dock\?\.setIcon\(createAppIcon\(\)\)/);
  assert.match(main, /function attachEditContextMenu\(win\)/);
  assert.match(main, /webContents\.on\('context-menu'/);
  assert.match(main, /params\.isEditable/);
  assert.match(main, /dictionarySuggestions/);
  assert.match(main, /replaceMisspelling\(word\)/);
  assert.match(main, /addWordToSpellCheckerDictionary\(params\.misspelledWord\)/);
  assert.match(main, /spellcheck: true/);
  assert.match(main, /setSpellCheckerEnabled\(true\)/);
  assert.match(main, /availableSpellCheckerLanguages/);
  assert.match(main, /setSpellCheckerLanguages\(\[spellLanguage\]\)/);
  assert.match(main, /ipcMain\.handle\('mn:spellcheck'/);
  assert.match(main, /role: 'cut'/);
  assert.match(main, /role: 'copy'/);
  assert.match(main, /role: 'paste'/);
  assert.match(main, /role: 'selectAll'/);
  assert.match(main, /attachEditContextMenu\(win\)/);
  assert.match(icon, /OminiNote app icon/);
  assert.match(icon, /<svg[^>]+width="512"[^>]+height="512"[^>]+viewBox="0 0 512 512"/);
  assert.match(icon, /<rect width="512" height="512"/);
  assert.match(icon, /strokeMain/);
  assert.match(icon, /strokeBrain/);
  assert.match(icon, /softGlow/);
  assert.match(html, /href="assets\/omini-note-icon\.svg"/);
});

test('Fallback spell checker underlines misspellings and offers replacements', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(main, /function spellcheckWords/);
  assert.match(main, /SPELL_DICTIONARY_PATHS/);
  assert.match(main, /spellSuggestions\(word, dictionary\)/);
  assert.match(preload, /spellcheck: \(words\) => ipcRenderer\.invoke\('mn:spellcheck', words\)/);
  assert.match(outliner, /function mnRenderSpellCheckedText/);
  assert.match(outliner, /textDecorationStyle: 'wavy'/);
  assert.match(outliner, /MnSpellSuggestionMenu/);
  assert.match(outliner, /window\.mn\.spellcheck\(words\)/);
  assert.match(outliner, /applySpellSuggestion/);
});

test('Block clipboard preserves multi-block formatting for copy cut paste', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/blockFeatures.jsx'), 'utf8');

  assert.match(outliner, /MN_BLOCK_CLIPBOARD_TYPE/);
  assert.match(outliner, /mnNormalizeClipboardMarkdown/);
  assert.match(outliner, /mnReidBlocks/);
  assert.match(outliner, /writeBlocksToClipboard/);
  assert.match(outliner, /parseClipboardBlocks/);
  assert.match(outliner, /document\.addEventListener\('copy', onCopy\)/);
  assert.match(outliner, /document\.addEventListener\('cut', onCut\)/);
  assert.match(outliner, /document\.addEventListener\('paste', onPaste\)/);
  assert.match(outliner, /parseClipboardBlocks\?\.\(e\.clipboardData, \{ allowSingle: false \}\)/);
  assert.match(outliner, /if \(e\.button === 2\) return/);
  assert.match(outliner, /keyboardEditActionsRef/);
  assert.match(outliner, /const isBlockEditCommand = currentSelection\?\.kind === 'blocks' && \(isCopy \|\| isCut \|\| isPaste\)/);
  assert.match(outliner, /keyboardEditActionsRef\.current\?\.copySelectedBlocks\?\.\(\)/);
  assert.match(outliner, /keyboardEditActionsRef\.current\?\.cutSelectedBlocks\?\.\(\)/);
  assert.match(outliner, /keyboardEditActionsRef\.current\?\.pasteForKeyboard\?\.\(\)/);
  assert.match(outliner, /keyboardEditActionsRef\.current\?\.selectAllBlocks\?\.\(\)/);
  assert.match(outliner, /replaceSelectedBlocksWith/);
  assert.match(outliner, /onCopyBlock=\{\(\) => copyContextBlocks\(ctxBlock\.id\)\}/);
  assert.match(outliner, /onCutBlock=\{\(\) => cutContextBlocks\(ctxBlock\.id\)\}/);
  assert.match(outliner, /onPasteAfter=\{\(\) => pasteContextBlocksAfter\(ctxBlock\.id\)\}/);
  assert.match(outliner, /if \(!fullSelection\) return/);
  assert.match(outliner, /value\.slice\(0, start\) \+ value\.slice\(end\)/);
  assert.match(outliner, /writeBlocksToSystemClipboard/);
  assert.match(outliner, /document\.execCommand\?\.\('copy'\)/);
  assert.match(outliner, /document\.execCommand\?\.\('cut'\)/);
  assert.match(outliner, /await navigator\.clipboard\.writeText\(payload\.markdown\)/);
  assert.match(outliner, /catch \(e\) \{[\s\S]*return false;/);
  assert.match(outliner, /const copied = await writeBlocksToSystemClipboard/);
  assert.match(outliner, /const copied = writeBlocksToClipboard\(selectedBlocks, e\.clipboardData\)/);

  assert.match(blockFeatures, /label="Copy block"/);
  assert.match(blockFeatures, /label="Cut block"/);
  assert.match(blockFeatures, /label="Paste after"/);
});

test('Workflow notes can be archived from workflow boards only', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const panels = fs.readFileSync(path.join(__dirname, '../src/panels.jsx'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/blockFeatures.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const outline = fs.readFileSync(path.join(__dirname, '../src/outline.jsx'), 'utf8');
  const notelist = fs.readFileSync(path.join(__dirname, '../src/notelist.jsx'), 'utf8');

  assert.match(app, /workflowArchived: !!n\.workflowArchived/);
  assert.match(app, /if \(note\.workflowArchived\) \{/);
  assert.match(app, /archivedNotes\.push/);
  assert.match(app, /const updateWorkflowArchived = useCallbackA/);
  assert.match(app, /archivedNotes=\{workflowViewData\.archivedNotes\}/);
  assert.match(app, /onSetWorkflowArchived=\{updateWorkflowArchived\}/);
  assert.match(app, /"workflowStates": null/);
  assert.match(app, /mnNormalizeWorkflowStatesForApp/);
  assert.match(app, /const workflowStates = useMemoA/);
  assert.match(app, /setWorkflowStates\?\.\(workflowStates\)/);
  assert.match(app, /const updateWorkflowStates = useCallbackA/);
  assert.match(app, /onWorkflowStatesChange=\{updateWorkflowStates\}/);
  assert.doesNotMatch(app, /countFor\('WAIT'\) \+ countFor\('LATER'\)/);
  assert.doesNotMatch(app, /countFor\('DONE'\) \+ countFor\('CANCELLED'\)/);

  assert.match(panels, /archivedNotes = \[\]/);
  assert.match(panels, /ArchiveButton/);
  assert.match(panels, /Archive note from workflow/);
  assert.match(panels, /Archived from workflow/);
  assert.match(panels, /\{showArchived \? <ArchivedNotes \/> : \(/);
  assert.match(panels, /Restore/);
  assert.match(panels, /archiveNote\(note\.id, false\)/);
  assert.match(panels, /WorkflowStateManager/);
  assert.match(panels, /new column/);
  assert.match(panels, /addWorkflowState/);
  assert.match(panels, /removeWorkflowState/);
  assert.match(panels, /onWorkflowStatesChange && onWorkflowStatesChange/);
  assert.match(panels, /SummaryStat label="Columns"/);
  assert.match(panels, /SummaryStat label="Active cols"/);
  assert.doesNotMatch(panels, /const waitingCount = countFor\('WAIT'\) \+ countFor\('LATER'\)/);
  assert.doesNotMatch(panels, /const closedCount = countFor\('DONE'\) \+ countFor\('CANCELLED'\)/);

  assert.match(store, /workflowArchived: !!fm\.workflowArchived/);
  assert.match(store, /workflowArchived: !!note\.workflowArchived/);
  assert.match(blockFeatures, /mnNormalizeWorkflowStates/);
  assert.match(blockFeatures, /mnNormalizeWorkflowId/);
  assert.match(blockFeatures, /let MN_WORKFLOW_STATES = MN_DEFAULT_WORKFLOW_STATES/);
  assert.match(blockFeatures, /Object\.prototype\.hasOwnProperty\.call\(state \|\| \{\}, 'next'\)/);
  assert.match(blockFeatures, /Object\.prototype\.hasOwnProperty\.call\(fallback, 'next'\)/);
  assert.match(blockFeatures, /next: state\.next === undefined/);
  assert.match(blockFeatures, /safe\[index \+ 1\]\?\.id \|\| null/);
  assert.match(blockFeatures, /function mnWorkflowIsClosed\(state\)/);
  assert.match(blockFeatures, /mnWorkflowIsClosed,/);
  assert.match(blockFeatures, /setWorkflowStates: mnSetWorkflowStates/);
  assert.match(blockFeatures, /DEFAULT_WORKFLOW_STATES/);
  assert.match(panels, /const isClosedState = \(state\) => window\.MN_LOGSEQ\?\.mnWorkflowIsClosed/);
  assert.match(panels, /textDecoration: isClosedState\(state\) \? 'line-through' : 'none'/);
  assert.doesNotMatch(panels, /state\.id === 'DONE' \|\| state\.id === 'CANCELLED'/);
  assert.match(outliner, /function mnWorkflowSlashCommands/);
  assert.match(outliner, /return \[\.\.\.MN_SLASH_CMDS, \.\.\.mnWorkflowSlashCommands\(\)\]/);
  assert.match(outline, /window\.MN_LOGSEQ\?\.WORKFLOW_STATES/);
  assert.doesNotMatch(outline, /\^\(TODO\|DOING\|DONE\|LATER\|NOW\|WAIT\|CANCELLED\)/);
  assert.match(notelist, /const workflowPattern = states/);
  assert.doesNotMatch(notelist, /\^\(TODO\|DOING\|DONE\|LATER\|NOW\|WAIT\|CANCELLED\)/);
});
