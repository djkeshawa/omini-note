// What a table column is, where its value comes from, and how to sort by it.
//
// Kept separate from the JSX so the catalogue and the readers can be tested
// directly. Two rules run through all of it:
//
// 1. Nothing is invented. Every file-sourced column reads a field the query
//    already puts on the row. A column that would need work the renderer does
//    not do is not offered rather than shown empty.
// 2. A property column is discovered, not declared — it exists because someone
//    wrote `key::` in a note. Its header says so, in mono, with the colons.
//
// Only four sort fields survive a save: the preference sanitizer rejects
// anything outside title / created / modified / reminder. Sorting by the rest
// still works, it just cannot be stored, and the header has to say which is
// which rather than dropping a save on the floor.

const MN_VIEW_SORTABLE_FIELDS = { title: 'title', created: 'created', modified: 'modified', due: 'reminder' };

const MN_VIEW_NOTE_COLUMNS = [
  { key: 'title', label: 'Title', origin: 'file', type: 'text', width: 'minmax(0, 1fr)', fixed: true, source: 'the note title' },
  { key: 'tags', label: 'Tags', origin: 'file', type: 'multi', width: '150px', source: 'the tags on the note' },
  { key: 'modified', label: 'Modified', origin: 'file', type: 'date', width: '110px', source: 'when the note last changed' },
  { key: 'created', label: 'Created', origin: 'file', type: 'date', width: '110px', source: 'when the note was made' },
  { key: 'words', label: 'Words', origin: 'file', type: 'number', width: '82px', source: 'counted from the body' },
];

const MN_VIEW_ACTION_COLUMNS = [
  { key: 'title', label: 'What', origin: 'file', type: 'text', width: 'minmax(0, 1fr)', fixed: true, source: 'the line itself' },
  { key: 'status', label: 'Status', origin: 'file', type: 'select', width: '116px', source: 'whether the line is ticked, deferred or due' },
  { key: 'note', label: 'In note', origin: 'file', type: 'text', width: '166px', source: 'the note it lives in' },
  { key: 'due', label: 'Due', origin: 'file', type: 'date', width: '108px', source: 'the reminder date on the line' },
  { key: 'tags', label: 'Tags', origin: 'file', type: 'multi', width: '150px', source: 'inherited from the note' },
];

function mnViewsBaseColumns(type) {
  return String(type || 'notes') === 'notes' ? MN_VIEW_NOTE_COLUMNS : MN_VIEW_ACTION_COLUMNS;
}

function mnViewsPropertyColumn(key) {
  return {
    key,
    label: key,
    origin: 'property',
    type: 'text',
    width: '128px',
    source: `${key}:: written in the note`,
  };
}

// Property keys are found by reading, not declared anywhere: a key exists
// because someone typed `key::` in a note. Coverage is counted in rows rather
// than notes, because that is what the table will actually show.
const MN_VIEW_PROPERTY_LINE_RE = /^[ \t]*(?:-[ \t]*)?([A-Za-z][A-Za-z0-9_-]{0,39})::[ \t]*(.*)$/gm;

function mnViewsDiscoverProperties(results = [], baseKeys = []) {
  const skip = new Set(baseKeys);
  const counts = new Map();
  (results || []).forEach(result => {
    const body = mnViewsNoteFor(result)?.body;
    if (!body) return;
    const seen = new Set();
    MN_VIEW_PROPERTY_LINE_RE.lastIndex = 0;
    let match = MN_VIEW_PROPERTY_LINE_RE.exec(body);
    while (match) {
      const key = match[1];
      // A key with no value on the line is a heading-ish false positive, and
      // a key that is already a built-in column would shadow it.
      if (match[2].trim() && !skip.has(key) && !seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      match = MN_VIEW_PROPERTY_LINE_RE.exec(body);
    }
  });
  return [...counts.entries()]
    .map(([key, count]) => ({ ...mnViewsPropertyColumn(key), count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

// Everything this view could show: the fields the row type always has, then
// every property key the rows in front of you actually carry.
function mnViewsCatalogue(definition = {}, results = []) {
  const base = mnViewsBaseColumns(definition.type);
  const covered = base.map(column => ({
    ...column,
    count: (results || []).filter(result => !mnViewsCellIsEmpty(mnViewsCellValue(result, column))).length,
  }));
  return covered.concat(mnViewsDiscoverProperties(results, base.map(column => column.key)));
}

// The columns a view shows, in order. An absent list means "the ones this row
// type comes with"; once anything is toggled the list is explicit. The first
// column is the row itself, so it is always present and cannot be removed.
function mnViewsColumns(definition = {}) {
  const base = mnViewsBaseColumns(definition.type);
  const saved = Array.isArray(definition.columns) ? definition.columns : null;
  if (!saved?.length) return base;
  const byKey = new Map(base.map(column => [column.key, column]));
  const fixed = base.find(column => column.fixed);
  const keys = saved.map(raw => String(raw || '').trim()).filter(Boolean);
  const ordered = fixed && !keys.includes(fixed.key) ? [fixed.key, ...keys] : keys;
  const seen = new Set();
  return ordered
    .filter(key => (seen.has(key) ? false : seen.add(key)))
    .map(key => byKey.get(key) || mnViewsPropertyColumn(key));
}

// Toggling and reordering produce the explicit list that gets saved. Both
// start from what is showing now, so the first toggle does not silently drop
// the columns the row type came with.
function mnViewsToggleColumn(definition = {}, key) {
  const current = mnViewsColumns(definition).map(column => column.key);
  const fixed = mnViewsBaseColumns(definition.type).find(column => column.fixed);
  if (fixed && key === fixed.key) return { ok: false, reason: 'fixed' };
  const next = current.includes(key) ? current.filter(item => item !== key) : current.concat([key]);
  if (!next.length) return { ok: false, reason: 'fixed' };
  return { ok: true, columns: next };
}

function mnViewsMoveColumn(definition = {}, key, delta) {
  const current = mnViewsColumns(definition).map(column => column.key);
  const at = current.indexOf(key);
  const to = at + delta;
  // The row's own column stays first, so nothing may move into slot zero.
  if (at < 1 || to < 1 || to >= current.length) return { ok: false, reason: 'edge' };
  const next = [...current];
  next.splice(at, 1);
  next.splice(to, 0, key);
  return { ok: true, columns: next };
}

function mnViewsNoteFor(result = {}) {
  return result.note || result.sourceNote || null;
}

function mnViewsWordCount(body) {
  const text = String(body || '').trim();
  return text ? text.split(/\s+/).length : 0;
}

// The value a cell shows. Returns '' or [] for "nothing here" so the renderer
// can draw an em dash instead of the string "undefined".
function mnViewsCellValue(result = {}, column = {}, helpers = {}) {
  if (column.origin === 'property') {
    const note = mnViewsNoteFor(result);
    if (!note || !helpers.bodyPropertyValue) return '';
    return helpers.bodyPropertyValue(note.body || '', column.key) || '';
  }
  switch (column.key) {
    case 'title': return result.title || result.label || '';
    case 'tags': return result.tags?.length ? result.tags : (result.noteTags || []);
    case 'modified': return result.modifiedDate || '';
    case 'created': return result.createdDate || '';
    case 'words': return mnViewsWordCount(mnViewsNoteFor(result)?.body);
    case 'status': return result.status || '';
    case 'note': return result.noteTitle || result.sourceNoteTitle || '';
    case 'due': return result.reminderDate || '';
    default: return '';
  }
}

function mnViewsCellIsEmpty(value) {
  return Array.isArray(value) ? !value.length : !String(value ?? '').length;
}

function mnViewsCompareValues(a, b, type) {
  if (type === 'number') return (Number(a) || 0) - (Number(b) || 0);
  const left = Array.isArray(a) ? a.join(' ') : String(a ?? '');
  const right = Array.isArray(b) ? b.join(' ') : String(b ?? '');
  return left.localeCompare(right, undefined, { numeric: type === 'date', sensitivity: 'base' });
}

function mnViewsCachedCellValue(result, key) {
  const cells = result?.__cells;
  if (cells instanceof Map) return cells.get(key);
  if (!cells || !Object.prototype.hasOwnProperty.call(cells, key)) return undefined;
  return cells[key];
}

function mnViewsSortResults(results = [], columns = [], sort) {
  if (!sort?.key) return results;
  const column = columns.find(item => item.key === sort.key);
  if (!column) return results;
  const factor = sort.direction === 'desc' ? -1 : 1;
  return [...results].sort((a, b) => {
    const left = mnViewsCachedCellValue(a, column.key);
    const right = mnViewsCachedCellValue(b, column.key);
    // Rows with nothing in the sorted column sink to the bottom whichever way
    // the sort runs, so reversing never opens the table on a block of blanks.
    const leftEmpty = mnViewsCellIsEmpty(left);
    const rightEmpty = mnViewsCellIsEmpty(right);
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    if (leftEmpty) return 0;
    return mnViewsCompareValues(left, right, column.type) * factor;
  });
}

// A click on a header cycles ascending, descending, then back to whatever the
// view was saved with — so there is always a way back to the saved order.
function mnViewsNextSort(current, key) {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

// Sorting by title, created, modified or due can be saved into the view;
// anything else sorts the table for now and says so.
function mnViewsSortIsStorable(key) {
  return Boolean(mnViewsSortField(key));
}

// Own keys only. Column keys are discovered from whatever someone typed in a
// note, so `constructor::` or `toString::` produced a column whose key hits
// Object.prototype — the header then claimed the sort was storable and saved a
// function where a field name belongs, which the IPC sanitizer rejects along
// with the rest of the preferences patch.
function mnViewsSortField(key) {
  const name = String(key || '');
  return Object.prototype.hasOwnProperty.call(MN_VIEW_SORTABLE_FIELDS, name)
    ? MN_VIEW_SORTABLE_FIELDS[name]
    : '';
}

function mnViewsSortFromDefinition(definition = {}) {
  const field = String(definition?.sort?.field || '');
  const key = Object.keys(MN_VIEW_SORTABLE_FIELDS).find(name => MN_VIEW_SORTABLE_FIELDS[name] === field);
  return key ? { key, direction: definition?.sort?.direction === 'desc' ? 'desc' : 'asc' } : null;
}

export {
  MN_VIEW_NOTE_COLUMNS, MN_VIEW_ACTION_COLUMNS, MN_VIEW_SORTABLE_FIELDS,
  mnViewsBaseColumns, mnViewsColumns, mnViewsCatalogue, mnViewsDiscoverProperties,
  mnViewsToggleColumn, mnViewsMoveColumn, mnViewsPropertyColumn,
  mnViewsCellValue, mnViewsWordCount,
  mnViewsCompareValues, mnViewsCellIsEmpty, mnViewsCachedCellValue, mnViewsSortResults, mnViewsNextSort,
  mnViewsSortIsStorable, mnViewsSortField, mnViewsSortFromDefinition,
};
