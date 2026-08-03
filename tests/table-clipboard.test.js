const test = require('node:test');
const assert = require('node:assert/strict');

const tableOps = require('../src/editor/tableOps.js');

// Pasting a table from a spreadsheet, a web page, or another markdown editor.
// The user expectation is simple: whatever the source, the cells land in the
// right places and nothing in a cell can break the table's own syntax.

test('a spreadsheet paste (tab separated) becomes a markdown table', () => {
  const md = tableOps.clipboardToMarkdownTable({ text: 'Name\tRole\nAda\tEngineer\nGrace\tAdmiral' });
  assert.match(md, /\| Name \| Role \|/);
  assert.match(md, /\| Ada \| Engineer \|/);
  assert.match(md, /\| Grace \| Admiral \|/);
  assert.match(md, /\| --- \| --- \|/, 'a markdown table needs its separator row');
});

test('a single tab-free paste is left alone rather than forced into a table', () => {
  assert.equal(tableOps.clipboardToMarkdownTable({ text: 'just a sentence' }), '');
  assert.equal(tableOps.clipboardToMarkdownTable({ text: 'one column\nsecond line' }), '',
    'newline-separated prose is not a table');
});

test('an HTML table paste is read without a DOM', () => {
  // The renderer has DOMParser; the fallback path must produce the same table.
  const html = '<table><tr><th>Name</th><th>Role</th></tr><tr><td>Ada</td><td>Engineer</td></tr></table>';
  const md = tableOps.clipboardToMarkdownTable({ html });
  assert.match(md, /\| Name \| Role \|/);
  assert.match(md, /\| Ada \| Engineer \|/);
});

test('HTML cells are stripped of markup and line breaks become newlines', () => {
  const html = '<table><tr><td><b>Bold</b> text</td><td>line<br>break</td></tr><tr><td>a</td><td>b</td></tr></table>';
  const md = tableOps.clipboardToMarkdownTable({ html });
  assert.match(md, /Bold text/, 'inline tags should be stripped, not escaped into the cell');
  assert.ok(!md.includes('<b>'), 'raw HTML leaked into the note');
});

test('a pipe inside a pasted cell cannot break the table', () => {
  const md = tableOps.clipboardToMarkdownTable({ text: 'A\tB\nx | y\tz' });
  const dataRow = md.split('\n').find(l => l.includes('x'));
  assert.ok(dataRow.includes('\\|'), `an unescaped pipe would split the cell: ${dataRow}`);
  // Round-tripping the escaped table must give the cell back intact.
  const rows = tableOps.markdownTableToRows(md);
  assert.equal(rows[1][0], 'x | y');
});

test('ragged rows are padded so every row has the same cell count', () => {
  const md = tableOps.clipboardToMarkdownTable({ text: 'A\tB\tC\nonly\tone' });
  const rows = tableOps.markdownTableToRows(md);
  assert.ok(rows.every(r => r.length === rows[0].length),
    `ragged table produced uneven rows: ${JSON.stringify(rows)}`);
});

test('an existing markdown table pastes through normalised, not doubled', () => {
  const source = '|Name|Role|\n|---|---|\n|Ada|Engineer|';
  const md = tableOps.clipboardToMarkdownTable({ text: source });
  assert.match(md, /\| Name \| Role \|/, 'the table should be normalised with padding');
  assert.equal(tableOps.markdownTableToRows(md).length, 2, 'header plus one data row');
});

test('reading a table out of a note stops at the first non-table line', () => {
  const lines = [
    'intro prose',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    'trailing prose',
  ];
  const found = tableOps.readMarkdownTable(lines, 1);
  assert.ok(found, 'the table was not recognised');
  assert.equal(found.endIndex, 4, 'the table must end at its last row, not swallow the prose');
  assert.equal(tableOps.markdownTableToRows(found.markdown).length, 3);
  assert.equal(tableOps.readMarkdownTable(lines, 0), null, 'prose is not a table');
  assert.equal(tableOps.readMarkdownTable(lines, 6), null, 'a trailing line cannot start a table');
});

test('an enormous paste is refused rather than freezing the editor', () => {
  const huge = Array.from({ length: 40000 }, (_, i) => `a${i}\tb${i}`).join('\n');
  assert.equal(tableOps.clipboardToMarkdownTable({ text: huge }), '',
    'an oversized paste should be declined, not parsed');
});

test('a clipboard event with no data yields nothing', () => {
  assert.equal(tableOps.clipboardEventToMarkdownTable(null), '');
  assert.equal(tableOps.clipboardEventToMarkdownTable({}), '');
  const event = { clipboardData: { getData: type => (type === 'text/plain' ? 'A\tB\nc\td' : '') } };
  assert.match(tableOps.clipboardEventToMarkdownTable(event), /\| A \| B \|/);
});

test('a markdown table renders to HTML for copying back out', () => {
  const html = tableOps.markdownTableToHtml('| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<table/i);
  assert.match(html, /<td[^>]*>1<\/td>/i);
});

// ── Authored tables keep their empty rows ────────────────────────────────
// A pasted spreadsheet's trailing blank rows are noise and get dropped. A
// table the user is writing is different: the empty row is where they type.
// The /table command inserts exactly that, so dropping it renders a
// header-only table with nothing to fill in.

test('the /table starter renders with its empty row intact', () => {
  const starter = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |';
  const rows = tableOps.markdownTableToRows(starter);
  assert.equal(rows.length, 2, `the empty data row was dropped: ${JSON.stringify(rows)}`);
  assert.deepEqual(rows[0], ['Column 1', 'Column 2']);
  assert.deepEqual(rows[1], ['', ''], 'the empty row must survive so there is somewhere to type');
});

test('an empty row between filled rows is not silently removed', () => {
  const md = '| A | B |\n| --- | --- |\n| x | y |\n|  |  |\n| p | q |';
  const rows = tableOps.markdownTableToRows(md);
  assert.equal(rows.length, 4, `a deliberate blank row vanished: ${JSON.stringify(rows)}`);
  assert.deepEqual(rows[2], ['', '']);
});

test('an authored table round-trips through markdown without losing rows', () => {
  const starter = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |';
  const once = tableOps.normalizeMarkdownTable(starter);
  assert.equal(tableOps.markdownTableToRows(once).length, 2, 'normalising must not eat the empty row');
  const twice = tableOps.normalizeMarkdownTable(once);
  assert.equal(twice, once, 'the canonical form must be a fixed point');
});

test('a spreadsheet paste still drops its trailing blank rows', () => {
  // The other half of the contract: ingest is noisy, authoring is deliberate.
  const md = tableOps.clipboardToMarkdownTable({ text: 'A\tB\nx\ty\n\t\n\t' });
  const rows = tableOps.markdownTableToRows(md);
  assert.equal(rows.length, 2, `pasted blank rows should not become table rows: ${JSON.stringify(rows)}`);
});

// ── Editing a rendered cell ──────────────────────────────────────────────
// Typing into a rendered table cell rewrites the block's markdown, so the
// note on disk stays plain markdown that any other editor can read.

const { loadRendererModule } = require('./helpers/rendererModule.js');
const tableBlock = loadRendererModule('src/editor/outliner/MarkdownTableBlock.jsx');
const withCell = tableBlock.mnTableMarkdownWithCell;

test('typing in a cell rewrites only that cell', () => {
  const starter = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |';
  const filled = withCell(starter, 1, 0, 'Ada');
  const rows = tableOps.markdownTableToRows(filled);
  assert.deepEqual(rows[0], ['Column 1', 'Column 2'], 'the header must be untouched');
  assert.deepEqual(rows[1], ['Ada', ''], 'only the edited cell changes');
  const both = withCell(filled, 1, 1, 'Engineer');
  assert.deepEqual(tableOps.markdownTableToRows(both)[1], ['Ada', 'Engineer']);
});

test('a header cell is editable too', () => {
  const renamed = withCell('| A | B |\n| --- | --- |\n| x | y |', 0, 1, 'Role');
  assert.deepEqual(tableOps.markdownTableToRows(renamed)[0], ['A', 'Role']);
});

test('a cell edit cannot break the table syntax', () => {
  // A pipe or a newline typed into a cell must not split it into two cells
  // or terminate the row.
  const hostile = withCell('| A | B |\n| --- | --- |\n| x | y |', 1, 0, 'has | pipe');
  const rows = tableOps.markdownTableToRows(hostile);
  assert.equal(rows[1].length, 2, `a typed pipe split the row: ${JSON.stringify(rows[1])}`);
  assert.equal(rows[1][0], 'has | pipe', 'the pipe survives as text');
  const multiline = withCell('| A | B |\n| --- | --- |\n| x | y |', 1, 0, 'line one\nline two');
  const mlRows = tableOps.markdownTableToRows(multiline);
  assert.equal(mlRows.length, 2, 'a pasted newline must not create a second row');
  assert.equal(mlRows[1][0], 'line one line two', 'the newline collapses to a space');
});

test('editing a cell that does not exist leaves the table alone', () => {
  const md = '| A | B |\n| --- | --- |\n| x | y |';
  assert.equal(withCell(md, 9, 0, 'nope'), md, 'an out-of-range row is a no-op');
});

test('clearing a cell keeps the row rather than deleting it', () => {
  const cleared = withCell('| A | B |\n| --- | --- |\n| x | y |', 1, 0, '');
  const rows = tableOps.markdownTableToRows(cleared);
  assert.equal(rows.length, 2, 'emptying a cell must not drop its row');
  assert.deepEqual(rows[1], ['', 'y']);
});
