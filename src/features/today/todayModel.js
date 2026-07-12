// Pure models for adaptive Today sections and local revisit controls.

const { localDateKey } = require('../../shared/dateUtils.js');

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const REVIEW_STATE_VERSION = 1;

  /**
   * @typedef {Object} TodayItem
   * @property {'action'|'revisit'} kind
   * @property {string} id
   * @property {string} noteId
   * @property {string} title
   * @property {string} reason
   */

  function asText(value) {
    return String(value == null ? '' : value);
  }

  function isoDate(value) {
    return localDateKey(value);
  }

  function todayKey(now = new Date()) {
    return isoDate(now);
  }

  function noteTouchesToday(note = {}, now = new Date()) {
    const today = todayKey(now);
    return asText(note.title).trim() === today
      || isoDate(note.date || '') === today
      || isoDate(note.modifiedAt || '') === today;
  }

  function actionDate(item = {}) {
    return isoDate(item?.remindAt?.date || item?.remindAt?.at || item?.rollupDateKey || item?.dueDate || '');
  }

  function actionIdentity(item = {}) {
    const source = item.label || item.text || item.blockId || item.line || item.key || '';
    return `${asText(item.noteId)}|${asText(source).trim().toLowerCase()}|${actionDate(item)}`;
  }

  function todayActionableItems({ tasks = [], reminders = [], now = new Date() } = {}) {
    const today = todayKey(now);
    const nowTime = new Date(now).getTime();
    const seen = new Set();
    const items = [];
    const candidates = [...(tasks || []), ...(reminders || [])];
    const snoozed = new Set(candidates
      .filter(item => item?.status === 'snoozed' || Number(item?.snoozedUntil) > nowTime)
      .map(actionIdentity));
    for (const item of candidates) {
      if (!item || item.checked) continue;
      const due = actionDate(item);
      if (!due || due > today) continue;
      const deferUntil = isoDate(item.deferUntil || '');
      if (deferUntil && deferUntil > today) continue;
      const identity = actionIdentity(item);
      if (!identity || snoozed.has(identity) || seen.has(identity)) continue;
      seen.add(identity);
      items.push({
        kind: 'action',
        id: identity,
        noteId: asText(item.noteId),
        title: asText(item.label || item.text || item.noteTitle || 'Untitled action'),
        reason: due < today ? 'Overdue' : 'Due today',
        dueDate: due,
        source: item,
      });
    }
    return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
  }

  function todayActionableCount(input = {}) {
    return todayActionableItems(input).length;
  }

  function revisitKey(kind, noteId) {
    return [kind, asText(noteId)].filter(Boolean).join(':').slice(0, 300);
  }

  function normalizeTodayReviewState(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const rawItems = source.items && typeof source.items === 'object' && !Array.isArray(source.items) ? source.items : {};
    const entries = [];
    Object.entries(rawItems).forEach(([key, entry]) => {
      if (!key || key.length > 300 || !entry || typeof entry !== 'object') return;
      const action = entry.action === 'dismissed' || entry.action === 'snoozed' ? entry.action : '';
      if (!action) return;
      const until = action === 'snoozed' ? new Date(entry.until || '') : null;
      const updated = new Date(entry.updatedAt || '');
      entries.push([key, {
        action,
        until: until && Number.isFinite(until.getTime()) ? until.toISOString() : '',
        updatedAt: Number.isFinite(updated.getTime()) ? updated.toISOString() : '',
      }]);
    });
    return { version: REVIEW_STATE_VERSION, items: Object.fromEntries(entries.slice(-200)) };
  }

  function updateTodayReviewState(value, itemId, action, { now = new Date(), snoozeDays = 7 } = {}) {
    const state = normalizeTodayReviewState(value);
    const id = asText(itemId).slice(0, 300);
    if (!id) return state;
    const nextItems = { ...state.items };
    if (action === 'clear') delete nextItems[id];
    else if (action === 'dismissed' || action === 'snoozed') {
      const at = new Date(now);
      const until = action === 'snoozed'
        ? new Date(at.getTime() + Math.max(1, Number(snoozeDays) || 7) * DAY_MS).toISOString()
        : '';
      nextItems[id] = { action, until, updatedAt: at.toISOString() };
    }
    const bounded = Object.fromEntries(Object.entries(nextItems)
      .sort((a, b) => asText(a[1]?.updatedAt).localeCompare(asText(b[1]?.updatedAt)))
      .slice(-200));
    return { version: REVIEW_STATE_VERSION, items: bounded };
  }

  function revisitHidden(item, reviewState, now) {
    const entry = reviewState.items[item.id];
    if (!entry) return false;
    if (entry.action === 'dismissed') return true;
    return entry.action === 'snoozed' && Date.parse(entry.until || '') > now.getTime();
  }

  function staleRevisitItems(items = []) {
    return items.map(item => ({
      kind: 'revisit',
      id: revisitKey('stale', item.noteId),
      noteId: asText(item.noteId),
      title: asText(item.noteTitle || 'Untitled'),
      reason: `Open task: ${asText(item.label || item.text || 'unfinished item')}`,
      sourceKind: 'stale-task',
    }));
  }

  function unlinkedRevisitItems(items = []) {
    return items.map(item => ({
      kind: 'revisit',
      id: revisitKey('unlinked', item.id),
      noteId: asText(item.id),
      title: asText(item.title || 'Untitled'),
      reason: 'Edited recently and not linked to another note',
      sourceKind: 'unlinked-note',
    }));
  }

  function resurfacedRevisitItems(items = []) {
    const reasons = {
      Pinned: 'Pinned context from the last few weeks',
      'Open loop': 'Contains an open checkbox',
      'Connected context': 'Connected context from the last few weeks',
      'Recently changed': 'Changed recently and not revisited',
    };
    return items.map(item => ({
      kind: 'revisit',
      id: revisitKey('resurfaced', item.id),
      noteId: asText(item.id),
      title: asText(item.title || 'Untitled'),
      reason: reasons[item.reason] || asText(item.reason || 'Relevant context from the last few weeks'),
      sourceKind: 'resurfaced-note',
    }));
  }

  function todayReviewItems({
    staleTasks = [], unlinkedNotes = [], resurfacedNotes = [], reviewState = {}, now = new Date(), limit = 3,
  } = {}) {
    const state = normalizeTodayReviewState(reviewState);
    const groups = [
      staleRevisitItems(staleTasks),
      unlinkedRevisitItems(unlinkedNotes),
      resurfacedRevisitItems(resurfacedNotes),
    ];
    const max = Math.max(1, Math.min(3, Number(limit) || 3));
    const result = [];
    const seenNotes = new Set();
    let index = 0;
    while (result.length < max && groups.some(group => index < group.length)) {
      for (const group of groups) {
        const item = group[index];
        if (!item || !item.noteId || seenNotes.has(item.noteId) || revisitHidden(item, state, now)) continue;
        seenNotes.add(item.noteId);
        result.push(item);
        if (result.length >= max) break;
      }
      index += 1;
    }
    return result;
  }

  return {
    REVIEW_STATE_VERSION,
    actionDate,
    actionIdentity,
    normalizeTodayReviewState,
    noteTouchesToday,
    todayActionableCount,
    todayActionableItems,
    todayKey,
    todayReviewItems,
    updateTodayReviewState,
  };
});
