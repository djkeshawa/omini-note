// Main App — composes sidebar, note list, editor, panels, overlays.
// Disk-backed through the renderer platform adapter. Falls back to in-memory
// seed when running outside Electron (e.g. opened directly in a browser).

import { ReferencePane as MnReferencePane, useReferencePaneController } from '../features/reference/index.js';
import { useAiSessionsController } from '../features/ai/index.js';
import { useSearchController } from '../features/search/index.js';
import { useCanvasController } from '../features/canvas/index.js';
import { useNavigationController } from '../features/navigation/index.js';
import { useOverlayController } from '../features/overlays/index.js';
import { useTrashController } from '../features/trash/index.js';
import { useBootController } from '../features/boot/index.js';
import { useTodayController } from '../features/today/index.js';
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
} from '../features/writer/index.js';
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

const MN_APP_SHELL = window.MN_APP_SHELL || {};
const MN_PANEL_COMPONENTS = window.MN_PANEL_COMPONENTS || {};
const MN_NOTES_VAULTS_SERVICE = window.MN_NOTES_VAULTS_SERVICE || {};
const MN_VAULTS_SERVICE = window.MN_VAULTS_SERVICE || {};
const MN_NOTES_VAULTS_STATE = window.MN_NOTES_VAULTS_STATE || {};
const MN_MEMORY_ACTIONS = window.MN_MEMORY_ACTIONS || {};
const {
  HAS_DISK = hasDesktopBridge(),
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
const MnQuickSwitcher = window.MnQuickSwitcher;
const MN_QUICK_SWITCHER_MODEL = window.MN_QUICK_SWITCHER_MODEL || {};
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

  const recordPhase5Metric = useCallbackA((key, details = {}) => {
    if (!MN_APP_HELPERS?.phase5RecordMetric) return null;
    try {
      const next = MN_APP_HELPERS.phase5RecordMetric(mnReadLocalPhase5Metrics(), key, details);
      mnWriteLocalPhase5Metrics(next);
      if (desktopBridge?.recordPhase5Metric) {
        desktopBridge.recordPhase5Metric(key, details).catch(e => console.warn('recordPhase5Metric failed', e));
      }
      return next;
    } catch (e) {
      console.warn('Local Phase 5 metric ignored', e);
      return null;
    }
  }, []);

  const {
    seed: askAiSeed,
    sessions: askAiSessions,
    activeSession: activeAskAiSession,
    notice: aiNotice,
    setNotice: setAiNotice,
    setActiveSessionId: setActiveAskAiSessionId,
    open: openAskAi,
    updateActiveSession: setActiveAskAiSession,
    createChat: createAskAiChat,
    deleteChat: deleteAskAiChat,
    renameChat: renameAskAiChat,
    archiveChat: archiveAskAiChat,
    notifyComplete: notifyAskAiComplete,
  } = useAiSessionsController({
    view,
    navigateView,
    createSession: mnNewAskAiSession,
    sessionTitle: mnAskAiSessionTitle,
    pickActiveSession: mnPickActiveAskAiSession,
  });

  // dirtyNotes is keyed by vault+note so same-title novelist starter notes in
  // different vaults cannot overwrite each other's pending saves.
  const [dirtyNotes, setDirtyNotes] = useStateA(() => new Map());
  const dirtyNotesRef = useRefA(dirtyNotes);
  const updateDirtyNotes = useCallbackA((updater) => {
    const current = dirtyNotesRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (!(next instanceof Map) || next === current) return current;
    dirtyNotesRef.current = next;
    setDirtyNotes(next);
    return next;
  }, []);

  const recordFeatureUsage = useCallbackA((feature, action = 'used') => {
    if (!desktopBridge?.featureUsage?.record) return;
    desktopBridge.featureUsage.record(feature, action)
      .catch(error => console.warn('Feature usage event ignored', error));
  }, []);

  const setPackEnabled = useCallbackA((packId, enabled) => {
    setEnabledPacks(current => {
      const next = MN_FEATURES.togglePack
        ? MN_FEATURES.togglePack(current, packId, enabled)
        : current;
      if (HAS_DISK && desktopBridge?.setPrefs) {
        desktopBridge.setPrefs({ enabledPacks: next })
          .then(result => {
            if (result?.ok === false) showAppNotice('Pack setting not saved', result.error, 'warn');
          })
          .catch(error => showAppNotice('Pack setting not saved', error.message || String(error), 'warn'));
      }
      const usageFeature = packId === 'labs' ? 'smart_views' : packId;
      recordFeatureUsage(usageFeature, enabled ? 'enabled' : 'disabled');
      return next;
    });
  }, [recordFeatureUsage, showAppNotice]);

  useEffectA(() => {
    const featureByView = {
      today: 'today',
      ai: 'ask_ai',
      canvas: 'canvas',
      graph: 'graph',
      'smart-views': 'smart_views',
      workflow: 'planning',
      calendar: 'planning',
      novelist: 'writer',
    };
    const feature = featureByView[view];
    if (feature) recordFeatureUsage(feature, 'opened');
  }, [view, recordFeatureUsage]);

  useEffectA(() => {
    if (captureOpen) recordFeatureUsage('capture', 'opened');
  }, [captureOpen, recordFeatureUsage]);

  const searchUsageActiveRef = useRefA(false);
  useEffectA(() => {
    const active = Boolean(query.trim());
    if (active && !searchUsageActiveRef.current) recordFeatureUsage('search', 'used');
    searchUsageActiveRef.current = active;
  }, [query, recordFeatureUsage]);
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
    updateDirtyNotes(s => {
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
  }, [activeVaultId, updateDirtyNotes]);
  const tagsDirty = useRefA(false);
  const markTagsDirty = useCallbackA(() => { tagsDirty.current = true; }, []);

  const saveVaultMetaNow = useCallbackA(async (
    vaultId = activeVaultId,
    nextTags = tags,
    nextSelectedId = selectedId,
    forceTags = false
  ) => {
    if (!HAS_DISK || !vaultId) return { ok: true, skipped: true };
    const patch = {};
    if (forceTags || tagsDirty.current) patch.tags = nextTags;
    if (nextSelectedId) patch.lastSelectedId = nextSelectedId;
    if (!Object.keys(patch).length) return { ok: true, skipped: true };
    try {
      const res = await desktopBridge.saveVaultMeta(vaultId, patch);
      if (res?.ok === false) throw new Error(res.error || 'Save failed');
      if (patch.tags && vaultId === activeVaultId) tagsDirty.current = false;
      return { ok: true };
    } catch (e) {
      console.error('saveVaultMeta failed', e);
      showAppNotice('Could not save vault settings', e.message || String(e), 'warn');
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, tags, selectedId, showAppNotice]);

  const loadVaultBundle = useCallbackA(async (vaultId) => {
    const vaultRes = await MN_NOTES_VAULTS_SERVICE.loadVault(desktopBridge, vaultId);
    if (!vaultRes.ok) throw new Error(vaultRes.error);
    const vault = vaultRes.value || vaultRes.data?.vault;
    if (Array.isArray(vault.warnings) && vault.warnings.length) {
      showAppNotice('Vault loaded with warnings', `${vault.warnings.length} note file${vault.warnings.length === 1 ? '' : 's'} could not be read.`, 'warn');
    }
    let loadedCanvases = [];
    try {
      const canvasRes = await desktopBridge.listCanvases(vaultId);
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
  const normalizeFeaturePacks = useCallbackA(
    value => MN_FEATURES.normalizePacks ? MN_FEATURES.normalizePacks(value) : [],
    []
  );
  const applyWorkflowStates = useCallbackA(
    value => window.MN_LOGSEQ?.setWorkflowStates?.(value),
    []
  );
  const { state: bootState, error: bootError } = useBootController({
    hasDisk: HAS_DISK,
    platform: desktopBridge,
    notesVaultsService: MN_NOTES_VAULTS_SERVICE,
    seedVaults: SEED_VAULTS,
    seedNotes: SEED_NOTES,
    seedTags: SEED_TAGS,
    defaultTweaks: MN_TWEAK_DEFAULTS,
    novelistWorkflowStates: MN_NOVELIST_WORKFLOW_STATES,
    normalizeNotes,
    markdownToBlocks: mnMdToBlocks,
    normalizePacks: normalizeFeaturePacks,
    normalizeThemes: mnNormalizeCustomThemesForApp,
    sanitizeMetrics: MN_APP_HELPERS?.phase5SanitizeMetrics,
    writeMetrics: mnWriteLocalPhase5Metrics,
    normalizeSmartViews: mnNormalizeSmartViewsForApp,
    normalizeStartupView: mnNormalizeStartupView,
    normalizeWorkflowStates: mnNormalizeWorkflowStatesForApp,
    applyWorkflowStates,
    loadVaultBundle,
    setEnabledPacks,
    setAssistanceEnabled,
    setCustomThemes,
    setSavedSmartViews,
    setTweaks,
    setVaults,
    setActiveVaultId,
    setTags,
    setNotes,
    setCanvases,
    setSelectedId,
    setView,
  });

  useEffectA(() => {
    if (bootState === 'loading') return;
    const splash = document.getElementById('mn-boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    const handle = setTimeout(() => splash.remove(), 240);
    return () => clearTimeout(handle);
  }, [bootState]);

  // ── Persist tweaks ─────────────────────────────────────────────────────
  const tweakInitialized = useRefA(false);
  useEffectA(() => {
    if (!HAS_DISK) return;
    if (!tweakInitialized.current) { tweakInitialized.current = true; return; }
    desktopBridge.setPrefs({ tweaks }).then(res => {
      if (res && res.ok === false) showAppNotice('Settings not saved', res.error || 'Preferences could not be saved.', 'warn');
    }).catch(() => {});
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

  // After a rename, the backend rewrites [[wiki links]] in other notes on
  // disk and returns them; merge those into renderer state so it doesn't go
  // stale and clobber the rewrites on a later autosave. Every affected note
  // gets its disk stamp refreshed — without that, notes the renderer already
  // rewrote itself (renameNoteTitleDrafts marks them dirty) would autosave
  // with a stale expectedModifiedAt and hit a spurious conflict dialog.
  // Dirty notes keep their in-flight edits but get the same title rewrite
  // applied in memory, so their next autosave carries the rename too.
  const applyLinkedNoteUpdates = useCallbackA((vaultId, updatedNotes, rename = null) => {
    if (!vaultId || !Array.isArray(updatedNotes) || !updatedNotes.length) return;
    const incoming = normalizeNotes(updatedNotes, mnMdToBlocks).filter(n => n?.id);
    if (!incoming.length) return;
    for (const n of incoming) {
      const stamp = n.diskModifiedAt || n.modifiedAt;
      if (stamp) noteDiskStampRef.current.set(mnDirtyNoteKey(vaultId, n.id), stamp);
    }
    const byId = new Map(incoming.map(n => [n.id, n]));
    const bodyCtx = {
      normalizeNoteBody: mnNormalizeNoteBody,
      blocksToMd: mnBlocksToMd,
      mdToBlocks: mnMdToBlocks,
    };
    const mergeList = list => (Array.isArray(list) ? list.map(n => {
      const fresh = byId.get(n.id);
      if (!fresh) return n;
      if (!dirtyNotesRef.current.has(mnDirtyNoteKey(vaultId, n.id))) return fresh;
      // Dirty: keep local edits, but rewrite the renamed title in place.
      if (!rename?.oldTitle || !rename?.newTitle) return n;
      const currentBody = mnNormalizeNoteBody(mnBlocksToMd(n.blocks || []), n.title || 'Untitled');
      const rewritten = mnReplaceWikiLinkTitle(currentBody, rename.oldTitle, rename.newTitle);
      if (rewritten === currentBody) return n;
      return MN_APP_MUTATIONS.applyNoteBodyUpdate(n, rewritten, bodyCtx);
    }) : list);
    if (vaultId === activeVaultId) setNotes(mergeList);
    setVaults(vs => vs.map(v => v.id === vaultId && Array.isArray(v.notes)
      ? { ...v, notes: mergeList(v.notes) }
      : v));
    setConnectionsRefreshToken(t => t + 1);
  }, [activeVaultId, mnMdToBlocks]);

  const saveDirtyNotesNow = useCallbackA(async function saveDirtyNotesNowImpl(entries, currentNotes = notesRef.current, currentVaults = vaultsRef.current) {
    const result = { attempted: 0, saved: 0, deferred: 0, failures: [] };
    if (!HAS_DISK || !entries?.length) return result;
    for (const entry of entries) {
      const id = entry?.id;
      const vaultId = entry?.vaultId;
      const revision = entry?.revision;
      if (!id || !vaultId) {
        result.failures.push({ kind: 'note', id: id || null, message: 'Dirty note entry is invalid.' });
        continue;
      }
      result.attempted++;
      const dirtyKey = mnDirtyNoteKey(vaultId, id);
      if (savingDirtyKeysRef.current.has(dirtyKey)) {
        pendingDirtyKeysRef.current.add(dirtyKey);
        result.deferred++;
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
          result.failures.push({ kind: 'note', id, message: 'Dirty note could not be matched to its vault.' });
          continue;
        }
        dirtyMissingWarnedRef.current.delete(dirtyKey);
        const saveOptions = { expectedModifiedAt: n.diskModifiedAt || null };
        saveOptions.expectedModifiedAt = noteDiskStampRef.current.get(dirtyKey) || saveOptions.expectedModifiedAt;
        const expectedModifiedAt = saveOptions.expectedModifiedAt;
        try {
          const res = await MN_NOTES_VAULTS_SERVICE.saveNote(
            desktopBridge,
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
              result.failures.push({ kind: 'note', id, code: 'NOTE_CONFLICT', message: res.error || 'The note changed on disk.' });
              continue;
            }
            throw new Error(res.error || 'Save failed');
          }
          const saved = res?.value;
          if (Array.isArray(res?.linkedNoteUpdates) && res.linkedNoteUpdates.length) {
            applyLinkedNoteUpdates(vaultId, res.linkedNoteUpdates, res.linkedNoteRename || null);
          }
          if (saved?.diskModifiedAt || saved?.modifiedAt) {
            const diskModifiedAt = saved.diskModifiedAt || saved.modifiedAt;
            noteDiskStampRef.current.set(dirtyKey, diskModifiedAt);
            const updateDiskStamp = notesList => MN_NOTES_VAULTS_STATE.updateNoteDiskStamp(notesList, id, diskModifiedAt);
            if (vaultId === activeVaultId) setNotes(updateDiskStamp);
            setVaults(vs => vs.map(v => v.id === vaultId && Array.isArray(v.notes)
              ? { ...v, notes: updateDiskStamp(v.notes) }
              : v));
          }
          updateDirtyNotes(cur => {
            const current = cur.get(dirtyKey);
            if (!current || current.vaultId !== vaultId) return cur;
            if (revision != null && current.revision !== revision) return cur;
            const next = new Map(cur);
            next.delete(dirtyKey);
            return next;
          });
          result.saved++;
        } catch (e) {
          console.error('saveNote failed', id, e);
          showAppNotice('Could not save note', e.message || String(e));
          result.failures.push({ kind: 'note', id, code: e.code || null, message: e.message || String(e) });
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
    return result;
  }, [findNotesForVault, activeVaultId, showAppNotice, applyLinkedNoteUpdates, updateDirtyNotes]);

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
    if (!HAS_DISK || !desktopBridge?.onFlushDirtyNotes) return undefined;
    return desktopBridge.onFlushDirtyNotes(async () => {
      const entries = [...dirtyNotesRef.current.values()];
      const noteResult = entries.length ? await saveDirtyNotesNow(entries) : { failures: [], deferred: 0 };
      const metaResult = await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
      const failures = [...(noteResult.failures || [])];
      if (noteResult.deferred) {
        failures.push({ kind: 'note', message: `${noteResult.deferred} save operation${noteResult.deferred === 1 ? ' is' : 's are'} still in progress.` });
      }
      if (metaResult?.ok === false) failures.push({ kind: 'metadata', message: metaResult.error || 'Vault settings were not saved.' });
      const dirtyRemaining = dirtyNotesRef.current.size;
      const metaDirty = tagsDirty.current;
      return {
        ok: failures.length === 0 && dirtyRemaining === 0 && !metaDirty,
        dirtyRemaining,
        metaDirty,
        failures,
      };
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
      const res = await MN_NOTES_VAULTS_SERVICE.listVaults(desktopBridge);
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

      updateDirtyNotes(cur => {
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
        setActiveVaultId(nextActiveId);
        tagsDirty.current = false;
        if (activeChanged) {
          setActiveCanvas(null);
          setSelectedId(activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null);
          setSelectedTag(null);
          setSelectedWorkflow(null);
          setQuery('');
          navigateView('notes');
          desktopBridge.setPrefs({ activeVaultId: nextActiveId });
        } else {
          // Same-vault reload: keep the current selection unless the note vanished
          // from disk (e.g. deleted externally), then fall back like a vault switch.
          setSelectedId(current =>
            current && activeBundle.notes.some(n => n.id === current)
              ? current
              : (activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null)
          );
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

  useEffectA(() => {
    if (!HAS_DISK || bootState !== 'ready' || !desktopBridge?.onVaultFilesChanged) return undefined;
    return desktopBridge.onVaultFilesChanged(event => {
      if (!event?.vaultId) return;
      const activeHasDirtyNotes = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
      if (event.vaultId === activeVaultId && (activeHasDirtyNotes || tagsDirty.current)) {
        showAppNotice(
          'File changed outside VispNote',
          'Your unsaved edits are still open. Save them to review the conflict, or reopen the vault to use the disk version.',
          'warn'
        );
        return;
      }
      refreshVaultRegistry({
        reloadActive: event.vaultId === activeVaultId,
        reason: 'external-file-change',
      });
    });
  }, [bootState, dirtyNotes, activeVaultId, refreshVaultRegistry, showAppNotice]);

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

  const setTweak = useCallbackA((key, val) => {
    setTweaks(t => {
      const next = { ...t, [key]: val };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
      return next;
    });
  }, []);

  const importThemeFile = useCallbackA(async () => {
    if (!desktopBridge?.importThemeFile) {
      const error = 'This build does not expose theme import.';
      showAppNotice('Theme import unavailable', error, 'warn');
      return { ok: false, error };
    }
    try {
      const res = await desktopBridge.importThemeFile();
      if (!res?.ok) throw new Error(res?.error || 'Could not install theme.');
      const value = res.value || {};
      if (value.canceled) return { ok: true, canceled: true };
      const nextThemes = mnNormalizeCustomThemesForApp(value.customThemes);
      setCustomThemes(nextThemes);
      if (value.theme?.id) setTweak('theme', value.theme.id);
      recordPhase5Metric('theme_installs', { themeId: value.theme?.id });
      showAppNotice('Theme installed', `${value.theme?.name || 'Theme'} is ready.`, 'info');
      return { ok: true, canceled: false, theme: value.theme };
    } catch (e) {
      const error = e.message || String(e);
      showAppNotice('Could not install theme', error);
      return { ok: false, error };
    }
  }, [recordPhase5Metric, showAppNotice]);

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
        const res = await MN_NOTES_VAULTS_SERVICE.loadVault(desktopBridge, id);
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
        const res = await desktopBridge.listCanvases(id);
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
    setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
    if (HAS_DISK) {
      const selected = await MN_VAULTS_SERVICE.selectVault(desktopBridge, id);
      if (!selected.ok) desktopBridge.setPrefs({ activeVaultId: id });
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
      await desktopBridge.saveVaultMeta(vaultId, { tags: nextTags, novelistMode: true, workflowStates: nextWorkflowStates });
      for (const note of nextNotes) {
        const res = await MN_NOTES_VAULTS_SERVICE.saveNote(desktopBridge, vaultId, noteForDisk(note, mnBlocksToMd));
        if (!res.ok) throw new Error(res.error);
      }
    }
    return { notes: nextNotes, tags: nextTags, workflowStates: nextWorkflowStates };
  };

  const createVault = useCallbackA(async (name, options = {}) => {
    const activationSeq = ++vaultActivationSeq.current;
    const onboardingMode = mnNormalizeOnboardingMode(options.onboardingMode || options.mode);
    const vaultType = options.type === 'novelist' || onboardingMode === 'writer' ? 'novelist' : 'notes';
    const pendingForCurrentVault = [...dirtyNotes.values()].filter(entry => entry.vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    if (!HAS_DISK) {
      // In-browser fallback (transient)
      const id = 'v_' + Date.now();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const firstNoteId = 'n_' + Date.now();
      const isNovelistVault = vaultType === 'novelist';
      const fallbackTitle = onboardingMode === 'daily'
        ? 'Daily planner welcome'
        : onboardingMode === 'researcher'
          ? 'Research workspace welcome'
          : 'Welcome to ' + name;
      const fallbackBody = onboardingMode
        ? `# ${fallbackTitle}\n\n- This vault was created with ${onboardingMode} onboarding\n- Create notes with ⌘N`
        : `- This is your new vault\n- Create notes with ⌘N`;
      const newNotes = isNovelistVault ? mnBuildNovelistStarterNotes([], mnMdToBlocks, id).slice(0, 3) : [{
        id: firstNoteId,
        title: fallbackTitle,
        date: new Date().toISOString(),
        tags: onboardingMode === 'daily' ? ['daily'] : onboardingMode === 'researcher' ? ['research'] : [],
        pinned: false,
        body: fallbackBody,
        blocks: mnMdToBlocks(fallbackBody),
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
      setActiveVaultId(id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      if (onboardingMode) recordPhase5Metric('onboarding_mode_selections', { onboardingMode });
      return;
    }
    try {
      const res = await MN_VAULTS_SERVICE.createVault(desktopBridge, name, {
        type: vaultType,
        onboardingMode: onboardingMode || null,
        workflowStates: vaultType === 'novelist' ? MN_NOVELIST_WORKFLOW_STATES : null,
      });
      if (!res.ok) throw new Error(res.error);
      const v = res.value;

      // Load first, then switch atomically. This prevents the previous vault's
      // notes from appearing under the newly-created vault if disk IO is slow.
      const loadRes = await MN_NOTES_VAULTS_SERVICE.loadVault(desktopBridge, v.id);
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
      setSelectedId(loaded.lastSelectedId || loadedNotes[0]?.id || null);
      setActiveVaultId(v.id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      setQuery('');
      setVaults(vs => [
        ...vs
          .filter(x => x.id !== v.id)
          .map(x => x.id === activeVaultId ? { ...x, notes, tags, lastSelectedId: selectedId, canvases } : x),
        { ...v, notes: loadedNotes, tags: loadedTags, lastSelectedId: loaded.lastSelectedId || loadedNotes[0]?.id || null, canvases: [], workflowStates: loaded.workflowStates || null, novelistAiConfig: loaded.novelistAiConfig || null, novelistMode: vaultType === 'novelist' },
      ]);
      const selected = await MN_VAULTS_SERVICE.selectVault(desktopBridge, v.id);
      if (!selected.ok) desktopBridge.setPrefs({ activeVaultId: v.id });
      if (onboardingMode) recordPhase5Metric('onboarding_mode_selections', { onboardingMode });
    } catch (e) {
      console.error('createVault failed', e);
      showAppNotice('Could not create vault', e.message || String(e));
      await refreshVaultRegistry({ reloadActive: false, reason: 'createVault-failed' });
    }
  }, [activeVaultId, notes, vaults, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks, mnBlocksToMd, recordPhase5Metric, showAppNotice, refreshVaultRegistry]);

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
      if (HAS_DISK) await desktopBridge.saveVaultMeta(activeVaultId, { novelistMode: false, workflowStates: null });
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
        const res = await MN_VAULTS_SERVICE.renameVault(desktopBridge, id, cleanName);
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
        const res = await MN_VAULTS_SERVICE.deleteVault(desktopBridge, id);
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

    updateDirtyNotes(cur => {
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
        const loadRes = await MN_NOTES_VAULTS_SERVICE.loadVault(desktopBridge, nextMeta.id);
        if (!loadRes.ok) throw new Error(loadRes.error);
        const loaded = loadRes.value || loadRes.data?.vault;
        nextNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
        nextTags = loaded.tags || [];
        nextSelectedId = loaded.lastSelectedId || nextNotes[0]?.id || null;
        nextMeta.novelistMode = !!loaded.novelistMode;
        nextMeta.workflowStates = loaded.workflowStates || nextMeta.workflowStates || null;
        nextMeta.novelistAiConfig = loaded.novelistAiConfig || nextMeta.novelistAiConfig || null;
        const canvasRes = await desktopBridge.listCanvases(nextMeta.id);
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
      const selected = await MN_VAULTS_SERVICE.selectVault(desktopBridge, nextMeta.id);
      if (!selected.ok) desktopBridge.setPrefs({ activeVaultId: nextMeta.id });
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

  const acceptSuggestedConnection = useCallbackA((item) => {
    if (!selectedNote?.id || !window.MN_CONNECTIONS_MODEL?.appendConnectionMarkdown) return false;
    const targetId = String(item?.noteId || item?.id || '');
    const target = notesWithBody.find(note => note.id === targetId);
    const title = String(item?.title || target?.title || '').trim();
    if (!title || targetId === selectedNote.id) return false;
    updateNoteBody(selectedNote.id, body => window.MN_CONNECTIONS_MODEL.appendConnectionMarkdown(body, title));
    recordFeatureUsage('connections', 'used');
    showAppNotice('Connection added', `Linked to ${title}.`, 'success');
    return true;
  }, [selectedNote?.id, notesWithBody, updateNoteBody, recordFeatureUsage, showAppNotice]);

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
        recordPhase5Metric('capture_saves', { destinationId: plan.destinationId, templateId: plan.template?.id, mode: 'append' });
        recordFeatureUsage('capture', 'used');
        return plan.noteId;
      }
      const id = createNote({
        title: uniqueNoteTitle(plan.createNote?.title || cleanTitle),
        body: plan.createNote?.body || plan.body || '',
        tags: tagsForCapture,
      });
      recordPhase5Metric('capture_saves', { destinationId: plan.destinationId, templateId: plan.template?.id, mode: 'create' });
      recordFeatureUsage('capture', 'used');
      return id;
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
      recordPhase5Metric('capture_saves', { destinationId: activeDestination.id, mode: 'append' });
      recordFeatureUsage('capture', 'used');
      return activeDestination.noteId;
    }
    const id = createNote({
      title: uniqueNoteTitle(activeDestination?.id === 'new' ? cleanTitle : (activeDestination?.noteTitle || cleanTitle)),
      body: rawBody,
      tags: quickCaptureMergeTags(activeDestination?.tags || [], noteTags),
    });
    recordPhase5Metric('capture_saves', { destinationId: activeDestination?.id || 'new', mode: 'create' });
    recordFeatureUsage('capture', 'used');
    return id;
  }, [createNote, navigateView, notesWithBody, quickCaptureAppendBody, quickCaptureMergeTags, quickCaptureRawMarkdown, recordFeatureUsage, recordPhase5Metric, selectedNote, uniqueNoteTitle, updateNoteBody]);

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
    updateDirtyNotes(cur => {
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
        const res = await MN_NOTES_VAULTS_SERVICE.deleteNote(desktopBridge, activeVaultId, id, noteForDisk(n, mnBlocksToMd));
        if (res && res.ok === false) throw new Error(res.error);
        if (res?.value?.trashId) {
          prependDeletedItem(res.value);
        }
      }
      catch (e) {
        console.error('deleteNote failed', e);
        setNotes(previousNotes);
        setSelectedId(previousSelectedId);
        if (previousDirtyEntry) {
          updateDirtyNotes(cur => {
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

  const {
    items: trashItems,
    loading: trashLoading,
    error: trashError,
    list: listDeletedItems,
    refresh: refreshDeletedItems,
    restore: restoreDeletedNote,
    purge: purgeDeletedNote,
    prepend: prependDeletedItem,
  } = useTrashController({
    activeVaultId,
    view,
    hasDisk: HAS_DISK,
    platform: desktopBridge,
    normalizeNote: normalizeRuntimeNote,
    summarizeCanvas: MN_APP_MUTATIONS.summarizeCanvas,
    upsertCanvasList: MN_APP_MUTATIONS.upsertCanvasList,
    setNotes,
    setVaults,
    setCanvases,
    setActiveCanvas,
    setSelectedId,
    setSelectedTag,
    setSelectedWorkflow,
    navigateView,
    showNotice: showAppNotice,
  });

  const restoreNoteVersion = useCallbackA(async (noteId, versionId) => {
    if (!HAS_DISK || !activeVaultId || !noteId || !versionId) return { ok: false, error: 'No active vault.' };
    try {
      const res = await desktopBridge.restoreNoteVersion(activeVaultId, noteId, versionId);
      if (!res.ok) throw new Error(res.error || 'Could not restore note version');
      const restored = normalizeRuntimeNote(res.value);
      if (!restored) throw new Error('Restored version could not be loaded');
      setNotes(ns => ns.map(n => n.id === restored.id ? restored : n));
      setVaults(vs => vs.map(v => v.id === activeVaultId && Array.isArray(v.notes)
        ? { ...v, notes: v.notes.map(n => n.id === restored.id ? restored : n) }
        : v));
      updateDirtyNotes(cur => {
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
      const res = await MN_NOTES_VAULTS_SERVICE.loadVault(desktopBridge, conflict.vaultId);
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
      updateDirtyNotes(cur => {
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

  const {
    openDashboard: openCanvasDashboard,
    openCanvas,
    createCanvas,
    saveCanvas,
    deleteCanvas,
    addNote: addNoteToCanvas,
  } = useCanvasController({
    activeVaultId,
    activeCanvas,
    canvases,
    notes: notesWithBody,
    hasDisk: HAS_DISK,
    platform: desktopBridge,
    canvasActions: MN_APP_CANVAS_ACTIONS,
    canvasModel: window.MN_CANVAS_MODEL,
    newCanvas: window.mnNewCanvas,
    upsertCanvasList: MN_APP_MUTATIONS.upsertCanvasList,
    setCanvases,
    setVaults,
    setActiveCanvas,
    setSelectedTag,
    setSelectedWorkflow,
    setQuery,
    navigateView,
    showNotice: showAppNotice,
  });

  const exportBackup = useCallbackA(async () => {
    if (!desktopBridge?.exportBackup) return showAppNotice('Backup unavailable', 'This build does not expose backup export.');
    try {
      const res = await desktopBridge.exportBackup({});
      if (!res.ok) throw new Error(res.error);
      if (!res.value?.canceled) showAppNotice('Backup exported', `${res.value.vaultCount || 0} vault${res.value.vaultCount === 1 ? '' : 's'} saved.`, 'info');
    } catch (e) {
      showAppNotice('Could not export backup', e.message || String(e));
    }
  }, [showAppNotice]);

  const importBackup = useCallbackA(async () => {
    if (!desktopBridge?.importBackup) return showAppNotice('Import unavailable', 'This build does not expose backup import.');
    try {
      const res = await desktopBridge.importBackup({ activate: true });
      if (!res.ok) throw new Error(res.error);
      if (res.value?.canceled) return;
      await refreshVaultRegistry({ reloadActive: true, reason: 'import-backup' });
      showAppNotice('Backup imported', `${res.value.importedVaults?.length || 0} vault${res.value.importedVaults?.length === 1 ? '' : 's'} restored.`, 'info');
    } catch (e) {
      showAppNotice('Could not import backup', e.message || String(e));
    }
  }, [refreshVaultRegistry, showAppNotice]);

  const analyzeNovelImportFiles = useCallbackA(async (files, skipped = [], importSeq = 0) => {
    if (!desktopBridge?.ai?.toolPlan) throw new Error('AI tool planning is unavailable in this build.');
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
      const response = await desktopBridge.ai.toolPlan({
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
        const response = await desktopBridge.ai.toolPlan({
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
    if (!desktopBridge?.importNovelFiles) return showAppNotice('Novel import unavailable', 'This build does not expose novel file import.');
    if (!desktopBridge?.ai?.toolPlan) return showAppNotice('AI unavailable', 'Novel import needs AI tool planning to classify structure and support notes.');
    let importSeq = 0;
    try {
      const res = await desktopBridge.importNovelFiles({});
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
    if (!activeVaultId || !desktopBridge?.rebuildIndex) return;
    try {
      const res = await desktopBridge.rebuildIndex(activeVaultId);
      if (!res.ok) throw new Error(res.error);
      showAppNotice('Index rebuilt', `${res.value.indexed || 0} notes indexed.`, 'info');
    } catch (e) {
      showAppNotice('Could not rebuild index', e.message || String(e));
    }
  }, [activeVaultId, showAppNotice]);

  const plugins = useMemoA(() => (MN_PLUGIN_API.normalizeAll ? MN_PLUGIN_API.normalizeAll(tweaks.plugins) : []), [tweaks.plugins]);
  const featureState = useMemoA(() => (
    MN_FEATURES.deriveFeatureState
      ? MN_FEATURES.deriveFeatureState({
        enabledPacks,
        canvasCount: canvases.length,
        novelistMode: !!activeVault?.novelistMode,
        vaults,
        plugins,
        workflowTotal: workflowData.total,
        agendaCount: todayAgendaItems.length,
        assistanceEnabled,
      })
      : {
        showAgenda: false,
        showWorkflow: false,
        showCanvas: canvases.length > 0,
        showWriter: !!activeVault?.novelistMode,
        showAskAi: assistanceEnabled,
        showLabs: false,
      }
  ), [activeVault?.novelistMode, assistanceEnabled, canvases.length, enabledPacks, plugins, vaults, workflowData.total, todayAgendaItems.length]);

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
        if (desktopBridge?.openExternal) {
          const res = await desktopBridge.openExternal(url);
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
      if (!desktopBridge?.zotero?.status) return { ok: false, message: 'Zotero integration is unavailable.' };
      const res = await desktopBridge.zotero.status();
      if (!res.ok) return { ok: false, message: res.error || 'Could not check Zotero.' };
      const reachable = !!res.value?.reachable;
      const message = reachable ? 'Zotero Desktop is reachable.' : (res.value?.error || 'Zotero Desktop is not reachable.');
      showAppNotice(reachable ? 'Zotero ready' : 'Zotero unavailable', message, reachable ? 'info' : 'warn');
      return { ok: reachable, message };
    }
    return { ok: false, message: 'Unsupported plugin type.' };
  }, [createNote, showAppNotice, uniqueNoteTitle]);

  const appActionRegistry = useAppActionRegistry({
    activeCanvas,
    activeVault,
    activeVaultId,
    addNoteToCanvas,
    canvases,
    closeReferencePane,
    createCanvas,
    createDailyNote,
    createNote,
    createNoteFromTemplate,
    deleteCanvas,
    deleteNote,
    duplicateNote,
    exportBackup,
    importBackup,
    markDirty,
    notesWithBody,
    openAskAi,
    openCanvas,
    openCanvasDashboard,
    openReferencePane,
    openSmartView,
    plugins,
    rebuildIndex,
    recordPhase5Metric,
    referencePaneOpen,
    restoreDeletedNote,
    runPlugin,
    selectVault,
    selectedNote,
    smartViewDefinitions,
    uniqueNoteTitle,
    updateNote,
    updateNoteBody,
    updateWorkflowArchived,
    updateWorkflowNoteStatus,
    vaultsForSidebar,
    workflowStates,
    navigateView,
    showAppNotice,
    appActionsFactory: MN_APP_ACTIONS_FACTORY,
    appHelpers: MN_APP_HELPERS,
    appMutations: MN_APP_MUTATIONS,
    hasDisk: HAS_DISK,
    platform: desktopBridge,
    setNotes,
    setSelectedTag,
    setSelectedWorkflow,
    setCaptureOpen,
    setSettingsOpen,
    setVaultHealthOpen,
    normalizeNotes,
    markdownToBlocks: mnMdToBlocks,
    setConnectionsRefreshToken,
    memoryActions: MN_MEMORY_ACTIONS,
    renameNoteTitle,
    setSelectedId,
    addTag,
    normalizeTagName,
    normalizeNoteStatus: mnNormalizeNoteStatus,
    pluginApi: MN_PLUGIN_API,
    noteTemplates: MN_NOTE_TEMPLATES,
  });

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
      // While a real modal (settings, dialogs, capture) is up, only Escape
      // acts — Ctrl+N must not create notes behind it. The palette and quick
      // switcher stay toggleable since their shortcuts also close them.
      const modalBlocksShortcuts = blockingOverlayOpen && !commandPaletteOpen && !quickSwitcherOpen;
      if (modalBlocksShortcuts && key !== 'Escape') return;
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
      } else if (isMod && lowerKey === 'p' && !e.shiftKey) {
        e.preventDefault();
        setQuickSwitcherOpen(v => !v);
      } else if (isMod && e.shiftKey && lowerKey === 'r') {
        e.preventDefault();
        if (referencePaneOpen) closeReferencePane();
        else openReferencePane();
      } else if (isMod && e.shiftKey && isBackslashKey) {
        e.preventDefault(); setNoteListHidden(v => !v);
      } else if (isMod && isBackslashKey && !e.shiftKey) {
        e.preventDefault(); setSidebarHidden(v => !v);
      } else if (e.key === 'Escape') {
        if (commandPaletteOpen || quickSwitcherOpen || settingsOpen || reminderCenterOpen || vaultHealthOpen || appNotice || conflictNotice || versionTargetId || deleteTargetId) {
          e.preventDefault();
          setCommandPaletteOpen(false);
          setQuickSwitcherOpen(false);
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
  }, [appNotice, blockingOverlayOpen, closeReferencePane, commandPaletteOpen, quickSwitcherOpen, conflictNotice, createNote, deleteTargetId, navigateView, openAskAi, openReferencePane, referencePaneOpen, reminderCenterOpen, settingsOpen, vaultHealthOpen, versionTargetId, view]);

  useEffectA(() => {
    if (!toast?.key) return;
    if (blockingOverlayOpen) {
      quietedReminderKeys.current.add(toast.key);
      setToast(null);
      return;
    }
    // While a canvas text box is being edited the toast is hidden, not
    // dismissed — hold the auto-quiet timer so the reminder reappears when
    // editing ends instead of expiring unseen.
    if (canvasTextEditing) return;
    const handle = setTimeout(() => {
      quietedReminderKeys.current.add(toast.key);
      setToast(current => current?.key === toast.key ? null : current);
    }, 9000);
    return () => clearTimeout(handle);
  }, [toast?.key, blockingOverlayOpen, canvasTextEditing]);

  // Runtime reminder scan over @remind directives in the active vault.
  useEffectA(() => {
    if (bootState !== 'ready') return;
    const check = () => {
      if (toastRef.current) return;
      const now = Date.now();
      const today = new Date().toDateString();
      const snoozed = mnReadSnoozedReminders();
      const due = mnCollectReminderItems(notesWithBodyRef.current)
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
    // notesWithBody is read via ref: including it re-ran the full reminder
    // parse on every keystroke and reset the 60s interval so it never fired.
  }, [bootState, tweaks.showOverdue, tweaks.reminderSound, toast?.key]);

  // Push vault + selected note into the OS title bar
  useEffectA(() => {
    if (!HAS_DISK) return;
    const vname = vaults.find(v => v.id === activeVaultId)?.name || 'VispNote';
    const nname = selectedNote?.title;
    const t = [vname, nname].filter(Boolean).join(' — ') || 'VispNote';
    clearTimeout(titleUpdateTimerRef.current);
    titleUpdateTimerRef.current = setTimeout(() => {
      desktopBridge.setTitle(t === 'VispNote' ? t : `${t} — VispNote`);
    }, 80);
    return () => clearTimeout(titleUpdateTimerRef.current);
  }, [activeVaultId, vaults, selectedNote]);

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
              onOpenPinned={() => { navigateView('pinned'); setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); }}
              onOpenSmartViews={() => openSmartView()}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenCanvas={openCanvasDashboard}
              onOpenTrash={() => { navigateView('trash'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenAskAI={HAS_DISK ? openAskAi : null}
              todayActive={view === 'today'}
              pinnedActive={view === 'pinned'}
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
              featureState={featureState}
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
                if (view === 'notes' || view === 'pinned') return;
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
              onAddToCanvas={async (id) => handleAppActionResult(await addNoteToCanvas(id))}
              onOpenReference={openReferencePane}
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

          {(view === 'notes' || view === 'pinned') && selectedNote && (
            <MnEditor
              note={selectedNote} notes={notesWithBody} tags={tags} links={links}
              vaultId={activeVaultId}
              searchQuery={query}
              connectionsRefreshToken={connectionsRefreshToken}
              memoryEnabled={HAS_DISK && plugins.some(plugin => plugin.enabled !== false && plugin.type === 'llm-memory')}
              canvases={canvases}
              onOpenCanvas={openCanvas}
              onCreateCanvas={createCanvas}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onLinkMention={(mentionNoteId) => {
                const title = String(selectedNote?.title || '').trim();
                const target = notesWithBody.find(n => n.id === mentionNoteId);
                if (!title || !target || !MN_APP_MUTATIONS.linkMentionInBody) return false;
                const currentBody = mnNormalizeNoteBody(mnBlocksToMd(target.blocks || []), target.title || 'Untitled');
                const { body, linked } = MN_APP_MUTATIONS.linkMentionInBody(currentBody, title);
                if (!linked) return false;
                setNotes(ns => ns.map(n => n.id === mentionNoteId
                  ? MN_APP_MUTATIONS.applyNoteBodyUpdate(n, body, {
                      normalizeNoteBody: mnNormalizeNoteBody,
                      blocksToMd: mnBlocksToMd,
                      mdToBlocks: mnMdToBlocks,
                    })
                  : n));
                markDirty(mentionNoteId);
                return true;
              }}
              onAcceptSuggestedConnection={acceptSuggestedConnection}
              onIgnoreSuggestedConnection={() => recordFeatureUsage('connections', 'used')}
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
              referencePaneOpen={referencePaneOpen}
              onToggleReferencePane={() => referencePaneOpen ? closeReferencePane() : openReferencePane()}
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

          {(view === 'notes' || view === 'pinned') && referencePaneOpen && (
            <MnReferencePane
              note={referenceNote}
              notes={notesWithBody}
              onSelect={selectReferenceNote}
              onOpenAsMain={(id) => { setSelectedId(id); navigateView('notes'); }}
              onOpenLink={(label) => {
                const cleanTitle = String(label || '').split('|')[0].split('#')[0].trim().toLowerCase();
                const target = notesWithBody.find(note => String(note.title || '').trim().toLowerCase() === cleanTitle);
                if (target) selectReferenceNote(target.id);
              }}
              onClose={closeReferencePane}
              T={T}
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
              staleTasks={todayDigest.staleTodos}
              unlinkedNotes={todayDigest.unlinkedNotes}
              resurfacedNotes={todayDigest.resurfacedNotes}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onOpenOrCreateDailyNote={createDailyNote}
              onAddQuickTask={addQuickTodayTask}
              onAddReflection={addTodayReflection}
              onEndDayRecap={addTodayEndDayRecap}
              todayAiRecap={todayAiRecap}
              todayAiRecapBusy={todayAiRecapBusy}
              todayAiRecapError={todayAiRecapError}
              onGenerateAiRecap={featureState.showAskAi ? generateTodayAiRecap : null}
              onOpenAgenda={featureState.showAgenda ? () => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); } : null}
              onPlanItem={featureState.showAgenda ? () => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); } : null}
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
              notes={notesWithBody}
              onOpenNote={(id) => { setSelectedId(id); navigateView('notes'); }}
              onTextEditingChange={setCanvasTextEditing}
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
        {MnQuickSwitcher && (
          <MnQuickSwitcher
            open={quickSwitcherOpen}
            notes={notes}
            recentIds={recentNoteIds}
            onPick={(id) => openNoteById(id)}
            onCreate={(title) => { createNote({ title }); setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); }}
            onClose={() => setQuickSwitcherOpen(false)}
            T={T}
          />
        )}
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
          toast={blockingOverlayOpen || canvasTextEditing ? null : toast}
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
            onListDeletedNotes={listDeletedItems}
            onRestoreDeletedNote={restoreDeletedNote}
            onPurgeDeletedNote={purgeDeletedNote}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
            onImportThemeFile={importThemeFile}
            onImportNovelFiles={importNovelFiles}
            onOpenVaultHealth={() => setVaultHealthOpen(true)}
            onRebuildIndex={rebuildIndex}
            enabledPacks={enabledPacks}
            featureState={featureState}
            onSetPack={setPackEnabled}
            assistanceEnabled={assistanceEnabled}
            onAssistanceChange={setAssistanceEnabled}
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

export { MnApp };
