// VispNote outliner — typed-block editor.
//

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
} from '../../features/editor/outliner/index.js';
import { platformApi } from '../../platform/index.js';
import { mnIsPropertyLine, mnParseProperty, mnWorkflow } from '../blockFeatures.jsx';
import { MnCanvasEmbed } from '../../features/canvas/index.js';
import {
  mkBlock, mnBlocksToMd, mnCloneBlocks, mnFlatten, mnIsListLike, mnLocate,
  mnMdToBlocks, mnNormalizeBlockLabels,
} from '../outline.jsx';
import { MnBlockContextMenu, MnBlockEmbed, MnPageEmbed, MnPropertyRow, MnWorkflowPill, MnZoomBar } from '../blockFeatures.jsx';
import MN_EDITOR_OPS from '../editorOps.js';
import MN_MARKDOWN_INPUT_RULES from '../markdownInputRules.js';
import MN_APP_HELPERS from '../../app/appHelpers.js';
import MN_TABLE_OPS from '../tableOps.js';
import { createEditorHistory as mnCreateEditorHistory, shareBlockTree as mnShareBlockTree } from '../outlinerHistory.js';
import {
  MN_AI_ACTIONS, MN_CODE_LANGUAGES, MnAiIcon, MnMathBlock, MnMermaidBlock,
  mnAiAction, mnCodeLanguageLabel, mnNormalizeCodeLanguage, mnRenderAnnotated, mnRenderCode,
} from '../outlinerRenderers.jsx';

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
import { MnCanvasPicker, MnDisclosure } from './OutlinerChrome.jsx';
import { MnPlotPointsBlock, MnInlineAiButton, MnSmartViewEmbedFallback, MnSmartViewEmbed, MnMarkdownTable, mnEditorFontScale, mnGetFontStyle, mnAffordancePadTop, mnGripPadTop, mnPlaceholder } from './EmbeddedBlocks.jsx';
import { MnPopover, MnPopoverHeader, MnPopoverItem, MnInlineAiPreview } from './OutlinerPopovers.jsx';
import { useAttachmentInsertion } from './useAttachmentInsertion.js';

const MN_SLASH_CMDS = BASE_SLASH_COMMANDS;

const mnSlashCommands = slashCommands;
const mnFindSlashCommandTrigger = findSlashCommandTrigger;
const mnSlashCommandScore = slashCommandScore;

const MN_BLOCK_LABEL_COLORS = [
  { id: 'yellow', label: 'Yellow', bg: 'oklch(0.96 0.08 95)', border: 'oklch(0.78 0.13 85)', ink: 'oklch(0.38 0.09 75)' },
  { id: 'pink', label: 'Pink', bg: 'oklch(0.96 0.06 350)', border: 'oklch(0.76 0.13 350)', ink: 'oklch(0.42 0.12 350)' },
  { id: 'blue', label: 'Blue', bg: 'oklch(0.95 0.05 245)', border: 'oklch(0.72 0.12 245)', ink: 'oklch(0.38 0.12 245)' },
  { id: 'green', label: 'Green', bg: 'oklch(0.94 0.06 150)', border: 'oklch(0.70 0.12 150)', ink: 'oklch(0.34 0.10 150)' },
  { id: 'purple', label: 'Purple', bg: 'oklch(0.95 0.05 300)', border: 'oklch(0.72 0.13 300)', ink: 'oklch(0.38 0.12 300)' },
  { id: 'red', label: 'Red', bg: 'oklch(0.95 0.06 25)', border: 'oklch(0.72 0.14 25)', ink: 'oklch(0.40 0.13 25)' },
];

function mnBlockLabelPalette(color = '') {
  return MN_BLOCK_LABEL_COLORS.find(item => item.id === color) || MN_BLOCK_LABEL_COLORS[0];
}

function mnCreateBlockLabel() {
  return {
    id: `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    text: '',
    color: 'yellow',
  };
}

const MN_BLOCK_CLIPBOARD_TYPE = BLOCK_CLIPBOARD_TYPE;
const mnIsClipboardBlock = isClipboardBlock;
const mnReidBlocks = blocks => reidBlocks(blocks, mnCloneBlocks);
const mnNormalizeClipboardMarkdown = normalizeClipboardMarkdown;
const mnLooksLikeBlockMarkdown = looksLikeBlockMarkdown;
const MN_LOGSEQ = { mnIsPropertyLine, mnParseProperty, mnWorkflow };

// ── Selection toolbar (floats above selected text) ────────────────────
import { MnBlockRowView } from './BlockRowView.jsx';
import { blockRowMemoEqual } from './blockRowMemo.mjs';

function MnBlockRow({
  block, depth, focusId, T, allNotes, vaultId = '',
  allCanvases = [], onOpenCanvas, onCreateCanvas,
  onChange, onChangeKind, onIndent, onOutdent, onSplit, onMergePrev,
  onInsertBlocksAt,
  onToggleCollapse, onToggleCheck, onSetAnnotation, onClearAnnotation,
  onFocusNext, onFocusPrev, onDelete, onOpen, onTagClick,
  onSelectionChange, setFocusId,
  onMove, onContextMenu, onZoom, onAiAction, aiEnabled = false, aiTarget,
  onBlockMouseDown, onBlockMouseEnter, selectedBlockIds,
  onBeginContentEdit, onEndContentEdit,
  onShowToast,
  editorFontSize,
  indentGuides = true,
  spellCheck = true,
  autoLink = true,
  collapseByDefault = false,
  parseClipboardBlocks,
  novelistMode = false,
  workflowEnabled = false,
}) {
  const [editing, setEditing] = useStateOE(focusId === block.id);
  const [autoQ, setAutoQ] = useStateOE(null);   // wiki autocomplete query
  const [autoIdx, setAutoIdx] = useStateOE(0);
  const [slashQ, setSlashQ] = useStateOE(null); // slash menu query
  const [slashIdx, setSlashIdx] = useStateOE(0);
  const [canvasPicker, setCanvasPicker] = useStateOE(false);
  const [dropPos, setDropPos] = useStateOE(null); // 'before' | 'after' | 'child' | null
  const [spellIssues, setSpellIssues] = useStateOE({});
  const [spellMenu, setSpellMenu] = useStateOE(null);
  const [editingLabelId, setEditingLabelId] = useStateOE(null);
  const [labelMenu, setLabelMenu] = useStateOE(null);
  const [ignoredSpellWords, setIgnoredSpellWords] = useStateOE(() => new Set());
  const inputRef = useRefOE(null);
  const displayTextRef = useRefOE(null);
  const pendingCaretRef = useRefOE(null);

  useEffectOE(() => {
    if (focusId === block.id) {
      onBeginContentEdit && onBeginContentEdit(block.id);
      setEditing(true);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const pos = pendingCaretRef.current ?? inputRef.current.value.length;
          pendingCaretRef.current = null;
          inputRef.current.setSelectionRange(pos, pos);
        }
      }, 0);
    }
  }, [focusId, block.id]);

  // Auto-resize textarea
  useLayoutEffectOE(() => {
    if (inputRef.current && editing) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [block.content, editing]);

  useEffectOE(() => {
    if (!spellCheck || editing || block.kind === 'code' || block.kind === 'table' || !platformApi.available) {
      setSpellIssues({});
      setSpellMenu(null);
      return;
    }
    const words = mnSpellWords(block.content).filter(word => !ignoredSpellWords.has(word.toLowerCase()));
    if (!words.length) {
      setSpellIssues({});
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await platformApi.app.spellcheck(words);
        if (!cancelled) setSpellIssues(res?.ok ? (res.value || {}) : {});
      } catch (e) {
        if (!cancelled) setSpellIssues({});
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [block.content, block.kind, editing, spellCheck, ignoredSpellWords]);

  const hasChildren = block.children && block.children.length > 0;
  const isList = mnIsListLike(block.kind);
  const indentPx = depth * 24;
  const aiActive =
    (aiTarget?.scope === 'section' && aiTarget.blockId === block.id) ||
    (aiTarget?.scope === 'selection' && (aiTarget.blockIds || []).includes(block.id));
  const selectedAsArea = selectedBlockIds?.has(block.id);
  const blockLabels = mnNormalizeBlockLabels ? mnNormalizeBlockLabels(block.labels || []) : (block.labels || []);

  useEffectOE(() => {
    if (!labelMenu) return;
    const close = () => setLabelMenu(null);
    const closeOnEscape = (e) => { if (e.key === 'Escape') close(); };
    const timer = setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [labelMenu]);

  const slashMatches = useMemoOE(() => {
    if (slashQ == null) return [];
    return mnSlashCommands({
      novelistMode,
      aiEnabled,
      canvasEnabled: !!onCreateCanvas,
      workflowEnabled,
    })
      .map((cmd, index) => ({ cmd, index, score: mnSlashCommandScore(cmd, slashQ.query) }))
      .filter(x => x.score !== Infinity)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(x => x.cmd);
  }, [aiEnabled, novelistMode, onCreateCanvas, slashQ, workflowEnabled]);

  const wikiSuggestions = useMemoOE(() => {
    if (!autoLink) return [];
    if (autoQ == null) return [];
    const q = autoQ.toLowerCase();
    return (allNotes || []).filter(n => n.title.toLowerCase().includes(q)).slice(0, 6);
  }, [autoQ, allNotes, autoLink]);

  // ── keyboard ─────────────────────────────────────────────────────
  const handleKey = (e) => {
    // Slash menu nav has highest priority
    if (slashQ != null) {
      if (e.key === 'ArrowDown' && slashMatches.length > 0) { e.preventDefault(); setSlashIdx(i => Math.min(i + 1, slashMatches.length - 1)); return; }
      if (e.key === 'ArrowUp' && slashMatches.length > 0)   { e.preventDefault(); setSlashIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!slashMatches.length) return;
        e.preventDefault();
        applySlashCmd(slashMatches[Math.min(slashIdx, slashMatches.length - 1)]);
        return;
      }
      if (e.key === 'Escape')    { e.preventDefault(); setSlashQ(null); return; }
    }
    // Wiki suggestion nav
    if (autoQ != null && wikiSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAutoIdx(i => Math.min(i + 1, wikiSuggestions.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAutoIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter')     { e.preventDefault(); pickSuggestion(wikiSuggestions[autoIdx].title); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setAutoQ(null); return; }
    }

    // Tab/Shift+Tab — indent/outdent works for all blocks.
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) onOutdent(block.id);
      else onIndent(block.id);
      return;
    }

    // Enter handling — depends on kind
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEnter();
      return;
    }
    // Shift+Enter — soft line break inside block
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const ta = inputRef.current;
      if (!ta) return;
      const pos = MN_MARKDOWN_INPUT_RULES.editorOffsetToContentOffset?.(block, ta.selectionStart) ?? ta.selectionStart;
      const v = String(block.content || '');
      const next = v.slice(0, pos) + '\n' + v.slice(pos);
      onChange(block.id, next);
      setTimeout(() => {
        if (inputRef.current) {
          const nextEditorPos = MN_MARKDOWN_INPUT_RULES.contentOffsetToEditorOffset?.(block, pos + 1) ?? (pos + 1);
          inputRef.current.setSelectionRange(nextEditorPos, nextEditorPos);
        }
      }, 0);
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const ta = inputRef.current;
      if (ta && ta.selectionStart === 0 && !ta.value.slice(0, ta.selectionStart).includes('\n')) {
        e.preventDefault();
        onFocusPrev(block.id);
      }
    }
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const ta = inputRef.current;
      if (ta && ta.selectionStart === ta.value.length) {
        e.preventDefault();
        onFocusNext(block.id);
      }
    }
    if (e.key === 'Backspace') {
      const ta = inputRef.current;
      if (ta && ta.selectionStart === 0 && ta.selectionEnd === 0) {
        // At start of block — convert formatted block back to paragraph, or merge with previous
        if (block.kind !== 'paragraph') {
          e.preventDefault();
          onChangeKind(block.id, { kind: 'paragraph', level: 0, checked: null, language: '' });
          return;
        }
        if (ta.value === '') {
          e.preventDefault();
          onDelete(block.id);
          return;
        }
        // Merge with previous
        e.preventDefault();
        onMergePrev(block.id);
      }
    }
  };

  const handleEnter = () => {
    const ta = inputRef.current;
    const pos = MN_MARKDOWN_INPUT_RULES.editorOffsetToContentOffset?.(block, ta?.selectionStart ?? block.content.length)
      ?? (ta?.selectionStart ?? block.content.length);
    const isEmptyBlock = block.content.trim() === '';
    // Empty nested blocks leave the current parent before creating more empty
    // children. At root, formatted empty blocks exit to paragraph.
    if (isEmptyBlock) {
      if (depth > 0) { onOutdent(block.id); return; }
      if (block.kind !== 'paragraph') {
        onChangeKind(block.id, { kind: 'paragraph', level: 0, checked: null });
        return;
      }
    }

    // What kind should the next block be?
    // Default: paragraph (plain text). Bullets/todos continue their kind so
    // a list flows naturally. Headings/quotes/code break out to paragraph.
    const nextBlock = MN_MARKDOWN_INPUT_RULES.continuationBlockPatch(block);
    // paragraph, heading, quote, code, divider → paragraph

    onSplit(block.id, pos, nextBlock);
  };

  // ── input handlers ───────────────────────────────────────────────
  const applyEditorValue = (value, caret = null) => {
    const parsed = MN_MARKDOWN_INPUT_RULES.parseEditableMarkdownBlock?.({ block, text: value });
    if (parsed?.patch) onChangeKind(block.id, parsed.patch);
    else onChange(block.id, value);
    if (caret != null) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(caret, caret);
        }
      }, 0);
    }
  };

  const handleInput = (e) => {
    const v = e.target.value;
    const pos = e.target.selectionStart;
    const parsed = MN_MARKDOWN_INPUT_RULES.parseEditableMarkdownBlock?.({ block, text: v });
    if (parsed?.patch) onChangeKind(block.id, parsed.patch);
    else {
      const blockStarter = MN_MARKDOWN_INPUT_RULES.findBlockStarterConversion?.({
        block,
        text: v,
        cursor: pos,
        inputType: e.nativeEvent?.inputType,
      });
      if (blockStarter) {
        onChangeKind(block.id, blockStarter.patch);
        pendingCaretRef.current = blockStarter.caret;
      } else {
        onChange(block.id, v);
      }
    }
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
    const before = v.slice(0, pos);
    // Wiki autocomplete
    const wm = autoLink ? before.match(/\[\[([^\]\n]*)$/) : null;
    setAutoQ(wm ? wm[1] : null);
    if (wm) setAutoIdx(0);
    // Slash menu — trigger when `/` appears at start of content or after a
    // non-word character. Store the exact range so command application strips
    // the same text that opened the menu.
    const sm = mnFindSlashCommandTrigger(v, pos);
    if (sm) {
      setSlashQ(sm);
      setSlashIdx(0);
    } else {
      setSlashQ(null);
    }
  };

  const {
    attachmentFiles,
    blockAcceptsAttachmentDrops,
    insertAttachmentMarkdown,
    latestContentRef,
  } = useAttachmentInsertion({ block, vaultId, inputRef, onChange, onShowToast });

  const handlePaste = (e) => {
    const markdown = mnClipboardEventToMarkdownTable && mnClipboardEventToMarkdownTable(e);
    const ta = inputRef.current;
    if (!ta) return;
    const start = MN_MARKDOWN_INPUT_RULES.editorOffsetToContentOffset?.(block, ta.selectionStart ?? 0) ?? (ta.selectionStart ?? 0);
    const end = MN_MARKDOWN_INPUT_RULES.editorOffsetToContentOffset?.(block, ta.selectionEnd ?? ta.selectionStart ?? 0) ?? (ta.selectionEnd ?? start);
    const fullSelection = start === 0 && end === String(block.content || '').length;
    if (markdown) {
      e.preventDefault();
      setAutoQ(null);
      setSlashQ(null);
      if (!String(block.content || '').trim() || fullSelection) {
        onChangeKind(block.id, {
          kind: 'table',
          level: 0,
          checked: null,
          content: markdown,
          language: '',
        });
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(markdown.length, markdown.length);
          }
        }, 0);
        return;
      }
      const tableBlock = mkBlock({ kind: 'table', content: markdown });
      onInsertBlocksAt && onInsertBlocksAt(block.id, start, end, [tableBlock]);
      setFocusId && setFocusId(tableBlock.id);
      return;
    }
    const files = attachmentFiles.mnFilesFromDataTransfer(e.clipboardData) || [];
    if (files.length && blockAcceptsAttachmentDrops) {
      e.preventDefault();
      setAutoQ(null);
      setSlashQ(null);
      void insertAttachmentMarkdown(files, start, end);
      return;
    }
    const pastedBlocks = parseClipboardBlocks?.(e.clipboardData, { allowSingle: false });
    if (!pastedBlocks?.length) return;
    e.preventDefault();
    setAutoQ(null);
    setSlashQ(null);
    onInsertBlocksAt && onInsertBlocksAt(block.id, start, end, pastedBlocks);
    setFocusId && setFocusId(pastedBlocks[0].id);
  };

  const handleCopy = (e) => {
    const ta = inputRef.current;
    if (block.kind !== 'table' || !mnMarkdownTableToHtml) return;
    const html = mnMarkdownTableToHtml(block.content || '');
    if (!html || !e.clipboardData) return;
    const value = String(block.content || '');
    const start = ta?.selectionStart ?? 0;
    const end = ta?.selectionEnd ?? start;
    const hasSelection = start !== end;
    const fullSelection = hasSelection && start === 0 && end === value.length;
    if (!fullSelection) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', block.content || '');
    e.clipboardData.setData('text/html', html);
    return true;
  };

  const handleCut = (e) => {
    const copied = handleCopy(e);
    const ta = inputRef.current;
    if (!copied || !ta) return;
    const value = String(block.content || '');
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    if (start === end) return;
    onChange(block.id, value.slice(0, start) + value.slice(end));
    setTimeout(() => {
      if (inputRef.current) inputRef.current.setSelectionRange(start, start);
    }, 0);
  };

  const handleSelect = (e) => {
    const ta = e.target;
    const start = MN_MARKDOWN_INPUT_RULES.editorOffsetToContentOffset?.(block, ta.selectionStart) ?? ta.selectionStart;
    const end = MN_MARKDOWN_INPUT_RULES.editorOffsetToContentOffset?.(block, ta.selectionEnd) ?? ta.selectionEnd;
    if (start !== end && onSelectionChange) {
      // Use the textarea's bounding rect + caret position to estimate
      const rect = ta.getBoundingClientRect();
      // Approximate selection position: top of textarea
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 22;
      // Find approximate y of selection: count newlines before start
      const linesBefore = ta.value.slice(0, start).split('\n').length - 1;
      onSelectionChange({
        kind: 'text',
        blockId: block.id,
        start, end,
        rect: {
          top: rect.top + linesBefore * lineHeight,
          left: rect.left + 20,
          width: rect.width - 40,
          height: lineHeight,
        },
      });
    } else if (onSelectionChange) {
      onSelectionChange(null);
    }
  };

  const pickSuggestion = (title) => {
    const ta = inputRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const m = before.match(/\[\[([^\]\n]*)$/);
    if (!m) return;
    const newBefore = before.slice(0, m.index) + `[[${title}]]`;
    const newVal = newBefore + ta.value.slice(pos);
    applyEditorValue(newVal);
    setAutoQ(null);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(newBefore.length, newBefore.length);
    }, 0);
  };

  const setBlockLabels = (labels) => {
    onChangeKind(block.id, { labels: mnNormalizeBlockLabels ? mnNormalizeBlockLabels(labels) : labels });
  };

  const addBlockLabel = () => {
    const label = mnCreateBlockLabel();
    setBlockLabels([...blockLabels, label]);
    setEditingLabelId(label.id);
    return label;
  };

  const updateBlockLabel = (labelId, patch) => {
    setBlockLabels(blockLabels.map(label => label.id === labelId ? { ...label, ...patch } : label));
  };

  const removeBlockLabel = (labelId) => {
    setBlockLabels(blockLabels.filter(label => label.id !== labelId));
    if (editingLabelId === labelId) setEditingLabelId(null);
    if (labelMenu?.labelId === labelId) setLabelMenu(null);
  };

  const applySpellSuggestion = (suggestion) => {
    if (!spellMenu) return;
    const value = String(block.content || '');
    const replacement = /^[A-Z]/.test(spellMenu.word || '')
      ? suggestion.charAt(0).toUpperCase() + suggestion.slice(1)
      : suggestion;
    const next = value.slice(0, spellMenu.start) + replacement + value.slice(spellMenu.end);
    onChange(block.id, next);
    setSpellMenu(null);
  };

  const ignoreSpellWord = (word) => {
    const normalized = String(word || '').toLowerCase();
    if (!normalized) return;
    setIgnoredSpellWords(prev => {
      const next = new Set(prev);
      next.add(normalized);
      return next;
    });
    setSpellIssues(prev => {
      const next = { ...(prev || {}) };
      delete next[normalized];
      return next;
    });
    setSpellMenu(null);
  };

  const applySlashCmd = (cmd) => {
    const ta = inputRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const v = ta.value;
    // Strip the slash query from content using the stored trigger range.
    const sm = slashQ || mnFindSlashCommandTrigger(v, pos);
    let cleanContent = v;
    let newPos = pos;
    if (sm) {
      cleanContent = v.slice(0, sm.start) + v.slice(sm.end);
      newPos = sm.start;
    }
    if (cmd.aiAction) {
      onChange(block.id, cleanContent);
      setSlashQ(null);
      setSlashIdx(0);
      onAiAction && onAiAction(cmd.aiAction, cmd.aiScope || 'page', { blockId: block.id, cleanContent });
      return;
    }
    if (cmd.canvasAction) {
      onChange(block.id, cleanContent);
      setSlashQ(null);
      setSlashIdx(0);
      setEditing(false);
      setCanvasPicker(true);
      return;
    }
    if (cmd.blockLabelAction) {
      const label = mnCreateBlockLabel();
      onChangeKind(block.id, { content: cleanContent, labels: [...blockLabels, label] });
      setEditingLabelId(label.id);
      setSlashQ(null);
      setSlashIdx(0);
      return;
    }
    if (cmd.kind) {
      // Convert block kind and strip the slash text in one mutation. Splitting
      // this into onChangeKind() then onChange() can lose the kind update when
      // the parent supplies a non-React setBlocks wrapper.
      onChangeKind(block.id, {
        kind: cmd.kind,
        level: cmd.level || 0,
        checked: cmd.checked != null ? cmd.checked : null,
        listNumber: cmd.listNumber || 1,
        listDelimiter: cmd.listDelimiter || '.',
        content: cleanContent || cmd.content || '',
        language: '',
        beats: cmd.beats || block.beats || [],
        contexts: cmd.contexts || block.contexts || [],
        collapsed: collapseByDefault && cmd.kind === 'heading',
      });
    } else if (cmd.workflow !== undefined) {
      // Set workflow marker and strip the slash text atomically.
      onChangeKind(block.id, { workflow: cmd.workflow, content: cleanContent });
    } else if (cmd.insert || cmd.insertFn) {
      // Insert text at position
      const ins = cmd.insertFn ? cmd.insertFn() : cmd.insert;
      const next = cleanContent.slice(0, newPos) + ins + cleanContent.slice(newPos);
      onChange(block.id, next);
      newPos += ins.length;
    }
    setSlashQ(null);
    setSlashIdx(0);
    setTimeout(() => {
      const ta2 = inputRef.current;
      if (ta2) {
        ta2.focus();
        ta2.setSelectionRange(newPos, newPos);
      }
    }, 10);
  };

  // ── visual params per kind ──────────────────────────────────────
  const markdownDisplayProjection = MN_MARKDOWN_INPUT_RULES.displayProjectionForMarkdownSourceBlock?.(block);
  const displayBlock = markdownDisplayProjection?.block || block;
  const displaySourceOffset = markdownDisplayProjection?.sourceOffset || 0;
  const displayAnnotations = displaySourceOffset
    ? (block.annotations || [])
        .map(annotation => ({
          ...annotation,
          start: Math.max(0, Number(annotation.start) - displaySourceOffset),
          end: Math.max(0, Number(annotation.end) - displaySourceOffset),
        }))
        .filter(annotation => annotation.end > annotation.start)
    : block.annotations;
  const fontStyle = mnGetFontStyle(displayBlock, T, editorFontSize);
  const editorValue = MN_MARKDOWN_INPUT_RULES.editableMarkdownForBlock?.(block) ?? block.content;

  const textOffsetFromPoint = (container, clientX, clientY, fallback) => {
    if (!container || !block.content) return fallback;
    const caret = document.caretPositionFromPoint
      ? document.caretPositionFromPoint(clientX, clientY)
      : null;
    const range = !caret && document.caretRangeFromPoint
      ? document.caretRangeFromPoint(clientX, clientY)
      : null;
    const node = caret?.offsetNode || range?.startContainer;
    const offset = caret?.offset ?? range?.startOffset;
    if (!node || offset == null || !container.contains(node)) return fallback;
    let total = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current === node) return Math.max(0, Math.min(block.content.length, total + offset));
      total += current.nodeValue.length;
    }
    return fallback;
  };

  const startEdit = (e) => {
    const fallback = displayBlock.content.length;
    const contentCaret = e
      ? textOffsetFromPoint(displayTextRef.current, e.clientX, e.clientY, fallback)
      : fallback;
    pendingCaretRef.current = displaySourceOffset
      ? displaySourceOffset + contentCaret
      : (MN_MARKDOWN_INPUT_RULES.contentOffsetToEditorOffset?.(block, contentCaret) ?? contentCaret);
    onBeginContentEdit && onBeginContentEdit(block.id);
    setFocusId && setFocusId(block.id);
    setEditing(true);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = pendingCaretRef.current ?? (displaySourceOffset ? block.content.length : fallback);
        pendingCaretRef.current = null;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  if (block.kind === 'plot-points') {
    return (
      <MnPlotPointsBlock
        block={block}
        depth={depth}
        T={T}
        indentPx={indentPx}
        allNotes={allNotes}
        onChangeKind={onChangeKind}
        onDelete={onDelete}
        onAiAction={onAiAction}
        aiActive={aiActive} onBlockMouseDown={onBlockMouseDown} onBlockMouseEnter={onBlockMouseEnter} selectedAsArea={selectedAsArea}
      />
    );
  }

  // ── special render: divider ────────────────────────────────────
  if (block.kind === 'divider') {
    return (
      <div
        className="mn-block-row"
        data-block-id={block.id}
        data-block-kind="divider"
        data-block-depth={depth} data-mn-area-selected={selectedAsArea ? 'true' : undefined}
        onMouseDown={(e) => onBlockMouseDown && onBlockMouseDown(block.id, e)}
        onMouseEnter={() => onBlockMouseEnter && onBlockMouseEnter(block.id)}
        style={{
          marginLeft: indentPx,
          padding: '14px 0',
          position: 'relative', ...(selectedAsArea ? { background: T.selBg, outline: `1px solid color-mix(in oklab, ${T.accent || T.ink} 32%, transparent)`, outlineOffset: -1 } : {}),
        }}>
        <div style={{ height: 1, background: T.line, width: '100%' }} />
      </div>
    );
  }

  // ── render ──────────────────────────────────────────────────────
  return <MnBlockRowView model={{ vaultId, MN_APP_HELPERS, MN_BLOCK_LABEL_COLORS, MN_CODE_LANGUAGES, MN_LOGSEQ, MnBlockEmbed, MnCanvasEmbed, MnCanvasPicker, MnDisclosure, MnInlineAiButton, MnMarkdownTable, MnMathBlock, MnMermaidBlock, MnPageEmbed, MnPopover, MnPopoverHeader, MnPopoverItem, MnPropertyRow, MnSmartViewEmbed, MnSpellSuggestionMenu, MnWorkflowPill, T, addBlockLabel, aiActive, aiEnabled, aiTarget, allCanvases, allNotes, applyEditorValue, applySlashCmd, applySpellSuggestion, attachmentFiles, autoIdx, autoLink, autoQ, block, blockAcceptsAttachmentDrops, blockLabels, canvasPicker, collapseByDefault, depth, displayAnnotations, displayBlock, displaySourceOffset, displayTextRef, dropPos, editing, editingLabelId, editorFontSize, editorValue, focusId, fontStyle, handleCopy, handleCut, handleEnter, handleInput, handleKey, handlePaste, handleSelect, hasChildren, ignoreSpellWord, ignoredSpellWords, indentGuides, indentPx, inputRef, insertAttachmentMarkdown, isList, labelMenu, latestContentRef, markdownDisplayProjection, mnAffordancePadTop, mnBlockLabelPalette, mnCodeLanguageLabel, mnGripPadTop, mnIsPropertyLine, mnNormalizeCodeLanguage, mnParseProperty, mnPlaceholder, mnRenderAnnotated, mnRenderCode, mnRenderSpellCheckedText, mnWorkflow, novelistMode, onAiAction, onBeginContentEdit, onBlockMouseDown, onBlockMouseEnter, onChange, onChangeKind, onClearAnnotation, onContextMenu, onCreateCanvas, onDelete, onEndContentEdit, onFocusNext, onFocusPrev, onIndent, onInsertBlocksAt, onMergePrev, onMove, onOpen, onOpenCanvas, onOutdent, onSelectionChange, onSetAnnotation, onSplit, onTagClick, onToggleCheck, onToggleCollapse, onZoom, parseClipboardBlocks, pendingCaretRef, pickSuggestion, removeBlockLabel, selectedAsArea, selectedBlockIds, setAutoIdx, setAutoQ, setBlockLabels, setCanvasPicker, setDropPos, setEditing, setEditingLabelId, setFocusId, setIgnoredSpellWords, setLabelMenu, setSlashIdx, setSlashQ, setSpellIssues, setSpellMenu, slashIdx, slashMatches, slashQ, spellCheck, spellIssues, spellMenu, startEdit, textOffsetFromPoint, updateBlockLabel, wikiSuggestions, workflowEnabled }} />;
}

const MnMemoBlockRow = React.memo(MnBlockRow, blockRowMemoEqual);

export { MnBlockRow, MnMemoBlockRow, mnCreateBlockLabel };
