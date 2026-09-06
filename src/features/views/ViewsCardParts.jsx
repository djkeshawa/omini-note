import { TaskCheckbox } from '../../shared/TaskCheckbox.jsx';
// The pieces a Views card is built from.
//
// Three ideas live here, and they are what make a card in Views behave unlike
// a row in a list:
//
//   - Opening is an *indication*, not a button. A solid Open button competed
//     with the card's own content for attention on every row at once. The mark
//     is a chevron washed in the card's hue, sitting quietly until you are on
//     the card, at which point it is unmistakable.
//   - The bar is the card's own bottom edge. It is a translucent strip tinted
//     from the same hue with a light border above it, hidden until the pointer
//     arrives — so a wall of cards is a wall of content, not a wall of controls.
//   - The title is editable in place. Clicking the space in a card is a small
//     edit, not navigation; the bar is where you go when you meant to open it.
//
// The reveal is a CSS class rather than React state on purpose: a view can hold
// hundreds of cards, and re-rendering one on every pointer enter and leave is
// a lot of work to draw a strip that was already in the DOM. The rules live in
// the `mn-view-card` / `mn-view-mark` block in vispnote.html.

import { DS_RADIUS } from '../../shared/designSystem.js';
import { mnViewsTint, MN_VIEWS_TINT } from './viewsHue.js';

// The open indication. Same shape everywhere it appears — card, list row,
// board card — so "this is how you open the thing" is learned once.
function ViewsOpenMark({ hue, label = 'Open note', onOpen, T, size = 24, className = 'mn-view-mark' }) {
  if (!onOpen) return null;
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onOpen(); }}
      style={{
        width: size, height: size, padding: 0, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: DS_RADIUS.icon,
        border: `1px solid ${mnViewsTint(hue, MN_VIEWS_TINT.edge)}`,
        background: mnViewsTint(hue, MN_VIEWS_TINT.wash),
        color: hue, cursor: 'pointer',
      }}>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M6 3.5L10.5 8L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// The strip along a card's bottom edge. Absolute rather than in flow so the
// card does not change height when it appears, which would make a grid of them
// twitch as the pointer crossed it.
function ViewsHoverBar({ hue, children, T }) {
  return (
    <div
      className="mn-view-card-bar"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 30,
        boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
        borderTop: `1px solid ${mnViewsTint(hue, MN_VIEWS_TINT.edge)}`,
        borderRadius: `0 0 ${DS_RADIUS.row - 1}px ${DS_RADIUS.row - 1}px`,
        background: mnViewsTint(hue, MN_VIEWS_TINT.wash, T?.bg || 'transparent'),
      }}>
      {children}
    </div>
  );
}

// A bar button: the same washed tint as the mark, wide enough for a word.
function ViewsBarButton({ hue, label, title, onClick, T }) {
  return (
    <button
      type="button"
      title={title || label}
      aria-label={title || label}
      onClick={(event) => { event.stopPropagation(); onClick?.(); }}
      style={{
        height: 20, padding: '0 8px', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        borderRadius: DS_RADIUS.icon,
        border: `1px solid ${mnViewsTint(hue, MN_VIEWS_TINT.edge)}`,
        background: 'transparent', color: T.inkMed, cursor: 'pointer',
        fontFamily: 'var(--mn-ui)', fontSize: 11,
      }}>{label}</button>
  );
}

// Editing in place. Enter keeps it, Escape drops it, and clicking away keeps it
// too — a blur that threw the edit away would lose work to a stray click.
function ViewsInlineTitle({ value, onChange, onCommit, onCancel, T, label = 'Row title' }) {
  return (
    <input
      autoFocus
      aria-label={label}
      value={value}
      onChange={event => onChange?.(event.target.value)}
      onClick={event => event.stopPropagation()}
      onBlur={() => onCommit?.()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); onCommit?.(); }
        if (event.key === 'Escape') { event.preventDefault(); onCancel?.(); }
      }}
      style={{
        width: '100%', height: 26, padding: '0 8px', boxSizing: 'border-box',
        borderRadius: DS_RADIUS.icon,
        border: `1px solid ${T.accent}`,
        background: T.bg, color: T.ink, outline: 'none',
        fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600,
      }}
    />
  );
}

// The task tick, shared by every layout that can complete something.
function ViewsCheck({ checked, onToggle, T, size = 16 }) {
  if (!onToggle) return null;
  return <TaskCheckbox checked={checked} onToggle={onToggle} T={T} size={size} />;
}

// Where a row came from — but only when that is news. A task row was cut out of
// some note and naming it is the only way to find it again; a note row *is* the
// note, and printing its source under its own title said "Source note" on every
// card in the view, which is a label for nothing.
function mnViewsRowSource(result = {}) {
  if (!result || result.type === 'note') return '';
  return result.sourceNoteTitle || result.noteTitle || result.source?.noteTitle || '';
}

// A card's own frame: hue down the left edge, room at the bottom for the bar.
function mnViewsCardStyle(hue, T, { dragging = false, editing = false } = {}) {
  return {
    position: 'relative',
    minWidth: 0,
    padding: '11px 12px 36px',
    borderRadius: DS_RADIUS.row,
    border: `1px solid ${editing ? T.selLine : T.lineSub}`,
    borderLeft: `3px solid ${hue}`,
    background: editing ? T.selBg : (T.bgElevated || T.bg),
    cursor: editing ? 'default' : 'pointer',
    opacity: dragging ? 0.45 : 1,
    display: 'flex', flexDirection: 'column', gap: 6,
    boxShadow: dragging ? 'none' : `0 1px 2px color-mix(in oklab, ${T.ink} 4%, transparent)`,
  };
}

export {
  ViewsOpenMark, ViewsHoverBar, ViewsBarButton, ViewsInlineTitle, ViewsCheck,
  mnViewsCardStyle, mnViewsRowSource,
};
