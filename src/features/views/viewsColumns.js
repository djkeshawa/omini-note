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

// The saved `columns` list is property keys someone pinned. They are appended
// to the columns the row type always has, in the order they were pinned.
function mnViewsColumns(definition = {}) {
  const base = mnViewsBaseColumns(definition.type);
  const pinned = Array.isArray(definition.columns) ? definition.columns : [];
  const taken = new Set(base.map(column => column.key));
  const extra = [];
  pinned.forEach(raw => {
    const key = String(raw || '').trim();
    if (!key || taken.has(key)) return;
    taken.add(key);
    extra.push({
      key,
      label: key,
      origin: 'property',
      type: 'text',
      width: '128px',
      source: `${key}:: written in the note`,
    });
  });
  return base.concat(extra);
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

function mnViewsSortResults(results = [], columns = [], sort) {
  if (!sort?.key) return results;
  const column = columns.find(item => item.key === sort.key);
  if (!column) return results;
  const factor = sort.direction === 'desc' ? -1 : 1;
  return [...results].sort((a, b) => {
    const left = a.__cells?.[column.key];
    const right = b.__cells?.[column.key];
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
  return Boolean(MN_VIEW_SORTABLE_FIELDS[key]);
}

function mnViewsSortField(key) {
  return MN_VIEW_SORTABLE_FIELDS[key] || '';
}

function mnViewsSortFromDefinition(definition = {}) {
  const field = String(definition?.sort?.field || '');
  const key = Object.keys(MN_VIEW_SORTABLE_FIELDS).find(name => MN_VIEW_SORTABLE_FIELDS[name] === field);
  return key ? { key, direction: definition?.sort?.direction === 'desc' ? 'desc' : 'asc' } : null;
}

export {
  MN_VIEW_NOTE_COLUMNS, MN_VIEW_ACTION_COLUMNS, MN_VIEW_SORTABLE_FIELDS,
  mnViewsBaseColumns, mnViewsColumns, mnViewsCellValue, mnViewsWordCount,
  mnViewsCompareValues, mnViewsCellIsEmpty, mnViewsSortResults, mnViewsNextSort,
  mnViewsSortIsStorable, mnViewsSortField, mnViewsSortFromDefinition,
};
