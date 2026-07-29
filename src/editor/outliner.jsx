// VispNote outliner — typed-block editor.
//
// Block kinds: paragraph (default), heading, bullet, todo, quote, code, table, divider.
// - Enter behavior depends on kind (see handleEnter).
// - Tab/Shift+Tab: indent/outdent.
// - Disclosure triangle: separate from bullet, only shown when block has children.
// - Selection toolbar: appears on text selection, applies annotations.
// - Slash menu: type "/" at start of an empty block (or after space) to convert.

import {
  BASE_SLASH_COMMANDS,
  BLOCK_CLIPBOARD_TYPE,
  changeBlockKind,
  deleteBlock,
  findSlashCommandTrigger,
  indentBlock,
  insertBlocksAt,
  isClipboardBlock,
  looksLikeBlockMarkdown,
  mergeBlockWithPrevious,
  moveBlock,
  normalizeClipboardMarkdown,
  outdentBlock,
  reidBlocks,
  renderSpellCheckedText,
  slashCommandScore,
  slashCommands,
  SpellSuggestionMenu,
  splitBlockAt,
  spellWords,
  toggleBlockCheck,
  toggleBlockCollapse,
  useOutlinerKeyboardShortcuts,
} from '../features/editor/outliner/index.js';
import { platformApi } from '../platform/index.js';
import { mnAiContentFingerprint } from '../ai/aiOwnership.js';
import { mnReadNovelistAiConfig } from '../panels/panelHelpers.js';
import { MnCanvasEmbed } from '../features/canvas/index.js';
import {
  mkBlock, mnBlocksToMd, mnCloneBlocks, mnFlatten, mnIsListLike, mnLocate,
  mnMdToBlocks, mnNormalizeBlockLabels, mnWalk,
} from './outline.jsx';
import { MnBlockContextMenu, MnBlockEmbed, MnPageEmbed, MnPropertyRow, MnWorkflowPill, MnZoomBar } from './blockFeatures.jsx';
import MN_EDITOR_OPS from './editorOps.js';
import MN_MARKDOWN_INPUT_RULES from './markdownInputRules.js';
import MN_APP_HELPERS from '../app/appHelpers.js';
import MN_TABLE_OPS from './tableOps.js';
import { createEditorHistory as mnCreateEditorHistory, shareBlockTree as mnShareBlockTree } from './outlinerHistory.js';
import {
  MN_AI_ACTIONS, MN_CODE_LANGUAGES, MnAiIcon, MnMathBlock, MnMermaidBlock,
  mnAiAction, mnCodeLanguageLabel, mnNormalizeCodeLanguage, mnRenderAnnotated, mnRenderCode,
} from './outlinerRenderers.jsx';

const { useState: useStateOE, useRef: useRefOE, useEffect: useEffectOE,
        useMemo: useMemoOE, useLayoutEffect: useLayoutEffectOE } = React;
const {
  clearAnnotationRange: mnClearAnnotationRange,
  applyAnnotationRange: mnApplyAnnotationRange,
  replaceTextRange: mnReplaceTextRange,
  updateBlockContent: mnUpdateBlockContent,
  splitBlock: mnSplitBlock,
  splitAnnotations: mnSplitAnnotations,
  mergeBlockContent: mnMergeBlockContent,
} = MN_EDITOR_OPS;
const {
  clipboardEventToMarkdownTable: mnClipboardEventToMarkdownTable,
  markdownTableToRows: mnMarkdownTableToRows,
  markdownTableToHtml: mnMarkdownTableToHtml,
} = MN_TABLE_OPS;

const mnSpellWords = spellWords;
const mnRenderSpellCheckedText = renderSpellCheckedText;
const MnSpellSuggestionMenu = SpellSuggestionMenu;
import { useOutlinerBlockActions } from './outliner/useOutlinerBlockActions.js';
import { useOutlinerSelectionActions } from './outliner/useOutlinerSelectionActions.js';
import { MnOutlinerView } from './outliner/MnOutlinerView.jsx';
import { MnCanvasPicker } from './outliner/OutlinerChrome.jsx';
import { MnMemoBlockRow, mnCreateBlockLabel } from './outliner/BlockRow.jsx';
import { MnSelectionToolbar } from './outliner/SelectionToolbar.jsx';
import { MnAiActionMenu, MnAiPreviewDialog, MnInlineAiPreview } from './outliner/OutlinerPopovers.jsx';

const mnAiLiveDot = 'mnAiLiveDot';
const mnAiPagePulse = 'mnAiPagePulse';
const mnAiPulse = 'mnAiPulse';
const mnAiTextShimmer = 'mnAiTextShimmer';
const mnInlineAiPreviewPulse = 'mnInlineAiPreviewPulse';
const mnIsClipboardBlock = isClipboardBlock;
const mnReidBlocks = reidBlocks;
const mnNormalizeClipboardMarkdown = normalizeClipboardMarkdown;
const mnLooksLikeBlockMarkdown = looksLikeBlockMarkdown;
const MN_BLOCK_CLIPBOARD_TYPE = BLOCK_CLIPBOARD_TYPE;

function MnOutlineTree({ blocks, depth, ...handlers }) {
  return (
    <>
      {blocks.map(b => (
        <React.Fragment key={b.id}>
          <MnMemoBlockRow block={b} depth={depth} {...handlers} />
          {handlers.aiPreview?.target?.kind === 'insert-after' && handlers.aiPreview.target.blockId === b.id && (
            <MnInlineAiPreview
              preview={handlers.aiPreview}
              depth={depth}
              T={handlers.T}
              onApply={handlers.onApplyAiPreview}
              onCancel={handlers.onCancelAiPreview}
            />
          )}
          {b.children && b.children.length > 0 && !b.collapsed && (
            <MnOutlineTree blocks={b.children} depth={depth + 1} {...handlers} />
          )}
        </React.Fragment>
      ))}
    </>
  );
}

// ── Main outliner component ────────────────────────────────────────────
function MnOutliner({
  blocks, setBlocks, allNotes, allCanvases = [], onOpen, onTagClick, onOpenCanvas, onCreateCanvas, T, zoomBlockId,
  onZoomBlock, onShowToast, noteId = '', noteTitle, noteTags = [], vaultId = '', fontSize,
  indentGuides = true, spellCheck = true, autoLink = true, collapseByDefault = false, novelistMode = false,
  aiEnabled = false, workflowEnabled = false,
}) {
  const [focusId, setFocusId] = useStateOE(null);
  const [selection, setSelection] = useStateOE(null); // { blockId, start, end, rect }
  const [ctxMenu, setCtxMenu] = useStateOE(null); // { blockId, x, y } | null
  const [aiMenu, setAiMenu] = useStateOE(null); // { scope, blockId, x, y } | null
  const [aiPrompt, setAiPrompt] = useStateOE(null); // { actionId, scope, payload, title, value } | null
  const [aiBusy, setAiBusy] = useStateOE(false);
  const [aiTarget, setAiTarget] = useStateOE(null); // { scope, blockId? } | null
  const [aiPreview, setAiPreview] = useStateOE(null);
  const selectDragRef = useRefOE(null);
  const undoStack = useRefOE([]);
  const redoStack = useRefOE([]);
  const historyRef = useRefOE(mnCreateEditorHistory ? mnCreateEditorHistory(80) : null);
  const undoActionRef = useRefOE(null);
  const redoActionRef = useRefOE(null);
  const selectionRef = useRefOE(null);
  const deleteSelectionRef = useRefOE(null);
  const dismissedAiPreviewRef = useRefOE(null);
  const noteIdRef = useRefOE(noteId || '');
  const focusIdRef = useRefOE(null);
  const moveBlockRef = useRefOE(null);
  const duplicateBlockRef = useRefOE(null);
  const deleteBlockRef = useRefOE(null);
  const zoomBlockRef = useRefOE(null);
  const keyboardEditActionsRef = useRefOE(null);
  const localClipboardRef = useRefOE(null);
  const clipboardHandlersRef = useRefOE(null);
  const contentEditHistoryRef = useRefOE({ blockId: null, armed: false });

  const { snapshotBlocks, mutate, replaceAllBlocks, undo, redo, onChange, onBeginContentEdit, onEndContentEdit, onChangeKind, onToggleCollapse, onToggleCheck, onIndent, onOutdent, onSplit, onInsertBlocksAt, onMergePrev, onDelete } = useOutlinerBlockActions({
    blocks, mnCloneBlocks, noteId, undoStack, redoStack, historyRef, noteIdRef, setBlocks, mnShareBlockTree, contentEditHistoryRef, undoActionRef, redoActionRef, selectionRef, selection, focusIdRef, focusId, useOutlinerKeyboardShortcuts, deleteSelectionRef, keyboardEditActionsRef, zoomBlockRef, moveBlockRef, duplicateBlockRef, deleteBlockRef, mnLocate, mnUpdateBlockContent, changeBlockKind, toggleBlockCollapse, toggleBlockCheck, indentBlock, outdentBlock, mkBlock, splitBlockAt, mnSplitBlock, setFocusId, insertBlocksAt, mnSplitAnnotations, mergeBlockWithPrevious, mnMergeBlockContent, deleteBlock,
  });

  const deleteSelection = () => {
    if (!selectionRef.current) return;
    const current = selectionRef.current;
    if (current.kind === 'text') {
      applyTextReplacement({
        blockId: current.blockId,
        start: current.start,
        end: current.end,
      }, '');
      setSelection(null);
      return;
    }
    if (current.kind !== 'blocks') return;
    mutate(bs => {
      const ids = topLevelSelectedIds(current.blockIds || [], bs);
      if (!ids.length) return;
      const selected = new Set(ids);
      const removeSelected = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (selected.has(arr[i].id)) arr.splice(i, 1);
          else removeSelected(arr[i].children || []);
        }
      };
      removeSelected(bs);
    });
    setSelection(null);
    setFocusId(null);
  };

  deleteSelectionRef.current = deleteSelection;

  // When zoomed into a block, only its children are rendered, so focus
  // navigation must be scoped to that subtree — otherwise ArrowUp/ArrowDown at
  // the edge would move focus to an off-screen block outside the zoom.
  const focusScopeBlocks = () => {
    if (zoomBlockId) {
      const zLoc = mnLocate(blocks, zoomBlockId);
      if (zLoc) return zLoc.block.children || [];
    }
    return blocks;
  };
  const onFocusNext = (id) => {
    const flat = mnFlatten(focusScopeBlocks());
    const i = flat.findIndex(f => f.block.id === id);
    if (i >= 0 && i < flat.length - 1) setFocusId(flat[i + 1].block.id);
  };
  const onFocusPrev = (id) => {
    const flat = mnFlatten(focusScopeBlocks());
    const i = flat.findIndex(f => f.block.id === id);
    if (i > 0) setFocusId(flat[i - 1].block.id);
  };

  // Move srcId to position relative to destId. position: 'before' | 'after' | 'child'
  const onMove = (srcId, destId, position = 'after') => {
    if (srcId === destId && position !== 'up' && position !== 'down') return;
    mutate(bs => moveBlock(bs, srcId, destId, position, mnLocate));
  };

  // Annotation operations on selection
  const applyAnnotation = (kind) => {
    if (!selection) return;
    if (selection.kind === 'blocks') return;
    const { blockId, start, end } = selection;
    if (start === end) return;
    if (kind === '_clear') {
      mutate(bs => {
        const loc = mnLocate(bs, blockId);
        if (!loc) return;
        loc.block.annotations = mnClearAnnotationRange(
          loc.block.annotations || [],
          start,
          end,
          (loc.block.content || '').length
        );
      });
    } else {
      mutate(bs => {
        const loc = mnLocate(bs, blockId);
        if (!loc) return;
        loc.block.annotations = mnApplyAnnotationRange(
          loc.block.annotations || [],
          start,
          end,
          kind,
          (loc.block.content || '').length
        );
      });
    }
  };

  const onContextMenu = (id, x, y) => setCtxMenu({ blockId: id, x, y });

  const onZoom = (id) => { if (onZoomBlock) onZoomBlock(id); };

  const onDuplicate = (id) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (!loc) return;
    const clone = mnCloneBlocks([loc.block])[0];
    // Re-id clone and its descendants
    const reid = (b) => {
      b.id = `bl-${Math.random().toString(36).slice(2, 9)}`;
      (b.children || []).forEach(reid);
    };
    reid(clone);
    loc.arr.splice(loc.idx + 1, 0, clone);
  });

  moveBlockRef.current = onMove;
  duplicateBlockRef.current = onDuplicate;
  deleteBlockRef.current = onDelete;
  zoomBlockRef.current = onZoom;

  const { orderedBlockIds, findPath, topLevelSelectedIds, blocksForClipboardIds, blockClipboardPayload, writeBlocksToClipboard, writeBlocksToSystemClipboard, parseClipboardBlocks, insertBlocksAfter, contextClipboardIds, copyContextBlocks, cutContextBlocks, pasteContextBlocksAfter, selectionRectForBlocks, blockIdsInVerticalRange, replaceSelectedBlocksWith, beginBlockSelection, extendBlockSelection } = useOutlinerSelectionActions({
    blocks, mutate, mnWalk, mnCloneBlocks, mnBlocksToMd, mnMdToBlocks, mkBlock, mnFlatten, mnLocate, MN_BLOCK_CLIPBOARD_TYPE, mnIsClipboardBlock, mnReidBlocks, mnNormalizeClipboardMarkdown, mnLooksLikeBlockMarkdown, localClipboardRef, clipboardHandlersRef, selectDragRef, selectionRef, deleteSelectionRef, deleteSelection, selection, onDelete, onShowToast, keyboardEditActionsRef, focusIdRef, setSelection, setCtxMenu, setFocusId, focusScopeBlocks,
  });

  const parseAiBlocks = (text) => {
    const parsed = mnMdToBlocks(String(text || '').trim());
    return parsed.length ? parsed : [mkBlock({ kind: 'paragraph', content: String(text || '').trim() })];
  };

  const requestAiEdit = async (actionId, scope, sourceText, instructionOverride, options = {}) => {
    const action = mnAiAction(actionId);
    const novelConfig = readNovelistAiConfig();
    if (!platformApi.ai?.edit) throw new Error('AI editing is not available');
	    const payload = {
	      text: sourceText,
	      instruction: instructionOverride || action.instruction,
	      scope,
	      vaultId,
	      useNovelistConfig: !!novelConfig,
	    };
    const res = options.onToken && platformApi.ai.editStream
      ? await platformApi.ai.editStream(payload, options.onToken)
      : await platformApi.ai.edit(payload);
    if (!res.ok) throw new Error(res.error || 'AI edit failed');
    if (res.value && !res.value.ok) throw new Error(res.value.error || 'AI edit failed');
    return res.value.text;
  };

  const readNovelistAiConfig = () => {
    if (!(noteTags || []).some(tag => String(tag || '').startsWith('novel-'))) return null;
    const config = mnReadNovelistAiConfig(vaultId);
    if (!config) return null;
    return {
      wordLimit: config.wordLimit,
      defaultPromptId: config.defaultPromptId,
      model: config.model || '',
      systemMessage: config.systemMessage || '',
      userMessage: config.userMessage || '',
      instructions: config.instructions || '',
      additionalContext: config.additionalContext || '',
      includedComponents: config.includedComponents || {},
      advanced: config.advanced || {},
      prompts: Array.isArray(config.prompts) ? config.prompts : [],
    };
  };

  const writeInstruction = (scope, userRequest, sourceText) => {
    const novelConfig = readNovelistAiConfig();
    const activePrompt = (novelConfig?.prompts || []).find(item => item.id === novelConfig.defaultPromptId)
      || (novelConfig?.prompts || []).find(item => item.prompt);
    return [
      novelConfig?.wordLimit ? `Target length: up to ${novelConfig.wordLimit} words unless the user asks otherwise.` : null,
      activePrompt?.prompt ? `Novelist writing prompt (${activePrompt.name || 'Default'}):\n${activePrompt.prompt}` : null,
      novelConfig?.instructions ? `Vault instructions:\n${novelConfig.instructions}` : null,
      novelConfig?.additionalContext ? `Additional context:\n${novelConfig.additionalContext}` : null,
      novelConfig?.userMessage ? `User message template:\n${novelConfig.userMessage}` : null,
      mnAiAction('write').instruction,
      `User request: ${userRequest}`,
      sourceText?.trim()
        ? 'Use the existing text below as local context. Replace it with the newly written text.'
        : 'Write new text for this empty location.',
    ].filter(Boolean).join('\n\n');
  };

  const pageContinuationInstruction = (userRequest, sourceText) => {
    const novelConfig = readNovelistAiConfig();
    const activePrompt = (novelConfig?.prompts || []).find(item => item.id === novelConfig.defaultPromptId)
      || (novelConfig?.prompts || []).find(item => item.prompt);
    return [
      novelConfig?.wordLimit ? `Target length: up to ${novelConfig.wordLimit} words unless the user asks otherwise.` : null,
      activePrompt?.prompt ? `Novelist writing prompt (${activePrompt.name || 'Default'}):\n${activePrompt.prompt}` : null,
      novelConfig?.instructions ? `Vault instructions:\n${novelConfig.instructions}` : null,
      novelConfig?.additionalContext ? `Additional context:\n${novelConfig.additionalContext}` : null,
      novelConfig?.userMessage ? `User message template:\n${novelConfig.userMessage}` : null,
      'Write new markdown that continues the existing page.',
      `User request: ${userRequest}`,
      sourceText?.trim()
        ? 'Use the full existing page below as context. Continue from the end of it. Do not repeat, summarize, move, or rewrite the existing content. Return only the new markdown that should be appended below the current last block.'
        : 'The page is empty. Return only the new markdown for the page.',
    ].filter(Boolean).join('\n\n');
  };

  const plotPointsContextText = (block) => {
    const titles = new Set(
      (block.contexts || [])
        .map(context => String(context || '').replace(/^\[\[|\]\]$/g, '').trim().toLowerCase())
        .filter(Boolean)
    );
    if (!titles.size) return '';
    return (allNotes || [])
      .filter(note => titles.has(String(note?.title || '').trim().toLowerCase()))
      .slice(0, 8)
      .map(note => `[[${note.title}]]\n${String(note.body || '').slice(0, 2500)}`)
      .join('\n\n');
  };

  const plotPointsInstruction = (plotAction, userRequest, sourceText, contextText = '', pageText = '') => {
    const novelConfig = readNovelistAiConfig();
    const activePrompt = (novelConfig?.prompts || []).find(item => item.id === novelConfig.defaultPromptId)
      || (novelConfig?.prompts || []).find(item => item.prompt);
    const task =
      plotAction === 'write-scene'
        ? 'Write the scene prose from these plot points.'
        : plotAction === 'improve'
          ? 'Turn these plot points into a clearer, more useful scene plan.'
          : 'Summarize these plot points into concise scene planning notes.';
    return [
      novelConfig?.wordLimit ? `Target length: up to ${novelConfig.wordLimit} words unless the user asks otherwise.` : null,
      activePrompt?.prompt ? `Novelist writing prompt (${activePrompt.name || 'Default'}):\n${activePrompt.prompt}` : null,
      novelConfig?.instructions ? `Vault instructions:\n${novelConfig.instructions}` : null,
      novelConfig?.additionalContext ? `Additional context:\n${novelConfig.additionalContext}` : null,
      novelConfig?.userMessage ? `User message template:\n${novelConfig.userMessage}` : null,
      task,
      'Use the beat lines and linked context pages as source material. Do not rewrite the Plot Points block itself.',
      plotAction === 'write-scene' && pageText?.trim()
        ? 'Continue from the end of the existing page. Do not insert content above existing draft text, repeat existing prose, summarize it, or rewrite it.'
        : null,
      userRequest?.trim() ? `User request: ${userRequest.trim()}` : null,
      plotAction === 'write-scene'
        ? 'Return only markdown that should be appended to the bottom of the page after the user approves it.'
        : 'Return only markdown that should be inserted below the Plot Points block after the user approves it.',
      sourceText?.trim() ? `Plot Points source:\n${sourceText}` : null,
      contextText?.trim() ? `Linked context pages:\n${contextText}` : null,
      pageText?.trim() ? `Existing page context:\n${pageText}` : null,
    ].filter(Boolean).join('\n\n');
  };

  const applyTextReplacement = (target, text) => {
    mutate(bs => {
      const loc = mnLocate(bs, target.blockId);
      if (!loc) return;
      const next = mnReplaceTextRange(
        loc.block.content || '',
        loc.block.annotations || [],
        target.start,
        target.end,
        text
      );
      loc.block.content = next.content;
      loc.block.annotations = next.annotations;
    });
  };

  const applyBlocksReplacement = (target, text) => {
    const replacement = parseAiBlocks(text);
    mutate(bs => {
      const ids = topLevelSelectedIds(target.blockIds || [], bs);
      if (!ids.length) return;
      const firstLoc = mnLocate(bs, ids[0]);
      if (!firstLoc) return;
      const parentId = firstLoc.parent?.id || null;
      const insertionIdx = firstLoc.idx;
      const selected = new Set(ids);
      const removeSelected = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (selected.has(arr[i].id)) arr.splice(i, 1);
          else removeSelected(arr[i].children || []);
        }
      };
      removeSelected(bs);
      const insertionArr = parentId ? (mnLocate(bs, parentId)?.block.children || bs) : bs;
      insertionArr.splice(Math.min(insertionIdx, insertionArr.length), 0, ...replacement);
    });
  };

  const applySectionReplacement = (target, text) => {
    const replacement = parseAiBlocks(text);
    mutate(bs => {
      const loc = mnLocate(bs, target.blockId);
      if (!loc) return;
      loc.arr.splice(loc.idx, 1, ...replacement);
    });
  };

  const appendPageBlocks = (text) => {
    const replacement = parseAiBlocks(text);
    mutate(bs => {
      bs.push(...mnCloneBlocks(replacement));
    });
    setFocusId(replacement[0]?.id || null);
  };

  const applyPageReplacement = (text) => replaceAllBlocks(parseAiBlocks(text));
  const inlinePreviewKey = (actionId, blockId = 'page') => `${actionId}:${blockId}`;
  const currentNoteId = noteId || noteIdRef.current || '';
  const isPreviewForCurrentNote = (preview) => (
    !preview?.noteId || !currentNoteId || preview.noteId === currentNoteId
  );
  const previewForCurrentNote = isPreviewForCurrentNote(aiPreview) ? aiPreview : null;
  const makeAiPreview = (requestNoteId, preview, baseText = '') => ({
    ...preview,
    noteId: requestNoteId || noteIdRef.current || '',
    vaultId: vaultId || '',
    baseHash: mnAiContentFingerprint(baseText),
  });

  const currentAiPreviewSource = (preview) => {
    const target = preview?.target;
    if (!target) return '';
    if (target.kind === 'text') {
      const loc = mnLocate(blocks, target.blockId);
      return loc ? String(loc.block.content || '').slice(target.start, target.end) : null;
    }
    if (target.kind === 'blocks') {
      const selectedBlocks = (target.blockIds || []).map(id => mnLocate(blocks, id)?.block).filter(Boolean);
      return selectedBlocks.length === (target.blockIds || []).length ? mnBlocksToMd(selectedBlocks) : null;
    }
    if (target.kind === 'section' || target.kind === 'insert-after') {
      const loc = mnLocate(blocks, target.blockId);
      return loc ? mnBlocksToMd([loc.block]) : null;
    }
    if (target.kind === 'page' || target.kind === 'append-page') return mnBlocksToMd(blocks);
    return null;
  };

  const cancelAiPreview = () => {
    const preview = previewForCurrentNote;
    if (preview?.target?.kind === 'insert-after' || preview?.target?.kind === 'append-page') {
      dismissedAiPreviewRef.current = inlinePreviewKey(preview.actionId, preview.target.blockId);
    }
    setAiPreview(null);
  };

  const applyAiPreview = () => {
    const preview = previewForCurrentNote;
    if (!preview) return;
    if (preview.streaming || preview.error || !String(preview.text || '').trim()) return;
    const currentSource = currentAiPreviewSource(preview);
    if (
      preview.vaultId !== (vaultId || '') ||
      currentSource == null ||
      preview.baseHash !== mnAiContentFingerprint(currentSource)
    ) {
      onShowToast?.('This page changed after the AI preview was created. Generate a new preview.');
      setAiPreview(null);
      return;
    }
    if (preview.target.kind === 'text') applyTextReplacement(preview.target, preview.text);
    else if (preview.target.kind === 'blocks') applyBlocksReplacement(preview.target, preview.text);
    else if (preview.target.kind === 'section') applySectionReplacement(preview.target, preview.text);
    else if (preview.target.kind === 'insert-after') insertBlocksAfter(preview.target.blockId, parseAiBlocks(preview.text));
    else if (preview.target.kind === 'append-page') appendPageBlocks(preview.text);
    else if (preview.target.kind === 'page') applyPageReplacement(preview.text);
    const label = preview.target.kind === 'append-page'
      ? mnAiAction(preview.actionId).pageLabel
      : mnAiAction(preview.actionId).sectionLabel;
    onShowToast && onShowToast(`${label} applied`);
    setAiPreview(null);
    setSelection(null);
  };

  const runAiAction = async (actionId, scope, payload = {}) => {
    if (scope === 'section-menu') {
      setAiMenu({ scope: 'section', blockId: payload.blockId, x: payload.x || 0, y: payload.y || 0 });
      return;
    }
    const action = mnAiAction(actionId);
    let userRequest = payload.userRequest || null;
    const needsPrompt = action.needsPrompt && !(scope === 'section' && payload.plotPointsAction === 'write-scene');
    if (needsPrompt && !String(userRequest || '').trim()) {
      setAiPrompt({
        actionId,
        scope,
        payload,
        title: scope === 'page' ? 'Write on this page'
          : scope === 'section' ? 'Write in this section'
          : 'Write for this selection',
        value: '',
      });
      return;
    }
    if (needsPrompt) userRequest = String(userRequest || '').trim();
    if (aiBusy) return;
    const requestNoteId = noteIdRef.current || '';
    setAiBusy(true);
    setAiTarget({
      noteId: requestNoteId,
      scope: scope === 'selection' ? 'selection' : scope === 'section' ? 'section' : 'page',
      blockId: scope === 'selection' ? selection?.blockId : payload.blockId,
      blockIds: scope === 'selection' && selection?.kind === 'blocks' ? selection.blockIds : null,
      actionId,
    });
    try {
      if (scope === 'selection') {
        if (!selection) return;
        if (selection.kind === 'blocks') {
          const ids = topLevelSelectedIds(selection.blockIds || []);
          if (!ids.length) return;
          const selectedBlocks = ids.map(id => mnLocate(blocks, id)?.block).filter(Boolean);
          const source = mnBlocksToMd(selectedBlocks);
          const edited = await requestAiEdit(
            actionId,
            'selected blocks',
            source,
            action.needsPrompt ? writeInstruction('selected blocks', userRequest, source) : null
          );
          if (action.preview) {
            setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'blocks', blockIds: ids } }, source));
            return;
          }
          applyBlocksReplacement({ blockIds: ids }, edited);
          setSelection(null);
          onShowToast && onShowToast(`${mnAiAction(actionId).selectionLabel.replace('selected text', 'selected blocks')} applied`);
          return;
        }
        const loc = mnLocate(blocks, selection.blockId);
        if (!loc) return;
        const source = loc.block.content.slice(selection.start, selection.end);
        const edited = await requestAiEdit(
          actionId,
          'selected text',
          source,
          action.needsPrompt ? writeInstruction('selected text', userRequest, source) : null
        );
        if (action.preview) {
          setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'text', blockId: selection.blockId, start: selection.start, end: selection.end } }, source));
          return;
        }
        applyTextReplacement({ blockId: selection.blockId, start: selection.start, end: selection.end }, edited);
        setSelection(null);
        onShowToast && onShowToast(`${mnAiAction(actionId).selectionLabel} applied`);
        return;
      }

      if (scope === 'section') {
        const blockId = payload.blockId;
        const loc = mnLocate(blocks, blockId);
        if (!loc) return;
        const sourceBlock = mnCloneBlocks([loc.block])[0];
        const baseSource = mnBlocksToMd([loc.block]);
        if (payload.cleanContent != null) sourceBlock.content = payload.cleanContent;
        const source = mnBlocksToMd([sourceBlock]);
        const isPlotPointsAi = sourceBlock.kind === 'plot-points' || payload.plotPointsAction;
        const appendPlotWrite = payload.plotPointsAction === 'write-scene';
        const plotContext = isPlotPointsAi ? plotPointsContextText(sourceBlock) : '';
        const pageSource = appendPlotWrite ? mnBlocksToMd(blocks) : '';
        const plotPreviewKey = appendPlotWrite ? inlinePreviewKey(actionId) : inlinePreviewKey(actionId, blockId);
        if (isPlotPointsAi) {
          dismissedAiPreviewRef.current = null;
          setAiPreview({
            noteId: requestNoteId,
            vaultId: vaultId || '',
            baseHash: mnAiContentFingerprint(appendPlotWrite ? pageSource : baseSource),
            actionId,
            text: '',
            streaming: true,
            target: appendPlotWrite ? { kind: 'append-page' } : { kind: 'insert-after', blockId },
          });
        }
        const edited = await requestAiEdit(
          actionId,
          'section',
          source,
          isPlotPointsAi
            ? plotPointsInstruction(payload.plotPointsAction || actionId, userRequest, source, plotContext, pageSource)
            : action.needsPrompt ? writeInstruction('section', userRequest, source) : null,
          isPlotPointsAi
            ? {
                onToken: (token) => {
                  if (dismissedAiPreviewRef.current === plotPreviewKey) return;
                  setAiPreview(prev => (
                    prev?.noteId === requestNoteId && (
                      (appendPlotWrite && prev?.target?.kind === 'append-page') ||
                      (!appendPlotWrite && prev?.target?.kind === 'insert-after' && prev.target.blockId === blockId)
                    )
                      ? { ...prev, text: `${prev.text || ''}${token}` }
                      : prev
                  ));
                },
              }
            : {}
        );
        if (isPlotPointsAi) {
          if (dismissedAiPreviewRef.current === plotPreviewKey) return;
          setAiPreview(prev => (
            prev?.noteId === requestNoteId && (
              (appendPlotWrite && prev?.target?.kind === 'append-page') ||
              (!appendPlotWrite && prev?.target?.kind === 'insert-after' && prev.target.blockId === blockId)
            )
              ? { ...prev, text: edited, streaming: false }
              : {
	                  noteId: requestNoteId,
	                  vaultId: vaultId || '',
	                  baseHash: mnAiContentFingerprint(appendPlotWrite ? pageSource : baseSource),
	                  actionId,
                  text: edited,
                  streaming: false,
                  target: appendPlotWrite ? { kind: 'append-page' } : { kind: 'insert-after', blockId },
                }
          ));
          return;
        }
        if (action.preview) {
          setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'section', blockId } }, baseSource));
          return;
        }
        applySectionReplacement({ blockId }, edited);
        onShowToast && onShowToast(`${mnAiAction(actionId).sectionLabel} applied`);
        return;
      }

      let pageBlocks = blocks;
      if (payload.blockId && payload.cleanContent != null) {
        pageBlocks = mnCloneBlocks(blocks);
        const cleanLoc = mnLocate(pageBlocks, payload.blockId);
        if (cleanLoc) cleanLoc.block.content = payload.cleanContent;
      }
      const source = mnBlocksToMd(pageBlocks);
      const appendPageWrite = actionId === 'write' && pageBlocks.length > 0;
      const pagePreviewKey = inlinePreviewKey(actionId);
      if (appendPageWrite) {
        dismissedAiPreviewRef.current = null;
        setAiPreview({
          noteId: requestNoteId,
          vaultId: vaultId || '',
          baseHash: mnAiContentFingerprint(source),
          actionId,
          text: '',
          streaming: true,
          target: { kind: 'append-page' },
        });
      }
      const edited = await requestAiEdit(
        actionId,
        'page',
        source,
        appendPageWrite
          ? pageContinuationInstruction(userRequest, source)
          : action.needsPrompt ? writeInstruction('page', userRequest, source) : null,
        appendPageWrite
          ? {
              onToken: (token) => {
                if (dismissedAiPreviewRef.current === pagePreviewKey) return;
                setAiPreview(prev => (
                  prev?.noteId === requestNoteId && prev?.target?.kind === 'append-page'
                    ? { ...prev, text: `${prev.text || ''}${token}` }
                    : prev
                ));
              },
            }
          : {}
      );
      if (appendPageWrite) {
        if (dismissedAiPreviewRef.current === pagePreviewKey) return;
        setAiPreview(prev => (
          prev?.noteId === requestNoteId && prev?.target?.kind === 'append-page'
            ? { ...prev, text: edited, streaming: false }
            : {
	                noteId: requestNoteId,
	                vaultId: vaultId || '',
	                baseHash: mnAiContentFingerprint(source),
	                actionId,
                text: edited,
                streaming: false,
                target: { kind: 'append-page' },
              }
        ));
        return;
      }
      if (action.preview) {
        setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'page' } }, source));
        return;
      }
      applyPageReplacement(edited);
      onShowToast && onShowToast(`${mnAiAction(actionId).pageLabel} applied`);
    } catch (e) {
      console.error('AI edit failed', e);
      setAiPreview(prev => prev?.streaming && (!requestNoteId || prev.noteId === requestNoteId)
        ? { ...prev, streaming: false, error: e.message || 'AI edit failed' }
        : prev);
      onShowToast && onShowToast(e.message || 'AI edit failed');
    } finally {
      setAiBusy(false);
      setAiTarget(null);
    }
  };

  const selectedBlockIds = useMemoOE(
    () => new Set(selection?.kind === 'blocks' ? selection.blockIds || [] : []),
    [selection]
  );

  const handlers = {
    onChange, onChangeKind, onToggleCollapse, onToggleCheck,
    onIndent, onOutdent, onSplit, onInsertBlocksAt, onMergePrev, onDelete,
    onFocusNext, onFocusPrev, onOpen, onTagClick,
    onMove,
    onContextMenu, onZoom,
    onAiAction: aiEnabled ? runAiAction : null,
    aiEnabled,
    workflowEnabled,
    aiPreview: aiEnabled ? previewForCurrentNote : null,
    onApplyAiPreview: applyAiPreview,
    onCancelAiPreview: cancelAiPreview,
    aiTarget: aiEnabled && (!aiTarget?.noteId || !noteId || aiTarget.noteId === noteId) ? aiTarget : null,
    focusId, setFocusId, T, allNotes, allCanvases, onOpenCanvas, onCreateCanvas,
    onSelectionChange: setSelection,
    onBlockMouseDown: beginBlockSelection,
    onBlockMouseEnter: extendBlockSelection,
    selectedBlockIds,
    onBeginContentEdit,
    onEndContentEdit,
    editorFontSize: fontSize,
    indentGuides,
    spellCheck,
    autoLink,
    collapseByDefault,
    novelistMode,
    parseClipboardBlocks,
    vaultId,
    onShowToast,
  };

  // Find zoomed block.
  const zoomLoc = zoomBlockId ? mnLocate(blocks, zoomBlockId) : null;
  const zoomBlock = zoomLoc ? zoomLoc.block : null;
  // When zoomed: show the zoom block's content AS the title in the zoom bar,
  // and its children become the editable list.
  const renderBlocks = zoomBlock ? (zoomBlock.children || []) : blocks;
  const ctxBlock = ctxMenu ? mnLocate(blocks, ctxMenu.blockId)?.block : null;
  const currentAiTarget = aiEnabled && (!aiTarget?.noteId || !noteId || aiTarget.noteId === noteId) ? aiTarget : null;

  return <MnOutlinerView model={{ MnAiActionMenu, MnAiIcon, MnAiPreviewDialog, MnBlockContextMenu, MnInlineAiPreview, MnOutlineTree, MnSelectionToolbar, MnZoomBar, T, aiBusy, aiEnabled, aiMenu, aiPreview, aiPrompt, aiTarget, allCanvases, allNotes, appendPageBlocks, applyAiPreview, applyAnnotation, applyBlocksReplacement, applyPageReplacement, applySectionReplacement, applyTextReplacement, autoLink, beginBlockSelection, blockClipboardPayload, blockIdsInVerticalRange, blocks, blocksForClipboardIds, cancelAiPreview, clipboardHandlersRef, collapseByDefault, contentEditHistoryRef, contextClipboardIds, copyContextBlocks, ctxBlock, ctxMenu, currentAiTarget, currentNoteId, cutContextBlocks, deleteBlockRef, deleteSelection, deleteSelectionRef, dismissedAiPreviewRef, duplicateBlockRef, extendBlockSelection, findPath, focusId, focusIdRef, focusScopeBlocks, fontSize, handlers, historyRef, indentGuides, inlinePreviewKey, insertBlocksAfter, isPreviewForCurrentNote, keyboardEditActionsRef, localClipboardRef, makeAiPreview, mnAiAction, mnAiLiveDot, mnAiPagePulse, mnAiPulse, mnAiTextShimmer, mnCreateBlockLabel, mnInlineAiPreviewPulse, mnLocate, mnNormalizeBlockLabels, moveBlockRef, mutate, noteId, noteIdRef, noteTags, noteTitle, novelistMode, onBeginContentEdit, onChange, onChangeKind, onContextMenu, onCreateCanvas, onDelete, onDuplicate, onEndContentEdit, onFocusNext, onFocusPrev, onIndent, onInsertBlocksAt, onMergePrev, onMove, onOpen, onOpenCanvas, onOutdent, onShowToast, onSplit, onTagClick, onToggleCheck, onToggleCollapse, onZoom, onZoomBlock, orderedBlockIds, pageContinuationInstruction, parseAiBlocks, parseClipboardBlocks, pasteContextBlocksAfter, plotPointsContextText, plotPointsInstruction, previewForCurrentNote, readNovelistAiConfig, redo, redoActionRef, redoStack, renderBlocks, replaceAllBlocks, replaceSelectedBlocksWith, requestAiEdit, runAiAction, selectDragRef, selectedBlockIds, selection, selectionRectForBlocks, selectionRef, setAiBusy, setAiMenu, setAiPreview, setAiPrompt, setAiTarget, setBlocks, setCtxMenu, setFocusId, setSelection, snapshotBlocks, spellCheck, topLevelSelectedIds, undo, undoActionRef, undoStack, vaultId, workflowEnabled, writeBlocksToClipboard, writeBlocksToSystemClipboard, writeInstruction, zoomBlock, zoomBlockId, zoomBlockRef, zoomLoc }} />;
}
export { MnOutliner };
