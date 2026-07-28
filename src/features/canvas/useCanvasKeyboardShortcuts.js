const { useEffect } = React;

function useCanvasKeyboardShortcuts({ rootRef, handlersRef, selectedIdsRef, setSpaceDown, modalOpenRef }) {
  useEffect(() => {
      const onKeyDown = async (e) => {
        if (!rootRef.current?.contains(document.activeElement)) return;
        // A modal owns the keyboard while it is up. Without this, the delete
        // dialog's focused button let board shortcuts through behind it.
        if (modalOpenRef?.current) return;
        if (e.code === 'Space') {
          setSpaceDown(true);
          if (e.target === rootRef.current || e.target === document.body) e.preventDefault();
        }
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
        const isMod = e.metaKey || e.ctrlKey;
        const key = (e.key || '').toLowerCase();
        if (isMod && key === 'z') {
          e.preventDefault();
          if (e.shiftKey) handlersRef.current.redoCanvas?.();
          else handlersRef.current.undoCanvas?.();
          return;
        }
        if (isMod && key === 'y') {
          e.preventDefault();
          handlersRef.current.redoCanvas?.();
          return;
        }
        if (!isMod && e.shiftKey && e.code === 'Digit1') {
          e.preventDefault();
          handlersRef.current.fitToScreen?.();
          return;
        }
        const currentSelectedIds = selectedIdsRef.current || [];
        if ((e.key === 'Backspace' || e.key === 'Delete') && currentSelectedIds.length) {
          e.preventDefault();
          handlersRef.current.removeElements?.(currentSelectedIds);
          return;
        }
        if (isMod && key === 'c') {
          e.preventDefault();
          await handlersRef.current.copyElements?.(selectedIdsRef.current || []);
        } else if (isMod && key === 'x') {
          e.preventDefault();
          await handlersRef.current.copyElements?.(selectedIdsRef.current || [], true);
        } else if (isMod && key === 'v') {
          e.preventDefault();
          await handlersRef.current.pasteElements?.();
        }
      };
      const onKeyUp = (e) => {
        if (e.code === 'Space') setSpaceDown(false);
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      };
    }, []);
}

export { useCanvasKeyboardShortcuts };
