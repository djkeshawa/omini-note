// Moving the caret into a new note's title. This lives outside editor.jsx so
// it can be unit-tested against a fake document, and because editor.jsx sits on
// its line budget.

const MN_NOTE_TITLE_SELECTOR = '.mn-note-title-input';

// Returns whether the title input was found AND still wanted, so callers can
// tell "focused" from "the editor had not mounted yet" instead of assuming.
//
// The focus is deferred by two frames so React can commit and the editor can
// mount. In those two frames the user can already have gone somewhere else —
// pressed the Assist button, opened the palette, clicked a block. Grabbing the
// caret back at that point is worse than never having moved it, so anything
// that has taken focus in the meantime keeps it. Only an idle document — body,
// documentElement, or nothing at all — is still waiting for the caret.
function focusNoteTitleInput(doc, { selectAll = true } = {}) {
  const input = doc && typeof doc.querySelector === 'function'
    ? doc.querySelector(MN_NOTE_TITLE_SELECTOR)
    : null;
  if (!input || typeof input.focus !== 'function') return false;
  const active = doc.activeElement;
  const idle = !active || active === doc.body || active === doc.documentElement || active === input;
  if (!idle) return false;
  input.focus();
  // Select the whole title rather than parking the caret at its end: a new
  // note's title is the literal placeholder "Untitled" (or "Untitled 2"), so a
  // caret at the end would turn the first keystrokes into "Untitled 2ideas".
  // Selecting makes the first keystroke replace it, as renaming does elsewhere.
  if (selectAll && typeof input.select === 'function') input.select();
  return true;
}

export { MN_NOTE_TITLE_SELECTOR, focusNoteTitleInput };
