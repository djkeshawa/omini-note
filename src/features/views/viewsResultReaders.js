// Per-result readers shared by every Views layout (list, table, board, cards,
// calendar), so each layout describes a row the same way. Query results come
// from smartViewQuery in appHelpers and mix notes, tasks and reminders; these
// readers pick the display fields without caring which kind they got.
//
// The mnSmartViewResult* names are kept from the retired Smart Views panel so
// the stored definitions and the query engine keep one vocabulary.

function mnSmartViewResultDate(result = {}, helpers = {}) {
  return result.reminderDate
    || result.modifiedDate
    || result.createdDate
    || helpers.rollupDateKey?.(result.noteModifiedAt || result.noteDate)
    || '';
}

function mnSmartViewResultSource(result = {}) {
  return result.sourceNoteTitle || result.noteTitle || result.source?.noteTitle || 'Source note';
}

function mnSmartViewResultKind(result = {}) {
  if (result.type === 'task') return result.status || 'task';
  if (result.type === 'reminder') return 'reminder';
  return 'note';
}

function mnSmartViewResultPreview(result = {}) {
  if (result.type === 'note') {
    return String(result.note?.body || '')
      .split('\n')
      .map(line => line.replace(/^#{1,4}\s+/, '').replace(/^\s*-\s+\[[ xX]\]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');
  }
  return result.label || result.text || '';
}

export {
  mnSmartViewResultDate, mnSmartViewResultSource,
  mnSmartViewResultKind, mnSmartViewResultPreview,
};
