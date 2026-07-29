function useAppDataActions({ HAS_DISK, MN_APP_CANVAS_ACTIONS, MN_APP_MUTATIONS, MN_NOTES_VAULTS_SERVICE, MN_NOTES_VAULTS_STATE, MN_NOVEL_IMPORT_TOOL, activeCanvas, activeVault, activeVaultId, addTag, buildNovelImportPlan, canvases, clearNoteDiskState, conflictNotice, createRuntimeNoteId, desktopBridge, dirtyNotes, markDirty, markTagsDirty, markdownImportDialog, mnBlocksToMd, mnDirtyNoteKey, mnEnsureNovelistTags, mnMdToBlocks, mnNormalizeNoteBody, mnNovelImportChunks, mnNovelImportConsolidationPrompt, mnNovelImportExistingSummary, mnNovelImportExtractionPrompt, mnNovelImportToolArgs, navigateView, normalizeNotes, normalizeNovelImportCandidates, noteForDisk, notes, notesWithBody, novelImportDialog, novelImportSeq, refreshVaultRegistry, saveDirtyNotesNow, selectedId, setActiveCanvas, setCanvases, setConflictNotice, setDeleteTargetId, setLastBackupAt, setMarkdownImportDialog, setNotes, setNovelImportDialog, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setTags, setVaults, showAppNotice, tags, uniqueNoteTitle, updateDirtyNotes, useCallbackA, useCanvasController, useRefA, useTrashController, view }) {
  const activeVaultIdRef = useRefA(activeVaultId);
  const versionRestoreSequence = useRefA(0);
  activeVaultIdRef.current = activeVaultId;
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
      const previousSelectedId = selectedId;
      const dirtyKey = mnDirtyNoteKey(activeVaultId, id);
      const previousDirtyEntry = dirtyNotes.get(dirtyKey);
      let rollbackDirtyEntry = previousDirtyEntry;
      let deleteRevision = n.diskRevision ?? null;
      if (HAS_DISK && previousDirtyEntry) {
        const flushResult = await saveDirtyNotesNow([previousDirtyEntry]);
        const savedEntry = flushResult?.savedEntries?.find(entry => entry.vaultId === activeVaultId && entry.id === id);
        if (flushResult?.deferred || flushResult?.failures?.length || !savedEntry) {
          showAppNotice('Could not delete note', 'Save the note successfully before deleting it.');
          return;
        }
        deleteRevision = savedEntry.note?.diskRevision ?? deleteRevision;
        rollbackDirtyEntry = null;
      }
      const rollbackNote = deleteRevision ? { ...n, diskRevision: deleteRevision } : n;
      const originalIndex = notes.findIndex(note => note.id === id);
      const remainingNotes = MN_NOTES_VAULTS_STATE.removeNote(notes, id);
      const optimisticSelectedId = previousSelectedId === id ? (remainingNotes[0]?.id || null) : previousSelectedId;
      setDeleteTargetId(null);
      updateDirtyNotes(cur => {
        if (!cur.has(dirtyKey)) return cur;
        const next = new Map(cur);
        next.delete(dirtyKey);
        return next;
      });
      setNotes(ns => {
        const next = MN_NOTES_VAULTS_STATE.removeNote(ns, id);
        setSelectedId(current => current === id ? optimisticSelectedId : current);
        return next;
      });
      if (HAS_DISK && activeVaultId) {
        try {
          const noteSnapshot = { ...noteForDisk(n, mnBlocksToMd), diskRevision: deleteRevision };
          const res = await MN_NOTES_VAULTS_SERVICE.deleteNote(
            desktopBridge,
            activeVaultId,
            id,
            noteSnapshot,
            { expectedRevision: deleteRevision }
          );
          if (res && res.ok === false) throw new Error(res.error);
          if (res?.value?.trashId) {
            prependDeletedItem(res.value);
          }
          clearNoteDiskState?.(activeVaultId, id);
        }
        catch (e) {
          console.error('deleteNote failed', e);
          setNotes(current => MN_NOTES_VAULTS_STATE.restoreNoteAtIndex(current, rollbackNote, originalIndex));
          setSelectedId(current => (
            previousSelectedId === id && current === optimisticSelectedId ? id : current
          ));
          if (rollbackDirtyEntry) {
            updateDirtyNotes(cur => {
              if (cur.has(dirtyKey)) return cur;
              const next = new Map(cur);
              next.set(dirtyKey, rollbackDirtyEntry);
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
      const requestVaultId = activeVaultId;
      const requestId = ++versionRestoreSequence.current;
      try {
        const res = await desktopBridge.notes.restoreNoteVersion(requestVaultId, noteId, versionId);
        if (!res.ok) throw new Error(res.error || 'Could not restore note version');
        const restored = normalizeRuntimeNote(res.value);
        if (!restored) throw new Error('Restored version could not be loaded');
        if (requestId !== versionRestoreSequence.current) {
          return { ok: true, note: restored, stale: true };
        }
        setVaults(vs => vs.map(v => v.id === requestVaultId && Array.isArray(v.notes)
          ? { ...v, notes: v.notes.map(n => n.id === restored.id ? restored : n) }
          : v));
        updateDirtyNotes(cur => {
          const key = mnDirtyNoteKey(requestVaultId, restored.id);
          if (!cur.has(key)) return cur;
          const next = new Map(cur);
          next.delete(key);
          return next;
        });
        if (requestVaultId === activeVaultIdRef.current && requestId === versionRestoreSequence.current) {
          setNotes(ns => ns.map(n => n.id === restored.id ? restored : n));
          setSelectedId(restored.id);
          navigateView('notes');
        }
        return { ok: true, note: restored };
      } catch (e) {
        console.error('restoreNoteVersion failed', e);
        if (
          requestVaultId === activeVaultIdRef.current &&
          requestId === versionRestoreSequence.current
        ) {
          showAppNotice('Could not restore version', e.message || String(e));
        }
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
        diskRevision: null,
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
        if (!res.value?.canceled) {
          setLastBackupAt?.(res.value.exportedAt || new Date().toISOString());
          showAppNotice('Backup exported', `${res.value.vaultCount || 0} vault${res.value.vaultCount === 1 ? '' : 's'} saved.`, 'info');
          return true;
        }
        return false;
      } catch (e) {
        showAppNotice('Could not export backup', e.message || String(e));
        return false;
      }
    }, [setLastBackupAt, showAppNotice]);
  
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

    const flushDirtyNotesForImport = useCallbackA(async () => {
      if (!dirtyNotes.size || !saveDirtyNotesNow) return;
      const result = await saveDirtyNotesNow([...dirtyNotes.values()]);
      if (result?.deferred) throw new Error('A note is still saving. Wait a moment and try the import again.');
      if (result?.failures?.length) throw new Error('Save the current note before importing Markdown.');
    }, [dirtyNotes, saveDirtyNotesNow]);

    const previewMarkdownImport = useCallbackA(async (sourceType = 'files') => {
      if (!activeVaultId || !desktopBridge.maintenance?.previewMarkdownImport) {
        return showAppNotice('Markdown import unavailable', 'This build does not expose portable Markdown import.');
      }
      try {
        await flushDirtyNotesForImport();
        const res = await desktopBridge.maintenance.previewMarkdownImport({ vaultId: activeVaultId, sourceType });
        if (!res.ok) throw new Error(res.error || 'Could not preview Markdown import.');
        if (res.value?.canceled) return;
        const preview = MN_IMPORT_PREVIEW.normalizeImportPreview(res.value?.preview);
        if (!preview.token || !preview.noteCount) throw new Error('The Markdown import preview was invalid.');
        setMarkdownImportDialog({ phase: 'ready', preview });
      } catch (error) {
        console.error('Markdown import preview failed', error);
        showAppNotice('Could not preview Markdown import', error.message || String(error));
      }
    }, [activeVaultId, flushDirtyNotesForImport, showAppNotice]);

    const applyMarkdownImport = useCallbackA(async () => {
      const preview = markdownImportDialog?.preview;
      if (!preview?.token || !activeVaultId) return;
      setMarkdownImportDialog(current => current ? { ...current, phase: 'applying', error: '' } : current);
      try {
        await flushDirtyNotesForImport();
        const res = await desktopBridge.maintenance.applyMarkdownImport({ vaultId: activeVaultId, token: preview.token });
        if (!res.ok) throw new Error(res.error || 'Could not import Markdown.');
        await refreshVaultRegistry({ reloadActive: true, reason: 'markdown-import' });
        const firstImportedId = res.value?.noteIds?.[0] || null;
        if (firstImportedId) {
          setSelectedId(firstImportedId);
          navigateView('notes');
        }
        setMarkdownImportDialog(null);
        showAppNotice(
          'Markdown imported',
          `${res.value?.imported || 0} note${res.value?.imported === 1 ? '' : 's'} and ${res.value?.attachments || 0} attachment${res.value?.attachments === 1 ? '' : 's'} added.`,
          'info'
        );
      } catch (error) {
        console.error('Markdown import apply failed', error);
        setMarkdownImportDialog(current => current ? { ...current, phase: 'error', error: error.message || String(error) } : current);
      }
    }, [activeVaultId, flushDirtyNotesForImport, markdownImportDialog, navigateView, refreshVaultRegistry, showAppNotice]);

    const closeMarkdownImportDialog = useCallbackA(async () => {
      const token = markdownImportDialog?.preview?.token;
      setMarkdownImportDialog(null);
      if (!token || !desktopBridge.maintenance?.cancelMarkdownImport) return;
      try { await desktopBridge.maintenance.cancelMarkdownImport({ vaultId: activeVaultId, token }); }
      catch (error) { console.warn('Markdown import preview cleanup failed', error); }
    }, [activeVaultId, markdownImportDialog]);
  
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
  return { promptNewTag, requestDeleteNote, deleteNote, normalizeRuntimeNote, trashItems, trashLoading, trashError, listDeletedItems, refreshDeletedItems, restoreDeletedNote, purgeDeletedNote, prependDeletedItem, restoreNoteVersion, reloadConflictFromDisk, keepConflictAsDuplicate, openCanvasDashboard, openCanvas, createCanvas, saveCanvas, deleteCanvas, addNoteToCanvas, exportBackup, importBackup, previewMarkdownImport, applyMarkdownImport, closeMarkdownImportDialog, analyzeNovelImportFiles, importNovelFiles, applyNovelImportPreview, closeNovelImportDialog, rebuildIndex };
}

export { useAppDataActions };
import MN_CANVAS_MODEL from '../../canvas/canvasModel.js';
import MN_IMPORT_PREVIEW from '../../shared/importPreviewModel.js';
