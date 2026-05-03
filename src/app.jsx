// Main App — composes sidebar, note list, editor, panels, overlays.
// Disk-backed via window.mn (Electron preload IPC). Falls back to in-memory
// seed when running outside Electron (e.g. opened directly in a browser).

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;

const MN_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "graphStyle": "force",
  "todoVariant": "list",
  "toastVariant": "card",
  "fontChoice": "Editorial (Newsreader + Inter)",
  "showNoteList": true,
  "showSidebar": true,
  "editorWidth": "medium",
  "fontSize": "default",
  "appFontSize": "default",
  "indentGuides": true,
  "spellCheck": true,
  "autoLink": true,
  "collapseByDefault": false,
  "sortBy": "modified",
  "defaultTags": "",
  "pinnedFirst": true,
  "rollupFormat": "long",
  "reminderSound": false,
  "showOverdue": true,
  "snoozeMinutes": "15",
  "weekStart": "monday",
  "workflowStates": null,
  "autoSave": true,
  "storageFormat": "markdown",
  "sync": "local"
}/*EDITMODE-END*/;

const MN_NOVELIST_TAGS = [
  { name: 'novel-act', hue: 30 },
  { name: 'novel-chapter', hue: 220 },
  { name: 'novel-scene', hue: 190 },
  { name: 'novel-character', hue: 330 },
  { name: 'novel-location', hue: 145 },
  { name: 'novel-plot', hue: 35 },
  { name: 'novel-research', hue: 280 },
  { name: 'novel-revision', hue: 15 },
];

const MN_NOVELIST_WORKFLOW_STATES = [
  { id: 'IDEA', next: 'OUTLINE', color: 'oklch(0.55 0.17 35)', bg: 'oklch(0.96 0.04 35)' },
  { id: 'OUTLINE', next: 'DRAFT', color: 'oklch(0.55 0.15 250)', bg: 'oklch(0.95 0.04 250)' },
  { id: 'DRAFT', next: 'REVISE', color: 'oklch(0.55 0.14 205)', bg: 'oklch(0.95 0.04 205)' },
  { id: 'REVISE', next: 'FINAL', color: 'oklch(0.55 0.16 290)', bg: 'oklch(0.95 0.04 290)' },
  { id: 'FINAL', next: null, color: 'oklch(0.55 0.15 145)', bg: 'oklch(0.95 0.04 145)' },
];

const MN_NOVELIST_STARTERS = [
  {
    title: 'Act 1',
    tags: ['novel-act'],
    body: 'status:: OUTLINE\norder:: 100\npurpose:: \n## Chapters\n- [[Chapter 1]]\n- Major turn\n- Open questions',
  },
  {
    title: 'Chapter 1',
    tags: ['novel-chapter'],
    body: 'status:: OUTLINE\norder:: 110\nact:: [[Act 1]]\n## Scenes\n- [[Scene 1]]\n- Chapter goal\n- Scene list\n- Revision notes',
  },
  {
    title: 'Scene 1',
    tags: ['novel-scene'],
    body: 'status:: DRAFT\norder:: 111\nact:: [[Act 1]]\nchapter:: [[Chapter 1]]\npov:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.',
  },
  {
    title: 'Characters',
    tags: ['novel-character'],
    body: '- Create one note per major character.\n- Track goals, secrets, relationships, and changes.',
  },
  {
    title: 'Locations',
    tags: ['novel-location'],
    body: '- Capture places, sensory details, constraints, and recurring imagery.',
  },
  {
    title: 'Plot Threads',
    tags: ['novel-plot'],
    body: 'status:: IDEA\n- Main promise of the story\n- Act turns\n- Open continuity questions',
  },
  {
    title: 'Research',
    tags: ['novel-research'],
    body: '- Sources, facts, questions, and reminders that support the novel.',
  },
  {
    title: 'Revision Notes',
    tags: ['novel-revision'],
    body: 'status:: IDEA\n- Changes to make in the next pass.',
  },
];

function mnNovelistNoteId(title, vaultId = '') {
  const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || Date.now().toString(36);
  const vaultSlug = String(vaultId || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `n_novel_${vaultSlug ? `${vaultSlug}_` : ''}${slug}`;
}

function mnEnsureNovelistTags(existingTags = []) {
  const byName = new Map((existingTags || []).map(tag => [tag.name, tag]));
  MN_NOVELIST_TAGS.forEach(tag => {
    if (!byName.has(tag.name)) byName.set(tag.name, tag);
  });
  return [...byName.values()];
}

function mnBuildNovelistStarterNotes(notes = [], mnMdToBlocks, vaultId = '') {
  const existing = new Set((notes || []).flatMap(note => [
    String(note.title || '').toLowerCase(),
    ...(note.tags || []),
  ]));
  return MN_NOVELIST_STARTERS
    .filter(item => !existing.has(item.title.toLowerCase()) && !item.tags.some(tag => existing.has(tag)))
    .map(item => ({
      id: mnNovelistNoteId(item.title, vaultId),
      title: item.title,
      body: mnNormalizeNoteBody(item.body, item.title),
      blocks: mnMdToBlocks(mnNormalizeNoteBody(item.body, item.title)),
      tags: item.tags,
      pinned: item.title === 'Act 1',
      date: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    }));
}

function mnDirtyNoteKey(vaultId, noteId) {
  return `${String(vaultId || '')}::${String(noteId || '')}`;
}

function mnIsNovelistNote(note) {
  return (note.tags || []).some(tag => tag.startsWith('novel-'));
}

function mnNormalizeNovelistLegacyTags(tags = []) {
  return (tags || [])
    .map(tag => tag === 'novel-arc' ? 'novel-act' : tag)
    .filter(tag => tag !== 'novel-manuscript' && tag !== 'novel-storyRoot')
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}

function mnNormalizeNovelistLegacyBody(body = '') {
  return String(body || '')
    .split('\n')
    .map(line => {
      const prop = line.match(/^(\s*(?:-\s*)?)arc(::\s*.*)$/i);
      if (prop) return `${prop[1]}act${prop[2]}`;
      return line.replace(/^(##+\s+)Arcs\s*$/i, '$1Acts');
    })
    .join('\n');
}

function mnEnsureScenePlotPoints(body = '', tags = []) {
  if (!(tags || []).includes('novel-scene')) return body || '';
  const source = String(body || '');
  if (/^:::\s*plot-points\s*$/im.test(source)) return source;
  const lines = source.split('\n');
  const insertAt = mnBodyPropertyInsertIndex(lines);
  lines.splice(insertAt, 0, '::: plot-points', '- Opening beat', ':::');
  return lines.join('\n');
}

function mnNovelTitleKey(title) {
  return String(title || '')
    .split('|')[0]
    .replace(/#[^\]]+$/, '')
    .trim()
    .toLowerCase();
}

function mnNovelWikiTitles(body = '') {
  return [...String(body || '').matchAll(/\[\[([^\]]+)\]\]/g)]
    .map(match => match[1].trim())
    .filter(Boolean);
}

function mnBodyPropertyLineRe(key = '') {
  const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:-\\s*)?${safeKey}::\\s*(.*)$`, 'im');
}

function mnBodyPropertyValue(body = '', key = '') {
  if (!key) return '';
  const match = String(body || '').match(mnBodyPropertyLineRe(key));
  return match ? String(match[1] || '').trim() : '';
}

function mnBodyPropertyTitle(body = '', key = '') {
  const value = mnBodyPropertyValue(body, key);
  const wiki = value.match(/^\[\[([^\]]+)\]\]/);
  return String(wiki ? wiki[1] : value).replace(/#[^\]]+$/, '').trim();
}

function mnBodyPropertyInsertIndex(lines) {
  const isPropLine = (line) => /^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line);
  const headingIndex = lines.findIndex(line => /^#{1,3}\s+/.test(line));
  let index = headingIndex >= 0 ? headingIndex + 1 : 0;
  while (index < lines.length && isPropLine(lines[index])) index++;
  return index;
}

function mnSetBodyProperty(body = '', key = '', value = '') {
  const cleanKey = String(key || '').trim();
  const cleanValue = String(value ?? '').trim();
  if (!cleanKey) return body || '';
  if (!cleanValue) return mnRemoveBodyProperty(body, cleanKey);
  const source = String(body || '');
  const lineRe = mnBodyPropertyLineRe(cleanKey);
  if (lineRe.test(source)) return source.replace(lineRe, () => `${cleanKey}:: ${cleanValue}`);
  const lines = source.split('\n');
  lines.splice(mnBodyPropertyInsertIndex(lines), 0, `${cleanKey}:: ${cleanValue}`);
  return lines.join('\n');
}

function mnRemoveBodyProperty(body = '', key = '') {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return body || '';
  const safeKey = cleanKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(body || '')
    .split('\n')
    .filter(line => !(new RegExp(`^\\s*-?\\s*${safeKey}::\\s*`, 'i')).test(line))
    .join('\n');
}

function mnBodyPropertyParts(line = '') {
  const match = String(line || '').match(/^\s*(?:-\s*)?([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
  return match ? { key: match[1], value: match[2] || '' } : null;
}

function mnNormalizeBodyPropertySyntax(body = '') {
  const lines = String(body || '').split('\n');
  let inFence = false;
  return lines.map(line => {
    if (/^```\s*/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const prop = mnBodyPropertyParts(line);
    return prop ? `${prop.key}:: ${prop.value}`.trimEnd() : line;
  }).join('\n');
}

function mnStripDuplicateTitleHeading(body = '', title = '') {
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

function mnNormalizeNoteBody(body = '', title = '') {
  return mnNormalizeBodyPropertySyntax(mnStripDuplicateTitleHeading(body, title));
}

function mnNoteOrderValue(note) {
  const raw = mnBodyPropertyValue(note?.body || '', 'order');
  if (!String(raw || '').trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function mnCompareStoryNotes(a, b) {
  const ao = mnNoteOrderValue(a);
  const bo = mnNoteOrderValue(b);
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

function mnNovelOutlineLinks(body = '') {
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

function mnNovelPropertyTitle(body = '', key = '') {
  return mnBodyPropertyTitle(body, key);
}

function mnNovelHasWikiLink(body = '', title = '') {
  const target = mnNovelTitleKey(title);
  return mnNovelWikiTitles(body).some(link => mnNovelTitleKey(link) === target);
}

function mnNovelEnsureWikiLink(body = '', title = '') {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle || mnNovelHasWikiLink(body, cleanTitle)) return body || '';
  const base = String(body || '').trimEnd();
  return `${base}${base ? '\n' : ''}- [[${cleanTitle}]]`;
}

function mnNovelEnsureWikiLinkInSection(body = '', title = '', sectionTitle = '') {
  const cleanTitle = String(title || '').trim();
  const cleanSection = String(sectionTitle || '').trim();
  if (!cleanTitle) return body || '';
  if (!cleanSection) return mnNovelEnsureWikiLink(body, cleanTitle);
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
  if (mnNovelHasWikiLink(existingSectionText, cleanTitle)) return body || '';
  lines.splice(insertAt, 0, `- [[${cleanTitle}]]`);
  return lines.join('\n');
}

function mnNovelUpsertPropertyLink(body = '', key = '', title = '') {
  const cleanTitle = String(title || '').trim();
  if (!key || !cleanTitle) return body || '';
  return mnSetBodyProperty(body, key, `[[${cleanTitle}]]`);
}

function mnBuildNovelistStructure(notes = []) {
  const allNotes = notes || [];
  const byTitle = new Map(allNotes.map(note => [mnNovelTitleKey(note.title), note]));
  const isTagged = (note, tag) => (note?.tags || []).includes(tag);
  const stageRank = { scene: 1, chapter: 2, act: 3 };
  const stageIds = {
    acts: new Set(),
    chapters: new Set(),
    scenes: new Set(),
  };
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
    if (!note) return;
    if (!canStage(stage, note)) return;
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
  const linkedNotes = (note) => mnNovelWikiTitles(note?.body || '')
    .map(title => byTitle.get(mnNovelTitleKey(title)))
    .filter(Boolean);
  const outlineNotes = (note) => mnNovelOutlineLinks(note?.body || '')
    .map(link => ({
      ...link,
      note: byTitle.get(mnNovelTitleKey(link.title)),
      ancestors: (link.ancestors || []).map(ancestor => ({
        ...ancestor,
        note: byTitle.get(mnNovelTitleKey(ancestor.title)),
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
    const act = byTitle.get(mnNovelTitleKey(mnNovelPropertyTitle(note.body, 'act')));
    const chapter = byTitle.get(mnNovelTitleKey(mnNovelPropertyTitle(note.body, 'chapter')));
    if (chapter) linkSceneToChapter(note, chapter, act || null);
    else if (act) linkChapterToAct(note, act);
  });

  allNotes.filter(note => stageIds.acts.has(note.id)).forEach(act => {
    const outlined = outlineNotes(act);
    outlined.forEach(link => {
      const chapter = link.ancestors.find(ancestor => ancestor.depth === 0)?.note;
      if (link.depth <= 0) {
        linkChapterToAct(link.note, act);
      } else if (chapter) {
        linkSceneToChapter(link.note, chapter, act);
      }
    });
    if (!outlined.length) {
      linkedNotes(act).forEach(chapter => {
        if (!stageIds.scenes.has(chapter.id)) linkChapterToAct(chapter, act);
      });
    }
  });

  allNotes.filter(note => stageIds.chapters.has(note.id)).forEach(chapter => {
    const act = noteById.get(parentByChapterId[chapter.id]) || null;
    outlineNotes(chapter).forEach(link => {
      linkSceneToChapter(link.note, chapter, act);
    });
    linkedNotes(chapter).forEach(scene => {
      if (!stageIds.acts.has(scene.id) && !stageIds.chapters.has(scene.id)) {
        linkSceneToChapter(scene, chapter, act);
      }
    });
  });

  let acts = allNotes.filter(note => stageIds.acts.has(note.id));
  let chapters = allNotes.filter(note => stageIds.chapters.has(note.id));
  let scenes = allNotes.filter(note => stageIds.scenes.has(note.id));

  chapters.forEach(chapter => {
    const act = byTitle.get(mnNovelTitleKey(mnNovelPropertyTitle(chapter.body, 'act')));
    if (act) {
      linkChapterToAct(chapter, act);
    }
  });
  scenes.forEach(scene => {
    const chapter = byTitle.get(mnNovelTitleKey(mnNovelPropertyTitle(scene.body, 'chapter')));
    const act = byTitle.get(mnNovelTitleKey(mnNovelPropertyTitle(scene.body, 'act')));
    if (chapter) linkSceneToChapter(scene, chapter, act || null);
  });
  acts = allNotes.filter(note => stageIds.acts.has(note.id));
  chapters = allNotes.filter(note => stageIds.chapters.has(note.id));
  scenes = allNotes.filter(note => stageIds.scenes.has(note.id));
  acts.sort(mnCompareStoryNotes);
  chapters.sort(mnCompareStoryNotes);
  scenes.sort(mnCompareStoryNotes);
  const sortChildIds = (ids = []) => [...ids]
    .map(id => noteById.get(id))
    .filter(Boolean)
    .sort(mnCompareStoryNotes)
    .map(note => note.id);
  Object.keys(childrenByActId).forEach(actId => {
    childrenByActId[actId] = sortChildIds(childrenByActId[actId]);
  });
  Object.keys(childrenByChapterId).forEach(chapterId => {
    childrenByChapterId[chapterId] = sortChildIds(childrenByChapterId[chapterId]);
  });
  const novelNotes = allNotes.filter(note =>
    mnIsNovelistNote(note) ||
    stageByNoteId[note.id] ||
    parentByChapterId[note.id] ||
    parentBySceneId[note.id]
  );

  const pathByNoteId = {};
  acts.forEach(act => {
    pathByNoteId[act.id] = [act].filter(Boolean);
  });
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

// Convert raw notes (with markdown body) to runtime form (with parsed blocks).
function normalizeNotes(notes, mnMdToBlocks) {
  return (notes || []).map(n => {
    const tags = mnNormalizeNovelistLegacyTags(n.tags || []);
    const body = mnNormalizeNoteBody(mnEnsureScenePlotPoints(mnNormalizeNovelistLegacyBody(n.body || ''), tags), n.title || 'Untitled');
    return {
      ...n,
      body,
      blocks: n.blocks || mnMdToBlocks(body || ''),
      tags,
    };
  });
}

// Strip in-memory-only fields before persisting to disk.
function noteForDisk(n, mnBlocksToMd) {
  const sourceBody = Array.isArray(n.blocks) ? mnBlocksToMd(n.blocks || []) : (n.body || '');
  return {
    id: n.id,
    title: n.title || 'Untitled',
    date: n.date || new Date().toISOString(),
    tags: mnNormalizeNovelistLegacyTags(Array.isArray(n.tags) ? n.tags : []),
    pinned: !!n.pinned,
    workflowArchived: !!n.workflowArchived,
    body: mnNormalizeNoteBody(mnEnsureScenePlotPoints(mnNormalizeNovelistLegacyBody(sourceBody), n.tags || []), n.title || 'Untitled'),
  };
}

function mnNormalizeNoteStatus(raw, states = []) {
  const id = window.MN_LOGSEQ?.mnNormalizeWorkflowId
    ? window.MN_LOGSEQ.mnNormalizeWorkflowId(raw)
    : String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
  return (states || []).some(state => state.id === id) ? id : '';
}

function mnWorkflowNotePreview(note) {
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

function collectWorkflowNotes(notes, states) {
  const safeStates = states || [];
  const stateIds = safeStates.map(s => s.id);
  const counts = Object.fromEntries(stateIds.map(id => [id, 0]));
  const byState = Object.fromEntries(stateIds.map(id => [id, []]));
  const noteIdsByState = Object.fromEntries(stateIds.map(id => [id, new Set()]));
  const archivedNotes = [];

  notes.forEach(note => {
    const workflow = mnNormalizeNoteStatus(mnBodyPropertyValue(note.body || '', 'status'), safeStates);
    if (!workflow || !Object.prototype.hasOwnProperty.call(counts, workflow)) return;
    const item = {
      id: note.id,
      noteId: note.id,
      noteTitle: note.title,
      title: note.title,
      noteTags: note.tags || [],
      text: mnWorkflowNotePreview(note),
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

function collectWorkflowBlocks(notes, states) {
  return collectWorkflowNotes(notes, states);
}

function normalizeTagName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
}

function mnParseDefaultTags(value) {
  return String(value || '')
    .split(',')
    .map(normalizeTagName)
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}

function mnNormalizeWorkflowStatesForApp(states) {
  if (Array.isArray(states) && states.length === 0) return [];
  return (window.MN_LOGSEQ?.mnNormalizeWorkflowStates || ((value) => value))(
    Array.isArray(states) && states.length
      ? states
      : (window.MN_LOGSEQ?.DEFAULT_WORKFLOW_STATES || window.MN_LOGSEQ?.WORKFLOW_STATES || [])
  );
}

function mnReminderKey(item) {
  return [item.noteId, item.line ?? item.blockId ?? '', item.remindAt?.date || '', item.remindAt?.time || '', item.text || ''].join('|');
}

function mnReadSnoozedReminders() {
  try { return JSON.parse(localStorage.getItem('mn:snoozedReminders') || '{}') || {}; }
  catch { return {}; }
}

function mnWriteSnoozedReminder(key, until) {
  const data = mnReadSnoozedReminders();
  data[key] = until;
  try { localStorage.setItem('mn:snoozedReminders', JSON.stringify(data)); } catch (e) {}
}

function mnCollectReminderItems(notes) {
  const parser = window.MN_REMIND;
  if (!parser?.parse) return [];
  const out = [];
  notes.forEach(note => {
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
    if (note.blocks?.length && window.mnWalk) {
      window.mnWalk(note.blocks, block => {
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
  return out.map(item => ({ ...item, key: mnReminderKey(item) }));
}

function mnPlayReminderSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    setTimeout(() => ctx.close?.(), 400);
  } catch (e) {}
}

function mnReminderDisplayDate(item) {
  const at = item?.remindAt?.at;
  if (!at) return '';
  return at.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function mnReminderStatusLabel(status) {
  if (status === 'due') return 'Due';
  if (status === 'snoozed') return 'Snoozed';
  return 'Upcoming';
}

const MN_LAUNCH_BLOOMS = [
  { color: '#f3bfd8', duration: '7.6s', delay: '-1.2s' },
  { color: '#a9c2ff', duration: '8.8s', delay: '-3.4s' },
  { color: '#9fe2c9', duration: '9.6s', delay: '-5.1s' },
];

function MnBootLogo() {
  return (
    <div className="mn-boot-brand" aria-label="VispNote">
      <img className="mn-boot-logo" src="assets/vispnote-loading-transparent.png" alt="VispNote" />
      <div className="mn-boot-title mn-boot-wordmark">VispNote</div>
      <div className="mn-boot-tagline"><span>Capture</span><i /><span>Organize</span><i /><span>Remember</span></div>
    </div>
  );
}

function MnLaunchScreen({ state, error, T }) {
  const loading = state === 'loading';
  return (
    <div className="mn-boot-splash" style={{ position: 'relative', zIndex: 'auto', width: '100vw', height: '100vh' }}>
      <div className="mn-boot-grid" />
      <div className="mn-boot-light-field" aria-hidden="true">
        {MN_LAUNCH_BLOOMS.map((item, i) => (
          <span
            key={`${item.color}-${i}`}
            className="mn-light-bloom"
            style={{
              '--bloom-color': item.color,
              '--bloom-duration': item.duration,
              '--bloom-delay': item.delay,
              animationPlayState: loading ? 'running' : 'paused',
            }}
          />
        ))}
      </div>
      <div className="mn-boot-core">
        <MnBootLogo />
        <div className="mn-boot-subtitle" style={{ color: loading ? '#667187' : '#b84b42' }}>
          {loading ? 'Connecting your workspace' : 'Launch interrupted'}
        </div>

        {loading ? (
          <>
            <div className="mn-boot-status">Opening vault and indexing notes</div>
            <div className="mn-boot-progress"><div /></div>
          </>
        ) : (
          <div style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(420px, calc(100vw - 48px))',
            marginTop: 24,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.56)',
            border: '1px solid rgba(120,130,152,0.22)',
            color: '#56647c',
            fontFamily: 'var(--mn-mono)',
            fontSize: 11,
            lineHeight: 1.55,
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>{error || 'Unknown startup error'}</div>
        )}
      </div>
    </div>
  );
}

const HAS_DISK = typeof window !== 'undefined' && !!window.mn;

function MnDeleteNoteDialog({ note, T, onCancel, onConfirm }) {
  const cancelRef = useRefA(null);

  useEffectA(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [onCancel]);

  if (!note) return null;
  const blockCount = (window.MN_OUTLINE?.mnFlatten?.(note.blocks || [], 0, false) || []).length;
  const tagText = (note.tags || []).length
    ? (note.tags || []).map(t => `#${t}`).join(' ')
    : 'No tags';

  const btnBase = {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
  };

  return (
    <div
      className="mn-delete-note-dialog"
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 30%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-delete-note-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 26%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: T.bgSub,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: T.danger,
            background: `color-mix(in oklab, ${T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-delete-note-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>Delete note?</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
            }}>This removes the note from the current vault.</div>
          </div>
        </div>
        <div style={{ padding: '16px 18px 10px' }}>
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: '11px 12px',
          }}>
            <div style={{
              fontSize: 13.5,
              fontWeight: 650,
              color: T.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 5,
            }}>{note.title || 'Untitled'}</div>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: T.inkDim,
            }}>
              <span>{blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>
              <span style={{ color: T.line }}>•</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tagText}</span>
            </div>
          </div>
          <div style={{
            marginTop: 11,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            lineHeight: 1.45,
            color: T.inkMed,
          }}>This action cannot be undone from the editor history.</div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px 16px',
        }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              ...btnBase,
              background: T.bg,
              color: T.inkMed,
              border: `1px solid ${T.line}`,
            }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...btnBase,
              background: T.danger,
              color: T.bg,
              border: `1px solid ${T.danger}`,
              boxShadow: `0 8px 20px color-mix(in oklab, ${T.danger} 20%, transparent)`,
            }}>
            Delete note
          </button>
        </div>
      </div>
    </div>
  );
}

function MnReminderCenter({ open, items, dueCount, onToggle, onClose, onOpenNote, topOffset = 13, T }) {
  const visibleItems = items;
  return (
    <div
      className="mn-reminder-center"
      style={{
        position: 'absolute',
        top: topOffset,
        right: 18,
        zIndex: 45,
      }}>
      <button
        onClick={onToggle}
        title="Reminder notifications"
        aria-label="Reminder notifications"
        style={{
          position: 'relative',
          zIndex: 2,
          width: 30,
          height: 30,
          borderRadius: 6,
          border: `1px solid ${open ? T.accent : T.lineSub}`,
          background: open ? T.accentSoft : T.bg,
          color: open ? T.accent : T.inkMed,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 8px 20px color-mix(in oklab, ${T.ink} 8%, transparent)`,
        }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M4.2 7.2C4.2 4.8 5.6 3.2 8 3.2C10.4 3.2 11.8 4.8 11.8 7.2V9.8L13 11H3L4.2 9.8V7.2Z" strokeLinejoin="round"/>
          <path d="M6.6 12.1C6.9 12.8 7.4 13.2 8 13.2C8.6 13.2 9.1 12.8 9.4 12.1" strokeLinecap="round"/>
          <path d="M8 1.8V3.1" strokeLinecap="round"/>
        </svg>
        {dueCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -5,
            right: -6,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 999,
            background: T.warn,
            color: T.bg,
            border: `1px solid ${T.bg}`,
            fontFamily: 'var(--mn-mono)',
            fontSize: 9,
            fontWeight: 600,
            lineHeight: '15px',
            textAlign: 'center',
          }}>{dueCount > 9 ? '9+' : dueCount}</span>
        )}
      </button>
      {open && (
        <>
          <button
            aria-label="Close reminder notifications"
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1,
              border: 'none',
              background: 'transparent',
              cursor: 'default',
            }}
          />
          <div
            role="dialog"
            aria-label="Reminder notifications"
            style={{
              position: 'absolute',
              zIndex: 3,
              top: 38,
              right: 0,
              width: 340,
              maxHeight: 'min(520px, calc(100vh - 72px))',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: T.bg,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              boxShadow: `0 18px 50px color-mix(in oklab, ${T.ink} 18%, transparent)`,
            }}>
            <div style={{
              padding: '12px 13px',
              borderBottom: `1px solid ${T.lineSub}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <div style={{
                fontFamily: 'var(--mn-ui)',
                fontSize: 13,
                fontWeight: 600,
                color: T.ink,
              }}>Reminders</div>
              <div style={{ flex: 1 }} />
              <div style={{
                fontFamily: 'var(--mn-mono)',
                fontSize: 10,
                color: dueCount ? T.warn : T.inkDim,
              }}>{dueCount} due</div>
            </div>
            <div style={{ overflow: 'auto', padding: 6 }}>
              {visibleItems.length === 0 ? (
                <div style={{
                  padding: '26px 16px',
                  textAlign: 'center',
                  color: T.inkDim,
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12.5,
                }}>No reminders in this vault</div>
              ) : visibleItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => onOpenNote(item)}
                  style={{
                    width: '100%',
                    display: 'block',
                    textAlign: 'left',
                    border: 'none',
                    background: item.status === 'due'
                      ? `color-mix(in oklab, ${T.warn} 9%, transparent)`
                      : 'transparent',
                    borderRadius: 6,
                    cursor: 'pointer',
                    padding: '8px 9px',
                    color: T.ink,
                    fontFamily: 'var(--mn-ui)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = item.status === 'due'
                    ? `color-mix(in oklab, ${T.warn} 14%, transparent)`
                    : T.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = item.status === 'due'
                    ? `color-mix(in oklab, ${T.warn} 9%, transparent)`
                    : 'transparent'}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 3,
                  }}>
                    <span style={{
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 9.5,
                      color: item.status === 'due' ? T.warn : T.inkDim,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontWeight: 600,
                    }}>{mnReminderStatusLabel(item.status)}</span>
                    <span style={{
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10,
                      color: T.inkDim,
                    }}>{mnReminderDisplayDate(item)}</span>
                  </div>
                  <div style={{
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    color: T.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{item.text || 'Reminder'}</div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10,
                    color: T.inkDim,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>from {item.noteTitle}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MnAiNotice({ notice, onOpen, onDismiss, T }) {
  if (!notice) return null;
  const isError = !!notice.error;
  return (
    <div style={{
      position: 'absolute',
      right: 18,
      bottom: 18,
      zIndex: 80,
      width: 330,
      maxWidth: 'calc(100vw - 36px)',
      border: `1px solid ${isError ? `color-mix(in oklab, ${T.warn} 42%, ${T.line})` : T.line}`,
      borderRadius: 8,
      background: T.bg,
      color: T.ink,
      boxShadow: `0 18px 48px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      overflow: 'hidden',
      fontFamily: 'var(--mn-ui)',
      animation: 'mnSlideUp 160ms ease',
    }}>
      <button
        onClick={onOpen}
        style={{
          width: '100%',
          border: 'none',
          background: isError ? `color-mix(in oklab, ${T.warn} 8%, ${T.bg})` : T.bg,
          color: T.ink,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '12px 13px',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}>
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${isError ? T.warn : T.selLine}`,
          background: isError ? `color-mix(in oklab, ${T.warn} 14%, transparent)` : T.accentSoft,
          color: isError ? T.warn : T.accent,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
            {isError ? (
              <path d="M8 3V8M8 11.4V11.5M3.4 13H12.6L8 2.8L3.4 13Z" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: T.ink }}>
            {isError ? 'AI task needs attention' : 'AI response ready'}
          </span>
          <span style={{
            display: 'block',
            marginTop: 3,
            fontSize: 12.5,
            lineHeight: 1.35,
            color: T.inkDim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {notice.query || 'Open Ask AI to view the result'}
          </span>
        </span>
      </button>
      <button
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss AI notification"
        style={{
          position: 'absolute',
          top: 7,
          right: 7,
          width: 24,
          height: 24,
          borderRadius: 5,
          border: `1px solid ${T.lineSub}`,
          background: T.bg,
          color: T.inkDim,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function MnApp() {
  const { SEED_TAGS, SEED_NOTES, buildLinks } = window.MN_DATA;
  const { mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk } = window.MN_OUTLINE;
  // make them available to other modules via globals too
  window.mnMdToBlocks = mnMdToBlocks; window.mnBlocksToMd = mnBlocksToMd;
  window.mnWalk = mnWalk; window.mnLocate = mnLocate; window.mnCloneBlocks = mnCloneBlocks;
  window.mkBlock = mkBlock;

  const [bootState, setBootState] = useStateA('loading'); // 'loading' | 'ready' | 'error'
  const [bootError, setBootError] = useStateA(null);

  const [tweaks, setTweaks] = useStateA(MN_TWEAK_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useStateA(false);

  // ── State (populated after disk load) ───────────────────────────────────
  // vaults stores per-vault metadata + cached notes/tags (cache fills lazily)
  const [vaults, setVaults] = useStateA([]);
  const [activeVaultId, setActiveVaultId] = useStateA(null);
  const [tags, setTags] = useStateA([]);
  const [notes, setNotes] = useStateA([]);
  const [selectedId, setSelectedId] = useStateA(null);
  const [canvases, setCanvases] = useStateA([]);
  const [activeCanvas, setActiveCanvas] = useStateA(null);

  const [selectedTag, setSelectedTag] = useStateA(null);
  const [selectedWorkflow, setSelectedWorkflow] = useStateA(null);
  const [view, setView] = useStateA('notes');
  const [graphFilter, setGraphFilter] = useStateA('all-novelist');
  const lastViewRef = useRefA('notes');
  const [askAiOpen, setAskAiOpen] = useStateA(false);
  const [askAiSeed, setAskAiSeed] = useStateA('');
  const askAiOpenRef = useRefA(false);
  const [askAiSession, setAskAiSession] = useStateA({
    messages: [],
    pending: false,
    error: null,
    activeAction: null,
    background: false,
  });
  const [aiNotice, setAiNotice] = useStateA(null);
  const [captureOpen, setCaptureOpen] = useStateA(false);
  const [deleteTargetId, setDeleteTargetId] = useStateA(null);
  const [toast, setToast] = useStateA(null);
  const [reminderCenterOpen, setReminderCenterOpen] = useStateA(false);
  const dismissedReminderKeys = useRefA(new Set());
  const [query, setQuery] = useStateA('');

  useEffectA(() => {
    askAiOpenRef.current = askAiOpen;
  }, [askAiOpen]);

  useEffectA(() => {
    if (bootState === 'loading') return;
    const splash = document.getElementById('mn-boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    const handle = setTimeout(() => splash.remove(), 240);
    return () => clearTimeout(handle);
  }, [bootState]);

  const navigateView = useCallbackA((nextView) => {
    setView(current => {
      if (current !== nextView) lastViewRef.current = current;
      return nextView;
    });
  }, []);

  const goBackView = useCallbackA(() => {
    const target = lastViewRef.current || 'notes';
    setView(current => {
      lastViewRef.current = current === target ? 'notes' : current;
      return target;
    });
  }, []);

  const openAskAi = useCallbackA((initialQuery = '') => {
    setAiNotice(null);
    setAskAiSeed(typeof initialQuery === 'string' ? initialQuery : '');
    setAskAiOpen(true);
  }, []);

  const notifyAskAiComplete = useCallbackA((notice) => {
    if (askAiOpenRef.current) return;
    setAiNotice({
      id: `ai_${Date.now().toString(36)}`,
      query: notice?.query || 'AI task completed',
      error: notice?.error || null,
    });
  }, []);

  // dirtyNotes is keyed by vault+note so same-title novelist starter notes in
  // different vaults cannot overwrite each other's pending saves.
  const [dirtyNotes, setDirtyNotes] = useStateA(() => new Map());
  const vaultActivationSeq = useRefA(0);
  const markDirty = useCallbackA((id) => {
    if (!id || !activeVaultId) return;
    setDirtyNotes(s => {
      const n = new Map(s);
      n.set(mnDirtyNoteKey(activeVaultId, id), { id, vaultId: activeVaultId });
      return n;
    });
  }, [activeVaultId]);
  const tagsDirty = useRefA(false);
  const markTagsDirty = useCallbackA(() => { tagsDirty.current = true; }, []);

  const saveVaultMetaNow = useCallbackA(async (
    vaultId = activeVaultId,
    nextTags = tags,
    nextSelectedId = selectedId,
    forceTags = false
  ) => {
    if (!HAS_DISK || !vaultId) return;
    const patch = {};
    if (forceTags || tagsDirty.current) patch.tags = nextTags;
    if (nextSelectedId) patch.lastSelectedId = nextSelectedId;
    if (!Object.keys(patch).length) return;
    try {
      await window.mn.saveVaultMeta(vaultId, patch);
      if (patch.tags && vaultId === activeVaultId) tagsDirty.current = false;
    } catch (e) {
      console.error('saveVaultMeta failed', e);
    }
  }, [activeVaultId, tags, selectedId]);

  const loadVaultBundle = useCallbackA(async (vaultId) => {
    const vaultRes = await window.mn.loadVault(vaultId);
    if (!vaultRes.ok) throw new Error(vaultRes.error);
    const vault = vaultRes.value;
    let loadedCanvases = [];
    try {
      const canvasRes = await window.mn.listCanvases(vaultId);
      if (canvasRes.ok) loadedCanvases = canvasRes.value || [];
    } catch (e) {
      console.error('listCanvases failed', vaultId, e);
    }
    const loadedNotes = normalizeNotes(vault.notes, mnMdToBlocks);
    const validSelectedId = loadedNotes.some(note => note.id === vault.lastSelectedId)
      ? vault.lastSelectedId
      : loadedNotes[0]?.id || null;
    return {
      notes: loadedNotes,
      tags: vault.tags || [],
      canvases: loadedCanvases,
      lastSelectedId: validSelectedId,
      novelistMode: !!vault.novelistMode,
      workflowStates: vault.workflowStates || null,
    };
  }, [mnMdToBlocks]);

  // ── Bootstrap from disk ─────────────────────────────────────────────────
  useEffectA(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!HAS_DISK) {
          // In-browser fallback: use seed
          const seedNotes = normalizeNotes(SEED_NOTES, mnMdToBlocks);
          if (cancelled) return;
        setVaults([{
          id: 'v_personal', name: 'Personal', slug: 'personal',
            path: '~/VispNote/personal', notes: seedNotes, tags: SEED_TAGS, canvases: [], novelistMode: false,
        }]);
          setActiveVaultId('v_personal');
          setTags(SEED_TAGS);
          setNotes(seedNotes);
          setCanvases([]);
          setSelectedId(seedNotes[0]?.id || null);
          setBootState('ready');
          return;
        }

        const prefsRes = await window.mn.getPrefs();
        if (!prefsRes.ok) throw new Error(prefsRes.error);
        const prefs = prefsRes.value;
        if (prefs.tweaks) {
          const mergedTweaks = { ...MN_TWEAK_DEFAULTS, ...prefs.tweaks };
          window.MN_LOGSEQ?.setWorkflowStates?.(mnNormalizeWorkflowStatesForApp(mergedTweaks.workflowStates));
          setTweaks(t => ({ ...t, ...prefs.tweaks }));
        }
        if (prefs.aiConfig && window.mn?.ai) await window.mn.ai.setConfig(prefs.aiConfig);

        const vlistRes = await window.mn.listVaults();
        if (!vlistRes.ok) throw new Error(vlistRes.error);
        const vlist = vlistRes.value;
        if (!vlist.length) throw new Error('No vaults found');

        const activeId = vlist.some(vault => vault.id === prefs.activeVaultId)
          ? prefs.activeVaultId
          : vlist[0].id;
        const loaded = await loadVaultBundle(activeId);

        if (cancelled) return;
        setVaults(vlist.map(meta => meta.id === activeId
          ? { ...meta, novelistMode: loaded.novelistMode, workflowStates: loaded.workflowStates || meta.workflowStates || null, notes: loaded.notes, tags: loaded.tags, lastSelectedId: loaded.lastSelectedId, canvases: loaded.canvases }
          : { ...meta, notes: null, tags: null, canvases: null }));
        setActiveVaultId(activeId);
        setTags(loaded.tags || []);
        setNotes(loaded.notes);
        setCanvases(loaded.canvases);
        setSelectedId(loaded.lastSelectedId || loaded.notes[0]?.id || null);
        if (prefs.activeVaultId !== activeId) window.mn.setPrefs({ activeVaultId: activeId });
        setBootState('ready');
      } catch (e) {
        console.error('Bootstrap failed', e);
        if (!cancelled) { setBootError(e.message || String(e)); setBootState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [loadVaultBundle]);

  // ── Persist tweaks ─────────────────────────────────────────────────────
  const tweakInitialized = useRefA(false);
  useEffectA(() => {
    if (!HAS_DISK) return;
    if (!tweakInitialized.current) { tweakInitialized.current = true; return; }
    const t = setTimeout(() => { window.mn.setPrefs({ tweaks }); }, 250);
    return () => clearTimeout(t);
  }, [tweaks]);

  const findNotesForVault = useCallbackA((vaultId, currentNotes = notes, currentVaults = vaults) => {
    if (vaultId === activeVaultId) return currentNotes;
    return currentVaults.find(v => v.id === vaultId)?.notes || [];
  }, [activeVaultId, notes, vaults]);

  const saveDirtyNotesNow = useCallbackA(async (entries, currentNotes = notes, currentVaults = vaults) => {
    if (!HAS_DISK || !entries?.length) return;
    for (const entry of entries) {
      const id = entry?.id;
      const vaultId = entry?.vaultId;
      if (!id || !vaultId) continue;
      const noteList = findNotesForVault(vaultId, currentNotes, currentVaults);
      const n = noteList.find(x => x.id === id);
      if (!n) continue;
      try {
        await window.mn.saveNote(vaultId, noteForDisk(n, mnBlocksToMd));
        setDirtyNotes(cur => {
          const key = mnDirtyNoteKey(vaultId, id);
          if (cur.get(key)?.vaultId !== vaultId) return cur;
          const next = new Map(cur);
          next.delete(key);
          return next;
        });
      } catch (e) {
        console.error('saveNote failed', id, e);
      }
    }
  }, [findNotesForVault, notes, vaults]);

  // ── Persist dirty notes (debounced) ────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !dirtyNotes.size) return;
    const handle = setTimeout(async () => {
      await saveDirtyNotesNow([...dirtyNotes.values()]);
    }, 500);
    return () => clearTimeout(handle);
  }, [dirtyNotes, saveDirtyNotesNow]);

  // ── Persist tags + lastSelectedId ──────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId) return;
    if (!tagsDirty.current) return;
    saveVaultMetaNow(activeVaultId, tags, selectedId, true);
  }, [tags, activeVaultId, selectedId, saveVaultMetaNow]);

  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId || !selectedId) return;
    const t = setTimeout(() => {
      saveVaultMetaNow(activeVaultId, tags, selectedId, false);
    }, 1000);
    return () => clearTimeout(t);
  }, [selectedId, activeVaultId, tags, saveVaultMetaNow]);

  const refreshVaultRegistry = useCallbackA(async ({ reloadActive = false, reason = '' } = {}) => {
    if (!HAS_DISK) return { ok: true };
    try {
      const res = await window.mn.listVaults();
      if (!res.ok) throw new Error(res.error);
      const metas = res.value || [];
      if (!metas.length) throw new Error('No vaults found');
      const validIds = new Set(metas.map(v => v.id));
      const nextActiveId = validIds.has(activeVaultId) ? activeVaultId : metas[0].id;
      const activeChanged = nextActiveId !== activeVaultId;
      const activeHasDirtyNotes = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
      const activeHasUnsavedChanges = activeHasDirtyNotes || tagsDirty.current;
      let activeBundle = null;

      if (activeChanged || (reloadActive && nextActiveId && !activeHasUnsavedChanges)) {
        const activationSeq = ++vaultActivationSeq.current;
        activeBundle = await loadVaultBundle(nextActiveId);
        if (activationSeq !== vaultActivationSeq.current) return { ok: false, stale: true };
      }

      setDirtyNotes(cur => {
        let changed = false;
        const next = new Map();
        cur.forEach((entry, key) => {
          if (validIds.has(entry.vaultId)) next.set(key, entry);
          else changed = true;
        });
        return changed ? next : cur;
      });

      setVaults(currentVaults => metas.map(meta => {
        const cached = currentVaults.find(v => v.id === meta.id) || {};
        if (activeBundle && meta.id === nextActiveId) {
          return {
            ...meta,
            notes: activeBundle.notes,
            tags: activeBundle.tags,
            lastSelectedId: activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null,
            canvases: activeBundle.canvases,
            novelistMode: activeBundle.novelistMode,
            workflowStates: activeBundle.workflowStates || meta.workflowStates || null,
          };
        }
        if (!activeChanged && meta.id === activeVaultId) {
          return {
            ...meta,
            notes,
            tags,
            lastSelectedId: selectedId,
            canvases,
            novelistMode: !!meta.novelistMode,
            workflowStates: meta.workflowStates || cached.workflowStates || null,
          };
        }
        return {
          ...meta,
          notes: cached.notes || null,
          tags: cached.tags || null,
          lastSelectedId: cached.lastSelectedId || null,
          canvases: cached.canvases || null,
          novelistMode: !!meta.novelistMode,
          workflowStates: meta.workflowStates || cached.workflowStates || null,
        };
      }));

      if (activeBundle) {
        setNotes(activeBundle.notes);
        setTags(activeBundle.tags);
        setCanvases(activeBundle.canvases);
        setActiveCanvas(null);
        setSelectedId(activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null);
        setActiveVaultId(nextActiveId);
        tagsDirty.current = false;
        if (activeChanged) {
          setSelectedTag(null);
          setSelectedWorkflow(null);
          setQuery('');
          navigateView('notes');
          window.mn.setPrefs({ activeVaultId: nextActiveId });
        }
      }
      return { ok: true, vaults: metas, activeVaultId: nextActiveId, reason };
    } catch (e) {
      console.error('refreshVaultRegistry failed', reason, e);
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, dirtyNotes, loadVaultBundle, notes, tags, selectedId, canvases, navigateView]);

  useEffectA(() => {
    if (!HAS_DISK || bootState !== 'ready') return;
    const refreshVisible = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      refreshVaultRegistry({ reloadActive: true, reason: 'focus' });
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [bootState, refreshVaultRegistry]);

  // Listen for host tweak-mode messages (still supported)
  useEffectA(() => {
    const handler = (e) => {
      const msg = e.data || {};
      if (msg.type === '__activate_edit_mode') setSettingsOpen(true);
      if (msg.type === '__deactivate_edit_mode') setSettingsOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const setTweak = (key, val) => {
    setTweaks(t => {
      const next = { ...t, [key]: val };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
      return next;
    });
  };

  const theme = tweaks.theme;
  const T = MN_THEMES[theme];
  const fonts = MN_FONTS[tweaks.fontChoice] || MN_FONTS['Editorial (Newsreader + Inter)'];
  useEffectA(() => {
    const root = document.documentElement;
    root.style.setProperty('--mn-ui', fonts.ui);
    root.style.setProperty('--mn-body', fonts.body);
    root.style.setProperty('--mn-mono', fonts.mono);
    root.style.setProperty('--mn-bg', T.bg);
    root.style.setProperty('--mn-app-font-size', tweaks.appFontSize === 'small' ? '12px' : tweaks.appFontSize === 'large' ? '14px' : tweaks.appFontSize === 'x-large' ? '15px' : '13px');
  }, [fonts, T, tweaks.appFontSize]);

  // ── Vault switching (lazy load from disk) ──────────────────────────────
  const selectVault = useCallbackA(async (id) => {
    if (id === activeVaultId) return;
    const activationSeq = ++vaultActivationSeq.current;
    const pendingForCurrentVault = [...dirtyNotes.values()].filter(entry => entry.vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    // stash current vault's in-memory state into cache
    setVaults(vs => vs.map(v => v.id === activeVaultId
      ? { ...v, notes, tags, lastSelectedId: selectedId, canvases }
      : v));
    const target = vaults.find(v => v.id === id);
    if (!target) return;

    let targetNotes = target.notes, targetTags = target.tags, targetSel = target.lastSelectedId;
    let targetNovelistMode = !!target.novelistMode;
    let targetWorkflowStates = target.workflowStates || null;
    let targetCanvases = target.canvases;
    if (!targetNotes && HAS_DISK) {
      try {
        const res = await window.mn.loadVault(id);
        if (!res.ok) throw new Error(res.error);
        targetNotes = normalizeNotes(res.value.notes, mnMdToBlocks);
        targetTags = res.value.tags || [];
        targetSel = targetNotes.some(note => note.id === res.value.lastSelectedId)
          ? res.value.lastSelectedId
          : targetNotes[0]?.id || null;
        targetNovelistMode = !!res.value.novelistMode;
        targetWorkflowStates = res.value.workflowStates || null;
      } catch (e) {
        console.error('loadVault failed', id, e);
        await refreshVaultRegistry({ reloadActive: true, reason: 'selectVault-load-failed' });
        return;
      }
    }
    if (!targetCanvases && HAS_DISK) {
      try {
        const res = await window.mn.listCanvases(id);
        if (res.ok) targetCanvases = res.value || [];
      } catch (e) { console.error('listCanvases failed', id, e); }
    }
    targetNotes = targetNotes || [];
    targetTags = targetTags || [];
    targetCanvases = targetCanvases || [];
    if (targetSel && !targetNotes.some(note => note.id === targetSel)) targetSel = targetNotes[0]?.id || null;
    if (activationSeq !== vaultActivationSeq.current) return;
    setNotes(targetNotes);
    setTags(targetTags);
    setCanvases(targetCanvases);
    setActiveCanvas(null);
    setSelectedId(targetSel || targetNotes[0]?.id || null);
    setActiveVaultId(id);
    setVaults(vs => vs.map(v => v.id === id
      ? { ...v, notes: targetNotes, tags: targetTags, lastSelectedId: targetSel || targetNotes[0]?.id || null, canvases: targetCanvases, novelistMode: targetNovelistMode, workflowStates: targetWorkflowStates }
      : v));
    setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
    if (HAS_DISK) window.mn.setPrefs({ activeVaultId: id });
  }, [activeVaultId, vaults, notes, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, refreshVaultRegistry, navigateView]);

  const persistNovelistSetup = async (vaultId, sourceNotes, sourceTags, sourceWorkflowStates = null, options = {}) => {
    const nextTags = mnEnsureNovelistTags(sourceTags);
    const nextWorkflowStates = mnNormalizeWorkflowStatesForApp(sourceWorkflowStates || MN_NOVELIST_WORKFLOW_STATES);
    const normalizedSourceNotes = (sourceNotes || []).map(note => {
      const nextTagsForNote = mnNormalizeNovelistLegacyTags(note.tags || []);
      const nextBody = mnNormalizeNoteBody(
        mnEnsureScenePlotPoints(mnNormalizeNovelistLegacyBody(note.body || mnBlocksToMd(note.blocks || [])), nextTagsForNote),
        note.title || 'Untitled'
      );
      return { ...note, tags: nextTagsForNote, body: nextBody, blocks: mnMdToBlocks(nextBody || '') };
    });
    const starterNotes = options.includeStarterNotes === false
      ? []
      : mnBuildNovelistStarterNotes(normalizedSourceNotes, mnMdToBlocks, vaultId);
    const nextNotes = [...starterNotes, ...normalizedSourceNotes];
    if (HAS_DISK && vaultId) {
      await window.mn.saveVaultMeta(vaultId, { tags: nextTags, novelistMode: true, workflowStates: nextWorkflowStates });
      for (const note of nextNotes) {
        await window.mn.saveNote(vaultId, noteForDisk(note, mnBlocksToMd));
      }
    }
    return { notes: nextNotes, tags: nextTags, workflowStates: nextWorkflowStates };
  };

  const createVault = useCallbackA(async (name, options = {}) => {
    const activationSeq = ++vaultActivationSeq.current;
    const vaultType = options.type === 'novelist' ? 'novelist' : 'notes';
    const pendingForCurrentVault = [...dirtyNotes.values()].filter(entry => entry.vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    if (!HAS_DISK) {
      // In-browser fallback (transient)
      const id = 'v_' + Date.now();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const firstNoteId = 'n_' + Date.now();
      const isNovelistVault = vaultType === 'novelist';
      const newNotes = isNovelistVault ? mnBuildNovelistStarterNotes([], mnMdToBlocks, id).slice(0, 3) : [{
        id: firstNoteId,
        title: 'Welcome to ' + name,
        date: new Date().toISOString(),
        tags: [],
        pinned: false,
        body: `- This is your new vault\n- Create notes with ⌘N`,
        blocks: mnMdToBlocks(`- This is your new vault\n- Create notes with ⌘N`),
      }];
      const setup = vaultType === 'novelist'
        ? await persistNovelistSetup(id, newNotes, [], null, { includeStarterNotes: false })
        : { notes: newNotes, tags: [] };
      if (activationSeq !== vaultActivationSeq.current) return;
      const newCanvases = [];
      setVaults(vs => [
        ...vs.map(v => v.id === activeVaultId ? { ...v, notes, tags, lastSelectedId: selectedId, canvases } : v),
        { id, name, slug, path: `~/VispNote/${slug}`, notes: setup.notes, tags: setup.tags, workflowStates: setup.workflowStates || null, canvases: newCanvases, novelistMode: vaultType === 'novelist' },
      ]);
      setNotes(setup.notes); setTags(setup.tags); setSelectedId(setup.notes[0]?.id || firstNoteId);
      tagsDirty.current = false;
      setCanvases(newCanvases); setActiveCanvas(null);
      setActiveVaultId(id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      return;
    }
    try {
      const res = await window.mn.createVault(name, { type: vaultType, workflowStates: vaultType === 'novelist' ? MN_NOVELIST_WORKFLOW_STATES : null });
      if (!res.ok) throw new Error(res.error);
      const v = res.value;
      // stash current
      setVaults(vs => [
        ...vs.map(x => x.id === activeVaultId ? { ...x, notes, tags, lastSelectedId: selectedId, canvases } : x),
        { ...v, notes: null, tags: null, canvases: [], novelistMode: vaultType === 'novelist', workflowStates: vaultType === 'novelist' ? MN_NOVELIST_WORKFLOW_STATES : null },
      ]);
      if (activationSeq !== vaultActivationSeq.current) return;
      setActiveVaultId(v.id);
      setNotes([]);
      setTags([]);
      setCanvases([]);
      setActiveCanvas(null);
      setSelectedId(null);
      setSelectedTag(null);
      setSelectedWorkflow(null);
      setQuery('');
      navigateView('notes');
      // load the new vault from disk (it has the seeded welcome note)
      const loadRes = await window.mn.loadVault(v.id);
      if (!loadRes.ok) throw new Error(loadRes.error);
      const loaded = loadRes.value;
      let loadedNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
      let loadedTags = loaded.tags || [];
      if (vaultType === 'novelist') {
        const setup = await persistNovelistSetup(v.id, loadedNotes, loadedTags, loaded.workflowStates, { includeStarterNotes: false });
        loadedNotes = setup.notes;
        loadedTags = setup.tags;
        loaded.workflowStates = setup.workflowStates;
      }
      if (activationSeq !== vaultActivationSeq.current) return;
      setNotes(loadedNotes); setTags(loadedTags);
      tagsDirty.current = false;
      setCanvases([]); setActiveCanvas(null);
      setSelectedId(loaded.lastSelectedId || loadedNotes[0]?.id || null);
      setActiveVaultId(v.id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      setVaults(vs => vs.map(x => x.id === v.id
        ? { ...x, notes: loadedNotes, tags: loadedTags, lastSelectedId: loaded.lastSelectedId || loadedNotes[0]?.id || null, canvases: [], workflowStates: loaded.workflowStates || null, novelistMode: vaultType === 'novelist' }
        : x));
      window.mn.setPrefs({ activeVaultId: v.id });
    } catch (e) {
      console.error('createVault failed', e); alert('Could not create vault: ' + e.message);
    }
  }, [activeVaultId, notes, vaults, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks, mnBlocksToMd]);

  const setActiveVaultNovelistMode = useCallbackA(async (enabled) => {
    if (!activeVaultId) return { ok: false, error: 'No active vault.' };
    if (enabled) {
      try {
        const setup = await persistNovelistSetup(activeVaultId, notes, tags);
        setNotes(setup.notes);
        setTags(setup.tags);
        setVaults(vs => vs.map(v => v.id === activeVaultId
          ? { ...v, notes: setup.notes, tags: setup.tags, workflowStates: setup.workflowStates, novelistMode: true }
          : v));
        tagsDirty.current = false;
        return { ok: true };
      } catch (e) {
        console.error('enable novelist mode failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    try {
      if (HAS_DISK) await window.mn.saveVaultMeta(activeVaultId, { novelistMode: false, workflowStates: null });
      setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, novelistMode: false, workflowStates: null } : v));
      if (view === 'novelist') navigateView('notes');
      return { ok: true };
    } catch (e) {
      console.error('disable novelist mode failed', e);
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, notes, tags, view, navigateView]);

  const renameVault = useCallbackA(async (id, name) => {
    setVaults(vs => vs.map(v => v.id === id ? { ...v, name } : v));
    if (HAS_DISK) {
      try { await window.mn.renameVault(id, name); }
      catch (e) { console.error('renameVault failed', e); }
    }
  }, []);

  const deleteVault = useCallbackA(async (id) => {
    const target = vaults.find(v => v.id === id);
    if (!target) return { ok: false, error: 'Vault not found.' };
    if (vaults.length <= 1) {
      return { ok: false, error: 'Create another vault before deleting this one.' };
    }

    const deletingActive = id === activeVaultId;
    const pendingToSave = [...dirtyNotes.values()].filter(entry => entry.vaultId !== id);
    await saveDirtyNotesNow(pendingToSave, notes, vaults);
    if (!deletingActive) await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);

    const localRemaining = vaults.filter(v => v.id !== id);
    let nextVaults = localRemaining;
    let nextActiveId = deletingActive ? localRemaining[0]?.id : activeVaultId;

    if (HAS_DISK) {
      try {
        const res = await window.mn.deleteVault(id);
        if (!res.ok) throw new Error(res.error);
        nextVaults = (res.value?.vaults || localRemaining).map(meta => {
          const cached = localRemaining.find(v => v.id === meta.id) || {};
          return { ...meta, notes: cached.notes || null, tags: cached.tags || null, lastSelectedId: cached.lastSelectedId || null, canvases: cached.canvases || null, novelistMode: !!(meta.novelistMode ?? cached.novelistMode), workflowStates: meta.workflowStates || cached.workflowStates || null };
        });
        nextActiveId = deletingActive ? (res.value?.activeVaultId || nextVaults[0]?.id) : activeVaultId;
      } catch (e) {
        console.error('deleteVault failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    setDirtyNotes(cur => {
      const next = new Map();
      cur.forEach((entry, key) => {
        if (entry.vaultId !== id) next.set(key, entry);
      });
      return next;
    });

    if (!deletingActive) {
      setVaults(nextVaults);
      return { ok: true };
    }

    const nextMeta = nextVaults.find(v => v.id === nextActiveId) || nextVaults[0];
    if (!nextMeta) return { ok: false, error: 'No vault available after delete.' };

    let nextNotes = nextMeta.notes || [];
    let nextTags = nextMeta.tags || [];
    let nextCanvases = nextMeta.canvases || [];
    let nextSelectedId = nextMeta.lastSelectedId || null;
    if (HAS_DISK) {
      try {
        const loadRes = await window.mn.loadVault(nextMeta.id);
        if (!loadRes.ok) throw new Error(loadRes.error);
        const loaded = loadRes.value;
        nextNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
        nextTags = loaded.tags || [];
        nextSelectedId = loaded.lastSelectedId || nextNotes[0]?.id || null;
        nextMeta.novelistMode = !!loaded.novelistMode;
        nextMeta.workflowStates = loaded.workflowStates || nextMeta.workflowStates || null;
        const canvasRes = await window.mn.listCanvases(nextMeta.id);
        nextCanvases = canvasRes.ok ? (canvasRes.value || []) : [];
      } catch (e) {
        console.error('loadVault after delete failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    setVaults(nextVaults.map(v => v.id === nextMeta.id
      ? { ...v, notes: nextNotes, tags: nextTags, lastSelectedId: nextSelectedId, canvases: nextCanvases, novelistMode: !!nextMeta.novelistMode, workflowStates: nextMeta.workflowStates || null }
      : v));
    setNotes(nextNotes);
    setTags(nextTags);
    setCanvases(nextCanvases);
    setActiveCanvas(null);
    setSelectedId(nextSelectedId || nextNotes[0]?.id || null);
    setActiveVaultId(nextMeta.id);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    tagsDirty.current = false;
    navigateView('notes');
    if (HAS_DISK) window.mn.setPrefs({ activeVaultId: nextMeta.id });
    return { ok: true };
  }, [activeVaultId, vaults, notes, tags, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks]);

  const vaultsForSidebar = useMemoA(() => vaults.map(v => ({
    ...v,
    noteCount: v.id === activeVaultId ? notes.length : (v.notes?.length ?? 0),
    canvasCount: v.id === activeVaultId ? canvases.length : (v.canvases?.length ?? 0),
  })), [vaults, activeVaultId, notes, canvases]);
  const activeVault = useMemoA(() => vaults.find(v => v.id === activeVaultId) || null, [vaults, activeVaultId]);

  const sidebarHidden = tweaks.showSidebar === false;
  const setSidebarHidden = (v) => {
    const next = typeof v === 'function' ? v(sidebarHidden) : v;
    setTweak('showSidebar', !next);
  };
  const noteListHidden = tweaks.showNoteList === false;
  const setNoteListHidden = (v) => {
    const next = typeof v === 'function' ? v(noteListHidden) : v;
    setTweak('showNoteList', !next);
  };

  // Keep body (markdown) in sync for backlinks / search / save
  const notesWithBody = useMemoA(() => notes.map(n => ({
    ...n,
    body: mnNormalizeNoteBody(
      Array.isArray(n.blocks) ? mnBlocksToMd(n.blocks || []) : (n.body || ''),
      n.title || 'Untitled'
    ),
  })), [notes]);
  const novelistStructure = useMemoA(() => mnBuildNovelistStructure(notesWithBody), [notesWithBody]);
  const novelistNotes = novelistStructure.novelNotes || [];

  const links = useMemoA(() => buildLinks(notesWithBody), [notesWithBody]);
  const normalWorkflowStates = useMemoA(
    () => mnNormalizeWorkflowStatesForApp(tweaks.workflowStates),
    [tweaks.workflowStates]
  );
  const novelistWorkflowStates = useMemoA(
    () => mnNormalizeWorkflowStatesForApp(activeVault?.workflowStates || MN_NOVELIST_WORKFLOW_STATES),
    [activeVault?.workflowStates]
  );
  const workflowStates = activeVault?.novelistMode ? novelistWorkflowStates : normalWorkflowStates;
  useEffectA(() => {
    window.MN_LOGSEQ?.setWorkflowStates?.(workflowStates);
    if (selectedWorkflow && !workflowStates.some(s => s.id === selectedWorkflow)) {
      setSelectedWorkflow(null);
    }
  }, [workflowStates, selectedWorkflow]);
  const updateWorkflowStates = useCallbackA((states) => {
    const next = mnNormalizeWorkflowStatesForApp(states);
    if (activeVault?.novelistMode && activeVaultId) {
      setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, workflowStates: next } : v));
      if (HAS_DISK) {
        window.mn.saveVaultMeta(activeVaultId, { workflowStates: next })
          .catch(e => console.error('save novelist workflow states failed', e));
      }
      return;
    }
    setTweak('workflowStates', next);
  }, [activeVault?.novelistMode, activeVaultId]);
  const workflowData = useMemoA(
    () => collectWorkflowNotes(notesWithBody, workflowStates),
    [notesWithBody, workflowStates]
  );

  const appStats = useMemoA(() => {
    let wordCount = 0, charCount = 0;
    notesWithBody.forEach(n => {
      const t = (n.body || '') + ' ' + (n.title || '');
      charCount += t.length;
      wordCount += t.trim().split(/\s+/).filter(Boolean).length;
    });
    return {
      noteCount: notesWithBody.length,
      tagCount: tags.length,
      linkCount: links.length,
      wordCount, charCount,
    };
  }, [notesWithBody, tags, links]);

  // SQLite-backed search: debounced IPC call returns matching IDs;
  // we intersect with in-memory notes for tag-filter compatibility.
  // searchHits = null  → no active query
  // searchHits = []    → query active but zero matches
  // searchHits = [...] → matched note ids in rank order
  const [searchHits, setSearchHits] = useStateA(null);
  useEffectA(() => {
    const q = query.trim();
    if (!q) { setSearchHits(null); return; }
    const activeVaultHasUnsaved = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
    if (!HAS_DISK || !activeVaultId || activeVaultHasUnsaved) {
      // Browser fallback and dirty-note path: in-memory search reflects unsaved edits.
      const lc = q.toLowerCase();
      const ids = notesWithBody.filter(n =>
        n.title.toLowerCase().includes(lc) ||
        (n.body || '').toLowerCase().includes(lc) ||
        n.tags.some(t => t.toLowerCase().includes(lc))
      ).map(n => n.id);
      setSearchHits(ids);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await window.mn.search(activeVaultId, q, 100);
        if (res.ok) setSearchHits(res.value.map(r => r.id));
      } catch (e) { console.error('search failed', e); }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, activeVaultId, notesWithBody, dirtyNotes]);

  const filteredNotes = useMemoA(() => {
    let ns = [...notesWithBody];
    if (selectedTag) ns = ns.filter(n => n.tags.includes(selectedTag));
    if (selectedWorkflow) {
      const ids = workflowData.noteIdsByState[selectedWorkflow] || new Set();
      ns = ns.filter(n => ids.has(n.id));
    }
    if (searchHits != null) {
      const order = new Map(searchHits.map((id, i) => [id, i]));
      ns = ns.filter(n => order.has(n.id));
      // Preserve search rank order when querying; otherwise default sort
      ns.sort((a, b) => order.get(a.id) - order.get(b.id));
      return ns;
    }
    ns.sort((a, b) => {
      if (tweaks.pinnedFirst !== false) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      if ((tweaks.sortBy || 'modified') === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      }
      if ((tweaks.sortBy || 'modified') === 'created') {
        return new Date(b.date || 0) - new Date(a.date || 0);
      }
      return new Date(b.modifiedAt || b.date || 0) - new Date(a.modifiedAt || a.date || 0);
    });
    return ns;
  }, [notesWithBody, selectedTag, selectedWorkflow, workflowData, searchHits, tweaks.sortBy, tweaks.pinnedFirst]);

  const graphVisibleNotes = useMemoA(() => {
    if (!activeVault?.novelistMode) return filteredNotes;
    const structureIds = new Set([
      ...(novelistStructure.acts || []).map(note => note.id),
      ...(novelistStructure.chapters || []).map(note => note.id),
      ...(novelistStructure.scenes || []).map(note => note.id),
    ]);
    const sceneIds = new Set((novelistStructure.scenes || []).map(note => note.id));
    const novelistIds = new Set((novelistStructure.novelNotes || []).map(note => note.id));
    const hasTag = (note, tag) => (note.tags || []).includes(tag);
    return filteredNotes.filter(note => {
      if (graphFilter === 'structure') return structureIds.has(note.id);
      if (graphFilter === 'characters-scenes') return hasTag(note, 'novel-character') || sceneIds.has(note.id);
      if (graphFilter === 'plot-scenes') return hasTag(note, 'novel-plot') || sceneIds.has(note.id);
      if (graphFilter === 'research-scenes') return hasTag(note, 'novel-research') || sceneIds.has(note.id);
      return novelistIds.has(note.id);
    });
  }, [activeVault?.novelistMode, filteredNotes, graphFilter, novelistStructure]);

  const workflowViewData = useMemoA(
    () => collectWorkflowNotes(filteredNotes, workflowStates),
    [filteredNotes, workflowStates]
  );

  const selectedNote = notes.find(n => n.id === selectedId);
  const deleteTargetNote = deleteTargetId ? notes.find(n => n.id === deleteTargetId) : null;

  const reminderCenterItems = useMemoA(() => {
    const now = Date.now();
    const snoozed = mnReadSnoozedReminders();
    return mnCollectReminderItems(notesWithBody)
      .map(item => {
        const dueTime = item.remindAt?.at?.getTime?.() || 0;
        const snoozedUntil = Number(snoozed[item.key]) || 0;
        return {
          ...item,
          snoozedUntil,
          status: snoozedUntil > now ? 'snoozed' : dueTime <= now ? 'due' : 'upcoming',
        };
      })
      .sort((a, b) => {
        const rank = { due: 0, upcoming: 1, snoozed: 2 };
        const byRank = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
        if (byRank) return byRank;
        return (a.remindAt?.at || 0) - (b.remindAt?.at || 0);
      });
  }, [notesWithBody, toast]);

  const reminderDueCount = reminderCenterItems.filter(item =>
    item.status === 'due' && !dismissedReminderKeys.current.has(item.key)
  ).length;

  const nextStoryOrder = useCallbackA((kind, parentId = null) => {
    const noteById = new Map(notesWithBody.map(note => [note.id, note]));
    const values = (items, step, base) => {
      const ordered = items.map(mnNoteOrderValue).filter(value => value != null);
      return ordered.length ? Math.max(...ordered) + step : base + step;
    };
    if (kind === 'act') return values(novelistStructure.acts || [], 100, 0);
    if (kind === 'chapter') {
      const parent = noteById.get(parentId);
      const base = mnNoteOrderValue(parent) ?? 100;
      const items = (novelistStructure.childrenByActId?.[parentId] || []).map(id => noteById.get(id)).filter(Boolean);
      return values(items, 10, base);
    }
    const parent = noteById.get(parentId);
    const base = mnNoteOrderValue(parent) ?? 100;
    const items = (novelistStructure.childrenByChapterId?.[parentId] || []).map(id => noteById.get(id)).filter(Boolean);
    return values(items, 1, base);
  }, [notesWithBody, novelistStructure]);

  const createNote = useCallbackA(({ title = 'Untitled', body = '', tags: noteTags = [] } = {}, options = {}) => {
    const id = 'n_' + Date.now().toString(36);
    const cleanTitle = String(title || '').trim() || 'Untitled';
    const defaults = mnParseDefaultTags(tweaks.defaultTags);
    const cleanTags = [...noteTags, ...defaults]
      .map(normalizeTagName)
      .filter(Boolean)
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
    const cleanBody = mnNormalizeNoteBody(mnEnsureScenePlotPoints(body || '', cleanTags), cleanTitle);
    const missingTags = cleanTags.filter(tag => !tags.some(t => t.name === tag));
    if (missingTags.length) {
      setTags(ts => {
        const existing = new Set(ts.map(t => t.name));
        const additions = missingTags
          .filter(name => !existing.has(name))
          .map(name => ({ name, hue: (Math.floor(Math.random() * 12) * 30) + 10 }));
        return additions.length ? [...ts, ...additions] : ts;
      });
      markTagsDirty();
    }
    const blocks = cleanBody ? mnMdToBlocks(cleanBody) : [mkBlock({ kind: 'paragraph', content: '' })];
    const newNote = {
      id, title: cleanTitle, body: cleanBody, blocks, tags: cleanTags,
      date: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    setNotes(ns => [newNote, ...ns]);
    if (options.open !== false) {
      setSelectedId(id);
      navigateView(options.view || 'notes');
    }
    markDirty(id);
    return id;
  }, [markDirty, navigateView, tweaks.defaultTags, tags]);

  const updateNote = (id, patch) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const resolved = typeof patch === 'function' ? patch(n) : patch;
      return { ...n, ...resolved, modifiedAt: new Date().toISOString() };
    }));
    markDirty(id);
  };

  const updateNoteBody = useCallbackA((id, bodyOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const currentBody = mnNormalizeNoteBody(mnBlocksToMd(n.blocks || []), n.title || 'Untitled');
      const nextBody = typeof bodyOrUpdater === 'function' ? bodyOrUpdater(currentBody, n) : bodyOrUpdater;
      const cleanBody = mnNormalizeNoteBody(nextBody || '', n.title || 'Untitled');
      return { ...n, body: cleanBody, blocks: mnMdToBlocks(cleanBody || ''), modifiedAt: new Date().toISOString() };
    }));
    markDirty(id);
  }, [markDirty, mnMdToBlocks, mnBlocksToMd]);

  const linkNovelistChapter = useCallbackA((arcId, chapterId, chapterTitle) => {
    const act = notesWithBody.find(n => n.id === arcId);
    const chapter = notesWithBody.find(n => n.id === chapterId);
    const cleanChapterTitle = chapter?.title || chapterTitle;
    if (!act || !cleanChapterTitle) return;
    updateNoteBody(act.id, body => mnNovelEnsureWikiLinkInSection(body, cleanChapterTitle, 'Chapters'));
    if (chapterId) updateNoteBody(chapterId, body => mnNovelUpsertPropertyLink(body, 'act', act.title));
  }, [notesWithBody, updateNoteBody]);

  const linkNovelistScene = useCallbackA((chapterId, sceneId, sceneTitle) => {
    const chapter = notesWithBody.find(n => n.id === chapterId);
    const scene = notesWithBody.find(n => n.id === sceneId);
    const cleanSceneTitle = scene?.title || sceneTitle;
    if (!chapter || !cleanSceneTitle) return;
    const act = notesWithBody.find(n => n.id === novelistStructure.parentByChapterId?.[chapter.id]);
    updateNoteBody(chapter.id, body => mnNovelEnsureWikiLinkInSection(body, cleanSceneTitle, 'Scenes'));
    if (sceneId) updateNoteBody(sceneId, body => {
      let next = mnNovelUpsertPropertyLink(body, 'chapter', chapter.title);
      if (act) next = mnNovelUpsertPropertyLink(next, 'act', act.title);
      return next;
    });
  }, [notesWithBody, novelistStructure, updateNoteBody]);

  const setNovelistOrder = useCallbackA((noteId, order) => {
    updateNoteBody(noteId, body => order
      ? mnSetBodyProperty(body, 'order', order)
      : mnRemoveBodyProperty(body, 'order'));
  }, [updateNoteBody]);

  const renameNoteTitle = useCallbackA((noteId, title) => {
    if (!String(title || '').trim()) return;
    updateNote(noteId, { title: String(title).trim() });
  }, [updateNote]);

  const convertNovelistType = useCallbackA((noteId, tag) => {
    const cleanTag = normalizeTagName(tag);
    const structureTags = new Set(['novel-act', 'novel-chapter', 'novel-scene']);
    if (!structureTags.has(cleanTag)) return;
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const nextTags = [
      ...(note.tags || []).filter(existing => !structureTags.has(existing)),
      cleanTag,
    ].filter((value, index, arr) => arr.indexOf(value) === index);
    updateNote(noteId, { tags: nextTags });
  }, [notes, updateNote]);

  const updateNoteBlocks = useCallbackA((id, blocksOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const prevBlocks = n.blocks || [];
      const nextBlocks = window.MN_EDITOR_OPS.resolveBlocksChange(prevBlocks, blocksOrUpdater);
      return { ...n, blocks: nextBlocks, modifiedAt: new Date().toISOString() };
    }));
    markDirty(id);
  }, [markDirty]);

  const toggleCheckFromAggregate = (it) => {
    if (it.isReminderOnly) return;
    const n = notes.find(x => x.id === it.noteId);
    if (!n) return;
    if (it.blockId) {
      const nextBlocks = mnCloneBlocks(n.blocks || []);
      const loc = mnLocate(nextBlocks, it.blockId);
      if (loc?.block?.kind === 'todo') {
        loc.block.checked = !loc.block.checked;
        updateNote(it.noteId, { blocks: nextBlocks });
      }
      return;
    }
    const target = it.text.trim();
    let changed = false;
    const walkMutate = (bs) => bs.map(b => {
      if (!changed && b.kind === 'todo' && b.content.trim() === target) {
        changed = true;
        return { ...b, checked: !b.checked, children: walkMutate(b.children) };
      }
      return { ...b, children: walkMutate(b.children) };
    });
    updateNote(it.noteId, { blocks: walkMutate(n.blocks || []) });
  };

  const updateWorkflowNoteStatus = useCallbackA((noteId, _itemId, workflow) => {
    if (!notes.find(x => x.id === noteId)) return;
    updateNoteBody(noteId, body => workflow
      ? mnSetBodyProperty(body, 'status', workflow)
      : mnRemoveBodyProperty(body, 'status'));
  }, [notes, updateNoteBody]);

  const updateWorkflowArchived = useCallbackA((noteId, workflowArchived) => {
    updateNote(noteId, { workflowArchived: !!workflowArchived });
  }, [updateNote]);

  const updateNoteTags = useCallbackA((noteId, noteTags) => {
    updateNote(noteId, { tags: noteTags });
  }, [updateNote]);

  const addTag = (name) => {
    const clean = normalizeTagName(name);
    if (!clean) return null;
    if (tags.find(t => t.name === clean)) return clean;
    const hue = (Math.floor(Math.random() * 12) * 30) + 10;
    setTags(ts => ts.find(t => t.name === clean) ? ts : [...ts, { name: clean, hue }]);
    markTagsDirty();
    return clean;
  };

  const removeTag = (name) => {
    const clean = normalizeTagName(name);
    if (!clean || !tags.find(t => t.name === clean)) return;
    const taggedNotes = notes.filter(n => (n.tags || []).includes(clean));
    setTags(ts => ts.filter(t => t.name !== clean));
    if (selectedTag === clean) setSelectedTag(null);
    if (taggedNotes.length) {
      setNotes(ns => ns.map(n => {
        if (!(n.tags || []).includes(clean)) return n;
        return {
          ...n,
          tags: (n.tags || []).filter(t => t !== clean),
          modifiedAt: new Date().toISOString(),
        };
      }));
      taggedNotes.forEach(n => markDirty(n.id));
    }
    markTagsDirty();
  };

  const removeNovelistSupportingType = (name) => {
    const clean = normalizeTagName(name);
    const structureTags = new Set(['novel-act', 'novel-chapter', 'novel-scene']);
    if (!clean || structureTags.has(clean)) return;
    setTags(ts => ts.filter(t => t.name !== clean));
    if (selectedTag === clean) setSelectedTag(null);
    markTagsDirty();
  };

  const promptNewTag = (name) => {
    const raw = typeof name === 'string' ? name : window.prompt('New tag name (no spaces):', '');
    if (raw) addTag(raw);
  };

  const requestDeleteNote = (id) => {
    if (!notes.find(x => x.id === id)) return;
    setDeleteTargetId(id);
  };

  const deleteNote = async (id) => {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    setDeleteTargetId(null);
    setDirtyNotes(cur => {
      const key = mnDirtyNoteKey(activeVaultId, id);
      if (!cur.has(key)) return cur;
      const next = new Map(cur);
      next.delete(key);
      return next;
    });
    setNotes(ns => ns.filter(x => x.id !== id));
    const rest = notes.filter(x => x.id !== id);
    setSelectedId(rest[0]?.id || null);
    if (HAS_DISK && activeVaultId) {
      try { await window.mn.deleteNote(activeVaultId, id); }
      catch (e) { console.error('deleteNote failed', e); }
    }
  };

  const summarizeCanvas = (canvas) => ({
    ...canvas,
    id: canvas.id,
    title: canvas.title || 'Untitled canvas',
    createdAt: canvas.createdAt,
    modifiedAt: canvas.modifiedAt,
    elementCount: (canvas.elements || []).length,
  });

  const upsertCanvasList = (list, canvas) => {
    const summary = summarizeCanvas(canvas);
    return [summary, ...(list || []).filter(c => c.id !== summary.id)]
      .sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
  };

  const cacheCanvases = useCallbackA((nextCanvases) => {
    setCanvases(nextCanvases);
    setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, canvases: nextCanvases } : v));
  }, [activeVaultId]);

  const upsertCanvasSummary = useCallbackA((canvas) => {
    setCanvases(cur => upsertCanvasList(cur, canvas));
    setVaults(vs => vs.map(v => v.id === activeVaultId
      ? { ...v, canvases: upsertCanvasList(v.canvases || [], canvas) }
      : v));
  }, [activeVaultId]);

  const openCanvasDashboard = useCallbackA(() => {
    setActiveCanvas(null);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    navigateView('canvas');
  }, [navigateView]);

  const openCanvas = useCallbackA(async (canvasId) => {
    if (!canvasId) {
      openCanvasDashboard();
      return null;
    }
    let canvas = null;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.getCanvas(activeVaultId, canvasId);
        if (!res.ok) throw new Error(res.error);
        canvas = res.value;
      } catch (e) {
        console.error('getCanvas failed', canvasId, e);
      }
    } else {
      canvas = canvases.find(c => c.id === canvasId) || null;
    }
    if (!canvas) return null;
    setActiveCanvas(canvas);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    navigateView('canvas');
    return canvas;
  }, [activeVaultId, canvases, navigateView, openCanvasDashboard]);

  const createCanvas = useCallbackA(async (title = 'Untitled canvas', options = {}) => {
    const makeCanvas = window.mnNewCanvas || ((name) => ({
      id: `c_${Date.now().toString(36)}`,
      title: name,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      viewport: { x: 0, y: 0, scale: 1 },
      elements: [],
    }));
    const initial = makeCanvas(title);
    let saved = initial;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.saveCanvas(activeVaultId, initial);
        if (!res.ok) throw new Error(res.error);
        saved = res.value;
      } catch (e) {
        console.error('saveCanvas failed', e);
        alert('Could not create canvas: ' + (e.message || String(e)));
        return null;
      }
    }
    upsertCanvasSummary(saved);
    if (options.open !== false) {
      setActiveCanvas(saved);
      setSelectedTag(null);
      setSelectedWorkflow(null);
      setQuery('');
      navigateView('canvas');
    }
    return saved;
  }, [activeVaultId, navigateView, upsertCanvasSummary]);

  const saveCanvas = useCallbackA(async (canvas) => {
    if (!canvas?.id) return null;
    let saved = canvas;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.saveCanvas(activeVaultId, canvas);
        if (!res.ok) throw new Error(res.error);
        saved = res.value;
      } catch (e) {
        console.error('saveCanvas failed', canvas.id, e);
        return null;
      }
    }
    setActiveCanvas(current => current?.id === saved.id ? saved : current);
    upsertCanvasSummary(saved);
    return saved;
  }, [activeVaultId, upsertCanvasSummary]);

  const deleteCanvas = useCallbackA(async (canvasId) => {
    if (!canvasId) return;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.deleteCanvas(activeVaultId, canvasId);
        if (!res.ok) throw new Error(res.error);
      } catch (e) {
        console.error('deleteCanvas failed', canvasId, e);
        alert('Could not delete canvas: ' + (e.message || String(e)));
        return;
      }
    }
    const next = canvases.filter(c => c.id !== canvasId);
    cacheCanvases(next);
    if (activeCanvas?.id === canvasId) setActiveCanvas(null);
    navigateView('canvas');
  }, [activeVaultId, activeCanvas, canvases, cacheCanvases, navigateView]);

  useEffectA(() => {
    const h = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key || '';
      const lowerKey = key.toLowerCase();
      const isBackslashKey = key === '\\' || key === '|' || e.code === 'Backslash';
      if (isMod && e.shiftKey && lowerKey === 'n') {
        e.preventDefault(); setCaptureOpen(true);
      } else if (isMod && lowerKey === 'n' && !e.shiftKey) {
        e.preventDefault(); createNote();
      } else if (isMod && lowerKey === 'g') {
        e.preventDefault();
        navigateView(view === 'graph' ? 'notes' : 'graph');
        setSelectedTag(null); setSelectedWorkflow(null);
      } else if (isMod && lowerKey === 'k') {
        e.preventDefault();
        setAskAiOpen(v => {
          const next = !v;
          if (next) setAiNotice(null);
          return next;
        });
      } else if (isMod && e.shiftKey && isBackslashKey) {
        e.preventDefault(); setNoteListHidden(v => !v);
      } else if (isMod && isBackslashKey && !e.shiftKey) {
        e.preventDefault(); setSidebarHidden(v => !v);
      } else if (e.key === 'Escape') {
        setSettingsOpen(false); setAskAiOpen(false); setReminderCenterOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [createNote, view, navigateView]);

  // Runtime reminder scan over @remind directives in the active vault.
  useEffectA(() => {
    if (bootState !== 'ready') return;
    const check = () => {
      if (toast) return;
      const now = Date.now();
      const today = new Date().toDateString();
      const snoozed = mnReadSnoozedReminders();
      const due = mnCollectReminderItems(notesWithBody)
        .filter(item => {
          const dueTime = item.remindAt?.at?.getTime?.();
          if (!dueTime || dueTime > now) return false;
          if (tweaks.showOverdue === false && item.remindAt.at.toDateString() !== today) return false;
          if (dismissedReminderKeys.current.has(item.key)) return false;
          if ((Number(snoozed[item.key]) || 0) > now) return false;
          return true;
        })
        .sort((a, b) => a.remindAt.at - b.remindAt.at);
      if (!due.length) return;
      const next = due[0];
      setToast(next);
      if (tweaks.reminderSound === true) mnPlayReminderSound();
    };
    check();
    const tm = setInterval(check, 60000);
    return () => clearInterval(tm);
  }, [bootState, notesWithBody, tweaks.showOverdue, tweaks.reminderSound, toast]);

  // Push vault + selected note into the OS title bar
  useEffectA(() => {
    if (!HAS_DISK) return;
    const vname = vaults.find(v => v.id === activeVaultId)?.name;
    const nname = selectedNote?.title;
    const t = [vname, nname].filter(Boolean).join(' — ') || 'VispNote';
    window.mn.setTitle(t === 'VispNote' ? t : `${t} — VispNote`);
  }, [activeVaultId, vaults, selectedNote]);

  const noteListVisible = view === 'notes' || view === 'graph' || view === 'workflow';
  const reminderCenterTop = view === 'workflow' ? 30 : view === 'graph' ? 12 : 13;
  const noteListTitle = query.trim()
    ? 'Search'
    : selectedTag
    ? `#${selectedTag}`
    : selectedWorkflow
    ? selectedWorkflow
    : (view === 'workflow' ? 'Workflow notes' : view === 'todos' ? 'Todos' : view === 'today' ? 'Daily rollup' : 'All notes');
  const noteListSubtitle = query.trim()
    ? `${filteredNotes.length} match${filteredNotes.length === 1 ? '' : 'es'}`
    : view === 'workflow'
    ? `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'} · ${workflowViewData.total} workflow note${workflowViewData.total === 1 ? '' : 's'}`
    : `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'}${selectedTag ? ' tagged' : selectedWorkflow ? ' with workflow' : ''}`;

  // ── Loading / error screens ─────────────────────────────────────────────
  if (bootState !== 'ready') {
    return <MnLaunchScreen state={bootState} error={bootError} T={T} />;
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: T.bg, position: 'relative',
      fontFamily: 'var(--mn-ui)', overflow: 'hidden',
      fontSize: 'var(--mn-app-font-size)',
    }}>
        <div style={{ display: 'flex', height: '100%' }}>
          {!sidebarHidden && (
            <MnSidebar
              tags={tags} notes={notesWithBody}
              selectedTag={selectedTag}
              selectedWorkflow={selectedWorkflow}
              workflowStates={workflowStates}
              workflowCounts={workflowData.counts}
              workflowTotal={workflowData.total}
              onSelectTag={(t) => { setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes'); }}
              onSelectWorkflow={(wf) => { setSelectedWorkflow(wf); setSelectedTag(null); navigateView('notes'); }}
              onOpenWorkflowPanel={() => { navigateView('workflow'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenNovelist={() => { navigateView('novelist'); setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); }}
              onOpenTodos={() => { navigateView('todos'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenToday={() => { navigateView('today'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenCanvas={openCanvasDashboard}
              onOpenAskAI={HAS_DISK ? openAskAi : null}
              todayActive={view === 'today'}
              todosActive={view === 'todos'}
              graphActive={view === 'graph'}
              workflowActive={view === 'workflow'}
              novelistActive={view === 'novelist'}
              novelistEnabled={!!activeVault?.novelistMode}
              novelistCount={novelistNotes.length}
              canvasActive={view === 'canvas'}
              canvasCount={canvases.length}
              onNewTag={promptNewTag}
              onDeleteTag={removeTag}
              onNew={() => setCaptureOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onCollapse={() => setSidebarHidden(true)}
              vaults={vaultsForSidebar}
              activeVaultId={activeVaultId}
              onSelectVault={selectVault}
              onCreateVault={createVault}
              onRefreshVaults={refreshVaultRegistry}
              onRenameVault={renameVault}
              onDeleteVault={deleteVault}
              T={T} density={tweaks.density} theme={theme}
            />
          )}

          {!sidebarHidden && (
            <MnPanelGrip side="sidebar" onCollapse={() => setSidebarHidden(true)} T={T} />
          )}
          {sidebarHidden && (
            <MnPanelGripPeek onExpand={() => setSidebarHidden(false)} T={T} title="Show sidebar" />
          )}

          {noteListVisible && !noteListHidden && (
            <MnNoteList
              notes={filteredNotes}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                if (view === 'notes') return;
              }}
              title={noteListTitle}
              subtitle={noteListSubtitle}
              query={query}
              onQueryChange={setQuery}
              novelistStructure={activeVault?.novelistMode && view === 'notes' && !query.trim() && !selectedTag && !selectedWorkflow ? novelistStructure : null}
              allNotes={notesWithBody}
              tags={tags} theme={theme} density={tweaks.density} T={T}
            />
          )}

          {noteListVisible && !noteListHidden && (
            <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
          )}
          {noteListVisible && noteListHidden && (
            <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show note list" />
          )}

          {view === 'notes' && selectedNote && (
            <MnEditor
              note={selectedNote} notes={notesWithBody} tags={tags} links={links}
              vaultId={activeVaultId}
              canvases={canvases}
              onOpenCanvas={openCanvas}
              onCreateCanvas={createCanvas}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onCreateLinkedNote={(title) => {
                const cleanTitle = String(title || '').trim();
                if (!cleanTitle) return null;
                const selectedStage = novelistStructure.stageByNoteId?.[selectedNote.id];
                if (selectedStage === 'act') {
                  return createNote({
                    title: cleanTitle,
                    body: `status:: OUTLINE\norder:: ${nextStoryOrder('chapter', selectedNote.id)}\nact:: [[${selectedNote.title}]]\n## Scenes\n- Goal\n- Scene list\n- Revision notes`,
                    tags: ['novel-chapter'],
                  });
                }
                if (selectedStage === 'chapter') {
                  const act = notesWithBody.find(n => n.id === novelistStructure.parentByChapterId?.[selectedNote.id]);
                  return createNote({
                    title: cleanTitle,
                    body: `status:: DRAFT\norder:: ${nextStoryOrder('scene', selectedNote.id)}\n${act ? `act:: [[${act.title}]]\n` : ''}chapter:: [[${selectedNote.title}]]\npov:: \nsetting:: \npurpose:: \nDraft the scene here.`,
                    tags: ['novel-scene'],
                  });
                }
                const lowerTitle = cleanTitle.toLowerCase();
                const inferredTags = lowerTitle.includes('scene')
                  ? ['novel-scene']
                  : lowerTitle.includes('chapter')
                  ? ['novel-chapter']
                  : lowerTitle.includes('act')
                  ? ['novel-act']
                  : [];
                return createNote({ title: cleanTitle, body: '', tags: inferredTags });
              }}
              onOpenTag={(t) => {
                if (!tags.find(x => x.name === t)) addTag(t);
                setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes');
              }}
              onBlocksChange={(blocks) => updateNoteBlocks(selectedNote.id, blocks)}
              onTitleChange={(title) => updateNote(selectedNote.id, { title })}
              onAddTag={(t) => updateNote(selectedNote.id, { tags: [...selectedNote.tags, t] })}
              onCreateTag={(raw) => {
                const name = addTag(raw);
                if (name && !selectedNote.tags.includes(name)) {
                  updateNote(selectedNote.id, { tags: [...selectedNote.tags, name] });
                }
              }}
              onRemoveTag={(t) => updateNote(selectedNote.id, { tags: selectedNote.tags.filter(x => x !== t) })}
              onPinToggle={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned })}
              onDelete={() => requestDeleteNote(selectedNote.id)}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onBack={goBackView}
              onToggleSidebar={() => setSidebarHidden(v => !v)}
              sidebarHidden={sidebarHidden}
              onToggleNoteList={() => setNoteListHidden(v => !v)}
              noteListHidden={noteListHidden}
              editorWidth={tweaks.editorWidth}
              fontSize={tweaks.fontSize}
              indentGuides={tweaks.indentGuides !== false}
              spellCheck={tweaks.spellCheck !== false}
              autoLink={tweaks.autoLink !== false}
              collapseByDefault={tweaks.collapseByDefault === true}
              novelistPath={activeVault?.novelistMode ? novelistStructure.pathByNoteId?.[selectedNote.id] : null}
              novelistMode={!!activeVault?.novelistMode}
              workflowStates={workflowStates}
              workflowStatus={mnNormalizeNoteStatus(
                mnBodyPropertyValue(notesWithBody.find(n => n.id === selectedNote.id)?.body || '', 'status'),
                workflowStates
              )}
              onSetWorkflowStatus={(status) => updateWorkflowNoteStatus(selectedNote.id, null, status)}
              theme={theme} T={T}
            />
          )}

          {view === 'graph' && (
            <MnGraph
              notes={graphVisibleNotes} links={links} tags={tags}
              focusId={selectedId}
              style={tweaks.graphStyle}
              graphFilter={activeVault?.novelistMode ? graphFilter : null}
              onGraphFilterChange={setGraphFilter}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              T={T}
            />
          )}

          {view === 'todos' && (
            <MnTodosPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onToggleCheck={toggleCheckFromAggregate}
              T={T} theme={theme} variant={tweaks.todoVariant}
            />
          )}
          {view === 'workflow' && (
            <MnWorkflowPanel
              notes={notesWithBody}
              tags={tags}
              workflowStates={workflowStates}
              workflowItems={workflowViewData.byState}
              archivedNotes={workflowViewData.archivedNotes}
              onWorkflowStatesChange={updateWorkflowStates}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onSetWorkflow={updateWorkflowNoteStatus}
              onSetWorkflowArchived={updateWorkflowArchived}
              onSetNoteTags={updateNoteTags}
              T={T} theme={theme}
            />
          )}
          {view === 'novelist' && !!activeVault?.novelistMode && (
            <MnNovelistPanel
              notes={notesWithBody}
              novelistNotes={novelistNotes}
              tags={tags}
              vaultId={activeVaultId}
              workflowStates={workflowStates}
              workflowItems={workflowViewData.byState}
              novelistStructure={novelistStructure}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] }, { open: false })}
              onLinkChapter={linkNovelistChapter}
              onLinkScene={linkNovelistScene}
              onSetOrder={setNovelistOrder}
              onRenameNote={renameNoteTitle}
              onConvertNoteType={convertNovelistType}
              onDeleteNote={requestDeleteNote}
              onCreateTag={addTag}
              onRemoveSupportingType={removeNovelistSupportingType}
              T={T}
              theme={theme}
            />
          )}
          {view === 'today' && (
            <MnTodayPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              rollupFormat={tweaks.rollupFormat || 'long'}
              T={T} theme={theme}
            />
          )}
          {view === 'canvas' && (
            <MnCanvasPanel
              canvases={canvases}
              activeCanvas={activeCanvas}
              onCreate={createCanvas}
              onOpen={openCanvas}
              onBack={openCanvasDashboard}
              onSave={saveCanvas}
              onDelete={deleteCanvas}
              T={T}
            />
          )}
        </div>

        {captureOpen && (
          <MnQuickCapture
            tags={tags}
            onClose={() => setCaptureOpen(false)}
            onSave={({ title, body, tags: noteTags }) => {
              createNote({ title, body, tags: noteTags });
              setCaptureOpen(false);
            }}
            T={T} theme={theme}
          />
        )}
        <MnReminderToast
          toast={toast}
          onDismiss={() => {
            if (toast?.key) dismissedReminderKeys.current.add(toast.key);
            setToast(null);
          }}
          onSnooze={() => {
            if (toast?.key) {
              const minutes = Number(tweaks.snoozeMinutes || 15) || 15;
              mnWriteSnoozedReminder(toast.key, Date.now() + minutes * 60000);
            }
            setToast(null);
          }}
          onOpen={(id) => {
            if (toast?.key) dismissedReminderKeys.current.add(toast.key);
            setSelectedId(id); navigateView('notes'); setToast(null);
          }}
          T={T} variant={tweaks.toastVariant}
        />
        <MnAiNotice
          notice={aiNotice}
          onOpen={openAskAi}
          onDismiss={() => setAiNotice(null)}
          T={T}
        />

        <MnReminderCenter
          open={reminderCenterOpen}
          items={reminderCenterItems}
          dueCount={reminderDueCount}
          onToggle={() => setReminderCenterOpen(v => !v)}
          onClose={() => setReminderCenterOpen(false)}
          onOpenNote={(item) => {
            if (item?.key && item.status === 'due') dismissedReminderKeys.current.add(item.key);
            setSelectedId(item.noteId);
            navigateView('notes');
            setReminderCenterOpen(false);
            if (toast?.key === item?.key) setToast(null);
          }}
          topOffset={reminderCenterTop}
          T={T}
        />

        {/* FAB */}
        <button onClick={() => setCaptureOpen(true)} title="Quick capture (⌘⇧N)"
          style={{
            position: 'absolute', bottom: 22, right: 22, zIndex: 20,
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            background: T.ink, color: T.bg, border: 'none',
            boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 30%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M8 3V13M3 8H13" strokeLinecap="round"/>
          </svg>
        </button>

        {settingsOpen && (
          <MnSettingsModal tweaks={tweaks} setTweak={setTweak} T={T}
            stats={appStats}
            vaults={vaultsForSidebar}
            activeVaultId={activeVaultId}
            activeVault={activeVault}
            onCreateVault={createVault}
            onDeleteVault={deleteVault}
            onSetVaultNovelistMode={setActiveVaultNovelistMode}
            onClose={() => setSettingsOpen(false)} />
        )}
        {deleteTargetNote && (
          <MnDeleteNoteDialog
            note={deleteTargetNote}
            T={T}
            onCancel={() => setDeleteTargetId(null)}
            onConfirm={() => deleteNote(deleteTargetNote.id)}
          />
        )}
        {askAiOpen && (
          <MnAskAI
            vaultId={activeVaultId}
            currentNote={selectedNote ? {
              ...selectedNote,
              body: mnNormalizeNoteBody(mnBlocksToMd(selectedNote.blocks || []), selectedNote.title || 'Untitled'),
            } : null}
            allNotes={notesWithBody}
            initialQuery={askAiSeed}
            onClose={() => setAskAiOpen(false)}
            onOpenNote={(id) => { setSelectedId(id); navigateView('notes'); }}
            onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] })}
            onApplyCurrentPageBody={(body) => {
              if (!selectedNote) return;
              const cleanBody = mnNormalizeNoteBody(body, selectedNote.title || 'Untitled');
              updateNote(selectedNote.id, { body: cleanBody, blocks: mnMdToBlocks(cleanBody) });
            }}
            session={askAiSession}
            setSession={setAskAiSession}
            onBackgroundComplete={notifyAskAiComplete}
            T={T} />
        )}
    </div>
  );
}

window.MnApp = MnApp;
