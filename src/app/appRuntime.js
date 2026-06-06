// App runtime defaults and pure-ish helper bridges.

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
  "rollupDefaultRange": "today",
  "rollupGroupBy": "created",
  "rollupShowPreviews": true,
  "rollupShowTasks": true,
  "rollupShowReminders": true,
  "rollupCollapseOlder": true,
  "reminderSound": false,
  "showOverdue": true,
  "snoozeMinutes": "15",
  "weekStart": "monday",
  "workflowStates": null,
  "plugins": null,
  "autoSave": true,
  "storageFormat": "markdown",
  "sync": "local"
}/*EDITMODE-END*/;

const MN_APP_HELPERS = window.MN_APP_HELPERS || {};
const MN_APP_MUTATIONS = window.MN_APP_MUTATIONS || {};
const MN_APP_CANVAS_ACTIONS = window.MN_APP_CANVAS_ACTIONS || {};
const MN_APP_NOVELIST = window.MN_APP_NOVELIST || {};
const MN_APP_ACTIONS_FACTORY = window.MN_APP_ACTIONS_FACTORY || {};
const MN_AUTOSAVE_DEBOUNCE_MS = 500;
const MN_AUTOSAVE_MAX_WAIT_MS = 5000;
const MN_NOTE_TEMPLATES = MN_APP_HELPERS.NOTE_TEMPLATES || [];
const MN_PLUGIN_API = window.MN_PLUGINS || {};
const {
  normalizeNovelImportCandidates,
  buildNovelImportPlan,
} = MN_APP_HELPERS;
const {
  MN_NOVELIST_TAGS = [],
  MN_NOVELIST_WORKFLOW_STATES = [],
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
} = MN_APP_NOVELIST;

// Convert raw notes (with markdown body) to runtime form (with parsed blocks).
function normalizeNotes(notes, mnMdToBlocks) {
  return MN_APP_HELPERS.normalizeNotes(notes, mnMdToBlocks);
}

// Strip in-memory-only fields before persisting to disk.
function noteForDisk(n, mnBlocksToMd) {
  return MN_APP_HELPERS.noteForDisk(n, mnBlocksToMd);
}

function mnNormalizeNoteStatus(raw, states = []) {
  return MN_APP_HELPERS.normalizeWorkflowStatus
    ? MN_APP_HELPERS.normalizeWorkflowStatus(raw, states, window.MN_LOGSEQ?.mnNormalizeWorkflowId)
    : (() => {
      const id = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
      return (states || []).some(state => state.id === id) ? id : '';
    })();
}

function mnWorkflowNotePreview(note) {
  return MN_APP_HELPERS.workflowNotePreview ? MN_APP_HELPERS.workflowNotePreview(note) : String(note?.body || '').slice(0, 180);
}

function collectWorkflowNotes(notes, states) {
  return MN_APP_HELPERS.collectWorkflowNotes
    ? MN_APP_HELPERS.collectWorkflowNotes(notes, states, {
      propertyValue: mnBodyPropertyValue,
      normalizeId: window.MN_LOGSEQ?.mnNormalizeWorkflowId,
    })
    : { counts: {}, byState: {}, noteIdsByState: {}, archivedNotes: [], total: 0 };
}

function collectWorkflowBlocks(notes, states) {
  return collectWorkflowNotes(notes, states);
}

function normalizeTagName(name) {
  return MN_APP_HELPERS.normalizeTagName(name);
}

function mnParseDefaultTags(value) {
  return MN_APP_HELPERS.parseDefaultTags(value);
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
  return MN_APP_HELPERS.reminderKey ? MN_APP_HELPERS.reminderKey(item) : [item.noteId, item.line ?? item.blockId ?? '', item.remindAt?.date || '', item.remindAt?.time || '', item.text || ''].join('|');
}

function mnReadSnoozedReminders() {
  return window.MN_STORAGE?.getJson?.('mn:snoozedReminders', {}) || {};
}

function mnWriteSnoozedReminder(key, until) {
  const data = mnReadSnoozedReminders();
  data[key] = until;
  window.MN_STORAGE?.setJson?.('mn:snoozedReminders', data);
}

function mnCollectReminderItems(notes) {
  return MN_APP_HELPERS.collectReminderItems
    ? MN_APP_HELPERS.collectReminderItems(notes, window.MN_REMIND, window.mnWalk)
    : [];
}

function mnCollectTaskItems(notes) {
  return MN_APP_HELPERS.collectTaskItems
    ? MN_APP_HELPERS.collectTaskItems(notes, window.MN_REMIND, window.mnWalk)
    : [];
}

function mnNewAskAiSession() {
  const now = new Date().toISOString();
  return {
    id: `chat_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`,
    title: 'New chat',
    messages: [],
    pending: false,
    error: null,
    activeAction: null,
    background: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

function mnAskAiSessionTitle(session) {
  const messages = session?.messages || [];
  const firstUser = messages.find(message => message.role === 'user' && message.text)?.text || '';
  if (session?.title && (session.title !== 'New chat' || !firstUser)) return session.title;
  return firstUser ? firstUser.slice(0, 54) : 'New chat';
}

function mnPickActiveAskAiSession(sessions, preferredId = '', options = {}) {
  const preferred = sessions.find(session => session.id === preferredId);
  if (preferred && options.allowArchivedPreferred !== false) return preferred;
  if (preferred && !preferred.archived) return preferred;
  return sessions.find(session => !session.archived)
    || sessions[0]
    || null;
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


window.MN_APP_RUNTIME = {
  MN_TWEAK_DEFAULTS,
  MN_APP_HELPERS,
  MN_APP_MUTATIONS,
  MN_APP_CANVAS_ACTIONS,
  MN_APP_NOVELIST,
  MN_APP_ACTIONS_FACTORY,
  MN_AUTOSAVE_DEBOUNCE_MS,
  MN_AUTOSAVE_MAX_WAIT_MS,
  MN_NOTE_TEMPLATES,
  MN_PLUGIN_API,
  normalizeNovelImportCandidates,
  buildNovelImportPlan,
  MN_NOVELIST_TAGS,
  MN_NOVELIST_WORKFLOW_STATES,
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
  normalizeNotes,
  noteForDisk,
  mnNormalizeNoteStatus,
  mnWorkflowNotePreview,
  collectWorkflowNotes,
  collectWorkflowBlocks,
  normalizeTagName,
  mnParseDefaultTags,
  mnNormalizeWorkflowStatesForApp,
  mnReminderKey,
  mnReadSnoozedReminders,
  mnWriteSnoozedReminder,
  mnCollectReminderItems,
  mnCollectTaskItems,
  mnNewAskAiSession,
  mnAskAiSessionTitle,
  mnPickActiveAskAiSession,
  mnPlayReminderSound,
};
