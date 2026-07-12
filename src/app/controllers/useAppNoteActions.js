function useAppNoteActions({ MN_APP_HELPERS, MN_APP_MUTATIONS, MN_NOTE_TEMPLATES, aiNoteBodyRestoreRef, calendarTaskItems, cloneNoteForMetadataHistory, markDirty, markTagsDirty, mkBlock, mnBlocksToMd, mnEnsureScenePlotPoints, mnMdToBlocks, mnNormalizeNoteBody, mnNoteOrderValue, mnParseDefaultTags, navigateView, normalizeTagName, noteMetadataHistoryRef, notes, notesWithBody, novelistStructure, recordFeatureUsage, recordNoteMetadataHistory, recordPhase5Metric, reminderCenterItems, selectedNote, setNotes, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setTags, showAppNotice, tags, tweaks, useCallbackA }) {
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
      if (!selectedNote?.id || !connectionsModel.appendConnectionMarkdown) return false;
      const targetId = String(item?.noteId || item?.id || '');
      const target = notesWithBody.find(note => note.id === targetId);
      const title = String(item?.title || target?.title || '').trim();
      if (!title || targetId === selectedNote.id) return false;
      updateNoteBody(selectedNote.id, body => connectionsModel.appendConnectionMarkdown(body, title));
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
  
    const saveQuickCapture = useCallbackA(({ title = '', body = '', tags: noteTags = [], destinationId = 'today', templateId = '' } = {}) => {
      const requestedTitle = String(title || '').trim();
      const destinationOptions = { notes: notesWithBody, currentNote: selectedNote };
      const templateSelected = !!String(templateId || '').trim();
      const destination = MN_APP_HELPERS.captureDestinationById
        ? MN_APP_HELPERS.captureDestinationById(destinationId, destinationOptions)
        : { id: 'new' };
      const activeDestination = destination?.disabled && destination.fallbackDestinationId && MN_APP_HELPERS.captureDestinationById
        ? MN_APP_HELPERS.captureDestinationById(destination.fallbackDestinationId, destinationOptions)
        : destination;
      const cleanTitle = requestedTitle || (!templateSelected && MN_APP_HELPERS.captureTitleFromBody
        ? MN_APP_HELPERS.captureTitleFromBody(body)
        : 'Untitled');
      if (templateSelected && MN_APP_HELPERS.captureBuildSavePlan) {
        const text = String(body || '').trim() || (activeDestination?.id === 'new' ? requestedTitle : '');
        const plan = MN_APP_HELPERS.captureBuildSavePlan({
          destinationId,
          templateId,
          text,
          noteTitle: requestedTitle,
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
  
      const rawBody = activeDestination?.id === 'new'
        ? body
        : quickCaptureRawMarkdown({ title: requestedTitle, body });
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
  return { nextStoryOrder, uniqueNoteTitle, createRuntimeNoteId, createNote, createNoteFromTemplate, createDailyNote, duplicateNote, updateNote, restoreNoteMetadataSnapshot, undoNoteMetadataEdit, redoNoteMetadataEdit, updateNoteBody, acceptSuggestedConnection, quickCaptureMergeTags, quickCaptureRawMarkdown, quickCaptureAppendBody, saveQuickCapture, addQuickTodayTask, appendToTodayDailyNote, addTodayReflection, addTodayEndDayRecap, updateNoteBodies, applyAiCurrentPageBody, restoreAiCurrentPageBody, openNoteById };
}

export { useAppNoteActions };
import connectionsModel from '../../editor/connectionsModel.js';
