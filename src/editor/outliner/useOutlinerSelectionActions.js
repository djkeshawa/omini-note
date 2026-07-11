const { useEffect: useEffectOE } = React;

function useOutlinerSelectionActions({ blocks, mutate, mnWalk, mnCloneBlocks, mnBlocksToMd, mnMdToBlocks, mkBlock, mnIsClipboardBlock, mnReidBlocks, mnNormalizeClipboardMarkdown, mnLooksLikeBlockMarkdown, localClipboardRef, clipboardHandlersRef, selectDragRef, selectionRef, deleteSelectionRef, setSelection, setCtxMenu, setFocusId, focusScopeBlocks }) {
  const orderedBlockIds = (ids, sourceBlocks = blocks) => {
      const wanted = new Set(ids);
      return mnFlatten(sourceBlocks, 0, false)
        .map(x => x.block.id)
        .filter(id => wanted.has(id));
    };
  
    const findPath = (list, id, path = []) => {
      for (const b of list || []) {
        const next = [...path, b];
        if (b.id === id) return next;
        const child = findPath(b.children || [], id, next);
        if (child) return child;
      }
      return null;
    };
  
    const topLevelSelectedIds = (ids, sourceBlocks = blocks) => {
      const selected = new Set(ids);
      return orderedBlockIds(ids, sourceBlocks).filter(id => {
        const path = findPath(sourceBlocks, id) || [];
        return !path.slice(0, -1).some(ancestor => selected.has(ancestor.id));
      });
    };
  
    const blocksForClipboardIds = (ids, sourceBlocks = blocks) => {
      return topLevelSelectedIds(ids, sourceBlocks)
        .map(id => mnLocate(sourceBlocks, id)?.block)
        .filter(Boolean);
    };
  
    const blockClipboardPayload = (blocksToCopy) => {
      const sourceBlocks = mnCloneBlocks(blocksToCopy || []);
      if (!sourceBlocks.length) return null;
      const markdown = mnNormalizeClipboardMarkdown(mnBlocksToMd(sourceBlocks));
      if (!markdown) return null;
      return { sourceBlocks, markdown };
    };
  
    const writeBlocksToClipboard = (blocksToCopy, clipboardData = null) => {
      const payload = blockClipboardPayload(blocksToCopy);
      if (!payload) return false;
      const { sourceBlocks, markdown } = payload;
      if (!clipboardData) return false;
      localClipboardRef.current = sourceBlocks;
      clipboardData.setData('text/plain', markdown);
      clipboardData.setData('text/markdown', markdown);
      clipboardData.setData(MN_BLOCK_CLIPBOARD_TYPE, JSON.stringify(sourceBlocks));
      return true;
    };
  
    const writeBlocksToSystemClipboard = async (blocksToCopy) => {
      const payload = blockClipboardPayload(blocksToCopy);
      if (!payload || !navigator.clipboard?.writeText) return false;
      try {
        await navigator.clipboard.writeText(payload.markdown);
        localClipboardRef.current = payload.sourceBlocks;
        return true;
      } catch (e) {
        return false;
      }
    };
  
    const parseClipboardBlocks = (clipboardData, options = {}) => {
      const allowSingle = options.allowSingle === true;
      const rawBlocks = clipboardData?.getData?.(MN_BLOCK_CLIPBOARD_TYPE);
      if (rawBlocks) {
        try {
          const parsed = JSON.parse(rawBlocks);
          if (Array.isArray(parsed) && parsed.length && parsed.every(mnIsClipboardBlock)) return mnReidBlocks(parsed);
        } catch (e) {}
      }
      const text = mnNormalizeClipboardMarkdown(
        clipboardData?.getData?.('text/markdown') ||
        clipboardData?.getData?.('text/plain') ||
        ''
      );
      if (!text) return [];
      const parsed = mnMdToBlocks(text);
      if (!parsed.length) return [];
      if (allowSingle || parsed.length > 1 || mnLooksLikeBlockMarkdown(text)) return parsed;
      return [];
    };
  
    const insertBlocksAfter = (targetId, insertedBlocks) => {
      if (!insertedBlocks?.length) return;
      const first = insertedBlocks[0];
      mutate(bs => {
        const loc = mnLocate(bs, targetId);
        const blocksToInsert = mnCloneBlocks(insertedBlocks);
        if (!loc) {
          bs.push(...blocksToInsert);
          return;
        }
        loc.arr.splice(loc.idx + 1, 0, ...blocksToInsert);
      });
      setFocusId(first.id);
    };
  
    clipboardHandlersRef.current = {
      blocksForClipboardIds,
      writeBlocksToClipboard,
      deleteSelection,
      parseClipboardBlocks,
      insertBlocksAfter,
      onShowToast,
    };
  
    const contextClipboardIds = (blockId) => {
      if (selection?.kind === 'blocks' && (selection.blockIds || []).includes(blockId)) return selection.blockIds || [];
      return [blockId];
    };
  
    const copyContextBlocks = async (blockId) => {
      const copied = await writeBlocksToSystemClipboard(blocksForClipboardIds(contextClipboardIds(blockId)));
      if (copied) onShowToast && onShowToast('Copied block markdown');
      else onShowToast && onShowToast('Clipboard unavailable');
    };
  
    const cutContextBlocks = async (blockId) => {
      const ids = contextClipboardIds(blockId);
      const copied = await writeBlocksToSystemClipboard(blocksForClipboardIds(ids));
      if (!copied) {
        onShowToast && onShowToast('Clipboard unavailable');
        return;
      }
      if (selection?.kind === 'blocks' && ids.length > 1) deleteSelection();
      else onDelete(blockId);
      onShowToast && onShowToast('Cut block markdown');
    };
  
    const pasteContextBlocksAfter = async (blockId) => {
      let pasted = localClipboardRef.current ? mnReidBlocks(localClipboardRef.current) : [];
      if (!pasted.length) {
        const text = await navigator.clipboard?.readText?.().catch(() => '');
        pasted = mnMdToBlocks(mnNormalizeClipboardMarkdown(text || ''));
      }
      if (!pasted.length) return;
      insertBlocksAfter(blockId, pasted);
      onShowToast && onShowToast(`Pasted ${pasted.length} block${pasted.length === 1 ? '' : 's'}`);
    };
  
    const selectionRectForBlocks = (ids) => {
      const rects = ids
        .map(id => document.querySelector(`.mn-block-row[data-block-id="${CSS.escape(id)}"]`)?.getBoundingClientRect())
        .filter(Boolean);
      if (!rects.length) return null;
      let top = Infinity;
      let left = Infinity;
      let right = -Infinity;
      for (const rect of rects) {
        if (rect.top < top) top = rect.top;
        if (rect.left < left) left = rect.left;
        if (rect.right > right) right = rect.right;
      }
      return { top, left, width: right - left, height: 22 };
    };
  
    const blockIdsInVerticalRange = (startY, endY) => {
      const top = Math.min(startY, endY);
      const bottom = Math.max(startY, endY);
      const rows = [...document.querySelectorAll('.mn-block-row[data-block-id]')];
      const ids = [];
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom >= top && rect.top <= bottom) ids.push(row.dataset.blockId);
      }
      return orderedBlockIds(ids);
    };
  
    const replaceSelectedBlocksWith = (insertedBlocks) => {
      const current = selectionRef.current;
      if (current?.kind !== 'blocks' || !insertedBlocks?.length) return false;
      const first = insertedBlocks[0];
      mutate(bs => {
        const ids = topLevelSelectedIds(current.blockIds || [], bs);
        if (!ids.length) return;
        const selected = new Set(ids);
        const blocksToInsert = mnCloneBlocks(insertedBlocks);
        let inserted = false;
        const replaceSelected = (arr) => {
          for (let i = 0; i < arr.length; i++) {
            if (selected.has(arr[i].id)) {
              if (!inserted) {
                arr.splice(i, 1, ...blocksToInsert);
                inserted = true;
                i += blocksToInsert.length - 1;
              } else {
                arr.splice(i, 1);
                i--;
              }
            } else {
              replaceSelected(arr[i].children || []);
            }
          }
        };
        replaceSelected(bs);
      });
      setSelection(null);
      setFocusId(first.id);
      return true;
    };
  
    keyboardEditActionsRef.current = {
      copySelectedBlocks: async () => {
        const current = selectionRef.current;
        if (current?.kind !== 'blocks') return false;
        const copied = await writeBlocksToSystemClipboard(blocksForClipboardIds(current.blockIds || []));
        if (!copied && document.execCommand?.('copy')) return true;
        if (copied) onShowToast && onShowToast('Copied block markdown');
        else onShowToast && onShowToast('Clipboard unavailable');
        return copied;
      },
      cutSelectedBlocks: async () => {
        const current = selectionRef.current;
        if (current?.kind !== 'blocks') return false;
        const copied = await writeBlocksToSystemClipboard(blocksForClipboardIds(current.blockIds || []));
        if (!copied && document.execCommand?.('cut')) return true;
        if (!copied) {
          onShowToast && onShowToast('Clipboard unavailable');
          return false;
        }
        deleteSelection();
        onShowToast && onShowToast('Cut block markdown');
        return true;
      },
      pasteForKeyboard: async () => {
        let pasted = localClipboardRef.current ? mnReidBlocks(localClipboardRef.current) : [];
        if (!pasted.length) {
          const text = await navigator.clipboard?.readText?.().catch(() => '');
          pasted = mnMdToBlocks(mnNormalizeClipboardMarkdown(text || ''));
        }
        if (!pasted.length) return false;
        const current = selectionRef.current;
        if (current?.kind === 'blocks') replaceSelectedBlocksWith(pasted);
        else insertBlocksAfter(focusIdRef.current, pasted);
        onShowToast && onShowToast(`Pasted ${pasted.length} block${pasted.length === 1 ? '' : 's'}`);
        return true;
      },
      selectAllBlocks: () => {
        const visibleIds = [...document.querySelectorAll('.mn-block-row[data-block-id]')]
          .map(row => row.dataset.blockId)
          .filter(Boolean);
        const allIds = visibleIds.length
          ? orderedBlockIds(visibleIds)
          : mnFlatten(blocks, 0, false).map(x => x.block.id);
        if (!allIds.length) return false;
        setSelection({
          kind: 'blocks',
          blockIds: allIds,
          rect: selectionRectForBlocks(allIds),
        });
        return true;
      },
    };
  
    const beginBlockSelection = (id, e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      selectDragRef.current = { startY: e.clientY, ids: new Set([id]) };
    };
  
    const extendBlockSelection = (id) => {
      if (!selectDragRef.current) return;
      selectDragRef.current.ids.add(id);
    };
  
    useEffectOE(() => {
      const finish = (e) => {
        const drag = selectDragRef.current;
        selectDragRef.current = null;
        if (!drag) return;
        const ids = blockIdsInVerticalRange(drag.startY, e?.clientY ?? drag.startY);
        if (ids.length <= 1) return;
        setSelection({
          kind: 'blocks',
          blockIds: ids,
          rect: selectionRectForBlocks(ids),
        });
      };
      window.addEventListener('mouseup', finish);
      return () => window.removeEventListener('mouseup', finish);
    }, [blocks]);
  
    useEffectOE(() => {
      if (!selection) return;
      const onDown = (e) => {
        if (e.button === 2) return;
        if (e.target.closest?.('.mn-selection-toolbar') || e.target.closest?.('.mn-ai-action-menu')) return;
        setSelection(null);
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [selection]);
  
    useEffectOE(() => {
      const isInsideOutliner = (target) => !!target?.closest?.('.mn-outliner') || !!document.activeElement?.closest?.('.mn-outliner');
      const isFormField = (target) => {
        const tag = target?.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      };
      const onCopy = (e) => {
        const handlers = clipboardHandlersRef.current || {};
        const current = selectionRef.current;
        if (current?.kind !== 'blocks' || !isInsideOutliner(e.target)) return;
        const selectedBlocks = handlers.blocksForClipboardIds?.(current.blockIds || []) || [];
        if (!selectedBlocks.length) return;
        e.preventDefault();
        const copied = handlers.writeBlocksToClipboard?.(selectedBlocks, e.clipboardData);
        if (copied) handlers.onShowToast && handlers.onShowToast('Copied block markdown');
      };
      const onCut = (e) => {
        const handlers = clipboardHandlersRef.current || {};
        const current = selectionRef.current;
        if (current?.kind !== 'blocks' || !isInsideOutliner(e.target)) return;
        const selectedBlocks = handlers.blocksForClipboardIds?.(current.blockIds || []) || [];
        if (!selectedBlocks.length) return;
        e.preventDefault();
        const copied = handlers.writeBlocksToClipboard?.(selectedBlocks, e.clipboardData);
        if (!copied) return;
        handlers.deleteSelection?.();
        handlers.onShowToast && handlers.onShowToast('Cut block markdown');
      };
      const onPaste = (e) => {
        const handlers = clipboardHandlersRef.current || {};
        if (!isInsideOutliner(e.target) || isFormField(e.target)) return;
        const pasted = handlers.parseClipboardBlocks?.(e.clipboardData, { allowSingle: true }) || [];
        if (!pasted.length) return;
        e.preventDefault();
        const current = selectionRef.current;
        const targetId = current?.kind === 'blocks' && current.blockIds?.length
          ? current.blockIds[current.blockIds.length - 1]
          : focusIdRef.current;
        handlers.insertBlocksAfter?.(targetId, pasted);
      };
      document.addEventListener('copy', onCopy);
      document.addEventListener('cut', onCut);
      document.addEventListener('paste', onPaste);
      return () => {
        document.removeEventListener('copy', onCopy);
        document.removeEventListener('cut', onCut);
        document.removeEventListener('paste', onPaste);
      };
    }, []);
  return { orderedBlockIds, findPath, topLevelSelectedIds, blocksForClipboardIds, blockClipboardPayload, writeBlocksToClipboard, writeBlocksToSystemClipboard, parseClipboardBlocks, insertBlocksAfter, contextClipboardIds, copyContextBlocks, cutContextBlocks, pasteContextBlocksAfter, selectionRectForBlocks, blockIdsInVerticalRange, replaceSelectedBlocksWith, beginBlockSelection, extendBlockSelection };
}

export { useOutlinerSelectionActions };
