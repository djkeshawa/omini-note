const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appSource, outlinerSource } = require('./helpers/source.js');
const vm = require('node:vm');

const ops = require('../src/editor/editorOps.js');
const tableOps = require('../src/editor/tableOps.js');
const appHelpers = require('../src/app/appHelpers.js');
const appNovelist = require('../src/app/appNovelist.js');
const appMutations = require('../src/app/appMutations.js');
const appCanvasActions = require('../src/app/appCanvasActions.js');
const panelHelpers = require('../src/panels/panelHelpers.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');

test('Canvas editor supports expected drawing, color, clipboard, and delete interactions', () => {
  const canvasRoot = path.join(__dirname, '../src/features/canvas');
  const canvas = [
    fs.readFileSync(path.join(canvasRoot, 'CanvasPanel.jsx'), 'utf8'),
    ...fs.readdirSync(path.join(canvasRoot, 'components')).sort().map(name => fs.readFileSync(path.join(canvasRoot, 'components', name), 'utf8')),
    fs.readFileSync(path.join(canvasRoot, 'useCanvasKeyboardShortcuts.js'), 'utf8'),
  ].join('\n');
  const canvasModel = fs.readFileSync(path.join(__dirname, '../src/canvas/canvasModel.js'), 'utf8');

  assert.match(canvasModel, /id: 'pen'/);
  assert.match(canvasModel, /id: 'arrow'/);
  assert.match(canvasModel, /id: 'diamond'/);
  assert.match(canvasModel, /id: 'triangle'/);
  assert.match(canvasModel, /id: 'eraser'/);
  assert.match(canvas, /function MnCanvasToolIcon/);
  // The tool buttons live on the dock now; each is labelled by its tool.
  assert.match(canvas, /aria-label=\{item\.label\}/);
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
  assert.match(canvas, /function CanvasStyleBar/);
  assert.match(canvas, /function CustomSwatch/);
  assert.match(canvas, /type="color"/);
  assert.match(canvas, /applyColor\?\.\('stroke'/);
  assert.match(canvas, /applyColor\?\.\('fill'/);
  assert.match(canvas, /function MnCanvasDeleteDialog/);
  assert.match(canvas, /role="dialog"/);
  assert.doesNotMatch(canvas, /window\.confirm\('Delete this canvas\?'\)/);
  assert.match(canvas, /setPointerCapture/);
  assert.match(canvas, /releasePointerCapture/);
  assert.match(canvas, /data-mn-canvas-stage="true"/);
  assert.match(canvas, /rootRef\.current\?\.focus\(\)/);
  assert.match(canvas, /saveTitle\(\); onBack && onBack\(\)/);
  assert.doesNotMatch(canvas, /if \(action\.mode === 'create'\) setTool\('select'\)/);
  assert.match(canvas, /const \[selectedIds, setSelectedIds\]/);
  assert.match(canvasModel, /function mnCanvasSelectionBounds/);
  assert.match(canvasModel, /function mnCanvasMoveElement/);
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
  assert.match(canvas, /const \[toolbarMenuOpen, setToolbarMenuOpen\]/);
  assert.match(canvas, /More canvas tools/);
  assert.match(canvas, /role="menu"/);
  assert.match(canvas, /toolbarMenuRef/);
  assert.match(canvas, /window\.addEventListener\('pointerdown', onPointerDown\)/);
  assert.match(canvas, /window\.addEventListener\('keydown', onKeyDown\)/);
  assert.match(canvas, /aria-expanded=\{isExpandedToggle \? expanded : undefined\}/);
  assert.match(canvas, /aria-haspopup=\{hasPopup \? 'menu' : undefined\}/);
  assert.match(canvas, /function mnCanvasMoreMenu/);
  assert.match(canvas, /function mnCanvasMoreMenuGrid/);
  assert.match(canvas, /function mnCanvasToolbarMoreSlot/);
  // The shelf band is gone — the header is one 52px row, as the prototype
  // draws it. Its geometry assertions move to the row that replaced it.
  assert.doesNotMatch(canvas, /function mnCanvasToolbarShelf/);
  assert.doesNotMatch(canvas, /function mnCanvasToolbarRow/);
  assert.doesNotMatch(canvas, /function mnCanvasToolbarGroup/);
  assert.match(canvas, /height: DS_HEIGHT\.panelHeader/);
  assert.match(canvas, /padding: '0 20px'/);
  assert.match(canvas, /function mnCanvasHeaderButton/);
  assert.match(canvas, /flex: '0 0 auto'/);
  assert.match(canvas, /flexWrap: 'wrap'/);
  assert.doesNotMatch(canvas, /overflowX: 'auto'/);
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

  const canvasActions = fs.readFileSync(path.join(__dirname, '../src/app/appCanvasActions.js'), 'utf8');
  assert.match(canvasActions, /setActiveCanvas\(current => current\?\.id === saved\.id \? saved : current\)/);
});

test('the block-range drag waits for its own press instead of racing the scroll', () => {
  const regression = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');
  const drag = regression.slice(
    regression.indexOf('async function dragEditorBlockRangeAcrossScroll'),
    regression.indexOf('async function runLargeBlockSelectionDeleteScenario')
  );
  assert.ok(drag, 'the drag helper still exists');

  // The press travels by sendInputEvent and the scroll by executeJavaScript,
  // and nothing orders one against the other. A fixed pause between them was
  // a bet that the renderer drained its input queue first; when it lost, the
  // editor scrolled before the press was hit-tested and the drag anchored on
  // whichever row had slid into that spot — selecting a short range out of
  // the middle of the note. The press must therefore be observed to have
  // landed before anything scrolls, not merely waited on.
  const press = drag.indexOf("type: 'mouseDown'");
  const anchored = drag.indexOf('block drag anchors on row');
  const scroll = drag.indexOf('rowForDrag(endIndex)');
  assert.ok(press > 0 && anchored > press, 'the press is confirmed after it is sent');
  assert.ok(scroll > anchored, 'nothing scrolls until the press has been confirmed');
  assert.match(drag, /mnRegressionDragAnchor/);
  assert.doesNotMatch(
    drag.slice(press, scroll),
    /await wait\(/,
    'a sleep between the press and the scroll is the bet that failed'
  );
  // The release is pinned the same way: it must be over the intended row.
  const release = drag.indexOf("type: 'mouseUp'");
  assert.ok(drag.indexOf('block drag reaches row') < release, 'the pointer is confirmed before releasing');
});

test('Renderer regression covers user-centered app workflows', () => {
  const regression = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');

  assert.match(regression, /runScenario\(win, 'Editor', 'blank notes prioritize writing and disclose secondary actions'/);
  assert.match(regression, /data-mn-properties-panel/);
  assert.match(regression, /data-mn-note-list-mode="overlay"/);
  assert.match(regression, /desktop\.mode !== 'three-pane'/);
  assert.match(regression, /runScenario\(win, 'Notes', 'create, edit, and persist a note'/);
  assert.match(regression, /runScenario\(win, 'Attachments', 'drops a PDF into the vault and renders a safe file chip'/);
  assert.match(regression, /runScenario\(win, 'Capture', 'quick capture saves a task note and closes cleanly'/);
  assert.match(regression, /runScenario\(win, 'Search', 'note search finds expected content and Escape clears it'/);
  assert.match(regression, /runScenario\(win, 'Navigation', 'sidebar opens agenda planner and graph panels'/);
  assert.match(regression, /runScenario\(win, 'Agenda', 'agenda creates dated reminders and todos'/);
  assert.match(regression, /QE agenda dated todo @remind \\d\{4\}-\\d\{2\}-\\d\{2\}/);
  assert.match(regression, /Complete QE agenda dated todo/);
  assert.match(regression, /- \\\[x\\\] QE agenda dated todo/);
  assert.match(regression, /runScenario\(win, 'Canvas', 'create, draw, move, undo, and redo a canvas object'/);
  assert.match(regression, /mouseDrag\(win, start, end/);
  assert.match(regression, /waitForCanvasContent\(win, title, 'canvas undo restores rectangle position'/);
  assert.match(regression, /runScenario\(win, 'Trash', 'delete explains recoverability and restore returns the note'/);
  assert.match(regression, /runScenario\(win, 'Settings', 'settings opens with clear context and closes'/);
  assert.match(regression, /runScenario\(win, 'Layout', 'minimum and desktop windows keep core controls usable'/);
  assert.match(regression, /assertViewportUsable\(win, 'minimum supported window'\)/);
  assert.match(regression, /State: \$\{JSON\.stringify\(current\)\}/);
  assert.match(regression, /Editor rows: \$\{JSON\.stringify\(rows\)\}/);
});

test('Note delete confirmation uses themed in-app dialog', () => {
  const app = appSource(__dirname);
  const appShellRoot = path.join(__dirname, '../src/app');
  const appShell = fs.readdirSync(path.join(appShellRoot, 'shell')).sort()
    .map(name => fs.readFileSync(path.join(appShellRoot, 'shell', name), 'utf8')).join('\n');

  assert.match(appShell, /function MnDeleteNoteDialog/);
  assert.match(appShell, /className="mn-delete-note-dialog"/);
  assert.match(appShell, /role="dialog"/);
  assert.match(appShell, /aria-modal="true"/);
  const dialogFocus = fs.readFileSync(path.join(__dirname, '../src/shared/useDialogFocus.js'), 'utf8');
  assert.match(dialogFocus, /event\.key !== 'Tab'/);
  assert.match(dialogFocus, /previousFocus\?\.isConnected/);
  // The consequence line states both where the note goes and how long it can
  // be recovered, which is stronger than the old reassurance-only copy.
  assert.match(appShell, /It moves to Recently deleted and is removed from disk after 30 days\./);
  assert.match(app, /setDeleteTargetId\(id\)/);
  assert.match(app, /onDelete=\{\(\) => requestDeleteNote\(selectedNote\.id\)\}/);
  assert.match(app, /onConfirm=\{\(\) => deleteNote\(deleteTargetNote\.id\)\}/);
  // Destructive tone now comes from the shared dialog shell rather than an
  // inline colour, so assert the shell is asked for it.
  assert.match(appShell, /tone="danger"/);
  assert.match(appShell, /dsButtonStyle\(T, 'danger'/);
  assert.doesNotMatch(app, /confirm\(/);
});

test('Launch screen uses VispNote logo with pastel blooming light design', () => {
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');
  const app = appSource(__dirname);
  const appShellRoot = path.join(__dirname, '../src/app');
  const appShell = fs.readdirSync(path.join(appShellRoot, 'shell')).sort()
    .map(name => fs.readFileSync(path.join(appShellRoot, 'shell', name), 'utf8')).join('\n');
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
  assert.match(html, /Write<\/span><i><\/i><span>Connect<\/span><i><\/i><span>Act/);
  assert.match(html, /class="mn-boot-status">Opening vault and indexing notes/);
  assert.match(html, /class="mn-boot-progress"><div><\/div><\/div>/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(html, /@keyframes mnBootLogoTrace/);
  assert.doesNotMatch(html, /@keyframes mnBootLogoGlow/);
  assert.doesNotMatch(html, /@keyframes mnBootWordGlow/);
  assert.doesNotMatch(html, /mnBootLogoFloat/);
  assert.doesNotMatch(html, /mnBootWordGlow/);
  assert.match(html, /Connecting your workspace/);
  assert.match(appShell, /function MnBootLogo/);
  assert.match(appShell, /aria-label="VispNote"/);
  assert.match(appShell, /src="assets\/vispnote-loading-transparent\.png"/);
  assert.match(appShell, /alt="VispNote"/);
  assert.match(appShell, /className="mn-boot-title mn-boot-wordmark">VispNote/);
  assert.match(appShell, /<MnBootLogo \/>/);
  assert.match(appShell, /MN_LAUNCH_BLOOMS/);
  assert.doesNotMatch(appShell, /MN_LAUNCH_RIPPLES/);
  assert.match(appShell, /className="mn-boot-light-field"/);
  assert.match(appShell, /className="mn-light-bloom"/);
  assert.doesNotMatch(appShell, /className="mn-light-ripple"/);
  assert.match(appShell, /className="mn-boot-status"/);
  assert.match(appShell, /className="mn-boot-progress"/);
  assert.doesNotMatch(appShell, /MN_LAUNCH_FLOATS/);
  assert.doesNotMatch(appShell, /MN_LAUNCH_NEURAL_PATHS/);
  assert.ok(appIcon.size > 0);
});

test('the last-resort text write reports whether it actually changed anything', () => {
  const planning = fs.readFileSync(path.join(__dirname, '../src/app/controllers/useAppPlanningActions.js'), 'utf8');
  // agendaReplaceUniqueSourceText returns the body unchanged when the text
  // appears twice. This rung used to return true regardless, so a caller was
  // told the edit landed while the note was untouched — invisible until a
  // view put a checkbox on it.
  assert.match(planning, /replaced = next !== body/);
  assert.match(planning, /return replaced;/);
  assert.doesNotMatch(planning, /agendaReplaceUniqueSourceText\(body, source, nextText\);\n\s*\}\);\n\s*return true;/);
});

test('the views pack has a regression scenario that drives it', () => {
  const harness = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');
  assert.match(harness, /runScenario\(win, 'Views', 'the views pack adds one saved-view surface'/);
  assert.match(harness, /setPackEnabledForRegression\(win, 'views', true\)/);
  // The pack-isolation table must carry views without a label: its check is a
  // substring match on body text and 'Views' is inside 'Smart Views'.
  assert.match(harness, /\{ id: 'views', commands: \['views'\], labels: \[\] \}/);
  // The scenario switches to the board and asserts real columns render — an
  // empty frame would pass a bare "the panel exists" probe.
  assert.match(harness, /views board renders columns/);
  assert.match(harness, /current\.panel && current\.columns > 0/);
  assert.match(harness, /views calendar renders a month grid/);
  assert.match(harness, /current\.nextMonth && current\.dayCells >= 28/);
  assert.match(harness, /opening another views dropdown replaces the first/);
  assert.match(harness, /clicking outside closes the views dropdown/);
  // Ticking from the board is asserted against the note on disk, not the DOM.
  assert.match(harness, /waitForPersistedNote\(win, 'QE Views Task Note'/);
  assert.match(harness, /- \\\[x\\\]\\s\+ship the views board/);
});

test('the sidebar More disclosure expands above its control', () => {
  const harness = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');
  assert.match(harness, /sidebar More expands its list above the control/);
  assert.match(harness, /current\.itemBottom <= current\.toggleTop/);
  assert.match(harness, /aria-label\^="Recently deleted,"/);
  assert.match(harness, /current\.items\.at\(-1\) === 'Recently deleted'/);
  assert.match(harness, /left \$\{label\} visible outside More/);
  assert.match(harness, /sidebar More returns to its collapsed separator position/);
});

test('optional sidebar destinations have visibility-toggle regression coverage', () => {
  const harness = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');
  assert.match(harness, /optional More destinations follow visibility toggles/);
  assert.match(harness, /runSidebarDestinationVisibilityScenario/);
  assert.match(harness, /setSidebarDestinationsForRegression/);
  assert.match(harness, /available sidebar destinations stay hidden until enabled/);
  assert.match(harness, /enabled optional sidebar destinations appear inside More/);
  assert.match(harness, /disabled optional sidebar destinations leave More/);
  assert.match(harness, /runCommandPaletteCommand\(win, 'open today', 'Open today'\)/);
  assert.match(harness, /openQuickCaptureFromAppBar\(win\)/);
});

test('smart view embeds do not re-query the vault on every render', () => {
  const embeds = fs.readFileSync(path.join(__dirname, '../src/editor/outliner/EmbeddedBlocks.jsx'), 'utf8');
  // The embed renders inside the editor, so an unmemoized query here ran a
  // whole-vault scan on every keystroke in any note containing one.
  assert.match(embeds, /const query = useMemoOE\(\(\) => \{/);
  assert.match(embeds, /\}, \[ready, helpers, allNotes, embed\?\.definition\]\)/);
  assert.doesNotMatch(embeds, /\n\s*results = helpers\.smartViewQuery\(/);
});

test('list rows and graph controls are declared at module scope', () => {
  const notelist = fs.readFileSync(path.join(__dirname, '../src/panels/notelist.jsx'), 'utf8');
  const graph = fs.readFileSync(path.join(__dirname, '../src/panels/graph.jsx'), 'utf8');

  // A component declared inside a render function is a new type on every
  // render, so React unmounts and rebuilds its DOM. That put the caret at the
  // end of the note-rename field on every keystroke, and dropped a drag on the
  // graph's force sliders after the first step.
  assert.match(notelist, /^function NoteRow\(/m);
  assert.doesNotMatch(notelist, /const NoteRow = \(/);
  assert.match(notelist, /<NoteRow key=\{[^}]+\} n=\{[^}]+\} ctx=\{rowCtx\}/);

  assert.match(graph, /^function Row\(\{ id, title, children, open, toggle, T \}\)/m);
  assert.match(graph, /^function Toggle\(\{ label, value, onChange \}\)/m);
  assert.match(graph, /^function Range\(\{ label, min, max, step, value, onChange, T \}\)/m);
  assert.doesNotMatch(graph, /const Range = \(/);

  const workflow = fs.readFileSync(path.join(__dirname, '../src/features/workflow/WorkflowBoardParts.jsx'), 'utf8');
  const workflowPanel = fs.readFileSync(path.join(__dirname, '../src/features/workflow/WorkflowPanel.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');
  const todos = fs.readFileSync(path.join(__dirname, '../src/panels/todosPanel.jsx'), 'utf8');
  const calendarChrome = fs.readFileSync(path.join(__dirname, '../src/panels/calendarChrome.jsx'), 'utf8');

  // The board card used to remount on every pointer move of a drag.
  assert.match(workflow, /^function Card\(\{ item, state, board \}\)/m);
  assert.match(workflow, /^function DropColumn\(/m);
  assert.doesNotMatch(workflowPanel, /const Card = \(/);
  assert.doesNotMatch(workflowPanel, /const DropColumn = \(/);
  assert.match(sidebar, /^function SectionHeader\(/m);
  assert.doesNotMatch(sidebar, /const SectionHeader = \(/);
  assert.doesNotMatch(sidebar, /const Row = props =>/);
  assert.match(todos, /^function Card\(\{ it, idx, ctx \}\)/m);
  assert.match(calendarChrome, /^function MnItemCard\(/m);
});

test('App and editor font size settings use stepper controls', () => {
  const settingsRoot = path.join(__dirname, '../src/settings');
  const settings = [
    path.join(settingsRoot, 'settings.jsx'),
    path.join(settingsRoot, 'settingsControls.jsx'),
    ...fs.readdirSync(path.join(settingsRoot, 'sections')).sort().map(name => path.join(settingsRoot, 'sections', name)),
  ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const settingsControls = fs.readFileSync(path.join(__dirname, '../src/settings/settingsControls.jsx'), 'utf8');
  const app = appSource(__dirname);
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const outliner = outlinerSource(__dirname);

  // An optional pack toggle reports explicit opt-in only, and is never
  // disabled by inference — a checked-and-disabled toggle left a vault with
  // workflow notes unable to reach Agenda at all.
  assert.match(settings, /const checked = enabledPacks\.includes\(pack\.id\);/);
  assert.doesNotMatch(settings, /disabled=\{inferred\.has\(pack\.id\)\}/);

  assert.match(settingsControls, /function FontSizeStepper/);
  assert.match(settings, /label="App font size"/);
  assert.match(settings, /label="Font size"/);
  assert.match(appRuntime, /"appFontSize": "default"/);
  assert.match(app, /--mn-app-font-size/);
  assert.match(app, /width: '100vw'/);
  assert.match(app, /height: '100vh'/);
  assert.doesNotMatch(app, /transform: `scale\(\$\{appScale\}\)`/);
  assert.doesNotMatch(app, /width: `calc\(100vw \/ \$\{appScale\}\)`/);
  assert.match(outliner, /mnEditorFontScale/);
});
