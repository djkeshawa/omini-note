function scoreNoteForQuery(note, terms) {
  const title = String(note.title || '').toLowerCase();
  const tags = (note.tags || []).join(' ').toLowerCase();
  const body = String(note.body || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (title.includes(term)) score += 12;
    if (tags.includes(term)) score += 8;
    if (body.includes(term)) score += 2;
  }
  return score;
}

export function createActionRegistryHelpers(ctx) {
  const {
    activeCanvas, activeVault, activeVaultId, canvases, desktopBridge, hasDisk,
    markDirty, mutations, navigateView, notesWithBody, setNotes, setSelectedTag,
    setSelectedWorkflow, updateNoteBody, vaults,
  } = ctx;
  const stringArg = (maxLength = 160) => ({ type: 'string', maxLength });
  const integerArg = (defaultValue = 8) => ({ type: 'integer', default: defaultValue });
  const objectSchema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const updateNoteTagsById = (noteId, updater) => {
    if (!noteId) return;
    setNotes(ns => ns.map(note => {
      if (note.id !== noteId) return note;
      const nextTags = typeof updater === 'function' ? updater(note.tags || []) : updater;
      return mutations.applyNotePatch(note, { tags: Array.isArray(nextTags) ? nextTags : [] });
    }));
    markDirty(noteId);
  };
  const appendToBody = (note, content) => {
    const clean = String(content || '').trim();
    if (!note || !clean) return false;
    updateNoteBody(note.id, body => {
      const base = String(body || '').trimEnd();
      return `${base}${base ? '\n' : ''}${clean}`;
    });
    return true;
  };
  const cleanWikiTitle = (title) => String(title || '')
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/[#[\]\n\r]/g, '')
    .slice(0, 180);
  const resolveCanvas = (args = {}) => {
    if (args.canvasId) return (canvases || []).find(item => item.id === args.canvasId) || null;
    const title = String(args.canvasTitle || args.title || '').trim().toLowerCase();
    if (!title) return activeCanvas || null;
    return (canvases || []).find(item => String(item.title || '').trim().toLowerCase() === title)
      || (canvases || []).find(item => String(item.title || '').trim().toLowerCase().includes(title))
      || null;
  };
  const resolveVault = (args = {}) => {
    const id = String(args.vaultId || '').trim();
    if (id) return vaults.find(vault => vault.id === id) || null;
    const name = String(args.vaultName || args.name || '').trim().toLowerCase();
    if (!name) return activeVault || null;
    return vaults.find(vault => String(vault.name || '').trim().toLowerCase() === name)
      || vaults.find(vault => String(vault.name || '').trim().toLowerCase().includes(name))
      || null;
  };
  const searchNotesFast = async (query, limit = 8) => {
    const cleanQuery = String(query || '').trim();
    const max = Math.max(1, Math.min(Number(limit) || 8, 30));
    if (!cleanQuery) return [];
    if (hasDisk && activeVaultId && desktopBridge.search?.searchDetailedStatus) {
      try {
        const res = await desktopBridge.search.searchDetailedStatus(activeVaultId, cleanQuery, max);
        const value = res?.value;
        const rows = Array.isArray(value?.results) ? value.results
          : Array.isArray(value?.value?.results) ? value.value.results
            : Array.isArray(value) ? value
              : [];
        if (rows.length) {
          return rows.slice(0, max).map(row => ({
            id: row.id || row.noteId,
            title: row.title || 'Untitled',
            snippet: row.snippet || row.preview || row.bodySnippet || '',
            score: Number(row.score || row.rank || 0),
          })).filter(row => row.id);
        }
      } catch (e) {
        // Fall back to the in-memory search below; command execution should stay fast.
      }
    }
    const terms = cleanQuery.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
    return notesWithBody
      .map(note => ({
        id: note.id,
        title: note.title || 'Untitled',
        snippet: String(note.body || '').replace(/\s+/g, ' ').trim().slice(0, 220),
        score: scoreNoteForQuery(note, terms),
      }))
      .filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max);
  };
  const openView = (nextView) => {
    setSelectedTag(null);
    setSelectedWorkflow(null);
    navigateView(nextView);
    return { message: `Opened ${nextView}.` };
  };

  return {
    appendToBody,
    cleanWikiTitle,
    integerArg,
    objectSchema,
    openView,
    resolveCanvas,
    resolveVault,
    searchNotesFast,
    stringArg,
    updateNoteTagsById,
  };
}
