// Pure model for actionable note-connection suggestions.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function connectionNoteId(item) {
    return String(item?.noteId || item?.id || '').trim();
  }

  const STOP_WORDS = new Set(['about', 'after', 'before', 'from', 'into', 'note', 'notes', 'that', 'the', 'this', 'with', 'your']);

  function connectionTitleTokens(value) {
    return [...new Set(String(value || '').toLowerCase().split(/[^a-z0-9_-]+/).filter(token => token.length >= 3 && !STOP_WORDS.has(token)))];
  }

  // The current note's tags and title tokens are the same for every candidate,
  // so a caller scoring a whole pool builds them once and passes them in.
  // Without that this re-tokenized the current note 800 times per run.
  function connectionCurrentSignals(currentNote) {
    return {
      currentTags: new Set((currentNote?.tags || []).map(tag => String(tag).toLowerCase())),
      currentTokens: new Set(connectionTitleTokens(currentNote?.title)),
    };
  }

  function connectionCandidateScore(currentNote, candidate, relatedRank = -1, mode = '', signals = null) {
    const { currentTags, currentTokens } = signals || connectionCurrentSignals(currentNote);
    const sharedTags = (candidate?.tags || []).map(tag => String(tag).toLowerCase()).filter(tag => currentTags.has(tag));
    const sharedTitleTokens = connectionTitleTokens(candidate?.title).filter(token => currentTokens.has(token));
    let score = 0;
    const reasons = [];
    if (relatedRank >= 0) {
      score += 100 - Math.min(60, relatedRank * 4);
      reasons.push(mode === 'semantic' ? 'Similar meaning' : 'Similar wording');
    }
    if (sharedTags.length) {
      score += 38 + Math.min(24, sharedTags.length * 8);
      reasons.push(`Shares #${sharedTags[0]}`);
    }
    if (sharedTitleTokens.length) {
      score += 24 + Math.min(18, sharedTitleTokens.length * 6);
      reasons.push(`Both mention ${sharedTitleTokens[0]}`);
    }
    return { score, reason: reasons.slice(0, 2).join(' · '), reasons, sharedTags, sharedTitleTokens };
  }

  function suggestedConnections({ noteId = '', currentNote = null, notes = [], related = [], mode = '', links = [], ignoredIds = [], limit = 4, candidateLimit = 800 } = {}) {
    const currentId = String(noteId || '');
    const ignored = new Set((ignoredIds || []).map(String));
    const connected = new Set();
    (links || []).forEach(link => {
      if (String(link?.source || '') === currentId && link?.target) connected.add(String(link.target));
      if (String(link?.target || '') === currentId && link?.source) connected.add(String(link.source));
    });
    const relatedRank = new Map((related || []).map((item, index) => [connectionNoteId(item), index]));
    const noteById = new Map((notes || []).map(note => [String(note?.id || ''), note]));
    const candidates = new Map();
    (related || []).forEach(item => {
      const id = connectionNoteId(item);
      if (id) candidates.set(id, { ...(noteById.get(id) || {}), ...item, noteId: id });
    });
    const deterministicPool = (notes || []).length > candidateLimit
      ? (notes || []).slice(-candidateLimit)
      : (notes || []);
    deterministicPool.forEach(note => {
      const id = connectionNoteId(note);
      if (id && !candidates.has(id)) candidates.set(id, { ...note, noteId: id });
    });
    const ranked = [];
    const signals = connectionCurrentSignals(currentNote);
    for (const item of candidates.values()) {
      const id = connectionNoteId(item);
      if (!id || id === currentId || ignored.has(id) || connected.has(id)) continue;
      const signal = connectionCandidateScore(currentNote, item, relatedRank.has(id) ? relatedRank.get(id) : -1, mode, signals);
      if (signal.score <= 0) continue;
      ranked.push({ ...item, noteId: id, reason: signal.reason, reasons: signal.reasons, connectionScore: signal.score });
    }
    return ranked
      .sort((a, b) => b.connectionScore - a.connectionScore || String(a.title || '').localeCompare(String(b.title || '')))
      .slice(0, Math.max(1, Number(limit) || 4));
  }

  function appendConnectionMarkdown(body = '', title = '') {
    const cleanTitle = String(title || '').trim().replace(/[\[\]]/g, '');
    const source = String(body || '').replace(/\s+$/, '');
    if (!cleanTitle) return source;
    const escaped = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\[\\[${escaped}\\]\\]`, 'i').test(source)) return source;
    const line = `- [[${cleanTitle}]]`;
    if (/^## Connections\s*$/im.test(source)) {
      const lines = source.split('\n');
      const headingIndex = lines.findIndex(value => /^## Connections\s*$/i.test(value));
      let insertAt = headingIndex + 1;
      while (insertAt < lines.length && !/^##\s+/.test(lines[insertAt])) insertAt++;
      lines.splice(insertAt, 0, line);
      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    }
    return `${source}${source ? '\n\n' : ''}## Connections\n${line}`;
  }

  return { connectionNoteId, connectionTitleTokens, connectionCurrentSignals, connectionCandidateScore, suggestedConnections, appendConnectionMarkdown };
});
