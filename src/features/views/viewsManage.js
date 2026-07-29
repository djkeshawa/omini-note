// Creating, renaming, duplicating and deleting a saved view.
//
// These are pure list transforms so they can be tested without a window, and
// so the panel stays a shell. Every one returns {ok, definitions, activeId} or
// {ok: false, reason} — a refusal is a value, never a thrown error, because
// the caller has to turn it into something a person can read.
//
// Two limits are real and enforced here rather than at the boundary: the
// preference sanitizer *throws* above 24 definitions, and it rejects any id
// that is not /^[A-Za-z][A-Za-z0-9_-]{1,63}$/ or that repeats. A refusal here
// is a message; the same mistake one layer down is a lost save.

const MN_VIEWS_MAX = 24;
const MN_VIEW_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const MN_VIEW_TITLE_MAX = 120;

// The saved shape is a closed set of keys. Anything else — a stray field from
// a future version, a key the UI hung on the object — is dropped before it can
// reach a sanitizer that would reject the whole list for it.
const MN_VIEW_KEYS = ['format', 'id', 'title', 'type', 'filters', 'sort', 'limit', 'layout', 'group', 'columns'];

function mnViewsPick(definition = {}) {
  const clean = {};
  MN_VIEW_KEYS.forEach(key => {
    if (definition[key] !== undefined) clean[key] = definition[key];
  });
  return clean;
}

function mnViewsCleanTitle(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MN_VIEW_TITLE_MAX);
}

// Ids are derived from the title so a saved file stays readable, but the title
// is free text, so the derived part is stripped to what the id rule allows and
// falls back to a fixed stem when nothing usable survives.
function mnViewsNewId(definitions = [], title = '', seq = 0) {
  const taken = new Set((definitions || []).map(item => item?.id).filter(Boolean));
  const stem = mnViewsCleanTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const base = MN_VIEW_ID_RE.test(stem) ? stem : `view_${stem}`.replace(/_+$/, '');
  const safe = MN_VIEW_ID_RE.test(base) ? base : 'view';
  if (!taken.has(safe)) return safe;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${safe}_${n + seq}`.slice(0, 64);
    if (!taken.has(candidate) && MN_VIEW_ID_RE.test(candidate)) return candidate;
  }
  return '';
}

function mnViewsUniqueTitle(definitions = [], title) {
  const taken = new Set((definitions || []).map(item => mnViewsCleanTitle(item?.title).toLowerCase()));
  const base = mnViewsCleanTitle(title) || 'New view';
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

function mnViewsCreate(definitions = [], { title = 'New view', format, template } = {}) {
  const list = definitions || [];
  if (list.length >= MN_VIEWS_MAX) return { ok: false, reason: 'cap' };
  const nextTitle = mnViewsUniqueTitle(list, title);
  const id = mnViewsNewId(list, nextTitle, list.length);
  if (!id) return { ok: false, reason: 'id' };
  const seed = template
    ? mnViewsPick(template)
    : { type: 'notes', filters: {}, sort: { field: 'modified', direction: 'desc' }, limit: 50, layout: 'list' };
  const definition = { ...seed, id, title: nextTitle };
  if (format) definition.format = format;
  return { ok: true, definitions: [...list, definition], activeId: id };
}

function mnViewsDuplicate(definitions = [], id, { format } = {}) {
  const list = definitions || [];
  const source = list.find(item => item?.id === id);
  if (!source) return { ok: false, reason: 'missing' };
  const created = mnViewsCreate(list, {
    title: `${mnViewsCleanTitle(source.title) || 'View'} copy`,
    format: format || source.format,
    template: source,
  });
  if (!created.ok) return created;
  // A duplicate belongs next to what it was copied from, not at the end.
  const at = list.findIndex(item => item?.id === id);
  const made = created.definitions[created.definitions.length - 1];
  const next = list.slice(0, at + 1).concat([made], list.slice(at + 1));
  return { ok: true, definitions: next, activeId: made.id };
}

function mnViewsRename(definitions = [], id, title) {
  const list = definitions || [];
  if (!list.some(item => item?.id === id)) return { ok: false, reason: 'missing' };
  const clean = mnViewsCleanTitle(title);
  if (!clean) return { ok: false, reason: 'empty' };
  const clash = list.some(item => item?.id !== id && mnViewsCleanTitle(item?.title).toLowerCase() === clean.toLowerCase());
  if (clash) return { ok: false, reason: 'duplicate' };
  return {
    ok: true,
    definitions: list.map(item => (item?.id === id ? { ...item, title: clean } : item)),
    activeId: id,
  };
}

// Deleting the last view is refused rather than silently obeyed: the app
// resurrects the built-in defaults whenever the saved list is empty, so an
// obeyed delete would look like the view came back.
function mnViewsDelete(definitions = [], id) {
  const list = definitions || [];
  const at = list.findIndex(item => item?.id === id);
  if (at < 0) return { ok: false, reason: 'missing' };
  if (list.length <= 1) return { ok: false, reason: 'last' };
  const next = list.filter(item => item?.id !== id);
  return { ok: true, definitions: next, activeId: (next[at] || next[at - 1] || next[0]).id };
}

function mnViewsApplyDraft(definitions = [], draft) {
  const list = definitions || [];
  if (!draft?.id) return { ok: false, reason: 'missing' };
  if (!list.some(item => item?.id === draft.id)) return { ok: false, reason: 'missing' };
  return {
    ok: true,
    definitions: list.map(item => (item?.id === draft.id ? mnViewsPick({ ...item, ...draft }) : item)),
    activeId: draft.id,
  };
}

function mnViewsDraftDiffers(definition, draft) {
  if (!draft || !definition || draft.id !== definition.id) return false;
  return Object.keys(draft).some(key => key !== 'id' && draft[key] !== definition[key]);
}

// One place decides whether a list is safe to hand to the preference layer,
// so a refusal reads as a sentence here instead of a thrown validation error
// three layers down.
function mnViewsCheckSavable(definitions = []) {
  const list = definitions || [];
  if (!Array.isArray(list) || !list.length) return { ok: false, reason: 'empty' };
  if (list.length > MN_VIEWS_MAX) return { ok: false, reason: 'cap' };
  const seen = new Set();
  for (const definition of list) {
    const id = String(definition?.id || '');
    if (!MN_VIEW_ID_RE.test(id)) return { ok: false, reason: 'id', id };
    if (seen.has(id)) return { ok: false, reason: 'duplicate', id };
    seen.add(id);
    if (!mnViewsCleanTitle(definition?.title)) return { ok: false, reason: 'title', id };
  }
  return { ok: true, definitions: list.map(mnViewsPick) };
}

export {
  MN_VIEWS_MAX, MN_VIEW_ID_RE,
  mnViewsPick, mnViewsCleanTitle, mnViewsNewId, mnViewsUniqueTitle,
  mnViewsCreate, mnViewsDuplicate, mnViewsRename, mnViewsDelete,
  mnViewsApplyDraft, mnViewsDraftDiffers, mnViewsCheckSavable,
};
