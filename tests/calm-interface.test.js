const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('note browsing uses a flat list with one visually primary creation action', () => {
  const noteList = source('src/panels/notelist.jsx');
  const sidebar = source('src/panels/sidebar.jsx');
  const view = source('src/app/AppView.jsx');

  assert.match(noteList, /data-mn-note-row="true"/);
  // Unselected rows stay flat and transparent; only the selected row lifts,
  // as an elevated card with a selLine border and a 2.5px accent bar.
  assert.match(noteList, /background: active \? \(T\.bgElevated \|\| T\.bg\) : 'transparent'/);
  assert.match(noteList, /boxShadow: active \? `0 2px 8px/);
  assert.match(noteList, /: 'none'/);
  assert.match(sidebar, /data-mn-primary-create="true"/);
  assert.match(sidebar, /label="Quick capture" hint=\{quickCaptureShortcut\}/);
  assert.match(view, /onOpenQuickCapture=\{\(\) => setCaptureOpen\(true\)\}/);
  assert.doesNotMatch(view, /\/\* FAB \*\//);
});

test('advanced note tools stay available through progressive disclosure', () => {
  const editor = source('src/editor/editor.jsx');
  const properties = source('src/features/editor/metadata/PropertiesPanel.jsx');
  const connections = source('src/features/editor/connections/ConnectionsSection.jsx');

  assert.match(editor, /const \[metadataOpen, setMetadataOpen\] = useStateE\(false\)/);
  assert.match(editor, /const \[connectionsOpen, setConnectionsOpen\] = useStateE\(false\)/);
  assert.match(editor, /useEffectE\(\(\) => \{\s*setMetadataOpen\(false\);\s*setConnectionsOpen\(false\)/);
  assert.match(editor, /data-mn-properties-toggle="true"/);
  assert.match(editor, /\{metadataOpen && \(\s*<PropertiesPanel/);
  assert.match(properties, /data-mn-surface="inline"/);
  assert.match(properties, /aria-label="Add property"/);
  assert.match(connections, /data-mn-connections-toggle="true"/);
  assert.match(connections, /aria-expanded=\{expanded\}/);
  assert.match(connections, /\{expanded && \(\s*<div id="mn-connections-panel"/);
});

test('editor chrome stays quiet while preserving accessible actions and live status', () => {
  const header = source('src/editor/EditorHeader.jsx');
  const assistance = source('src/features/assistance/ContextualAssistance.jsx');
  const outliner = source('src/editor/outliner/MnOutlinerView.jsx');
  const html = source('vispnote.html');

  // Save state is now a persistent status pill (dot + sentence-case word)
  // rather than text that only appears when something is wrong. It stays a
  // polite live region so it is announced without stealing focus.
  assert.match(header, /<DsStatusPill tone=\{SAVE_TONES\[saveStatus\] \|\| 'neutral'\}/);
  assert.match(header, /aria-live="polite"/);
  assert.match(header, /label=\{note\.pinned \? 'Unpin note' : 'Pin note'\}[\s\S]*iconOnly/);
  assert.match(header, /label="More note actions"[\s\S]*iconOnly/);
  assert.match(assistance, /aria-label=\{triggerLabel\}/);
  assert.match(outliner, /data-mn-add-block="true" aria-label="Add block"/);
  assert.doesNotMatch(outliner, /Click to add a new block · type \/ for commands/);
  assert.match(html, /\.mn-contextual-assistance-trigger-label \{ display: none; \}/);
});
