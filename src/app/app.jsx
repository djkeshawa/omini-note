// Main App — composes sidebar, note list, editor, panels, overlays.
// Disk-backed through the renderer platform adapter. Falls back to in-memory
// seed when running outside Electron (e.g. opened directly in a browser).

import { useAppPersistenceController } from './controllers/useAppPersistenceController.js';
import { useAppLifecycleController } from './controllers/useAppLifecycleController.js';
import { useAppVaultActions } from './controllers/useAppVaultActions.js';
import { useAppNoteActions } from './controllers/useAppNoteActions.js';
import { useAppPlanningActions } from './controllers/useAppPlanningActions.js';
import { useAppDataActions } from './controllers/useAppDataActions.js';
import { useAppCommandActions } from './controllers/useAppCommandActions.js';
import { AppView } from './AppView.jsx';
import { ReferencePane as MnReferencePane, useReferencePaneController } from '../features/reference/index.js';
import { useAiSessionsController } from '../features/ai/index.js';
import { useSearchController } from '../features/search/index.js';
import { MnCanvasPanel, useCanvasController } from '../features/canvas/index.js';
import { useNavigationController } from '../features/navigation/index.js';
import { useOverlayController } from '../features/overlays/index.js';
import { MnRecentlyDeletedPanel, useTrashController } from '../features/trash/index.js';
import { useBootController } from '../features/boot/index.js';
import { MnTodayPanel, useTodayController } from '../features/today/index.js';
import { MnQuickCapture } from '../features/capture/index.js';
import { MnReminderToast } from '../features/reminders/index.js';
import { MnPanelGrip, MnPanelGripPeek } from '../shared/layout/PanelGrips.jsx';
import { MnSettingsModal } from '../settings/settings.jsx';
import { MnSidebar } from '../panels/sidebar.jsx';
import { MnAskAI } from '../ai/ai.jsx';
import {
  calendarCleanTaskText as mnCalendarCleanTaskText,
  calendarTaskContent as mnCalendarTaskContent,
  calendarReminderDateParts as mnCalendarReminderDateParts,
  calendarUpdateMarkdownLine as mnCalendarUpdateMarkdownLine,
} from '../features/planning/index.js';
import {
  NOVEL_IMPORT_TOOL as MN_NOVEL_IMPORT_TOOL,
  novelImportChunks as mnNovelImportChunks,
  novelImportExistingSummary as mnNovelImportExistingSummary,
  novelImportExtractionPrompt as mnNovelImportExtractionPrompt,
  novelImportConsolidationPrompt as mnNovelImportConsolidationPrompt,
  novelImportToolArgs as mnNovelImportToolArgs,
  NovelImportPreviewDialog as MnNovelImportPreviewDialog,
  MnNovelistPanel,
} from '../features/writer/index.js';
import { MnWorkflowPanel } from '../features/workflow/index.js';
import {
  PHASE5_METRICS_STORAGE_KEY as MN_PHASE5_METRICS_STORAGE_KEY,
  normalizeCustomThemes as mnNormalizeCustomThemesForApp,
  themeOptions as mnThemeOptionsForApp,
  normalizeStartupView as mnNormalizeStartupView,
  normalizeOnboardingMode as mnNormalizeOnboardingMode,
  readLocalPhase5Metrics as mnReadLocalPhase5Metrics,
  writeLocalPhase5Metrics as mnWriteLocalPhase5Metrics,
  buildDefaultSmartViewDefinitions as mnBuildDefaultSmartViewDefinitions,
  normalizeSmartViews as mnNormalizeSmartViewsForApp,
} from '../features/preferences/index.js';
import { desktopBridge, hasDesktopBridge } from '../platform/index.js';
import { useAppActionRegistry } from './actions/index.js';
import {
  MnLaunchScreen,
  MnDeleteNoteDialog,
  MnAppNoticeDialog,
  MnSaveConflictDialog,
  MnVersionHistoryDialog,
  MnReminderCenter,
  MnAiNotice,
  MnCommandPalette,
  MnVaultHealthDialog,
} from './appShell.jsx';

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;
const MN_FEATURES = window.MN_FEATURES || {};

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

const MN_PANEL_COMPONENTS = window.MN_PANEL_COMPONENTS || {};
const MN_NOTES_VAULTS_SERVICE = window.MN_NOTES_VAULTS_SERVICE || {};
const MN_VAULTS_SERVICE = window.MN_VAULTS_SERVICE || {};
const MN_NOTES_VAULTS_STATE = window.MN_NOTES_VAULTS_STATE || {};
const MN_MEMORY_ACTIONS = window.MN_MEMORY_ACTIONS || {};
const HAS_DISK = hasDesktopBridge();
const MnQuickSwitcher = window.MnQuickSwitcher;
const MN_QUICK_SWITCHER_MODEL = window.MN_QUICK_SWITCHER_MODEL || {};
const {
  MnSmartViewsPanel,
} = MN_PANEL_COMPONENTS;
const {
  MnNoteList,
  MnAiChatHistory,
  MnEditor,
  MnGraph,
  MnTodosPanel,
  MnCalendarPanel,
} = window;

function MnApp() {
  const { SEED_TAGS, SEED_NOTES, SEED_VAULTS, buildLinks } = window.MN_DATA;
  const { mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk } = window.MN_OUTLINE;
  // make them available to other modules via globals too
  window.MN_RUNTIME = window.MN_RUNTIME || Object.freeze({ mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk });
  window.mnMdToBlocks = mnMdToBlocks; window.mnBlocksToMd = mnBlocksToMd;
  window.mnWalk = mnWalk; window.mnLocate = mnLocate; window.mnCloneBlocks = mnCloneBlocks;
  window.mkBlock = mkBlock;

  const [tweaks, setTweaks] = useStateA(MN_TWEAK_DEFAULTS);
  const [enabledPacks, setEnabledPacks] = useStateA([]);
  const [assistanceEnabled, setAssistanceEnabled] = useStateA(false);
  const [customThemes, setCustomThemes] = useStateA([]);
  const [recentNoteIds, setRecentNoteIds] = useStateA([]);
  const [canvasTextEditing, setCanvasTextEditing] = useStateA(false);
  // Bumped when a rename rewrites links in other notes so the editor's
  // backlinks/mentions panels refetch; their effects otherwise only key on
  // the open note's id/title and would show stale rows after a rename.
  const [connectionsRefreshToken, setConnectionsRefreshToken] = useStateA(0);
  const {
    settingsOpen,
    setSettingsOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    quickSwitcherOpen,
    setQuickSwitcherOpen,
    vaultHealthOpen,
    setVaultHealthOpen,
    novelImportDialog,
    setNovelImportDialog,
    captureOpen,
    setCaptureOpen,
    deleteTargetId,
    setDeleteTargetId,
    appNotice,
    setAppNotice,
    conflictNotice,
    setConflictNotice,
    versionTargetId,
    setVersionTargetId,
    reminderCenterOpen,
    setReminderCenterOpen,
    showAppNotice,
  } = useOverlayController();
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

  const {
    selectedTag,
    setSelectedTag,
    selectedWorkflow,
    setSelectedWorkflow,
    view,
    setView,
    savedSmartViews,
    setSavedSmartViews,
    activeSmartViewId,
    setActiveSmartViewId,
    graphFilter,
    setGraphFilter,
    query,
    setQuery,
    navigateView,
    openSmartView,
    goBackView,
  } = useNavigationController({ defaultSmartViews: mnBuildDefaultSmartViewDefinitions });
  const titleUpdateTimerRef = useRefA(null);
  const [toast, setToast] = useStateA(null);
  const toastRef = useRefA(null);
  const dismissedReminderKeys = useRefA(new Set());
  const quietedReminderKeys = useRefA(new Set());
  const notesWithBodyCacheRef = useRefA(new Map());

  useEffectA(() => {
    dismissedReminderKeys.current.clear();
    quietedReminderKeys.current.clear();
    // Inline renderers (attachment images) resolve vault asset URLs from this
    // global because block components don't receive the vault id as a prop.
    window.MN_ACTIVE_VAULT_ID = activeVaultId || '';
  }, [activeVaultId]);

  useEffectA(() => {
    if (!selectedId || !MN_QUICK_SWITCHER_MODEL.mnPushRecentNoteId) return;
    setRecentNoteIds(ids => MN_QUICK_SWITCHER_MODEL.mnPushRecentNoteId(ids, selectedId));
  }, [selectedId]);

  useEffectA(() => {
    toastRef.current = toast;
  }, [toast]);

  // Global-shortcut bridge: the main process registers an OS-level hotkey
  // (Ctrl/Cmd+Shift+N) and pushes an IPC event when it fires. We mirror the
  // existing in-app keybinding by opening Quick Capture.
  useEffectA(() => {
    if (typeof window === 'undefined' || !desktopBridge?.onOpenQuickCapture) return;
    return desktopBridge.onOpenQuickCapture(() => setCaptureOpen(true));
  }, []);

  const { recordPhase5Metric, askAiSeed, askAiSessions, activeAskAiSession, aiNotice, setAiNotice, setActiveAskAiSessionId, openAskAi, setActiveAskAiSession, createAskAiChat, deleteAskAiChat, renameAskAiChat, archiveAskAiChat, notifyAskAiComplete, dirtyNotesRef, updateDirtyNotes, recordFeatureUsage, setPackEnabled, searchUsageActiveRef, noteDiskStampRef, savingDirtyKeysRef, pendingDirtyKeysRef, notesRef, vaultsRef, dirtyRevisionRef, dirtyMissingWarnedRef, vaultActivationSeq, noteMetadataHistoryRef, aiNoteBodyRestoreRef, cloneNoteForMetadataHistory, recordNoteMetadataHistory, endNoteMetadataEdit, markDirty, tagsDirty, markTagsDirty, saveVaultMetaNow, loadVaultBundle, normalizeFeaturePacks, applyWorkflowStates, bootState, bootError, tweakInitialized, findNotesForVault, applyLinkedNoteUpdates, saveDirtyNotesNow } = useAppPersistenceController({
    HAS_DISK, MN_APP_HELPERS, MN_APP_MUTATIONS, MN_AUTOSAVE_DEBOUNCE_MS, MN_AUTOSAVE_MAX_WAIT_MS, MN_FEATURES, MN_NOTES_VAULTS_SERVICE, MN_NOTES_VAULTS_STATE, MN_NOVELIST_WORKFLOW_STATES, MN_TWEAK_DEFAULTS, SEED_NOTES, SEED_TAGS, SEED_VAULTS, activeVaultId, captureOpen, desktopBridge, mnAskAiSessionTitle, mnBlocksToMd, mnDirtyNoteKey, mnMdToBlocks, mnNewAskAiSession, mnNormalizeCustomThemesForApp, mnNormalizeNoteBody, mnNormalizeSmartViewsForApp, mnNormalizeStartupView, mnNormalizeWorkflowStatesForApp, mnPickActiveAskAiSession, mnReadLocalPhase5Metrics, mnReplaceWikiLinkTitle, mnWriteLocalPhase5Metrics, navigateView, normalizeNotes, noteForDisk, notes, query, selectedId, setActiveVaultId, setAssistanceEnabled, setCanvases, setConflictNotice, setConnectionsRefreshToken, setCustomThemes, setEnabledPacks, setNotes, setSavedSmartViews, setSelectedId, setTags, setTweaks, setVaults, setView, showAppNotice, tags, tweaks, useAiSessionsController, useBootController, useCallbackA, useEffectA, useRefA, useStateA, vaults, view,
  });

  const { refreshVaultRegistry, setTweak, importThemeFile } = useAppLifecycleController({
    HAS_DISK, MN_NOTES_VAULTS_SERVICE, activeVaultId, bootState, canvases, desktopBridge, dirtyNotes, loadVaultBundle, mnNormalizeCustomThemesForApp, navigateView, notes, recordPhase5Metric, selectedId, setActiveCanvas, setActiveVaultId, setCanvases, setCustomThemes, setNotes, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setSettingsOpen, setTags, setTweaks, setVaults, showAppNotice, tags, tagsDirty, updateDirtyNotes, useCallbackA, useEffectA, vaultActivationSeq,
  });

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
  const { selectVault, persistNovelistSetup, createVault, setActiveVaultNovelistMode, renameVault, deleteVault } = useAppVaultActions({
    HAS_DISK, MN_NOTES_VAULTS_SERVICE, MN_NOVELIST_WORKFLOW_STATES, MN_VAULTS_SERVICE, activeVaultId, canvases, desktopBridge, dirtyNotes, mnBlocksToMd, mnBuildNovelistStarterNotes, mnEnsureNovelistTags, mnEnsureScenePlotPoints, mnMdToBlocks, mnNormalizeNoteBody, mnNormalizeNovelistLegacyBody, mnNormalizeNovelistLegacyTags, mnNormalizeOnboardingMode, mnNormalizeWorkflowStatesForApp, navigateView, normalizeNotes, noteForDisk, notes, recordPhase5Metric, refreshVaultRegistry, saveDirtyNotesNow, saveVaultMetaNow, selectedId, setActiveCanvas, setActiveVaultId, setCanvases, setNotes, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setTags, setVaults, showAppNotice, tags, tagsDirty, updateDirtyNotes, useCallbackA, vaultActivationSeq, vaults, view,
  });

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
      desktopBridge.saveVaultMeta(activeVaultId, { novelistAiConfig: config || null })
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
  const notesWithBodyRef = useRefA([]);
  useEffectA(() => { notesWithBodyRef.current = notesWithBody; }, [notesWithBody]);
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
        desktopBridge.saveVaultMeta(activeVaultId, { workflowStates: next })
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
    // Word/char totals are only shown in the settings modal; computing them
    // costs a full-vault text scan, so skip it while the modal is closed.
    if (settingsOpen) {
      notesWithBody.forEach(n => {
        const t = (n.body || '') + ' ' + (n.title || '');
        charCount += t.length;
        wordCount += t.trim().split(/\s+/).filter(Boolean).length;
      });
    }
    return {
      noteCount: notesWithBody.length,
      tagCount: tags.length,
      linkCount: links.length,
      wordCount, charCount,
    };
  }, [notesWithBody, tags, links, settingsOpen]);

  // SQLite-backed search: debounced IPC call returns matching IDs;
  // we intersect with in-memory notes for tag-filter compatibility.
  // searchHits = null  → no active query
  // searchHits.ids     → matched note ids in rank order for searchHits.vaultId
  const { filteredNotes } = useSearchController({
    query,
    activeVaultId,
    notes: notesWithBody,
    dirtyNotes,
    hasDisk: HAS_DISK,
    search: desktopBridge.searchDetailed || desktopBridge.search,
    view,
    selectedTag,
    selectedWorkflow,
    workflowData,
    tweaks,
    decorate: MN_APP_HELPERS.decorateNotesWithSearchDetails,
  });

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
  const setReferenceNoteListVisible = useCallbackA((visible) => {
    setTweak('showNoteList', visible);
  }, [setTweak]);
  const {
    open: referencePaneOpen,
    noteId: referenceNoteId,
    openPane: openReferencePane,
    closePane: closeReferencePane,
    selectNote: selectReferenceNote,
  } = useReferencePaneController({
    activeVaultId,
    notes: notesWithBody,
    selectedId,
    selectedNote,
    noteListHidden,
    navigateView,
    setNoteListVisible: setReferenceNoteListVisible,
    recordUsage: recordFeatureUsage,
    storage: window.MN_STORAGE,
  });
  const referenceNote = notesWithBody.find(n => n.id === referenceNoteId) || null;
  const deleteTargetNote = deleteTargetId ? notes.find(n => n.id === deleteTargetId) : null;
  const blockingOverlayOpen = captureOpen || settingsOpen || commandPaletteOpen || quickSwitcherOpen || vaultHealthOpen || !!novelImportDialog || !!deleteTargetNote || !!appNotice || !!conflictNotice || !!versionTargetId;

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

  const {
    dailyNote: todayDailyNote,
    agendaItems: todayAgendaItems,
    aiContext: todayAiContext,
    digest: todayDigest,
    recap: todayAiRecap,
    recapBusy: todayAiRecapBusy,
    recapError: todayAiRecapError,
    generateRecap: generateTodayAiRecap,
  } = useTodayController({
    view,
    notes: notesWithBody,
    tasks: calendarTaskItems,
    reminders: reminderCenterItems,
    links,
    weekStart: tweaks.weekStart,
    helpers: MN_APP_HELPERS,
    ai: desktopBridge.ai,
  });

  const { nextStoryOrder, uniqueNoteTitle, createRuntimeNoteId, createNote, createNoteFromTemplate, createDailyNote, duplicateNote, updateNote, restoreNoteMetadataSnapshot, undoNoteMetadataEdit, redoNoteMetadataEdit, updateNoteBody, acceptSuggestedConnection, quickCaptureMergeTags, quickCaptureRawMarkdown, quickCaptureAppendBody, saveQuickCapture, addQuickTodayTask, appendToTodayDailyNote, addTodayReflection, addTodayEndDayRecap, updateNoteBodies, applyAiCurrentPageBody, restoreAiCurrentPageBody, openNoteById } = useAppNoteActions({
    MN_APP_HELPERS, MN_APP_MUTATIONS, MN_NOTE_TEMPLATES, aiNoteBodyRestoreRef, calendarTaskItems, cloneNoteForMetadataHistory, markDirty, markTagsDirty, mkBlock, mnBlocksToMd, mnEnsureScenePlotPoints, mnMdToBlocks, mnNormalizeNoteBody, mnNoteOrderValue, mnParseDefaultTags, navigateView, normalizeTagName, noteMetadataHistoryRef, notes, notesWithBody, novelistStructure, recordFeatureUsage, recordNoteMetadataHistory, recordPhase5Metric, reminderCenterItems, selectedNote, setNotes, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setTags, showAppNotice, tags, tweaks, useCallbackA,
  });

  const { updateTaskItemSource, createCalendarTaskItem, snoozeCalendarTaskItem, linkNovelistChapter, linkNovelistScene, setNovelistOrder, renameNoteTitle, convertNovelistType, updateNoteBlocks, toggleCheckFromAggregate, updateWorkflowNoteStatus, updateWorkflowArchived, updateNoteTags, addTag, tagCurrentNoteFromAi, removeTag, removeNovelistSupportingType } = useAppPlanningActions({
    MN_APP_HELPERS, MN_APP_MUTATIONS, markDirty, markTagsDirty, mnBlocksToMd, mnCalendarReminderDateParts, mnCalendarTaskContent, mnCalendarUpdateMarkdownLine, mnCloneBlocks, mnLocate, mnMdToBlocks, mnNormalizeNoteBody, mnNovelEnsureWikiLinkInSection, mnNovelUpsertPropertyLink, mnRemoveBodyProperty, mnReplaceWikiLinkTitle, mnSetBodyProperty, normalizeTagName, notes, notesWithBody, novelistStructure, selectedId, selectedNote, selectedTag, setNotes, setSelectedTag, setTags, tags, updateNote, updateNoteBody, useCallbackA,
  });

  const { promptNewTag, requestDeleteNote, deleteNote, normalizeRuntimeNote, trashItems, trashLoading, trashError, listDeletedItems, refreshDeletedItems, restoreDeletedNote, purgeDeletedNote, prependDeletedItem, restoreNoteVersion, reloadConflictFromDisk, keepConflictAsDuplicate, openCanvasDashboard, openCanvas, createCanvas, saveCanvas, deleteCanvas, addNoteToCanvas, exportBackup, importBackup, analyzeNovelImportFiles, importNovelFiles, applyNovelImportPreview, closeNovelImportDialog, rebuildIndex } = useAppDataActions({
    HAS_DISK, MN_APP_CANVAS_ACTIONS, MN_APP_MUTATIONS, MN_NOTES_VAULTS_SERVICE, MN_NOTES_VAULTS_STATE, MN_NOVEL_IMPORT_TOOL, activeCanvas, activeVault, activeVaultId, addTag, buildNovelImportPlan, canvases, conflictNotice, createRuntimeNoteId, desktopBridge, dirtyNotes, markDirty, markTagsDirty, mnBlocksToMd, mnDirtyNoteKey, mnEnsureNovelistTags, mnMdToBlocks, mnNormalizeNoteBody, mnNovelImportChunks, mnNovelImportConsolidationPrompt, mnNovelImportExistingSummary, mnNovelImportExtractionPrompt, mnNovelImportToolArgs, navigateView, normalizeNotes, normalizeNovelImportCandidates, noteForDisk, notes, notesWithBody, novelImportDialog, novelImportSeq, refreshVaultRegistry, selectedId, setActiveCanvas, setCanvases, setConflictNotice, setDeleteTargetId, setNotes, setNovelImportDialog, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setTags, setVaults, showAppNotice, tags, uniqueNoteTitle, updateDirtyNotes, useCallbackA, useCanvasController, useTrashController, view,
  });

  const { plugins, featureState, runPlugin, appActionRegistry, handleAppActionResult, commands, runNaturalCommand } = useAppCommandActions({
    HAS_DISK, MN_APP_ACTIONS_FACTORY, MN_APP_HELPERS, MN_APP_MUTATIONS, MN_FEATURES, MN_MEMORY_ACTIONS, MN_NOTE_TEMPLATES, MN_PLUGIN_API, activeCanvas, activeVault, activeVaultId, addNoteToCanvas, addTag, appNotice, assistanceEnabled, blockingOverlayOpen, bootState, canvasTextEditing, canvases, clearInterval, closeReferencePane, commandPaletteOpen, conflictNotice, createCanvas, createDailyNote, createNote, createNoteFromTemplate, deleteCanvas, deleteNote, deleteTargetId, desktopBridge, dismissedReminderKeys, duplicateNote, enabledPacks, exportBackup, importBackup, markDirty, mnCollectReminderItems, mnMdToBlocks, mnNormalizeNoteStatus, mnPlayReminderSound, mnReadSnoozedReminders, navigateView, normalizeNotes, normalizeTagName, notesWithBody, notesWithBodyRef, openAskAi, openCanvas, openCanvasDashboard, openReferencePane, openSmartView, quickSwitcherOpen, quietedReminderKeys, rebuildIndex, recordPhase5Metric, referencePaneOpen, reminderCenterOpen, renameNoteTitle, restoreDeletedNote, selectVault, selectedNote, setAppNotice, setCaptureOpen, setCommandPaletteOpen, setConflictNotice, setConnectionsRefreshToken, setDeleteTargetId, setInterval, setNoteListHidden, setNotes, setQuickSwitcherOpen, setReminderCenterOpen, setSelectedId, setSelectedTag, setSelectedWorkflow, setSettingsOpen, setSidebarHidden, setToast, setVaultHealthOpen, setVersionTargetId, settingsOpen, showAppNotice, smartViewDefinitions, titleUpdateTimerRef, toast, toastRef, todayAgendaItems, tweaks, uniqueNoteTitle, updateNote, updateNoteBody, updateWorkflowArchived, updateWorkflowNoteStatus, useAppActionRegistry, useCallbackA, useEffectA, useMemoA, vaultHealthOpen, vaults, vaultsForSidebar, versionTargetId, view, workflowData, workflowStates,
  });

  const noteListVisible = view === 'notes' || view === 'pinned' || view === 'graph' || view === 'workflow';
  const aiChatListVisible = view === 'ai';
  const reminderCenterTop = view === 'ai' ? 17 : 14;
  const noteListTitle = query.trim()
    ? 'Search'
    : selectedTag
    ? `#${selectedTag}`
    : selectedWorkflow
    ? selectedWorkflow
    : (view === 'pinned' ? 'Pinned' : view === 'workflow' ? 'Workflow notes' : view === 'todos' ? 'Todos' : view === 'today' ? 'Today' : 'All notes');
  const noteListSubtitle = query.trim()
    ? `${filteredNotes.length} match${filteredNotes.length === 1 ? '' : 'es'}`
    : view === 'workflow'
    ? `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'} · ${workflowViewData.total} workflow note${workflowViewData.total === 1 ? '' : 's'}`
    : `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'}${selectedTag ? ' tagged' : selectedWorkflow ? ' with workflow' : ''}`;

  // ── Loading / error screens ─────────────────────────────────────────────
  return <AppView model={{ MN_APP_HELPERS, MN_APP_MUTATIONS, MnAiChatHistory, MnAiNotice, MnAppNoticeDialog, MnAskAI, MnCalendarPanel, MnCanvasPanel, MnCommandPalette, MnDeleteNoteDialog, MnEditor, MnGraph, MnLaunchScreen, MnNoteList, MnNovelImportPreviewDialog, MnNovelistPanel, MnPanelGrip, MnPanelGripPeek, MnQuickCapture, MnQuickSwitcher, MnRecentlyDeletedPanel, MnReferencePane, MnReminderCenter, MnReminderToast, MnSaveConflictDialog, MnSettingsModal, MnSidebar, MnSmartViewsPanel, MnTodayPanel, MnTodosPanel, MnVaultHealthDialog, MnVersionHistoryDialog, MnWorkflowPanel, SEED_NOTES, SEED_TAGS, SEED_VAULTS, T, acceptSuggestedConnection, activeAskAiSession, activeCanvas, activeSmartViewId, activeVault, activeVaultId, addNoteToCanvas, addQuickTodayTask, addTag, addTodayEndDayRecap, addTodayReflection, aiChatListVisible, aiNoteBodyRestoreRef, aiNotice, analyzeNovelImportFiles, appActionRegistry, appNotice, appStats, appendToTodayDailyNote, applyAiCurrentPageBody, applyLinkedNoteUpdates, applyNovelImportPreview, applyWorkflowStates, archiveAskAiChat, askAiSeed, askAiSessions, assistanceEnabled, baseThemeMap, blockingOverlayOpen, bootError, bootState, buildLinks, calendarActionItems, calendarTaskItems, canvasTextEditing, canvases, captureOpen, cloneNoteForMetadataHistory, closeNovelImportDialog, closeReferencePane, commandPaletteOpen, commands, conflictNotice, connectionsRefreshToken, convertNovelistType, createAskAiChat, createCalendarTaskItem, createCanvas, createDailyNote, createNote, createNoteFromTemplate, createRuntimeNoteId, createVault, customThemes, deleteAskAiChat, deleteCanvas, deleteNote, deleteTargetId, deleteTargetNote, deleteVault, dirtyMissingWarnedRef, dirtyNotes, dirtyNotesRef, dirtyRevisionRef, dismissedReminderKeys, duplicateNote, enabledPacks, endNoteMetadataEdit, exportBackup, featureState, filteredNotes, findNotesForVault, fontMap, fonts, generateTodayAiRecap, goBackView, graphFilter, graphVisibleNotes, handleAppActionResult, importBackup, importNovelFiles, importThemeFile, keepConflictAsDuplicate, linkNovelistChapter, linkNovelistScene, links, listDeletedItems, loadVaultBundle, markDirty, markTagsDirty, mkBlock, mnBlocksToMd, mnBodyPropertyValue, mnCloneBlocks, mnLocate, mnMdToBlocks, mnNormalizeNoteBody, mnNormalizeNoteStatus, mnShadow, mnWalk, mnWriteSnoozedReminder, navigateView, nextStoryOrder, normalWorkflowStates, normalizeFeaturePacks, normalizeRuntimeNote, noteDiskStampRef, noteListHidden, noteListSubtitle, noteListTitle, noteListVisible, noteMetadataHistoryRef, notes, notesRef, notesWithBody, notesWithBodyCacheRef, notesWithBodyRef, notifyAskAiComplete, novelImportDialog, novelImportSeq, novelistNotes, novelistStructure, novelistWorkflowStates, openAskAi, openCanvas, openCanvasDashboard, openNoteById, openReferencePane, openSmartView, pendingDirtyKeysRef, persistNovelistSetup, plugins, prependDeletedItem, promptNewTag, purgeDeletedNote, query, quickCaptureAppendBody, quickCaptureMergeTags, quickCaptureRawMarkdown, quickSwitcherOpen, quietedReminderKeys, rebuildIndex, recentNoteIds, recordFeatureUsage, recordNoteMetadataHistory, recordPhase5Metric, redoNoteMetadataEdit, referenceNote, referenceNoteId, referencePaneOpen, refreshDeletedItems, refreshVaultRegistry, reloadConflictFromDisk, reminderCenterItems, reminderCenterOpen, reminderCenterTop, reminderDueCount, removeNovelistSupportingType, removeTag, renameAskAiChat, renameNoteTitle, renameVault, requestDeleteNote, restoreAiCurrentPageBody, restoreDeletedNote, restoreNoteMetadataSnapshot, restoreNoteVersion, runNaturalCommand, runPlugin, saveCanvas, saveDirtyNotesNow, saveQuickCapture, saveVaultMetaNow, savedSmartViews, savingDirtyKeysRef, searchUsageActiveRef, selectReferenceNote, selectVault, selectedId, selectedNote, selectedTag, selectedWorkflow, setActiveAskAiSession, setActiveAskAiSessionId, setActiveCanvas, setActiveSmartViewId, setActiveVaultId, setActiveVaultNovelistMode, setAiNotice, setAppNotice, setAssistanceEnabled, setCanvasTextEditing, setCanvases, setCaptureOpen, setCommandPaletteOpen, setConflictNotice, setConnectionsRefreshToken, setCustomThemes, setDeleteTargetId, setDirtyNotes, setEnabledPacks, setGraphFilter, setNoteListHidden, setNotes, setNovelImportDialog, setNovelistOrder, setPackEnabled, setQuery, setQuickSwitcherOpen, setRecentNoteIds, setReferenceNoteListVisible, setReminderCenterOpen, setSavedSmartViews, setSelectedId, setSelectedTag, setSelectedWorkflow, setSettingsOpen, setSidebarHidden, setTags, setToast, setTweak, setTweaks, setVaultHealthOpen, setVaults, setVersionTargetId, setView, settingsOpen, showAppNotice, sidebarHidden, smartViewDefinitions, snoozeCalendarTaskItem, tagCurrentNoteFromAi, tags, tagsDirty, theme, themeMap, themeOptions, titleUpdateTimerRef, toast, toastRef, todayAgendaItems, todayAiContext, todayAiRecap, todayAiRecapBusy, todayAiRecapError, todayDailyNote, todayDigest, toggleCheckFromAggregate, trashError, trashItems, trashLoading, tweakInitialized, tweaks, undoNoteMetadataEdit, uniqueNoteTitle, updateDirtyNotes, updateNote, updateNoteBlocks, updateNoteBodies, updateNoteBody, updateNoteTags, updateNovelistAiConfig, updateTaskItemSource, updateWorkflowArchived, updateWorkflowNoteStatus, updateWorkflowStates, vaultActivationSeq, vaultHealthOpen, vaults, vaultsForSidebar, vaultsRef, versionTargetId, view, workflowData, workflowStates, workflowViewData }} />;
}

export { MnApp };
