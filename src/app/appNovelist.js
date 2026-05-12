(function (root, factory) {
  const helpers = root.MN_APP_HELPERS || (typeof require === 'function' ? require('./appHelpers.js') : {});
  const api = factory(helpers);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_APP_NOVELIST = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (MN_APP_HELPERS) {
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
  return MN_APP_HELPERS.novelistNoteId(title, vaultId);
}

function mnEnsureNovelistTags(existingTags = []) {
  return MN_APP_HELPERS.ensureNovelistTags(existingTags, MN_NOVELIST_TAGS);
}

function mnBuildNovelistStarterNotes(notes = [], mnMdToBlocks, vaultId = '') {
  return MN_APP_HELPERS.buildNovelistStarterNotes(notes, mnMdToBlocks, vaultId, MN_NOVELIST_STARTERS);
}

function mnDirtyNoteKey(vaultId, noteId) {
  return MN_APP_HELPERS.dirtyNoteKey(vaultId, noteId);
}

function mnIsNovelistNote(note) {
  return MN_APP_HELPERS.isNovelistNote(note);
}

function mnNormalizeNovelistLegacyTags(tags = []) {
  return MN_APP_HELPERS.normalizeNovelistLegacyTags(tags);
}

function mnNormalizeNovelistLegacyBody(body = '') {
  return MN_APP_HELPERS.normalizeNovelistLegacyBody(body);
}

function mnEnsureScenePlotPoints(body = '', tags = []) {
  return MN_APP_HELPERS.ensureScenePlotPoints(body, tags);
}

function mnNovelTitleKey(title) {
  return MN_APP_HELPERS.novelTitleKey(title);
}

function mnNovelWikiTitles(body = '') {
  return MN_APP_HELPERS.novelWikiTitles(body);
}

function mnReplaceWikiLinkTitle(body = '', oldTitle = '', newTitle = '') {
  return MN_APP_HELPERS.replaceWikiLinkTitle(body, oldTitle, newTitle);
}

function mnBodyPropertyLineRe(key = '') {
  return MN_APP_HELPERS.bodyPropertyLineRe(key);
}

function mnBodyPropertyValue(body = '', key = '') {
  return MN_APP_HELPERS.bodyPropertyValue(body, key);
}

function mnBodyPropertyTitle(body = '', key = '') {
  return MN_APP_HELPERS.bodyPropertyTitle(body, key);
}

function mnBodyPropertyInsertIndex(lines) {
  return MN_APP_HELPERS.bodyPropertyInsertIndex(lines);
}

function mnSetBodyProperty(body = '', key = '', value = '') {
  return MN_APP_HELPERS.setBodyProperty(body, key, value);
}

function mnRemoveBodyProperty(body = '', key = '') {
  return MN_APP_HELPERS.removeBodyProperty(body, key);
}

function mnBodyPropertyParts(line = '') {
  return MN_APP_HELPERS.bodyPropertyParts(line);
}

function mnNormalizeBodyPropertySyntax(body = '') {
  return MN_APP_HELPERS.normalizeBodyPropertySyntax(body);
}

function mnStripDuplicateTitleHeading(body = '', title = '') {
  return MN_APP_HELPERS.stripDuplicateTitleHeading(body, title);
}

function mnNormalizeNoteBody(body = '', title = '') {
  return MN_APP_HELPERS.normalizeNoteBody(body, title);
}

function mnNoteOrderValue(note) {
  return MN_APP_HELPERS.noteOrderValue(note);
}

function mnCompareStoryNotes(a, b) {
  return MN_APP_HELPERS.compareStoryNotes(a, b);
}

function mnNovelOutlineLinks(body = '') {
  return MN_APP_HELPERS.novelOutlineLinks(body);
}

function mnNovelPropertyTitle(body = '', key = '') {
  return MN_APP_HELPERS.novelPropertyTitle(body, key);
}

function mnNovelHasWikiLink(body = '', title = '') {
  return MN_APP_HELPERS.novelHasWikiLink(body, title);
}

function mnNovelEnsureWikiLink(body = '', title = '') {
  return MN_APP_HELPERS.novelEnsureWikiLink(body, title);
}

function mnNovelEnsureWikiLinkInSection(body = '', title = '', sectionTitle = '') {
  return MN_APP_HELPERS.novelEnsureWikiLinkInSection(body, title, sectionTitle);
}

function mnNovelUpsertPropertyLink(body = '', key = '', title = '') {
  return MN_APP_HELPERS.novelUpsertPropertyLink(body, key, title);
}

function mnBuildNovelistStructure(notes = []) {
  return MN_APP_HELPERS.buildNovelistStructure(notes);
}


  return {
    MN_NOVELIST_TAGS,
    MN_NOVELIST_WORKFLOW_STATES,
    MN_NOVELIST_STARTERS,
    mnNovelistNoteId,
    mnEnsureNovelistTags,
    mnBuildNovelistStarterNotes,
    mnDirtyNoteKey,
    mnIsNovelistNote,
    mnNormalizeNovelistLegacyTags,
    mnNormalizeNovelistLegacyBody,
    mnEnsureScenePlotPoints,
    mnNovelTitleKey,
    mnNovelWikiTitles,
    mnReplaceWikiLinkTitle,
    mnBodyPropertyLineRe,
    mnBodyPropertyValue,
    mnBodyPropertyTitle,
    mnBodyPropertyInsertIndex,
    mnSetBodyProperty,
    mnRemoveBodyProperty,
    mnBodyPropertyParts,
    mnNormalizeBodyPropertySyntax,
    mnStripDuplicateTitleHeading,
    mnNormalizeNoteBody,
    mnNoteOrderValue,
    mnCompareStoryNotes,
    mnNovelOutlineLinks,
    mnNovelPropertyTitle,
    mnNovelHasWikiLink,
    mnNovelEnsureWikiLink,
    mnNovelEnsureWikiLinkInSection,
    mnNovelUpsertPropertyLink,
    mnBuildNovelistStructure,
  };
});
