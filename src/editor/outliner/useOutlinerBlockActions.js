const { useEffect: useEffectOE } = React;

function useOutlinerBlockActions({ blocks, mnCloneBlocks, noteId, undoStack, redoStack, historyRef, noteIdRef, setBlocks, mnShareBlockTree, contentEditHistoryRef, undoActionRef, redoActionRef, selectionRef, selection, focusIdRef, focusId, useOutlinerKeyboardShortcuts, deleteSelectionRef, keyboardEditActionsRef, zoomBlockRef, moveBlockRef, duplicateBlockRef, deleteBlockRef, mnLocate, mnUpdateBlockContent, changeBlockKind, toggleBlockCollapse, toggleBlockCheck, indentBlock, outdentBlock, mkBlock, splitBlockAt, mnSplitBlock, setFocusId, insertBlocksAt, mnSplitAnnotations, mergeBlockWithPrevious, mnMergeBlockContent, deleteBlock }) {
  const snapshotBlocks = (value = blocks) => mnCloneBlocks(value || []);
  
    useEffectOE(() => {
      undoStack.current = [];
      redoStack.current = [];
      historyRef.current?.clear?.();
    }, [noteId]);
  
    useEffectOE(() => {
      noteIdRef.current = noteId || '';
    }, [noteId]);
  
    const mutate = (fn, options = {}) => {
      setBlocks(prev => {
        if (options.history !== false) {
          const snap = snapshotBlocks(prev);
          if (historyRef.current) {
            historyRef.current.record(snap);
            undoStack.current = historyRef.current.undoStack;
            redoStack.current = historyRef.current.redoStack;
          } else {
            undoStack.current.push(snap);
            if (undoStack.current.length > 80) undoStack.current.shift();
            redoStack.current = [];
          }
        }
        const next = mnCloneBlocks(prev);
        fn(next);
        return mnShareBlockTree ? mnShareBlockTree(prev, next) : next;
      });
    };
  
    const replaceAllBlocks = (nextBlocks, options = {}) => {
      setBlocks(prev => {
        if (options.history !== false) {
          const snap = snapshotBlocks(prev);
          if (historyRef.current) {
            historyRef.current.record(snap);
            undoStack.current = historyRef.current.undoStack;
            redoStack.current = historyRef.current.redoStack;
          } else {
            undoStack.current.push(snap);
            if (undoStack.current.length > 80) undoStack.current.shift();
            redoStack.current = [];
          }
        }
        const next = snapshotBlocks(nextBlocks);
        return mnShareBlockTree ? mnShareBlockTree(prev, next) : next;
      });
    };
  
    const undo = () => {
      if (!undoStack.current.length) return false;
      contentEditHistoryRef.current = { blockId: null, armed: false };
      setBlocks(prev => {
        const prior = historyRef.current
          ? historyRef.current.undo(snapshotBlocks(prev))
          : undoStack.current.pop();
        if (!prior) return prev;
        if (historyRef.current) {
          undoStack.current = historyRef.current.undoStack;
          redoStack.current = historyRef.current.redoStack;
        } else {
          redoStack.current.push(snapshotBlocks(prev));
        }
        return snapshotBlocks(prior);
      });
      return true;
    };
  
    const redo = () => {
      if (!redoStack.current.length) return false;
      contentEditHistoryRef.current = { blockId: null, armed: false };
      setBlocks(prev => {
        const next = historyRef.current
          ? historyRef.current.redo(snapshotBlocks(prev))
          : redoStack.current.pop();
        if (!next) return prev;
        if (historyRef.current) {
          undoStack.current = historyRef.current.undoStack;
          redoStack.current = historyRef.current.redoStack;
        } else {
          undoStack.current.push(snapshotBlocks(prev));
        }
        return snapshotBlocks(next);
      });
      return true;
    };
  
    undoActionRef.current = undo;
    redoActionRef.current = redo;
    selectionRef.current = selection;
    focusIdRef.current = focusId;
  
    useOutlinerKeyboardShortcuts({
      selectionRef,
      focusIdRef,
      deleteSelectionRef,
      keyboardEditActionsRef,
      undoActionRef,
      redoActionRef,
      zoomBlockRef,
      moveBlockRef,
      duplicateBlockRef,
      deleteBlockRef,
    });
  
    const onChange = (id, content) => {
      const grouped = contentEditHistoryRef.current.blockId === id;
      const pushHistory = !grouped || contentEditHistoryRef.current.armed;
      mutate(bs => {
        const loc = mnLocate(bs, id);
        if (loc) mnUpdateBlockContent(loc.block, content);
      }, { history: pushHistory });
      if (grouped) contentEditHistoryRef.current.armed = false;
    };
  
    const onBeginContentEdit = (id) => {
      if (contentEditHistoryRef.current.blockId === id) return;
      contentEditHistoryRef.current = { blockId: id, armed: true };
    };
  
    const onEndContentEdit = (id) => {
      if (contentEditHistoryRef.current.blockId !== id) return;
      contentEditHistoryRef.current = { blockId: null, armed: false };
    };
  
    const onChangeKind = (id, patch) => mutate(bs => changeBlockKind(bs, id, patch, {
      locate: mnLocate,
      updateContent: mnUpdateBlockContent,
    }));
  
    const onToggleCollapse = (id) => mutate(bs => toggleBlockCollapse(bs, id, mnLocate));
    const onToggleCheck = (id) => mutate(bs => toggleBlockCheck(bs, id, mnLocate));
    const onIndent = (id) => mutate(bs => indentBlock(bs, id, mnLocate));
    const onOutdent = (id) => mutate(bs => outdentBlock(bs, id, mnLocate));
  
    const onSplit = (id, cursor, nextProps) => {
      const nb = mkBlock({ ...nextProps });
      mutate(bs => splitBlockAt(bs, id, cursor, nb, { locate: mnLocate, splitBlock: mnSplitBlock }));
      setFocusId(nb.id);
    };
  
    const onInsertBlocksAt = (id, start, end, insertedBlocks) => {
      const firstInserted = insertedBlocks && insertedBlocks[0];
      mutate(bs => insertBlocksAt(bs, id, start, end, insertedBlocks, {
        locate: mnLocate,
        splitAnnotations: mnSplitAnnotations,
        cloneBlocks: mnCloneBlocks,
        createBlock: mkBlock,
      }));
      if (firstInserted) setFocusId(firstInserted.id);
    };
  
    const onMergePrev = (id) => mutate(bs => {
      const nextFocusId = mergeBlockWithPrevious(bs, id, { locate: mnLocate, mergeContent: mnMergeBlockContent });
      if (nextFocusId) setFocusId(nextFocusId);
    });
  
    const onDelete = (id) => mutate(bs => {
      const nextFocusId = deleteBlock(bs, id, mnLocate);
      if (nextFocusId) setFocusId(nextFocusId);
    });
  return { snapshotBlocks, mutate, replaceAllBlocks, undo, redo, onChange, onBeginContentEdit, onEndContentEdit, onChangeKind, onToggleCollapse, onToggleCheck, onIndent, onOutdent, onSplit, onInsertBlocksAt, onMergePrev, onDelete };
}

export { useOutlinerBlockActions };
