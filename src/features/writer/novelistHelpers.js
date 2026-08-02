function createNovelistHelpers(scope = {}) {

  function reminderDisplayDate(item) {
    const at = item?.remindAt?.at;
    if (!at) return '';
    return at.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  
  function reminderStatusLabel(status) {
    if (status === 'due') return 'Due';
    if (status === 'snoozed') return 'Snoozed';
    return 'Upcoming';
  }
  
  function slugKey(value = '') {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  
  function novelistNoteId(title, vaultId = '', fallback = Date.now().toString(36)) {
    const slug = slugKey(title) || fallback;
    const vaultSlug = slugKey(vaultId);
    return `n_novel_${vaultSlug ? `${vaultSlug}_` : ''}${slug}`;
  }
  
  function ensureNovelistTags(existingTags = [], novelistTags = []) {
    const byName = new Map((existingTags || []).map(tag => [tag.name, tag]));
    (novelistTags || []).forEach(tag => {
      if (!byName.has(tag.name)) byName.set(tag.name, tag);
    });
    return [...byName.values()];
  }
  
  function dirtyNoteKey(vaultId, noteId) {
    return `${String(vaultId || '')}::${String(noteId || '')}`;
  }
  
  function isNovelistNote(note) {
    return (note?.tags || []).some(tag => String(tag || '').startsWith('novel-'));
  }
  
  function normalizeNovelistLegacyTags(tags = []) {
    return (tags || [])
      .map(tag => tag === 'novel-arc' ? 'novel-act' : tag)
      .filter(tag => tag !== 'novel-manuscript' && tag !== 'novel-storyRoot')
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
  }
  
  function normalizeNovelistLegacyBody(body = '') {
    return String(body || '')
      .split('\n')
      .map(line => {
        const prop = line.match(/^(\s*(?:-\s*)?)arc(::\s*.*)$/i);
        if (prop) return `${prop[1]}act${prop[2]}`;
        return line.replace(/^(##+\s+)Arcs\s*$/i, '$1Acts');
      })
      .join('\n');
  }
  
  function bodyPropertyLineRe(key = '') {
    const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\s*(?:-\\s*)?${safeKey}::\\s*(.*)$`, 'im');
  }
  
  function bodyPropertyValue(body = '', key = '') {
    if (!key) return '';
    const match = String(body || '').match(bodyPropertyLineRe(key));
    return match ? String(match[1] || '').trim() : '';
  }
  
  function bodyPropertyTitle(body = '', key = '') {
    const value = bodyPropertyValue(body, key);
    const wiki = value.match(/^\[\[([^\]]+)\]\]/);
    // Strip the alias as well as the anchor, matching novelTitleKey below: a
    // hand-edited "act:: [[Act One|Act I]]" must still resolve to Act One, or
    // the chapter silently falls out of its act.
    return String(wiki ? wiki[1] : value).split('|')[0].replace(/#[^\]]+$/, '').trim();
  }
  
  function bodyPropertyInsertIndex(lines = []) {
    const isPropLine = (line) => /^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line);
    const headingIndex = lines.findIndex(line => /^#{1,3}\s+/.test(line));
    let index = headingIndex >= 0 ? headingIndex + 1 : 0;
    while (index < lines.length && isPropLine(lines[index])) index++;
    return index;
  }
  
  function setBodyProperty(body = '', key = '', value = '') {
    const cleanKey = String(key || '').trim();
    const cleanValue = String(value ?? '').trim();
    if (!cleanKey) return body || '';
    if (!cleanValue) return removeBodyProperty(body, cleanKey);
    const source = String(body || '');
    const lineRe = bodyPropertyLineRe(cleanKey);
    if (lineRe.test(source)) return source.replace(lineRe, () => `${cleanKey}:: ${cleanValue}`);
    const lines = source.split('\n');
    lines.splice(bodyPropertyInsertIndex(lines), 0, `${cleanKey}:: ${cleanValue}`);
    return lines.join('\n');
  }
  
  function removeBodyProperty(body = '', key = '') {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return body || '';
    const safeKey = cleanKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(body || '')
      .split('\n')
      .filter(line => !(new RegExp(`^\\s*-?\\s*${safeKey}::\\s*`, 'i')).test(line))
      .join('\n');
  }
  
  function bodyPropertyParts(line = '') {
    const match = String(line || '').match(/^\s*(?:-\s*)?([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
    return match ? { key: match[1], value: match[2] || '' } : null;
  }
  
  function normalizeBodyPropertySyntax(body = '') {
    const lines = String(body || '').split('\n');
    let inFence = false;
    return lines.map(line => {
      if (/^```\s*/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const prop = bodyPropertyParts(line);
      return prop ? `${prop.key}:: ${prop.value}`.trimEnd() : line;
    }).join('\n');
  }
  
  function stripDuplicateTitleHeading(body = '', title = '') {
    const source = String(body || '');
    const cleanTitle = String(title || '').trim().toLowerCase();
    if (!cleanTitle) return source;
    const lines = source.split('\n');
    let first = 0;
    while (first < lines.length && !lines[first].trim()) first++;
    const heading = lines[first]?.match(/^#\s+(.*)$/);
    if (!heading || String(heading[1] || '').trim().toLowerCase() !== cleanTitle) return source;
    lines.splice(first, 1);
    while (lines.length && !lines[0].trim()) lines.shift();
    return lines.join('\n');
  }
  
  function normalizeNoteBody(body = '', title = '') {
    return normalizeBodyPropertySyntax(stripDuplicateTitleHeading(body, title));
  }
  
  function ensureScenePlotPoints(body = '', tags = []) {
    if (!(tags || []).includes('novel-scene')) return body || '';
    const source = String(body || '');
    if (/^:::\s*plot-points\s*$/im.test(source)) return source;
    const lines = source.split('\n');
    const insertAt = bodyPropertyInsertIndex(lines);
    lines.splice(insertAt, 0, '::: plot-points', '- Opening beat', ':::');
    return lines.join('\n');
  }
  
  function novelTitleKey(title) {
    return String(title || '')
      .split('|')[0]
      .replace(/#[^\]]+$/, '')
      .trim()
      .toLowerCase();
  }
  
  function novelWikiTitles(body = '') {
    return [...String(body || '').matchAll(/\[\[([^\]]+)\]\]/g)]
      .map(match => match[1].trim())
      .filter(Boolean);
  }
  
  function replaceWikiLinkTitle(body = '', oldTitle = '', newTitle = '') {
    const oldKey = novelTitleKey(oldTitle);
    const cleanNewTitle = String(newTitle || '').trim();
    if (!oldKey || !cleanNewTitle) return body || '';
    return String(body || '').replace(/\[\[([^\]]+)\]\]/g, (match, rawTarget) => {
      const target = String(rawTarget || '');
      // Split on the FIRST pipe only so [[Old|a|b]] keeps its full alias.
      const pipeIndex = target.indexOf('|');
      const targetAndAnchor = pipeIndex >= 0 ? target.slice(0, pipeIndex) : target;
      const alias = pipeIndex >= 0 ? target.slice(pipeIndex + 1) : null;
      const anchorIndex = targetAndAnchor.indexOf('#');
      const targetTitle = anchorIndex >= 0 ? targetAndAnchor.slice(0, anchorIndex) : targetAndAnchor;
      const anchor = anchorIndex >= 0 ? targetAndAnchor.slice(anchorIndex) : '';
      if (novelTitleKey(targetTitle) !== oldKey) return match;
      return `[[${cleanNewTitle}${anchor}${alias != null ? `|${alias}` : ''}]]`;
    });
  }
  
  function noteOrderValue(note) {
    const raw = bodyPropertyValue(note?.body || '', 'order');
    if (!String(raw || '').trim()) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  
  function compareStoryNotes(a, b) {
    const ao = noteOrderValue(a);
    const bo = noteOrderValue(b);
    if (ao != null || bo != null) {
      if (ao == null) return 1;
      if (bo == null) return -1;
      if (ao !== bo) return ao - bo;
    }
    const byTitle = String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
    if (byTitle) return byTitle;
    const byModified = new Date(b?.modifiedAt || b?.date || 0) - new Date(a?.modifiedAt || a?.date || 0);
    if (byModified) return byModified;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  }
  
  function novelOutlineLinks(body = '') {
    const stack = [];
    const links = [];
    String(body || '').split('\n').forEach(line => {
      const matches = [...line.matchAll(/\[\[([^\]]+)\]\]/g)]
        .map(match => match[1].trim())
        .filter(Boolean);
      if (!matches.length) return;
      const indent = (line.match(/^\s*/) || [''])[0].replace(/\t/g, '  ').length;
      const depth = Math.max(0, Math.floor(indent / 2));
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const ancestors = stack.slice();
      matches.forEach(title => links.push({ title, depth, ancestors }));
      stack.push({ title: matches[0], depth });
    });
    return links;
  }
  
  function novelPropertyTitle(body = '', key = '') {
    return bodyPropertyTitle(body, key);
  }
  
  function novelHasWikiLink(body = '', title = '') {
    const target = novelTitleKey(title);
    return novelWikiTitles(body).some(link => novelTitleKey(link) === target);
  }
  
  function novelEnsureWikiLink(body = '', title = '') {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || novelHasWikiLink(body, cleanTitle)) return body || '';
    const base = String(body || '').trimEnd();
    return `${base}${base ? '\n' : ''}- [[${cleanTitle}]]`;
  }
  
  function novelEnsureWikiLinkInSection(body = '', title = '', sectionTitle = '') {
    const cleanTitle = String(title || '').trim();
    const cleanSection = String(sectionTitle || '').trim();
    if (!cleanTitle) return body || '';
    if (!cleanSection) return novelEnsureWikiLink(body, cleanTitle);
    const lines = String(body || '').split('\n');
    const sectionRe = new RegExp(`^##+\\s+${cleanSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const sectionIndex = lines.findIndex(line => sectionRe.test(line));
    if (sectionIndex < 0) {
      const base = String(body || '').trimEnd();
      return `${base}${base ? '\n' : ''}## ${cleanSection}\n- [[${cleanTitle}]]`;
    }
    let insertAt = sectionIndex + 1;
    while (insertAt < lines.length && !/^#{1,6}\s+/.test(lines[insertAt])) insertAt++;
    const existingSectionText = lines.slice(sectionIndex + 1, insertAt).join('\n');
    if (novelHasWikiLink(existingSectionText, cleanTitle)) return body || '';
    lines.splice(insertAt, 0, `- [[${cleanTitle}]]`);
    return lines.join('\n');
  }
  
  function novelUpsertPropertyLink(body = '', key = '', title = '') {
    const cleanTitle = String(title || '').trim();
    if (!key || !cleanTitle) return body || '';
    return setBodyProperty(body, key, `[[${cleanTitle}]]`);
  }
  
  function buildNovelistStructure(notes = []) {
    const allNotes = notes || [];
    const byTitle = new Map(allNotes.map(note => [novelTitleKey(note.title), note]));
    const isTagged = (note, tag) => (note?.tags || []).includes(tag);
    const stageRank = { scene: 1, chapter: 2, act: 3 };
    const stageIds = { acts: new Set(), chapters: new Set(), scenes: new Set() };
    // Keyed by note id, which for a hand-made file is its name — and
    // `constructor.md` or `toString.md` is an ordinary thing to have in a
    // vault. On a normal object those keys already resolve to Object.prototype
    // members, so the bucket for one read back as a function: the outline
    // threw `bucket[parentId].includes is not a function`, and `__proto__.md`
    // vanished from it instead. No prototype, no collision.
    const explicitStageByNoteId = Object.create(null);
    const stageByNoteId = Object.create(null);
    const childrenByActId = Object.create(null);
    const childrenByChapterId = Object.create(null);
    const parentByChapterId = Object.create(null);
    const parentBySceneId = Object.create(null);
    const actBySceneId = Object.create(null);
    const noteById = new Map(allNotes.map(note => [note.id, note]));
  
    const addUnique = (bucket, parentId, childId) => {
      if (!parentId || !childId) return;
      if (!bucket[parentId]) bucket[parentId] = [];
      if (!bucket[parentId].includes(childId)) bucket[parentId].push(childId);
    };
    const canStage = (stage, note) => {
      const explicit = explicitStageByNoteId[note?.id];
      return !explicit || explicit === stage;
    };
    const addStage = (stage, note) => {
      if (!note || !canStage(stage, note)) return;
      const current = stageByNoteId[note.id];
      if (current && stageRank[current] >= stageRank[stage]) return;
      stageIds.acts.delete(note.id);
      stageIds.chapters.delete(note.id);
      stageIds.scenes.delete(note.id);
      if (stage === 'act') stageIds.acts.add(note.id);
      if (stage === 'chapter') stageIds.chapters.add(note.id);
      if (stage === 'scene') stageIds.scenes.add(note.id);
      stageByNoteId[note.id] = stage;
    };
    const linkChapterToAct = (chapter, act) => {
      if (!chapter || !act || chapter.id === act.id) return;
      if (!canStage('chapter', chapter) || !canStage('act', act)) return;
      addStage('act', act);
      addStage('chapter', chapter);
      if (!parentByChapterId[chapter.id]) parentByChapterId[chapter.id] = act.id;
      addUnique(childrenByActId, act.id, chapter.id);
    };
    const linkSceneToChapter = (scene, chapter, act = null) => {
      if (!scene || !chapter || scene.id === chapter.id) return;
      if (!canStage('scene', scene) || !canStage('chapter', chapter)) return;
      addStage('chapter', chapter);
      addStage('scene', scene);
      if (!parentBySceneId[scene.id]) parentBySceneId[scene.id] = chapter.id;
      addUnique(childrenByChapterId, chapter.id, scene.id);
      if (act && act.id !== scene.id) {
        linkChapterToAct(chapter, act);
        actBySceneId[scene.id] = act.id;
      }
    };
    const linkedNotes = (note) => novelWikiTitles(note?.body || '')
      .map(title => byTitle.get(novelTitleKey(title)))
      .filter(Boolean);
    const outlineNotes = (note) => novelOutlineLinks(note?.body || '')
      .map(link => ({
        ...link,
        note: byTitle.get(novelTitleKey(link.title)),
        ancestors: (link.ancestors || []).map(ancestor => ({
          ...ancestor,
          note: byTitle.get(novelTitleKey(ancestor.title)),
        })),
      }))
      .filter(link => link.note);
  
    allNotes.forEach(note => {
      if (isTagged(note, 'novel-act')) explicitStageByNoteId[note.id] = 'act';
      else if (isTagged(note, 'novel-chapter')) explicitStageByNoteId[note.id] = 'chapter';
      else if (isTagged(note, 'novel-scene')) explicitStageByNoteId[note.id] = 'scene';
    });
    allNotes.forEach(note => {
      if (explicitStageByNoteId[note.id]) addStage(explicitStageByNoteId[note.id], note);
    });
    allNotes.forEach(note => {
      const act = byTitle.get(novelTitleKey(novelPropertyTitle(note.body, 'act')));
      const chapter = byTitle.get(novelTitleKey(novelPropertyTitle(note.body, 'chapter')));
      if (chapter) linkSceneToChapter(note, chapter, act || null);
      else if (act) linkChapterToAct(note, act);
    });
    allNotes.filter(note => stageIds.acts.has(note.id)).forEach(act => {
      const outlined = outlineNotes(act);
      outlined.forEach(link => {
        const chapter = link.ancestors.find(ancestor => ancestor.depth === 0)?.note;
        if (link.depth <= 0) linkChapterToAct(link.note, act);
        else if (chapter) linkSceneToChapter(link.note, chapter, act);
      });
      if (!outlined.length) {
        linkedNotes(act).forEach(chapter => {
          if (!stageIds.scenes.has(chapter.id)) linkChapterToAct(chapter, act);
        });
      }
    });
    allNotes.filter(note => stageIds.chapters.has(note.id)).forEach(chapter => {
      const act = noteById.get(parentByChapterId[chapter.id]) || null;
      outlineNotes(chapter).forEach(link => linkSceneToChapter(link.note, chapter, act));
      linkedNotes(chapter).forEach(scene => {
        if (!stageIds.acts.has(scene.id) && !stageIds.chapters.has(scene.id)) linkSceneToChapter(scene, chapter, act);
      });
    });
  
    let acts = allNotes.filter(note => stageIds.acts.has(note.id));
    let chapters = allNotes.filter(note => stageIds.chapters.has(note.id));
    let scenes = allNotes.filter(note => stageIds.scenes.has(note.id));
    chapters.forEach(chapter => {
      const act = byTitle.get(novelTitleKey(novelPropertyTitle(chapter.body, 'act')));
      if (act) linkChapterToAct(chapter, act);
    });
    scenes.forEach(scene => {
      const chapter = byTitle.get(novelTitleKey(novelPropertyTitle(scene.body, 'chapter')));
      const act = byTitle.get(novelTitleKey(novelPropertyTitle(scene.body, 'act')));
      if (chapter) linkSceneToChapter(scene, chapter, act || null);
    });
    acts = allNotes.filter(note => stageIds.acts.has(note.id)).sort(compareStoryNotes);
    chapters = allNotes.filter(note => stageIds.chapters.has(note.id)).sort(compareStoryNotes);
    scenes = allNotes.filter(note => stageIds.scenes.has(note.id)).sort(compareStoryNotes);
    const sortChildIds = (ids = []) => [...ids]
      .map(id => noteById.get(id))
      .filter(Boolean)
      .sort(compareStoryNotes)
      .map(note => note.id);
    Object.keys(childrenByActId).forEach(actId => {
      childrenByActId[actId] = sortChildIds(childrenByActId[actId]);
    });
    Object.keys(childrenByChapterId).forEach(chapterId => {
      childrenByChapterId[chapterId] = sortChildIds(childrenByChapterId[chapterId]);
    });
    const novelNotes = allNotes.filter(note =>
      isNovelistNote(note) ||
      stageByNoteId[note.id] ||
      parentByChapterId[note.id] ||
      parentBySceneId[note.id]
    );
  
    const pathByNoteId = Object.create(null);
    acts.forEach(act => { pathByNoteId[act.id] = [act].filter(Boolean); });
    chapters.forEach(chapter => {
      const act = noteById.get(parentByChapterId[chapter.id]);
      pathByNoteId[chapter.id] = [act, chapter].filter(Boolean);
    });
    scenes.forEach(scene => {
      const chapter = noteById.get(parentBySceneId[scene.id]);
      const act = noteById.get(chapter ? parentByChapterId[chapter.id] : actBySceneId[scene.id]);
      pathByNoteId[scene.id] = [act, chapter, scene].filter(Boolean);
    });
  
    return {
      novelNotes,
      acts,
      chapters,
      scenes,
      childrenByActId,
      childrenByChapterId,
      parentByChapterId,
      parentBySceneId,
      stageByNoteId,
      pathByNoteId,
    };
  }
  
  function buildNovelistStarterNotes(notes = [], mdToBlocks, vaultId = '', starters = []) {
    const existing = new Set((notes || []).flatMap(note => [
      String(note.title || '').toLowerCase(),
      ...(note.tags || []),
    ]));
    return (starters || [])
      .filter(item => !existing.has(String(item.title || '').toLowerCase()) && !(item.tags || []).some(tag => existing.has(tag)))
      .map(item => {
        const body = normalizeNoteBody(item.body, item.title);
        return {
          id: novelistNoteId(item.title, vaultId),
          title: item.title,
          body,
          blocks: mdToBlocks(body),
          tags: item.tags,
          pinned: item.title === 'Act 1',
          date: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        };
      });
  }
  
  function normalizeNotes(notes = [], mdToBlocks) {
    return (notes || []).map(note => {
      const tags = normalizeNovelistLegacyTags(note.tags || []);
      const body = normalizeNoteBody(ensureScenePlotPoints(normalizeNovelistLegacyBody(note.body || ''), tags), note.title || 'Untitled');
      return {
        ...note,
        body,
        blocks: note.blocks || mdToBlocks(body || ''),
        tags,
      };
    });
  }
  
  function noteForDisk(note, blocksToMd) {
    const sourceBody = Array.isArray(note.blocks) ? blocksToMd(note.blocks || []) : (note.body || '');
    return {
      id: note.id,
      title: note.title || 'Untitled',
      date: note.date || new Date().toISOString(),
      tags: normalizeNovelistLegacyTags(Array.isArray(note.tags) ? note.tags : []),
      pinned: !!note.pinned,
      workflowArchived: !!note.workflowArchived,
      frontMatter: note.frontMatter || '',
      body: normalizeNoteBody(ensureScenePlotPoints(normalizeNovelistLegacyBody(sourceBody), note.tags || []), note.title || 'Untitled'),
    };
  }
  
  function normalizeTagName(name) {
    return String(name || '').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  }
  
  function parseDefaultTags(value) {
    return String(value || '')
      .split(',')
      .map(normalizeTagName)
      .filter(Boolean)
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
  }
  
  const NOVEL_IMPORT_KIND_TAGS = {
    act: 'novel-act',
    chapter: 'novel-chapter',
    scene: 'novel-scene',
    character: 'novel-character',
    location: 'novel-location',
    plot: 'novel-plot',
    research: 'novel-research',
    revision: 'novel-revision',
  };
  return { reminderDisplayDate, reminderStatusLabel, slugKey, novelistNoteId, ensureNovelistTags, dirtyNoteKey, isNovelistNote, normalizeNovelistLegacyTags, normalizeNovelistLegacyBody, bodyPropertyLineRe, bodyPropertyValue, bodyPropertyTitle, bodyPropertyInsertIndex, setBodyProperty, removeBodyProperty, bodyPropertyParts, normalizeBodyPropertySyntax, stripDuplicateTitleHeading, normalizeNoteBody, ensureScenePlotPoints, novelTitleKey, novelWikiTitles, replaceWikiLinkTitle, noteOrderValue, compareStoryNotes, novelOutlineLinks, novelPropertyTitle, novelHasWikiLink, novelEnsureWikiLink, novelEnsureWikiLinkInSection, novelUpsertPropertyLink, buildNovelistStructure, buildNovelistStarterNotes, normalizeNotes, noteForDisk, normalizeTagName, parseDefaultTags, NOVEL_IMPORT_KIND_TAGS };
}

module.exports = { createNovelistHelpers };
