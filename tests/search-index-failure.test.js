// A broken search index is a state, not an empty vault. When the IPC call
// fails the controller must fall back to the in-memory predicate (so results
// stay correct) and say so, and the note list must never claim "No notes
// match" for a failure it caused itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const searchModel = require('../src/features/search/searchModel.js');

const T = {
  accent: 'blue', accentSoft: '#eef', bg: 'white', bgElevated: 'white', bgHover: '#f0f0f0',
  bgSub: '#f5f5f5', danger: 'red', focus: 'indigo', ink: 'black', inkDim: '#777', inkMed: '#444',
  line: '#bbb', lineSub: '#ddd', selBg: '#eef', selLine: '#99f', success: 'green', warn: 'orange',
};

const NOTES = [
  { id: 'n1', title: 'Rebuild the index', body: 'notes on sqlite', tags: ['infra'], date: '2026-08-01T00:00:00.000Z', modifiedAt: '2026-08-01T00:00:00.000Z', pinned: false },
  { id: 'n2', title: 'Grocery list', body: 'apples and pears', tags: ['home'], date: '2026-08-02T00:00:00.000Z', modifiedAt: '2026-08-02T00:00:00.000Z', pinned: false },
  { id: 'n3', title: 'Reading', body: 'a note about SQLITE internals', tags: [], date: '2026-08-03T00:00:00.000Z', modifiedAt: '2026-08-03T00:00:00.000Z', pinned: false },
];

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

// A minimal hook runtime: real state cells, real dependency comparison, real
// effect cleanup. The shared rendererModule stub no-ops useEffect, which is
// exactly the code path under test here.
function hookHost(hookName, modulePath) {
  const cells = [];
  let cursor = 0;
  let dirty = false;
  let pending = [];
  const cellAt = () => {
    const index = cursor++;
    if (!cells[index]) cells[index] = {};
    return cells[index];
  };
  const React = {
    useState(initial) {
      const cell = cellAt();
      if (!('value' in cell)) cell.value = typeof initial === 'function' ? initial() : initial;
      return [cell.value, next => {
        const value = typeof next === 'function' ? next(cell.value) : next;
        if (Object.is(value, cell.value)) return;
        cell.value = value;
        dirty = true;
      }];
    },
    useRef(initial) {
      const cell = cellAt();
      if (!cell.ref) cell.ref = { current: initial };
      return cell.ref;
    },
    useMemo(factory, deps) {
      const cell = cellAt();
      if (!('memo' in cell) || !sameDeps(cell.deps, deps)) {
        cell.deps = deps;
        cell.memo = factory();
      }
      return cell.memo;
    },
    useCallback: value => value,
    useEffect(effect, deps) {
      const cell = cellAt();
      if ('deps' in cell && sameDeps(cell.deps, deps)) return;
      cell.deps = deps;
      pending.push(() => {
        if (typeof cell.cleanup === 'function') cell.cleanup();
        cell.cleanup = effect();
      });
    },
  };
  const hook = loadRendererModule(modulePath, { React })[hookName];
  let output = null;
  const renderOnce = props => {
    cursor = 0;
    pending = [];
    dirty = false;
    output = hook(props);
    pending.forEach(run => run());
    return output;
  };
  return {
    render(props) {
      let result = renderOnce(props);
      for (let pass = 0; pass < 10 && dirty; pass += 1) result = renderOnce(props);
      return result;
    },
    get output() { return output; },
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Everything the controller needs, with the search call swapped per test.
function controllerProps(search, query = 'sqlite') {
  return {
    query,
    activeVaultId: 'v1',
    notes: NOTES,
    dirtyNotes: new Map(),
    hasDisk: true,
    search,
    view: 'notes',
    selectedTag: null,
    selectedWorkflow: null,
    workflowData: { noteIdsByState: {} },
    tweaks: {},
    decorate: null,
  };
}

test('localSearchIds is the single predicate, matching title, body and tags', () => {
  assert.deepEqual(searchModel.localSearchIds(NOTES, 'sqlite'), ['n1', 'n3']);
  assert.deepEqual(searchModel.localSearchIds(NOTES, 'SQLite'), ['n1', 'n3']);
  assert.deepEqual(searchModel.localSearchIds(NOTES, 'infra'), ['n1']);
  assert.deepEqual(searchModel.localSearchIds(NOTES, 'pears'), ['n2']);
  assert.deepEqual(searchModel.localSearchIds(NOTES, 'nothing here'), []);
  assert.deepEqual(searchModel.localSearchIds(null, 'sqlite'), []);
});

test('localSearchIds accepts an injected text source so the cache stays behind it', () => {
  const seen = [];
  const ids = searchModel.localSearchIds(NOTES, 'grocery', note => {
    seen.push(note.id);
    return `${note.title}`.toLowerCase();
  });
  assert.deepEqual(ids, ['n2']);
  assert.deepEqual(seen, ['n1', 'n2', 'n3']);
});

test('searchOutcome separates a usable response from a broken index', () => {
  assert.equal(searchModel.searchOutcome({ ok: true, value: [] }), 'ok');
  assert.equal(searchModel.searchOutcome({ ok: false, error: 'no such table' }), 'index-unavailable');
  assert.equal(searchModel.searchOutcome(null), 'index-unavailable');
  assert.equal(searchModel.searchOutcome(undefined), 'index-unavailable');
});

test('searchModel keeps its existing exports and sort tweaks', () => {
  assert.equal(typeof searchModel.filterAndSortNotes, 'function');
  assert.equal(typeof searchModel.decorateSearchResults, 'function');
  const source = readSource('src/features/search/searchModel.js');
  assert.match(source, /tweaks\.sortBy/);
  assert.match(source, /tweaks\.pinnedFirst/);
});

test('B4 a rejected search still returns the right notes, flagged as index-unavailable', async () => {
  const errors = [];
  const restoreError = console.error;
  console.error = (...args) => errors.push(args[0]);
  try {
    const host = hookHost('useSearchController', 'src/features/search/useSearchController.js');
    const props = controllerProps(async () => { throw new Error('database disk image is malformed'); });

    host.render(props);
    await wait(220);
    const result = host.render(props);

    // Correct results, not an empty list.
    assert.deepEqual(result.filteredNotes.map(note => note.id), ['n1', 'n3']);
    assert.equal(result.searchStatus, 'index-unavailable');
    assert.deepEqual(errors, ['search failed']);
  } finally {
    console.error = restoreError;
  }
});

test('B4 an ok:false response falls back the same way', async () => {
  const restoreError = console.error;
  console.error = () => {};
  try {
    const host = hookHost('useSearchController', 'src/features/search/useSearchController.js');
    const props = controllerProps(async () => ({ ok: false, error: 'no such table: notes_fts' }));

    host.render(props);
    await wait(220);
    const result = host.render(props);

    assert.deepEqual(result.filteredNotes.map(note => note.id), ['n1', 'n3']);
    assert.equal(result.searchStatus, 'index-unavailable');
  } finally {
    console.error = restoreError;
  }
});

test('B4 a healthy search reports ok and uses the index ordering', async () => {
  const host = hookHost('useSearchController', 'src/features/search/useSearchController.js');
  const props = controllerProps(async () => ({ ok: true, value: [{ id: 'n3' }, { id: 'n1' }] }));

  host.render(props);
  await wait(220);
  const result = host.render(props);

  assert.deepEqual(result.filteredNotes.map(note => note.id), ['n3', 'n1']);
  assert.equal(result.searchStatus, 'ok');
});

test('B4 index failure is a different state from having no query at all', async () => {
  const host = hookHost('useSearchController', 'src/features/search/useSearchController.js');
  const props = controllerProps(async () => ({ ok: false, error: 'boom' }), '');

  const result = host.render(props);
  await wait(220);

  // No query: every note, and idle — not "index-unavailable".
  assert.equal(result.searchStatus, 'idle');
  assert.equal(result.filteredNotes.length, NOTES.length);
});

test('B4 the controller keeps the guards and the deliberate dependency comment', () => {
  const source = readSource('src/features/search/useSearchController.js');
  assert.match(source, /const sequence = useRef\(0\)/);
  assert.match(source, /if \(requestId !== sequence\.current\) return/);
  assert.match(source, /filterAndSortNotes/);
  assert.equal(source.match(/console\.error\('search failed'/g).length, 2);
  assert.match(source, /notes and dirtyNotes stay in the deps deliberately/);
  assert.match(source, /return \{ filteredNotes, searchStatus \}/);
  // One predicate, not two copies of it.
  assert.match(source, /localSearchIds/);
  assert.doesNotMatch(source, /\.map\(note => note\.id\)/);
});

// ── The UI half ────────────────────────────────────────────────────────────

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

// createElement stores children both positionally and on props, so walk only
// the positional ones or every node is counted once per level of depth.
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

function renderEmptyState(props) {
  const { NoteListEmptyState } = loadRendererModule('src/features/search/NoteListEmptyState.jsx', { React: executingReact() });
  return jsxText(NoteListEmptyState({ T, onQueryChange() {}, onCreateNote() {}, ...props })).join(' ');
}

test('B4 the empty state never says "No notes match" while the index is unavailable', () => {
  const text = renderEmptyState({ query: 'sqlite', searchStatus: 'index-unavailable' });

  assert.match(text, /Search index unavailable/);
  assert.match(text, /Nothing in your open notes matches “sqlite”/);
  assert.match(text, /Results are limited until the index is rebuilt/);
  assert.match(text, /Clear search/);
  // This is the lie the whole item exists to kill.
  assert.doesNotMatch(text, /No notes match/);
  // Rebuild lives in settings; a second action here would break the one-primary rule.
  assert.doesNotMatch(text, /Rebuild/);
});

test('B4 the other two zero-states are unchanged', () => {
  const noMatch = renderEmptyState({ query: 'sqlite', searchStatus: 'ok' });
  assert.match(noMatch, /No notes match “sqlite”/);
  assert.match(noMatch, /Search covers titles, body text and tags in this vault only\./);
  assert.match(noMatch, /Clear search/);

  const emptyVault = renderEmptyState({ query: '', searchStatus: 'idle' });
  assert.match(emptyVault, /No notes yet/);
  assert.match(emptyVault, /Notes are markdown files on disk\./);
  assert.match(emptyVault, /New note/);
  assert.doesNotMatch(emptyVault, /No notes match/);
  assert.doesNotMatch(emptyVault, /Search index unavailable/);
});

test('B4 an empty vault stays an empty vault even if a stale failure flag lingers', () => {
  const text = renderEmptyState({ query: '', searchStatus: 'index-unavailable' });
  assert.match(text, /No notes yet/);
  assert.doesNotMatch(text, /Search index unavailable/);
});

test('B4 the note list shows the degraded strip above the rows, and owns no copy of the zero-states', () => {
  const notelist = readSource('src/panels/notelist.jsx');
  const listbox = notelist.slice(notelist.indexOf('<div role="listbox"'));

  // Imported through the feature's public entry point, as check-architecture requires.
  assert.match(notelist, /import \{ NoteListEmptyState \} from '\.\.\/features\/search\/index\.js'/);
  assert.match(notelist, /searchStatus = 'idle'/);
  // The strip is the first thing inside the listbox, above the date groups.
  const stripIndex = listbox.indexOf('data-mn-search-degraded="true"');
  const groupsIndex = listbox.indexOf('novelistList ?');
  assert.ok(stripIndex > 0 && stripIndex < groupsIndex, 'the degraded strip should precede the note groups');
  assert.match(listbox, /searchStatus === 'index-unavailable' && \(/);
  assert.match(listbox, /role="status"/);
  assert.match(listbox, /dsStatusDotStyle\(T, 'warn'\)/);
  assert.match(listbox, /Search index unavailable — showing matches from open notes\./);
  // Not focusable, no controls, no dismiss: it must not enter the tab order.
  assert.doesNotMatch(listbox.slice(stripIndex, groupsIndex), /tabIndex|<button/);
  // The zero-states moved out wholesale rather than being half-copied.
  assert.doesNotMatch(notelist, /No notes match/);
  assert.doesNotMatch(notelist, /No notes yet/);
});

test('B4 searchStatus is threaded from the controller to the list', () => {
  const app = readSource('src/app/app.jsx');
  const appView = readSource('src/app/AppView.jsx');

  assert.match(app, /const \{ filteredNotes, searchStatus \} = useSearchController\(\{/);
  assert.match(app, /filteredNotes, findNotesForVault/);
  assert.match(app, /searchStatus,/);
  assert.match(appView, /searchStatus,/);
  assert.match(appView, /searchStatus=\{searchStatus\}/);
});
