function useAppPlanningActions({ MN_APP_HELPERS, MN_APP_MUTATIONS, markDirty, markTagsDirty, mnBlocksToMd, mnCalendarReminderDateParts, mnCalendarTaskContent, mnCalendarUpdateMarkdownLine, mnCloneBlocks, mnLocate, mnMdToBlocks, mnNormalizeNoteBody, mnNovelEnsureWikiLinkInSection, mnNovelUpsertPropertyLink, mnRemoveBodyProperty, mnReplaceWikiLinkTitle, mnSetBodyProperty, normalizeTagName, notes, notesWithBody, novelistStructure, selectedId, selectedNote, selectedTag, setNotes, setSelectedTag, setTags, tags, updateNote, updateNoteBody, useCallbackA }) {
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
  return { updateTaskItemSource, createCalendarTaskItem, snoozeCalendarTaskItem, linkNovelistChapter, linkNovelistScene, setNovelistOrder, renameNoteTitle, convertNovelistType, updateNoteBlocks, toggleCheckFromAggregate, updateWorkflowNoteStatus, updateWorkflowArchived, updateNoteTags, addTag, tagCurrentNoteFromAi, removeTag, removeNovelistSupportingType };
}

export { useAppPlanningActions };
