export function createActionResolvers(notes, selectedNote) {
  const byNoteId = (id) => notes.find(note => note.id === id) || null;
  const normalizeText = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/\s+/g, ' ');
  const normalizeKey = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, '');
  const noteTitleArg = (args = {}) => String(args.noteTitle || args.targetNoteTitle || '').trim();
  const scoreTitle = (note, queryTitle) => {
    const queryText = normalizeText(queryTitle);
    const queryKey = normalizeKey(queryTitle);
    const titleText = normalizeText(note.title || '');
    const titleKey = normalizeKey(note.title || '');
    if (!queryKey || !titleKey) return 0;
    if (titleKey === queryKey) return 1000;
    let score = 0;
    if (titleText === queryText) score += 900;
    if (titleText.includes(queryText) || queryText.includes(titleText)) score += 150;
    const terms = queryText.split(/[^a-z0-9_-]+/).filter(Boolean);
    const meaningfulTerms = terms.filter(term => !['note', 'page'].includes(term));
    let titleHits = 0;
    let meaningfulHits = 0;
    for (const term of terms) {
      if (!titleText.includes(term)) continue;
      score += term.length >= 4 ? 18 : 8;
      titleHits += 1;
      if (!['note', 'page'].includes(term)) meaningfulHits += 1;
    }
    if (meaningfulTerms.length >= 2 && meaningfulHits === meaningfulTerms.length) score += 90;
    if (terms.length && titleHits === terms.length) score += 80;
    return score;
  };
  const noteByTitle = (title) => {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return null;
    const scored = notes.map(note => ({ note, score: scoreTitle(note, cleanTitle) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return null;
    if (best.score >= 1000) return best.note;
    return best.score >= 80 && best.score >= (scored[1]?.score || 0) + 20 ? best.note : null;
  };
  const currentOrArgNote = (args = {}) => {
    if (args.noteId) return byNoteId(args.noteId);
    const title = noteTitleArg(args);
    return title ? noteByTitle(title) : selectedNote || null;
  };
  const metadataNote = (args = {}) => {
    if (args.noteId) return byNoteId(args.noteId);
    const title = noteTitleArg(args);
    return title ? noteByTitle(title) : selectedNote || null;
  };
  return {
    byNoteId,
    noteTitleArg,
    noteByTitle,
    currentOrArgNote,
    metadataNote,
    writableMetadataNote: metadataNote,
    writableBodyNote: currentOrArgNote,
    noteAffected: note => note ? [{ type: 'note', id: note.id, title: note.title || 'Untitled' }] : [],
  };
}
