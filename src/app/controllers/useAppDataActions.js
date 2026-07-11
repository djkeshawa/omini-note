function useAppDataActions({ HAS_DISK, MN_APP_CANVAS_ACTIONS, MN_APP_MUTATIONS, MN_NOTES_VAULTS_SERVICE, MN_NOTES_VAULTS_STATE, MN_NOVEL_IMPORT_TOOL, activeCanvas, activeVault, activeVaultId, addTag, buildNovelImportPlan, canvases, conflictNotice, createRuntimeNoteId, desktopBridge, dirtyNotes, markDirty, markTagsDirty, mnBlocksToMd, mnDirtyNoteKey, mnEnsureNovelistTags, mnMdToBlocks, mnNormalizeNoteBody, mnNovelImportChunks, mnNovelImportConsolidationPrompt, mnNovelImportExistingSummary, mnNovelImportExtractionPrompt, mnNovelImportToolArgs, navigateView, normalizeNotes, normalizeNovelImportCandidates, noteForDisk, notes, notesWithBody, novelImportDialog, novelImportSeq, refreshVaultRegistry, selectedId, setActiveCanvas, setCanvases, setConflictNotice, setDeleteTargetId, setNotes, setNovelImportDialog, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setTags, setVaults, showAppNotice, tags, uniqueNoteTitle, updateDirtyNotes, useCallbackA, useCanvasController, useTrashController, view }) {
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
        const res = await desktopBridge.notes.restoreNoteVersion(activeVaultId, noteId, versionId);
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
      canvasModel: MN_CANVAS_MODEL,
      newCanvas: MN_CANVAS_MODEL.mnNewCanvas,
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
      if (!desktopBridge.maintenance?.exportBackup) return showAppNotice('Backup unavailable', 'This build does not expose backup export.');
      try {
        const res = await desktopBridge.maintenance.exportBackup({});
        if (!res.ok) throw new Error(res.error);
        if (!res.value?.canceled) showAppNotice('Backup exported', `${res.value.vaultCount || 0} vault${res.value.vaultCount === 1 ? '' : 's'} saved.`, 'info');
      } catch (e) {
        showAppNotice('Could not export backup', e.message || String(e));
      }
    }, [showAppNotice]);
  
    const importBackup = useCallbackA(async () => {
      if (!desktopBridge.maintenance?.importBackup) return showAppNotice('Import unavailable', 'This build does not expose backup import.');
      try {
        const res = await desktopBridge.maintenance.importBackup({ activate: true });
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
      if (!desktopBridge.maintenance?.importNovelFiles) return showAppNotice('Novel import unavailable', 'This build does not expose novel file import.');
      if (!desktopBridge?.ai?.toolPlan) return showAppNotice('AI unavailable', 'Novel import needs AI tool planning to classify structure and support notes.');
      let importSeq = 0;
      try {
        const res = await desktopBridge.maintenance.importNovelFiles({});
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
      if (!activeVaultId || !desktopBridge.search?.rebuildIndex) return;
      try {
        const res = await desktopBridge.search.rebuildIndex(activeVaultId);
        if (!res.ok) throw new Error(res.error);
        showAppNotice('Index rebuilt', `${res.value.indexed || 0} notes indexed.`, 'info');
      } catch (e) {
        showAppNotice('Could not rebuild index', e.message || String(e));
      }
    }, [activeVaultId, showAppNotice]);
  return { promptNewTag, requestDeleteNote, deleteNote, normalizeRuntimeNote, trashItems, trashLoading, trashError, listDeletedItems, refreshDeletedItems, restoreDeletedNote, purgeDeletedNote, prependDeletedItem, restoreNoteVersion, reloadConflictFromDisk, keepConflictAsDuplicate, openCanvasDashboard, openCanvas, createCanvas, saveCanvas, deleteCanvas, addNoteToCanvas, exportBackup, importBackup, analyzeNovelImportFiles, importNovelFiles, applyNovelImportPreview, closeNovelImportDialog, rebuildIndex };
}

export { useAppDataActions };
import MN_CANVAS_MODEL from '../../canvas/canvasModel.js';
