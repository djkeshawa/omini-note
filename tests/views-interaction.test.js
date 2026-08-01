const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const T = {
  accent: 'blue', accentSoft: '#eef', bg: 'white', bgElevated: 'white', bgHover: '#f0f0f0',
  bgSub: '#f5f5f5', danger: 'red', focus: 'indigo', ink: 'black', inkDim: '#777', inkMed: '#444',
  line: '#bbb', lineSub: '#ddd', selBg: '#eef', selLine: '#99f', success: 'green', warn: 'orange',
};

function executingReact() {
  return {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const nextProps = { ...(props || {}) };
      if (children.length) nextProps.children = children.length === 1 ? children[0] : children;
      if (typeof type === 'function') return type(nextProps);
      return { jsx: [type, nextProps, ...children] };
    },
    memo: value => value,
    useCallback: value => value,
    useEffect() {},
    useLayoutEffect() {},
    useMemo: value => value(),
    useRef: value => ({ current: value }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
  };
}

// createElement stores children twice — positionally and on props — so the walk
// reads only the positional ones or every node is counted as many times as it
// is deep.
function jsxNodes(node, predicate, out = []) {
  if (Array.isArray(node)) {
    node.forEach(child => jsxNodes(child, predicate, out));
  } else if (node && typeof node === 'object' && Array.isArray(node.jsx)) {
    if (predicate(node)) out.push(node);
    node.jsx.slice(2).forEach(child => jsxNodes(child, predicate, out));
  }
  return out;
}

function jsxText(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(child => jsxText(child, out));
  } else if (node && typeof node === 'object' && Array.isArray(node.jsx)) {
    node.jsx.slice(2).forEach(child => jsxText(child, out));
  } else if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
  }
  return out;
}

const noteRow = { type: 'note', id: 'n1', key: 'n1', noteId: 'n1', title: 'Alpha', tags: ['design'], note: { id: 'n1', body: 'alpha' } };
const taskRow = {
  type: 'task', id: 't1', key: 't1', noteId: 'n2', title: 'Ship it', label: 'Ship it',
  text: 'Ship it', checked: false, status: 'open', noteTags: ['ship'],
  sourceNoteTitle: 'Work log', source: { noteId: 'n2', blockId: 'b1', text: 'Ship it' },
};

test('a row wears its first registered tag colour, and its kind when it has none', () => {
  const { mnViewsRowHue } = loadRendererModule('src/features/views/viewsHue.js');
  const tagHue = new Map([['design', 280]]);
  const tagged = mnViewsRowHue(noteRow, { tagHue, theme: 'light', T });
  assert.notEqual(tagged, T.accent, 'a tag with a hue must not fall through to the kind tone');

  // A tag the vault does not know has no colour of its own; inventing one would
  // paint two unrelated cards the same.
  assert.equal(mnViewsRowHue({ ...noteRow, tags: ['unregistered'] }, { tagHue, theme: 'light', T }), T.accent);
  assert.equal(mnViewsRowHue({ type: 'task', checked: true, status: 'completed' }, { T }), T.success);
  assert.equal(mnViewsRowHue({ type: 'reminder', status: 'reminder' }, { T }), T.focus);
  assert.equal(mnViewsRowHue({ type: 'task', status: 'deferred', deferred: true }, { T }), T.warn);
});

test('a hand-made card arrangement keeps new rows in query order behind it', () => {
  const { mnViewsOrderApply, mnViewsOrderMove, mnViewsOrderIsSet } = loadRendererModule('src/features/views/viewsOrder.js');
  const rows = ['a', 'b', 'c'].map(key => ({ key, id: key }));
  assert.deepEqual(mnViewsOrderApply(rows, null).map(row => row.key), ['a', 'b', 'c']);

  const moved = mnViewsOrderMove(null, rows, 'c', 'a', true);
  assert.deepEqual(moved, ['c', 'a', 'b'], 'the first drag pins every visible row, not only the one dragged');
  assert.deepEqual(mnViewsOrderApply(rows, moved).map(row => row.key), ['c', 'a', 'b']);

  // A note written since the arrangement was made keeps its query position at
  // the end rather than jumping to the front or vanishing.
  const withNew = [...rows, { key: 'd', id: 'd' }];
  assert.deepEqual(mnViewsOrderApply(withNew, moved).map(row => row.key), ['c', 'a', 'b', 'd']);

  assert.deepEqual(mnViewsOrderMove(moved, rows, 'c', 'c', true), moved, 'dropping a card on itself changes nothing');
  assert.deepEqual(mnViewsOrderMove(moved, rows, 'zz', 'a', true), moved, 'a key that is not on screen is ignored');
  assert.equal(mnViewsOrderIsSet(moved, rows), true);
  assert.equal(mnViewsOrderIsSet(moved, [{ key: 'z' }]), false, 'an arrangement of rows that all stopped matching is not in force');
  assert.equal(mnViewsOrderIsSet(null, rows), false);
});

test('a board column can only be dropped into when the grouping is one value on a note', () => {
  const { mnViewsBoardWritableKey } = loadRendererModule('src/features/views/ViewsBoard.jsx');
  assert.equal(mnViewsBoardWritableKey({}), 'status', 'the default grouping is the one the workflow board writes');
  assert.equal(mnViewsBoardWritableKey({ group: { by: 'stage' } }), 'stage');
  // A note carries a list of tags and its dates are worked out from the file,
  // so neither has a single value a drop could set.
  assert.equal(mnViewsBoardWritableKey({ group: { by: 'tag' } }), '');
  assert.equal(mnViewsBoardWritableKey({ group: { by: 'modified' } }), '');
  assert.equal(mnViewsBoardWritableKey({ group: { by: 'Reminder' } }), '');
});

test('a board keeps drawing a column after its last card moves away', () => {
  const { mnViewsBoardColumns } = loadRendererModule('src/features/views/ViewsBoard.jsx');
  const groups = [
    { key: 'doing', label: 'doing', items: [{ id: 'a' }, { id: 'b' }] },
    { key: '', label: 'No status', items: [] },
  ];
  const columns = mnViewsBoardColumns(groups, ['review', 'doing']);
  assert.deepEqual(columns.map(bucket => bucket.key), ['doing', 'review', ''],
    'the emptied remembered column sorts in among the live ones, unfiled stays last');
  assert.deepEqual(columns[1].items, [], 'a remembered column returns empty, not stale cards');
  assert.deepEqual(
    mnViewsBoardColumns(groups, ['review'], 'desc').map(bucket => bucket.key),
    ['review', 'doing', ''],
    'remembered columns follow the group direction'
  );
  assert.deepEqual(mnViewsBoardColumns(groups, []).map(bucket => bucket.key), ['doing', ''],
    'nothing remembered means exactly the live buckets');
});

test('keys aimed at a nested control are not hijacked by the row around it', () => {
  const { mnViewsRenderList } = loadRendererModule('src/features/views/ViewsList.jsx', { React: executingReact() });
  let opened = 0;
  const rendered = mnViewsRenderList({
    results: [taskRow], helpers: {}, onOpen: () => { opened += 1; },
    onToggleCheck: () => {}, tagHue: new Map(), theme: 'light', T,
  });
  const row = jsxNodes(rendered, node => node.jsx[1]?.['data-mn-view-row'] === 'true')[0];
  const onKeyDown = row.jsx[1].onKeyDown;
  const rowEl = {};
  const checkboxEl = {};
  // Enter bubbling up from the checkbox is the checkbox's activation.
  onKeyDown({ key: 'Enter', target: checkboxEl, currentTarget: rowEl, preventDefault() {} });
  assert.equal(opened, 0, 'a key aimed at a nested control must not open the note');
  onKeyDown({ key: 'Enter', target: rowEl, currentTarget: rowEl, preventDefault() {} });
  assert.equal(opened, 1, 'a key aimed at the row itself still opens it');
});

test('the schedule placeholder advertises a phrase the parser accepts', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/features/views/ViewsCalendarEditor.jsx'), 'utf8');
  const match = editor.match(/try “([^”]+)”/);
  assert.ok(match, 'the create form suggests an example phrase');
  const helpers = loadRendererModule('src/app/appHelpers.js');
  const parsed = helpers.agendaParseScheduleInput(match[1]);
  assert.equal(parsed?.ok, true, `the advertised example "${match[1]}" must parse: ${parsed?.error || ''}`);
});

test('every gesture on a row resolves to a write in the note it came from', () => {
  const { useViewsRowActions } = loadRendererModule('src/features/views/useViewsRowActions.js');
  const notes = [{ id: 'n1', title: 'Alpha', blocks: [] }, { id: 'n2', title: 'Work log', blocks: [] }];
  const calls = { task: [], rename: [], property: [], notice: [] };
  const actions = useViewsRowActions({
    notes,
    onUpdateTaskItem: (item, patch) => { calls.task.push([item, patch]); return true; },
    onRenameNote: (id, title) => calls.rename.push([id, title]),
    onSetProperty: (id, key, value) => calls.property.push([id, key, value]),
    onNotice: (headline, body, tone) => calls.notice.push([headline, tone]),
  });

  actions.toggleCheck(taskRow);
  assert.deepEqual(calls.task[0][1], { checked: true });
  assert.equal(calls.task[0][0].blockId, 'b1', 'the write lands on the block the row was parsed out of');

  // A note row's title is the note's title, so it goes through the app rename
  // that carries wiki links with it — not through a line-level write.
  actions.renameRow(noteRow, 'Alpha renamed');
  assert.deepEqual(calls.rename, [['n1', 'Alpha renamed']]);
  actions.renameRow(taskRow, 'Ship it later');
  assert.deepEqual(calls.task[1][1], { text: 'Ship it later' });

  actions.moveCard(taskRow, 'doing', 'status');
  assert.deepEqual(calls.property, [['n2', 'status', 'doing']]);
  actions.moveCard(taskRow, '', 'status');
  assert.deepEqual(calls.property[1], ['n2', 'status', ''], 'the unfiled column removes the line rather than writing an empty one');

  // Refusals explain themselves instead of writing something arbitrary.
  assert.equal(actions.moveCard(taskRow, 'x', ''), false);
  assert.equal(calls.notice.length, 1);
  assert.equal(calls.notice[0][1], 'info');
});

test('a row whose anchor is gone and whose text is not unique refuses rather than guessing', () => {
  const { useViewsRowActions } = loadRendererModule('src/features/views/useViewsRowActions.js');
  const notes = [{ id: 'n2', title: 'Work log', blocks: [{ id: 'b1', content: 'Ship it' }, { id: 'b2', content: 'Ship it' }] }];
  const notices = [];
  let wrote = 0;
  const actions = useViewsRowActions({
    notes,
    walk: (blocks, visit) => (blocks || []).forEach(visit),
    onUpdateTaskItem: () => { wrote += 1; return true; },
    onNotice: (headline, body) => notices.push(body),
  });
  const orphan = { ...taskRow, source: { noteId: 'n2', text: 'Ship it' } };
  assert.equal(actions.toggleCheck(orphan), false);
  assert.equal(wrote, 0);
  assert.match(notices[0], /more than once/);
});

test('the source line is printed only when it is news', () => {
  const { mnViewsRowSource } = loadRendererModule('src/features/views/ViewsCardParts.jsx');
  assert.equal(mnViewsRowSource(noteRow), '', 'a note row is its own source, so naming it labels nothing');
  assert.equal(mnViewsRowSource(taskRow), 'Work log');
});

test('a Views card opens from its hue bar, not from a solid button', () => {
  const { mnViewsRenderCards } = loadRendererModule('src/features/views/ViewsCards.jsx', { React: executingReact() });
  const rendered = mnViewsRenderCards({
    results: [noteRow, taskRow],
    helpers: {},
    onOpen: () => {},
    onRename: () => {},
    onReorder: () => {},
    tagHue: new Map([['design', 280]]),
    theme: 'light',
    T,
  });

  const cards = jsxNodes(rendered, node => node.jsx[1]?.['data-mn-view-row'] === 'true');
  assert.equal(cards.length, 2, 'every card counts as a row, so the row search and its count still add up');
  assert.equal(cards[0].jsx[1].className, 'mn-view-card');
  assert.equal(cards[0].jsx[1].draggable, true, 'a card is arrangeable when the panel offers a reorder handler');
  assert.equal(typeof cards[0].jsx[1].onClick, 'function', 'clicking the space in a card is the small edit');

  const bars = jsxNodes(rendered, node => node.jsx[1]?.className === 'mn-view-card-bar');
  assert.equal(bars.length, 2, 'each card carries its own bar');

  const opens = jsxNodes(rendered, node => String(node.jsx[1]?.['aria-label'] || '').startsWith('Open '));
  assert.equal(opens.length, 2);
  assert.ok(!jsxText(rendered).includes('Open'), 'the solid Open button is gone; opening is an indication in the bar');
});

test('the Views hover reveal is a stylesheet rule, not a re-render per card', () => {
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');
  // A view can hold hundreds of cards. Hover state in React would re-render one
  // on every pointer enter and leave to show a strip already in the DOM.
  assert.match(html, /\.mn-view-card-bar \{ opacity: 0;/);
  assert.match(html, /\.mn-view-card:hover \.mn-view-card-bar,\s*\n\s*\.mn-view-card:focus-within \.mn-view-card-bar \{ opacity: 1; \}/);
  assert.match(html, /\.mn-view-row:hover \.mn-view-mark/);
  assert.match(html, /\.mn-view-row:focus-within \.mn-view-mark/);

  const cards = fs.readFileSync(path.join(__dirname, '../src/features/views/ViewsCards.jsx'), 'utf8');
  const parts = fs.readFileSync(path.join(__dirname, '../src/features/views/ViewsCardParts.jsx'), 'utf8');
  assert.doesNotMatch(cards, /onMouseEnter|onMouseLeave/);
  assert.doesNotMatch(parts, /onMouseEnter|onMouseLeave/);
});

test('a note chip opens a rename editor, not a date form it can only refuse', () => {
  const { ViewsCalendarEditor } = loadRendererModule('src/features/views/ViewsCalendarEditor.jsx', { React: executingReact() });
  const plan = {
    enabled: true, createOpen: false, error: '', canSnooze: false, snoozeMinutes: 15,
    draftText: 'Alpha', draftDate: '', draftTime: '', draftWhen: '',
    setActiveKey() {}, setDraftText() {}, setDraftDate() {}, setDraftTime() {}, setDraftWhen() {},
    saveActive() {}, clearActiveDate() {}, toggleActive() {}, snoozeActive() {}, applyDraftWhen() {},
  };
  const noteEditor = executingReact().createElement(ViewsCalendarEditor, {
    plan: { ...plan, activeRow: noteRow, activeIsNote: true }, onOpen: () => {}, T,
  });
  const noteInputs = jsxNodes(noteEditor, node => node.jsx[0] === 'input').map(node => node.jsx[1]['aria-label']);
  assert.deepEqual(noteInputs, ['Row text'], 'a note has no writable date, so no date controls are drawn');
  const noteText = jsxText(noteEditor).join(' ');
  assert.match(noteText, /Saving renames it/, 'the editor says what Save does to a note');
  assert.ok(!noteText.includes('Clear date'), 'nothing offers to clear a date a note does not carry');

  const taskEditor = executingReact().createElement(ViewsCalendarEditor, {
    plan: { ...plan, activeRow: taskRow, activeIsNote: false, draftDate: '2026-08-02' }, onOpen: () => {}, T,
  });
  const taskInputs = jsxNodes(taskEditor, node => node.jsx[0] === 'input').map(node => node.jsx[1]['aria-label']);
  assert.deepEqual(taskInputs, ['Row text', 'Edit schedule phrase', 'Row date', 'Row time']);
  assert.ok(jsxText(taskEditor).includes('Clear date'));
});

test('a note row saves through the app rename, and a fresh note takes its item one render later', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/views/useViewsPlanner.js'), 'utf8');
  // A note row's Save must never reach the line-write: there is no line, so
  // writeRow could only ever refuse with a sentence about a different problem.
  assert.match(source, /if \(activeIsNote\) \{\s*\n\s*if \(onRenameRow\?\.\(activeRow, text\) !== false\) setError\(''\);\s*\n\s*return;/);
  // "New note for this item" defers the write: the note is not in `notes`
  // until the next render, and writing in the same tick found nothing, said
  // false, and dropped the item while keeping the stray note.
  assert.match(source, /setPendingItem\(\{ \.\.\.item, noteId \}\)/);
  assert.match(source, /if \(!\(notes \|\| \[\]\)\.some\(note => note\.id === pendingItem\.noteId\)\) return;/);
  const panel = fs.readFileSync(path.join(__dirname, '../src/features/views/ViewsPanel.jsx'), 'utf8');
  assert.match(panel, /onRenameRow: canRename/);
});

test('the Views calendar plans through the same actions the agenda writes through', () => {
  const view = fs.readFileSync(path.join(__dirname, '../src/app/AppView.jsx'), 'utf8');
  const planning = fs.readFileSync(path.join(__dirname, '../src/app/controllers/useAppPlanningActions.js'), 'utf8');
  assert.match(view, /onCreateItem=\{createCalendarTaskItem\}/);
  assert.match(view, /onUpdateTaskItem=\{updateTaskItemSource\}/);
  assert.match(view, /onRenameNote=\{renameNoteTitle\}/);
  assert.match(view, /onSetProperty=\{updateNoteProperty\}/);
  // The board's drop writes one property line; grouped by status that is the
  // very line the workflow board writes.
  assert.match(planning, /const updateNoteProperty = useCallbackA\(\(noteId, key, value\) => \{/);
  assert.match(planning, /mnSetBodyProperty\(body, cleanKey, cleanValue\)/);
  assert.match(planning, /mnRemoveBodyProperty\(body, cleanKey\)/);
});

test('the new Views capabilities have regression coverage that drives them', () => {
  const harness = fs.readFileSync(path.join(__dirname, '../scripts/regression-electron.js'), 'utf8');
  assert.match(harness, /a views card carries a hue open mark and a hover bar/);
  assert.match(harness, /commitViewsInlineTitle\(win, 'Rename QE Views Card Note', 'QE Views Renamed Card'\)/);
  // The drag is asserted by the note on disk, not by the pixel it moved.
  assert.match(harness, /dragViewsCardToColumn\(win, 'QE Views Property Note', 'doing'\)/);
  assert.match(harness, /status::\\s\*doing/);
  assert.match(harness, /qe views calendar todo @remind/);
  assert.match(harness, /picking a calendar chip opens the row editor/);
  // The two calendar-editor bugs stay fixed: a note chip renames rather than
  // refusing, and an item bound for a brand-new note lands one render later.
  assert.match(harness, /a note chip opens a rename editor, not a date form/);
  assert.match(harness, /qe views planner fresh note @remind/);
  // Review findings stay fixed: an emptied column survives, and a key aimed
  // at a nested control is not hijacked by the row around it.
  assert.match(harness, /the emptied review column stays on screen/);
  assert.match(harness, /views panel survives keyboard on the checkbox/);
  // Each drag event waits for what the previous one made visible, because they
  // depend on state React has not re-rendered yet.
  assert.match(harness, /views board card \$\{cardText\} picks up/);
  assert.match(harness, /views board column \$\{columnKey\} offers the drop/);
});
