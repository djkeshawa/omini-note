(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_APP_MUTATIONS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function uniqueNoteTitle(notes = [], rawTitle = 'Untitled', excludeId = null) {
    const base = String(rawTitle || '').trim() || 'Untitled';
    const existing = new Set((notes || [])
      .filter(note => note.id !== excludeId)
      .map(note => String(note.title || '').trim().toLowerCase())
      .filter(Boolean));
    if (!existing.has(base.toLowerCase())) return base;
    let index = 2;
    while (existing.has(`${base} ${index}`.toLowerCase())) index++;
    return `${base} ${index}`;
  }

  function cleanNoteTags(noteTags = [], defaultTags = '', normalizeTagName, parseDefaultTags) {
    const normalize = typeof normalizeTagName === 'function'
      ? normalizeTagName
      : name => String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
    const defaults = typeof parseDefaultTags === 'function'
      ? parseDefaultTags(defaultTags)
      : String(defaultTags || '').split(',').map(normalize);
    return [...(noteTags || []), ...(defaults || [])]
      .map(normalize)
      .filter(Boolean)
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
  }

  function missingTagNames(existingTags = [], cleanTags = []) {
    const existing = new Set((existingTags || []).map(tag => tag.name));
    return (cleanTags || []).filter(tag => !existing.has(tag));
  }

  function addTagsToList(existingTags = [], tagNames = [], hueForTag) {
    const existing = new Set((existingTags || []).map(tag => tag.name));
    const additions = (tagNames || [])
      .filter(name => name && !existing.has(name))
      .map((name, index) => ({
        name,
        hue: typeof hueForTag === 'function' ? hueForTag(name, index) : ((index % 12) * 30) + 10,
      }));
    return additions.length ? [...existingTags, ...additions] : existingTags;
  }

  function blockListForBody(body, mdToBlocks, makeEmptyBlock) {
    if (body) return mdToBlocks(body);
    return [makeEmptyBlock()];
  }

  function createNoteDraft(input = {}, ctx = {}) {
    const {
      id,
      title = 'Untitled',
      body = '',
      tags: noteTags = [],
      defaultTags = '',
      now = new Date().toISOString(),
      existingTags = [],
    } = input;
    const cleanTitle = String(title || '').trim() || 'Untitled';
    const cleanTags = cleanNoteTags(noteTags, defaultTags, ctx.normalizeTagName, ctx.parseDefaultTags);
    const cleanBody = ctx.normalizeNoteBody(ctx.ensureScenePlotPoints(body || '', cleanTags), cleanTitle);
    const blocks = blockListForBody(cleanBody, ctx.mdToBlocks, ctx.makeEmptyBlock);
    return {
      note: {
        id,
        title: cleanTitle,
        body: cleanBody,
        blocks,
        tags: cleanTags,
        date: now,
        modifiedAt: now,
        diskModifiedAt: null,
      },
      missingTags: missingTagNames(existingTags, cleanTags),
    };
  }

  function duplicateNoteDraft(source, input = {}, ctx = {}) {
    if (!source) return null;
    const now = input.now || new Date().toISOString();
    const title = input.title || `${source.title || 'Untitled'} copy`;
    const body = ctx.normalizeNoteBody(source.body || ctx.blocksToMd(source.blocks || []), title);
    return {
      ...source,
      id: input.id,
      title,
      body,
      blocks: blockListForBody(body, ctx.mdToBlocks, ctx.makeEmptyBlock),
      pinned: false,
      date: now,
      modifiedAt: now,
      diskModifiedAt: null,
    };
  }

  function applyNotePatch(note, patch, now = new Date().toISOString()) {
    const resolved = typeof patch === 'function' ? patch(note) : patch;
    return { ...note, ...resolved, modifiedAt: now };
  }

  function applyNoteBodyUpdate(note, bodyOrUpdater, ctx = {}) {
    const currentBody = ctx.normalizeNoteBody(ctx.blocksToMd(note.blocks || []), note.title || 'Untitled');
    const nextBody = typeof bodyOrUpdater === 'function' ? bodyOrUpdater(currentBody, note) : bodyOrUpdater;
    const cleanBody = ctx.normalizeNoteBody(nextBody || '', note.title || 'Untitled');
    return {
      ...note,
      body: cleanBody,
      blocks: ctx.mdToBlocks(cleanBody || ''),
      modifiedAt: ctx.now || new Date().toISOString(),
    };
  }

  function applyNoteBlocksUpdate(note, blocksOrUpdater, ctx = {}) {
    const prevBlocks = note.blocks || [];
    const nextBlocks = ctx.resolveBlocksChange(prevBlocks, blocksOrUpdater);
    return { ...note, blocks: nextBlocks, modifiedAt: ctx.now || new Date().toISOString() };
  }

  function renameNoteTitleDrafts(notes = [], noteId, title, ctx = {}) {
    if (!String(title || '').trim()) return null;
    const source = (notes || []).find(note => note.id === noteId);
    if (!source) return null;
    const nextTitle = uniqueNoteTitle(notes, title, noteId);
    const previousTitle = source.title || '';
    const linkUpdates = new Map();
    (notes || []).forEach(note => {
      if (note.id === noteId) return;
      const sourceBody = note.body || ctx.blocksToMd(note.blocks || []);
      const linkedBody = ctx.replaceWikiLinkTitle(sourceBody, previousTitle, nextTitle);
      if (linkedBody !== sourceBody) {
        linkUpdates.set(note.id, ctx.normalizeNoteBody(linkedBody, note.title || 'Untitled'));
      }
    });
    const now = ctx.now || new Date().toISOString();
    return {
      title: nextTitle,
      dirtyIds: [noteId, ...linkUpdates.keys()],
      notes: (notes || []).map(note => {
        if (note.id === noteId) return { ...note, title: nextTitle, modifiedAt: now };
        const cleanBody = linkUpdates.get(note.id);
        if (!cleanBody) return note;
        return { ...note, body: cleanBody, blocks: ctx.mdToBlocks(cleanBody || ''), modifiedAt: now };
      }),
    };
  }

  function convertNovelistTypeTags(note, tag, normalizeTagName) {
    const cleanTag = normalizeTagName(tag);
    const structureTags = new Set(['novel-act', 'novel-chapter', 'novel-scene']);
    if (!note || !structureTags.has(cleanTag)) return null;
    return [
      ...(note.tags || []).filter(existing => !structureTags.has(existing)),
      cleanTag,
    ].filter((value, index, arr) => arr.indexOf(value) === index);
  }

  function removeTagFromNotes(notes = [], tag, now = new Date().toISOString()) {
    const dirtyIds = [];
    const nextNotes = (notes || []).map(note => {
      if (!(note.tags || []).includes(tag)) return note;
      dirtyIds.push(note.id);
      return {
        ...note,
        tags: (note.tags || []).filter(value => value !== tag),
        modifiedAt: now,
      };
    });
    return { notes: nextNotes, dirtyIds };
  }

  function summarizeCanvas(canvas = {}) {
    return {
      ...canvas,
      id: canvas.id,
      title: canvas.title || 'Untitled canvas',
      createdAt: canvas.createdAt,
      modifiedAt: canvas.modifiedAt,
      elementCount: (canvas.elements || []).length,
    };
  }

  function upsertCanvasList(list = [], canvas = {}) {
    const summary = summarizeCanvas(canvas);
    return [summary, ...(list || []).filter(item => item.id !== summary.id)]
      .sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
  }

  return {
    uniqueNoteTitle,
    cleanNoteTags,
    missingTagNames,
    addTagsToList,
    createNoteDraft,
    duplicateNoteDraft,
    applyNotePatch,
    applyNoteBodyUpdate,
    applyNoteBlocksUpdate,
    renameNoteTitleDrafts,
    convertNovelistTypeTags,
    removeTagFromNotes,
    summarizeCanvas,
    upsertCanvasList,
  };
});
