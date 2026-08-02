// What a saved view's filters may contain, and how the lists inside them
// combine.
//
// The allowlist lived inline in smartViewHelpers.js. It sits here because it
// is a contract rather than logic: `lib/connectors/ipc/preferenceValidation.js`
// keeps a hand-mirrored copy, and a key present in one list and missing from
// the other means a view saves in the renderer and is rejected at the IPC
// boundary — which surfaces as a save that silently does nothing. A test reads
// both lists out of source and asserts they are identical.
const SMART_VIEW_FILTER_KEYS = [
  'title',
  'titleContains',
  'tag',
  'tags',
  'createdFrom',
  'createdTo',
  'createdAfter',
  'createdBefore',
  'modifiedFrom',
  'modifiedTo',
  'modifiedAfter',
  'modifiedBefore',
  'property',
  'properties',
  'propertiesMatch',
  'tagsMatch',
  'linkedNotesMatch',
  'propertyKey',
  'propertyValue',
  'workflowStatus',
  'workflowStatuses',
  'linkedNote',
  'linkedNotes',
  'actionStatus',
  'actionStatuses',
  'taskStatus',
  'actionType',
  'actionTypes',
  'reminderFrom',
  'reminderTo',
  'remindFrom',
  'remindTo',
  'dueFrom',
  'dueTo',
];

// Scope lists default to ANY, unlike property conditions, which default to
// ALL. Requiring every picked tag meant a two-tag scope almost always matched
// nothing at all, which reads as a broken view rather than a narrow one.
function smartViewMatchMode(value) {
  return String(value ?? '').trim().toLowerCase() === 'all' ? 'all' : 'any';
}

function smartViewMatchList(list = [], match = 'any', test = () => false) {
  return match === 'all' ? list.every(test) : list.some(test);
}

module.exports = { SMART_VIEW_FILTER_KEYS, smartViewMatchMode, smartViewMatchList };
