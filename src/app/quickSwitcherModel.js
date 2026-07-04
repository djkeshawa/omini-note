// Pure matching/ordering logic for the quick switcher (Ctrl/Cmd+P).
// Kept free of React so the ranking behavior is unit-testable in Node.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_QUICK_SWITCHER_MODEL = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function asText(value) {
    return String(value == null ? '' : value);
  }

  function isWordStart(text, index) {
    if (index === 0) return true;
    const prev = text[index - 1];
    return prev === ' ' || prev === '-' || prev === '_' || prev === '/' || prev === '.';
  }

  // Higher is better; null means the query does not match the title at all.
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
    // Subsequence match: every query character in order, scored by tightness.
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

  // Returns { items, createTitle }. Items are notes ordered best-first; when
  // the query is empty, recently opened notes (recentIds order) lead, followed
  // by the rest sorted pinned-first then most recently modified. createTitle
  // is the query when no note title matches it exactly (offer "create note").
  function mnQuickSwitcherResults({ notes = [], query = '', recentIds = [], limit = 12 } = {}) {
    const list = Array.isArray(notes) ? notes.filter(n => n && n.id) : [];
    const max = Math.max(1, Number(limit) || 12);
    const q = asText(query).trim();

    if (!q) {
      const byId = new Map(list.map(n => [n.id, n]));
      const recent = [];
      const seen = new Set();
      for (const id of Array.isArray(recentIds) ? recentIds : []) {
        const note = byId.get(id);
        if (!note || seen.has(id)) continue;
        seen.add(id);
        recent.push(note);
      }
      const rest = list
        .filter(n => !seen.has(n.id))
        .sort((a, b) => (!!b.pinned - !!a.pinned) || (noteRecency(b) - noteRecency(a)));
      return { items: [...recent, ...rest].slice(0, max), createTitle: null };
    }

    const scored = [];
    for (const note of list) {
      const score = mnFuzzyTitleScore(q, note.title);
      if (score == null) continue;
      scored.push({ note, score });
    }
    scored.sort((a, b) => (b.score - a.score) || (noteRecency(b.note) - noteRecency(a.note)));
    const qKey = q.toLowerCase();
    const hasExact = list.some(n => asText(n.title).trim().toLowerCase() === qKey);
    return {
      items: scored.slice(0, max).map(entry => entry.note),
      createTitle: hasExact ? null : q,
    };
  }

  // Maintains the most-recently-opened note id list (newest first, deduped).
  function mnPushRecentNoteId(recentIds, noteId, cap = 20) {
    const id = asText(noteId);
    if (!id) return Array.isArray(recentIds) ? recentIds : [];
    const next = [id, ...(Array.isArray(recentIds) ? recentIds : []).filter(item => item !== id)];
    return next.slice(0, Math.max(1, Number(cap) || 20));
  }

  return {
    mnFuzzyTitleScore,
    mnQuickSwitcherResults,
    mnPushRecentNoteId,
  };
});
