// Main App — composes sidebar, note list, editor, panels, overlays.
// Disk-backed via window.mn (Electron preload IPC). Falls back to in-memory
// seed when running outside Electron (e.g. opened directly in a browser).

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;

const {
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
} = window.MN_APP_RUNTIME || {};

const MN_APP_SHELL = window.MN_APP_SHELL || {};
const MN_PANEL_COMPONENTS = window.MN_PANEL_COMPONENTS || {};
const MN_NOTES_VAULTS_SERVICE = window.MN_NOTES_VAULTS_SERVICE || {};
const MN_VAULTS_SERVICE = window.MN_VAULTS_SERVICE || {};
const MN_NOTES_VAULTS_STATE = window.MN_NOTES_VAULTS_STATE || {};
const {
  HAS_DISK = typeof window !== 'undefined' && !!window.mn,
  MnLaunchScreen,
  MnDeleteNoteDialog,
  MnAppNoticeDialog,
  MnSaveConflictDialog,
  MnVersionHistoryDialog,
  MnReminderCenter,
  MnAiNotice,
  MnCommandPalette,
  MnVaultHealthDialog,
} = MN_APP_SHELL;
const {
  MnSmartViewsPanel,
} = MN_PANEL_COMPONENTS;
const {
  MnSidebar,
  MnPanelGrip,
  MnPanelGripPeek,
  MnNoteList,
  MnAiChatHistory,
  MnEditor,
  MnAskAI,
  MnGraph,
  MnTodosPanel,
  MnCalendarPanel,
  MnWorkflowPanel,
  MnNovelistPanel,
  MnTodayPanel,
  MnRecentlyDeletedPanel,
  MnCanvasPanel,
  MnQuickCapture,
  MnReminderToast,
  MnSettingsModal,
} = window;

const MN_NOVEL_IMPORT_TOOL = {
  name: 'propose-novel-import',
  title: 'Propose novel import notes',
  description: 'Return structured novelist notes extracted from imported text files.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            kind: { type: 'string', enum: ['act', 'chapter', 'scene', 'character', 'location', 'plot', 'research', 'revision'] },
            body: { type: 'string' },
            actTitle: { type: 'string' },
            chapterTitle: { type: 'string' },
            order: { type: 'string' },
            pov: { type: 'string' },
            purpose: { type: 'string' },
            sourceFile: { type: 'string' },
            confidence: { type: 'string' },
            plotPoints: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'kind', 'body'],
        },
      },
    },
    required: ['notes'],
  },
};

function mnCalendarCleanTaskText(value = '') {
  if (MN_APP_HELPERS?.agendaCleanActionText) return MN_APP_HELPERS.agendaCleanActionText(value);
  return String(value || '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '')
    .replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/g, '')
    .trim();
}

function mnCalendarTaskContent(text, date = '', time = '', deferUntil = '') {
  if (MN_APP_HELPERS?.agendaBuildTaskContent) return MN_APP_HELPERS.agendaBuildTaskContent(text, date, time, deferUntil);
  const clean = mnCalendarCleanTaskText(text);
  const cleanDate = String(date || '').trim();
  const cleanTime = String(time || '').trim();
  const cleanDefer = String(deferUntil || '').trim();
  return [
    cleanDate ? `${clean} @remind ${[cleanDate, cleanTime].filter(Boolean).join(' ')}` : clean,
    cleanDefer ? `@defer ${cleanDefer}` : '',
  ].filter(Boolean).join(' ');
}

function mnCalendarReminderDateParts(date = new Date()) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function mnCalendarUpdateMarkdownLine(line, nextText, checked) {
  const match = String(line || '').match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
  if (match) {
    const box = checked == null ? match[2] : checked ? 'x' : ' ';
    return `${match[1]}- [${box}] ${nextText}`;
  }
  return nextText;
}

function mnNovelImportChunks(files = [], maxChars = 11000) {
  const chunks = [];
  (files || []).forEach(file => {
    const text = String(file?.text || '');
    for (let start = 0; start < text.length; start += maxChars) {
      chunks.push({
        fileName: file.name || 'imported-file',
        index: Math.floor(start / maxChars) + 1,
        text: text.slice(start, start + maxChars),
      });
    }
  });
  return chunks.filter(chunk => chunk.text.trim());
}

function mnNovelImportExistingSummary(notes = []) {
  return (notes || [])
    .filter(note => (note.tags || []).some(tag => String(tag || '').startsWith('novel-')))
    .slice(0, 50)
    .map(note => `- ${String(note.title || 'Untitled').slice(0, 80)} [${(note.tags || []).join(', ')}]`)
    .join('\n');
}

function mnNovelImportExtractionPrompt(chunk, existingSummary) {
  return [
    'Analyze this imported novel file chunk and call the propose-novel-import tool.',
    'Classify content as story structure, story draft, or supporting notes.',
    'Use kind=act/chapter/scene for actual story structure or prose.',
    'Use kind=character/location/plot/research/revision for supporting details.',
    'If the chunk has both story and support material, return both.',
    'Do not invent facts. Keep bodies concise but useful.',
    'Use existing titles when they clearly match.',
    '',
    'Existing novelist notes:',
    existingSummary || '- None',
    '',
    `Source file: ${chunk.fileName} (chunk ${chunk.index})`,
    'Text:',
    chunk.text,
  ].join('\n');
}

function mnNovelImportConsolidationPrompt(candidates, existingSummary) {
  return [
    'Consolidate these extracted novelist import candidates and call propose-novel-import.',
    'Merge duplicates, preserve useful details, and keep act/chapter/scene relationships.',
    'Return only candidates that should become or update app notes.',
    '',
    'Existing novelist notes:',
    existingSummary || '- None',
    '',
    'Candidates JSON:',
    JSON.stringify({ notes: candidates }),
  ].join('\n');
}

function mnNovelImportToolArgs(response) {
  if (!response || response.ok === false) throw new Error(response?.error || 'AI import analysis failed.');
  const value = response.value || response;
  if (value.ok === false) throw new Error(value.error || 'AI import analysis failed.');
  const call = (value.toolCalls || []).find(item => item.name === 'propose-novel-import') || (value.toolCalls || [])[0];
  if (call?.args && typeof call.args === 'object') return call.args;
  const answer = String(value.answer || '').trim();
  if (answer.startsWith('{')) {
    try { return JSON.parse(answer); } catch (e) {}
  }
  return { notes: [] };
}

function MnNovelImportPreviewDialog({ dialog, T, onApply, onClose }) {
  if (!dialog) return null;
  const plan = dialog.plan || {};
  const loading = dialog.phase === 'analyzing';
  const errored = dialog.phase === 'error';
  const created = plan.created || [];
  const updated = plan.updated || [];
  const skipped = [...(dialog.skipped || []), ...(plan.skipped || [])];
  const renderItems = (label, items) => (
    <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, padding: 10, background: T.bgSub }}>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.length
          ? items.slice(0, 18).map(item => (
            <div key={`${label}:${item.id || item.title}:${item.reason || ''}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{item.kind || 'file'}</span>
              <span style={{ color: T.ink }}>{item.title || item.name}</span>
              {item.reason && <span style={{ color: T.inkDim }}>{item.reason}</span>}
            </div>
          ))
          : <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim }}>None</div>}
        {items.length > 18 && <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>+{items.length - 18} more</div>}
      </div>
    </section>
  );

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 72, background: T.overlay || `color-mix(in oklab, ${T.ink} 34%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(760px, calc(100vw - 48px))', maxHeight: 'min(680px, calc(100vh - 48px))', overflow: 'auto', borderRadius: 10, border: `1px solid ${T.line}`, background: T.bg, boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 28%, transparent)`, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 17, fontWeight: 760, color: T.ink }}>Novel import preview</div>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim, marginTop: 3 }}>
              {loading ? (dialog.progress || 'Analyzing imported files...') : errored ? 'No notes were changed.' : `${created.length} create, ${updated.length} merge`}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${T.lineSub}`, background: T.bgSub, color: T.inkDim, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Close" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {loading && (
          <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, padding: 14, background: T.bgSub, fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkMed }}>
            {dialog.progress || 'Reading source material and asking AI to classify story and supporting details.'}
          </div>
        )}
        {errored && (
          <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, padding: 14, background: T.bgSub, fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkMed }}>
            {dialog.error || 'AI could not analyze the imported files.'}
          </div>
        )}
        {!loading && !errored && (
          <div style={{ display: 'grid', gap: 10 }}>
            {renderItems('Create', created)}
            {renderItems('Merge into existing notes', updated)}
            {renderItems('Skipped', skipped)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={{ border: `1px solid ${T.lineSub}`, background: T.bgSub, color: T.inkMed, borderRadius: 7, padding: '7px 11px', fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer' }}>{loading ? 'Hide' : 'Cancel'}</button>
          {!loading && !errored && (
            <button onClick={onApply} disabled={!plan.changedIds?.length} style={{ border: `1px solid ${T.ink}`, background: T.ink, color: T.bg, borderRadius: 7, padding: '7px 11px', fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: plan.changedIds?.length ? 'pointer' : 'not-allowed', opacity: plan.changedIds?.length ? 1 : 0.55 }}>Apply</button>
          )}
        </div>
      </div>
    </div>
  );
}

function mnNormalizeCustomThemesForApp(themes = []) {
  if (!Array.isArray(themes)) return [];
  return themes
    .filter(theme => theme && typeof theme.id === 'string' && typeof theme.name === 'string' && theme.tokens && typeof theme.tokens === 'object')
    .map(theme => ({ id: theme.id, name: theme.name, tokens: theme.tokens }));
}

function mnThemeOptionsForApp(baseThemes, customThemes) {
  const builtInLabels = { light: 'Light', dark: 'Dark', pastel: 'Pastel' };
  const builtIns = Object.entries(builtInLabels)
    .filter(([id]) => !!baseThemes[id])
    .map(([value, label]) => ({ value, label }));
  const custom = mnNormalizeCustomThemesForApp(customThemes)
    .map(theme => ({ value: theme.id, label: theme.name }));
  return [...builtIns, ...custom];
}

function mnNormalizeStartupView(value) {
  return value === 'today' ? 'today' : 'notes';
}

function mnBuildDefaultSmartViewDefinitions() {
  const helpers = window.MN_APP_HELPERS || {};
  const today = helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10);
  const format = helpers.SMART_VIEW_FORMAT || 'vispnote.smartView.v1';
  return [
    {
      format,
      id: 'recent_notes',
      title: 'Recent notes',
      type: 'notes',
      filters: {},
      sort: { field: 'modified', direction: 'desc' },
      limit: 60,
    },
    {
      format,
      id: 'open_tasks',
      title: 'Open tasks',
      type: 'tasks',
      filters: { actionStatus: 'open' },
      sort: { field: 'reminder', direction: 'asc' },
      limit: 80,
    },
    {
      format,
      id: 'deferred_tasks',
      title: 'Deferred tasks',
      type: 'tasks',
      filters: { actionStatus: 'deferred' },
      sort: { field: 'reminder', direction: 'asc' },
      limit: 80,
    },
    {
      format,
      id: 'due_reminders',
      title: 'Due reminders',
      type: 'reminders',
      filters: { reminderFrom: '1970-01-01', reminderTo: today },
      sort: { field: 'reminder', direction: 'asc' },
      limit: 80,
    },
  ];
}

function mnNormalizeSmartViewsForApp(value) {
  const helpers = window.MN_APP_HELPERS || {};
  const defaults = mnBuildDefaultSmartViewDefinitions();
  if (!Array.isArray(value)) return defaults;
  const validate = helpers.smartViewValidateSavedDefinition;
  const clean = [];
  for (const definition of value.slice(0, 24)) {
    try {
      const next = validate ? validate(definition) : definition;
      if (next?.id && next?.title) clean.push(next);
    } catch {}
  }
  return clean.length ? clean : defaults;
}

function MnApp() {
  const { SEED_TAGS, SEED_NOTES, SEED_VAULTS, buildLinks } = window.MN_DATA;
  const { mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk } = window.MN_OUTLINE;
  // make them available to other modules via globals too
  window.MN_RUNTIME = window.MN_RUNTIME || Object.freeze({ mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk });
  window.mnMdToBlocks = mnMdToBlocks; window.mnBlocksToMd = mnBlocksToMd;
  window.mnWalk = mnWalk; window.mnLocate = mnLocate; window.mnCloneBlocks = mnCloneBlocks;
  window.mkBlock = mkBlock;

  const [bootState, setBootState] = useStateA('loading'); // 'loading' | 'ready' | 'error'
  const [bootError, setBootError] = useStateA(null);

  const [tweaks, setTweaks] = useStateA(MN_TWEAK_DEFAULTS);
  const [customThemes, setCustomThemes] = useStateA([]);
  const [settingsOpen, setSettingsOpen] = useStateA(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useStateA(false);
  const [vaultHealthOpen, setVaultHealthOpen] = useStateA(false);
  const [novelImportDialog, setNovelImportDialog] = useStateA(null);
  const novelImportSeq = useRefA(0);

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
  const [savedSmartViews, setSavedSmartViews] = useStateA(() => mnBuildDefaultSmartViewDefinitions());
  const [activeSmartViewId, setActiveSmartViewId] = useStateA('');
  const [graphFilter, setGraphFilter] = useStateA('all-novelist');
  const lastViewRef = useRefA('notes');
  const titleUpdateTimerRef = useRefA(null);
  const [askAiSeed, setAskAiSeed] = useStateA('');
  const askAiOpenRef = useRefA(false);
  const newAiSession = useCallbackA(() => mnNewAskAiSession(), []);
  const [askAiSessions, setAskAiSessions] = useStateA(() => [mnNewAskAiSession()]);
  const [activeAskAiSessionId, setActiveAskAiSessionId] = useStateA('');
  const activeAskAiSessionIdRef = useRefA('');
  const [aiNotice, setAiNotice] = useStateA(null);
  const [todayAiRecap, setTodayAiRecap] = useStateA(null);
  const [todayAiRecapBusy, setTodayAiRecapBusy] = useStateA(false);
  const [todayAiRecapError, setTodayAiRecapError] = useStateA('');
  const [captureOpen, setCaptureOpen] = useStateA(false);
  const [deleteTargetId, setDeleteTargetId] = useStateA(null);
  const [appNotice, setAppNotice] = useStateA(null);
  const [conflictNotice, setConflictNotice] = useStateA(null);
  const [versionTargetId, setVersionTargetId] = useStateA(null);
  const [trashItems, setTrashItems] = useStateA([]);
  const [trashLoading, setTrashLoading] = useStateA(false);
  const [trashError, setTrashError] = useStateA('');
  const trashLoadSeq = useRefA(0);
  const [toast, setToast] = useStateA(null);
  const toastRef = useRefA(null);
  const [reminderCenterOpen, setReminderCenterOpen] = useStateA(false);
  const dismissedReminderKeys = useRefA(new Set());
  const quietedReminderKeys = useRefA(new Set());
  const notesWithBodyCacheRef = useRefA(new Map());
  const [query, setQuery] = useStateA('');

  useEffectA(() => {
    askAiOpenRef.current = view === 'ai';
  }, [view]);

  useEffectA(() => {
    dismissedReminderKeys.current.clear();
    quietedReminderKeys.current.clear();
  }, [activeVaultId]);

  useEffectA(() => {
    activeAskAiSessionIdRef.current = activeAskAiSessionId;
  }, [activeAskAiSessionId]);

  useEffectA(() => {
    toastRef.current = toast;
  }, [toast]);

  // Global-shortcut bridge: the main process registers an OS-level hotkey
  // (Ctrl/Cmd+Shift+N) and pushes an IPC event when it fires. We mirror the
  // existing in-app keybinding by opening Quick Capture.
  useEffectA(() => {
    if (typeof window === 'undefined' || !window.mn?.onOpenQuickCapture) return;
    return window.mn.onOpenQuickCapture(() => setCaptureOpen(true));
  }, []);

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

  const openSmartView = useCallbackA((definitionId = '') => {
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    setActiveSmartViewId(String(definitionId || ''));
    navigateView('smart-views');
    return { message: 'Opened Smart Views.' };
  }, [navigateView]);

  const goBackView = useCallbackA(() => {
    const target = lastViewRef.current || 'notes';
    setView(current => {
      lastViewRef.current = current === target ? 'notes' : current;
      return target;
    });
  }, []);

  const showAppNotice = useCallbackA((title, message, tone = 'error') => {
    setAppNotice({
      title,
      message: message || 'The operation could not be completed.',
      tone,
    });
  }, []);

  const openAskAi = useCallbackA((initialQuery = '') => {
    setAiNotice(null);
    setAskAiSeed(typeof initialQuery === 'string' ? initialQuery : '');
    navigateView('ai');
  }, [navigateView]);

  const activeAskAiSession = useMemoA(
    () => mnPickActiveAskAiSession(askAiSessions, activeAskAiSessionId),
    [askAiSessions, activeAskAiSessionId]
  );

  useEffectA(() => {
    if (!activeAskAiSession && askAiSessions[0]) setActiveAskAiSessionId(askAiSessions[0].id);
  }, [activeAskAiSession, askAiSessions]);

  const setActiveAskAiSession = useCallbackA((updater) => {
    setAskAiSessions(prev => prev.map(session => {
      if (session.id !== (activeAskAiSessionIdRef.current || prev[0]?.id)) return session;
      const next = typeof updater === 'function' ? updater(session) : updater;
      const title = mnAskAiSessionTitle({ ...session, ...(next || {}) });
      return { ...session, ...(next || {}), title, updatedAt: new Date().toISOString() };
    }));
  }, []);

  const createAskAiChat = useCallbackA(() => {
    const session = newAiSession();
    setAskAiSessions(prev => [session, ...prev]);
    setActiveAskAiSessionId(session.id);
    setAskAiSeed('');
    navigateView('ai');
  }, [navigateView, newAiSession]);

  const deleteAskAiChat = useCallbackA((id) => {
    const target = askAiSessions.find(session => session.id === id);
    if (target?.pending) return;
    const next = askAiSessions.filter(session => session.id !== id);
    if (!next.length) {
      setAskAiSessions([]);
      setActiveAskAiSessionId('');
      return;
    }
    const nextActive = mnPickActiveAskAiSession(next, activeAskAiSessionId);
    setAskAiSessions(next);
    if (id === activeAskAiSessionId || !nextActive || nextActive.id !== activeAskAiSessionId) {
      setActiveAskAiSessionId(nextActive?.id || '');
    }
  }, [activeAskAiSessionId, askAiSessions]);

  const renameAskAiChat = useCallbackA((id, title) => {
    const next = String(title || 'New chat').slice(0, 80) || 'New chat';
    setAskAiSessions(prev => prev.map(session => session.id === id
      ? { ...session, title: next, updatedAt: new Date().toISOString() }
      : session));
  }, []);

  const archiveAskAiChat = useCallbackA((id, archived = true) => {
    const target = askAiSessions.find(session => session.id === id);
    if (target?.pending) return;
    const next = askAiSessions.map(session => session.id === id
      ? { ...session, archived: !!archived, updatedAt: new Date().toISOString() }
      : session);
    if (archived && id === activeAskAiSessionId) {
      const nextActive = mnPickActiveAskAiSession(next, activeAskAiSessionId, { allowArchivedPreferred: false });
      if (nextActive && !nextActive.archived) {
        setAskAiSessions(next);
        setActiveAskAiSessionId(nextActive.id);
      } else {
        const session = newAiSession();
        setAskAiSessions([session, ...next]);
        setActiveAskAiSessionId(session.id);
      }
      return;
    }
    setAskAiSessions(next);
  }, [activeAskAiSessionId, askAiSessions, newAiSession]);

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
  const dirtyNotesRef = useRefA(dirtyNotes);
  const noteDiskStampRef = useRefA(new Map());
  const savingDirtyKeysRef = useRefA(new Set());
  const pendingDirtyKeysRef = useRefA(new Set());
  const notesRef = useRefA(notes);
  const vaultsRef = useRefA(vaults);
  const dirtyRevisionRef = useRefA(0);
  const dirtyMissingWarnedRef = useRefA(new Set());
  const vaultActivationSeq = useRefA(0);
  const noteMetadataHistoryRef = useRefA({ undo: [], redo: [], activeKey: null });
  const aiNoteBodyRestoreRef = useRefA(new Map());
  const cloneNoteForMetadataHistory = useCallbackA((note) => note ? ({
    id: note.id,
    title: note.title,
    pinned: !!note.pinned,
    tags: [...(note.tags || [])],
  }) : null, []);
  const recordNoteMetadataHistory = useCallbackA((note, historyKey = null) => {
    if (!note) return;
    const state = noteMetadataHistoryRef.current;
    if (historyKey && state.activeKey === historyKey) return;
    state.undo.push(cloneNoteForMetadataHistory(note));
    if (state.undo.length > 40) state.undo.shift();
    state.redo = [];
    state.activeKey = historyKey || null;
  }, [cloneNoteForMetadataHistory]);
  const endNoteMetadataEdit = useCallbackA(() => {
    noteMetadataHistoryRef.current.activeKey = null;
  }, []);
  const markDirty = useCallbackA((id) => {
    if (!id || !activeVaultId) return;
    setDirtyNotes(s => {
      const n = new Map(s);
      const key = mnDirtyNoteKey(activeVaultId, id);
      const existing = n.get(key);
      n.set(key, {
        id,
        vaultId: activeVaultId,
        dirtyAt: existing?.dirtyAt || Date.now(),
        revision: ++dirtyRevisionRef.current,
      });
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
    const vaultRes = await MN_NOTES_VAULTS_SERVICE.loadVault(window.mn, vaultId);
    if (!vaultRes.ok) throw new Error(vaultRes.error);
    const vault = vaultRes.value || vaultRes.data?.vault;
    if (Array.isArray(vault.warnings) && vault.warnings.length) {
      showAppNotice('Vault loaded with warnings', `${vault.warnings.length} note file${vault.warnings.length === 1 ? '' : 's'} could not be read.`, 'warn');
    }
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
      novelistAiConfig: vault.novelistAiConfig || null,
    };
  }, [mnMdToBlocks, showAppNotice]);

  // ── Bootstrap from disk ─────────────────────────────────────────────────
  useEffectA(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!HAS_DISK) {
          // In-browser fallback: use the same starter vault shape as first-run disk seed.
          const fallbackSources = Array.isArray(SEED_VAULTS) && SEED_VAULTS.length
            ? SEED_VAULTS
            : [{
              id: 'v_personal',
              name: 'Personal',
              slug: 'personal',
              path: '~/VispNote/personal',
              notes: SEED_NOTES,
              tags: SEED_TAGS,
              novelistMode: false,
            }];
          const fallbackVaults = fallbackSources.map((vault, index) => {
            const slug = vault.slug || String(vault.name || `vault-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `vault-${index + 1}`;
            const seedNotes = normalizeNotes(vault.notes || [], mnMdToBlocks);
            return {
              id: vault.id || `v_${slug}`,
              name: vault.name || 'Personal',
              slug,
              path: vault.path || `~/VispNote/${slug}`,
              notes: seedNotes,
              tags: vault.tags || [],
              canvases: [],
              lastSelectedId: vault.lastSelectedId || seedNotes[0]?.id || null,
              workflowStates: vault.workflowStates || (vault.novelistMode ? MN_NOVELIST_WORKFLOW_STATES : null),
              novelistAiConfig: vault.novelistAiConfig || null,
              novelistMode: !!vault.novelistMode,
            };
          });
          const activeFallback = fallbackVaults[0];
          if (cancelled) return;
          setVaults(fallbackVaults);
          setActiveVaultId(activeFallback?.id || null);
          setTags(activeFallback?.tags || []);
          setNotes(activeFallback?.notes || []);
          setCanvases([]);
          setSelectedId(activeFallback?.lastSelectedId || activeFallback?.notes?.[0]?.id || null);
          setBootState('ready');
          return;
        }

        const prefsRes = await window.mn.getPrefs();
        if (!prefsRes.ok) throw new Error(prefsRes.error);
        const prefs = prefsRes.value;
        setCustomThemes(mnNormalizeCustomThemesForApp(prefs.customThemes));
        const nextSmartViews = mnNormalizeSmartViewsForApp(prefs.smartViews);
        setSavedSmartViews(nextSmartViews);
        if (!Array.isArray(prefs.smartViews) && window.mn?.setPrefs) {
          window.mn.setPrefs({ smartViews: nextSmartViews }).catch(e => console.warn('Could not initialize Smart Views preferences', e));
        }
        let startupView = 'notes';
        if (prefs.tweaks) {
          const mergedTweaks = { ...MN_TWEAK_DEFAULTS, ...prefs.tweaks };
          startupView = mnNormalizeStartupView(mergedTweaks.startupView);
          mergedTweaks.startupView = startupView;
          window.MN_LOGSEQ?.setWorkflowStates?.(mnNormalizeWorkflowStatesForApp(mergedTweaks.workflowStates));
          setTweaks(t => ({ ...t, ...prefs.tweaks, startupView }));
        }

        const vlistRes = await MN_NOTES_VAULTS_SERVICE.listVaults(window.mn);
        if (!vlistRes.ok) throw new Error(vlistRes.error);
        const vlist = vlistRes.value || vlistRes.data?.vaults || [];
        if (!vlist.length) throw new Error('No vaults found');

        const activeId = vlist.some(vault => vault.id === prefs.activeVaultId)
          ? prefs.activeVaultId
          : vlist[0].id;
        const loaded = await loadVaultBundle(activeId);

        if (cancelled) return;
        setVaults(vlist.map(meta => meta.id === activeId
          ? { ...meta, novelistMode: loaded.novelistMode, workflowStates: loaded.workflowStates || meta.workflowStates || null, novelistAiConfig: loaded.novelistAiConfig || meta.novelistAiConfig || null, notes: loaded.notes, tags: loaded.tags, lastSelectedId: loaded.lastSelectedId, canvases: loaded.canvases }
          : { ...meta, notes: null, tags: null, canvases: null }));
        setActiveVaultId(activeId);
        setTags(loaded.tags || []);
        setNotes(loaded.notes);
        setCanvases(loaded.canvases);
        setSelectedId(loaded.lastSelectedId || loaded.notes[0]?.id || null);
        if (startupView === 'today') setView('today');
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
    window.mn.setPrefs({ tweaks });
  }, [tweaks]);

  const findNotesForVault = useCallbackA((vaultId, currentNotes = notes, currentVaults = vaults) => {
    if (vaultId === activeVaultId) return currentNotes;
    return currentVaults.find(v => v.id === vaultId)?.notes || [];
  }, [activeVaultId, notes, vaults]);

  useEffectA(() => {
    const pickNewerDiskStamp = (current, incoming) => {
      if (!current) return incoming;
      if (!incoming) return current;
      const currentTime = new Date(current).getTime();
      const incomingTime = new Date(incoming).getTime();
      if (!Number.isFinite(currentTime)) return incoming;
      if (!Number.isFinite(incomingTime)) return current;
      return incomingTime >= currentTime ? incoming : current;
    };
    const stamps = new Map();
    const remember = (vaultId, noteList) => {
      if (!vaultId || !Array.isArray(noteList)) return;
      noteList.forEach(note => {
        if (note?.id && note.diskModifiedAt) {
          const key = mnDirtyNoteKey(vaultId, note.id);
          stamps.set(key, pickNewerDiskStamp(noteDiskStampRef.current.get(key), note.diskModifiedAt));
        }
      });
    };
    vaults.forEach(vault => remember(vault.id, vault.notes));
    remember(activeVaultId, notes);
    noteDiskStampRef.current = stamps;
  }, [activeVaultId, notes, vaults]);

  useEffectA(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffectA(() => {
    vaultsRef.current = vaults;
  }, [vaults]);

  useEffectA(() => {
    dirtyNotesRef.current = dirtyNotes;
  }, [dirtyNotes]);

  const saveDirtyNotesNow = useCallbackA(async function saveDirtyNotesNowImpl(entries, currentNotes = notesRef.current, currentVaults = vaultsRef.current) {
    if (!HAS_DISK || !entries?.length) return;
    for (const entry of entries) {
      const id = entry?.id;
      const vaultId = entry?.vaultId;
      const revision = entry?.revision;
      if (!id || !vaultId) continue;
      const dirtyKey = mnDirtyNoteKey(vaultId, id);
      if (savingDirtyKeysRef.current.has(dirtyKey)) {
        pendingDirtyKeysRef.current.add(dirtyKey);
        continue;
      }
      savingDirtyKeysRef.current.add(dirtyKey);
      const noteList = findNotesForVault(vaultId, currentNotes, currentVaults);
      const n = noteList.find(x => x.id === id);
      try {
        if (!n) {
          if (!dirtyMissingWarnedRef.current.has(dirtyKey)) {
            dirtyMissingWarnedRef.current.add(dirtyKey);
            showAppNotice('Could not autosave note', 'A dirty note could not be matched to its vault. Switch back to the vault or reload before closing.', 'warn');
          }
          console.warn('dirty note could not be matched for autosave', { vaultId, id });
          continue;
        }
        dirtyMissingWarnedRef.current.delete(dirtyKey);
        const saveOptions = { expectedModifiedAt: n.diskModifiedAt || null };
        saveOptions.expectedModifiedAt = noteDiskStampRef.current.get(dirtyKey) || saveOptions.expectedModifiedAt;
        const expectedModifiedAt = saveOptions.expectedModifiedAt;
        try {
          const res = await MN_NOTES_VAULTS_SERVICE.saveNote(
            window.mn,
            vaultId,
            noteForDisk(n, mnBlocksToMd),
            saveOptions
          );
          if (res && res.ok === false) {
            if (res.code === 'NOTE_CONFLICT') {
              setConflictNotice({
                vaultId,
                noteId: id,
                title: n.title || 'Untitled',
                currentModifiedAt: res.currentModifiedAt || null,
                expectedModifiedAt: res.expectedModifiedAt || expectedModifiedAt,
              });
              continue;
            }
            throw new Error(res.error || 'Save failed');
          }
          const saved = res?.value;
          if (saved?.diskModifiedAt || saved?.modifiedAt) {
            const diskModifiedAt = saved.diskModifiedAt || saved.modifiedAt;
            noteDiskStampRef.current.set(dirtyKey, diskModifiedAt);
            const updateDiskStamp = notesList => MN_NOTES_VAULTS_STATE.updateNoteDiskStamp(notesList, id, diskModifiedAt);
            if (vaultId === activeVaultId) setNotes(updateDiskStamp);
            setVaults(vs => vs.map(v => v.id === vaultId && Array.isArray(v.notes)
              ? { ...v, notes: updateDiskStamp(v.notes) }
              : v));
          }
          setDirtyNotes(cur => {
            const current = cur.get(dirtyKey);
            if (!current || current.vaultId !== vaultId) return cur;
            if (revision != null && current.revision !== revision) return cur;
            const next = new Map(cur);
            next.delete(dirtyKey);
            return next;
          });
        } catch (e) {
          console.error('saveNote failed', id, e);
          showAppNotice('Could not save note', e.message || String(e));
        }
      } finally {
        savingDirtyKeysRef.current.delete(dirtyKey);
        if (pendingDirtyKeysRef.current.delete(dirtyKey)) {
          const pendingEntry = dirtyNotesRef.current.get(dirtyKey);
          if (pendingEntry) {
            setTimeout(() => saveDirtyNotesNowImpl([pendingEntry], notesRef.current, vaultsRef.current), 0);
          }
        }
      }
    }
  }, [findNotesForVault, activeVaultId, showAppNotice]);

  // ── Persist dirty notes (debounced) ────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !dirtyNotes.size) return;
    const now = Date.now();
    let firstDirtyAt = now;
    for (const entry of dirtyNotes.values()) {
      const dirtyAt = Number(entry.dirtyAt);
      if (Number.isFinite(dirtyAt) && dirtyAt < firstDirtyAt) firstDirtyAt = dirtyAt;
    }
    const maxWaitRemaining = Math.max(0, MN_AUTOSAVE_MAX_WAIT_MS - (now - firstDirtyAt));
    const delay = Math.min(MN_AUTOSAVE_DEBOUNCE_MS, maxWaitRemaining);
    const handle = setTimeout(async () => {
      await saveDirtyNotesNow([...dirtyNotes.values()]);
    }, delay);
    return () => clearTimeout(handle);
  }, [dirtyNotes, saveDirtyNotesNow]);

  useEffectA(() => {
    if (!HAS_DISK || !window.mn?.onFlushDirtyNotes) return undefined;
    return window.mn.onFlushDirtyNotes(async () => {
      const entries = [...dirtyNotesRef.current.values()];
      if (entries.length) await saveDirtyNotesNow(entries);
      await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
      return { dirtyRemaining: dirtyNotesRef.current.size };
    });
  }, [activeVaultId, tags, selectedId, saveDirtyNotesNow, saveVaultMetaNow]);

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
      const res = await MN_NOTES_VAULTS_SERVICE.listVaults(window.mn);
      if (!res.ok) throw new Error(res.error);
      const metas = res.value || res.data?.vaults || [];
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
            novelistAiConfig: activeBundle.novelistAiConfig || meta.novelistAiConfig || null,
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
            novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null,
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
          novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null,
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

  const importThemeFile = useCallbackA(async () => {
    if (!window.mn?.importThemeFile) {
      const error = 'This build does not expose theme import.';
      showAppNotice('Theme import unavailable', error, 'warn');
      return { ok: false, error };
    }
    try {
      const res = await window.mn.importThemeFile();
      if (!res?.ok) throw new Error(res?.error || 'Could not install theme.');
      const value = res.value || {};
      if (value.canceled) return { ok: true, canceled: true };
      const nextThemes = mnNormalizeCustomThemesForApp(value.customThemes);
      setCustomThemes(nextThemes);
      if (value.theme?.id) setTweak('theme', value.theme.id);
      showAppNotice('Theme installed', `${value.theme?.name || 'Theme'} is ready.`, 'info');
      return { ok: true, canceled: false, theme: value.theme };
    } catch (e) {
      const error = e.message || String(e);
      showAppNotice('Could not install theme', error);
      return { ok: false, error };
    }
  }, [showAppNotice]);

  const theme = tweaks.theme;
  const baseThemeMap = window.MN_THEMES || {};
  const themeMap = useMemoA(() => {
    const next = { ...baseThemeMap };
    for (const item of customThemes) next[item.id] = item.tokens;
    return next;
  }, [customThemes]);
  const themeOptions = useMemoA(() => mnThemeOptionsForApp(baseThemeMap, customThemes), [customThemes]);
  const fontMap = window.MN_FONTS || {};
  const T = themeMap[theme] || themeMap.light || {};
  const fonts = fontMap[tweaks.fontChoice] || fontMap['Editorial (Newsreader + Inter)'] || { ui: 'sans-serif', body: 'serif', mono: 'monospace' };
  useEffectA(() => {
    const root = document.documentElement;
    root.style.setProperty('--mn-ui', fonts.ui);
    root.style.setProperty('--mn-body', fonts.body);
    root.style.setProperty('--mn-mono', fonts.mono);
    root.style.setProperty('--mn-bg', T.bg);
    root.style.setProperty('--mn-focus', T.focus || T.accent);
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
    let targetNovelistAiConfig = target.novelistAiConfig || null;
    let targetCanvases = target.canvases;
    if (!targetNotes && HAS_DISK) {
      try {
        const res = await MN_NOTES_VAULTS_SERVICE.loadVault(window.mn, id);
        if (!res.ok) throw new Error(res.error);
        const loadedVault = res.value || res.data?.vault;
        if (Array.isArray(loadedVault.warnings) && loadedVault.warnings.length) {
          showAppNotice('Vault loaded with warnings', `${loadedVault.warnings.length} note file${loadedVault.warnings.length === 1 ? '' : 's'} could not be read.`, 'warn');
        }
        targetNotes = normalizeNotes(loadedVault.notes, mnMdToBlocks);
        targetTags = loadedVault.tags || [];
        targetSel = targetNotes.some(note => note.id === loadedVault.lastSelectedId)
          ? loadedVault.lastSelectedId
          : targetNotes[0]?.id || null;
        targetNovelistMode = !!loadedVault.novelistMode;
        targetWorkflowStates = loadedVault.workflowStates || null;
        targetNovelistAiConfig = loadedVault.novelistAiConfig || null;
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
      ? { ...v, notes: targetNotes, tags: targetTags, lastSelectedId: targetSel || targetNotes[0]?.id || null, canvases: targetCanvases, novelistMode: targetNovelistMode, workflowStates: targetWorkflowStates, novelistAiConfig: targetNovelistAiConfig }
      : v));
    setTrashItems([]);
    setTrashError('');
    setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
    if (HAS_DISK) {
      const selected = await MN_VAULTS_SERVICE.selectVault(window.mn, id);
      if (!selected.ok) window.mn.setPrefs({ activeVaultId: id });
    }
  }, [activeVaultId, vaults, notes, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, refreshVaultRegistry, navigateView, showAppNotice]);

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
        const res = await MN_NOTES_VAULTS_SERVICE.saveNote(window.mn, vaultId, noteForDisk(note, mnBlocksToMd));
        if (!res.ok) throw new Error(res.error);
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
        { id, name, slug, path: `~/VispNote/${slug}`, notes: setup.notes, tags: setup.tags, workflowStates: setup.workflowStates || null, novelistAiConfig: null, canvases: newCanvases, novelistMode: vaultType === 'novelist' },
      ]);
      setNotes(setup.notes); setTags(setup.tags); setSelectedId(setup.notes[0]?.id || firstNoteId);
      tagsDirty.current = false;
      setCanvases(newCanvases); setActiveCanvas(null);
      setTrashItems([]);
      setTrashError('');
      setActiveVaultId(id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      return;
    }
    try {
      const res = await MN_VAULTS_SERVICE.createVault(window.mn, name, { type: vaultType, workflowStates: vaultType === 'novelist' ? MN_NOVELIST_WORKFLOW_STATES : null });
      if (!res.ok) throw new Error(res.error);
      const v = res.value;

      // Load first, then switch atomically. This prevents the previous vault's
      // notes from appearing under the newly-created vault if disk IO is slow.
      const loadRes = await MN_NOTES_VAULTS_SERVICE.loadVault(window.mn, v.id);
      if (!loadRes.ok) throw new Error(loadRes.error);
      const loaded = loadRes.value || loadRes.data?.vault;
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
      setTrashItems([]);
      setTrashError('');
      setSelectedId(loaded.lastSelectedId || loadedNotes[0]?.id || null);
      setActiveVaultId(v.id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      setQuery('');
      setVaults(vs => [
        ...vs
          .filter(x => x.id !== v.id)
          .map(x => x.id === activeVaultId ? { ...x, notes, tags, lastSelectedId: selectedId, canvases } : x),
        { ...v, notes: loadedNotes, tags: loadedTags, lastSelectedId: loaded.lastSelectedId || loadedNotes[0]?.id || null, canvases: [], workflowStates: loaded.workflowStates || null, novelistAiConfig: loaded.novelistAiConfig || null, novelistMode: vaultType === 'novelist' },
      ]);
      const selected = await MN_VAULTS_SERVICE.selectVault(window.mn, v.id);
      if (!selected.ok) window.mn.setPrefs({ activeVaultId: v.id });
    } catch (e) {
      console.error('createVault failed', e);
      showAppNotice('Could not create vault', e.message || String(e));
      await refreshVaultRegistry({ reloadActive: false, reason: 'createVault-failed' });
    }
  }, [activeVaultId, notes, vaults, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks, mnBlocksToMd, showAppNotice, refreshVaultRegistry]);

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
    const cleanName = String(name || '').trim();
    if (!cleanName) return { ok: false, error: 'Vault name is required.' };
    const previous = vaults.find(v => v.id === id)?.name || '';
    setVaults(vs => vs.map(v => v.id === id ? { ...v, name: cleanName } : v));
    if (HAS_DISK) {
      try {
        const res = await MN_VAULTS_SERVICE.renameVault(window.mn, id, cleanName);
        if (!res.ok) throw new Error(res.error);
      }
      catch (e) {
        console.error('renameVault failed', e);
        setVaults(vs => vs.map(v => v.id === id ? { ...v, name: previous } : v));
        showAppNotice('Could not rename vault', e.message || String(e));
        return { ok: false, error: e.message || String(e) };
      }
    }
    return { ok: true };
  }, [vaults, showAppNotice]);

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
        const res = await MN_VAULTS_SERVICE.deleteVault(window.mn, id);
        if (!res.ok) throw new Error(res.error);
        nextVaults = (res.value?.vaults || localRemaining).map(meta => {
          const cached = localRemaining.find(v => v.id === meta.id) || {};
          return { ...meta, notes: cached.notes || null, tags: cached.tags || null, lastSelectedId: cached.lastSelectedId || null, canvases: cached.canvases || null, novelistMode: !!(meta.novelistMode ?? cached.novelistMode), workflowStates: meta.workflowStates || cached.workflowStates || null, novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null };
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
        const loadRes = await MN_NOTES_VAULTS_SERVICE.loadVault(window.mn, nextMeta.id);
        if (!loadRes.ok) throw new Error(loadRes.error);
        const loaded = loadRes.value || loadRes.data?.vault;
        nextNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
        nextTags = loaded.tags || [];
        nextSelectedId = loaded.lastSelectedId || nextNotes[0]?.id || null;
        nextMeta.novelistMode = !!loaded.novelistMode;
        nextMeta.workflowStates = loaded.workflowStates || nextMeta.workflowStates || null;
        nextMeta.novelistAiConfig = loaded.novelistAiConfig || nextMeta.novelistAiConfig || null;
        const canvasRes = await window.mn.listCanvases(nextMeta.id);
        nextCanvases = canvasRes.ok ? (canvasRes.value || []) : [];
      } catch (e) {
        console.error('loadVault after delete failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    setVaults(nextVaults.map(v => v.id === nextMeta.id
      ? { ...v, notes: nextNotes, tags: nextTags, lastSelectedId: nextSelectedId, canvases: nextCanvases, novelistMode: !!nextMeta.novelistMode, workflowStates: nextMeta.workflowStates || null, novelistAiConfig: nextMeta.novelistAiConfig || null }
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
    if (HAS_DISK) {
      const selected = await MN_VAULTS_SERVICE.selectVault(window.mn, nextMeta.id);
      if (!selected.ok) window.mn.setPrefs({ activeVaultId: nextMeta.id });
    }
    return { ok: true };
  }, [activeVaultId, vaults, notes, tags, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks]);

  const vaultsForSidebar = useMemoA(() => vaults.map(v => ({
    ...v,
    noteCount: v.id === activeVaultId ? notes.length : (v.notes?.length ?? 0),
    canvasCount: v.id === activeVaultId ? canvases.length : (v.canvases?.length ?? 0),
  })), [vaults, activeVaultId, notes.length, canvases.length]);
  const activeVault = useMemoA(() => vaults.find(v => v.id === activeVaultId) || null, [vaults, activeVaultId]);

  const updateNovelistAiConfig = useCallbackA((config) => {
    if (!activeVaultId) return;
    window.mnWriteNovelistAiConfig?.(config || null, activeVaultId);
    setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, novelistAiConfig: config || null } : v));
    if (HAS_DISK) {
      window.mn.saveVaultMeta(activeVaultId, { novelistAiConfig: config || null })
        .catch(e => {
          console.error('save novelist AI config failed', e);
          showAppNotice('Could not save novelist AI configuration', e.message || String(e));
        });
    }
  }, [activeVaultId, showAppNotice]);

  useEffectA(() => {
    if (!activeVaultId || !activeVault?.novelistAiConfig) return;
    window.mnWriteNovelistAiConfig?.(activeVault.novelistAiConfig, activeVaultId);
  }, [activeVaultId, activeVault?.novelistAiConfig]);

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
  const notesWithBody = useMemoA(() => {
    const cache = notesWithBodyCacheRef.current;
    const liveIds = new Set();
    const next = notes.map(n => {
      liveIds.add(n.id);
      const cached = cache.get(n.id);
      if (cached
        && cached.noteRef === n
        && cached.blocksRef === n.blocks
        && cached.body === n.body
        && cached.title === n.title
        && cached.modifiedAt === n.modifiedAt
        && cached.diskModifiedAt === n.diskModifiedAt) {
        return cached.value;
      }
      const normalized = {
        ...n,
        body: mnNormalizeNoteBody(
          Array.isArray(n.blocks) ? mnBlocksToMd(n.blocks || []) : (n.body || ''),
          n.title || 'Untitled'
        ),
      };
      cache.set(n.id, {
        noteRef: n,
        blocksRef: n.blocks,
        body: n.body,
        title: n.title,
        modifiedAt: n.modifiedAt,
        diskModifiedAt: n.diskModifiedAt,
        value: normalized,
      });
      return normalized;
    });
    for (const key of cache.keys()) {
      if (!liveIds.has(key)) cache.delete(key);
    }
    return next;
  }, [notes]);
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
  // searchHits.ids     → matched note ids in rank order for searchHits.vaultId
  const [searchHits, setSearchHits] = useStateA(null);
  const [searchDetails, setSearchDetails] = useStateA(new Map());
  const searchSeq = useRefA(0);
  // Legacy stabilization invariant: if (seq === searchSeq.current && res.ok) setSearchHits
  useEffectA(() => {
    const seq = ++searchSeq.current;
    const q = query.trim();
    if (!q) { setSearchHits(null); setSearchDetails(new Map()); return; }
    const activeVaultHasUnsaved = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
    if (!HAS_DISK || !activeVaultId || activeVaultHasUnsaved) {
      // Browser fallback and dirty-note path: in-memory search reflects unsaved edits.
      const lc = q.toLowerCase();
      const ids = notesWithBody.filter(n =>
        n.title.toLowerCase().includes(lc) ||
        (n.body || '').toLowerCase().includes(lc) ||
        n.tags.some(t => t.toLowerCase().includes(lc))
      ).map(n => n.id);
      if (seq === searchSeq.current) {
        setSearchHits({ vaultId: activeVaultId || '', query: q, ids });
        setSearchDetails(new Map());
      }
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const api = window.mn.searchDetailed || window.mn.search;
        const res = await api(activeVaultId, q, 100);
        if (seq === searchSeq.current && res.ok) {
          const rows = res.value || [];
          setSearchHits({ vaultId: activeVaultId || '', query: q, ids: rows.map(r => r.id) });
          setSearchDetails(new Map(rows.map(r => [r.id, r])));
        }
      } catch (e) { console.error('search failed', e); }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, activeVaultId, notesWithBody, dirtyNotes]);

  const searchHitIds = searchHits?.vaultId === activeVaultId && searchHits.query === query.trim()
    ? searchHits.ids
    : null;

  const filteredNotes = useMemoA(() => {
    let ns = [...notesWithBody];
    if (selectedTag) ns = ns.filter(n => n.tags.includes(selectedTag));
    if (selectedWorkflow) {
      const ids = workflowData.noteIdsByState[selectedWorkflow] || new Set();
      ns = ns.filter(n => ids.has(n.id));
    }
    if (searchHitIds != null) {
      const order = new Map(searchHitIds.map((id, i) => [id, i]));
      ns = ns.filter(n => order.has(n.id));
      ns = MN_APP_HELPERS.decorateNotesWithSearchDetails
        ? MN_APP_HELPERS.decorateNotesWithSearchDetails(ns, searchDetails)
        : ns.map(n => {
          const detail = searchDetails.get(n.id);
          return detail ? { ...n, __searchSnippet: detail.snippet, __matchedFields: detail.matchedFields } : n;
        });
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
  }, [notesWithBody, selectedTag, selectedWorkflow, workflowData, searchHitIds, searchDetails, tweaks.sortBy, tweaks.pinnedFirst]);

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
  const blockingOverlayOpen = captureOpen || settingsOpen || commandPaletteOpen || vaultHealthOpen || !!novelImportDialog || !!deleteTargetNote || !!appNotice || !!conflictNotice || !!versionTargetId;

  const reminderCenterItems = useMemoA(() => {
    const now = Date.now();
    const snoozed = mnReadSnoozedReminders();
    return mnCollectReminderItems(notesWithBody)
      .filter(item => !(MN_APP_HELPERS.agendaIsDeferred && MN_APP_HELPERS.agendaIsDeferred(item)))
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
  }, [notesWithBody, toast?.key]);

  const reminderDueCount = reminderCenterItems.filter(item =>
    item.status === 'due' && !dismissedReminderKeys.current.has(item.key)
  ).length;

  const calendarTaskItems = useMemoA(
    () => mnCollectTaskItems ? mnCollectTaskItems(notesWithBody) : [],
    [notesWithBody]
  );

  const calendarActionItems = useMemoA(
    () => MN_APP_HELPERS.agendaDecorateActionItems
      ? MN_APP_HELPERS.agendaDecorateActionItems(calendarTaskItems, notesWithBody)
      : calendarTaskItems,
    [calendarTaskItems, notesWithBody]
  );

  const smartViewDefinitions = useMemoA(() => (
    savedSmartViews.length ? savedSmartViews : mnBuildDefaultSmartViewDefinitions()
  ), [savedSmartViews]);

  useEffectA(() => {
    MN_APP_HELPERS.currentSmartViewDefinitions = smartViewDefinitions;
    return () => {
      if (MN_APP_HELPERS.currentSmartViewDefinitions === smartViewDefinitions) delete MN_APP_HELPERS.currentSmartViewDefinitions;
    };
  }, [smartViewDefinitions]);

  const todayDailyNote = useMemoA(() => (
    MN_APP_HELPERS.rollupFindDailyNote
      ? MN_APP_HELPERS.rollupFindDailyNote(notesWithBody)
      : notesWithBody.find(note => String(note.title || '').trim() === (MN_APP_HELPERS.todayIsoDate ? MN_APP_HELPERS.todayIsoDate() : new Date().toISOString().slice(0, 10))) || null
  ), [notesWithBody]);

  const todayAgendaItems = useMemoA(() => {
    const today = MN_APP_HELPERS.todayIsoDate ? MN_APP_HELPERS.todayIsoDate() : new Date().toISOString().slice(0, 10);
    return (calendarTaskItems || [])
      .filter(item => !(MN_APP_HELPERS.agendaIsDeferred && MN_APP_HELPERS.agendaIsDeferred(item)))
      .filter(item => item?.remindAt?.date === today)
      .sort((a, b) => String(a.remindAt?.time || '').localeCompare(String(b.remindAt?.time || '')) || String(a.label || a.text || '').localeCompare(String(b.label || b.text || '')))
      .slice(0, 5);
  }, [calendarTaskItems]);

  const todayAiContext = useMemoA(() => (
    MN_APP_HELPERS.contextualAiBuildTodayRecapContext
      ? MN_APP_HELPERS.contextualAiBuildTodayRecapContext({
        notes: notesWithBody,
        tasks: calendarTaskItems,
        reminders: reminderCenterItems,
        agendaItems: todayAgendaItems,
        weekStart: tweaks.weekStart || 'monday',
      })
      : null
  ), [notesWithBody, calendarTaskItems, reminderCenterItems, todayAgendaItems, tweaks.weekStart]);

  const generateTodayAiRecap = useCallbackA(async () => {
    if (!todayAiContext || !MN_APP_HELPERS.contextualAiBuildTodayRecapPrompt || !MN_APP_HELPERS.contextualAiBuildTodayRecapResult) {
      setTodayAiRecapError('Today AI recap is unavailable in this build.');
      return null;
    }
    if (!window.mn?.ai?.chat) {
      setTodayAiRecapError('AI chat is unavailable in this build.');
      return null;
    }
    setTodayAiRecapBusy(true);
    setTodayAiRecapError('');
    try {
      let status = null;
      try {
        const statusResult = await window.mn.ai.status?.();
        if (statusResult?.ok) status = statusResult.value;
      } catch (e) {
        status = null;
      }
      const prompt = MN_APP_HELPERS.contextualAiBuildTodayRecapPrompt(todayAiContext);
      const response = await window.mn.ai.chat({
        messages: [
          {
            role: 'system',
            content: 'You create concise source-linked daily recaps. Keep facts separate from suggestions. Do not claim facts that are not in the supplied context.',
          },
          { role: 'user', content: prompt },
        ],
        timeoutMs: 60000,
        maxTokens: 900,
      });
      if (!response?.ok) throw new Error(response?.error || 'AI recap failed.');
      if (response.value && response.value.ok === false) throw new Error(response.value.error || 'AI recap failed.');
      const aiText = String(response.value?.answer || response.answer || '').trim();
      const result = MN_APP_HELPERS.contextualAiBuildTodayRecapResult({
        aiText,
        context: todayAiContext,
        status,
        createdAt: new Date().toISOString(),
      });
      setTodayAiRecap(result);
      return result;
    } catch (e) {
      const message = e?.message || String(e) || 'AI recap failed.';
      setTodayAiRecapError(message);
      return null;
    } finally {
      setTodayAiRecapBusy(false);
    }
  }, [todayAiContext]);

  const nextStoryOrder = useCallbackA((kind, parentId = null) => {
    const noteById = new Map(notesWithBody.map(note => [note.id, note]));
    const values = (items, step, base) => {
      let maxOrder = null;
      for (const item of items) {
        const value = mnNoteOrderValue(item);
        if (value == null) continue;
        maxOrder = maxOrder == null ? value : Math.max(maxOrder, value);
      }
      return maxOrder != null ? maxOrder + step : base + step;
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

  const uniqueNoteTitle = useCallbackA((rawTitle = 'Untitled', excludeId = null) => {
    return MN_APP_MUTATIONS.uniqueNoteTitle(notes, rawTitle, excludeId);
  }, [notes]);

  const createRuntimeNoteId = () => `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const createNote = useCallbackA(({ title = 'Untitled', body = '', tags: noteTags = [] } = {}, options = {}) => {
    const id = createRuntimeNoteId();
    const { note: newNote, missingTags } = MN_APP_MUTATIONS.createNoteDraft({
      id,
      title,
      body,
      tags: noteTags,
      defaultTags: tweaks.defaultTags,
      existingTags: tags,
      now: new Date().toISOString(),
    }, {
      normalizeTagName,
      parseDefaultTags: mnParseDefaultTags,
      normalizeNoteBody: mnNormalizeNoteBody,
      ensureScenePlotPoints: mnEnsureScenePlotPoints,
      mdToBlocks: mnMdToBlocks,
      makeEmptyBlock: () => mkBlock({ kind: 'paragraph', content: '' }),
    });
    if (missingTags.length) {
      setTags(ts => MN_APP_MUTATIONS.addTagsToList(ts, missingTags, () => (Math.floor(Math.random() * 12) * 30) + 10));
      markTagsDirty();
    }
    setNotes(ns => [newNote, ...ns]);
    if (options.open !== false) {
      setSelectedId(id);
      navigateView(options.view || 'notes');
    }
    markDirty(id);
    return id;
  }, [markDirty, navigateView, tweaks.defaultTags, tags, mnMdToBlocks, mkBlock]);

  const createNoteFromTemplate = useCallbackA((templateId) => {
    const template = MN_APP_HELPERS.templateById ? MN_APP_HELPERS.templateById(templateId) : (MN_NOTE_TEMPLATES.find(item => item.id === templateId) || MN_NOTE_TEMPLATES[0]);
    const expanded = MN_APP_HELPERS.expandTemplate
      ? MN_APP_HELPERS.expandTemplate(template)
      : { noteTitle: template?.noteTitle || template?.title || 'Untitled', body: template?.body || '', tags: template?.tags || [] };
    return createNote({ title: uniqueNoteTitle(expanded.noteTitle), body: expanded.body, tags: expanded.tags || [] });
  }, [createNote, uniqueNoteTitle]);

  const createDailyNote = useCallbackA(() => {
    const date = MN_APP_HELPERS.todayIsoDate ? MN_APP_HELPERS.todayIsoDate() : new Date().toISOString().slice(0, 10);
    const existing = notesWithBody.find(note => String(note.title || '').trim() === date);
    if (existing) {
      setSelectedId(existing.id);
      navigateView('notes');
      return existing.id;
    }
    return createNoteFromTemplate('daily');
  }, [notesWithBody, navigateView, createNoteFromTemplate]);

  const duplicateNote = useCallbackA((noteId, options = {}) => {
    const source = notesWithBody.find(n => n.id === noteId);
    if (!source) return null;
    const id = createRuntimeNoteId();
    const duplicate = MN_APP_MUTATIONS.duplicateNoteDraft(source, {
      id,
      title: uniqueNoteTitle(`${source.title || 'Untitled'} copy`),
      now: new Date().toISOString(),
    }, {
      normalizeNoteBody: mnNormalizeNoteBody,
      blocksToMd: mnBlocksToMd,
      mdToBlocks: mnMdToBlocks,
      makeEmptyBlock: () => mkBlock({ kind: 'paragraph', content: '' }),
    });
    setNotes(ns => [duplicate, ...ns]);
    if (options.open !== false) {
      setSelectedId(id);
      navigateView(options.view || 'notes');
    }
    markDirty(id);
    return id;
  }, [notesWithBody, mnBlocksToMd, mnMdToBlocks, mkBlock, uniqueNoteTitle, markDirty, navigateView]);

  const updateNote = useCallbackA((id, patch, options = {}) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      if (options.noteHistory !== false && options.historyKey) {
        recordNoteMetadataHistory(n, options.historyKey);
      }
      return MN_APP_MUTATIONS.applyNotePatch(n, patch);
    }));
    markDirty(id);
  }, [markDirty, recordNoteMetadataHistory]);

  const restoreNoteMetadataSnapshot = useCallbackA((direction, noteId = null) => {
    const state = noteMetadataHistoryRef.current;
    const from = direction === 'redo' ? state.redo : state.undo;
    const to = direction === 'redo' ? state.undo : state.redo;
    const index = noteId ? from.map(item => item?.id).lastIndexOf(noteId) : from.length - 1;
    if (index < 0) return false;
    const [snapshot] = from.splice(index, 1);
    if (!snapshot) return false;
    let current = null;
    setNotes(ns => ns.map(note => {
      if (note.id !== snapshot.id) return note;
      current = cloneNoteForMetadataHistory(note);
      return {
        ...note,
        title: snapshot.title,
        pinned: !!snapshot.pinned,
        tags: [...(snapshot.tags || [])],
      };
    }));
    if (current) {
      to.push(current);
      markDirty(snapshot.id);
    }
    state.activeKey = null;
    return true;
  }, [cloneNoteForMetadataHistory, markDirty]);

  const undoNoteMetadataEdit = useCallbackA((noteId) => restoreNoteMetadataSnapshot('undo', noteId), [restoreNoteMetadataSnapshot]);
  const redoNoteMetadataEdit = useCallbackA((noteId) => restoreNoteMetadataSnapshot('redo', noteId), [restoreNoteMetadataSnapshot]);

  const updateNoteBody = useCallbackA((id, bodyOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      return MN_APP_MUTATIONS.applyNoteBodyUpdate(n, bodyOrUpdater, {
        normalizeNoteBody: mnNormalizeNoteBody,
        blocksToMd: mnBlocksToMd,
        mdToBlocks: mnMdToBlocks,
      });
    }));
    markDirty(id);
  }, [markDirty, mnMdToBlocks, mnBlocksToMd]);

  const quickCaptureMergeTags = useCallbackA((...groups) => {
    const seen = new Set();
    const out = [];
    groups.flat().forEach(tag => {
      const clean = normalizeTagName(tag);
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push(clean);
    });
    return out;
  }, []);

  const quickCaptureRawMarkdown = useCallbackA(({ title = '', body = '' } = {}) => {
    const cleanTitle = String(title || '').trim();
    const cleanBody = String(body || '').trim();
    if (cleanTitle && cleanBody) return `## ${cleanTitle}\n\n${cleanBody}\n`;
    if (cleanBody) return `${cleanBody}\n`;
    if (cleanTitle) return `## ${cleanTitle}\n`;
    return '';
  }, []);

  const quickCaptureAppendBody = useCallbackA((existingBody = '', captureBody = '') => {
    const left = String(existingBody || '').replace(/\s+$/g, '');
    const right = String(captureBody || '').trim();
    return [left, right].filter(Boolean).join('\n\n') + (right ? '\n' : '');
  }, []);

  const saveQuickCapture = useCallbackA(({ title = 'Untitled', body = '', tags: noteTags = [], destinationId = 'new', templateId = '' } = {}) => {
    const cleanTitle = String(title || '').trim() || 'Untitled';
    const destinationOptions = { notes: notesWithBody, currentNote: selectedNote };
    const templateSelected = !!String(templateId || '').trim();
    if (templateSelected && MN_APP_HELPERS.captureBuildSavePlan) {
      const text = destinationId === 'new'
        ? (String(body || '').trim() || cleanTitle)
        : [cleanTitle, body].map(value => String(value || '').trim()).filter(Boolean).join('\n\n');
      const plan = MN_APP_HELPERS.captureBuildSavePlan({
        destinationId,
        templateId,
        text,
        noteTitle: cleanTitle,
        notes: notesWithBody,
        currentNote: selectedNote,
      });
      const tagsForCapture = quickCaptureMergeTags(plan.tags || [], noteTags);
      if (plan.action === 'append' && plan.noteId) {
        updateNoteBody(plan.noteId, previous => quickCaptureAppendBody(previous, plan.appendText || plan.body || ''));
        setSelectedId(plan.noteId);
        navigateView('notes');
        return plan.noteId;
      }
      return createNote({
        title: uniqueNoteTitle(plan.createNote?.title || cleanTitle),
        body: plan.createNote?.body || plan.body || '',
        tags: tagsForCapture,
      });
    }

    const destination = MN_APP_HELPERS.captureDestinationById
      ? MN_APP_HELPERS.captureDestinationById(destinationId, destinationOptions)
      : { id: 'new' };
    const activeDestination = destination?.disabled && destination.fallbackDestinationId && MN_APP_HELPERS.captureDestinationById
      ? MN_APP_HELPERS.captureDestinationById(destination.fallbackDestinationId, destinationOptions)
      : destination;
    const rawBody = activeDestination?.id === 'new'
      ? body
      : quickCaptureRawMarkdown({ title: cleanTitle, body });
    if (activeDestination?.noteId) {
      updateNoteBody(activeDestination.noteId, previous => quickCaptureAppendBody(previous, rawBody));
      setSelectedId(activeDestination.noteId);
      navigateView('notes');
      return activeDestination.noteId;
    }
    return createNote({
      title: uniqueNoteTitle(activeDestination?.id === 'new' ? cleanTitle : (activeDestination?.noteTitle || cleanTitle)),
      body: rawBody,
      tags: quickCaptureMergeTags(activeDestination?.tags || [], noteTags),
    });
  }, [createNote, navigateView, notesWithBody, quickCaptureAppendBody, quickCaptureMergeTags, quickCaptureRawMarkdown, selectedNote, uniqueNoteTitle, updateNoteBody]);

  const addQuickTodayTask = useCallbackA((text) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    const date = MN_APP_HELPERS.todayIsoDate ? MN_APP_HELPERS.todayIsoDate() : new Date().toISOString().slice(0, 10);
    const existing = notesWithBody.find(note => String(note.title || '').trim() === date);
    const appendTask = body => (
      MN_APP_HELPERS.rollupAppendQuickTask
        ? MN_APP_HELPERS.rollupAppendQuickTask(body, clean)
        : `${String(body || '').replace(/\s+$/g, '')}\n- [ ] ${clean}\n`
    );
    if (existing) {
      updateNoteBody(existing.id, appendTask);
      return true;
    }
    const template = MN_APP_HELPERS.templateById ? MN_APP_HELPERS.templateById('daily') : (MN_NOTE_TEMPLATES.find(item => item.id === 'daily') || MN_NOTE_TEMPLATES[0]);
    const expanded = MN_APP_HELPERS.expandTemplate
      ? MN_APP_HELPERS.expandTemplate(template)
      : { noteTitle: date, body: `# ${date}\n\n## Tasks\n`, tags: ['daily'] };
    createNote({
      title: uniqueNoteTitle(expanded.noteTitle || date),
      body: appendTask(expanded.body || ''),
      tags: expanded.tags || ['daily'],
    }, { open: false });
    return true;
  }, [notesWithBody, updateNoteBody, createNote, uniqueNoteTitle]);

  const appendToTodayDailyNote = useCallbackA((appendBody, options = {}) => {
    if (typeof appendBody !== 'function') return false;
    const date = MN_APP_HELPERS.todayIsoDate ? MN_APP_HELPERS.todayIsoDate() : new Date().toISOString().slice(0, 10);
    const existing = notesWithBody.find(note => String(note.title || '').trim() === date);
    if (existing) {
      updateNoteBody(existing.id, appendBody);
      setSelectedId(existing.id);
      navigateView('notes');
      return true;
    }
    const template = MN_APP_HELPERS.templateById ? MN_APP_HELPERS.templateById('daily') : (MN_NOTE_TEMPLATES.find(item => item.id === 'daily') || MN_NOTE_TEMPLATES[0]);
    const expanded = MN_APP_HELPERS.expandTemplate
      ? MN_APP_HELPERS.expandTemplate(template)
      : { noteTitle: date, body: `# ${date}\n\n## Tasks\n`, tags: ['daily'] };
    createNote({
      title: uniqueNoteTitle(expanded.noteTitle || date),
      body: appendBody(expanded.body || ''),
      tags: expanded.tags || ['daily'],
    }, { open: true, view: options.view || 'notes' });
    return true;
  }, [notesWithBody, updateNoteBody, createNote, uniqueNoteTitle, navigateView]);

  const addTodayReflection = useCallbackA(() => (
    appendToTodayDailyNote(body => (
      MN_APP_HELPERS.rollupAppendReflection
        ? MN_APP_HELPERS.rollupAppendReflection(body)
        : `${String(body || '').replace(/\s+$/g, '')}\n\n## Reflection\n- What stood out:\n`
    ))
  ), [appendToTodayDailyNote]);

  const addTodayEndDayRecap = useCallbackA(() => (
    appendToTodayDailyNote(body => (
      MN_APP_HELPERS.rollupAppendEndDayRecap
        ? MN_APP_HELPERS.rollupAppendEndDayRecap(body, {
          notes: notesWithBody,
          tasks: calendarTaskItems,
          reminders: reminderCenterItems,
        })
        : `${String(body || '').replace(/\s+$/g, '')}\n\n## End-day recap\n### Highlights\n- \n### Decisions\n- \n### Open loops\n- \n### Tomorrow candidates\n- \n`
    ))
  ), [appendToTodayDailyNote, notesWithBody, calendarTaskItems, reminderCenterItems]);

  const updateNoteBodies = useCallbackA((updates = []) => {
    const existingIds = new Set(notesWithBody.map(note => note.id));
    const byId = new Map();
    (updates || []).forEach(update => {
      const id = String(update?.id || '');
      if (!id || !existingIds.has(id) || typeof update?.body !== 'string') return;
      byId.set(id, update.body);
    });
    if (!byId.size) return 0;
    setNotes(ns => ns.map(note => {
      if (!byId.has(note.id)) return note;
      return MN_APP_MUTATIONS.applyNoteBodyUpdate(note, byId.get(note.id), {
        normalizeNoteBody: mnNormalizeNoteBody,
        blocksToMd: mnBlocksToMd,
        mdToBlocks: mnMdToBlocks,
      });
    }));
    byId.forEach((_, id) => markDirty(id));
    return byId.size;
  }, [notesWithBody, markDirty, mnMdToBlocks, mnBlocksToMd]);

  const applyAiCurrentPageBody = useCallbackA((noteId, body, options = {}) => {
    const id = String(noteId || '');
    const current = notesWithBody.find(note => note.id === id);
    if (!current) return { ok: false, error: 'No current page is open to edit.' };
    if (typeof body !== 'string') return { ok: false, error: 'AI edit body is invalid.' };
    const previousBody = typeof options.previousBody === 'string'
      ? options.previousBody
      : String(current.body || '');
    aiNoteBodyRestoreRef.current.set(id, {
      body: previousBody,
      title: current.title || 'Current page',
      instruction: String(options.instruction || ''),
      at: new Date().toISOString(),
    });
    const applied = updateNoteBodies([{ id, body }]);
    return applied
      ? { ok: true, restoreAvailable: true, noteId: id }
      : { ok: false, error: 'Could not apply AI edit.' };
  }, [notesWithBody, updateNoteBodies]);

  const restoreAiCurrentPageBody = useCallbackA((noteId) => {
    const id = String(noteId || '');
    const snapshot = aiNoteBodyRestoreRef.current.get(id);
    if (!snapshot) return { ok: false, error: 'No previous AI edit body is available.' };
    const applied = updateNoteBodies([{ id, body: snapshot.body }]);
    if (!applied) return { ok: false, error: 'Could not restore previous AI edit body.' };
    aiNoteBodyRestoreRef.current.delete(id);
    return { ok: true, noteId: id, title: snapshot.title || 'Current page' };
  }, [updateNoteBodies]);

  const openNoteById = useCallbackA((id) => {
    const noteId = String(id || '');
    if (!notesWithBody.some(note => note.id === noteId)) return false;
    setSelectedId(noteId);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    navigateView('notes');
    return true;
  }, [notesWithBody, navigateView]);

  const updateTaskItemSource = useCallbackA((item, patch = {}) => {
    if (!item?.noteId) return false;
    const note = notes.find(n => n.id === item.noteId);
    if (!note) return false;
    const nextText = mnCalendarTaskContent(
      patch.text ?? item.label ?? item.text,
      patch.date ?? item.remindAt?.date ?? '',
      patch.time ?? item.remindAt?.time ?? '',
      Object.prototype.hasOwnProperty.call(patch, 'deferUntil') ? patch.deferUntil : item.deferUntil
    );
    if (!nextText) return false;
    const nextChecked = Object.prototype.hasOwnProperty.call(patch, 'checked') ? !!patch.checked : item.checked;
    if (item.blockId) {
      const nextBlocks = mnCloneBlocks(note.blocks || []);
      const loc = mnLocate(nextBlocks, item.blockId);
      if (loc?.block) {
        loc.block.content = nextText;
        if (loc.block.kind === 'todo') loc.block.checked = !!nextChecked;
        updateNote(item.noteId, { blocks: nextBlocks });
        return true;
      }
    }
    if (item.line != null) {
      updateNoteBody(item.noteId, body => {
        const lines = String(body || '').split('\n');
        const index = Number(item.line);
        if (!Number.isInteger(index) || index < 0 || index >= lines.length) return body;
        lines[index] = mnCalendarUpdateMarkdownLine(lines[index], nextText, nextChecked);
        return lines.join('\n');
      });
      return true;
    }
    updateNoteBody(item.noteId, body => {
      const source = String(item.text || '').trim();
      if (!source) return body;
      if (MN_APP_HELPERS.agendaReplaceUniqueSourceText) {
        return MN_APP_HELPERS.agendaReplaceUniqueSourceText(body, source, nextText);
      }
      const text = String(body || '');
      const index = text.indexOf(source);
      if (index < 0 || text.indexOf(source, index + source.length) >= 0) return body;
      return `${text.slice(0, index)}${nextText}${text.slice(index + source.length)}`;
    });
    return true;
  }, [notes, updateNote, updateNoteBody]);

  const createCalendarTaskItem = useCallbackA(({ noteId, text, type, date, time } = {}) => {
    const id = String(noteId || selectedId || '').trim();
    const note = notes.find(candidate => candidate.id === id);
    if (!id || !note) return false;
    const content = mnCalendarTaskContent(text, date, type === 'reminder' ? time : '');
    if (!content) return false;
    if (MN_APP_HELPERS.agendaBodyHasActionText && MN_APP_HELPERS.agendaBodyHasActionText(note.body || '', content)) return false;
    updateNoteBody(id, body => {
      const source = String(body || '').replace(/\s+$/g, '');
      return `${source}${source ? '\n' : ''}- [ ] ${content}\n`;
    });
    return true;
  }, [notes, selectedId, updateNoteBody]);

  const snoozeCalendarTaskItem = useCallbackA((item, minutes = 15) => {
    const next = new Date(Date.now() + Math.max(1, Number(minutes) || 15) * 60 * 1000);
    const parts = mnCalendarReminderDateParts(next);
    return updateTaskItemSource(item, parts);
  }, [updateTaskItemSource]);

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
    const result = MN_APP_MUTATIONS.renameNoteTitleDrafts(notesWithBody, noteId, title, {
      blocksToMd: mnBlocksToMd,
      mdToBlocks: mnMdToBlocks,
      replaceWikiLinkTitle: mnReplaceWikiLinkTitle,
      normalizeNoteBody: mnNormalizeNoteBody,
    });
    if (!result) return;
    setNotes(result.notes);
    result.dirtyIds.forEach(id => markDirty(id));
  }, [notesWithBody, markDirty, mnBlocksToMd, mnMdToBlocks]);

  const convertNovelistType = useCallbackA((noteId, tag) => {
    const note = notes.find(n => n.id === noteId);
    const nextTags = MN_APP_MUTATIONS.convertNovelistTypeTags(note, tag, normalizeTagName);
    if (!nextTags) return;
    updateNote(noteId, { tags: nextTags });
  }, [notes, updateNote]);

  const updateNoteBlocks = useCallbackA((id, blocksOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      return MN_APP_MUTATIONS.applyNoteBlocksUpdate(n, blocksOrUpdater, {
        resolveBlocksChange: window.MN_EDITOR_OPS.resolveBlocksChange,
      });
    }));
    markDirty(id);
  }, [markDirty]);

  const toggleCheckFromAggregate = (it) => {
    if (it.isReminderOnly) return;
    updateTaskItemSource(it, { checked: !it.checked });
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

  const tagCurrentNoteFromAi = useCallbackA((name) => {
    if (!selectedNote) return null;
    const clean = addTag(name);
    if (!clean) return null;
    const currentTags = selectedNote.tags || [];
    const alreadyHadTag = currentTags.includes(clean);
    if (!alreadyHadTag) {
      updateNote(selectedNote.id, { tags: [...currentTags, clean] }, { historyKey: `note:${selectedNote.id}:tag:${clean}:ai-add` });
    }
    return { tag: clean, alreadyHadTag };
  }, [selectedNote, updateNote, tags]);

  const removeTag = (name) => {
    const clean = normalizeTagName(name);
    if (!clean || !tags.find(t => t.name === clean)) return;
    const tagRemoval = MN_APP_MUTATIONS.removeTagFromNotes(notes, clean);
    setTags(ts => ts.filter(t => t.name !== clean));
    if (selectedTag === clean) setSelectedTag(null);
    if (tagRemoval.dirtyIds.length) {
      setNotes(tagRemoval.notes);
      tagRemoval.dirtyIds.forEach(id => markDirty(id));
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
    if (typeof name === 'string') addTag(name);
  };

  const requestDeleteNote = (id) => {
    if (!notes.find(x => x.id === id)) return;
    setDeleteTargetId(id);
  };

  const deleteNote = async (id) => {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    const previousNotes = notes;
    const previousSelectedId = selectedId;
    const dirtyKey = mnDirtyNoteKey(activeVaultId, id);
    const previousDirtyEntry = dirtyNotes.get(dirtyKey);
    setDeleteTargetId(null);
    setDirtyNotes(cur => {
      if (!cur.has(dirtyKey)) return cur;
      const next = new Map(cur);
      next.delete(dirtyKey);
      return next;
    });
    setNotes(ns => {
      const next = MN_NOTES_VAULTS_STATE.removeNote(ns, id);
      setSelectedId(current => current === id ? (next[0]?.id || null) : current);
      return next;
    });
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await MN_NOTES_VAULTS_SERVICE.deleteNote(window.mn, activeVaultId, id, noteForDisk(n, mnBlocksToMd));
        if (res && res.ok === false) throw new Error(res.error);
        if (res?.value?.trashId) {
          setTrashItems(items => [res.value, ...items.filter(item => item.trashId !== res.value.trashId)]);
        }
      }
      catch (e) {
        console.error('deleteNote failed', e);
        setNotes(previousNotes);
        setSelectedId(previousSelectedId);
        if (previousDirtyEntry) {
          setDirtyNotes(cur => {
            const next = new Map(cur);
            next.set(dirtyKey, previousDirtyEntry);
            return next;
          });
        }
        showAppNotice('Could not delete note', e.message || String(e));
      }
    }
  };

  const normalizeRuntimeNote = useCallbackA((note) => {
    return normalizeNotes([note], mnMdToBlocks)[0] || null;
  }, [mnMdToBlocks]);

  const listDeletedNotes = useCallbackA(async () => {
    if (!HAS_DISK || !activeVaultId) return [];
    const [noteRes, canvasRes] = await Promise.all([
      window.mn.listDeletedNotes(activeVaultId),
      window.mn.listDeletedCanvases ? window.mn.listDeletedCanvases(activeVaultId) : Promise.resolve({ ok: true, value: [] }),
    ]);
    if (!noteRes.ok) throw new Error(noteRes.error || 'Could not load deleted notes');
    if (!canvasRes.ok) throw new Error(canvasRes.error || 'Could not load deleted canvases');
    return [...(noteRes.value || []), ...(canvasRes.value || [])]
      .sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
  }, [activeVaultId]);

  const refreshDeletedItems = useCallbackA(async () => {
    const seq = ++trashLoadSeq.current;
    setTrashLoading(true);
    setTrashError('');
    try {
      const next = await listDeletedNotes();
      if (seq === trashLoadSeq.current) setTrashItems(next);
      return next;
    } catch (e) {
      const message = e.message || String(e);
      if (seq === trashLoadSeq.current) setTrashError(message);
      return [];
    } finally {
      if (seq === trashLoadSeq.current) setTrashLoading(false);
    }
  }, [listDeletedNotes]);

  const restoreDeletedNote = useCallbackA(async (itemOrTrashId) => {
    const trashId = typeof itemOrTrashId === 'string' ? itemOrTrashId : itemOrTrashId?.trashId;
    const sourceType = typeof itemOrTrashId === 'object' ? itemOrTrashId?.sourceType : 'note';
    if (!HAS_DISK || !activeVaultId || !trashId) return { ok: false, error: 'No active vault.' };
    try {
      if (sourceType === 'canvas') {
        const res = await window.mn.restoreDeletedCanvas(activeVaultId, trashId);
        if (!res.ok) throw new Error(res.error || 'Could not restore canvas');
        const restored = summarizeCanvas(res.value);
        setCanvases(current => upsertCanvasList(current, restored));
        setVaults(vs => vs.map(v => v.id === activeVaultId
          ? { ...v, canvases: upsertCanvasList(v.canvases || [], restored) }
          : v));
        setActiveCanvas(res.value);
        navigateView('canvas');
        setTrashItems(items => items.filter(item => item.trashId !== trashId));
        return { ok: true, canvas: res.value };
      }
      const res = await window.mn.restoreDeletedNote(activeVaultId, trashId);
      if (!res.ok) throw new Error(res.error || 'Could not restore note');
      const restored = normalizeRuntimeNote(res.value);
      if (!restored) throw new Error('Restored note could not be loaded');
      setNotes(ns => [restored, ...ns.filter(n => n.id !== restored.id)]);
      setVaults(vs => vs.map(v => v.id === activeVaultId && Array.isArray(v.notes)
        ? { ...v, notes: [restored, ...v.notes.filter(n => n.id !== restored.id)] }
        : v));
      setSelectedId(restored.id);
      setSelectedTag(null);
      setSelectedWorkflow(null);
      navigateView('notes');
      setTrashItems(items => items.filter(item => item.trashId !== trashId));
      return { ok: true, note: restored };
    } catch (e) {
      console.error('restoreDeletedNote failed', e);
      showAppNotice('Could not restore note', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, normalizeRuntimeNote, navigateView, showAppNotice]);

  const purgeDeletedNote = useCallbackA(async (itemOrTrashId) => {
    const trashId = typeof itemOrTrashId === 'string' ? itemOrTrashId : itemOrTrashId?.trashId;
    const sourceType = typeof itemOrTrashId === 'object' ? itemOrTrashId?.sourceType : 'note';
    if (!HAS_DISK || !activeVaultId || !trashId) return { ok: false, error: 'No active vault.' };
    try {
      const res = sourceType === 'canvas' && window.mn.purgeDeletedCanvas
        ? await window.mn.purgeDeletedCanvas(activeVaultId, trashId)
        : await window.mn.purgeDeletedNote(activeVaultId, trashId);
      if (!res.ok) throw new Error(res.error || `Could not permanently delete ${sourceType === 'canvas' ? 'canvas' : 'note'}`);
      setTrashItems(items => items.filter(item => item.trashId !== trashId));
      return { ok: true };
    } catch (e) {
      console.error('purgeDeletedNote failed', e);
      showAppNotice('Could not permanently delete note', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, showAppNotice]);

  useEffectA(() => {
    if (!activeVaultId) {
      setTrashItems([]);
      setTrashError('');
      return;
    }
    if (view === 'trash') refreshDeletedItems();
  }, [activeVaultId, view, refreshDeletedItems]);

  const restoreNoteVersion = useCallbackA(async (noteId, versionId) => {
    if (!HAS_DISK || !activeVaultId || !noteId || !versionId) return { ok: false, error: 'No active vault.' };
    try {
      const res = await window.mn.restoreNoteVersion(activeVaultId, noteId, versionId);
      if (!res.ok) throw new Error(res.error || 'Could not restore note version');
      const restored = normalizeRuntimeNote(res.value);
      if (!restored) throw new Error('Restored version could not be loaded');
      setNotes(ns => ns.map(n => n.id === restored.id ? restored : n));
      setVaults(vs => vs.map(v => v.id === activeVaultId && Array.isArray(v.notes)
        ? { ...v, notes: v.notes.map(n => n.id === restored.id ? restored : n) }
        : v));
      setDirtyNotes(cur => {
        const key = mnDirtyNoteKey(activeVaultId, restored.id);
        if (!cur.has(key)) return cur;
        const next = new Map(cur);
        next.delete(key);
        return next;
      });
      setSelectedId(restored.id);
      navigateView('notes');
      return { ok: true, note: restored };
    } catch (e) {
      console.error('restoreNoteVersion failed', e);
      showAppNotice('Could not restore version', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, normalizeRuntimeNote, navigateView, showAppNotice]);

  const reloadConflictFromDisk = useCallbackA(async () => {
    const conflict = conflictNotice;
    if (!conflict?.vaultId || !conflict?.noteId) return;
    try {
      const res = await MN_NOTES_VAULTS_SERVICE.loadVault(window.mn, conflict.vaultId);
      if (!res.ok) throw new Error(res.error || 'Could not reload note');
      const vault = res.value || res.data?.vault;
      const loaded = normalizeNotes(vault.notes || [], mnMdToBlocks);
      const diskNote = loaded.find(note => note.id === conflict.noteId);
      if (!diskNote) throw new Error('The disk version no longer exists.');
      if (conflict.vaultId === activeVaultId) {
        setNotes(ns => ns.map(n => n.id === conflict.noteId ? diskNote : n));
      }
      setVaults(vs => vs.map(v => v.id === conflict.vaultId && Array.isArray(v.notes)
        ? { ...v, notes: v.notes.map(n => n.id === conflict.noteId ? diskNote : n) }
        : v));
      setDirtyNotes(cur => {
        const key = mnDirtyNoteKey(conflict.vaultId, conflict.noteId);
        if (!cur.has(key)) return cur;
        const next = new Map(cur);
        next.delete(key);
        return next;
      });
      setConflictNotice(null);
    } catch (e) {
      console.error('reload conflict failed', e);
      showAppNotice('Could not reload disk version', e.message || String(e));
    }
  }, [activeVaultId, conflictNotice, mnMdToBlocks, showAppNotice]);

  const keepConflictAsDuplicate = useCallbackA(async () => {
    const conflict = conflictNotice;
    if (!conflict?.vaultId || !conflict?.noteId) return;
    const source = notesWithBody.find(note => note.id === conflict.noteId);
    if (!source) return;
    const duplicateId = createRuntimeNoteId();
    const duplicateTitle = uniqueNoteTitle(`${source.title || 'Untitled'} local copy`);
    const duplicateBody = mnNormalizeNoteBody(source.body || mnBlocksToMd(source.blocks || []), duplicateTitle);
    const duplicate = {
      ...source,
      id: duplicateId,
      title: duplicateTitle,
      body: duplicateBody,
      blocks: mnMdToBlocks(duplicateBody || ''),
      pinned: false,
      date: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      diskModifiedAt: null,
    };
    setNotes(ns => [duplicate, ...ns]);
    setVaults(vs => vs.map(v => v.id === conflict.vaultId && Array.isArray(v.notes)
      ? { ...v, notes: [duplicate, ...v.notes] }
      : v));
    markDirty(duplicateId);
    await reloadConflictFromDisk();
    setSelectedId(duplicateId);
  }, [conflictNotice, notesWithBody, uniqueNoteTitle, mnBlocksToMd, mnMdToBlocks, markDirty, reloadConflictFromDisk]);

  const summarizeCanvas = (canvas) => ({
    ...MN_APP_MUTATIONS.summarizeCanvas(canvas),
  });

  const upsertCanvasList = (list, canvas) => {
    return MN_APP_MUTATIONS.upsertCanvasList(list, canvas);
  };

  const canvasActionContext = useCallbackA((overrides = {}) => ({
    activeVaultId,
    activeCanvas,
    canvases,
    hasDisk: HAS_DISK,
    mn: window.mn,
    newCanvas: window.mnNewCanvas,
    upsertCanvasList,
    setCanvases,
    setVaults,
    setActiveCanvas,
    setSelectedTag,
    setSelectedWorkflow,
    setQuery,
    navigateView,
    showAppNotice,
    logError: (...args) => console.error(...args),
    ...overrides,
  }), [activeVaultId, activeCanvas, canvases, navigateView, showAppNotice]);

  const cacheCanvases = useCallbackA((nextCanvases) => {
    MN_APP_CANVAS_ACTIONS.cacheCanvases(nextCanvases, canvasActionContext());
  }, [canvasActionContext]);

  const upsertCanvasSummary = useCallbackA((canvas) => {
    MN_APP_CANVAS_ACTIONS.upsertCanvasSummary(canvas, canvasActionContext());
  }, [canvasActionContext]);

  const openCanvasDashboard = useCallbackA(() => {
    MN_APP_CANVAS_ACTIONS.openCanvasDashboard(canvasActionContext());
  }, [canvasActionContext]);

  const openCanvas = useCallbackA(async (canvasId) => {
    return MN_APP_CANVAS_ACTIONS.openCanvas(canvasId, canvasActionContext());
  }, [canvasActionContext]);

  const createCanvas = useCallbackA(async (title = 'Untitled canvas', options = {}) => {
    return MN_APP_CANVAS_ACTIONS.createCanvas(title, options, canvasActionContext());
  }, [canvasActionContext]);

  const saveCanvas = useCallbackA(async (canvas) => {
    return MN_APP_CANVAS_ACTIONS.saveCanvas(canvas, canvasActionContext());
  }, [canvasActionContext]);

  const deleteCanvas = useCallbackA(async (canvasId) => {
    return MN_APP_CANVAS_ACTIONS.deleteCanvas(canvasId, canvasActionContext());
  }, [canvasActionContext]);

  const exportBackup = useCallbackA(async () => {
    if (!window.mn?.exportBackup) return showAppNotice('Backup unavailable', 'This build does not expose backup export.');
    try {
      const res = await window.mn.exportBackup({});
      if (!res.ok) throw new Error(res.error);
      if (!res.value?.canceled) showAppNotice('Backup exported', `${res.value.vaultCount || 0} vault${res.value.vaultCount === 1 ? '' : 's'} saved.`, 'info');
    } catch (e) {
      showAppNotice('Could not export backup', e.message || String(e));
    }
  }, [showAppNotice]);

  const importBackup = useCallbackA(async () => {
    if (!window.mn?.importBackup) return showAppNotice('Import unavailable', 'This build does not expose backup import.');
    try {
      const res = await window.mn.importBackup({ activate: true });
      if (!res.ok) throw new Error(res.error);
      if (res.value?.canceled) return;
      await refreshVaultRegistry({ reloadActive: true, reason: 'import-backup' });
      showAppNotice('Backup imported', `${res.value.importedVaults?.length || 0} vault${res.value.importedVaults?.length === 1 ? '' : 's'} restored.`, 'info');
    } catch (e) {
      showAppNotice('Could not import backup', e.message || String(e));
    }
  }, [refreshVaultRegistry, showAppNotice]);

  const analyzeNovelImportFiles = useCallbackA(async (files, skipped = [], importSeq = 0) => {
    if (!window.mn?.ai?.toolPlan) throw new Error('AI tool planning is unavailable in this build.');
    const chunks = mnNovelImportChunks(files);
    if (!chunks.length) throw new Error('No readable text was selected for import.');
    const existingSummary = mnNovelImportExistingSummary(notesWithBody);
    const extracted = [];
    const jobId = `novel-import-${Date.now().toString(36)}`;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      setNovelImportDialog(current => current
        && current.seq === importSeq ? { ...current, phase: 'analyzing', progress: `Analyzing ${chunk.fileName} (${index + 1}/${chunks.length})...` }
        : current);
      const response = await window.mn.ai.toolPlan({
        jobId,
        timeoutMs: 180000,
        maxTokens: 2600,
        tools: [MN_NOVEL_IMPORT_TOOL],
        messages: [{ role: 'user', content: mnNovelImportExtractionPrompt(chunk, existingSummary) }],
      });
      const args = mnNovelImportToolArgs(response);
      const candidates = normalizeNovelImportCandidates(args).map(candidate => ({
        ...candidate,
        sourceFile: candidate.sourceFile || chunk.fileName,
      }));
      extracted.push(...candidates);
    }
    if (!extracted.length) throw new Error('AI did not find story structure or supporting novel details in the selected files.');

    let finalCandidates = extracted;
    const consolidationPrompt = mnNovelImportConsolidationPrompt(extracted, existingSummary);
    if (extracted.length > 1 && consolidationPrompt.length <= 19000) {
      setNovelImportDialog(current => current
        && current.seq === importSeq ? { ...current, phase: 'analyzing', progress: 'Consolidating extracted notes...' }
        : current);
      try {
        const response = await window.mn.ai.toolPlan({
          jobId,
          timeoutMs: 180000,
          maxTokens: 3200,
          tools: [MN_NOVEL_IMPORT_TOOL],
          messages: [{ role: 'user', content: consolidationPrompt }],
        });
        const consolidated = normalizeNovelImportCandidates(mnNovelImportToolArgs(response));
        if (consolidated.length) finalCandidates = consolidated;
      } catch (e) {
        console.warn('novel import consolidation failed', e);
      }
    }

    const plan = buildNovelImportPlan(finalCandidates, notesWithBody, { vaultId: activeVaultId });
    return {
      ...plan,
      notes: plan.notes.map(note => ({ ...note, blocks: mnMdToBlocks(note.body || '') })),
      files,
      skipped,
    };
  }, [activeVaultId, mnMdToBlocks, notesWithBody]);

  const importNovelFiles = useCallbackA(async () => {
    if (!activeVault?.novelistMode) return showAppNotice('Novelist vault required', 'Switch this vault to Novelist mode before importing novel files.', 'warn');
    if (!window.mn?.importNovelFiles) return showAppNotice('Novel import unavailable', 'This build does not expose novel file import.');
    if (!window.mn?.ai?.toolPlan) return showAppNotice('AI unavailable', 'Novel import needs AI tool planning to classify structure and support notes.');
    let importSeq = 0;
    try {
      const res = await window.mn.importNovelFiles({});
      if (!res.ok) throw new Error(res.error || 'Could not import novel files.');
      if (res.value?.canceled) return;
      const files = res.value?.files || [];
      const skipped = res.value?.skipped || [];
      if (!files.length) {
        const reason = skipped[0]?.reason || 'No readable UTF-8 text files were selected.';
        showAppNotice('No files imported', reason, 'warn');
        return;
      }
      importSeq = ++novelImportSeq.current;
      setNovelImportDialog({ seq: importSeq, phase: 'analyzing', files, skipped, progress: 'Reading source material...' });
      const plan = await analyzeNovelImportFiles(files, skipped, importSeq);
      if (importSeq !== novelImportSeq.current) return;
      setNovelImportDialog({ seq: importSeq, phase: 'ready', files, skipped, plan });
    } catch (e) {
      if (importSeq && importSeq !== novelImportSeq.current) return;
      console.error('novel import failed', e);
      setNovelImportDialog(current => current
        ? { ...current, phase: 'error', error: e.message || String(e) }
        : { phase: 'error', error: e.message || String(e), skipped: [] });
    }
  }, [activeVault?.novelistMode, analyzeNovelImportFiles, showAppNotice]);

  const applyNovelImportPreview = useCallbackA(() => {
    const plan = novelImportDialog?.plan;
    if (!plan?.changedIds?.length) return;
    const nextTags = mnEnsureNovelistTags(tags);
    const tagNames = tags.map(tag => tag.name).join('\n');
    const nextTagNames = nextTags.map(tag => tag.name).join('\n');
    setNotes(plan.notes);
    setTags(nextTags);
    setVaults(vs => vs.map(v => v.id === activeVaultId
      ? { ...v, notes: plan.notes, tags: nextTags, novelistMode: true }
      : v));
    plan.changedIds.forEach(id => markDirty(id));
    if (tagNames !== nextTagNames) markTagsDirty();
    setNovelImportDialog(null);
    showAppNotice(
      'Novel import applied',
      `${plan.created?.length || 0} note${plan.created?.length === 1 ? '' : 's'} created, ${plan.updated?.length || 0} merged.`,
      'info'
    );
  }, [activeVaultId, markDirty, markTagsDirty, novelImportDialog, showAppNotice, tags]);

  const closeNovelImportDialog = useCallbackA(() => {
    novelImportSeq.current++;
    setNovelImportDialog(null);
  }, []);

  const rebuildIndex = useCallbackA(async () => {
    if (!activeVaultId || !window.mn?.rebuildIndex) return;
    try {
      const res = await window.mn.rebuildIndex(activeVaultId);
      if (!res.ok) throw new Error(res.error);
      showAppNotice('Index rebuilt', `${res.value.indexed || 0} notes indexed.`, 'info');
    } catch (e) {
      showAppNotice('Could not rebuild index', e.message || String(e));
    }
  }, [activeVaultId, showAppNotice]);

  const plugins = useMemoA(() => (MN_PLUGIN_API.normalizeAll ? MN_PLUGIN_API.normalizeAll(tweaks.plugins) : []), [tweaks.plugins]);

  const runPlugin = useCallbackA(async (plugin) => {
    if (!plugin || plugin.enabled === false) return { ok: false, message: 'Plugin is unavailable.' };
    const expand = MN_PLUGIN_API.expandTokens || (value => String(value || ''));
    if (plugin.type === 'note-template') {
      const title = uniqueNoteTitle(expand(plugin.config?.title || plugin.name || 'Plugin note'));
      const body = expand(plugin.config?.body || '');
      const noteTags = MN_PLUGIN_API.tags ? MN_PLUGIN_API.tags(plugin) : [];
      const id = createNote({ title, body, tags: noteTags });
      return { message: `Created ${title}.`, affected: [{ type: 'note', id, title }] };
    }
    if (plugin.type === 'quick-capture') {
      setCaptureOpen(true);
      return { message: 'Opened Quick Capture.' };
    }
    if (plugin.type === 'open-url') {
      const url = expand(plugin.config?.url || '').trim();
      if (!/^(https:\/\/|mailto:)/i.test(url)) {
        const message = `${plugin.name || 'This plugin'} must start with https:// or mailto:.`;
        showAppNotice('Plugin needs a safe URL', message);
        return { ok: false, message };
      }
      try {
        if (window.mn?.openExternal) {
          const res = await window.mn.openExternal(url);
          if (res && res.ok === false) throw new Error(res.error || 'Could not open external URL');
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return { message: 'Opened external URL.' };
      } catch (e) {
        const message = e.message || String(e);
        showAppNotice('Could not open link', message);
        return { ok: false, message };
      }
    }
    if (plugin.type === 'zotero-reader') {
      if (!window.mn?.zotero?.status) return { ok: false, message: 'Zotero integration is unavailable.' };
      const res = await window.mn.zotero.status();
      if (!res.ok) return { ok: false, message: res.error || 'Could not check Zotero.' };
      const reachable = !!res.value?.reachable;
      const message = reachable ? 'Zotero Desktop is reachable.' : (res.value?.error || 'Zotero Desktop is not reachable.');
      showAppNotice(reachable ? 'Zotero ready' : 'Zotero unavailable', message, reachable ? 'info' : 'warn');
      return { ok: reachable, message };
    }
    return { ok: false, message: 'Unsupported plugin type.' };
  }, [createNote, showAppNotice, uniqueNoteTitle]);

  const appActionRegistry = useMemoA(() => {
    const makeRegistry = MN_APP_ACTIONS_FACTORY.createRegistry || ((actions) => ({
      list: () => actions,
      run: (id) => actions.find(action => action.id === id)?.run?.(),
      preview: () => null,
      describeForAi: () => [],
      findForText: () => null,
    }));
    const stringArg = (maxLength = 160) => ({ type: 'string', maxLength });
    const integerArg = (defaultValue = 8) => ({ type: 'integer', default: defaultValue });
    const objectSchema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
    const byNoteId = (id) => notesWithBody.find(note => note.id === id) || null;
    const normalizeNoteLookupText = (value) => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^(?:the|a|an)\s+/, '')
      .replace(/\s+/g, ' ');
    const normalizeNoteLookupKey = (value) => normalizeNoteLookupText(value).replace(/[^a-z0-9]+/g, '');
    const noteTitleArg = (args = {}) => String(args.noteTitle || args.targetNoteTitle || '').trim();
    const zoteroReaderEnabled = plugins.some(plugin => plugin.enabled !== false && plugin.type === 'zotero-reader');
    const scoreNoteTitleMatch = (note, queryTitle) => {
      const queryText = normalizeNoteLookupText(queryTitle);
      const queryKey = normalizeNoteLookupKey(queryTitle);
      const titleText = normalizeNoteLookupText(note.title || '');
      const titleKey = normalizeNoteLookupKey(note.title || '');
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
        if (titleText.includes(term)) {
          score += term.length >= 4 ? 18 : 8;
          titleHits += 1;
          if (!['note', 'page'].includes(term)) meaningfulHits += 1;
        }
      }
      if (meaningfulTerms.length >= 2 && meaningfulHits === meaningfulTerms.length) score += 90;
      if (terms.length && titleHits === terms.length) score += 80;
      return score;
    };
    const noteByTitle = (title) => {
      const cleanTitle = String(title || '').trim();
      if (!cleanTitle) return null;
      const scored = notesWithBody
        .map(note => ({ note, score: scoreNoteTitleMatch(note, cleanTitle) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best) return null;
      if (best.score >= 1000) return best.note;
      const second = scored[1]?.score || 0;
      return best.score >= 80 && best.score >= second + 20 ? best.note : null;
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
    const writableMetadataNote = (args = {}) => metadataNote(args);
    const writableBodyNote = (args = {}) => currentOrArgNote(args);
    const noteAffected = (note) => note ? [{ type: 'note', id: note.id, title: note.title || 'Untitled' }] : [];
    const updateNoteTagsById = (noteId, updater) => {
      if (!noteId) return;
      setNotes(ns => ns.map(note => {
        if (note.id !== noteId) return note;
        const nextTags = typeof updater === 'function' ? updater(note.tags || []) : updater;
        return MN_APP_MUTATIONS.applyNotePatch(note, { tags: Array.isArray(nextTags) ? nextTags : [] });
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
      if (id) return vaultsForSidebar.find(vault => vault.id === id) || null;
      const name = String(args.vaultName || args.name || '').trim().toLowerCase();
      if (!name) return activeVault || null;
      return vaultsForSidebar.find(vault => String(vault.name || '').trim().toLowerCase() === name)
        || vaultsForSidebar.find(vault => String(vault.name || '').trim().toLowerCase().includes(name))
        || null;
    };
    const scoreNoteForQuery = (note, terms) => {
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
    };
    const searchNotesFast = async (query, limit = 8) => {
      const cleanQuery = String(query || '').trim();
      const max = Math.max(1, Math.min(Number(limit) || 8, 30));
      if (!cleanQuery) return [];
      if (HAS_DISK && activeVaultId && window.mn?.searchDetailedStatus) {
        try {
          const res = await window.mn.searchDetailedStatus(activeVaultId, cleanQuery, max);
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
    const clearFilters = () => { setSelectedTag(null); setSelectedWorkflow(null); };
    const openView = (nextView) => {
      clearFilters();
      navigateView(nextView);
      return { message: `Opened ${nextView}.` };
    };
    const noteActionSchema = objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180) });
    const titleActionSchema = objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), title: stringArg(180) }, ['title']);
    const tagActionSchema = objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), tag: stringArg(64) }, ['tag']);
    const canvasActionSchema = objectSchema({ canvasId: stringArg(120), canvasTitle: stringArg(180), title: stringArg(180) });
    const vaultActionSchema = objectSchema({ vaultId: stringArg(120), vaultName: stringArg(180), name: stringArg(180) });

    const actions = [
      {
        id: 'new-note',
        label: 'New note',
        description: 'Create a blank note or a note with a supplied title, body, and tags.',
        section: 'Create',
        shortcut: 'Ctrl+N',
        keywords: 'page capture create',
        inputSchema: objectSchema({ title: stringArg(180), body: stringArg(20000), tags: { type: 'array', items: stringArg(64) }, open: { type: 'boolean' } }),
        run: (args) => {
          const title = args.title || undefined;
          const id = createNote({ title, body: args.body || '', tags: args.tags || [] }, { open: args.open !== false });
          return { title: 'Note created', message: `Created "${title || 'Untitled'}".`, affected: [{ type: 'note', id, title: title || 'Untitled' }] };
        },
      },
      {
        id: 'quick-capture',
        label: 'Quick capture',
        description: 'Open the quick capture dialog.',
        section: 'Create',
        shortcut: 'Ctrl+Shift+N',
        keywords: 'inbox capture',
        inputSchema: objectSchema(),
        run: () => { setCaptureOpen(true); return { message: 'Opened quick capture.' }; },
      },
      {
        id: 'daily-note',
        label: 'Open daily note',
        description: 'Open or create today’s daily note.',
        section: 'Create',
        keywords: 'today journal daily',
        inputSchema: objectSchema(),
        run: () => {
          const id = createDailyNote();
          return { message: 'Opened daily note.', affected: id ? [{ type: 'note', id, title: 'Daily note' }] : [] };
        },
      },
      {
        id: 'ask-ai',
        label: 'Ask AI',
        description: 'Open the Ask AI workspace.',
        section: 'AI',
        shortcut: 'Ctrl+Shift+K',
        keywords: 'assistant chat',
        enabled: HAS_DISK,
        aiHidden: true,
        inputSchema: objectSchema({ query: stringArg(1000) }),
        run: (args) => { openAskAi(args.query || ''); return { message: 'Opened Ask AI.' }; },
      },
      {
        id: 'settings',
        label: 'Open settings',
        description: 'Open settings, optionally with a named section request.',
        section: 'System',
        keywords: 'preferences configuration',
        inputSchema: objectSchema({ section: stringArg(80) }),
        run: () => { setSettingsOpen(true); return { message: 'Opened settings.' }; },
      },
      { id: 'graph', label: 'Open graph', description: 'Show the note graph.', section: 'Navigate', shortcut: 'Ctrl+G', inputSchema: objectSchema(), run: () => openView('graph') },
      { id: 'calendar', label: 'Open Agenda', description: 'Show scheduled todos and reminders.', section: 'Navigate', keywords: 'calendar schedule agenda reminder date', inputSchema: objectSchema(), run: () => openView('calendar') },
      { id: 'today', label: 'Open Today', description: 'Show the Today dashboard.', section: 'Navigate', inputSchema: objectSchema(), run: () => openView('today') },
      { id: 'smart-views', label: 'Open Smart Views', description: 'Show saved Smart View dashboards.', section: 'Navigate', keywords: 'saved smart views dashboard query tasks reminders', inputSchema: objectSchema(), run: () => openSmartView() },
      { id: 'todos', label: 'Open Agenda', description: 'Open the calendar planner for tasks and reminders.', section: 'Navigate', keywords: 'tasks checklist todos agenda calendar', hidden: true, aiHidden: true, inputSchema: objectSchema(), run: () => openView('calendar') },
      { id: 'canvas', label: 'Open canvas dashboard', description: 'Open the canvas dashboard.', section: 'Navigate', inputSchema: objectSchema(), run: () => { openCanvasDashboard(); return { message: 'Opened canvas dashboard.' }; } },
      ...smartViewDefinitions.map(definition => ({
        id: `smart-view-${definition.id}`,
        label: `Open ${definition.title}`,
        description: 'Open a saved Smart View.',
        section: 'Smart Views',
        keywords: `smart view saved dashboard ${definition.type || ''}`,
        inputSchema: objectSchema(),
        run: () => openSmartView(definition.id),
      })),
      {
        id: 'vault-health',
        label: 'Open vault health',
        description: 'Open vault health diagnostics.',
        section: 'Vault',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        run: () => { setVaultHealthOpen(true); return { message: 'Opened vault health.' }; },
      },
      {
        id: 'export-backup',
        label: 'Export backup',
        description: 'Export a backup through the operating system save dialog.',
        section: 'Vault',
        risk: 'external',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        preview: () => ({ title: 'Export backup', message: 'VispNote will open a save dialog and write a backup file to the selected location.', steps: ['Open save dialog', 'Write backup JSON'], affected: [{ type: 'vault', id: activeVaultId, title: activeVault?.name || activeVaultId }] }),
        run: async () => { await exportBackup(); return { message: 'Backup export finished or was cancelled.' }; },
      },
      {
        id: 'import-backup',
        label: 'Import backup',
        description: 'Import a backup into new vaults through the operating system open dialog.',
        section: 'Vault',
        risk: 'destructive',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        preview: () => ({ title: 'Import backup', message: 'VispNote will read a selected backup file and create imported vaults.', steps: ['Open file dialog', 'Read backup JSON', 'Create imported vaults'], affected: [{ type: 'vault', id: activeVaultId, title: activeVault?.name || activeVaultId }] }),
        run: async () => { await importBackup(); return { message: 'Backup import finished or was cancelled.' }; },
      },
      {
        id: 'rebuild-index',
        label: 'Rebuild search index',
        description: 'Rebuild the full text search index for the active vault.',
        section: 'Vault',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        run: async () => { await rebuildIndex(); return { message: 'Search index rebuild requested.' }; },
      },
      {
        id: 'ai-backfill',
        label: 'Refresh AI index',
        description: 'Backfill missing embeddings for the active vault.',
        section: 'AI',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        run: async () => {
          const res = await window.mn?.ai?.backfill?.(activeVaultId);
          if (res && !res.ok) throw new Error(res.error || 'AI index backfill failed');
          const value = res?.value || {};
          const embedded = Number(value.embedded || 0);
          showAppNotice('AI index refreshed', value.reason || `${embedded} note${embedded === 1 ? '' : 's'} embedded.`, value.ok === false ? 'warn' : 'info');
          return { message: value.reason || `AI index refreshed (${embedded} embedded).` };
        },
      },
      {
        id: 'rename-note',
        label: 'Rename note',
        description: 'Rename a note and update wiki links that point to its old title.',
        section: 'Notes',
        risk: 'confirm',
        inputSchema: titleActionSchema,
        preview: (args) => {
          const note = currentOrArgNote(args);
          return { title: 'Rename note', message: `Rename "${note?.title || 'current note'}" to "${args.title}".`, steps: ['Rename note title', 'Update matching wiki links'], affected: noteAffected(note) };
        },
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: 'No note is available to rename.' };
          renameNoteTitle(note.id, args.title);
          return { message: `Renamed "${note.title || 'Untitled'}" to "${args.title}".`, affected: noteAffected({ ...note, title: args.title }) };
        },
      },
      {
        id: 'duplicate-note',
        label: 'Duplicate note',
        description: 'Duplicate the current or selected note.',
        section: 'Notes',
        inputSchema: noteActionSchema,
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: 'No note is available to duplicate.' };
          const id = duplicateNote(note.id);
          return { title: 'Note duplicated', message: `Duplicated "${note.title || 'Untitled'}".`, affected: [{ type: 'note', id, title: `${note.title || 'Untitled'} copy` }] };
        },
      },
      {
        id: 'delete-note',
        label: 'Delete note',
        description: 'Move the current or selected note to recently deleted.',
        section: 'Notes',
        risk: 'destructive',
        inputSchema: noteActionSchema,
        preview: (args) => {
          const note = currentOrArgNote(args);
          return { title: 'Delete note', message: `Move "${note?.title || 'current note'}" to recently deleted.`, steps: ['Remove note from the active vault', 'Keep it recoverable in trash'], affected: noteAffected(note) };
        },
        run: async (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: 'No note is available to delete.' };
          await deleteNote(note.id);
          return { message: `Deleted "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'search-notes',
        label: 'Search notes',
        description: 'Search note titles, tags, and indexed content for matching notes. Use this before editing or linking when the target note is not explicit.',
        section: 'Notes',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        keywords: 'find lookup content semantic keyword vector full text',
        examples: ['search notes for reading list', 'find notes about quarterly planning'],
        inputSchema: objectSchema({ query: stringArg(500), limit: integerArg(8) }, ['query']),
        outputSchema: objectSchema({ results: { type: 'array', items: { type: 'object', additionalProperties: true } } }),
        run: async (args) => {
          const results = await searchNotesFast(args.query, args.limit || 8);
          const affected = results.map(row => ({ type: 'note', id: row.id, title: row.title || 'Untitled' }));
          return {
            title: 'Search complete',
            message: results.length ? `Found ${results.length} matching note${results.length === 1 ? '' : 's'}.` : 'No matching notes found.',
            affected,
            results,
          };
        },
      },
      {
        id: 'read-note',
        label: 'Read note',
        description: 'Read a note by note id or note title before deciding what action to take.',
        section: 'Notes',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        requires: ['noteId or noteTitle'],
        examples: ['read Daily Updates Checklist', 'inspect the note called Project Plan'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180) }),
        outputSchema: objectSchema({ note: { type: 'object', additionalProperties: true } }),
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note was specified.' };
          return {
            title: 'Note read',
            message: `Read "${note.title || 'Untitled'}".`,
            affected: noteAffected(note),
            note: {
              id: note.id,
              title: note.title || 'Untitled',
              tags: note.tags || [],
              modifiedAt: note.modifiedAt || note.date || null,
              body: String(note.body || '').slice(0, 12000),
            },
          };
        },
      },
      {
        id: 'open-note',
        label: 'Open note',
        description: 'Open a note by note id or note title.',
        section: 'Notes',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        requires: ['noteId or noteTitle'],
        examples: ['open Daily Updates Checklist', 'show the note called Project Plan'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180) }),
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note was specified.' };
          setSelectedId(note.id);
          navigateView('notes');
          return { message: `Opened "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'append-to-note',
        label: 'Append to note',
        description: 'Append plain Markdown content to the current or selected note.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['append these meeting notes to the current note'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), content: stringArg(20000) }, ['content']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          if (!appendToBody(note, args.content)) return { ok: false, message: 'There is no content to append.' };
          return { message: `Updated "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'add-todo-to-note',
        label: 'Add todo to note',
        description: 'Append a Markdown todo item to the current or selected note.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['add todo call Nimal to this note', 'add a task to follow up on the draft'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), text: stringArg(500) }, ['text']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const text = String(args.text || '').replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').trim();
          if (!text) return { ok: false, message: 'Todo text is empty.' };
          appendToBody(note, `- [ ] ${text}`);
          return { message: `Added a todo to "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'add-reminder-to-note',
        label: 'Add reminder to note',
        description: 'Append a todo-style reminder to the current or selected note. Date and time can be supplied when the user gives them.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['remind me to renew the license tomorrow', 'add reminder follow up on invoice on 2026-05-20'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), text: stringArg(500), date: stringArg(80), time: stringArg(40) }, ['text']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const text = String(args.text || '').replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').trim();
          if (!text) return { ok: false, message: 'Reminder text is empty.' };
          const date = String(args.date || '').trim();
          const time = String(args.time || '').trim();
          const suffix = [date, time].filter(Boolean).join(' ');
          appendToBody(note, `- [ ] ${text}${suffix ? ` @remind ${suffix}` : ' @remind'}`);
          return { message: `Added a reminder to "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'link-note',
        label: 'Link note',
        description: 'Add a wiki link from the current or selected note to another note title.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided', 'target note title'],
        examples: ['link this note to Reading List', 'connect the current note with Project Plan'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), targetTitle: stringArg(180) }, ['targetTitle']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const targetTitle = cleanWikiTitle(args.targetTitle);
          if (!targetTitle) return { ok: false, message: 'Target note title is empty.' };
          const link = `[[${targetTitle}]]`;
          if (String(note.body || '').includes(link)) {
            return { message: `"${note.title || 'Untitled'}" already links to "${targetTitle}".`, affected: noteAffected(note) };
          }
          appendToBody(note, `Related: ${link}`);
          const target = notesWithBody.find(item => String(item.title || '').toLowerCase() === targetTitle.toLowerCase());
          return {
            message: `Linked "${note.title || 'Untitled'}" to "${targetTitle}".`,
            affected: [...noteAffected(note), ...noteAffected(target)],
          };
        },
      },
      {
        id: 'tag-note',
        label: 'Tag note',
        description: 'Apply a tag to the current, selected, or named note.',
        section: 'Notes',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['tag this note under reading', 'tag Daily update checklist as todo'],
        inputSchema: tagActionSchema,
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to tag.' };
          const clean = addTag(args.tag);
          if (!clean) return { ok: false, message: 'Tag name is empty.' };
          if (!(note.tags || []).includes(clean)) updateNoteTagsById(note.id, tags => tags.includes(clean) ? tags : [...tags, clean]);
          return { message: (note.tags || []).includes(clean) ? `"${note.title}" already has #${clean}.` : `Tagged "${note.title}" with #${clean}.`, affected: noteAffected(note) };
        },
      },
      {
        id: 'untag-note',
        label: 'Remove note tag',
        description: 'Remove a tag from the current, selected, or named note.',
        section: 'Notes',
        requires: ['current note unless noteId or noteTitle is provided'],
        inputSchema: tagActionSchema,
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to untag.' };
          const clean = normalizeTagName(args.tag);
          updateNoteTagsById(note.id, tags => tags.filter(tag => tag !== clean));
          return { message: `Removed #${clean} from "${note.title}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'set-workflow-status',
        label: 'Set workflow status',
        description: 'Set the workflow status property on the current, selected, or named note.',
        section: 'Workflow',
        keywords: 'todo doing done draft review status',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['move Daily update checklist to inprogress', 'set this note status to done'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), status: stringArg(80) }, ['status']),
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const status = mnNormalizeNoteStatus(args.status, workflowStates) || String(args.status || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
          updateWorkflowNoteStatus(note.id, null, status);
          return { message: `Set "${note.title}" to ${status || 'no status'}.`, affected: noteAffected(note) };
        },
      },
      {
        id: 'archive-workflow-note',
        label: 'Archive workflow note',
        description: 'Archive or restore the current or selected workflow note.',
        section: 'Workflow',
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), archived: { type: 'boolean', default: true } }),
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to archive.' };
          updateWorkflowArchived(note.id, args.archived !== false);
          return { message: `${args.archived === false ? 'Restored' : 'Archived'} "${note.title}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'create-canvas',
        label: 'Create canvas',
        description: 'Create a new canvas.',
        section: 'Canvas',
        inputSchema: canvasActionSchema,
        run: async (args) => {
          const canvas = await createCanvas(args.title || 'Untitled canvas');
          return { message: `Created "${canvas?.title || args.title || 'Untitled canvas'}".`, affected: canvas ? [{ type: 'canvas', id: canvas.id, title: canvas.title }] : [] };
        },
      },
      {
        id: 'open-canvas',
        label: 'Open canvas',
        description: 'Open a specific canvas or the canvas dashboard.',
        section: 'Canvas',
        inputSchema: canvasActionSchema,
        run: async (args) => {
          const target = resolveCanvas(args);
          const canvas = target?.id ? await openCanvas(target.id) : null;
          if (!target?.id) openCanvasDashboard();
          return { message: canvas ? `Opened "${canvas.title}".` : 'Opened canvas dashboard.', affected: canvas ? [{ type: 'canvas', id: canvas.id, title: canvas.title }] : [] };
        },
      },
      {
        id: 'delete-canvas',
        label: 'Delete canvas',
        description: 'Move a canvas to recently deleted.',
        section: 'Canvas',
        risk: 'destructive',
        inputSchema: canvasActionSchema,
        preview: (args) => {
          const canvas = resolveCanvas(args);
          return { title: 'Delete canvas', message: `Move "${canvas?.title || 'the canvas'}" to recently deleted.`, steps: ['Remove canvas from the dashboard', 'Keep it recoverable in trash'], affected: canvas ? [{ type: 'canvas', id: canvas.id, title: canvas.title }] : [] };
        },
        run: async (args) => {
          const canvasId = resolveCanvas(args)?.id;
          if (!canvasId) return { ok: false, message: 'No canvas is available to delete.' };
          await deleteCanvas(canvasId);
          return { message: 'Canvas deleted.' };
        },
      },
      {
        id: 'switch-vault',
        label: 'Switch vault',
        description: 'Switch to a vault by id or name.',
        section: 'Vaults',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        inputSchema: vaultActionSchema,
        run: (args) => {
          const vault = resolveVault(args);
          if (!vault) return { ok: false, message: args.vaultName || args.name ? `Could not find a vault matching "${args.vaultName || args.name}".` : 'No vault was specified.' };
          selectVault(vault.id);
          return { message: `Switched to ${vault.name}.`, affected: [{ type: 'vault', id: vault.id, title: vault.name }] };
        },
      },
      {
        id: 'restore-trash-item',
        label: 'Restore trash item',
        description: 'Restore a deleted note or canvas by trash id.',
        section: 'Vault',
        risk: 'confirm',
        enabled: HAS_DISK,
        inputSchema: objectSchema({ trashId: stringArg(140), sourceType: stringArg(20) }, ['trashId']),
        preview: (args) => ({ title: 'Restore trash item', message: `Restore trash item ${args.trashId}.`, steps: ['Read recently deleted item', 'Restore it to the active vault'], affected: [{ type: args.sourceType || 'trash', id: args.trashId, title: args.trashId }] }),
        run: async (args) => {
          const result = await restoreDeletedNote({ trashId: args.trashId, sourceType: args.sourceType || 'note' });
          return result?.ok === false ? { ok: false, message: result.error || 'Could not restore trash item.' } : { message: 'Trash item restored.' };
        },
      },
      ...(zoteroReaderEnabled ? [
        {
          id: 'zotero-list',
          label: 'List Zotero papers',
          description: 'List recent Zotero Desktop papers and references without searching for a title.',
          section: 'Zotero',
          keywords: 'zotero paper papers documents references bibliography library list show',
          risk: 'safe',
          kind: 'read',
          readOnly: true,
          inputSchema: objectSchema({ limit: integerArg(20) }),
          outputSchema: { type: 'object', additionalProperties: true },
          run: async (args) => {
            if (!window.mn?.zotero?.list) return { ok: false, message: 'Zotero integration is unavailable.' };
            const res = await window.mn.zotero.list({ limit: args.limit || 20 });
            if (!res.ok) return { ok: false, message: res.error || 'Could not list Zotero papers.' };
            const results = res.value?.results || [];
            return {
              message: results.length ? `Found ${results.length} Zotero item${results.length === 1 ? '' : 's'}.` : 'No Zotero papers were found.',
              results,
              affected: results.map(item => ({ type: 'zotero', id: item.key, title: item.title || item.key })),
            };
          },
        },
        {
          id: 'zotero-search',
          label: 'Search Zotero',
          description: 'Search Zotero Desktop documents by title, author, abstract, note, and indexed full text.',
          section: 'Zotero',
          keywords: 'zotero paper papers documents references bibliography library research pdf search find',
          risk: 'safe',
          kind: 'read',
          readOnly: true,
          inputSchema: objectSchema({ query: stringArg(300), limit: integerArg(8) }, ['query']),
          outputSchema: { type: 'object', additionalProperties: true },
          run: async (args) => {
            if (!window.mn?.zotero?.search) return { ok: false, message: 'Zotero integration is unavailable.' };
            const res = await window.mn.zotero.search({ query: args.query, limit: args.limit || 8 });
            if (!res.ok) return { ok: false, message: res.error || 'Could not search Zotero.' };
            const results = res.value?.results || [];
            return {
              message: results.length ? `Found ${results.length} Zotero item${results.length === 1 ? '' : 's'}.` : 'No Zotero items matched that search.',
              results,
              affected: results.map(item => ({ type: 'zotero', id: item.key, title: item.title || item.key })),
            };
          },
        },
        {
          id: 'zotero-read',
          label: 'Read Zotero item',
          description: 'Read Zotero item metadata, attachments, and available indexed attachment full text.',
          section: 'Zotero',
          keywords: 'zotero read paper document reference attachment full text pdf',
          risk: 'safe',
          kind: 'read',
          readOnly: true,
          inputSchema: objectSchema({ itemKey: stringArg(80), includeFullText: { type: 'boolean', default: true } }, ['itemKey']),
          outputSchema: { type: 'object', additionalProperties: true },
          run: async (args) => {
            if (!window.mn?.zotero?.read) return { ok: false, message: 'Zotero integration is unavailable.' };
            const res = await window.mn.zotero.read({ itemKey: args.itemKey, includeFullText: args.includeFullText !== false });
            if (!res.ok) return { ok: false, message: res.error || 'Could not read Zotero item.' };
            const value = res.value || {};
            const item = value.item || {};
            return {
              message: value.fullText
                ? `Read "${item.title || args.itemKey}" with indexed full text.`
                : `Read "${item.title || args.itemKey}" metadata${value.fullTextError ? `; ${value.fullTextError}` : '.'}`,
              item,
              attachments: value.attachments || [],
              fullText: value.fullText || '',
              fullTextItemKey: value.fullTextItemKey || '',
              fullTextTruncated: !!value.fullTextTruncated,
              fullTextError: value.fullTextError || '',
              affected: item.key ? [{ type: 'zotero', id: item.key, title: item.title || item.key }] : [],
            };
          },
        },
      ] : []),
      ...plugins.filter(plugin => plugin.enabled !== false).map(plugin => ({
        id: `plugin-${plugin.id}`,
        label: MN_PLUGIN_API.commandTitle ? MN_PLUGIN_API.commandTitle(plugin) : plugin.name,
        description: plugin.purpose || `Run ${plugin.name || 'plugin'}.`,
        section: 'Plugins',
        keywords: `${plugin.type} ${plugin.purpose || ''}`,
        risk: plugin.type === 'open-url' ? 'external' : 'safe',
        inputSchema: objectSchema(),
        preview: () => ({ title: MN_PLUGIN_API.commandTitle ? MN_PLUGIN_API.commandTitle(plugin) : plugin.name, message: `Run plugin "${plugin.name || plugin.id}".`, steps: [plugin.type === 'open-url' ? 'Open external URL' : 'Run plugin action'], affected: [{ type: 'plugin', id: plugin.id, title: plugin.name }] }),
        run: async () => runPlugin(plugin),
      })),
      ...MN_NOTE_TEMPLATES.map(template => ({
        id: `template-${template.id}`,
        label: `New ${template.title}`,
        description: `Create a note from the ${template.title} template.`,
        section: 'Templates',
        keywords: `${template.id} template create note`,
        inputSchema: objectSchema(),
        run: () => {
          const id = createNoteFromTemplate(template.id);
          return { message: `Created ${template.title}.`, affected: id ? [{ type: 'note', id, title: template.title }] : [] };
        },
      })),
      ...vaultsForSidebar.map(vault => ({
        id: `vault-${vault.id}`,
        label: `Switch to ${vault.name}`,
        description: `Switch active vault to ${vault.name}.`,
        section: 'Vaults',
        keywords: 'switch workspace vault',
        enabled: vault.id !== activeVaultId,
        inputSchema: objectSchema(),
        run: () => { selectVault(vault.id); return { message: `Switched to ${vault.name}.`, affected: [{ type: 'vault', id: vault.id, title: vault.name }] }; },
      })),
      ...canvases.slice(0, 60).map(canvas => ({
        id: `canvas-${canvas.id}`,
        label: canvas.title || 'Untitled canvas',
        description: 'Open canvas.',
        section: 'Canvases',
        keywords: 'canvas board',
        inputSchema: objectSchema(),
        run: async () => {
          const opened = await openCanvas(canvas.id);
          return { message: `Opened ${opened?.title || canvas.title || 'canvas'}.`, affected: [{ type: 'canvas', id: canvas.id, title: canvas.title }] };
        },
      })),
      ...notesWithBody.slice(0, 120).map(note => ({
        id: `note-${note.id}`,
        label: note.title || 'Untitled',
        description: 'Open note.',
        section: 'Notes',
        keywords: `${(note.tags || []).join(' ')} ${note.body || ''}`.slice(0, 500),
        inputSchema: objectSchema(),
        run: () => {
          setSelectedId(note.id);
          navigateView('notes');
          return { message: `Opened "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      })),
    ];
    return makeRegistry(actions);
  }, [activeCanvas, activeVault?.name, activeVaultId, canvases, createCanvas, createDailyNote, createNote, createNoteFromTemplate, deleteCanvas, deleteNote, duplicateNote, exportBackup, importBackup, markDirty, notesWithBody, openAskAi, openCanvas, openCanvasDashboard, openSmartView, plugins, rebuildIndex, restoreDeletedNote, runPlugin, selectVault, selectedNote, smartViewDefinitions, updateNote, updateNoteBody, updateWorkflowArchived, updateWorkflowNoteStatus, vaultsForSidebar, workflowStates, navigateView, showAppNotice]);

  useEffectA(() => {
    window.MN_APP_ACTIONS = appActionRegistry;
    return () => {
      if (window.MN_APP_ACTIONS === appActionRegistry) delete window.MN_APP_ACTIONS;
    };
  }, [appActionRegistry]);

  const handleAppActionResult = useCallbackA((result) => {
    if (!result) return;
    const tone = result.ok === false ? 'warn' : 'info';
    if (result.requiresConfirmation) {
      showAppNotice('Review required', result.preview?.message || result.message || 'This action needs confirmation.', 'warn');
      return;
    }
    if (result.message && !/opened/i.test(result.message)) showAppNotice(result.title || 'Action complete', result.message, tone);
  }, [showAppNotice]);

  const commands = useMemoA(() => {
    return appActionRegistry.list({ includeHidden: false }).map(action => ({
      id: action.id,
      title: action.title || action.label,
      section: action.section,
      shortcut: action.shortcut,
      keywords: action.keywords || action.description,
      enabled: action.enabled,
      risk: action.risk,
      run: async () => {
        try {
          const result = await appActionRegistry.run(action.id, {}, { confirmed: action.risk === 'external' });
          handleAppActionResult(result);
        } catch (e) {
          showAppNotice('Command failed', e.message || String(e));
        }
      },
    }));
  }, [appActionRegistry, handleAppActionResult, showAppNotice]);

  const runNaturalCommand = useCallbackA(async (plan) => {
    if (!plan?.steps?.length) return;
    for (const step of plan.steps) {
      try {
        const result = await appActionRegistry.run(step.actionId, step.args || {}, {});
        handleAppActionResult(result);
        if (result?.requiresConfirmation) break;
      } catch (e) {
        showAppNotice('Command failed', e.message || String(e));
        break;
      }
    }
  }, [appActionRegistry, handleAppActionResult, showAppNotice]);

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
      } else if (isMod && e.shiftKey && lowerKey === 'k') {
        e.preventDefault();
        openAskAi();
      } else if (isMod && lowerKey === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(v => !v);
      } else if (isMod && e.shiftKey && isBackslashKey) {
        e.preventDefault(); setNoteListHidden(v => !v);
      } else if (isMod && isBackslashKey && !e.shiftKey) {
        e.preventDefault(); setSidebarHidden(v => !v);
      } else if (e.key === 'Escape') {
        if (commandPaletteOpen || settingsOpen || reminderCenterOpen || vaultHealthOpen || appNotice || conflictNotice || versionTargetId || deleteTargetId) {
          e.preventDefault();
          setCommandPaletteOpen(false);
          setSettingsOpen(false);
          setReminderCenterOpen(false);
          setVaultHealthOpen(false);
          setAppNotice(null);
          setConflictNotice(null);
          setVersionTargetId(null);
          setDeleteTargetId(null);
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [appNotice, commandPaletteOpen, conflictNotice, createNote, deleteTargetId, navigateView, openAskAi, reminderCenterOpen, settingsOpen, vaultHealthOpen, versionTargetId, view]);

  useEffectA(() => {
    if (!toast?.key) return;
    if (blockingOverlayOpen) {
      quietedReminderKeys.current.add(toast.key);
      setToast(null);
      return;
    }
    const handle = setTimeout(() => {
      quietedReminderKeys.current.add(toast.key);
      setToast(current => current?.key === toast.key ? null : current);
    }, 9000);
    return () => clearTimeout(handle);
  }, [toast?.key, blockingOverlayOpen]);

  // Runtime reminder scan over @remind directives in the active vault.
  useEffectA(() => {
    if (bootState !== 'ready') return;
    const check = () => {
      if (toastRef.current) return;
      const now = Date.now();
      const today = new Date().toDateString();
      const snoozed = mnReadSnoozedReminders();
      const due = mnCollectReminderItems(notesWithBody)
        .filter(item => !(MN_APP_HELPERS.agendaIsDeferred && MN_APP_HELPERS.agendaIsDeferred(item)))
        .filter(item => {
          const dueTime = item.remindAt?.at?.getTime?.();
          if (!dueTime || dueTime > now) return false;
          if (tweaks.showOverdue === false && item.remindAt.at.toDateString() !== today) return false;
          if (dismissedReminderKeys.current.has(item.key)) return false;
          if (quietedReminderKeys.current.has(item.key)) return false;
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
  }, [bootState, notesWithBody, tweaks.showOverdue, tweaks.reminderSound, toast?.key]);

  // Push vault + selected note into the OS title bar
  useEffectA(() => {
    if (!HAS_DISK) return;
    const vname = vaults.find(v => v.id === activeVaultId)?.name || 'VispNote';
    const nname = selectedNote?.title;
    const t = [vname, nname].filter(Boolean).join(' — ') || 'VispNote';
    clearTimeout(titleUpdateTimerRef.current);
    titleUpdateTimerRef.current = setTimeout(() => {
      window.mn.setTitle(t === 'VispNote' ? t : `${t} — VispNote`);
    }, 80);
    return () => clearTimeout(titleUpdateTimerRef.current);
  }, [activeVaultId, vaults, selectedNote]);

  const noteListVisible = view === 'notes' || view === 'graph' || view === 'workflow';
  const aiChatListVisible = view === 'ai';
  const reminderCenterTop = view === 'ai' ? 17 : 14;
  const noteListTitle = query.trim()
    ? 'Search'
    : selectedTag
    ? `#${selectedTag}`
    : selectedWorkflow
    ? selectedWorkflow
    : (view === 'workflow' ? 'Workflow notes' : view === 'todos' ? 'Todos' : view === 'today' ? 'Today' : 'All notes');
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
      background: `
        radial-gradient(circle at 18% 12%, color-mix(in oklab, ${T.accent} 12%, transparent), transparent 26%),
        radial-gradient(circle at 92% 8%, color-mix(in oklab, ${T.success || T.accent} 10%, transparent), transparent 24%),
        ${T.bgOuter || T.bg}`,
      position: 'relative',
      fontFamily: 'var(--mn-ui)', overflow: 'hidden',
      fontSize: 'var(--mn-app-font-size)',
      padding: 0,
    }}>
        <div style={{
          display: 'flex',
          height: '100%',
          minWidth: 0,
          overflow: 'hidden',
          border: `1px solid ${T.line}`,
          borderRadius: 0,
          background: T.bg,
          boxShadow: typeof mnShadow === 'function'
            ? mnShadow(T, 'elevated')
            : `0 18px 46px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        }}>
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
              onOpenAgenda={() => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenToday={() => { navigateView('today'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenSmartViews={() => openSmartView()}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenCanvas={openCanvasDashboard}
              onOpenTrash={() => { navigateView('trash'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenAskAI={HAS_DISK ? openAskAi : null}
              todayActive={view === 'today'}
              agendaActive={view === 'calendar'}
              graphActive={view === 'graph'}
              smartViewsActive={view === 'smart-views'}
              smartViewCount={smartViewDefinitions.length}
              workflowActive={view === 'workflow'}
              novelistActive={view === 'novelist'}
              novelistEnabled={!!activeVault?.novelistMode}
              novelistCount={novelistNotes.length}
              canvasActive={view === 'canvas'}
              canvasCount={canvases.length}
              trashActive={view === 'trash'}
              trashCount={trashItems.length}
              calendarActive={view === 'calendar'}
              aiActive={view === 'ai'}
              onNewTag={promptNewTag}
              onDeleteTag={removeTag}
              onNew={() => createNote()}
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
              onRenameNote={renameNoteTitle}
              onDuplicateNote={duplicateNote}
              onDeleteNote={requestDeleteNote}
              tags={tags} theme={theme} density={tweaks.density} T={T}
            />
          )}

          {noteListVisible && !noteListHidden && (
            <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
          )}
          {noteListVisible && noteListHidden && (
            <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show note list" />
          )}

          {aiChatListVisible && !noteListHidden && (
            <MnAiChatHistory
              sessions={askAiSessions}
              activeId={activeAskAiSession?.id || ''}
              onSelect={setActiveAskAiSessionId}
              onNew={createAskAiChat}
              onDelete={deleteAskAiChat}
              onArchive={archiveAskAiChat}
              onRename={renameAskAiChat}
              T={T}
            />
          )}
          {aiChatListVisible && !noteListHidden && (
            <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
          )}
          {aiChatListVisible && noteListHidden && (
            <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show AI chats" />
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
              onTitleChange={(title) => updateNote(selectedNote.id, { title }, { historyKey: `note:${selectedNote.id}:title` })}
              onEndNoteMetadataEdit={endNoteMetadataEdit}
              onUndoNoteEdit={() => undoNoteMetadataEdit(selectedNote.id)}
              onRedoNoteEdit={() => redoNoteMetadataEdit(selectedNote.id)}
              onAddTag={(t) => updateNote(selectedNote.id, { tags: [...selectedNote.tags, t] }, { historyKey: `note:${selectedNote.id}:tag:${t}:add` })}
              onCreateTag={(raw) => {
                const name = addTag(raw);
                if (name && !selectedNote.tags.includes(name)) {
                  updateNote(selectedNote.id, { tags: [...selectedNote.tags, name] }, { historyKey: `note:${selectedNote.id}:tag:${name}:create` });
                }
              }}
              onRemoveTag={(t) => updateNote(selectedNote.id, { tags: selectedNote.tags.filter(x => x !== t) }, { historyKey: `note:${selectedNote.id}:tag:${t}:remove` })}
              onPinToggle={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned }, { historyKey: `note:${selectedNote.id}:pin:${selectedNote.pinned ? 'off' : 'on'}` })}
              onDuplicate={() => duplicateNote(selectedNote.id)}
              onDelete={() => requestDeleteNote(selectedNote.id)}
              onOpenVersions={HAS_DISK ? () => setVersionTargetId(selectedNote.id) : null}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenCalendar={() => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); }}
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

          {view === 'ai' && activeAskAiSession && (
            <MnAskAI
              vaultId={activeVaultId}
              currentNote={selectedNote ? {
                ...selectedNote,
                body: mnNormalizeNoteBody(mnBlocksToMd(selectedNote.blocks || []), selectedNote.title || 'Untitled'),
              } : null}
              allNotes={notesWithBody}
              initialQuery={askAiSeed}
              onClose={goBackView}
              onOpenNote={openNoteById}
              onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] }, { open: false })}
              onTagCurrentNote={tagCurrentNoteFromAi}
              onApplyCurrentPageBody={(body, options) => {
                if (!selectedNote) return { ok: false, error: 'No selected note.' };
                return applyAiCurrentPageBody(selectedNote.id, body, options);
              }}
              onRestoreCurrentPageBody={restoreAiCurrentPageBody}
              onOpenCurrentNoteVersions={(noteId) => setVersionTargetId(noteId || selectedNote?.id || null)}
              onApplyNoteBodies={updateNoteBodies}
              session={activeAskAiSession}
              setSession={setActiveAskAiSession}
              onBackgroundComplete={notifyAskAiComplete}
              embedded
              T={T} />
          )}

          {view === 'ai' && !activeAskAiSession && (
            <div style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
              color: T.inkMed,
            }}>
              <div style={{ textAlign: 'center', maxWidth: 320 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 8 }}>No AI chats</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: T.inkDim, marginBottom: 14 }}>
                  Start a new chat when you need note-aware help.
                </div>
                <button onClick={createAskAiChat} style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 7,
                  background: T.ink,
                  color: T.bg,
                  padding: '7px 12px',
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12.5,
                  fontWeight: 650,
                  cursor: 'pointer',
                }}>New chat</button>
              </div>
            </div>
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
          {view === 'calendar' && (
            <MnCalendarPanel
              notes={notesWithBody}
              tags={tags}
              items={calendarActionItems}
              selectedNoteId={selectedId || ''}
              weekStart={tweaks.weekStart || 'monday'}
              snoozeMinutes={tweaks.snoozeMinutes || '15'}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onCreateItem={createCalendarTaskItem}
              onUpdateItem={updateTaskItemSource}
              onToggleCheck={toggleCheckFromAggregate}
              onSnoozeItem={snoozeCalendarTaskItem}
              T={T}
              theme={theme}
            />
          )}
          {view === 'smart-views' && (
            <MnSmartViewsPanel
              notes={notesWithBody}
              tags={tags}
              definitions={smartViewDefinitions}
              activeDefinitionId={activeSmartViewId}
              onActiveDefinitionChange={setActiveSmartViewId}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onOpenAllNotes={() => { setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); navigateView('notes'); }}
              T={T}
              theme={theme}
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
              initialAiConfig={activeVault?.novelistAiConfig || null}
              onAiConfigChange={updateNovelistAiConfig}
              T={T}
              theme={theme}
            />
          )}
          {view === 'today' && (
            <MnTodayPanel
              notes={notesWithBody}
              tags={tags}
              tasks={calendarTaskItems}
              reminders={reminderCenterItems}
              todayNote={todayDailyNote}
              agendaItems={todayAgendaItems}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onOpenOrCreateDailyNote={createDailyNote}
              onAddQuickTask={addQuickTodayTask}
              onAddReflection={addTodayReflection}
              onEndDayRecap={addTodayEndDayRecap}
              todayAiRecap={todayAiRecap}
              todayAiRecapBusy={todayAiRecapBusy}
              todayAiRecapError={todayAiRecapError}
              onGenerateAiRecap={generateTodayAiRecap}
              onOpenAgenda={() => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onPlanItem={() => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); }}
              rollupFormat={tweaks.rollupFormat || 'long'}
              rollupDefaultRange={tweaks.rollupDefaultRange || 'today'}
              rollupGroupBy={tweaks.rollupGroupBy || 'created'}
              rollupShowPreviews={tweaks.rollupShowPreviews !== false}
              rollupShowTasks={tweaks.rollupShowTasks !== false}
              rollupShowReminders={tweaks.rollupShowReminders !== false}
              rollupCollapseOlder={tweaks.rollupCollapseOlder !== false}
              weekStart={tweaks.weekStart || 'monday'}
              T={T} theme={theme}
            />
          )}
          {view === 'trash' && (
            <MnRecentlyDeletedPanel
              items={trashItems}
              loading={trashLoading}
              error={trashError}
              onRefresh={refreshDeletedItems}
              onRestore={restoreDeletedNote}
              onPurge={purgeDeletedNote}
              T={T}
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

        <MnCommandPalette
          open={commandPaletteOpen}
          commands={commands}
          onNaturalAction={runNaturalCommand}
          onClose={() => setCommandPaletteOpen(false)}
          T={T}
        />
        {vaultHealthOpen && (
          <MnVaultHealthDialog
            vaultId={activeVaultId}
            onClose={() => setVaultHealthOpen(false)}
            onRebuildIndex={rebuildIndex}
            T={T}
          />
        )}

        {captureOpen && (
          <MnQuickCapture
            tags={tags}
            destinations={MN_APP_HELPERS.captureDestinationChoices
              ? MN_APP_HELPERS.captureDestinationChoices({ notes: notesWithBody, currentNote: selectedNote })
              : []}
            templates={MN_APP_HELPERS.captureTemplateChoices ? MN_APP_HELPERS.captureTemplateChoices() : []}
            onClose={() => setCaptureOpen(false)}
            onSave={(capture) => {
              saveQuickCapture(capture);
              setCaptureOpen(false);
            }}
            T={T} theme={theme}
          />
        )}
        <MnReminderToast
          toast={blockingOverlayOpen ? null : toast}
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
        {view !== 'ai' && (
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
        )}

        {settingsOpen && (
          <MnSettingsModal tweaks={tweaks} setTweak={setTweak} T={T}
            themeOptions={themeOptions}
            stats={appStats}
            vaults={vaultsForSidebar}
            activeVaultId={activeVaultId}
            activeVault={activeVault}
            onCreateVault={createVault}
            onDeleteVault={deleteVault}
            onSetVaultNovelistMode={setActiveVaultNovelistMode}
            onListDeletedNotes={listDeletedNotes}
            onRestoreDeletedNote={restoreDeletedNote}
            onPurgeDeletedNote={purgeDeletedNote}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
            onImportThemeFile={importThemeFile}
            onImportNovelFiles={importNovelFiles}
            onOpenVaultHealth={() => setVaultHealthOpen(true)}
            onRebuildIndex={rebuildIndex}
            onClose={() => setSettingsOpen(false)} />
        )}
        <MnNovelImportPreviewDialog
          dialog={novelImportDialog}
          T={T}
          onApply={applyNovelImportPreview}
          onClose={closeNovelImportDialog}
        />
        {deleteTargetNote && (
          <MnDeleteNoteDialog
            note={deleteTargetNote}
            T={T}
            onCancel={() => setDeleteTargetId(null)}
            onConfirm={() => deleteNote(deleteTargetNote.id)}
          />
        )}
        {appNotice && (
          <MnAppNoticeDialog
            notice={appNotice}
            T={T}
            onClose={() => setAppNotice(null)}
          />
        )}
        {conflictNotice && (
          <MnSaveConflictDialog
            conflict={conflictNotice}
            T={T}
            onReloadDisk={reloadConflictFromDisk}
            onKeepCopy={keepConflictAsDuplicate}
            onDismiss={() => setConflictNotice(null)}
          />
        )}
        {versionTargetId && (
          <MnVersionHistoryDialog
            note={notesWithBody.find(note => note.id === versionTargetId)}
            vaultId={activeVaultId}
            T={T}
            onClose={() => setVersionTargetId(null)}
            onRestore={restoreNoteVersion}
          />
        )}
    </div>
  );
}

window.MnApp = MnApp;
