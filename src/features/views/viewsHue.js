// One place decides what colour a row is.
//
// A card's hue is the card's identity: the first tag it carries, drawn in the
// same colour that tag wears in the sidebar and on a workflow card, so the same
// note is recognisably the same thing wherever it turns up. A row carrying no
// tag the vault knows falls back to what kind of row it is — an open task takes
// the accent, a finished one the success tone, a reminder the focus tone.
//
// Everything tinted in Views mixes from this one colour: the hover bar under a
// card, the open mark, a board column's drop state. That is what makes a tint
// read as belonging to the card rather than as decoration sitting on top of it.

import { mnGetTagColor } from '../../shared/theme.jsx';

// A note result carries `tags`; an action result carries the note's tags as
// `noteTags`. Reading only the first would leave every task card uncoloured.
function mnViewsRowTags(result = {}) {
  const own = Array.isArray(result.tags) ? result.tags.filter(Boolean) : [];
  if (own.length) return own;
  return Array.isArray(result.noteTags) ? result.noteTags.filter(Boolean) : [];
}

function mnViewsKindHue(result = {}, T = {}) {
  if (result.type === 'reminder' || result.status === 'reminder') return T.focus || T.accent;
  if (result.checked || result.completed || result.status === 'completed') return T.success || T.accent;
  if (result.deferred || result.status === 'deferred') return T.warn || T.accent;
  return T.accent;
}

// `tagHue` is the registry map, which is deliberately not the same set as the
// tags notes actually carry: a tag written in a note but never registered has
// no hue of its own, and inventing one would colour two unrelated cards alike.
// Those fall through to the kind tone instead.
function mnViewsRowHue(result = {}, { tagHue, theme, T = {} } = {}) {
  const tags = mnViewsRowTags(result);
  for (const tag of tags) {
    const hue = tagHue?.get?.(tag);
    if (hue != null) return mnGetTagColor(hue, theme);
  }
  return mnViewsKindHue(result, T);
}

// Mixing against `transparent` yields the colour at `percent` alpha, so a tint
// laid over a card shows the card through it rather than replacing it.
function mnViewsTint(color, percent, base = 'transparent') {
  return `color-mix(in oklab, ${color} ${percent}%, ${base})`;
}

// The three weights every tinted surface in Views uses, so a hover bar here and
// a drop target there are visibly the same material.
const MN_VIEWS_TINT = { wash: 13, edge: 36, ink: 100 };

export { mnViewsRowHue, mnViewsRowTags, mnViewsKindHue, mnViewsTint, MN_VIEWS_TINT };
