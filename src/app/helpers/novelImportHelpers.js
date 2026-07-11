function createNovelImportHelpers(scope = {}) {
  const NOVEL_IMPORT_KIND_TAGS = scope.NOVEL_IMPORT_KIND_TAGS;
  const bodyPropertyTitle = (...args) => scope.bodyPropertyTitle(...args);
  const bodyPropertyValue = (...args) => scope.bodyPropertyValue(...args);
  const ensureScenePlotPoints = (...args) => scope.ensureScenePlotPoints(...args);
  const normalizeNoteBody = (...args) => scope.normalizeNoteBody(...args);
  const novelEnsureWikiLinkInSection = (...args) => scope.novelEnsureWikiLinkInSection(...args);
  const novelTitleKey = (...args) => scope.novelTitleKey(...args);
  const novelUpsertPropertyLink = (...args) => scope.novelUpsertPropertyLink(...args);
  const novelistNoteId = (...args) => scope.novelistNoteId(...args);
  const setBodyProperty = (...args) => scope.setBodyProperty(...args);
  function normalizeNovelImportKind(value = '') {
    const clean = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (clean === 'act' || clean === 'part') return 'act';
    if (clean === 'chapter') return 'chapter';
    if (clean === 'scene' || clean === 'story' || clean === 'draft') return 'scene';
    if (clean === 'character' || clean === 'cast') return 'character';
    if (clean === 'location' || clean === 'setting' || clean === 'place') return 'location';
    if (clean === 'plot' || clean === 'thread' || clean === 'outline') return 'plot';
    if (clean === 'research' || clean === 'worldbuilding' || clean === 'world-building') return 'research';
    if (clean === 'revision' || clean === 'todo' || clean === 'note') return 'revision';
    return '';
  }
  
  function novelImportTagForKind(kind = '') {
    return NOVEL_IMPORT_KIND_TAGS[normalizeNovelImportKind(kind)] || '';
  }
  
  function cleanNovelImportTitle(value = '', fallback = 'Imported Note') {
    const clean = String(value || '')
      .replace(/\[\[|\]\]/g, '')
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return clean || fallback;
  }
  
  function cleanNovelImportText(value = '', limit = 12000) {
    return String(value || '').replace(/\0/g, '').replace(/\r\n/g, '\n').trim().slice(0, limit);
  }
  
  function cleanNovelImportList(value = [], limit = 16) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/\r?\n|;/);
    return source
      .map(item => cleanNovelImportText(item, 240).replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
      .filter((item, index, arr) => arr.findIndex(other => other.toLowerCase() === item.toLowerCase()) === index)
      .slice(0, limit);
  }
  
  function normalizeNovelImportCandidate(raw = {}, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = normalizeNovelImportKind(raw.kind || raw.type || raw.noteType || raw.category);
    const tag = novelImportTagForKind(kind);
    if (!kind || !tag) return null;
    const title = cleanNovelImportTitle(raw.title || raw.name, `Imported ${kind} ${index + 1}`);
    return {
      title,
      kind,
      tag,
      body: cleanNovelImportText(raw.body || raw.content || raw.summary || raw.text || ''),
      actTitle: cleanNovelImportText(raw.actTitle || raw.act || '', 160).replace(/^\[\[|\]\]$/g, ''),
      chapterTitle: cleanNovelImportText(raw.chapterTitle || raw.chapter || '', 160).replace(/^\[\[|\]\]$/g, ''),
      order: cleanNovelImportText(raw.order || '', 40),
      pov: cleanNovelImportText(raw.pov || raw.pointOfView || '', 120),
      purpose: cleanNovelImportText(raw.purpose || raw.goal || '', 500),
      sourceFile: cleanNovelImportText(raw.sourceFile || raw.source || '', 180),
      confidence: cleanNovelImportText(raw.confidence || '', 40),
      plotPoints: cleanNovelImportList(raw.plotPoints || raw.beats || raw.outline || []),
    };
  }
  
  function normalizeNovelImportCandidates(value) {
    const source = Array.isArray(value)
      ? value
      : Array.isArray(value?.notes) ? value.notes
      : Array.isArray(value?.candidates) ? value.candidates
      : Array.isArray(value?.items) ? value.items
      : [];
    return source
      .map((item, index) => normalizeNovelImportCandidate(item, index))
      .filter(Boolean);
  }
  
  function novelImportRelations(candidates = []) {
    const chaptersByAct = new Map();
    const scenesByChapter = new Map();
    const add = (map, parent, child) => {
      const key = novelTitleKey(parent);
      if (!key || !child) return;
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (!list.some(item => novelTitleKey(item) === novelTitleKey(child))) list.push(child);
    };
    candidates.forEach(candidate => {
      if (candidate.kind === 'chapter') add(chaptersByAct, candidate.actTitle, candidate.title);
      if (candidate.kind === 'scene') add(scenesByChapter, candidate.chapterTitle, candidate.title);
    });
    return { chaptersByAct, scenesByChapter };
  }
  
  function novelImportPropertyLines(candidate) {
    const lines = [];
    if (candidate.kind === 'act' || candidate.kind === 'chapter' || candidate.kind === 'scene' || candidate.kind === 'plot' || candidate.kind === 'revision') {
      lines.push(`status:: ${candidate.kind === 'scene' ? 'DRAFT' : 'OUTLINE'}`);
    }
    if (candidate.order) lines.push(`order:: ${candidate.order}`);
    if ((candidate.kind === 'chapter' || candidate.kind === 'scene') && candidate.actTitle) lines.push(`act:: [[${candidate.actTitle}]]`);
    if (candidate.kind === 'scene' && candidate.chapterTitle) lines.push(`chapter:: [[${candidate.chapterTitle}]]`);
    if (candidate.kind === 'scene' && candidate.pov) lines.push(`pov:: ${candidate.pov}`);
    if (candidate.purpose) lines.push(`purpose:: ${candidate.purpose}`);
    if (candidate.sourceFile && !['act', 'chapter', 'scene'].includes(candidate.kind)) lines.push(`source:: ${candidate.sourceFile}`);
    return lines;
  }
  
  function novelImportDetails(candidate) {
    const lines = [];
    if (candidate.sourceFile && ['act', 'chapter', 'scene'].includes(candidate.kind)) lines.push(`source:: ${candidate.sourceFile}`);
    if (candidate.body) lines.push(candidate.body);
    return lines.join('\n').trim();
  }
  
  function novelImportLinkLines(titles = []) {
    return (titles || []).filter(Boolean).map(title => `- [[${title}]]`);
  }
  
  function buildNovelImportBody(candidate, relations = {}) {
    const propLines = novelImportPropertyLines(candidate);
    const details = novelImportDetails(candidate);
    const chunks = [];
    if (propLines.length) chunks.push(propLines.join('\n'));
    if (candidate.kind === 'act') {
      const chapters = novelImportLinkLines(relations.chaptersByAct?.get(novelTitleKey(candidate.title)) || []);
      chunks.push(['## Chapters', ...(chapters.length ? chapters : ['- Major turn'])].join('\n'));
      if (details) chunks.push(`## Imported Details\n${details}`);
    } else if (candidate.kind === 'chapter') {
      const scenes = novelImportLinkLines(relations.scenesByChapter?.get(novelTitleKey(candidate.title)) || []);
      chunks.push(['## Scenes', ...(scenes.length ? scenes : ['- Scene list'])].join('\n'));
      if (details) chunks.push(`## Imported Details\n${details}`);
    } else if (candidate.kind === 'scene') {
      const points = candidate.plotPoints.length ? candidate.plotPoints : ['Opening beat'];
      chunks.push(['::: plot-points', ...points.map(point => `- ${point}`), ':::'].join('\n'));
      chunks.push(details || 'Draft the scene here.');
    } else {
      chunks.push(details || `- Imported ${candidate.kind} detail`);
    }
    return normalizeNoteBody(ensureScenePlotPoints(chunks.join('\n\n'), [candidate.tag]), candidate.title);
  }
  
  function appendNovelImportDetails(body = '', candidate) {
    const details = novelImportDetails(candidate);
    if (!details) return body || '';
    const source = String(body || '').trimEnd();
    const meaningful = candidate.body || details;
    if (meaningful && source.toLowerCase().includes(meaningful.slice(0, 160).toLowerCase())) return body || '';
    return `${source}${source ? '\n\n' : ''}## Imported Details\n${details}`;
  }
  
  function mergeNovelImportBody(note, candidate, relations = {}) {
    let body = normalizeNoteBody(note?.body || '', note?.title || candidate.title);
    if (candidate.kind === 'act') {
      if (candidate.order && !bodyPropertyValue(body, 'order')) body = setBodyProperty(body, 'order', candidate.order);
      if (candidate.purpose && !bodyPropertyValue(body, 'purpose')) body = setBodyProperty(body, 'purpose', candidate.purpose);
      (relations.chaptersByAct.get(novelTitleKey(candidate.title)) || []).forEach(title => {
        body = novelEnsureWikiLinkInSection(body, title, 'Chapters');
      });
    } else if (candidate.kind === 'chapter') {
      if (candidate.order && !bodyPropertyValue(body, 'order')) body = setBodyProperty(body, 'order', candidate.order);
      if (candidate.actTitle && !bodyPropertyTitle(body, 'act')) body = novelUpsertPropertyLink(body, 'act', candidate.actTitle);
      if (candidate.purpose && !bodyPropertyValue(body, 'purpose')) body = setBodyProperty(body, 'purpose', candidate.purpose);
      (relations.scenesByChapter.get(novelTitleKey(candidate.title)) || []).forEach(title => {
        body = novelEnsureWikiLinkInSection(body, title, 'Scenes');
      });
    } else if (candidate.kind === 'scene') {
      if (candidate.order && !bodyPropertyValue(body, 'order')) body = setBodyProperty(body, 'order', candidate.order);
      if (candidate.actTitle && !bodyPropertyTitle(body, 'act')) body = novelUpsertPropertyLink(body, 'act', candidate.actTitle);
      if (candidate.chapterTitle && !bodyPropertyTitle(body, 'chapter')) body = novelUpsertPropertyLink(body, 'chapter', candidate.chapterTitle);
      if (candidate.pov && !bodyPropertyValue(body, 'pov')) body = setBodyProperty(body, 'pov', candidate.pov);
      if (candidate.purpose && !bodyPropertyValue(body, 'purpose')) body = setBodyProperty(body, 'purpose', candidate.purpose);
      body = ensureScenePlotPoints(body, [candidate.tag]);
    } else {
      body = appendNovelImportDetails(body, candidate);
    }
    return normalizeNoteBody(ensureScenePlotPoints(body, [candidate.tag]), note?.title || candidate.title);
  }
  
  function isNovelImportCompatible(note, candidate) {
    return !!note && (note.tags || []).includes(candidate.tag);
  }
  
  function uniqueNovelImportId(title, vaultId, usedIds, index) {
    let id = novelistNoteId(title, vaultId, `import_${index + 1}`);
    let suffix = 2;
    while (usedIds.has(id)) id = `${novelistNoteId(title, vaultId, `import_${index + 1}`)}_${suffix++}`;
    usedIds.add(id);
    return id;
  }
  
  function uniqueNovelImportTitle(notes = [], rawTitle = 'Untitled') {
    const base = cleanNovelImportTitle(rawTitle, 'Untitled');
    const existing = new Set((notes || []).map(note => String(note.title || '').trim().toLowerCase()).filter(Boolean));
    if (!existing.has(base.toLowerCase())) return base;
    let index = 2;
    while (existing.has(`${base} ${index}`.toLowerCase())) index++;
    return `${base} ${index}`;
  }
  
  function buildNovelImportPlan(rawCandidates = [], existingNotes = [], options = {}) {
    const candidates = normalizeNovelImportCandidates(rawCandidates);
    const now = options.now || new Date().toISOString();
    const relations = novelImportRelations(candidates);
    const existing = (existingNotes || []).map(note => ({ ...note }));
    const nextNotes = [...existing];
    const byTitle = new Map(existing.map(note => [novelTitleKey(note.title), note]));
    const usedIds = new Set(existing.map(note => note.id).filter(Boolean));
    const created = [];
    const updated = [];
    const skipped = [];
    const changedIds = [];
  
    candidates.forEach((candidate, index) => {
      const key = novelTitleKey(candidate.title);
      const matching = byTitle.get(key);
      if (matching && isNovelImportCompatible(matching, candidate)) {
        const mergedBody = mergeNovelImportBody(matching, candidate, relations);
        if (mergedBody === (matching.body || '')) {
          skipped.push({ title: matching.title, kind: candidate.kind, reason: 'No safe changes' });
          return;
        }
        const merged = { ...matching, body: mergedBody, modifiedAt: now };
        const noteIndex = nextNotes.findIndex(note => note.id === matching.id);
        if (noteIndex >= 0) nextNotes[noteIndex] = merged;
        byTitle.set(key, merged);
        updated.push({ id: merged.id, title: merged.title, kind: candidate.kind, tag: candidate.tag });
        changedIds.push(merged.id);
        return;
      }
  
      const title = uniqueNovelImportTitle(nextNotes, candidate.title);
      const titledCandidate = { ...candidate, title };
      const body = buildNovelImportBody(titledCandidate, relations);
      const note = {
        id: uniqueNovelImportId(title, options.vaultId || '', usedIds, index),
        title,
        body,
        tags: [candidate.tag],
        pinned: candidate.kind === 'act' && !nextNotes.some(item => (item.tags || []).includes('novel-act')),
        date: now,
        modifiedAt: now,
      };
      nextNotes.unshift(note);
      byTitle.set(novelTitleKey(title), note);
      created.push({ id: note.id, title, kind: candidate.kind, tag: candidate.tag });
      changedIds.push(note.id);
    });
  
    return {
      notes: nextNotes,
      candidates,
      created,
      updated,
      skipped,
      changedIds: changedIds.filter((id, index, arr) => id && arr.indexOf(id) === index),
      summary: {
        candidates: candidates.length,
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
      },
    };
  }
  return { normalizeNovelImportKind, novelImportTagForKind, cleanNovelImportTitle, cleanNovelImportText, cleanNovelImportList, normalizeNovelImportCandidate, normalizeNovelImportCandidates, novelImportRelations, novelImportPropertyLines, novelImportDetails, novelImportLinkLines, buildNovelImportBody, appendNovelImportDetails, mergeNovelImportBody, isNovelImportCompatible, uniqueNovelImportId, uniqueNovelImportTitle, buildNovelImportPlan };
}

module.exports = { createNovelImportHelpers };
