const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('one shared palette owns mixed and notes-first navigation modes', () => {
  const view = source('src/app/AppView.jsx');
  const app = source('src/app/app.jsx');
  const palette = source('src/app/shell/CommandPalette.jsx');
  const overlays = source('src/features/overlays/useOverlayController.js');

  assert.match(view, /open=\{commandPaletteOpen \|\| quickSwitcherOpen\}/);
  assert.match(view, /mode=\{quickSwitcherOpen \? 'notes' : 'mixed'\}/);
  assert.equal((view.match(/<MnCommandPalette/g) || []).length, 1);
  assert.doesNotMatch(view, /<MnQuickSwitcher/);
  assert.doesNotMatch(app, /quickSwitcher\.jsx|quickSwitcherModel/);
  assert.match(overlays, /const \[paletteMode, setPaletteMode\] = useState\(null\)/);
  assert.doesNotMatch(overlays, /useState\(false\).*quickSwitcherOpen/);
  assert.match(palette, /data-mn-palette-mode=\{mode\}/);
  assert.match(palette, /data-mn-palette-kind=\{item\.kind\}/);
  assert.match(palette, /Open or create a note…/);
  assert.match(palette, /Search notes and actions…/);
});

test('Quick Capture is body-first and keeps advanced fields disclosed on demand', () => {
  const capture = source('src/features/capture/components/QuickCapture.jsx');
  const noteActions = source('src/app/controllers/useAppNoteActions.js');

  assert.match(capture, /bodyRef\.current\?\.focus\(\)/);
  assert.match(capture, /createsNewNote && \(/);
  assert.match(capture, /aria-label="New note title"/);
  assert.match(capture, /aria-label="Quick capture text"/);
  assert.match(capture, /aria-controls="mn-capture-options"/);
  assert.match(capture, /const \[destinationId, setDestinationId\] = useStateP\('today'\)/);
  assert.match(noteActions, /destinationId = 'today'/);
  assert.match(noteActions, /quickCaptureRawMarkdown\(\{ title: requestedTitle, body \}\)/);
});

test('note-list search explicitly promises full-content search', () => {
  const noteList = source('src/panels/notelist.jsx');
  assert.match(noteList, /aria-label="Search note contents"/);
  assert.match(noteList, /placeholder="Search note contents…"/);
  assert.doesNotMatch(noteList, /placeholder="Search notes…"/);
});
