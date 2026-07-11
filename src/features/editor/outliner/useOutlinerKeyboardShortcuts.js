const { useEffect } = React;

export function useOutlinerKeyboardShortcuts({
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
}) {
  useEffect(() => {
    const onKey = (event) => {
      const isMod = event.metaKey || event.ctrlKey;
      const key = event.key || '';
      const lowerKey = key.toLowerCase();
      const target = event.target;
      const tag = target?.tagName;
      const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      const currentSelection = selectionRef.current;
      const isUndo = isMod && lowerKey === 'z' && !event.shiftKey;
      const isRedo = (isMod && event.shiftKey && lowerKey === 'z') || (isMod && lowerKey === 'y');
      const isCopy = isMod && lowerKey === 'c' && !event.altKey && !event.shiftKey;
      const isCut = isMod && lowerKey === 'x' && !event.altKey && !event.shiftKey;
      const isPaste = isMod && lowerKey === 'v' && !event.altKey && !event.shiftKey;
      const isSelectAll = isMod && lowerKey === 'a' && !event.altKey && !event.shiftKey;
      const isBlockEditCommand = currentSelection?.kind === 'blocks' && (isCopy || isCut || isPaste);
      const isOutlinerSelectAll = isSelectAll && !isFormField;
      const isTextDelete = (key === 'Backspace' || key === 'Delete') && currentSelection?.kind === 'text' && !isMod;
      const isAreaDelete = (key === 'Backspace' || key === 'Delete') && currentSelection?.kind === 'blocks' && !isMod;
      const isBlockZoom = isMod && key === 'Enter';
      const isBlockMoveUp = event.altKey && !isMod && key === 'ArrowUp';
      const isBlockMoveDown = event.altKey && !isMod && key === 'ArrowDown';
      const isBlockDuplicate = isMod && lowerKey === 'd';
      const isBlockDelete = isMod && (key === 'Backspace' || key === 'Delete') && !isFormField;
      const isBlockShortcut = isBlockZoom || isBlockMoveUp || isBlockMoveDown || isBlockDuplicate || isBlockDelete;
      if (!isUndo && !isRedo && !isTextDelete && !isAreaDelete && !isBlockShortcut && !isBlockEditCommand && !isOutlinerSelectAll) return;
      if ((isUndo || isRedo) && isFormField && !target.closest?.('.mn-block-row')) return;
      const insideOutliner = !!target.closest?.('.mn-outliner');
      const activeInsideOutliner = !!document.activeElement?.closest?.('.mn-outliner');
      if ((isTextDelete || isBlockShortcut || isBlockEditCommand || isOutlinerSelectAll) && !insideOutliner && !activeInsideOutliner) return;
      const activeBlockId = () => {
        const selection = selectionRef.current;
        if (selection?.kind === 'blocks' && selection.blockIds?.length) return selection.blockIds[0];
        return focusIdRef.current;
      };
      if (isBlockShortcut && !activeBlockId()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (isTextDelete || isAreaDelete) deleteSelectionRef.current?.();
      else if (isCopy) keyboardEditActionsRef.current?.copySelectedBlocks?.();
      else if (isCut) keyboardEditActionsRef.current?.cutSelectedBlocks?.();
      else if (isPaste) keyboardEditActionsRef.current?.pasteForKeyboard?.();
      else if (isSelectAll) keyboardEditActionsRef.current?.selectAllBlocks?.();
      else if (isUndo) undoActionRef.current?.();
      else if (isRedo) redoActionRef.current?.();
      else if (isBlockZoom) zoomBlockRef.current?.(activeBlockId());
      else if (isBlockMoveUp) moveBlockRef.current?.(activeBlockId(), activeBlockId(), 'up');
      else if (isBlockMoveDown) moveBlockRef.current?.(activeBlockId(), activeBlockId(), 'down');
      else if (isBlockDuplicate) duplicateBlockRef.current?.(activeBlockId());
      else if (isBlockDelete) deleteBlockRef.current?.(activeBlockId());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [deleteBlockRef, deleteSelectionRef, duplicateBlockRef, focusIdRef, keyboardEditActionsRef, moveBlockRef, redoActionRef, selectionRef, undoActionRef, zoomBlockRef]);
}
