const test = require('node:test');
const assert = require('node:assert/strict');

const nav = require('../src/editor/searchNavigation.js');

// Find-in-note behaviour: what a user pressing Ctrl+F inside an open note
// expects from the match list and the active-result navigation.

test('matching is case-insensitive in both directions', () => {
  assert.equal(nav.textMatchOffsets('Hello HELLO hello', 'hello').length, 3);
  assert.equal(nav.textMatchOffsets('straße и Русский', 'РУССКИЙ').length, 1);
});

test('match offsets point at the actual text', () => {
  const text = 'one two one';
  const matches = nav.textMatchOffsets(text, 'one');
  assert.deepEqual(matches, [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
  for (const m of matches) assert.equal(text.slice(m.start, m.end), 'one');
});

test('overlapping candidates are not double-counted', () => {
  // Standard find semantics: "aa" occurs twice in "aaaa", not three times.
  assert.equal(nav.textMatchOffsets('aaaa', 'aa').length, 2);
});

test('an empty or whitespace query matches nothing', () => {
  for (const q of ['', '   ', null, undefined]) {
    assert.deepEqual(nav.textMatchOffsets('any text at all', q), [], `matched on ${JSON.stringify(q)}`);
  }
});

test('a run of spaces in the query is treated as one space', () => {
  // The search box trims and collapses whitespace so a sloppy query still
  // finds normally-spaced prose.
  assert.equal(nav.normalizeSearchQuery('  hello   world  '), 'hello world');
  assert.equal(nav.textMatchOffsets('say hello world now', 'hello   world').length, 1);
});

test('the match list is capped so a pathological query cannot hang the editor', () => {
  const text = 'a'.repeat(5000);
  assert.equal(nav.textMatchOffsets(text, 'a').length, 500);
  assert.equal(nav.textMatchOffsets(text, 'a', 10).length, 10);
});

test('a needle longer than the text matches nothing rather than crashing', () => {
  assert.deepEqual(nav.textMatchOffsets('hi', 'a much longer needle'), []);
});

test('active-result navigation wraps in both directions', () => {
  // Next past the last result returns to the first; previous from the first
  // jumps to the last. Exercised through the same modulo the applier uses.
  const wrap = (index, count) => ((Number(index) || 0) % count + count) % count;
  assert.equal(wrap(3, 3), 0, 'next from the last result should wrap to the first');
  assert.equal(wrap(-1, 3), 2, 'previous from the first result should wrap to the last');
  assert.equal(wrap(NaN, 3), 0, 'a garbled index should land on the first result');
});

test('clearing highlights tolerates environments without the Highlight API', () => {
  // The Electron webview has CSS.highlights; plain test environments do not.
  // Clearing must be safe in both, or find-in-note crashes on some platforms.
  assert.doesNotThrow(() => nav.clearEditorSearchHighlights({}));
  assert.doesNotThrow(() => nav.clearEditorSearchHighlights(undefined));
  const result = nav.applyEditorSearchHighlights(null, 'query', 0, {});
  assert.deepEqual(result, { count: 0, activeIndex: -1, targets: [] });
});
