// Scope: which notes a view looks at before anything else is decided.
//
// The prototype offers folders, tags and one-note-and-its-links. VispNote
// keeps every note in the vault root — there are no folders — so folders are
// not offered here rather than shown as a control that can never do anything.
//
// Both scopes are ALL, not ANY: the query requires a note to carry every tag
// listed and to link to every note listed. That is the engine's behaviour, so
// it is what the menu has to say.

import { mnViewsPick } from './viewsManage.js';

// The preference sanitizer caps any filter array at 40 items and any string at
// 500 characters. Refusing here means a sentence; the same overflow one layer
// down throws away the whole save.
const MN_VIEW_SCOPE_MAX = 40;

function mnViewsScopeList(definition = {}, field) {
  const raw = definition?.filters?.[field];
  return Array.isArray(raw) ? raw.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function mnViewsScopeTags(definition) {
  return mnViewsScopeList(definition, 'tags');
}

function mnViewsScopeLinks(definition) {
  return mnViewsScopeList(definition, 'linkedNotes');
}

function mnViewsWithFilter(definition = {}, field, next) {
  const filters = { ...(definition.filters || {}) };
  if (next.length) filters[field] = next;
  else delete filters[field];
  return filters;
}

function mnViewsToggleScope(definition = {}, field, value) {
  const clean = String(value || '').trim();
  if (!clean) return { ok: false, reason: 'empty' };
  if (clean.length > 500) return { ok: false, reason: 'long' };
  const current = mnViewsScopeList(definition, field);
  const has = current.some(item => item.toLowerCase() === clean.toLowerCase());
  const next = has
    ? current.filter(item => item.toLowerCase() !== clean.toLowerCase())
    : current.concat([clean]);
  if (next.length > MN_VIEW_SCOPE_MAX) return { ok: false, reason: 'cap' };
  return { ok: true, filters: mnViewsWithFilter(definition, field, next) };
}

// The tags a scope can pick are the ones the notes actually carry, not only
// the ones in the vault's tag registry. A tag typed straight into a note is
// real to the query, so it has to be offerable here — otherwise a view can be
// filtered by something the menu refuses to show.
function mnViewsScopeTagChoices(tags = [], notes = [], chosen = []) {
  const names = new Map();
  const add = (raw) => {
    const name = String((typeof raw === 'string' ? raw : raw?.name) || '').trim();
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  };
  (tags || []).forEach(add);
  (notes || []).forEach(note => (note?.tags || []).forEach(add));
  (chosen || []).forEach(add);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function mnViewsClearScope(definition = {}) {
  const filters = { ...(definition.filters || {}) };
  delete filters.tags;
  delete filters.linkedNotes;
  return { ok: true, filters };
}

function mnViewsScopeIsSet(definition) {
  return Boolean(mnViewsScopeTags(definition).length || mnViewsScopeLinks(definition).length);
}

// What the chip says. Named counts beat a generic "filtered" because the
// whole point of the chip is to tell you why you are not seeing everything.
function mnViewsScopeSummary(definition = {}) {
  const tags = mnViewsScopeTags(definition);
  const links = mnViewsScopeLinks(definition);
  if (!tags.length && !links.length) return 'Whole vault';
  const parts = [];
  if (tags.length) parts.push(tags.length === 1 ? `#${tags[0]}` : `${tags.length} tags`);
  if (links.length) parts.push(links.length === 1 ? `links to ${links[0]}` : `${links.length} links`);
  return parts.join(' + ');
}

// Applying a scope keeps every other filter the view already had — a date
// range or an action status is not scope and must survive.
function mnViewsApplyScope(definition = {}, filters) {
  return { ok: true, definition: mnViewsPick({ ...definition, filters }) };
}

export {
  MN_VIEW_SCOPE_MAX,
  mnViewsScopeTags, mnViewsScopeLinks, mnViewsScopeList,
  mnViewsToggleScope, mnViewsClearScope, mnViewsScopeIsSet, mnViewsScopeTagChoices,
  mnViewsScopeSummary, mnViewsApplyScope,
};
