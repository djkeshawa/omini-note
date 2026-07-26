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
} from '../../features/editor/outliner/index.js';
import { platformApi } from '../../platform/index.js';
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
import { mnReportAiOutput } from '../../ai/aiModels.js';

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

function MnPopover({ children, T, wide, anchorRef }) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  const measure = React.useCallback(() => {
    const anchor = anchorRef && anchorRef.current;
    if (!anchor || !ref.current) return;
    const ar = anchor.getBoundingClientRect();
    const pr = ref.current.getBoundingClientRect();
    const margin = 6;
    const popH = pr.height || 200;
    const popW = pr.width || (wide ? 300 : 220);
    const spaceBelow = window.innerHeight - ar.bottom;
    const openUp = spaceBelow < popH + margin && ar.top > popH + margin;
    let top = openUp ? Math.max(margin, ar.top - popH - margin) : ar.bottom + margin;
    let left = ar.left;
    if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
    if (left < margin) left = margin;
    setPos(prev => (prev && prev.top === top && prev.left === left) ? prev : { top, left });
  }, [anchorRef, wide]);
  React.useLayoutEffect(() => {
    const handle = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(handle);
  }, [measure, children]);
  React.useLayoutEffect(() => {
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);
  return (
    <div ref={ref} style={{
      position: 'fixed',
      top: pos ? pos.top : -9999, left: pos ? pos.left : -9999,
      background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8,
      padding: 4, zIndex: 9999,
      minWidth: wide ? 300 : 220,
      maxHeight: 360, overflow: 'auto',
      boxShadow: `0 12px 32px color-mix(in oklab, ${T.ink} 18%, transparent), 0 1px 2px color-mix(in oklab, ${T.ink} 8%, transparent)`,
    }}>
      {children}
    </div>
  );
}
function MnPopoverHeader({ children, T }) {
  return (
    <div style={{
      padding: '6px 10px 4px', fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11,
        color: T.inkDim,
      display: 'flex', alignItems: 'center', gap: 4,
    }}>{children}</div>
  );
}
function MnPopoverItem({ children, active, T, ...rest }) {
  return (
    <div {...rest} style={{
      padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
      fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink,
      background: active ? T.selBg : 'transparent',
    }}>{children}</div>
  );
}

function MnAiActionMenu({ scope, x, y, onPick, onClose, T, busy }) {
  const [activeIdx, setActiveIdx] = React.useState(0);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const focusHandle = setTimeout(() => menuRef.current?.focus(), 0);
    const onDown = (e) => {
      if (!e.target.closest?.('.mn-ai-action-menu')) onClose();
    };
    const listenerHandle = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(focusHandle);
      clearTimeout(listenerHandle);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const labelFor = (a) => {
    if (scope === 'page') return a.pageLabel;
    if (scope === 'selection-blocks') return a.selectionLabel.replace('selected text', 'selected blocks');
    if (scope === 'selection') return a.selectionLabel;
    return a.sectionLabel;
  };
  const pickAction = (actionId) => {
    if (busy) return;
    onClose();
    onPick(actionId);
  };
  return (
    <div
      ref={menuRef}
      className="mn-ai-action-menu"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIdx(i => Math.min(i + 1, MN_AI_ACTIONS.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Home') {
          e.preventDefault();
          setActiveIdx(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          setActiveIdx(MN_AI_ACTIONS.length - 1);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickAction(MN_AI_ACTIONS[activeIdx].id);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        top: Math.min(y, window.innerHeight - 260),
        left: Math.min(x, window.innerWidth - 300),
        zIndex: 10000,
        width: 280,
        padding: 5,
        background: T.bg,
        border: `1px solid ${T.line}`,
        borderRadius: 8,
        boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent), 0 1px 2px color-mix(in oklab, ${T.ink} 8%, transparent)`,
        fontFamily: 'var(--mn-ui)',
        outline: 'none',
      }}>
      <div style={{
        padding: '7px 9px 5px',
        fontFamily: 'var(--mn-ui)', fontWeight: 600,
        fontSize: 11,
        color: T.inkDim,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <MnAiIcon size={12} />
        {scope === 'page' ? 'AI edit page' : scope === 'selection-blocks' ? 'AI edit selected blocks' : scope === 'selection' ? 'AI edit selected text' : 'AI edit section'}
      </div>
      {MN_AI_ACTIONS.map((a, i) => (
        <button
          key={a.id}
          disabled={busy}
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={(e) => {
            e.preventDefault();
            pickAction(a.id);
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 9px',
            border: 'none',
            borderRadius: 6,
            background: i === activeIdx ? T.bgHover : 'transparent',
            color: T.ink,
            cursor: busy ? 'wait' : 'pointer',
            textAlign: 'left',
            fontFamily: 'var(--mn-ui)',
          }}
          onMouseEnter={e => {
            setActiveIdx(i);
            e.currentTarget.style.background = T.bgHover;
          }}
          onMouseLeave={e => e.currentTarget.style.background = i === activeIdx ? T.bgHover : 'transparent'}>
          <span style={{
            width: 24, height: 24, borderRadius: 5,
            border: `1px solid ${T.lineSub}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: T.inkMed,
            flexShrink: 0,
          }}>{a.icon === '✦' ? <MnAiIcon size={12} /> : a.icon}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{labelFor(a)}</span>
            <span style={{ display: 'block', fontSize: 11, color: T.inkDim, marginTop: 1 }}>{a.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function MnAiPreviewDialog({ preview, onCancel, onApply, T }) {
  if (!preview) return null;
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 11000,
        background: 'color-mix(in oklab, oklch(0.2 0.02 240) 28%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}>
      <div style={{
        width: 'min(720px, 100%)',
        maxHeight: '78vh',
        background: T.bg,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 24%, transparent)`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '13px 16px',
          borderBottom: `1px solid ${T.lineSub}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--mn-ui)',
          fontSize: 13,
          fontWeight: 600,
        }}>
          <MnAiIcon size={14} />
          Preview AI writing
        </div>
        <div style={{
          padding: 16,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--mn-body)',
          fontSize: 14,
          lineHeight: 1.6,
          color: T.ink,
          background: T.bgSub,
          borderBottom: `1px solid ${T.lineSub}`,
        }}>{preview.text}</div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: 12,
          background: T.bg,
        }}>
          <button
            onClick={() => mnReportAiOutput({ output: preview.text, scope: 'AI writing preview' })}
            style={mnAiReportBtn(T)}>
            Report AI output
          </button>
          <button onClick={onCancel} style={mnAiDialogBtn(T, false)}>Cancel</button>
          <button onClick={onApply} style={mnAiDialogBtn(T, true)}>Apply change</button>
        </div>
      </div>
    </div>
  );
}

function mnAiDialogBtn(T, primary) {
  return {
    border: `1px solid ${primary ? T.ink : T.line}`,
    background: primary ? T.ink : T.bg,
    color: primary ? T.bg : T.ink,
    borderRadius: 6,
    padding: '7px 12px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    cursor: 'pointer',
  };
}

function MnInlineAiPreview({ preview, depth, T, onApply, onCancel }) {
  if (!preview) return null;
  const text = String(preview.text || '');
  const canApply = !!text.trim() && !preview.streaming && !preview.error;
  return (
    <div
      className={`mn-inline-ai-preview${preview.streaming ? ' mn-inline-ai-preview-streaming' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        marginLeft: depth * 24,
        paddingLeft: 18,
        marginTop: 7,
        marginBottom: 8,
        display: 'flex',
        gap: 8,
        color: T.inkDim,
      }}>
      <div style={{ width: 14, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 7 }}>
        <MnAiIcon size={12} />
      </div>
      <div style={{
        flex: 1,
        minWidth: 0,
        border: `1px dashed ${T.lineSub}`,
        borderRadius: 8,
        background: `color-mix(in oklab, ${T.bgSub} 74%, ${T.bg})`,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 9px',
          borderBottom: `1px solid ${T.lineSub}`,
          fontFamily: 'var(--mn-ui)',
          fontSize: 11.5,
          color: T.inkDim,
        }}>
          <span style={{ fontWeight: 600, color: T.inkMed }}>AI preview</span>
          {preview.streaming && (
            <span className="mn-ai-live-dots" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span /> <span /> <span />
            </span>
          )}
          {preview.error && <span style={{ color: T.danger || T.warn }}>{preview.error}</span>}
          <div style={{ flex: 1 }} />
          {!preview.error && (
            <button
              disabled={!text.trim()}
              onClick={() => mnReportAiOutput({ output: text, scope: 'AI inline preview' })}
              style={mnAiInlineReportBtn(T, !text.trim())}>
              Report
            </button>
          )}
          <button onClick={onCancel} style={mnAiInlineBtn(T, false)}>Discard</button>
          <button disabled={!canApply} onClick={onApply} style={mnAiInlineBtn(T, true, !canApply)}>Apply</button>
        </div>
        <div style={{
          padding: '9px 10px 11px',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--mn-body)',
          fontSize: 14,
          lineHeight: 1.6,
          color: T.inkDim,
          minHeight: 34,
        }}>
          {text || (preview.streaming ? 'Writing preview...' : 'No preview text returned.')}
        </div>
      </div>
    </div>
  );
}

function mnAiInlineBtn(T, primary, disabled = false) {
  return {
    border: `1px solid ${primary ? T.ink : T.lineSub}`,
    background: primary ? T.ink : T.bg,
    color: primary ? T.bg : T.inkMed,
    borderRadius: 6,
    padding: '4px 8px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11.5,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
}
function mnAiReportBtn(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkDim,
    borderRadius: 6,
    padding: '7px 12px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    cursor: 'pointer',
    marginRight: 'auto',
  };
}
function mnAiInlineReportBtn(T, disabled = false) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkDim,
    borderRadius: 6,
    padding: '4px 8px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11.5,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
}

// ── Recursive tree renderer ────────────────────────────────────────────

export { MnPopover, MnPopoverHeader, MnPopoverItem, MnAiActionMenu, MnAiPreviewDialog, MnInlineAiPreview };
