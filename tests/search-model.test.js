const assert = require('node:assert/strict');
const test = require('node:test');

const searchModel = require('../src/features/search/searchModel.js');

test('search result projection stays ordered and bounded for 10,000 notes', () => {
  const notes = Array.from({ length: 10000 }, (_unused, index) => ({
    id: `n${index}`,
    title: `Note ${index}`,
    tags: index % 2 ? ['odd'] : ['even'],
    date: new Date(1700000000000 + index).toISOString(),
    modifiedAt: new Date(1700000000000 + index).toISOString(),
    pinned: false,
  }));
  const hitIds = ['n9999', 'n5000', 'n7'];
  const result = searchModel.filterAndSortNotes({
    notes,
    view: 'notes',
    selectedTag: null,
    selectedWorkflow: null,
    workflowData: { noteIdsByState: {} },
    hitIds,
    details: new Map(),
    tweaks: {},
  });
  assert.deepEqual(result.map(note => note.id), hitIds);
});
