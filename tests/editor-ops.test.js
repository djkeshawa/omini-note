const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ops = require('../src/editorOps.js');
const tableOps = require('../src/tableOps.js');

async function withIsolatedStore(fn) {
  const previousHome = process.env.HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-store-'));
  const storePath = require.resolve('../lib/store');
  delete require.cache[storePath];
  process.env.HOME = tmpHome;
  try {
    const store = require('../lib/store');
    return await fn(store, tmpHome);
  } finally {
    delete require.cache[storePath];
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

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
  assert.match(outliner, /const \[aiPrompt, setAiPrompt\]/);
  assert.match(outliner, /title: scope === 'page' \? 'Write on this page'/);
  assert.doesNotMatch(outliner, /window\.prompt/);
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
  assert.match(sidebar, /onDeleteTag/);
  assert.match(sidebar, /openTagMenu\(e, tag\.name\)/);
  assert.match(sidebar, /title="Remove tag"/);
  assert.match(sidebar, /Remove tag/);
  assert.match(sidebar, /if \(newTagName\.trim\(\)\) return/);
  assert.match(sidebar, /tagCreatorRef\.current\?\.contains\(e\.target\)/);
  assert.match(sidebar, /top: 50/);
  assert.match(app, /const removeTag = \(name\) =>/);
  assert.match(app, /onDeleteTag=\{removeTag\}/);
  assert.match(app, /const taggedNotes = notes\.filter\(n => \(n\.tags \|\| \[\]\)\.includes\(clean\)\)/);
  assert.match(app, /tags: \(n\.tags \|\| \[\]\)\.filter\(t => t !== clean\)/);
});

test('Vaults can be created and deleted from settings with backend cleanup', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');

  assert.match(store, /async function deleteVault\(id\)/);
  assert.match(store, /const APP_DIR_NAME = 'VispNote'/);
  assert.match(store, /const LEGACY_APP_DIR_NAMES = \['OminiNote', 'MyNote'\]/);
  assert.match(store, /const ROOT = !fs\.existsSync\(PRIMARY_ROOT\) && LEGACY_ROOT \? LEGACY_ROOT : PRIMARY_ROOT/);
  assert.match(store, /async function repairConfigVaults\(cfg\)/);
  assert.match(store, /async function vaultDirectoryExists\(slug\)/);
  assert.match(store, /cfg\.vaults = validVaults/);
  assert.match(store, /Create another vault before deleting this one/);
  assert.match(store, /fsp\.rm\(vaultDir\(v\.slug\), \{ recursive: true, force: true \}\)/);
  assert.match(store, /deleteVault, setActiveVault/);
  assert.match(main, /ipcMain\.handle\('mn:deleteVault'/);
  assert.match(main, /idx\.removeVault\(vaultId\)/);
  assert.match(preload, /deleteVault: \(id\) => ipcRenderer\.invoke\('mn:deleteVault', id\)/);
  assert.match(app, /const deleteVault = useCallbackA\(async \(id\) =>/);
  assert.match(app, /const refreshVaultRegistry = useCallbackA/);
  assert.match(app, /refreshVaultRegistry\(\{ reloadActive: true, reason: 'focus' \}\)/);
  assert.match(app, /onRefreshVaults=\{refreshVaultRegistry\}/);
  assert.match(app, /onCreateVault=\{createVault\}/);
  assert.match(app, /onDeleteVault=\{deleteVault\}/);
  assert.match(settings, /label="Create vault"/);
  assert.match(settings, /label="Delete current vault"/);
  assert.match(settings, /role="dialog"/);
  assert.match(settings, /aria-labelledby="mn-delete-vault-title"/);
  assert.match(settings, /Type vault name to confirm/);
  assert.match(settings, /Delete permanently/);
  assert.match(settings, /This permanently removes the current vault folder/);
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

test('Markdown round-trip preserves heading children used by novelist links', () => {
  const outlineApi = loadOutlineForTest();
  const md = '# Act 1\n- act:: [[Act One]]\n- [[Chapter 1]]\n  - [[Scene 1]]';
  const blocks = outlineApi.mnMdToBlocks(md);
  const roundTrip = outlineApi.mnBlocksToMd(blocks);

  assert.match(roundTrip, /# Act 1/);
  assert.match(roundTrip, /act:: \[\[Act One\]\]/);
  assert.match(roundTrip, /\[\[Chapter 1\]\]/);
  assert.match(roundTrip, /\[\[Scene 1\]\]/);

  const labelled = outlineApi.mnMdToBlocks('{{label:blue|Needs+work}} Important block');
  assert.equal(labelled[0].labels[0].color, 'blue');
  assert.equal(labelled[0].labels[0].text, 'Needs work');
  assert.equal(labelled[0].content, 'Important block');
  assert.match(outlineApi.mnBlocksToMd(labelled), /\{\{label:blue\|Needs\+work\}\}Important block/);

  const plotBlocks = outlineApi.mnMdToBlocks('::: plot-points\n- Find the key\n  - context:: [[Alice]]\n:::\nDraft text');
  assert.equal(plotBlocks[0].kind, 'plot-points');
  assert.deepEqual(Array.from(plotBlocks[0].beats), ['Find the key']);
  assert.deepEqual(Array.from(plotBlocks[0].contexts), ['[[Alice]]']);
  assert.match(outlineApi.mnBlocksToMd(plotBlocks), /::: plot-points\n- Find the key\n  - context:: \[\[Alice\]\]\n:::/);
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
  assert.match(editor, /padding: '14px clamp\(18px, 4vw, 76px\) 8px clamp\(18px, 3vw, 28px\)'/);

  assert.match(editor, /spellCheck=\{spellCheck\}/);
  assert.match(outliner, /spellCheck=\{block\.kind === 'code' \? false : spellCheck\}/);
  assert.match(outliner, /spellCheck=\{false\}/);
  assert.match(panels, /<button onClick=\{onDismiss\}[\s\S]*>✕<\/button>/);
  assert.match(panels, /<button onClick=\{onSnooze \|\| onDismiss\}[\s\S]*>Snooze<\/button>/);
});

test('Ask AI can continue in background and reopen completed responses', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const ai = fs.readFileSync(path.join(__dirname, '../src/ai.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const aiLib = fs.readFileSync(path.join(__dirname, '../lib/ai.js'), 'utf8');
  const ollama = fs.readFileSync(path.join(__dirname, '../lib/ollama.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');

  assert.match(app, /const \[askAiSession, setAskAiSession\]/);
  assert.match(app, /function MnAiNotice/);
  assert.match(app, /AI response ready/);
  assert.match(app, /onOpen=\{openAskAi\}/);
  assert.match(app, /session=\{askAiSession\}/);
  assert.match(app, /setSession=\{setAskAiSession\}/);
  assert.match(app, /onBackgroundComplete=\{notifyAskAiComplete\}/);

  assert.match(ai, /const aiSession = session \|\| localSession/);
  assert.match(ai, /const MN_ASK_SUGGESTIONS = \[/);
  assert.match(ai, /function mnAskStatusText/);
  assert.match(ai, /function MnAskInfoChip/);
  assert.match(ai, /mnAskPrimaryButton/);
  assert.match(ai, /mnAskSecondaryButton/);
  assert.match(ai, /Clear/);
  assert.match(ai, /Vault context/);
  assert.match(ai, /Current page/);
  assert.match(ai, /Latest answer/);
  assert.match(ai, /Semantic search ready/);
  assert.match(ai, /Ask about the vault or ask for a page action/);
  assert.match(ai, /backgroundRef\.current = true/);
  assert.match(ai, /Run in background/);
  assert.match(ai, /Stop/);
  assert.match(ai, /const stopRun = async/);
  assert.match(ai, /window\.mn\?\.ai\?\.cancel\?\.\(jobId\)/);
  assert.match(ai, /Stopped\./);
  assert.match(ai, /onBackgroundComplete && onBackgroundComplete/);
  assert.match(ai, /completedAt: new Date\(\)\.toISOString\(\)/);

  assert.match(preload, /cancel:\s+\(jobId\) => ipcRenderer\.invoke\('mn:ai\.cancel', jobId\)/);
  assert.match(main, /ipcMain\.handle\('mn:ai\.cancel'/);
  assert.match(aiLib, /const STATUS_CACHE_MS/);
  assert.match(aiLib, /const OLLAMA_KEEP_ALIVE = '10m'/);
  assert.match(aiLib, /const PROVIDERS = \{/);
  assert.match(aiLib, /openrouterApiKey/);
  assert.match(aiLib, /openaiApiKey/);
  assert.match(aiLib, /anthropicApiKey/);
  assert.match(aiLib, /geminiApiKey/);
  assert.match(aiLib, /async function providerChat/);
  assert.match(aiLib, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(aiLib, /https:\/\/api\.openai\.com\/v1/);
  assert.match(aiLib, /https:\/\/api\.anthropic\.com/);
  assert.match(aiLib, /https:\/\/generativelanguage\.googleapis\.com\/v1beta/);
  assert.match(aiLib, /anthropic-version/);
  assert.match(aiLib, /generateContent/);
  assert.match(aiLib, /const cancellableJobs = new Map\(\)/);
  assert.match(aiLib, /function cancelJob\(jobId\)/);
  assert.match(aiLib, /controller\.abort\(\)/);
  assert.match(aiLib, /cancelJob,/);
  assert.match(aiLib, /statusCache/);
  assert.match(aiLib, /ollama\.chat\(options\.model \|\| CONFIG\.chatModel, providerMessages, \{ keep_alive: OLLAMA_KEEP_ALIVE, signal: options\.signal \}\)/);
  assert.match(aiLib, /String\(systemMessage \|\| ''\)\.trim\(\) \|\| EDIT_SYSTEM_PROMPT/);
  assert.match(ollama, /async function embed\(model, text, opts = \{\}\)/);
  assert.match(ollama, /signal: opts\.signal/);
  assert.match(ollama, /keep_alive: opts\.keep_alive/);

  assert.match(settings, /const MN_AI_PROVIDERS = \[/);
  assert.match(settings, /id: 'openrouter'/);
  assert.match(settings, /id: 'openai'/);
  assert.match(settings, /id: 'anthropic'/);
  assert.match(settings, /id: 'gemini'/);
  assert.match(settings, /id: 'custom'/);
  assert.match(settings, /PII reduction/);
  assert.match(settings, /Provider API base URL/);
  assert.match(settings, /Cloud providers are used for chat, note creation, and editing/);
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
  assert.match(app, /window\.mn\.listCanvases\(vaultId\)/);
  assert.match(app, /view === 'canvas'/);
  assert.match(app, /<MnCanvasPanel/);
  assert.match(editor, /allCanvases=\{canvases\}/);
  assert.match(outliner, /id: 'canvas'/);
  assert.match(outliner, /\{\{canvas/);
  assert.match(outliner, /<MnCanvasPicker/);
  assert.match(outliner, /<MnCanvasEmbed/);
  assert.match(canvas, /const MN_CANVAS_TOOLS = \[/);
  assert.match(canvas, /function MnCanvasPanel/);
  assert.match(canvas, /function MnCanvasCardMenu/);
  assert.match(canvas, /onContextMenu=\{\(e\) => openCanvasCardMenu\(e, canvas\)\}/);
  assert.match(canvas, /Delete canvas/);
  assert.match(canvas, /function MnCanvasEditor/);
  assert.match(canvas, /function MnCanvasEmbed/);
});

test('Novelist mode is a vault type with settings, templates, workflow, and dashboard wiring', () => {
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/sidebar.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const panels = fs.readFileSync(path.join(__dirname, '../src/panels.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const graph = fs.readFileSync(path.join(__dirname, '../src/graph.jsx'), 'utf8');
  const notelist = fs.readFileSync(path.join(__dirname, '../src/notelist.jsx'), 'utf8');
  const ai = fs.readFileSync(path.join(__dirname, '../src/ai.jsx'), 'utf8');

  assert.match(store, /novelistMode: !!meta\.novelistMode/);
  assert.match(store, /workflowStates: Array\.isArray\(meta\.workflowStates\) \? normalizeWorkflowStates\(meta\.workflowStates\) : null/);
  assert.match(store, /async function createVault\(name, options = \{\}\)/);
  assert.match(store, /fs\.existsSync\(vaultDir\(finalSlug\)\)/);
  assert.match(main, /store\.createVault\(name, options\)/);
  assert.match(preload, /createVault: \(name, options\) => ipcRenderer\.invoke\('mn:createVault', name, options\)/);
  assert.match(app, /const MN_NOVELIST_TAGS = \[/);
  assert.match(app, /novel-act/);
  assert.match(app, /\[\[Act 1\]\]/);
  assert.match(app, /\[\[Chapter 1\]\]/);
  assert.match(app, /\[\[Scene 1\]\]/);
  assert.match(app, /const MN_NOVELIST_WORKFLOW_STATES = \[/);
  assert.match(app, /sourceWorkflowStates = null/);
  assert.match(app, /includeStarterNotes: false/);
  assert.match(app, /workflowStates: nextWorkflowStates/);
  assert.match(app, /mnBuildNovelistStarterNotes\(normalizedSourceNotes, mnMdToBlocks, vaultId\)/);
  assert.match(app, /function mnDirtyNoteKey\(vaultId, noteId\)/);
  assert.match(app, /const vaultActivationSeq = useRefA\(0\)/);
  assert.match(app, /const activationSeq = \+\+vaultActivationSeq\.current/);
  assert.match(app, /if \(activationSeq !== vaultActivationSeq\.current\) return/);
  assert.match(app, /n\.set\(mnDirtyNoteKey\(activeVaultId, id\), \{ id, vaultId: activeVaultId \}\)/);
  assert.match(app, /saveDirtyNotesNow\(\[\.\.\.dirtyNotes\.values\(\)\]\)/);
  assert.match(app, /entry\.vaultId === activeVaultId/);
  assert.match(app, /notes: targetNotes, tags: targetTags/);
  assert.match(app, /saveVaultMeta\(activeVaultId, \{ novelistMode: false, workflowStates: null \}\)/);
  assert.match(app, /novelistMode: false, workflowStates: null/);
  assert.match(app, /workflowStates: vaultType === 'novelist' \? MN_NOVELIST_WORKFLOW_STATES : null/);
  assert.match(app, /const normalWorkflowStates = useMemoA/);
  assert.match(app, /const novelistWorkflowStates = useMemoA/);
  assert.match(app, /activeVault\?\.novelistMode \? novelistWorkflowStates : normalWorkflowStates/);
  assert.match(app, /saveVaultMeta\(activeVaultId, \{ workflowStates: next \}\)/);
  assert.doesNotMatch(app, /setTweak\('workflowStates', MN_NOVELIST_WORKFLOW_STATES\)/);
  assert.match(app, /function mnBuildNovelistStarterNotes/);
  assert.match(app, /function mnBuildNovelistStructure/);
  assert.match(app, /function mnNovelOutlineLinks/);
  assert.match(app, /function mnBodyPropertyValue/);
  assert.match(app, /function mnSetBodyProperty/);
  assert.match(app, /function mnRemoveBodyProperty/);
  assert.match(app, /function mnNoteOrderValue/);
  assert.match(app, /function collectWorkflowNotes/);
  assert.match(app, /split\('\|'\)\[0\]/);
  assert.match(app, /mnBodyPropertyTitle\(body, key\)/);
  assert.match(app, /addStage\('chapter', chapter\)/);
  assert.match(app, /addStage\('scene', scene\)/);
  assert.match(app, /mnNormalizeNovelistLegacyTags/);
  assert.match(app, /mnNormalizeNovelistLegacyBody/);
  assert.match(app, /mnEnsureScenePlotPoints/);
  assert.match(app, /selectedStage === 'act'/);
  assert.match(app, /selectedStage === 'chapter'/);
  assert.match(app, /stageByNoteId/);
  assert.match(app, /mnNovelEnsureWikiLink/);
  assert.match(app, /mnNovelEnsureWikiLinkInSection/);
  assert.match(app, /mnNovelUpsertPropertyLink/);
  assert.match(app, /const updateWorkflowNoteStatus = useCallbackA/);
  assert.match(app, /mnSetBodyProperty\(body, 'status', workflow\)/);
  assert.match(app, /const setNovelistOrder = useCallbackA/);
  assert.match(app, /const renameNoteTitle = useCallbackA/);
  assert.match(app, /const convertNovelistType = useCallbackA/);
  assert.match(app, /const graphVisibleNotes = useMemoA/);
  assert.match(app, /const setActiveVaultNovelistMode = useCallbackA/);
  assert.match(app, /view === 'novelist'/);
  assert.match(app, /<MnNovelistPanel/);
  assert.match(app, /vaultId=\{activeVaultId\}/);
  assert.match(app, /createNote\(\{ title, body, tags: noteTags \|\| \[\] \}, \{ open: false \}\)/);
  assert.match(app, /onLinkChapter=\{linkNovelistChapter\}/);
  assert.match(app, /onLinkScene=\{linkNovelistScene\}/);
  assert.match(app, /onSetOrder=\{setNovelistOrder\}/);
  assert.match(app, /onRenameNote=\{renameNoteTitle\}/);
  assert.match(app, /onConvertNoteType=\{convertNovelistType\}/);
  assert.match(app, /onDeleteNote=\{requestDeleteNote\}/);
  assert.match(app, /const removeNovelistSupportingType = \(name\) =>/);
  assert.match(app, /setTags\(ts => ts\.filter\(t => t\.name !== clean\)\)/);
  assert.match(app, /onCreateTag=\{addTag\}/);
  assert.match(app, /onRemoveSupportingType=\{removeNovelistSupportingType\}/);
  assert.match(app, /novelistPath=\{activeVault\?\.novelistMode/);
  assert.match(app, /novelistStructure=\{activeVault\?\.novelistMode/);
  assert.match(app, /onSetVaultNovelistMode=\{setActiveVaultNovelistMode\}/);
  assert.match(sidebar, /label="Novelist"/);
  assert.match(sidebar, /Novelist vault/);
  assert.match(settings, /Vault mode/);
  assert.match(settings, /Novelist vault/);
  assert.match(panels, /function MnNovelistPanel/);
  assert.match(panels, /activeTab/);
  assert.match(panels, /Plan/);
  assert.match(panels, /Status/);
  assert.match(panels, /AI Config/);
  assert.doesNotMatch(panels, /CreateButtonGroup/);
  assert.match(panels, /Story Structure/);
  assert.match(panels, /Act -> Chapter -> Scene/);
  assert.match(panels, /function MnNovelistPanel[\s\S]*childrenByActId/);
  assert.match(panels, /Word Count by Act/);
  assert.match(panels, /Character Appearance Heat Map/);
  assert.match(panels, /mn_novelist_ai_config_v2/);
  assert.match(panels, /supportingTypes = \(tags \|\| \[\]\)/);
  assert.match(panels, /normalizeSupportingTypeTag/);
  assert.match(panels, /onCreateTag\?\.\(tagName\)/);
  assert.match(panels, /onRemoveSupportingType\?\.\(type\.tag\)/);
  assert.match(panels, /Add type/);
  assert.match(panels, /Remove type/);
  assert.match(panels, /\+ Note/);
  assert.match(panels, /novel-character/);
  assert.match(panels, /novel-research/);
  assert.match(panels, /novel-revision/);
  assert.match(panels, /No chapters linked/);
  assert.match(panels, /No scenes linked/);
  assert.match(panels, /\+ \{type === 'chapter' \? 'Chapter' : 'Scene'\}/);
  assert.match(panels, /Link existing chapter/);
  assert.match(panels, /Link existing scene/);
  assert.match(panels, /Attach to act/);
  assert.match(panels, /Create parent act/);
  assert.match(panels, /Convert to scene/);
  assert.match(panels, /Attach to chapter/);
  assert.match(panels, /Create parent chapter/);
  assert.match(panels, /Set order/);
  assert.match(panels, /const \[editDialog, setEditDialog\] = useStateP\(null\)/);
  assert.match(panels, /Order must be a number or blank/);
  assert.doesNotMatch(panels, /window\.prompt\('Rename note:'/);
  assert.doesNotMatch(panels, /window\.prompt\('Set order:: value:'/);
  assert.match(panels, /showLinkNotice/);
  assert.match(panels, /LinkNoticeChip/);
  assert.match(panels, /linkNotice\.text/);
  assert.match(panels, /linkNotice\.parentId/);
  assert.match(panels, /Linked to \$\{linkedTo\.title/);
  assert.match(panels, /Unlinked chapters/);
  assert.match(panels, /Unlinked scenes/);
  assert.match(panels, /linkNoticeTimer/);
  assert.match(panels, /onContextMenu=\{\(e\) => openNoteMenu\(e, note\)\}/);
  assert.match(panels, /closeOnEscape/);
  assert.match(panels, /Delete note/);
  assert.match(panels, /Choose act for new Chapter/);
  assert.match(panels, /Create standalone/);
  assert.match(panels, /createChapterForAct/);
  assert.match(panels, /createSceneForChapter/);
  assert.match(editor, /novelistPath = null/);
  assert.match(editor, /workflowStatus = ''/);
  assert.match(editor, /onSetWorkflowStatus/);
  assert.match(editor, /onCreateLinkedNote/);
  assert.match(editor, /noteTags=\{note\.tags \|\| \[\]\}/);
  assert.match(editor, /vaultId=\{vaultId\}/);
  assert.match(outliner, /noteTags = \[\]/);
  assert.match(outliner, /vaultId = ''/);
  assert.match(outliner, /window\.mnReadNovelistAiConfig\?\.\(vaultId\)/);
  assert.match(outliner, /defaultPromptId: config\.defaultPromptId/);
  assert.match(outliner, /Target length: up to \$\{novelConfig\.wordLimit\} words/);
  assert.match(outliner, /Novelist writing prompt \(\$\{activePrompt\.name \|\| 'Default'\}\):/);
  assert.match(graph, /All novelist notes/);
  assert.match(graph, /Act structure/);
  assert.match(graph, /Characters \+ scenes/);
  assert.match(graph, /Plot threads \+ scenes/);
  assert.match(graph, /Research \+ scenes/);
  assert.match(graph, /padding: '0 88px 0 24px'/);
  assert.match(graph, /right: 64/);
  assert.match(notelist, /function MnNoteList[\s\S]*novelistStructure = null/);
  assert.match(notelist, /allNotes = null/);
  assert.match(notelist, /const sourceNotes = allNotes \|\| notes \|\| \[\]/);
  assert.match(notelist, /const GroupHeader/);
  assert.match(notelist, /const CollectionHeader/);
  assert.match(notelist, /chaptersForAct/);
  assert.match(notelist, /scenesForChapter/);
  assert.match(notelist, /const chapterIds = new Set/);
  assert.match(notelist, /linkedTo=\{`Linked to \$\{act\.title/);
  assert.match(notelist, /parentByChapterId/);
  assert.match(notelist, /parentBySceneId/);
  assert.match(notelist, /Unlinked chapters/);
  assert.match(notelist, /looseScenes/);
  assert.match(panels, /Supporting Notes/);
  assert.match(panels, /Workflow Status Counts/);
  assert.match(panels, /AI Config/);
  assert.match(panels, /Words/);
  assert.match(panels, /Default writing prompt/);
  assert.match(panels, /AI write novel/);
  assert.match(panels, /defaultPromptId/);
  assert.match(panels, /mn_novelist_ai_config_v2/);
  assert.match(panels, /function mnNovelistAiConfigKey\(vaultId = ''\)/);
  assert.match(panels, /mnReadNovelistAiConfig\(vaultId\)/);
  assert.match(panels, /window\.mnReadNovelistAiConfig = mnReadNovelistAiConfig/);
  assert.match(panels, /addAiPrompt/);
  assert.match(panels, /updateAiPrompt/);
  assert.doesNotMatch(panels, /AI Actions/);
  assert.doesNotMatch(panels, /const aiActions = \[/);
  assert.doesNotMatch(panels, /Novel Plot Board/);
  assert.match(ai, /initialQuery/);
});

test('First-run seed creates one notes vault and one novelist vault', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    assert.equal(vaults.length, 2);
    assert.deepEqual(vaults.map(v => v.name), ['Personal', 'Novel']);

    const personalVault = vaults.find(v => v.name === 'Personal');
    const novelVault = vaults.find(v => v.name === 'Novel');
    assert.equal(personalVault.novelistMode, false);
    assert.equal(novelVault.novelistMode, true);

    const personal = await store.loadVault(personalVault.id);
    const novel = await store.loadVault(novelVault.id);

    assert.equal(personal.notes.length, 3);
    assert.deepEqual(personal.notes.map(note => note.title).sort(), ['Project plan', 'Reading notes', 'Welcome to VispNote']);
    assert.equal(novel.notes.length, 3);
    assert.deepEqual(novel.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.match(novel.notes.find(note => note.title === 'Chapter 1').body, /act:: \[\[Act 1\]\]/);
    assert.match(novel.notes.find(note => note.title === 'Scene 1').body, /::: plot-points/);
  });
});

test('New vault creation never reuses stale vault folders', async () => {
  await withIsolatedStore(async (store) => {
    const staleDir = path.join(store.ROOT, 'novel');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, 'n_old.md'),
      '---\nid: n_old\ntitle: Previous Novel\ntags: [novel-scene]\n---\n\nOld scene\n',
      'utf8'
    );

    const vault = await store.createVault('Novel', { type: 'novelist' });
    assert.equal(vault.slug, 'novel-2');

    const loaded = await store.loadVault(vault.id);
    assert.equal(loaded.novelistMode, true);
    assert.equal(loaded.notes.some(note => note.id === 'n_old'), false);
    assert.equal(loaded.notes.length, 3);
    assert.deepEqual(loaded.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.equal(loaded.notes.some(note => (note.tags || []).includes('novel-manuscript')), false);
    assert.equal(loaded.notes.some(note => (note.tags || []).includes('novel-arc')), false);
    assert.match(loaded.notes.find(note => note.title === 'Chapter 1').body, /act:: \[\[Act 1\]\]/);
    assert.match(loaded.notes.find(note => note.title === 'Scene 1').body, /::: plot-points/);
  });
});

test('Vault registry repairs externally deleted vault folders', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    assert.ok(vaults.length >= 2);
    const deleted = vaults[0];
    fs.rmSync(path.join(store.ROOT, deleted.slug), { recursive: true, force: true });

    const repaired = await store.listVaults();
    assert.equal(repaired.some(v => v.id === deleted.id), false);
    assert.ok(repaired.length >= 1);

    await assert.rejects(
      () => store.loadVault(deleted.id),
      /Vault not found/
    );
    assert.equal(fs.existsSync(path.join(store.ROOT, deleted.slug)), false);
  });
});

test('Vault registry creates one fallback vault if every folder is externally deleted', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    vaults.forEach(v => fs.rmSync(path.join(store.ROOT, v.slug), { recursive: true, force: true }));

    const repaired = await store.listVaults();
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].name, 'Personal');
    assert.equal(fs.existsSync(path.join(store.ROOT, repaired[0].slug)), true);
    const loaded = await store.loadVault(repaired[0].id);
    assert.equal(loaded.notes.length, 1);
  });
});

test('New novelist vaults stay isolated and persist novelist AI config', async () => {
  await withIsolatedStore(async (store) => {
    const first = await store.createVault('Novel One', { type: 'novelist' });
    await store.saveNote(first.id, {
      id: 'n_custom_scene',
      title: 'Custom Scene',
      date: new Date().toISOString(),
      tags: ['novel-scene'],
      body: 'status:: DRAFT\nchapter:: [[Chapter 1]]\nOnly in the first vault.',
    });

    const second = await store.createVault('Novel Two', { type: 'novelist' });
    await store.saveVaultMeta(second.id, {
      novelistAiConfig: {
        version: 2,
        wordLimit: 1200,
        prompts: [{ id: 'draft', name: 'Draft', prompt: 'Write a scene.' }],
      },
    });

    const firstLoaded = await store.loadVault(first.id);
    const secondLoaded = await store.loadVault(second.id);
    const listed = await store.listVaults();
    const secondMeta = listed.find(v => v.id === second.id);

    assert.equal(firstLoaded.notes.some(note => note.id === 'n_custom_scene'), true);
    assert.equal(secondLoaded.notes.some(note => note.id === 'n_custom_scene'), false);
    assert.deepEqual(secondLoaded.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.equal(secondLoaded.novelistAiConfig.wordLimit, 1200);
    assert.equal(secondMeta.novelistAiConfig.wordLimit, 1200);
  });
});

test('Note saves create restorable versions and reject stale disk writes', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes[0];

    await new Promise(resolve => setTimeout(resolve, 12));
    const first = await store.saveNote(vault.id, {
      ...note,
      body: 'first saved body',
    }, { expectedModifiedAt: note.diskModifiedAt });

    await new Promise(resolve => setTimeout(resolve, 12));
    await store.saveNote(vault.id, {
      ...first,
      body: 'second saved body',
    }, { expectedModifiedAt: first.diskModifiedAt });

    const versions = await store.listNoteVersions(vault.id, note.id);
    assert.ok(versions.length >= 2);
    assert.match(versions[0].versionId, /^ver_/);

    await assert.rejects(
      () => store.saveNote(vault.id, {
        ...first,
        body: 'stale overwrite',
      }, { expectedModifiedAt: first.diskModifiedAt }),
      err => err.code === 'NOTE_CONFLICT'
    );

    const restored = await store.restoreNoteVersion(vault.id, note.id, versions[0].versionId);
    assert.equal(restored.id, note.id);
    assert.match(restored.body, /first saved body|Welcome/i);
  });
});

test('Deleted notes move to trash and can be restored or purged', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes[0];

    const deleted = await store.deleteNote(vault.id, note.id);
    assert.ok(deleted.trashId);
    assert.equal((await store.loadVault(vault.id)).notes.some(n => n.id === note.id), false);

    const trash = await store.listDeletedNotes(vault.id);
    assert.equal(trash.length, 1);
    assert.equal(trash[0].originalId, note.id);

    const restored = await store.restoreDeletedNote(vault.id, trash[0].trashId);
    assert.equal(restored.id, note.id);
    assert.equal((await store.loadVault(vault.id)).notes.some(n => n.id === note.id), true);

    const deletedAgain = await store.deleteNote(vault.id, note.id);
    await store.purgeDeletedNote(vault.id, deletedAgain.trashId);
    assert.equal((await store.listDeletedNotes(vault.id)).some(item => item.trashId === deletedAgain.trashId), false);
  });
});

test('Canvas deletes are soft-deleted into the vault trash folder', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await store.saveCanvas(vault.id, { id: 'c_safety', title: 'Safety canvas', elements: [] });

    const deleted = await store.deleteCanvas(vault.id, 'c_safety');
    assert.ok(deleted.trashId);
    assert.equal((await store.listCanvases(vault.id)).some(canvas => canvas.id === 'c_safety'), false);
    assert.equal(
      fs.existsSync(path.join(store.ROOT, vault.slug, '.trash', 'canvases', `${deleted.trashId}.json`)),
      true
    );

    const trash = await store.listDeletedCanvases(vault.id);
    assert.equal(trash.some(item => item.trashId === deleted.trashId && item.sourceType === 'canvas'), true);
    const restored = await store.restoreDeletedCanvas(vault.id, deleted.trashId);
    assert.equal(restored.id, 'c_safety');
    assert.equal((await store.listCanvases(vault.id)).some(canvas => canvas.id === 'c_safety'), true);
  });
});

test('Novelist hierarchy is inferred from act properties and explicit structure tags', () => {
  const Babel = require('@babel/standalone');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const code = Babel.transform(app, { presets: ['react'] }).code;
  const sandbox = {
    React: { createElement() {}, useState() {}, useEffect() {}, useMemo() {}, useCallback() {}, useRef() {} },
    window: {},
    console,
  };
  vm.runInNewContext(code, sandbox);

  const structure = sandbox.mnBuildNovelistStructure([
    { id: 'm', title: 'Old Manuscript', tags: [], body: '# Old Manuscript\n- [[Act One]]\n  - [[Chapter 1]]\n    - [[Opening Scene]]' },
    { id: 'a', title: 'Act One', tags: ['novel-act'], body: '# Act One\n- [[Chapter 1]]' },
    { id: 'c', title: 'Chapter 1', tags: ['novel-chapter'], body: '# Chapter 1\n- act:: [[Act One]]\n- [[Opening Scene]]' },
    { id: 's', title: 'Opening Scene', tags: ['novel-scene'], body: '# Opening Scene\n- chapter:: [[Chapter 1]]' },
  ]);
  const ids = (items) => Array.from(items, note => note.id);

  assert.deepEqual(ids(structure.acts), ['a']);
  assert.deepEqual(ids(structure.chapters), ['c']);
  assert.deepEqual(ids(structure.scenes), ['s']);
  assert.equal(structure.parentByChapterId.c, 'a');
  assert.equal(structure.parentBySceneId.s, 'c');
  assert.deepEqual(ids(structure.pathByNoteId.s), ['a', 'c', 's']);
});

test('Novelist order and note-level status properties drive visible workflow', () => {
  const Babel = require('@babel/standalone');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const code = Babel.transform(app, { presets: ['react'] }).code;
  const sandbox = {
    React: { createElement() {}, useState() {}, useEffect() {}, useMemo() {}, useCallback() {}, useRef() {} },
    window: {
      MN_LOGSEQ: {
        mnNormalizeWorkflowId(raw) {
          return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
        },
      },
    },
    console,
  };
  vm.runInNewContext(code, sandbox);

  let body = '# Scene\n- order:: 200\n- status:: DRAFT\n- chapter:: [[Chapter 1]]\nDraft text';
  assert.equal(sandbox.mnBodyPropertyValue(body, 'status'), 'DRAFT');
  body = sandbox.mnSetBodyProperty(body, 'status', 'REVISE');
  assert.equal(sandbox.mnBodyPropertyValue(body, 'status'), 'REVISE');
  body = sandbox.mnRemoveBodyProperty(body, 'status');
  assert.equal(sandbox.mnBodyPropertyValue(body, 'status'), '');
  assert.match(sandbox.mnSetBodyProperty('# Note\nBody', 'order', '100'), /order:: 100\nBody/);
  assert.doesNotMatch(sandbox.mnSetBodyProperty('# Note\nBody', 'order', '100'), /- order::/);
  assert.equal(
    sandbox.mnNormalizeNoteBody('# Scene\n- status:: DRAFT\n- order:: 200\nDraft text', 'Scene'),
    'status:: DRAFT\norder:: 200\nDraft text'
  );

  const structure = sandbox.mnBuildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 'c2', title: 'Chapter B', tags: ['novel-chapter'], body: '# Chapter B\n- order:: 120\n- act:: [[Act]]', modifiedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c1', title: 'Chapter A', tags: ['novel-chapter'], body: '# Chapter A\n- order:: 110\n- act:: [[Act]]', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c3', title: 'Chapter C', tags: ['novel-chapter'], body: '# Chapter C\n- act:: [[Act]]', modifiedAt: '2026-01-03T00:00:00.000Z' },
  ]);
  assert.deepEqual(Array.from(structure.childrenByActId.a), ['c1', 'c2', 'c3']);

  const workflow = sandbox.collectWorkflowNotes([
    { id: 'n1', title: 'Note status', tags: [], body: '# Note\n- status:: DRAFT\nBody', blocks: [{ id: 'b1', workflow: 'DONE', content: 'Block marker' }] },
    { id: 'n2', title: 'Block only', tags: [], body: '# Block only\nBody', blocks: [{ id: 'b2', workflow: 'DRAFT', content: 'Should be ignored' }] },
  ], [{ id: 'DRAFT' }, { id: 'DONE' }]);
  assert.equal(workflow.counts.DRAFT, 1);
  assert.equal(workflow.counts.DONE, 0);
  assert.deepEqual([...workflow.noteIdsByState.DRAFT], ['n1']);

  const converted = sandbox.mnBuildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 's', title: 'Converted', tags: ['novel-scene'], body: '# Converted\n- act:: [[Act]]' },
  ]);
  assert.deepEqual(Array.from(converted.chapters, note => note.id), []);
  assert.deepEqual(Array.from(converted.scenes, note => note.id), ['s']);
  assert.deepEqual(sandbox.mnNormalizeNovelistLegacyTags(['novel-manuscript', 'novel-arc', 'novel-scene']), ['novel-act', 'novel-scene']);
  assert.equal(
    sandbox.mnNormalizeNovelistLegacyBody('arc:: [[Arc 1]]\n## Arcs'),
    'act:: [[Arc 1]]\n## Acts'
  );

  const panels = fs.readFileSync(path.join(__dirname, '../src/panels.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  assert.doesNotMatch(panels, /## Chapters\\n- '\s*}/);
  assert.doesNotMatch(panels, /## Scenes\\n- '\s*}/);
  assert.doesNotMatch(panels, /body: '# (Story Root|Act|Chapter|Scene|Character|Location|Plot Thread|Research|Revision Note)/);
  assert.match(editor, /function mnEditorSplitPropertyBlocks/);
  assert.match(editor, /blocks=\{contentBlocks\}/);
  assert.match(editor, /status::/);
  assert.match(editor, /function mnEditorCleanPropertyKey/);
  assert.match(editor, /\+ property/);
  assert.match(editor, /removeMetadataProperty/);
  assert.doesNotMatch(editor, /borderTop: `1px solid \$\{T\.lineSub\}`,[\s\S]*borderBottom: `1px solid \$\{T\.lineSub\}`/);
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/blockFeatures.jsx'), 'utf8');
  assert.match(outliner, /id: 'block-label'/);
  assert.match(outliner, /blockLabelAction/);
  assert.match(outliner, /Marker: \$\{state\.id\}/);
  assert.match(outliner, /setLabelMenu/);
  assert.match(blockFeatures, /label="Add label"/);
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
  assert.doesNotMatch(canvas, /if \(action\.mode === 'create'\) setTool\('select'\)/);
  assert.match(canvas, /const \[selectedIds, setSelectedIds\]/);
  assert.match(canvas, /function mnCanvasSelectionBounds/);
  assert.match(canvas, /function mnCanvasMoveElement/);
  assert.match(canvas, /const undoCanvas = \(\) =>/);
  assert.match(canvas, /const redoCanvas = \(\) =>/);
  assert.match(canvas, /isMod && key === 'z'/);
  assert.match(canvas, /isMod && key === 'y'/);
  assert.match(canvas, /const \[marquee, setMarquee\]/);
  assert.match(canvas, /mode: 'marquee'/);
  assert.match(canvas, /function MnCanvasResizeHandles/);
  assert.match(canvas, /mode: 'resize'/);
  assert.match(canvas, /alignSelected\('left'\)/);
  assert.match(canvas, /distributeSelected\('x'\)/);
  assert.match(canvas, /const fitToScreen = \(\) =>/);
  assert.match(canvas, /const \[spaceDown, setSpaceDown\]/);
  assert.match(canvas, /mode: 'pan'/);
  assert.match(canvas, /const \[editingTextId, setEditingTextId\]/);
  assert.match(canvas, /<textarea/);
  assert.match(canvas, /svg\.createSVGPoint\(\)/);
  assert.match(canvas, /screenMatrix\.inverse\(\)/);
  assert.match(canvas, /const showSelectionUi = tool === 'select'/);
  assert.match(canvas, /selected=\{showSelectionUi && selectedIds\.includes\(el\.id\)\}/);
  assert.match(canvas, /e\.button === 0 && tool !== 'select'/);
  assert.match(canvas, /beginCreate\(e, toCanvasPoint\(e\)\)/);

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

test('Launch screen uses VispNote logo with pastel blooming light design', () => {
  const html = fs.readFileSync(path.join(__dirname, '../OminiNote.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const loadingLogo = fs.statSync(path.join(__dirname, '../assets/vispnote-loading-transparent.png'));
  const appIcon = fs.statSync(path.join(__dirname, '../assets/vispnote-icon.png'));

  assert.match(html, /<title>VispNote<\/title>/);
  assert.match(html, /<link rel="icon" type="image\/png" href="assets\/vispnote-icon\.png" \/>/);
  assert.match(html, /@keyframes mnLightBloom/);
  assert.match(html, /@keyframes mnLightWash/);
  assert.match(html, /@keyframes mnBootProgress/);
  assert.match(html, /@keyframes mnStatusBreath/);
  assert.match(html, /mn-boot-light-field/);
  assert.match(html, /mn-light-bloom/);
  assert.match(html, /radial-gradient\(circle at center/);
  assert.match(html, /linear-gradient\(90deg, #f3bfd8 0%, #a9c2ff 48%, #9fe2c9 100%\)/);
  assert.doesNotMatch(html, /filter: blur/);
  assert.doesNotMatch(html, /mn-light-ripple/);
  assert.doesNotMatch(html, /@keyframes mnPastelRipple/);
  assert.doesNotMatch(html, /@property --mn-ripple-radius/);
  assert.doesNotMatch(html, /--mn-ripple-radius/);
  assert.doesNotMatch(html, /width: max\(180vw, 180vh\)/);
  assert.doesNotMatch(html, /conic-gradient\(from 70deg/);
  assert.doesNotMatch(html, /@keyframes mnProgressGlow/);
  assert.doesNotMatch(html, /mn-pastel-float/);
  assert.doesNotMatch(html, /mn-boot-neural-field/);
  assert.doesNotMatch(html, /animateMotion/);
  assert.match(html, /mn-boot-brand/);
  assert.match(html, /mn-boot-logo/);
  assert.match(html, /aria-label="VispNote"/);
  assert.match(html, /src="assets\/vispnote-loading-transparent\.png"/);
  assert.match(html, /alt="VispNote"/);
  assert.match(html, /width: clamp\(340px, 54vw, 720px\)/);
  assert.match(html, /object-fit: contain/);
  assert.match(html, /mix-blend-mode: multiply/);
  assert.match(html, /mn-boot-title mn-boot-wordmark">VispNote/);
  assert.ok(loadingLogo.size > 0);
  assert.match(html, /Capture<\/span><i><\/i><span>Organize<\/span><i><\/i><span>Remember/);
  assert.match(html, /class="mn-boot-status">Opening vault and indexing notes/);
  assert.match(html, /class="mn-boot-progress"><div><\/div><\/div>/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(html, /@keyframes mnBootLogoTrace/);
  assert.doesNotMatch(html, /@keyframes mnBootLogoGlow/);
  assert.doesNotMatch(html, /@keyframes mnBootWordGlow/);
  assert.doesNotMatch(html, /mnBootLogoFloat/);
  assert.doesNotMatch(html, /mnBootWordGlow/);
  assert.match(html, /Connecting your workspace/);
  assert.match(app, /function MnBootLogo/);
  assert.match(app, /aria-label="VispNote"/);
  assert.match(app, /src="assets\/vispnote-loading-transparent\.png"/);
  assert.match(app, /alt="VispNote"/);
  assert.match(app, /className="mn-boot-title mn-boot-wordmark">VispNote/);
  assert.match(app, /<MnBootLogo \/>/);
  assert.match(app, /MN_LAUNCH_BLOOMS/);
  assert.doesNotMatch(app, /MN_LAUNCH_RIPPLES/);
  assert.match(app, /className="mn-boot-light-field"/);
  assert.match(app, /className="mn-light-bloom"/);
  assert.doesNotMatch(app, /className="mn-light-ripple"/);
  assert.match(app, /className="mn-boot-status"/);
  assert.match(app, /className="mn-boot-progress"/);
  assert.doesNotMatch(app, /MN_LAUNCH_FLOATS/);
  assert.doesNotMatch(app, /MN_LAUNCH_NEURAL_PATHS/);
  assert.ok(appIcon.size > 0);
});

test('App and editor font size settings use stepper controls', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(settings, /function FontSizeStepper/);
  assert.match(settings, /label="App font size"/);
  assert.match(settings, /label="Font size"/);
  assert.match(app, /"appFontSize": "default"/);
  assert.match(app, /--mn-app-font-size/);
  assert.match(app, /width: '100vw'/);
  assert.match(app, /height: '100vh'/);
  assert.doesNotMatch(app, /transform: `scale\(\$\{appScale\}\)`/);
  assert.doesNotMatch(app, /width: `calc\(100vw \/ \$\{appScale\}\)`/);
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
  const builder = fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8');
  const linuxAfterInstall = fs.readFileSync(path.join(__dirname, '../scripts/linux-after-install.sh'), 'utf8');
  const icon = fs.statSync(path.join(__dirname, '../assets/vispnote-icon.png'));
  const linuxIconSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

  assert.match(main, /APP_ICON_PATH = path\.join\(__dirname, 'assets', 'vispnote-icon\.png'\)/);
  assert.match(main, /const APP_NAME = 'VispNote'/);
  assert.match(main, /app\.setName\(APP_NAME\)/);
  assert.match(main, /app\.setDesktopName\('vispnote\.desktop'\)/);
  assert.match(main, /label: visible \? `Hide \$\{APP_NAME\}` : `Show \$\{APP_NAME\}`/);
  assert.match(main, /label: `Quit \$\{APP_NAME\}`/);
  assert.match(main, /tray\.setToolTip\(APP_NAME\)/);
  assert.match(main, /title: APP_NAME/);
  assert.match(main, /const fs = require\('fs'\)/);
  assert.match(main, /function createAppIcon\(\)/);
  assert.match(main, /function createFallbackIcon\(\)/);
  assert.match(main, /if \(!image\.isEmpty\(\)\) return image/);
  assert.match(main, /nativeImage\.createFromPath\(APP_ICON_PATH\)/);
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
  assert.ok(icon.size > 0);
  assert.match(html, /type="image\/png" href="assets\/vispnote-icon\.png"/);
  assert.match(builder, /appId: com\.vispnote\.app/);
  assert.match(builder, /productName: VispNote/);
  assert.match(builder, /- assets\/\*\*\/*/);
  assert.match(builder, /!VispNote\/\*\*\/*/);
  assert.match(builder, /!OminiNote\/\*\*\/*/);
  assert.match(builder, /!MyNote\/\*\*\/*/);
  assert.match(builder, /!vispnote-web\/\*\*\/*/);
  assert.match(builder, /icon: assets\/linux-icons/);
  assert.match(builder, /afterInstall: scripts\/linux-after-install\.sh/);
  assert.match(builder, /shortcutName: VispNote/);
  for (const size of linuxIconSizes) {
    assert.ok(fs.statSync(path.join(__dirname, `../assets/linux-icons/${size}x${size}.png`)).size > 0);
  }
  assert.match(linuxAfterInstall, /gtk-update-icon-cache -q -t -f \/usr\/share\/icons\/hicolor/);
  assert.match(linuxAfterInstall, /xdg-icon-resource forceupdate --theme hicolor/);
});

test('Release metadata targets renamed VispNote repository', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release-builds.yml'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const aiSource = fs.readFileSync(path.join(__dirname, '../lib/ai.js'), 'utf8');

  assert.equal(pkg.version, '0.1.14');
  assert.equal(lock.version, '0.1.14');
  assert.equal(lock.packages[''].version, '0.1.14');
  assert.deepEqual(pkg.files, [
    'OminiNote.html',
    'main.js',
    'preload.js',
    'assets/',
    'lib/',
    'src/',
    'scripts/linux-after-install.sh',
    'electron-builder.yml',
  ]);
  assert.equal(pkg.homepage, 'https://github.com/djkeshawa/visp-note#readme');
  assert.equal(pkg.repository.url, 'https://github.com/djkeshawa/visp-note.git');
  assert.match(workflow, /name: VispNote-\$\{\{ matrix\.name \}\}/);
  assert.match(workflow, /--title "VispNote \$\{tag\}"/);
  assert.match(workflow, /Automated VispNote desktop release/);
  assert.match(settings, /Version 0\.1\.13 · Prototype/);
  assert.match(aiSource, /headers\['HTTP-Referer'\] = 'https:\/\/github\.com\/djkeshawa\/visp-note'/);
  assert.match(aiSource, /headers\['X-Title'\] = 'VispNote'/);
});

test('Release builds omit AppX and MSIX Store package targets', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const builder = fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release-builds.yml'), 'utf8');

  assert.equal(pkg.scripts['build:win:appx'], undefined);
  assert.equal(pkg.scripts['build:win:msix'], undefined);
  assert.equal(pkg.scripts['build:win:store'], undefined);
  assert.doesNotMatch(builder, /^appx:/m);
  assert.doesNotMatch(workflow, /windows-appx-x64/);
  assert.doesNotMatch(workflow, /windows-msix-x64/);
  assert.doesNotMatch(workflow, /dist\/\*\.appx/);
  assert.doesNotMatch(workflow, /dist\/\*\.msix/);
  assert.equal(fs.existsSync(path.join(__dirname, '../electron-builder-msix.yml')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../docs/microsoft-store-submission.md')), false);
});

test('Vault switcher uses VispNote icon instead of letter tiles', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/sidebar.jsx'), 'utf8');

  assert.match(sidebar, /const VAULT_ICON_SRC = 'assets\/vispnote-icon\.png'/);
  assert.match(sidebar, /function MnVaultIcon/);
  assert.match(sidebar, /<img src=\{VAULT_ICON_SRC\} alt="" aria-hidden="true"/);
  assert.match(sidebar, /<MnVaultIcon T=\{T\} size=\{22\} active \/>/);
  assert.match(sidebar, /<MnVaultIcon T=\{T\} size=\{20\} active=\{active\} \/>/);
  assert.match(sidebar, /Switch vault/);
  assert.match(sidebar, /vaultKindLabel/);
  assert.match(sidebar, /vaultNoteLabel/);
  assert.match(sidebar, /maxHeight: 260/);
  assert.match(sidebar, /aria-haspopup="menu"/);
  assert.match(sidebar, /onRefreshVaults\(\{ reloadActive: false, reason: 'vault-dropdown' \}\)/);
  assert.match(sidebar, /Rename vault/);
  assert.doesNotMatch(sidebar, /activeVault\?\.name \|\| 'm'\)\[0\]\.toLowerCase/);
  assert.doesNotMatch(sidebar, /v\.name\[0\]\.toLowerCase/);
});

test('Security hardening blocks navigation, unsafe metadata, and unsafe AI endpoints', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../OminiNote.html'), 'utf8');
  const markdown = fs.readFileSync(path.join(__dirname, '../src/markdown.jsx'), 'utf8');
  const storeSource = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const aiSource = fs.readFileSync(path.join(__dirname, '../lib/ai.js'), 'utf8');
  const store = require('../lib/store');
  const ai = require('../lib/ai');

  assert.match(main, /const \{ pathToFileURL \} = require\('url'\)/);
  assert.match(main, /function hardenWindow\(win\)/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /webContents\.on\('will-navigate'/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /allowRunningInsecureContent: false/);
  assert.match(main, /async function setPrefsFromIpc\(patch\)/);
  assert.match(main, /Object\.prototype\.hasOwnProperty\.call\(patch, 'aiConfig'\)/);
  assert.match(main, /const config = ai\.setConfig\(patch\.aiConfig\)/);
  assert.match(main, /store\.setPrefs\(\{ \.\.\.patch, aiConfig: config \}\)/);
  assert.match(main, /ipcMain\.handle\('mn:setPrefs',\s+wrap\(setPrefsFromIpc\)\)/);
  assert.doesNotMatch(main, /ipcMain\.handle\('mn:setPrefs',\s+wrap\(store\.setPrefs\)\)/);
  assert.match(main, /ai\.setConfig\(prefs\.aiConfig, \{ rejectUnknown: false \}\)/);
  assert.match(main, /saved AI config ignored/);
  assert.match(main, /idx\.init\(\)/);
  assert.match(main, /result\?\.config\?\.provider === 'ollama'/);
  assert.match(main, /store\.setPrefs\(\{ aiConfig: ai\.getConfig\(\) \}\)/);

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /frame-ancestors 'none'/);

  assert.doesNotMatch(markdown, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(markdown, /\.innerHTML\s*=/);

  assert.match(storeSource, /function sanitizeVaultMetaPatch/);
  assert.match(storeSource, /Unsupported vault metadata field/);
  assert.match(storeSource, /if \(states === null \|\| states === undefined\) return null/);
  assert.match(storeSource, /Unsupported preferences field/);

  const cleanMeta = store.__test.sanitizeVaultMetaPatch({
    tags: [{ name: ' Novel Cast ', hue: 999 }, 'novel-research'],
    lastSelectedId: 'n_valid-1',
    novelistMode: true,
    workflowStates: [],
    novelistAiConfig: { wordLimit: 900 },
  });
  assert.deepEqual(cleanMeta.tags, [
    { name: 'novel-cast', hue: 360 },
    { name: 'novel-research', hue: 240 },
  ]);
  assert.equal(cleanMeta.lastSelectedId, 'n_valid-1');
  assert.equal(cleanMeta.novelistMode, true);
  assert.deepEqual(cleanMeta.workflowStates, []);
  assert.deepEqual(cleanMeta.novelistAiConfig, { wordLimit: 900 });
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ slug: '../x' }), /Unsupported vault metadata field/);
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ lastSelectedId: '../x' }), /Invalid note id/);
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ novelistAiConfig: 'bad' }), /Invalid novelist AI config patch/);

  assert.match(aiSource, /function sanitizeConfigPatch/);
  assert.match(aiSource, /SECRET_CONFIG_KEYS/);
  assert.match(aiSource, /piiReduction/);
  assert.match(aiSource, /Invalid \$\{field\} protocol/);
  assert.match(aiSource, /config: publicConfig\(\)/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'file:///tmp/model' }), /Invalid customBaseUrl protocol/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ surprise: true }), /Unsupported AI config field/);
  assert.equal(ai.__test.sanitizeConfigPatch({ piiReduction: false }).piiReduction, false);
  assert.equal(
    ai.__test.sanitizeConfigPatch({ customBaseUrl: 'http://localhost:11434/v1/' }).customBaseUrl,
    'http://localhost:11434/v1'
  );
  assert.equal(
    ai.__test.publicConfig({ openaiApiKey: 'secret-key', provider: 'openai' }).openaiApiKey,
    'configured'
  );
});

test('AI PII reduction masks hosted provider requests and restores local placeholders', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  const originalFetch = global.fetch;
  const sensitive = [
    'Email jane.doe@example.com',
    'phone +1 (415) 555-0134',
    'SSN 123-45-6789',
    'card 4111 1111 1111 1111',
    'address 123 Market Street',
    'token sk-1234567890abcdefghijkl',
    'IP 10.0.0.5',
  ].join(', ');
  const reduced = ai.__test.reducePiiMessages([{ role: 'user', content: sensitive }]);
  const redacted = reduced.messages[0].content;

  assert.match(redacted, /\[EMAIL_1\]/);
  assert.match(redacted, /\[PHONE_1\]/);
  assert.match(redacted, /\[SSN_1\]/);
  assert.match(redacted, /\[CARD_1\]/);
  assert.match(redacted, /\[ADDRESS_1\]/);
  assert.match(redacted, /\[SECRET_1\]/);
  assert.match(redacted, /\[IP_1\]/);
  assert.doesNotMatch(redacted, /jane\.doe@example\.com/);
  assert.equal(
    ai.__test.restorePiiText('Reply to [EMAIL_1] at [PHONE_1].', reduced.replacements),
    'Reply to jane.doe@example.com at +1 (415) 555-0134.'
  );

  let capturedBody = null;
  global.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Use [EMAIL_1] and [PHONE_1].' } }],
      }),
    };
  };

  try {
    ai.setConfig({
      provider: 'custom',
      customBaseUrl: 'https://example.invalid/v1',
      customApiKey: 'test-key',
      chatModel: 'test-model',
      piiReduction: true,
    });
    const result = await ai.__test.providerChat([{ role: 'user', content: sensitive }]);
    const sentMessages = JSON.stringify(capturedBody.messages);
    assert.match(sentMessages, /\[EMAIL_1\]/);
    assert.match(sentMessages, /\[PHONE_1\]/);
    assert.doesNotMatch(sentMessages, /jane\.doe@example\.com/);
    assert.doesNotMatch(sentMessages, /\+1 \(415\) 555-0134/);
    assert.equal(result.text, 'Use jane.doe@example.com and +1 (415) 555-0134.');

    ai.setConfig({ piiReduction: false });
    await ai.__test.providerChat([{ role: 'user', content: 'Email jane.doe@example.com' }]);
    assert.match(JSON.stringify(capturedBody.messages), /jane\.doe@example\.com/);
  } finally {
    global.fetch = originalFetch;
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('Fallback spell checker underlines misspellings and offers replacements', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');

  assert.match(main, /function spellcheckWords/);
  assert.match(main, /SPELL_DICTIONARY_PATHS/);
  assert.match(main, /loadedDictionaryWords < 1000/);
  assert.match(main, /if \(!spellDictionaryAvailable\) return \{\}/);
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
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const outline = fs.readFileSync(path.join(__dirname, '../src/outline.jsx'), 'utf8');
  const notelist = fs.readFileSync(path.join(__dirname, '../src/notelist.jsx'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const aiSource = fs.readFileSync(path.join(__dirname, '../lib/ai.js'), 'utf8');
  const ollama = fs.readFileSync(path.join(__dirname, '../lib/ollama.js'), 'utf8');

  assert.match(app, /workflowArchived: !!n\.workflowArchived/);
  assert.match(app, /if \(note\.workflowArchived\) \{/);
  assert.match(app, /archivedNotes\.push/);
  assert.match(app, /const updateWorkflowArchived = useCallbackA/);
  assert.match(app, /archivedNotes=\{workflowViewData\.archivedNotes\}/);
  assert.match(app, /onSetWorkflowArchived=\{updateWorkflowArchived\}/);
  assert.match(app, /"workflowStates": null/);
  assert.match(app, /mnNormalizeWorkflowStatesForApp/);
  assert.match(app, /const normalWorkflowStates = useMemoA/);
  assert.match(app, /const novelistWorkflowStates = useMemoA/);
  assert.match(app, /activeVault\?\.novelistMode \? novelistWorkflowStates : normalWorkflowStates/);
  assert.match(app, /setWorkflowStates\?\.\(workflowStates\)/);
  assert.match(app, /const updateWorkflowStates = useCallbackA/);
  assert.match(app, /saveVaultMeta\(activeVaultId, \{ workflowStates: next \}\)/);
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
  assert.match(panels, /renderWorkflowStateManager/);
  assert.match(panels, /Array\.isArray\(states\) && states\.length === 0 \? \[\]/);
  assert.doesNotMatch(panels, /disabled=\{\(workflowStates \|\| \[\]\)\.length <= 1\}/);
  assert.match(app, /if \(Array\.isArray\(states\) && states\.length === 0\) return \[\]/);
  assert.match(blockFeatures, /if \(Array\.isArray\(states\) && states\.length === 0\) return \[\]/);
  assert.match(panels, /new column/);
  assert.match(panels, /addWorkflowState/);
  assert.match(panels, /removeWorkflowState/);
  assert.match(panels, /onWorkflowStatesChange && onWorkflowStatesChange/);
  assert.match(panels, /const \[dragOverState, setDragOverState\] = useStateP\(null\)/);
  assert.match(panels, /const \[dragPreview, setDragPreview\] = useStateP\(null\)/);
  assert.match(panels, /const dragItemRef = useRefP\(null\)/);
  assert.match(panels, /setActiveDragItem/);
  assert.match(panels, /clearActiveDragItem/);
  assert.match(panels, /updateDragPreview/);
  assert.match(panels, /setTransparentDragImage/);
  assert.match(panels, /const WorkflowDragPreview = \(\) =>/);
  assert.match(panels, /suppressCardClickRef/);
  assert.match(panels, /workflowStateFromPoint/);
  assert.match(panels, /beginCardPointerDrag/);
  assert.match(panels, /data-mn-workflow-state=\{state\.id\}/);
  assert.match(panels, /window\.addEventListener\('pointermove', onMove\)/);
  assert.match(panels, /onDragStart=\{\(e\) =>/);
  assert.match(panels, /e\.dataTransfer\.setData\('text\/mn-workflow', payload\)/);
  assert.match(panels, /onDrag=\{\(e\) =>/);
  assert.match(panels, /Release to move to \{state\.id\}/);
  assert.match(panels, /types\.includes\('text\/mn-note'\)/);
  assert.match(panels, /types\.includes\('text\/plain'\)/);
  assert.match(panels, /readDropNoteId/);
  assert.match(panels, /moveWorkflowNote\(noteId, null, state\.id\)/);
  assert.match(panels, /marginRight: 54/);
  assert.match(notelist, /draggable/);
  assert.match(notelist, /e\.dataTransfer\.setData\('text\/mn-note', payload\)/);
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
  assert.doesNotMatch(panels, /textDecoration: isClosedState\(state\) \? 'line-through' : 'none'/);
  assert.doesNotMatch(panels, /textDecoration:[\s\S]{0,80}line-through[\s\S]{0,80}No preview/);
  assert.doesNotMatch(panels, /state\.id === 'DONE' \|\| state\.id === 'CANCELLED'/);
  assert.match(outliner, /function mnWorkflowSlashCommands/);
  assert.match(outliner, /MN_NOVELIST_SLASH_CMDS/);
  assert.match(outliner, /options\.novelistMode \? MN_NOVELIST_SLASH_CMDS : \[\]/);
  assert.match(outliner, /plot-points/);
  assert.match(outliner, /One plot point per line/);
  assert.match(outliner, /updateBeatsText/);
  assert.doesNotMatch(outliner, /Add beat/);
  assert.doesNotMatch(outliner, /Remove beat/);
  assert.match(outliner, /Find page to link/);
  assert.match(outliner, /No available pages/);
  assert.match(outliner, /contexts: \[\.\.\.contexts, `\[\[\$\{title\}\]\]`\]/);
  assert.match(outliner, /aiActive=\{aiActive\}/);
  assert.match(outliner, /AI working/);
  assert.match(outliner, /mn-ai-live-dots/);
  assert.match(outliner, /function MnInlineAiPreview/);
  assert.match(outliner, /AI preview/);
  assert.match(outliner, /mn-inline-ai-preview-streaming/);
  assert.match(editor, /noteId=\{note\.id\}/);
  assert.match(outliner, /noteIdRef/);
  assert.match(outliner, /previewForCurrentNote/);
  assert.match(outliner, /makeAiPreview\(requestNoteId/);
  assert.match(outliner, /const pageContinuationInstruction/);
  assert.match(outliner, /Continue from the end of it/);
  assert.match(outliner, /const appendPageWrite = actionId === 'write' && pageBlocks\.length > 0/);
  assert.match(outliner, /const appendPageBlocks/);
  assert.match(outliner, /kind: 'append-page'/);
  assert.match(outliner, /appendPageBlocks\(preview\.text\)/);
  assert.match(outliner, /plotPointsAction: 'write-scene'/);
  assert.match(outliner, /const appendPlotWrite = payload\.plotPointsAction === 'write-scene'/);
  assert.match(outliner, /Existing page context/);
  assert.match(outliner, /appended to the bottom of the page/);
  assert.match(outliner, /function[^\n]*plotPointsInstruction|const plotPointsInstruction/);
  assert.match(outliner, /Linked context pages/);
  assert.match(outliner, /kind: 'insert-after'/);
  assert.match(outliner, /insertBlocksAfter\(preview\.target\.blockId, parseAiBlocks\(preview\.text\)\)/);
  assert.match(outliner, /window\.mn\.ai\.editStream/);
  assert.match(preload, /editStream:\(payload, onChunk\)/);
  assert.match(main, /mn:ai\.editStream/);
  assert.match(aiSource, /async function editTextStream/);
  assert.match(ollama, /async function chatStream/);
  assert.match(outline, /window\.MN_LOGSEQ\?\.WORKFLOW_STATES/);
  assert.doesNotMatch(outline, /\^\(TODO\|DOING\|DONE\|LATER\|NOW\|WAIT\|CANCELLED\)/);
  assert.match(notelist, /const workflowPattern = states/);
  assert.doesNotMatch(notelist, /\^\(TODO\|DOING\|DONE\|LATER\|NOW\|WAIT\|CANCELLED\)/);
  assert.match(app, /function MnReminderCenter\(\{ open, items, dueCount, onToggle, onClose, onOpenNote, topOffset = 13, T \}\)/);
  assert.match(app, /top: topOffset/);
  assert.match(app, /const reminderCenterTop = view === 'workflow' \? 30 : view === 'graph' \? 12 : 13/);
  assert.match(app, /topOffset=\{reminderCenterTop\}/);
});

test('Stabilization wiring avoids stale UI and native dialogs', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const notelist = fs.readFileSync(path.join(__dirname, '../src/notelist.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/blockFeatures.jsx'), 'utf8');
  const panels = fs.readFileSync(path.join(__dirname, '../src/panels.jsx'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');

  assert.match(app, /function MnAppNoticeDialog/);
  assert.match(app, /const searchSeq = useRefA\(0\)/);
  assert.match(app, /if \(seq === searchSeq\.current && res\.ok\) setSearchHits/);
  assert.match(app, /Load first, then switch atomically/);
  assert.match(app, /function mnReplaceWikiLinkTitle/);
  assert.match(app, /const duplicateNote = useCallbackA/);
  assert.match(app, /showAppNotice\('Could not create vault'/);
  assert.doesNotMatch(app, /alert\(/);
  assert.doesNotMatch(app, /window\.prompt/);

  assert.match(notelist, /onRenameNote/);
  assert.match(notelist, /onDuplicateNote/);
  assert.match(notelist, /onDeleteNote/);
  assert.match(notelist, /onContextMenu=\{\(e\) =>/);
  assert.match(editor, /onDuplicate/);
  assert.match(editor, /title="Duplicate note"/);

  assert.match(outliner, /const \[aiPrompt, setAiPrompt\]/);
  assert.match(outliner, /role="dialog"/);
  assert.match(outliner, /Marker: \$\{state\.id\}/);
  assert.doesNotMatch(outliner, /window\.prompt/);
  assert.match(blockFeatures, /Block marker/);

  assert.match(store, /novelistAiConfig/);
  assert.match(panels, /initialAiConfig = null/);
  assert.match(panels, /onAiConfigChange && onAiConfigChange\(next\)/);
  assert.match(panels, /window\.mnWriteNovelistAiConfig = mnWriteNovelistAiConfig/);
  assert.match(app, /window\.mnWriteNovelistAiConfig\?\.\(activeVault\.novelistAiConfig, activeVaultId\)/);
});

test('Data safety wiring exposes trash, versions, and save conflict recovery', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');

  assert.match(store, /atomicWriteFile/);
  assert.match(store, /NOTE_CONFLICT/);
  assert.match(store, /listDeletedNotes/);
  assert.match(store, /restoreNoteVersion/);
  assert.match(store, /restoreDeletedCanvas/);
  assert.match(main, /mn:listDeletedNotes/);
  assert.match(main, /mn:restoreDeletedCanvas/);
  assert.match(main, /mn:restoreNoteVersion/);
  assert.match(preload, /listNoteVersions/);
  assert.match(preload, /listDeletedCanvases/);
  assert.match(preload, /restoreDeletedNote/);

  assert.match(app, /expectedModifiedAt: n\.diskModifiedAt/);
  assert.match(app, /MnSaveConflictDialog/);
  assert.match(app, /MnVersionHistoryDialog/);
  assert.match(settings, /Recently deleted/);
  assert.match(settings, /onRestoreDeletedNote/);
  assert.match(editor, /Version history/);
});
