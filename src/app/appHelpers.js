(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_APP_HELPERS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const NOTE_TEMPLATES = [
    { id: 'daily', title: 'Daily Note', noteTitle: '{date}', tags: ['daily'], body: '# {date}\n\n## Focus\n- \n\n## Notes\n- \n\n## Tasks\n- [ ] \n' },
    { id: 'meeting', title: 'Meeting Note', noteTitle: 'Meeting - {date}', tags: ['meeting'], body: '# Meeting - {date}\n\nAttendees:: \n\n## Agenda\n- \n\n## Notes\n- \n\n## Decisions\n- \n\n## Actions\n- [ ] \n' },
    { id: 'project', title: 'Project Plan', noteTitle: 'Project plan', tags: ['project'], body: '# Project plan\n\nstatus:: TODO\n\n## Outcome\n\n## Milestones\n- \n\n## Next Actions\n- [ ] \n' },
    { id: 'reading', title: 'Reading Note', noteTitle: 'Reading note', tags: ['reading'], body: '# Reading note\n\nAuthor:: \nSource:: \n\n## Summary\n\n## Highlights\n- \n\n## Follow-up\n- [ ] \n' },
    { id: 'novel-scene', title: 'Novel Scene', noteTitle: 'Scene', tags: ['novel-scene'], body: 'status:: DRAFT\npov:: \nsetting:: \npurpose:: \n\n::: plot-points\n- Opening beat\n:::\n\nDraft the scene here.\n' },
  ];

  function todayIsoDate(now = new Date()) {
    return new Date(now).toISOString().slice(0, 10);
  }

  function expandTemplate(template, values = {}) {
    const source = template || NOTE_TEMPLATES[0];
    const date = values.date || todayIsoDate(values.now);
    const replaceTokens = (value) => String(value || '').replaceAll('{date}', date);
    return {
      id: source.id,
      title: source.title || 'Untitled',
      noteTitle: replaceTokens(source.noteTitle || source.title || 'Untitled'),
      body: replaceTokens(source.body || ''),
      tags: Array.isArray(source.tags) ? [...source.tags] : [],
    };
  }

  function templateById(templateId) {
    return NOTE_TEMPLATES.find(item => item.id === templateId) || NOTE_TEMPLATES[0];
  }

  function filterCommands(commands = [], query = '', limit = 12) {
    const q = String(query || '').trim().toLowerCase();
    return (commands || [])
      .filter(cmd => cmd && cmd.enabled !== false)
      .map(cmd => {
        const hay = `${cmd.title || ''} ${cmd.section || ''} ${cmd.keywords || ''}`.toLowerCase();
        const score = !q ? 0 : hay.includes(q) ? hay.indexOf(q) : 9999;
        return { cmd, score };
      })
      .filter(item => !q || item.score < 9999)
      .sort((a, b) => a.score - b.score || String(a.cmd.title || '').localeCompare(String(b.cmd.title || '')))
      .slice(0, limit)
      .map(item => item.cmd);
  }

  function decorateNotesWithSearchDetails(notes = [], searchDetails = new Map()) {
    const details = searchDetails instanceof Map
      ? searchDetails
      : new Map(Object.entries(searchDetails || {}));
    return (notes || []).map(note => {
      const detail = details.get(note.id);
      return detail ? { ...note, __searchSnippet: detail.snippet, __matchedFields: detail.matchedFields } : note;
    });
  }

  function normalizeWorkflowStatus(raw, states = [], normalizeId) {
    const id = typeof normalizeId === 'function'
      ? normalizeId(raw)
      : String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
    return (states || []).some(state => state.id === id) ? id : '';
  }

  function workflowNotePreview(note) {
    return String(note?.body || '')
      .split('\n')
      .filter(line => !/^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line))
      .join('\n')
      .replace(/^#{1,4}\s+.*/gm, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/[`*>#]/g, '')
      .replace(/-\s+\[[ x]\]/g, '')
      .replace(/-\s+/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 180);
  }

  function collectWorkflowNotes(notes = [], states = [], options = {}) {
    const safeStates = states || [];
    const stateIds = safeStates.map(s => s.id);
    const counts = Object.fromEntries(stateIds.map(id => [id, 0]));
    const byState = Object.fromEntries(stateIds.map(id => [id, []]));
    const noteIdsByState = Object.fromEntries(stateIds.map(id => [id, new Set()]));
    const archivedNotes = [];
    const propertyValue = typeof options.propertyValue === 'function'
      ? options.propertyValue
      : (body, key) => {
        const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(body || '').match(new RegExp(`^\\s*(?:-\\s*)?${safeKey}::\\s*(.*)$`, 'im'));
        return match ? String(match[1] || '').trim() : '';
      };

    (notes || []).forEach(note => {
      const workflow = normalizeWorkflowStatus(propertyValue(note.body || '', 'status'), safeStates, options.normalizeId);
      if (!workflow || !Object.prototype.hasOwnProperty.call(counts, workflow)) return;
      const item = {
        id: note.id,
        noteId: note.id,
        noteTitle: note.title,
        title: note.title,
        noteTags: note.tags || [],
        text: workflowNotePreview(note),
        kind: 'note',
        workflow,
        modifiedAt: note.modifiedAt || note.date,
      };
      if (note.workflowArchived) {
        archivedNotes.push({
          id: note.id,
          title: note.title,
          tags: note.tags || [],
          workflow,
          workflowCount: 1,
        });
        return;
      }
      counts[item.workflow]++;
      noteIdsByState[item.workflow].add(note.id);
      byState[item.workflow].push(item);
    });

    return {
      counts,
      byState,
      noteIdsByState,
      archivedNotes,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    };
  }

  function reminderKey(item) {
    return [item.noteId, item.line ?? item.blockId ?? '', item.remindAt?.date || '', item.remindAt?.time || '', item.text || ''].join('|');
  }

  function collectReminderItems(notes = [], parser, walk) {
    if (!parser?.parse) return [];
    const out = [];
    (notes || []).forEach(note => {
      const pushItem = (text, meta = {}) => {
        const remindAt = parser.parse(text);
        if (!remindAt) return;
        out.push({
          noteId: note.id,
          noteTitle: note.title,
          text: parser.strip ? parser.strip(text) : String(text || '').replace(remindAt.raw, '').trim(),
          remindAt,
          ...meta,
        });
      };
      if (note.blocks?.length && typeof walk === 'function') {
        walk(note.blocks, block => {
          if (block.kind === 'todo' && block.checked) return;
          pushItem(block.content || '', { blockId: block.id });
        });
        return;
      }
      String(note.body || '').split('\n').forEach((line, lineIndex) => {
        if (/^\s*-\s+\[[xX]\]/.test(line)) return;
        pushItem(line, { line: lineIndex });
      });
    });
    return out.map(item => ({ ...item, key: reminderKey(item) }));
  }

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
    return String(wiki ? wiki[1] : value).replace(/#[^\]]+$/, '').trim();
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
      const [targetAndAnchor, alias] = target.split('|');
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
    const explicitStageByNoteId = {};
    const stageByNoteId = {};
    const childrenByActId = {};
    const childrenByChapterId = {};
    const parentByChapterId = {};
    const parentBySceneId = {};
    const actBySceneId = {};
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

    const pathByNoteId = {};
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
      body: normalizeNoteBody(ensureScenePlotPoints(normalizeNovelistLegacyBody(sourceBody), note.tags || []), note.title || 'Untitled'),
    };
  }

  function normalizeTagName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
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

  return {
    NOTE_TEMPLATES,
    todayIsoDate,
    expandTemplate,
    templateById,
    filterCommands,
    decorateNotesWithSearchDetails,
    normalizeWorkflowStatus,
    workflowNotePreview,
    collectWorkflowNotes,
    reminderKey,
    collectReminderItems,
    reminderDisplayDate,
    reminderStatusLabel,
    novelistNoteId,
    ensureNovelistTags,
    buildNovelistStarterNotes,
    dirtyNoteKey,
    isNovelistNote,
    normalizeNovelistLegacyTags,
    normalizeNovelistLegacyBody,
    ensureScenePlotPoints,
    novelTitleKey,
    novelWikiTitles,
    replaceWikiLinkTitle,
    bodyPropertyLineRe,
    bodyPropertyValue,
    bodyPropertyTitle,
    bodyPropertyInsertIndex,
    setBodyProperty,
    removeBodyProperty,
    bodyPropertyParts,
    normalizeBodyPropertySyntax,
    stripDuplicateTitleHeading,
    normalizeNoteBody,
    noteOrderValue,
    compareStoryNotes,
    novelOutlineLinks,
    novelPropertyTitle,
    novelHasWikiLink,
    novelEnsureWikiLink,
    novelEnsureWikiLinkInSection,
    novelUpsertPropertyLink,
    buildNovelistStructure,
    normalizeNotes,
    noteForDisk,
    normalizeTagName,
    parseDefaultTags,
    NOVEL_IMPORT_KIND_TAGS,
    normalizeNovelImportKind,
    novelImportTagForKind,
    normalizeNovelImportCandidates,
    buildNovelImportBody,
    mergeNovelImportBody,
    buildNovelImportPlan,
  };
});
