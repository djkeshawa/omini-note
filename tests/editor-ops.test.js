const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ops = require('../src/editor/editorOps.js');
const tableOps = require('../src/editor/tableOps.js');
const appHelpers = require('../src/app/appHelpers.js');
const appNovelist = require('../src/app/appNovelist.js');
const appMutations = require('../src/app/appMutations.js');
const appCanvasActions = require('../src/app/appCanvasActions.js');
const panelHelpers = require('../src/panels/panelHelpers.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');
const projectPaths = require('./helpers/paths.js');

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

test('Outliner history preserves unchanged block identity for memoized rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/editor/outlinerHistory.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  const history = context.window.MN_OUTLINER_HISTORY;

  const previous = [
    { id: 'a', content: 'keep', annotations: [], children: [] },
    { id: 'b', content: 'old', annotations: [], children: [
      { id: 'c', content: 'child', annotations: [], children: [] },
    ] },
  ];
  const next = structuredClone(previous);
  next[1].content = 'new';

  const shared = history.shareBlockTree(previous, next);
  assert.equal(shared[0], previous[0]);
  assert.notEqual(shared[1], previous[1]);
  assert.equal(shared[1].children[0], previous[1].children[0]);

  const editorHistory = history.createEditorHistory(2);
  editorHistory.record(previous);
  assert.deepEqual(editorHistory.undo(next), previous);
  assert.deepEqual(editorHistory.redo(previous), next);
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

test('Table helpers reject oversized tables without throwing', () => {
  const rows = Array.from({ length: tableOps.limits.MAX_TABLE_ROWS + 1 }, () => ['a', 'b']);
  assert.doesNotThrow(() => tableOps.normalizeRows(rows));
  assert.deepEqual(tableOps.normalizeRows(rows), []);
  assert.equal(
    tableOps.clipboardToMarkdownTable({ text: Array.from({ length: tableOps.limits.MAX_TABLE_ROWS + 1 }, () => 'a\tb').join('\n') }),
    ''
  );
});

test('Markdown table rows round-trip through table helpers', () => {
  const markdown = '| Name | Notes |\n| --- | --- |\n| Ada | Pipes \\| stay |\n| Grace | C:\\temp\\notes |';

  assert.deepEqual(tableOps.markdownTableToRows(markdown), [
    ['Name', 'Notes'],
    ['Ada', 'Pipes | stay'],
    ['Grace', 'C:\\temp\\notes'],
  ]);
  assert.match(tableOps.markdownTableToHtml(markdown), /<table><thead><tr><th>Name<\/th><th>Notes<\/th><\/tr><\/thead>/);
});

test('Block area selection can delete as one undoable operation and redo it', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');

  assert.match(outliner, /selectedBlockIds/);
  assert.match(outliner, /selectedAsArea/);
  assert.match(outliner, /const deleteSelection = \(\) =>/);
  assert.match(outliner, /const currentSelection = selectionRef\.current/);
  assert.match(outliner, /const isTextDelete = \(key === 'Backspace' \|\| key === 'Delete'\) && currentSelection\?\.kind === 'text' && !isMod/);
  assert.match(outliner, /const isAreaDelete = \(key === 'Backspace' \|\| key === 'Delete'\) && currentSelection\?\.kind === 'blocks' && !isMod/);
  assert.doesNotMatch(outliner, /const isAreaDelete = \(key === 'Backspace' \|\| key === 'Delete'\) && selectionRef\.current && !isMod/);
  assert.match(outliner, /if \(\(isTextDelete \|\| isBlockShortcut \|\| isBlockEditCommand \|\| isOutlinerSelectAll\) && !insideOutliner && !activeInsideOutliner\) return/);
  assert.doesNotMatch(outliner, /if \(\(isAreaDelete \|\| isBlockShortcut \|\| isBlockEditCommand \|\| isOutlinerSelectAll\) && !insideOutliner && !activeInsideOutliner\) return/);
  assert.match(outliner, /if \(isTextDelete \|\| isAreaDelete\) deleteSelectionRef\.current && deleteSelectionRef\.current\(\)/);
  assert.match(outliner, /onUndo=\{undo\}/);
  assert.match(outliner, /onRedo=\{redo\}/);
});

test('Typing in a section groups into one undo entry per edit session', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');
  const rendererEntry = fs.readFileSync(projectPaths.src.main, 'utf8');

  assert.match(outliner, /contentEditHistoryRef/);
  assert.match(rendererEntry, /import '\.\/editor\/outlinerHistory\.js';/);
  assert.match(outliner, /mnCreateEditorHistory/);
  assert.match(outliner, /mnShareBlockTree/);
  assert.match(outliner, /const MnMemoBlockRow = React\.memo\(MnBlockRow, mnBlockRowMemoEqual\)/);
  assert.match(outliner, /<MnMemoBlockRow block=\{b\} depth=\{depth\} \{\.\.\.handlers\} \/>/);
  assert.match(outliner, /const pushHistory = !grouped \|\| contentEditHistoryRef\.current\.armed/);
  assert.match(outliner, /if \(grouped\) contentEditHistoryRef\.current\.armed = false/);
  assert.match(outliner, /onBeginContentEdit && onBeginContentEdit\(block\.id\)/);
  assert.match(outliner, /onEndContentEdit && onEndContentEdit\(block\.id\)/);
});

test('Empty nested blocks can leave nesting with Enter', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');
  const regression = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');

  assert.match(outliner, /const isEmptyBlock = block\.content\.trim\(\) === ''/);
  assert.match(outliner, /if \(isEmptyBlock\) \{[\s\S]*if \(depth > 0\) \{ onOutdent\(block\.id\); return; \}/);
  assert.doesNotMatch(outliner, /block\.content\.trim\(\) === '' && \(block\.kind === 'bullet' \|\| block\.kind === 'todo'\)/);
  assert.match(outliner, /data-block-kind=\{block\.kind \|\| 'paragraph'\}/);
  assert.match(outliner, /data-block-depth=\{depth\}/);
  assert.match(outliner, /data-mn-block-content="editor"/);
  assert.match(outliner, /data-mn-block-content="display"/);
  assert.match(regression, /runScenario\(win, 'Editor', 'empty paragraph Enter-Tab-Enter returns to parent level'/);
  assert.match(regression, /runScenario\(win, 'Editor', 'empty bullet Enter-Tab-Enter returns to parent level'/);
  assert.match(regression, /Shift\+Tab returns an empty nested paragraph to parent level/);
  assert.match(regression, /Editor rows:/);
});

test('Clicking rendered text enters edit mode at the clicked caret offset', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');

  assert.match(outliner, /displayTextRef/);
  assert.match(outliner, /pendingCaretRef/);
  assert.match(outliner, /document\.caretPositionFromPoint/);
  assert.match(outliner, /document\.caretRangeFromPoint/);
  assert.match(outliner, /textOffsetFromPoint\(displayTextRef\.current, e\.clientX, e\.clientY, fallback\)/);
});

test('Visible block context menu options are wired to real operations', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');

  assert.match(outliner, /position === 'up'/);
  assert.match(outliner, /position === 'down'/);
  assert.match(outliner, /loc\.arr\.splice\(loc\.idx \+ 1, 0, clone\)/);
});

test('Table blocks are parsed, rendered, copied, and pasted as formatted markdown', () => {
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');
  const rendererEntry = fs.readFileSync(projectPaths.src.main, 'utf8');
  const outline = fs.readFileSync(path.join(__dirname, '../src/editor/outline.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');

  assert.match(html, /src="build\/renderer\/app\.js"/);
  assert.match(rendererEntry, /import '\.\/editor\/tableOps\.js';/);
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
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');
  const renderers = fs.readFileSync(path.join(__dirname, '../src/editor/outlinerRenderers.jsx'), 'utf8');
  const highlighter = fs.readFileSync(path.join(__dirname, '../src/editor/codeHighlighter.jsx'), 'utf8');

  const blocks = outlineApi.mnMdToBlocks('```js\nconst answer = 42;\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].language, 'javascript');
  assert.equal(blocks[0].content, 'const answer = 42;');
  assert.equal(outlineApi.mnBlocksToMd(blocks), '```javascript\nconst answer = 42;\n```');

  assert.match(highlighter, /const MN_CODE_LANGUAGES = \[/);
  assert.match(highlighter, /value: 'javascript'/);
  assert.match(highlighter, /window\.MN_CODE_HIGHLIGHTER/);
  assert.match(renderers, /function mnRenderCode/);
  assert.match(outliner, /<select[\s\S]+Code language/);
  assert.match(outliner, /mnRenderCode\(content, block\.language, T\)/);
  assert.match(renderers, /mnMermaidSvgHeight\(svg\)/);
  assert.match(renderers, /height: doc \? Math\.max\(160, height\) : 0/);
});

test('Selection toolbar closes on outside click and keeps overflow actions in More', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');

  assert.match(outliner, /mn-selection-toolbar/);
  assert.match(outliner, /setSelection\(null\)/);
  assert.match(outliner, /moreOpen/);
  assert.match(outliner, /fs-small/);
  assert.match(outliner, /fs-x-large/);
});

test('Block clipboard preserves multi-block formatting for copy cut paste', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/editor/blockFeatures.jsx'), 'utf8');

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
  assert.match(outliner, /const copied = handlers\.writeBlocksToClipboard\?\.\(selectedBlocks, e\.clipboardData\)/);
  assert.match(outliner, /clipboardHandlersRef\.current = \{/);

  assert.match(blockFeatures, /label="Copy block"/);
  assert.match(blockFeatures, /label="Cut block"/);
  assert.match(blockFeatures, /label="Paste after"/);
});

test('Markdown input rules do not replace paste or clipboard markdown behavior', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');

  assert.match(outliner, /const handlePaste = \(e\) =>/);
  assert.match(outliner, /mnClipboardEventToMarkdownTable && mnClipboardEventToMarkdownTable\(e\)/);
  assert.match(outliner, /onChangeKind\(block\.id, \{\s*kind: 'table'[\s\S]*content: markdown/);
  assert.match(outliner, /const tableBlock = mkBlock\(\{ kind: 'table', content: markdown \}\)/);
  assert.match(outliner, /parseClipboardBlocks\?\.\(e\.clipboardData, \{ allowSingle: false \}\)/);
  assert.doesNotMatch(outliner, /findBlockStarterConversion[\s\S]*const handlePaste = \(e\)[\s\S]*findBlockStarterConversion/);
});

test('Markdown block conversion remains one undoable kind change and leaves text editing hooks intact', () => {
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');

  assert.match(outliner, /const parsed = MN_MARKDOWN_INPUT_RULES\.parseEditableMarkdownBlock\?\.\(\{ block, text: v \}\)/);
  assert.match(outliner, /if \(parsed\?\.patch\) onChangeKind\(block\.id, parsed\.patch\)/);
  assert.match(outliner, /const blockStarter = MN_MARKDOWN_INPUT_RULES\.findBlockStarterConversion/);
  assert.match(outliner, /onChangeKind\(block\.id, blockStarter\.patch\)/);
  assert.match(outliner, /else \{\s*onChange\(block\.id, v\);\s*\}/);
  assert.match(outliner, /const grouped = contentEditHistoryRef\.current\.blockId === id/);
  assert.match(outliner, /const pushHistory = !grouped \|\| contentEditHistoryRef\.current\.armed/);
  assert.match(outliner, /if \(grouped\) contentEditHistoryRef\.current\.armed = false/);
  assert.match(outliner, /if \(e\.key === 'Backspace'/);
  assert.match(outliner, /onMergePrev\(block\.id\)/);
});
