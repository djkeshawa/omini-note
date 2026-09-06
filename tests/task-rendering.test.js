const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const load = file => loadRendererModule(file, { React });
const { MN_THEMES } = load('src/shared/theme.jsx');
const T = MN_THEMES.light;
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('note previews distinguish open and completed tasks', () => {
  const { MnNoteList } = load('src/panels/notelist.jsx');
  const html = render(MnNoteList, {
    notes: [{ id: 'n1', title: 'Tasks', body: '- [ ] Open task\n- [x] Finished task', tags: [], date: '2026-09-06' }],
    selectedId: 'n1', title: 'Notes', query: '', tags: [], theme: 'light', density: 'comfortable', T,
  });
  assert.match(html, /☐ Open task/);
  assert.match(html, /✓ Finished task/);
});

test('agenda checkboxes expose their actual checked state and a visible tick', () => {
  const { MnItemCard } = load('src/panels/calendarChrome.jsx');
  for (const checked of [false, true]) {
    const html = render(MnItemCard, {
      item: { key: 'task', checked, label: 'Review notes', noteTags: [] },
      ctx: { T, theme: 'light', tagHue: new Map(), notes: [], helpers: {}, onToggleCheck() {} },
    });
    assert.match(html, /role="checkbox"/);
    assert.match(html, new RegExp(`aria-checked="${checked}"`));
    if (checked) assert.match(html, /<svg[^>]*aria-hidden="true"/);
  }
});

test('a completed task in the Views table has a checkmark, not just a filled square', () => {
  const { mnViewsRenderTable } = load('src/features/views/ViewsTable.jsx');
  const html = renderToStaticMarkup(mnViewsRenderTable({
    results: [{ id: 't1', key: 't1', type: 'task', checked: true, label: 'Finished', noteId: 'n1' }],
    onToggleCheck() {}, T, theme: 'light',
  }));
  assert.match(html, /role="checkbox"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
});

test('Today counts visible open tasks even when they have no reminder', () => {
  const { MnTodayPanel } = load('src/features/today/components/TodayPanel.jsx');
  const tasks = [{ key: 'task', noteId: 'n1', text: 'Review draft', checked: false }];
  const html = render(MnTodayPanel, {
    tasks, T, theme: 'light',
    helpers: { rollupFilterTaskItems: () => tasks, todayIsoDate: () => '2026-09-06' },
  });
  assert.match(html, /1 thing wants your attention/);
  assert.doesNotMatch(html, /Nothing is waiting on you today/);
});
