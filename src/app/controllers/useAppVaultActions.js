function useAppVaultActions({ HAS_DISK, MN_NOTES_VAULTS_SERVICE, MN_NOVELIST_WORKFLOW_STATES, MN_VAULTS_SERVICE, activeVaultId, canvases, desktopBridge, dirtyNotes, mnBlocksToMd, mnBuildNovelistStarterNotes, mnEnsureNovelistTags, mnEnsureScenePlotPoints, mnMdToBlocks, mnNormalizeNoteBody, mnNormalizeNovelistLegacyBody, mnNormalizeNovelistLegacyTags, mnNormalizeOnboardingMode, mnNormalizeWorkflowStatesForApp, navigateView, normalizeNotes, noteForDisk, notes, recordPhase5Metric, refreshVaultRegistry, saveDirtyNotesNow, saveVaultMetaNow, selectedId, setActiveCanvas, setActiveVaultId, setCanvases, setNotes, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setTags, setVaults, showAppNotice, tags, tagsDirty, updateDirtyNotes, useCallbackA, vaultActivationSeq, vaults, view }) {
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
          const res = await desktopBridge.canvas.listCanvases(id);
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
        if (!selected.ok) desktopBridge.preferences.setPrefs({ activeVaultId: id });
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
        await desktopBridge.vaults.saveVaultMeta(vaultId, { tags: nextTags, novelistMode: true, workflowStates: nextWorkflowStates });
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
        if (!selected.ok) desktopBridge.preferences.setPrefs({ activeVaultId: v.id });
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
        if (HAS_DISK) await desktopBridge.vaults.saveVaultMeta(activeVaultId, { novelistMode: false, workflowStates: null });
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
          const canvasRes = await desktopBridge.canvas.listCanvases(nextMeta.id);
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
        if (!selected.ok) desktopBridge.preferences.setPrefs({ activeVaultId: nextMeta.id });
      }
      return { ok: true };
    }, [activeVaultId, vaults, notes, tags, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks]);
  return { selectVault, persistNovelistSetup, createVault, setActiveVaultNovelistMode, renameVault, deleteVault };
}

export { useAppVaultActions };
