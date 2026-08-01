// Turning something you did to a row into something written in a note.
//
// A view owns nothing. Ticking a task, retyping a title, dragging a card into
// another board column — each one has to land as text in the note the row came
// from, or it has not happened at all. This is the one place that decides which
// write a gesture means, and the one place that explains a refusal.
//
// Every refusal is honest about the same thing: the anchor. A row remembers the
// block it was parsed out of, and when that block is gone and the line is not
// unique there is no way to tell which of two identical lines you meant. Saying
// so beats editing one at random.

import { mnViewsActionItem } from './viewsWrite.js';

const MN_VIEWS_WRITE_REFUSALS = {
  ambiguous: 'The same line appears more than once in that note, so there is no way to tell which one you meant. Open the note and change it there.',
  unlocatable: 'The line this row came from is no longer in that note. Open the note to check it.',
};

function useViewsRowActions({
  notes = [], walk, onUpdateTaskItem, onRenameNote, onSetProperty, onNotice,
} = {}) {
  const noteFor = (id) => (notes || []).find(candidate => candidate.id === id) || null;

  // Writes to the line a task or reminder row came from. Returns false when
  // nothing was written, so a caller can leave its draft on screen.
  const writeRow = (result, patch = {}) => {
    if (!onUpdateTaskItem || !result) return false;
    const resolved = mnViewsActionItem(result, { note: noteFor(result.noteId), walk });
    if (!resolved.ok) {
      onNotice?.('That row could not be updated', MN_VIEWS_WRITE_REFUSALS[resolved.reason] || MN_VIEWS_WRITE_REFUSALS.unlocatable, 'warn');
      return false;
    }
    if (onUpdateTaskItem(resolved.item, patch) === false) {
      onNotice?.('That row could not be updated', 'The note it came from did not change. Open the note to edit it directly.', 'warn');
      return false;
    }
    return true;
  };

  const toggleCheck = (result) => writeRow(result, { checked: !result?.checked });

  // A note row's title is the note's title, and renaming it has to carry every
  // [[wiki link]] pointing at the old name with it — which is exactly what the
  // app's rename does, so this defers to it rather than writing a line itself.
  const renameRow = (result, title) => {
    const next = String(title || '').trim();
    if (!result || !next) return false;
    if (result.type === 'note') {
      if (!onRenameNote) {
        onNotice?.('That note could not be renamed', 'This window has no way to rename notes.', 'warn');
        return false;
      }
      onRenameNote(result.noteId, next);
      return true;
    }
    return writeRow(result, { text: next });
  };

  // A board drop writes the column it landed in onto the note, as the property
  // the board is grouped by. Dropping into the unfiled column removes the line
  // rather than writing an empty one, so a note without a status has no status.
  const moveCard = (result, bucketKey, writeKey) => {
    const noteId = result?.noteId || result?.source?.noteId || '';
    if (!writeKey) {
      onNotice?.(
        'These columns cannot be written to',
        'This board is grouped by something a note does not store as a single value — a tag list, or a date the app works out. Group by a property to move cards between columns.',
        'info'
      );
      return false;
    }
    if (!noteId || !onSetProperty) {
      onNotice?.('That card could not be moved', 'The row has no note behind it to write to.', 'warn');
      return false;
    }
    onSetProperty(noteId, writeKey, bucketKey || '');
    return true;
  };

  return { writeRow, toggleCheck, renameRow, moveCard };
}

export { useViewsRowActions, MN_VIEWS_WRITE_REFUSALS };
