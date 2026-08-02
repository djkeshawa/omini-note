import { matchesShortcut } from '../../platform/shortcuts.js';

function useAppCommandActions({ HAS_DISK, MN_APP_ACTIONS_FACTORY, MN_APP_HELPERS, MN_APP_MUTATIONS, MN_FEATURES, MN_MEMORY_ACTIONS, MN_NOTE_TEMPLATES, MN_PLUGIN_API, activeCanvas, activeVault, activeVaultId, addNoteToCanvas, addTag, appNotice, assistanceEnabled, blockingOverlayOpen, bootState, canvasTextEditing, canvases, clearInterval, closeReferencePane, commandPaletteOpen, conflictNotice, createCanvas, createDailyNote, createNote, createNoteFromTemplate, deleteCanvas, deleteNote, deleteTargetId, desktopBridge, dismissedReminderKeys, duplicateNote, enabledPacks, exportBackup, importBackup, markDirty, mnCollectReminderItems, mnMdToBlocks, mnNormalizeNoteStatus, mnPlayReminderSound, mnReadSnoozedReminders, navigateView, normalizeNotes, normalizeTagName, notesWithBody, notesWithBodyRef, openAskAi, openCanvas, openCanvasDashboard, openReferencePane, quickSwitcherOpen, quietedReminderKeys, rebuildIndex, recordPhase5Metric, referencePaneOpen, reminderCenterOpen, renameNoteTitle, restoreDeletedNote, selectVault, selectedNote, setAppNotice, setCaptureOpen, setCommandPaletteOpen, setConflictNotice, setConnectionsRefreshToken, setDeleteTargetId, setInterval, setNoteListHidden, setNotes, setQuickSwitcherOpen, setReminderCenterOpen, setSelectedId, setSelectedTag, setSelectedWorkflow, setSettingsOpen, setSidebarHidden, setToast, setVaultHealthOpen, setVersionTargetId, settingsOpen, showAppNotice, smartViewDefinitions, titleUpdateTimerRef, toast, toastRef, todayAgendaItems, tweaks, uniqueNoteTitle, updateNote, updateNoteBody, updateWorkflowArchived, updateWorkflowNoteStatus, useAppActionRegistry, useCallbackA, useEffectA, useMemoA, vaultHealthOpen, vaults, vaultsForSidebar, versionTargetId, view, workflowData, workflowStates }) {
  const plugins = useMemoA(() => (MN_PLUGIN_API.normalizeAll ? MN_PLUGIN_API.normalizeAll(tweaks.plugins) : []), [tweaks.plugins]);
  const featureArtifacts = useMemoA(() => (
    MN_FEATURES.detectFeatureArtifacts ? MN_FEATURES.detectFeatureArtifacts(notesWithBody) : {}
  ), [notesWithBody]);
  const featureState = useMemoA(() => (
    MN_FEATURES.deriveFeatureState
      ? MN_FEATURES.deriveFeatureState({
        enabledPacks,
        canvasCount: canvases.length,
        ...featureArtifacts,
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
  ), [activeVault?.novelistMode, assistanceEnabled, canvases.length, enabledPacks, featureArtifacts, plugins, vaults, workflowData.total, todayAgendaItems.length]);

  useEffectA(() => {
    if (!MN_FEATURES.isViewAvailable || MN_FEATURES.isViewAvailable(view, featureState)) return;
    navigateView('notes');
    setSelectedTag(null);
    setSelectedWorkflow(null);
  }, [featureState, navigateView, view]);
  
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
          if (desktopBridge.app?.openExternal) {
            const res = await desktopBridge.app.openExternal(url);
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
        if (!desktopBridge.integrations?.zotero?.status) return { ok: false, message: 'Zotero integration is unavailable.' };
        const res = await desktopBridge.integrations.zotero.status();
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
      featureRegistry: MN_FEATURES,
      featureState,
    });
  
    useEffectA(() => {
      setAppActionRegistry(appActionRegistry);
      return () => {
        clearAppActionRegistry(appActionRegistry);
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
      return appActionRegistry.list({ includeHidden: false })
        .filter(action => !MN_FEATURES.isActionAvailable || MN_FEATURES.isActionAvailable(action.id, featureState))
        .map(action => ({
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
    }, [appActionRegistry, featureState, handleAppActionResult, showAppNotice]);
  
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
        const key = e.key || '';
        // While a real modal (settings, dialogs, capture) is up, only Escape
        // acts — Ctrl+N must not create notes behind it. Both shared-palette
        // modes stay toggleable since their shortcuts also close them.
        const modalBlocksShortcuts = blockingOverlayOpen && !commandPaletteOpen && !quickSwitcherOpen;
        if (modalBlocksShortcuts && key !== 'Escape') return;
        if (matchesShortcut(e, 'quickCapture')) {
          e.preventDefault(); setCaptureOpen(true);
        } else if (matchesShortcut(e, 'newNote')) {
          e.preventDefault(); createNote();
        } else if (matchesShortcut(e, 'graph') && (!MN_FEATURES.isActionAvailable || MN_FEATURES.isActionAvailable('graph', featureState))) {
          e.preventDefault();
          navigateView(view === 'graph' ? 'notes' : 'graph');
          setSelectedTag(null); setSelectedWorkflow(null);
        } else if (matchesShortcut(e, 'askAi') && (!MN_FEATURES.isActionAvailable || MN_FEATURES.isActionAvailable('ask-ai', featureState))) {
          e.preventDefault();
          openAskAi();
        } else if (matchesShortcut(e, 'commandPalette')) {
          e.preventDefault();
          setCommandPaletteOpen(v => !v);
        } else if (matchesShortcut(e, 'quickSwitcher')) {
          e.preventDefault();
          setQuickSwitcherOpen(v => !v);
        } else if (matchesShortcut(e, 'referencePane')) {
          e.preventDefault();
          if (referencePaneOpen) closeReferencePane();
          else openReferencePane();
        } else if (matchesShortcut(e, 'toggleNoteList')) {
          e.preventDefault(); setNoteListHidden(v => !v);
        } else if (matchesShortcut(e, 'toggleSidebar')) {
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
    }, [appNotice, blockingOverlayOpen, closeReferencePane, commandPaletteOpen, quickSwitcherOpen, conflictNotice, createNote, deleteTargetId, featureState, navigateView, openAskAi, openReferencePane, referencePaneOpen, reminderCenterOpen, setNoteListHidden, setSidebarHidden, settingsOpen, vaultHealthOpen, versionTargetId, view]);
  
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
        desktopBridge.app.setTitle(t === 'VispNote' ? t : `${t} — VispNote`);
      }, 80);
      return () => clearTimeout(titleUpdateTimerRef.current);
    }, [activeVaultId, vaults, selectedNote]);
  return { plugins, featureState, runPlugin, appActionRegistry, handleAppActionResult, commands, runNaturalCommand };
}

export { useAppCommandActions };
import { clearAppActionRegistry, setAppActionRegistry } from '../actions/actionRegistryRuntime.js';
