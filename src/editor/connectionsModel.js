// Pure model for actionable note-connection suggestions.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_CONNECTIONS_MODEL = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function connectionNoteId(item) {
    return String(item?.noteId || item?.id || '').trim();
  }

  function suggestedConnections({ noteId = '', related = [], links = [], ignoredIds = [], limit = 4 } = {}) {
    const currentId = String(noteId || '');
    const ignored = new Set((ignoredIds || []).map(String));
    const connected = new Set();
    (links || []).forEach(link => {
      if (String(link?.source || '') === currentId && link?.target) connected.add(String(link.target));
      if (String(link?.target || '') === currentId && link?.source) connected.add(String(link.source));
    });
    const seen = new Set();
    return (related || []).filter(item => {
      const id = connectionNoteId(item);
      if (!id || id === currentId || ignored.has(id) || connected.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, Math.max(1, Number(limit) || 4));
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

  return { connectionNoteId, suggestedConnections, appendConnectionMarkdown };
});
