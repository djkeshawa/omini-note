const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');
const appHelpers = require('../src/app/appHelpers.js');

const T = {
  accent: 'blue', bg: 'white', bgSub: '#f5f5f5', ink: 'black', inkDim: '#777',
  inkMed: '#444', line: '#bbb', lineSub: '#ddd', selBg: '#eef', selLine: '#99f',
};

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

function jsxNodes(node, predicate, out = []) {
  if (Array.isArray(node)) {
    node.forEach(child => jsxNodes(child, predicate, out));
  } else if (node && typeof node === 'object' && Array.isArray(node.jsx)) {
    if (predicate(node)) out.push(node);
    node.jsx.slice(2).forEach(child => jsxNodes(child, predicate, out));
  }
  return out;
}

function executingReact() {
  const React = {
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
  return React;
}

test('the shared tag hue map treats prototype names as ordinary tag names', () => {
  const { mnTagHueMap } = loadRendererModule('src/shared/theme.jsx');
  const hues = mnTagHueMap([
    { name: 'constructor', hue: 12 },
    { name: '__proto__', hue: 48 },
    { name: 'work', hue: 210 },
  ]);

  assert.equal(hues.get('constructor'), 12);
  assert.equal(hues.get('__proto__'), 48);
  assert.equal(hues.get('work'), 210);
  assert.equal(hues.get('toString'), undefined);
  assert.equal(hues.get('hasOwnProperty'), undefined);

  const owners = [
    'src/editor/editor.jsx',
    'src/panels/notelist.jsx',
    'src/panels/todosPanel.jsx',
    'src/panels/calendarPanel.jsx',
    'src/features/today/components/TodayPanel.jsx',
    'src/features/workflow/WorkflowPanel.jsx',
    'src/panels/graph.jsx',
  ];
  owners.forEach(file => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, /mnTagHueMap\(tags\)/, `${file} uses the shared lookup`);
  });
  const consumers = owners.concat([
    'src/panels/calendarChrome.jsx',
    'src/features/workflow/WorkflowBoardParts.jsx',
    'src/features/workflow/WorkflowTable.jsx',
  ]);
  consumers.forEach(file => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /\btagHue\s*\[/, `${file} does not index a prototype-bearing object`);
  });
});

test('sidebar counts tags whose names collide with Object.prototype', () => {
  const { mnSidebarTagCounts } = loadRendererModule('src/panels/sidebarModel.js');
  const tags = ['__proto__', 'constructor', 'toString'];
  const counts = mnSidebarTagCounts(
    tags.map((name, hue) => ({ name, hue })),
    [
      { tags: ['__proto__', 'constructor'] },
      { tags: ['__proto__', 'toString'] },
    ]
  );

  assert.ok(counts instanceof Map);
  assert.equal(counts.get('__proto__'), 2);
  assert.equal(counts.get('constructor'), 1);
  assert.equal(counts.get('toString'), 1);
});

test('the Novelist note list renders relationship ids that match prototype names', () => {
  const { MnNoteList } = loadRendererModule('src/panels/notelist.jsx');
  for (const actId of ['constructor', '__proto__', 'toString']) {
    const notes = [
      { id: actId, title: `Act ${actId}`, tags: ['novel-act'], body: '', date: '2026-08-01T00:00:00Z' },
      { id: 'chapter', title: 'Chapter', tags: ['novel-chapter'], body: `act:: [[Act ${actId}]]`, date: '2026-08-01T00:00:00Z' },
    ];
    const novelistStructure = appHelpers.buildNovelistStructure(notes);
    assert.doesNotThrow(() => MnNoteList({
      notes,
      allNotes: notes,
      novelistStructure,
      selectedId: '',
      onSelect() {},
      title: 'Notes',
      subtitle: '',
      query: '',
      onQueryChange() {},
      tags: [],
      theme: 'light',
      density: 'compact',
      T,
    }), actId);
  }
});

test('Views table caches hostile property keys and puts aria-sort on the column header', () => {
  const React = executingReact();
  const table = loadRendererModule('src/features/views/ViewsTable.jsx', { React });
  const columnsApi = loadRendererModule('src/features/views/viewsColumns.js');
  let propertyReads = 0;
  const helpers = {
    bodyPropertyValue(body, key) {
      propertyReads += 1;
      return key === '__proto__' ? body : '';
    },
  };
  const definition = { type: 'notes', columns: ['__proto__'] };
  const columns = columnsApi.mnViewsColumns(definition);
  const results = [
    { id: 'b', key: 'b', title: 'Beta', note: { body: 'zulu' } },
    { id: 'a', key: 'a', title: 'Alpha', note: { body: 'alpha' } },
  ];
  const prepared = table.mnViewsPrepareRows(results, columns, helpers);
  assert.ok(prepared.every(row => row.__cells instanceof Map));
  assert.deepEqual(
    columnsApi.mnViewsSortResults(prepared, columns, { key: '__proto__', direction: 'asc' }).map(row => row.id),
    ['a', 'b']
  );

  propertyReads = 0;
  const rendered = table.mnViewsRenderTable({
    results,
    definition,
    sort: { key: '__proto__', direction: 'asc' },
    helpers,
    T,
  });
  assert.equal(propertyReads, 2, 'each property cell is read once and reused for sorting and display');
  assert.equal(rendered.jsx[1].role, 'table');

  const sortedHeaders = jsxNodes(rendered, node => node.jsx[1]?.['aria-sort'] === 'ascending');
  assert.equal(sortedHeaders.length, 1);
  assert.equal(sortedHeaders[0].jsx[1].role, 'columnheader');
  const sortButtons = jsxNodes(sortedHeaders[0], node => node.jsx[1]?.['aria-label'] === 'Sort by __proto__');
  assert.equal(sortButtons.length, 1);
  assert.equal(sortButtons[0].jsx[1]['aria-sort'], undefined, 'aria-sort belongs to the columnheader');

  const rows = jsxNodes(rendered, node => node.jsx[1]?.['data-mn-view-row'] === 'true');
  assert.deepEqual(rows.map(row => jsxText(row).find(text => text === 'Alpha' || text === 'Beta')), ['Alpha', 'Beta']);
});

test('Views calendar defaults hostile weekStart values to the Monday layout', () => {
  const { mnViewsRenderCalendar } = loadRendererModule('src/features/views/ViewsCalendar.jsx');
  const renderLabels = weekStart => {
    const rendered = mnViewsRenderCalendar({
      results: [],
      helpers: {},
      weekStart,
      anchor: new Date('2026-08-01T12:00:00Z'),
      T,
    });
    return jsxText(rendered).filter(text => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(text));
  };

  for (const weekStart of ['constructor', '__proto__', 'toString', 'nonsense']) {
    assert.deepEqual(renderLabels(weekStart), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  }
  assert.deepEqual(renderLabels('sunday'), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
});
