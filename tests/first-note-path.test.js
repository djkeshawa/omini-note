// The primary path: New note lands the caret in the title, gives the note a
// title that is not already taken, and hops from the title into the first
// block. Selecting an existing note must not move focus.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const MN_APP_MUTATIONS = require('../src/app/appMutations.js');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

// A title input that records what was done to it, so the unit tests can tell
// focus-only from focus-and-select without a DOM.
function fakeTitleInput() {
  const calls = [];
  return {
    calls,
    focus() { calls.push('focus'); },
    select() { calls.push('select'); },
  };
}

function fakeDocument(input) {
  const queried = [];
  return {
    queried,
    querySelector(selector) {
      queried.push(selector);
      return selector === '.mn-note-title-input' ? input : null;
    },
  };
}

// useAppNoteActions is a plain hook over injected callbacks, so it runs under a
// stub that treats useCallbackA as identity. Only createNote is exercised here.
function mountNoteActions({ document: doc } = {}) {
  const previousDocument = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const frames = [];
  // createNote reaches for the ambient document and rAF the way the renderer
  // does; stand both up for the life of the host, not just the module load.
  globalThis.document = doc || fakeDocument(null);
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  const restore = () => {
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRaf;
  };
  const { useAppNoteActions } = loadRendererModule('src/app/controllers/useAppNoteActions.js');
  const notesRef = { current: [] };
  const state = { notes: [], selectedId: null, view: null, features: [] };
  const actions = useAppNoteActions({
    MN_APP_HELPERS: {},
    MN_APP_MUTATIONS,
    MN_NOTE_TEMPLATES: [],
    aiNoteBodyRestoreRef: { current: new Map() },
    calendarTaskItems: [],
    cloneNoteForMetadataHistory: note => note,
    markDirty() {},
    markTagsDirty() {},
    mkBlock: () => ({ id: 'b1', kind: 'paragraph', content: '' }),
    mnBlocksToMd: () => '',
    mnEnsureScenePlotPoints: body => body,
    mnMdToBlocks: () => [],
    mnNormalizeNoteBody: body => body,
    mnNoteOrderValue: () => null,
    mnParseDefaultTags: () => [],
    navigateView: (next) => { state.view = next; },
    normalizeTagName: name => String(name || '').trim().toLowerCase(),
    noteMetadataHistoryRef: { current: { undo: [], redo: [], activeKey: null } },
    notes: state.notes,
    notesWithBody: state.notes,
    novelistStructure: {},
    recordFeatureUsage: (feature, action) => { state.features.push(`${feature}:${action}`); },
    recordNoteMetadataHistory() {},
    recordPhase5Metric() {},
    reminderCenterItems: [],
    selectedNote: null,
    setNotes: (updater) => {
      state.notes = typeof updater === 'function' ? updater(state.notes) : updater;
      notesRef.current = state.notes;
    },
    setQuery() {},
    setSelectedId: (id) => { state.selectedId = id; },
    setSelectedTag() {},
    setSelectedWorkflow() {},
    setTags() {},
    showAppNotice() {},
    tags: [],
    tweaks: { defaultTags: '' },
    notesRef,
    useCallbackA: fn => fn,
  });
  const runFrames = () => {
    // The wiring schedules a double rAF; drain whatever it queued.
    for (let depth = 0; depth < 4 && frames.length; depth += 1) {
      const queued = frames.splice(0, frames.length);
      queued.forEach(callback => callback());
    }
  };
  return { actions, state, notesRef, frames, runFrames, restore };
}

test('B1 focusNoteTitleInput selects the whole placeholder title', () => {
  const { focusNoteTitleInput } = loadRendererModule('src/features/editor/focusNoteTitle.js');
  const input = fakeTitleInput();
  const doc = fakeDocument(input);

  assert.equal(focusNoteTitleInput(doc), true);
  assert.deepEqual(doc.queried, ['.mn-note-title-input']);
  // Select-all, not caret-to-end: the title is the literal string "Untitled",
  // so a caret at the end would produce "Untitled 2ideas".
  assert.deepEqual(input.calls, ['focus', 'select']);
});

test('B1 focusNoteTitleInput can focus without selecting, and reports a miss', () => {
  const { focusNoteTitleInput } = loadRendererModule('src/features/editor/focusNoteTitle.js');
  const input = fakeTitleInput();

  assert.equal(focusNoteTitleInput(fakeDocument(input), { selectAll: false }), true);
  assert.deepEqual(input.calls, ['focus']);

  assert.equal(focusNoteTitleInput(fakeDocument(null)), false);
  assert.equal(focusNoteTitleInput(null), false);
  assert.equal(focusNoteTitleInput({}), false);
});

test('B1 creating and opening a note focuses its title input', (t) => {
  const input = fakeTitleInput();
  const doc = fakeDocument(input);
  const host = mountNoteActions({ document: doc });
  t.after(host.restore);

  const id = host.actions.createNote(undefined, { focusTitle: true });
  assert.equal(host.state.selectedId, id);
  assert.equal(host.state.view, 'notes');
  // Focus is deferred so React can commit and the editor can mount.
  assert.deepEqual(input.calls, []);
  host.runFrames();
  assert.deepEqual(input.calls, ['focus', 'select']);
});

// Focus is opt IN, not opt out. Every creation path other than "New note"
// supplies a title the user did not type — a template name, a captured line, a
// daily note's ISO date — and createDailyNote, addQuickTodayTask and
// appendToTodayDailyNote all MATCH on that date. Selecting it means the next
// keystroke replaces it and the matcher then builds a second, orphaned note.
// An opt-out default made every one of those paths steal the caret by omission.
test('B1 only an explicit opt-in takes the caret', (t) => {
  const closed = mountNoteActions({ document: fakeDocument(fakeTitleInput()) });
  t.after(closed.restore);
  closed.actions.createNote({ title: 'Imported' }, { open: false, focusTitle: true });
  closed.runFrames();
  assert.equal(closed.frames.length, 0, 'a note that never opens must not focus');
  assert.equal(closed.state.selectedId, null);

  const defaulted = mountNoteActions({ document: fakeDocument(fakeTitleInput()) });
  t.after(defaulted.restore);
  const id = defaulted.actions.createNote({ title: 'Template' });
  defaulted.runFrames();
  // It still opens, it just does not grab the caret.
  assert.equal(defaulted.state.selectedId, id);
  assert.equal(defaulted.frames.length, 0, 'the default must not focus');

  // The real regression: a daily note whose ISO-date title three other helpers
  // match on must survive being created and opened.
  const daily = mountNoteActions({ document: fakeDocument(fakeTitleInput()) });
  t.after(daily.restore);
  daily.actions.createDailyNote();
  daily.runFrames();
  assert.equal(daily.frames.length, 0, 'the daily note title was selected and is one keystroke from gone');
});

test('B1 negative: selecting an existing note moves selection, not focus', () => {
  const appView = readSource('src/app/AppView.jsx');
  const onSelect = appView.match(/onSelect=\{\(id\) => \{[\s\S]*?\n {18}\}\}/);
  assert.ok(onSelect, 'the note list onSelect handler should still be inline in AppView');
  const handler = onSelect[0];

  assert.match(handler, /setSelectedId\(id\)/);
  assert.doesNotMatch(handler, /focus/i);
  assert.doesNotMatch(handler, /select\(\)/);
  assert.doesNotMatch(handler, /requestAnimationFrame/);
  assert.doesNotMatch(handler, /mn-note-title-input/);
  // Nothing outside createNote may reach for the title input either.
  const noteActions = readSource('src/app/controllers/useAppNoteActions.js');
  assert.equal(noteActions.match(/focusNoteTitleInput\(/g).length, 1);
});

test('B2 the title-to-first-block hop selects by data attribute, not by style string', () => {
  const editor = readSource('src/editor/editor.jsx');
  const blockRowView = readSource('src/editor/outliner/BlockRowView.jsx');

  assert.match(editor, /first\.querySelector\('\[data-mn-block-content="display"\]'\)/);
  // The old selector matched an inline style string, which broke the moment the
  // style changed. Nothing in the editor may match it as a selector again.
  assert.doesNotMatch(editor, /cursor: text/);
  assert.match(editor, /setTimeout\(\(\) => \{[\s\S]*?ta\.focus\(\)[\s\S]*?\}, 30\)/);
  // The attribute the selector depends on has to actually be rendered.
  assert.match(blockRowView, /data-mn-block-content="display"/);
});

test('B3 consecutive new notes are Untitled, Untitled 2, Untitled 3', (t) => {
  const host = mountNoteActions();
  t.after(host.restore);

  host.actions.createNote();
  host.actions.createNote();
  host.actions.createNote();

  const titles = host.state.notes.map(note => note.title).reverse();
  assert.deepEqual(titles, ['Untitled', 'Untitled 2', 'Untitled 3']);
});

test('B3 an explicit title is still honoured verbatim', (t) => {
  const host = mountNoteActions();
  t.after(host.restore);

  host.actions.createNote({ title: 'Reading list' });
  host.actions.createNote();

  const titles = host.state.notes.map(note => note.title).reverse();
  assert.deepEqual(titles, ['Reading list', 'Untitled']);
});

test('B3 createNote reads notes through the ref, not through its deps', () => {
  const source = readSource('src/app/controllers/useAppNoteActions.js');
  const createNote = source.match(/const createNote = useCallbackA\([\s\S]*?\n {4}\}, \[[^\]]*\]\);/);
  assert.ok(createNote, 'createNote should still be a single useCallbackA block');

  assert.match(createNote[0], /uniqueNoteTitle\(notesRef\.current, 'Untitled'\)/);
  // Adding `notes` to the dependency array would rebuild createNote on every
  // keystroke and churn every consumer that holds it.
  const deps = createNote[0].match(/\[([^\]]*)\]\);$/)[1];
  assert.doesNotMatch(deps, /\bnotes\b/);
});

// The focus is deferred two frames so React can commit and the editor can
// mount. Within those two frames the user can already have pressed Assist,
// opened the palette or clicked a block — the electron regression caught
// exactly that, landing the caret in the note title while a menu was being
// driven. Grabbing focus back at that point is worse than never moving it.
test('B1 deferred focus yields to whatever the user focused meanwhile', () => {
  const { focusNoteTitleInput } = loadRendererModule('src/features/editor/focusNoteTitle.js');

  const input = fakeTitleInput();
  const busy = { ...fakeDocument(input), activeElement: { id: 'assist-menu-item' } };
  assert.equal(focusNoteTitleInput(busy), false, 'it stole focus from an element the user moved to');
  assert.deepEqual(input.calls, []);

  // An idle document is still waiting for the caret, however it reports idle.
  const body = {};
  for (const active of [null, undefined, body]) {
    const fresh = fakeTitleInput();
    const idle = { ...fakeDocument(fresh), body, activeElement: active };
    assert.equal(focusNoteTitleInput(idle), true);
    assert.deepEqual(fresh.calls, ['focus', 'select']);
  }

  // Re-entering on the title itself must not be treated as a steal.
  const again = fakeTitleInput();
  const onTitle = { ...fakeDocument(again), body, activeElement: again };
  assert.equal(focusNoteTitleInput(onTitle), true);
  assert.deepEqual(again.calls, ['focus', 'select']);
});
