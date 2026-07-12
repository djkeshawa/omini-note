// Pure ranking and composition for the shared Notes + Actions palette.
// Kept free of React so keyboard and feature-availability behavior is testable.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const FREQUENT_ACTION_IDS = Object.freeze(['new-note', 'quick-capture', 'today', 'settings']);

  /**
   * @typedef {Object} PaletteItem
   * @property {'note'|'action'|'natural'|'create'} kind
   * @property {string} id
   * @property {string} title
   * @property {string} section
   * @property {Object=} note
   * @property {Object=} action
   * @property {Object=} naturalPlan
   * @property {string=} createTitle
   */

  function asText(value) {
    return String(value == null ? '' : value);
  }

  function isWordStart(text, index) {
    if (index === 0) return true;
    const prev = text[index - 1];
    return prev === ' ' || prev === '-' || prev === '_' || prev === '/' || prev === '.';
  }

  function mnFuzzyTitleScore(query, title) {
    const q = asText(query).trim().toLowerCase();
    const t = asText(title).toLowerCase();
    if (!q) return 0;
    if (!t) return null;
    if (t === q) return 1000;
    if (t.startsWith(q)) return 900 - Math.min(100, t.length);
    const substringAt = t.indexOf(q);
    if (substringAt >= 0) {
      const wordBonus = isWordStart(t, substringAt) ? 60 : 0;
      return 700 + wordBonus - Math.min(200, substringAt * 2) - Math.min(100, t.length);
    }
    let score = 400;
    let ti = 0;
    let previousHit = -2;
    for (const qc of q) {
      if (qc === ' ') continue;
      let found = -1;
      for (let i = ti; i < t.length; i++) {
        if (t[i] === qc) { found = i; break; }
      }
      if (found < 0) return null;
      if (found === previousHit + 1) score += 12;
      if (isWordStart(t, found)) score += 18;
      score -= Math.min(30, found - ti);
      previousHit = found;
      ti = found + 1;
    }
    return score - Math.min(100, t.length);
  }

  function noteRecency(note) {
    const stamp = note?.modifiedAt || note?.diskModifiedAt || note?.date || '';
    const time = Date.parse(stamp);
    return Number.isFinite(time) ? time : 0;
  }

  function mnQuickSwitcherResults({ notes = [], query = '', recentIds = [], limit = 12 } = {}) {
    const list = Array.isArray(notes) ? notes.filter(note => note && note.id) : [];
    const max = Math.max(1, Number(limit) || 12);
    const q = asText(query).trim();
    if (!q) {
      const byId = new Map(list.map(note => [note.id, note]));
      const recent = [];
      const seen = new Set();
      for (const id of Array.isArray(recentIds) ? recentIds : []) {
        const note = byId.get(id);
        if (!note || seen.has(id)) continue;
        seen.add(id);
        recent.push(note);
      }
      const rest = list
        .filter(note => !seen.has(note.id))
        .sort((a, b) => (!!b.pinned - !!a.pinned) || (noteRecency(b) - noteRecency(a)));
      return { items: [...recent, ...rest].slice(0, max), createTitle: null };
    }

    const scored = list
      .map(note => ({ note, score: mnFuzzyTitleScore(q, note.title) }))
      .filter(entry => entry.score != null)
      .sort((a, b) => (b.score - a.score) || (noteRecency(b.note) - noteRecency(a.note)));
    const qKey = q.toLowerCase();
    const hasExact = list.some(note => asText(note.title).trim().toLowerCase() === qKey);
    return {
      items: scored.slice(0, max).map(entry => entry.note),
      createTitle: hasExact ? null : q,
    };
  }

  function commandScore(query, command) {
    const q = asText(query).trim().toLowerCase();
    if (!q) return 0;
    const titleScore = mnFuzzyTitleScore(q, command?.title || command?.label || '');
    const supportingText = [command?.section, command?.keywords, command?.description]
      .map(asText)
      .join(' ')
      .toLowerCase();
    const supportingAt = supportingText.indexOf(q);
    const supportingScore = supportingAt < 0 ? null : 520 - Math.min(200, supportingAt);
    if (titleScore == null) return supportingScore;
    if (supportingScore == null) return titleScore;
    return Math.max(titleScore, supportingScore);
  }

  function availableCommands(commands = []) {
    return (Array.isArray(commands) ? commands : []).filter(command => command && command.id && command.enabled !== false);
  }

  function actionItems(commands, query, limit = 8) {
    const available = availableCommands(commands);
    const q = asText(query).trim();
    if (!q) {
      const byId = new Map(available.map(command => [command.id, command]));
      return FREQUENT_ACTION_IDS
        .map(id => byId.get(id))
        .filter(Boolean)
        .slice(0, 4)
        .map(action => ({
          kind: 'action',
          id: `action-${action.id}`,
          title: action.title || action.label || action.id,
          section: 'Frequent action',
          action,
        }));
    }
    return available
      .map(action => ({ action, score: commandScore(q, action) }))
      .filter(entry => entry.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Number(limit) || 8))
      .map(({ action }) => ({
        kind: 'action',
        id: `action-${action.id}`,
        title: action.title || action.label || action.id,
        section: action.section || 'Action',
        action,
      }));
  }

  function naturalItem(naturalPlan, commands, existingItems) {
    const steps = Array.isArray(naturalPlan?.steps) ? naturalPlan.steps : [];
    if (!steps.length) return null;
    const availableIds = new Set(availableCommands(commands).map(command => command.id));
    if (!steps.every(step => availableIds.has(step.actionId))) return null;
    if (steps.length === 1 && existingItems.some(item => item.action?.id === steps[0].actionId)) return null;
    const first = steps[0];
    return {
      kind: 'natural',
      id: `natural-${steps.map(step => step.actionId).join('-')}`,
      title: naturalPlan.title || first.label || 'Run app action',
      section: steps.length > 1 ? `${steps.length} interpreted actions` : 'Interpreted request',
      naturalPlan,
    };
  }

  function mnPaletteItems({
    notes = [], commands = [], query = '', recentIds = [], mode = 'mixed', naturalPlan = null, limit = 14,
  } = {}) {
    const q = asText(query).trim();
    const noteResults = mnQuickSwitcherResults({ notes, query: q, recentIds, limit: q ? 8 : 6 });
    const notesItems = noteResults.items.map(note => ({
      kind: 'note',
      id: `note-${note.id}`,
      title: note.title || 'Untitled',
      section: q ? 'Note' : 'Recent note',
      note,
    }));
    const actions = actionItems(commands, q, q ? 8 : 4);
    if (q) {
      const interpreted = naturalItem(naturalPlan, commands, actions);
      if (interpreted) actions.unshift(interpreted);
    }
    const max = Math.max(2, Number(limit) || 14);
    const create = q && noteResults.createTitle
      ? {
          kind: 'create',
          id: 'create-note',
          title: `Create note “${noteResults.createTitle}”`,
          section: 'Create',
          createTitle: noteResults.createTitle,
        }
      : null;
    if (create && mode === 'notes') {
      return [...notesItems, create, ...actions].slice(0, max);
    }
    const ordered = q && mode !== 'notes'
      ? [...actions, ...notesItems]
      : [...notesItems, ...actions];
    return create
      ? [...ordered.slice(0, max - 1), create]
      : ordered.slice(0, max);
  }

  function mnPushRecentNoteId(recentIds, noteId, cap = 20) {
    const id = asText(noteId);
    if (!id) return Array.isArray(recentIds) ? recentIds : [];
    const next = [id, ...(Array.isArray(recentIds) ? recentIds : []).filter(item => item !== id)];
    return next.slice(0, Math.max(1, Number(cap) || 20));
  }

  return {
    FREQUENT_ACTION_IDS,
    mnFuzzyTitleScore,
    mnPaletteItems,
    mnPushRecentNoteId,
    mnQuickSwitcherResults,
  };
});
