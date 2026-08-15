import LATEST_WRITE_QUEUE from '../../shared/latestWriteQueue.js';

const { createLatestWriteQueue } = LATEST_WRITE_QUEUE;

function useAppPersistenceController({ HAS_DISK, MN_APP_HELPERS, MN_APP_MUTATIONS, MN_AUTOSAVE_DEBOUNCE_MS, MN_AUTOSAVE_MAX_WAIT_MS, MN_FEATURES, MN_NOTES_VAULTS_SERVICE, MN_NOTES_VAULTS_STATE, MN_NOVELIST_WORKFLOW_STATES, MN_TWEAK_DEFAULTS, SEED_NOTES, SEED_TAGS, SEED_VAULTS, activeVaultId, captureOpen, desktopBridge, mnAskAiSessionTitle, mnBlocksToMd, mnDirtyNoteKey, mnMdToBlocks, mnNewAskAiSession, mnNormalizeCustomThemesForApp, mnNormalizeNoteBody, mnNormalizeSmartViewsForApp, mnNormalizeStartupView, mnNormalizeWorkflowStatesForApp, mnPickActiveAskAiSession, mnReadLocalPhase5Metrics, mnReplaceWikiLinkTitle, mnWriteLocalPhase5Metrics, navigateView, normalizeNotes, noteForDisk, notes, query, selectedId, setActiveVaultId, setAssistanceEnabled, setCanvases, setConflictNotice, setConnectionsRefreshToken, setCustomThemes, setEnabledPacks, setLastBackupAt, setNotes, setSavedSmartViews, setSelectedId, setTags, setTweaks, setVaults, setView, showAppNotice, tags, tweaks, useAiSessionsController, useBootController, useCallbackA, useEffectA, useRefA, useStateA, vaults, view }) {
  const recordPhase5Metric = useCallbackA((key, details = {}) => {
      if (!MN_APP_HELPERS?.phase5RecordMetric) return null;
      try {
        const next = MN_APP_HELPERS.phase5RecordMetric(mnReadLocalPhase5Metrics(), key, details);
        mnWriteLocalPhase5Metrics(next);
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
      updateSessionById: updateAskAiSessionById,
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
    const [saveRetries, saveRetryRef] = MN_SAVE_RETRY.useSaveRetries({ useStateA, useRefA, useEffectA });
    const updateDirtyNotes = useCallbackA((updater) => {
      const current = dirtyNotesRef.current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (!(next instanceof Map) || next === current) return current;
      dirtyNotesRef.current = next;
      setDirtyNotes(next);
      return next;
    }, []);
  
    const recordFeatureUsage = useCallbackA((feature, action = 'used') => {
      if (!desktopBridge.integrations?.featureUsage?.record) return;
      desktopBridge.integrations.featureUsage.record(feature, action)
        .catch(error => console.warn('Feature usage event ignored', error));
    }, []);
  
    const setPackEnabled = useCallbackA((packId, enabled) => {
      setEnabledPacks(current => {
        const next = MN_FEATURES.togglePack
          ? MN_FEATURES.togglePack(current, packId, enabled)
          : current;
        if (HAS_DISK && desktopBridge.preferences?.setPrefs) {
          desktopBridge.preferences.setPrefs({ enabledPacks: next })
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

    // Saved views were read at boot and never written back, so every edit was
    // lost on restart. This is the write half. The list is checked here before
    // it is sent because the preference sanitizer *throws* on a bad id, a
    // duplicate, or a 25th definition — a refusal we can explain beats a
    // rejected patch the user never sees.
    const saveSmartViewDefinitions = useCallbackA((next) => {
      const checked = mnViewsCheckSavable(next);
      if (!checked.ok) {
        showAppNotice(
          'Views not saved',
          checked.reason === 'cap'
            ? 'A vault can hold 24 saved views. Delete one before adding another.'
            : 'That view is missing a name or has an id the vault cannot store.',
          'warn'
        );
        return false;
      }
      setSavedSmartViews(checked.definitions);
      if (HAS_DISK && desktopBridge.preferences?.setPrefs) {
        desktopBridge.preferences.setPrefs({ smartViews: checked.definitions })
          .then(result => {
            if (result?.ok === false) showAppNotice('Views not saved', result.error, 'warn');
          })
          .catch(error => showAppNotice('Views not saved', error.message || String(error), 'warn'));
      }
      recordFeatureUsage('views', 'used');
      return true;
    }, [recordFeatureUsage, showAppNotice, setSavedSmartViews]);

    useEffectA(() => {
      const featureByView = {
        today: 'today',
        ai: 'ask_ai',
        canvas: 'canvas',
        graph: 'graph',
        'smart-views': 'smart_views',
      views: 'views',
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
    const noteDiskRevisionRef = useRefA(new Map());
    const savingDirtyKeysRef = useRefA(new Set());
    const pendingDirtyKeysRef = useRefA(new Set());
    const notesRef = useRefA(notes);
    const vaultsRef = useRefA(vaults);
    const dirtyRevisionRef = useRefA(0);
    const dirtyMissingWarnedRef = useRefA(new Set());
    const clearNoteDiskState = useCallbackA((vaultId, noteId) => {
      if (!vaultId || !noteId) return;
      const key = mnDirtyNoteKey(vaultId, noteId);
      noteDiskStampRef.current.delete(key);
      noteDiskRevisionRef.current.delete(key);
    }, []);
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
    const tagsDirtyByVaultRef = useRefA(new Map());
    const tagsRevisionRef = useRefA(0);
    const vaultMetaWriteQueueRef = useRefA(null);
    const activeVaultIdRef = useRefA(activeVaultId);
    if (!vaultMetaWriteQueueRef.current) vaultMetaWriteQueueRef.current = createLatestWriteQueue();
    activeVaultIdRef.current = activeVaultId;
    const markTagsDirty = useCallbackA(() => {
      if (!activeVaultId) return;
      tagsDirtyByVaultRef.current.set(activeVaultId, { revision: ++tagsRevisionRef.current });
      tagsDirty.current = true;
    }, [activeVaultId]);

    useEffectA(() => {
      tagsDirty.current = !!activeVaultId && tagsDirtyByVaultRef.current.has(activeVaultId);
    }, [activeVaultId]);
  
    const saveVaultMetaNow = useCallbackA(async (
      vaultId = activeVaultId,
      nextTags = tags,
      nextSelectedId = selectedId,
      forceTags = false
    ) => {
      if (!HAS_DISK || !vaultId) return { ok: true, skipped: true };
      const dirtyEntry = tagsDirtyByVaultRef.current.get(vaultId);
      const dirtyRevision = dirtyEntry?.revision || 0;
      const patch = {};
      if (forceTags || dirtyEntry) patch.tags = nextTags;
      if (nextSelectedId) patch.lastSelectedId = nextSelectedId;
      if (!Object.keys(patch).length) return { ok: true, skipped: true };
      const queued = await vaultMetaWriteQueueRef.current.enqueue(vaultId, {
        patch,
        dirtyRevision,
      }, async request => {
        try {
          const res = await desktopBridge.vaults.saveVaultMeta(vaultId, request.patch);
          if (res?.ok === false) throw new Error(res.error || 'Save failed');
          if (request.patch.tags) {
            const currentDirty = tagsDirtyByVaultRef.current.get(vaultId);
            if (!currentDirty || currentDirty.revision === request.dirtyRevision) {
              tagsDirtyByVaultRef.current.delete(vaultId);
            }
            if (vaultId === activeVaultIdRef.current) {
              tagsDirty.current = tagsDirtyByVaultRef.current.has(vaultId);
            }
          }
          return { ok: true };
        } catch (e) {
          console.error('saveVaultMeta failed', e);
          if (request.patch.tags && request.dirtyRevision) {
            const currentDirty = tagsDirtyByVaultRef.current.get(vaultId);
            if (!currentDirty || currentDirty.revision < request.dirtyRevision) {
              tagsDirtyByVaultRef.current.set(vaultId, { revision: request.dirtyRevision });
            }
            if (vaultId === activeVaultIdRef.current) tagsDirty.current = true;
          }
          showAppNotice('Could not save vault settings', e.message || String(e), 'warn');
          return { ok: false, error: e.message || String(e) };
        }
      });
      return queued.value;
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
        const canvasRes = await desktopBridge.canvas.listCanvases(vaultId);
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
      value => mnSetWorkflowStates(value),
      []
    );
    const { state: bootState, error: bootError, retry: retryBoot } = useBootController({
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
      setLastBackupAt,
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
      desktopBridge.preferences.setPrefs({ tweaks }).then(res => {
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
      const revisions = new Map(noteDiskRevisionRef.current);
      const remember = (vaultId, noteList) => {
        if (!vaultId || !Array.isArray(noteList)) return;
        noteList.forEach(note => {
          if (note?.id && note.diskModifiedAt) {
            const key = mnDirtyNoteKey(vaultId, note.id);
            stamps.set(key, pickNewerDiskStamp(noteDiskStampRef.current.get(key), note.diskModifiedAt));
          }
          if (note?.id && note.diskRevision) {
            revisions.set(mnDirtyNoteKey(vaultId, note.id), note.diskRevision);
          }
        });
      };
      vaults.forEach(vault => remember(vault.id, vault.notes));
      remember(activeVaultId, notes);
      noteDiskStampRef.current = stamps;
      noteDiskRevisionRef.current = revisions;
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
        if (n.diskRevision) noteDiskRevisionRef.current.set(mnDirtyNoteKey(vaultId, n.id), n.diskRevision);
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
        const localWithDiskState = {
          ...n,
          diskModifiedAt: fresh.diskModifiedAt || fresh.modifiedAt || n.diskModifiedAt,
          diskRevision: fresh.diskRevision || n.diskRevision,
        };
        // Dirty: keep local edits, but rewrite the renamed title in place.
        if (!rename?.oldTitle || !rename?.newTitle) return localWithDiskState;
        const currentBody = mnNormalizeNoteBody(mnBlocksToMd(localWithDiskState.blocks || []), localWithDiskState.title || 'Untitled');
        const rewritten = mnReplaceWikiLinkTitle(currentBody, rename.oldTitle, rename.newTitle);
        if (rewritten === currentBody) return localWithDiskState;
        return MN_APP_MUTATIONS.applyNoteBodyUpdate(localWithDiskState, rewritten, bodyCtx);
      }) : list);
      if (vaultId === activeVaultId) setNotes(mergeList);
      setVaults(vs => vs.map(v => v.id === vaultId && Array.isArray(v.notes)
        ? { ...v, notes: mergeList(v.notes) }
        : v));
      setConnectionsRefreshToken(t => t + 1);
    }, [activeVaultId, mnMdToBlocks]);
  
    const saveDirtyNotesNow = useCallbackA(async function saveDirtyNotesNowImpl(entries, currentNotes = notesRef.current, currentVaults = vaultsRef.current) {
      const result = { attempted: 0, saved: 0, savedEntries: [], deferred: 0, failures: [] };
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
            saveRetryRef.current.clear(dirtyKey); // else the pill pins on 'Retrying' with no timer armed
            continue;
          }
          dirtyMissingWarnedRef.current.delete(dirtyKey);
          const saveOptions = {
            expectedRevision: noteDiskRevisionRef.current.get(dirtyKey) ?? n.diskRevision ?? null,
            expectedModifiedAt: n.diskModifiedAt || null,
          };
          saveOptions.expectedModifiedAt = noteDiskStampRef.current.get(dirtyKey) || saveOptions.expectedModifiedAt;
          const expectedRevision = saveOptions.expectedRevision;
          try {
            const res = await MN_NOTES_VAULTS_SERVICE.saveNote(
              desktopBridge,
              vaultId,
              noteForDisk(n, mnBlocksToMd, { novelistMode: !!(currentVaults || []).find(v => v.id === vaultId)?.novelistMode }),
              saveOptions
            );
            if (res && res.ok === false) {
              if (res.code === 'NOTE_CONFLICT') {
                setConflictNotice({
                  vaultId,
                  noteId: id,
                  title: n.title || 'Untitled',
                  currentRevision: res.currentRevision || null,
                  expectedRevision: res.expectedRevision || expectedRevision,
                  currentModifiedAt: res.currentModifiedAt || null,
                  expectedModifiedAt: res.expectedModifiedAt || saveOptions.expectedModifiedAt,
                });
                saveRetryRef.current.clear(dirtyKey); result.failures.push({ kind: 'note', id, code: 'NOTE_CONFLICT', message: res.error || 'The note changed on disk.' });
                continue;
              }
              throw new Error(res.error || 'Save failed');
            }
            const saved = res?.value;
            if (Array.isArray(res?.linkedNoteUpdates) && res.linkedNoteUpdates.length) {
              applyLinkedNoteUpdates(vaultId, res.linkedNoteUpdates, res.linkedNoteRename || null);
            }
            if (saved?.diskModifiedAt || saved?.modifiedAt || saved?.diskRevision) {
              const diskModifiedAt = saved.diskModifiedAt || saved.modifiedAt;
              if (diskModifiedAt) noteDiskStampRef.current.set(dirtyKey, diskModifiedAt);
              if (saved.diskRevision) noteDiskRevisionRef.current.set(dirtyKey, saved.diskRevision);
              const updateDiskState = notesList => MN_NOTES_VAULTS_STATE.updateNoteDiskState(notesList, id, {
                diskModifiedAt,
                diskRevision: saved.diskRevision || null,
              });
              if (vaultId === activeVaultId) setNotes(updateDiskState);
              setVaults(vs => vs.map(v => v.id === vaultId && Array.isArray(v.notes)
                ? { ...v, notes: updateDiskState(v.notes) }
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
            saveRetryRef.current.clear(dirtyKey); result.saved++; result.savedEntries.push({ vaultId, id, note: saved || null });
          } catch (e) {
            result.failures.push({ kind: 'note', id, code: e.code || null, message: e.message || String(e) });
            saveRetryRef.current.fail(dirtyKey, { error: e, id, vaultId, revision, title: n.title || 'Untitled', notify: showAppNotice, retry: () => { const pending = dirtyNotesRef.current.get(dirtyKey); return pending ? saveDirtyNotesNowImpl([pending], notesRef.current, vaultsRef.current) : saveRetryRef.current.clear(dirtyKey); } });
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
      const handle = setTimeout(async () => { await saveDirtyNotesNow([...dirtyNotes.values()]); }, delay);
      return () => clearTimeout(handle);
    }, [dirtyNotes, saveDirtyNotesNow]);
    useEffectA(() => { saveRetryRef.current.prune(dirtyNotes); }, [dirtyNotes]); // a note that has left the dirty map — deleted, say — must not keep a retry entry: the sidebar takes the worst status across every vault, so one dead entry pins the whole app on "Not saved"
  
    useEffectA(() => {
      if (!HAS_DISK || !desktopBridge.events?.onFlushDirtyNotes) return undefined;
      return desktopBridge.events.onFlushDirtyNotes(async () => {
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
  return { recordPhase5Metric, askAiSeed, askAiSessions, activeAskAiSession, aiNotice, setAiNotice, setActiveAskAiSessionId, openAskAi, setActiveAskAiSession, updateAskAiSessionById, createAskAiChat, deleteAskAiChat, renameAskAiChat, archiveAskAiChat, notifyAskAiComplete, dirtyNotes, setDirtyNotes, dirtyNotesRef, updateDirtyNotes, saveRetries, recordFeatureUsage, setPackEnabled, saveSmartViewDefinitions, searchUsageActiveRef, noteDiskStampRef, noteDiskRevisionRef, clearNoteDiskState, savingDirtyKeysRef, pendingDirtyKeysRef, notesRef, vaultsRef, dirtyRevisionRef, dirtyMissingWarnedRef, vaultActivationSeq, noteMetadataHistoryRef, aiNoteBodyRestoreRef, cloneNoteForMetadataHistory, recordNoteMetadataHistory, endNoteMetadataEdit, markDirty, tagsDirty, markTagsDirty, saveVaultMetaNow, loadVaultBundle, normalizeFeaturePacks, applyWorkflowStates, bootState, bootError, retryBoot, tweakInitialized, findNotesForVault, applyLinkedNoteUpdates, saveDirtyNotesNow };
}

export { useAppPersistenceController };
import { mnSetWorkflowStates } from '../../editor/blockFeatures.jsx';
import { mnViewsCheckSavable } from '../../features/views/index.js';
import MN_SAVE_RETRY from '../../shared/saveRetryPolicy.js';
