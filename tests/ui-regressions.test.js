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
  assert.match(canvas, /function mnCanvasToolbarShelf/);
  assert.match(canvas, /function mnCanvasToolbarRow/);
  assert.match(canvas, /function mnCanvasToolbarMoreSlot/);
  assert.match(canvas, /padding: '7px 18px 10px'/);
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

test('Renderer regression covers user-centered app workflows', () => {
  const regression = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');

  assert.match(regression, /runScenario\(win, 'Editor', 'blank notes prioritize writing and disclose secondary actions'/);
  assert.match(regression, /data-mn-properties-panel/);
  assert.match(regression, /data-mn-note-list-mode="overlay"/);
  assert.match(regression, /desktop\.mode !== 'three-pane'/);
  assert.match(regression, /runScenario\(win, 'Notes', 'create, edit, and persist a note'/);
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
  assert.match(appShell, /You can restore this note from Recently deleted/);
  assert.match(app, /setDeleteTargetId\(id\)/);
  assert.match(app, /onDelete=\{\(\) => requestDeleteNote\(selectedNote\.id\)\}/);
  assert.match(app, /onConfirm=\{\(\) => deleteNote\(deleteTargetNote\.id\)\}/);
  assert.match(appShell, /background: T\.danger/);
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
