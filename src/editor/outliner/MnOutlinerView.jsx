function MnOutlinerView({ model }) {
  const { MnAiActionMenu, MnAiIcon, MnAiPreviewDialog, MnBlockContextMenu, MnInlineAiPreview, MnOutlineTree, MnSelectionToolbar, MnZoomBar, T, aiBusy, aiMenu, aiPreview, aiPrompt, aiTarget, allCanvases, allNotes, appendPageBlocks, applyAiPreview, applyAnnotation, applyBlocksReplacement, applyPageReplacement, applySectionReplacement, applyTextReplacement, autoLink, beginBlockSelection, blockClipboardPayload, blockIdsInVerticalRange, blocks, blocksForClipboardIds, cancelAiPreview, clipboardHandlersRef, collapseByDefault, contentEditHistoryRef, contextClipboardIds, copyContextBlocks, ctxBlock, ctxMenu, currentAiTarget, currentNoteId, cutContextBlocks, deleteBlockRef, deleteSelection, deleteSelectionRef, dismissedAiPreviewRef, duplicateBlockRef, extendBlockSelection, findPath, focusId, focusIdRef, focusScopeBlocks, fontSize, handlers, historyRef, indentGuides, inlinePreviewKey, insertBlocksAfter, isPreviewForCurrentNote, keyboardEditActionsRef, localClipboardRef, makeAiPreview, mnAiAction, mnAiLiveDot, mnAiPagePulse, mnAiPulse, mnAiTextShimmer, mnCreateBlockLabel, mnInlineAiPreviewPulse, mnLocate, mnNormalizeBlockLabels, moveBlockRef, mutate, noteId, noteIdRef, noteTags, noteTitle, novelistMode, onBeginContentEdit, onChange, onChangeKind, onContextMenu, onCreateCanvas, onDelete, onDuplicate, onEndContentEdit, onFocusNext, onFocusPrev, onIndent, onInsertBlocksAt, onMergePrev, onMove, onOpen, onOpenCanvas, onOutdent, onShowToast, onSplit, onTagClick, onToggleCheck, onToggleCollapse, onZoom, onZoomBlock, orderedBlockIds, pageContinuationInstruction, parseAiBlocks, parseClipboardBlocks, pasteContextBlocksAfter, plotPointsContextText, plotPointsInstruction, previewForCurrentNote, readNovelistAiConfig, redo, redoActionRef, redoStack, renderBlocks, replaceAllBlocks, replaceSelectedBlocksWith, requestAiEdit, runAiAction, selectDragRef, selectedBlockIds, selection, selectionRectForBlocks, selectionRef, setAiBusy, setAiMenu, setAiPreview, setAiPrompt, setAiTarget, setBlocks, setCtxMenu, setFocusId, setSelection, snapshotBlocks, spellCheck, topLevelSelectedIds, undo, undoActionRef, undoStack, vaultId, writeBlocksToClipboard, writeBlocksToSystemClipboard, writeInstruction, zoomBlock, zoomBlockId, zoomBlockRef, zoomLoc } = model;
    return (
      <div className="mn-outliner" style={{ color: T.ink, position: 'relative' }}>
        <style>{`
          .mn-block-row { transition: background 80ms, box-shadow 160ms; }
          .mn-block-row:hover .mn-disclosure { opacity: 0.9 !important; }
          .mn-block-row:hover .mn-grip { opacity: 0.55 !important; }
          .mn-block-row:hover .mn-block-ai, .mn-block-ai:focus-visible { opacity: 0.82 !important; }
          .mn-block-ai:hover { opacity: 1 !important; }
          .mn-grip:hover { opacity: 0.95 !important; background: ${T.bgHover}; }
          .mn-block-row .mn-disclosure:hover { color: var(--mn-ink, currentColor); }
          .mn-ai-working-glow {
            animation: mnAiPulse 1.6s ease-in-out infinite;
            background:
              radial-gradient(circle at 24px 18px, color-mix(in oklab, ${T.accent || T.ink} 8%, transparent), transparent 44%),
              linear-gradient(90deg, transparent, color-mix(in oklab, ${T.accent || T.ink} 5%, transparent), transparent);
          }
          .mn-ai-page-working {
            animation: mnAiPagePulse 1.25s ease-in-out infinite;
          }
          .mn-ai-text-working {
            animation: mnAiTextShimmer 1.35s ease-in-out infinite;
            background-size: 220% 100%;
          }
          .mn-inline-ai-preview-streaming {
            animation: mnInlineAiPreviewPulse 1.3s ease-in-out infinite;
          }
          .mn-ai-live-dots span {
            width: 4px;
            height: 4px;
            border-radius: 999px;
            background: ${T.accent || T.ink};
            opacity: 0.35;
            animation: mnAiLiveDot 900ms ease-in-out infinite;
          }
          .mn-ai-live-dots span:nth-child(2) { animation-delay: 130ms; }
          .mn-ai-live-dots span:nth-child(3) { animation-delay: 260ms; }
          @keyframes mnAiPulse {
            0%, 100% { opacity: 0.34; transform: scale(0.998); }
            50% { opacity: 0.72; transform: scale(1.001); }
          }
          @keyframes mnAiLiveDot {
            0%, 100% { opacity: 0.28; transform: translateY(1px); }
            50% { opacity: 0.92; transform: translateY(-1px); }
          }
          @keyframes mnInlineAiPreviewPulse {
            0%, 100% { filter: saturate(1); }
            50% { filter: saturate(1.12); }
          }
          @keyframes mnAiPagePulse {
            0%, 100% {
              box-shadow: inset 0 0 0 1px color-mix(in oklab, ${T.accent || T.ink} 7%, transparent);
            }
            50% {
              box-shadow: inset 0 0 0 1px color-mix(in oklab, ${T.accent || T.ink} 16%, transparent), 0 8px 24px color-mix(in oklab, ${T.accent || T.ink} 7%, transparent);
            }
          }
          @keyframes mnAiTextShimmer {
            0%, 100% {
              background-position: 180% 0;
              background-image: linear-gradient(100deg, transparent 0%, color-mix(in oklab, ${T.accent || T.ink} 5%, transparent) 45%, color-mix(in oklab, ${T.accent || T.ink} 10%, transparent) 52%, color-mix(in oklab, ${T.accent || T.ink} 5%, transparent) 59%, transparent 100%);
            }
            50% {
              background-position: 20% 0;
            }
          }
        `}</style>
        {currentAiTarget?.scope === 'page' && (
          <div className="mn-ai-page-working" style={{
            position: 'absolute',
            inset: '-4px -6px 24px',
            borderRadius: 10,
            pointerEvents: 'none',
            background: `linear-gradient(120deg, transparent, color-mix(in oklab, ${T.accent || T.ink} 3%, transparent), transparent)`,
            zIndex: 0,
          }} />
        )}
        {currentAiTarget && (
          <div style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 999,
            background: T.bg,
            border: `1px solid color-mix(in oklab, ${T.accent || T.ink} 30%, ${T.line})`,
            color: T.ink,
            fontFamily: 'var(--mn-ui)',
            fontSize: 12.5,
            boxShadow: `0 14px 36px color-mix(in oklab, ${T.accent || T.ink} 20%, transparent)`,
            pointerEvents: 'none',
          }}>
            <span className="mn-ai-working-glow" style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.accent || T.ink,
            }}><MnAiIcon size={13} /></span>
            {mnAiAction(currentAiTarget.actionId).selectionLabel.replace('selected text', currentAiTarget.scope === 'page' ? 'page' : currentAiTarget.scope === 'section' ? 'section' : 'selected text')}
          </div>
        )}
        {zoomBlock && (
          <MnZoomBar
            block={zoomBlock}
            noteTitle={noteTitle || ''}
            onExit={() => onZoomBlock && onZoomBlock(null)}
            onCopyRef={() => {
              const ref = `((${zoomBlock.id}))`;
              navigator.clipboard?.writeText(ref);
              onShowToast && onShowToast(`Copied block ref: ${ref}`);
            }}
            onChangeContent={(text) => {
              mutate((draft) => {
                const loc = mnLocate(draft, zoomBlock.id);
                if (loc) loc.block.content = text;
              });
            }}
            T={T}
          />
        )}
        <MnOutlineTree blocks={renderBlocks} depth={0} {...handlers} />
        {previewForCurrentNote?.target?.kind === 'append-page' && (
          <MnInlineAiPreview
            preview={previewForCurrentNote}
            depth={0}
            T={T}
            onApply={applyAiPreview}
            onCancel={cancelAiPreview}
          />
        )}
        {/* Add new top-level block (or child of zoomed block) */}
        <div onClick={() => {
          const nb = mkBlock({ kind: 'paragraph' });
          if (zoomBlock) {
            mutate(draft => {
              const loc = mnLocate(draft, zoomBlock.id);
              if (loc) {
                loc.block.children = loc.block.children || [];
                loc.block.children.push(nb);
              }
            });
          } else {
            mutate(bs => bs.push(nb));
          }
          setFocusId(nb.id);
        }} style={{
          marginTop: 18, padding: '8px 0',
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          cursor: 'text', letterSpacing: '0.04em',
          borderTop: `1px dashed ${T.lineSub}`,
        }}>
          Click to add a new block · type / for commands
        </div>
        {/* Floating selection toolbar */}
        {selection && (
          <MnSelectionToolbar
            rect={selection.rect}
            selectionKind={selection.kind}
            onApply={applyAnnotation}
            onDelete={deleteSelection}
            onUndo={undo}
            onRedo={redo}
            onOpenAiMenu={(e) => setAiMenu({
              scope: 'selection',
              x: e.clientX,
              y: e.clientY,
            })}
            onClose={() => setSelection(null)}
            T={T} />
        )}
        {aiMenu && (
          <MnAiActionMenu
            scope={aiMenu.scope === 'selection' && selection?.kind === 'blocks' ? 'selection-blocks' : aiMenu.scope}
            x={aiMenu.x}
            y={aiMenu.y}
            busy={aiBusy}
            onPick={(actionId) => runAiAction(actionId, aiMenu.scope, { blockId: aiMenu.blockId })}
            onClose={() => setAiMenu(null)}
            T={T}
          />
        )}
        {aiPrompt && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `color-mix(in oklab, ${T.ink} 24%, transparent)`,
              backdropFilter: 'blur(2px)',
            }}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={aiPrompt.title}
              style={{
                width: 420,
                maxWidth: 'calc(100vw - 40px)',
                background: T.bg,
                color: T.ink,
                border: `1px solid ${T.line}`,
                borderRadius: 10,
                boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
                overflow: 'hidden',
                fontFamily: 'var(--mn-ui)',
              }}>
              <div style={{
                padding: '16px 18px 12px',
                borderBottom: `1px solid ${T.lineSub}`,
                background: T.bgSub,
              }}>
                <div style={{ fontSize: 15, fontWeight: 720, color: T.ink }}>{aiPrompt.title}</div>
                <div style={{ marginTop: 4, fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed }}>
                  Add the writing instruction for this AI action.
                </div>
              </div>
              <div style={{ padding: 18 }}>
                <textarea
                  autoFocus
                  value={aiPrompt.value}
                  onChange={(e) => setAiPrompt(current => current ? { ...current, value: e.target.value } : current)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setAiPrompt(null);
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      const current = aiPrompt;
                      const value = String(current.value || '').trim();
                      if (!value) return;
                      setAiPrompt(null);
                      runAiAction(current.actionId, current.scope, { ...current.payload, userRequest: value });
                    }
                  }}
                  placeholder="Describe what to write..."
                  style={{
                    width: '100%',
                    minHeight: 96,
                    resize: 'vertical',
                    border: `1px solid ${T.lineSub}`,
                    borderRadius: 7,
                    background: T.bg,
                    color: T.ink,
                    outline: 'none',
                    padding: '9px 10px',
                    fontFamily: 'var(--mn-body)',
                    fontSize: 13,
                    lineHeight: 1.45,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '0 18px 16px',
              }}>
                <button
                  onClick={() => setAiPrompt(null)}
                  style={{
                    height: 32,
                    padding: '0 13px',
                    borderRadius: 6,
                    background: T.bg,
                    color: T.inkMed,
                    border: `1px solid ${T.line}`,
                    cursor: 'pointer',
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 12.5,
                    fontWeight: 650,
                  }}>
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const current = aiPrompt;
                    const value = String(current.value || '').trim();
                    if (!value) return;
                    setAiPrompt(null);
                    runAiAction(current.actionId, current.scope, { ...current.payload, userRequest: value });
                  }}
                  disabled={!String(aiPrompt.value || '').trim()}
                  style={{
                    height: 32,
                    padding: '0 13px',
                    borderRadius: 6,
                    background: String(aiPrompt.value || '').trim() ? T.ink : T.bgSub,
                    color: String(aiPrompt.value || '').trim() ? T.bg : T.inkDim,
                    border: `1px solid ${String(aiPrompt.value || '').trim() ? T.ink : T.lineSub}`,
                    cursor: String(aiPrompt.value || '').trim() ? 'pointer' : 'default',
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 12.5,
                    fontWeight: 650,
                  }}>
                  Generate
                </button>
              </div>
            </div>
          </div>
        )}
        {previewForCurrentNote && !['insert-after', 'append-page'].includes(previewForCurrentNote.target?.kind) && (
          <MnAiPreviewDialog
            preview={previewForCurrentNote}
            onCancel={() => setAiPreview(null)}
            onApply={applyAiPreview}
            T={T}
          />
        )}
        {/* Block context menu */}
        {ctxMenu && ctxBlock && (
          <MnBlockContextMenu
            block={ctxBlock}
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            onCopyRef={() => {
              const ref = `((${ctxBlock.id}))`;
              navigator.clipboard?.writeText(ref);
              onShowToast && onShowToast(`Copied block ref: ${ref}`);
            }}
            onCopyEmbed={() => {
              const e = `{{embed ((${ctxBlock.id}))}}`;
              navigator.clipboard?.writeText(e);
              onShowToast && onShowToast(`Copied embed: ${e}`);
            }}
            onCopyBlock={() => copyContextBlocks(ctxBlock.id)}
            onCutBlock={() => cutContextBlocks(ctxBlock.id)}
            onPasteAfter={() => pasteContextBlocksAfter(ctxBlock.id)}
            onZoom={() => onZoomBlock && onZoomBlock(ctxBlock.id)}
            onIndent={() => onIndent(ctxBlock.id)}
            onOutdent={() => onOutdent(ctxBlock.id)}
            onMoveUp={() => onMove(ctxBlock.id, ctxBlock.id, 'up')}
            onMoveDown={() => onMove(ctxBlock.id, ctxBlock.id, 'down')}
            onDuplicate={() => onDuplicate(ctxBlock.id)}
            onAddLabel={() => onChangeKind(ctxBlock.id, {
              labels: [
                ...((mnNormalizeBlockLabels ? mnNormalizeBlockLabels(ctxBlock.labels || []) : (ctxBlock.labels || []))),
                mnCreateBlockLabel(),
              ],
            })}
            onDelete={() => onDelete(ctxBlock.id)}
            onSetWorkflow={(state) => onChangeKind(ctxBlock.id, { workflow: state })}
            onChangeKind={(patch) => onChangeKind(ctxBlock.id, patch)}
            T={T}
          />
        )}
      </div>
    );
}

export { MnOutlinerView };
import { mkBlock } from '../outline.jsx';
