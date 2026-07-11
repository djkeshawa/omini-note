function buildNovelistStatusModel({ acts, chapters, scenes, childrenForAct, childrenForChapter, byTag, bodyPropertyValue }) {
  const plainNoteText = (note) => String(note?.body || '')
    .replace(/::: plot-points[\s\S]*?:::/g, ' ')
    .split('\n')
    .filter(line => !/^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line))
    .join(' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#*_`>|-]/g, ' ');
  const wordCountForNote = (note) => plainNoteText(note).trim().split(/\s+/).filter(Boolean).length;
  const statusForNote = (note) => String((typeof bodyPropertyValue === 'function' ? bodyPropertyValue(note?.body || '', 'status') : '') || '').trim().toUpperCase() || 'NONE';
  const statRows = acts.map(act => {
    const actChapters = childrenForAct(act);
    const actScenes = actChapters.flatMap(chapter => childrenForChapter(chapter));
    return {
      act,
      chapters: actChapters,
      scenes: actScenes,
      words: wordCountForNote(act) + actChapters.reduce((sum, chapter) => sum + wordCountForNote(chapter), 0) + actScenes.reduce((sum, scene) => sum + wordCountForNote(scene), 0),
    };
  });
  const totalDraftWords = [...acts, ...chapters, ...scenes].reduce((sum, note) => sum + wordCountForNote(note), 0);
  const averageWordsPerScene = scenes.length ? Math.round(scenes.reduce((sum, scene) => sum + wordCountForNote(scene), 0) / scenes.length) : 0;
  const statusCounts = [...acts, ...chapters, ...scenes].reduce((acc, note) => {
    const key = statusForNote(note);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const characterNotes = byTag('novel-character');
  const characterAliases = characterNotes.map(note => {
    const readProp = (key) => (typeof bodyPropertyValue === 'function' ? bodyPropertyValue(note.body || '', key) : '')
      .split(',')
      .map(value => value.replace(/\[\[([^\]]+)\]\]/g, '$1').trim())
      .filter(Boolean);
    const aliases = [...readProp('names'), ...readProp('name'), note.title || 'Untitled']
      .filter((value, index, arr) => arr.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index);
    return { note, aliases };
  });
  const sceneHaystacks = scenes.map(scene => plainNoteText(scene).toLowerCase());
  const characterSceneCounts = characterAliases.map(character => {
    const aliasRegexes = character.aliases.map(alias => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'gi');
    });
    return {
      ...character,
      sceneCounts: sceneHaystacks.map(haystack => aliasRegexes.reduce(
        (sum, regex) => sum + ((haystack.match(regex) || []).length), 0)),
    };
  });
  const maxCharacterHits = Math.max(1, ...characterSceneCounts.flatMap(row => row.sceneCounts));
  const completionCoverage = scenes.length
    ? Math.round((scenes.filter(scene => statusForNote(scene) === 'FINAL').length / scenes.length) * 100)
    : 0;
  return { wordCountForNote, statRows, totalDraftWords, averageWordsPerScene, statusCounts, characterSceneCounts, maxCharacterHits, completionCoverage };
}

export { buildNovelistStatusModel };
