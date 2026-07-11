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
  mnMdToBlocks, mnNormalizeBlockLabels, mnWalk,
} from '../outline.jsx';
import { MnBlockContextMenu, MnBlockEmbed, MnPageEmbed, MnPropertyRow, MnWorkflowPill, MnZoomBar } from '../blockFeatures.jsx';
import MN_EDITOR_OPS from '../editorOps.js';
import MN_MARKDOWN_INPUT_RULES from '../markdownInputRules.js';
import MN_APP_HELPERS from '../../app/appHelpers.js';
import MN_TABLE_OPS from '../tableOps.js';
import { createEditorHistory as mnCreateEditorHistory, shareBlockTree as mnShareBlockTree } from '../outlinerHistory.js';
import { MN_REMIND } from '../../shared/markdown.jsx';
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
import { MnDisclosure } from './OutlinerChrome.jsx';

function MnPlotPointsBlock({ block, depth, T, indentPx, allNotes = [], onChangeKind, onDelete, onAiAction, aiActive = false }) {
  const [contextPickerOpen, setContextPickerOpen] = useStateOE(false);
  const [contextQuery, setContextQuery] = useStateOE('');
  const beats = Array.isArray(block.beats) && block.beats.length ? block.beats : [''];
  const contexts = Array.isArray(block.contexts) ? block.contexts : [];
  const linkedTitles = new Set(contexts.map(context => String(context || '').replace(/^\[\[|\]\]$/g, '').trim().toLowerCase()));
  const pageOptions = (allNotes || [])
    .filter(note => String(note?.title || '').trim())
    .filter(note => !linkedTitles.has(String(note.title || '').trim().toLowerCase()))
    .filter(note => {
      const query = contextQuery.trim().toLowerCase();
      return !query || String(note.title || '').toLowerCase().includes(query);
    })
    .slice(0, 8);
  const updateBeatsText = (value) => {
    const next = String(value || '').split('\n');
    onChangeKind(block.id, { beats: next.length ? next : [''] });
  };
  const addContextPage = (note) => {
    const title = String(note?.title || '').trim();
    if (!title) return;
    onChangeKind(block.id, { contexts: [...contexts, `[[${title}]]`] });
    setContextPickerOpen(false);
    setContextQuery('');
  };
  const removeContext = (index) => {
    onChangeKind(block.id, { contexts: contexts.filter((_, i) => i !== index) });
  };
  const aiButtonStyle = {
    ...mnTinyIconButton(T),
    cursor: aiActive ? 'wait' : 'pointer',
    opacity: aiActive ? 0.56 : 1,
  };
  return (
    <div
      className="mn-block-row mn-plot-points"
      data-block-id={block.id}
      style={{ paddingLeft: indentPx, marginTop: 10, position: 'relative' }}>
      <div style={{ width: 18, flexShrink: 0 }} />
      <div style={{
        flex: 1,
        border: `1px solid ${T.lineSub}`,
        borderRadius: 8,
        background: T.bgSub,
        overflow: 'hidden',
        boxShadow: aiActive ? `0 0 0 2px ${T.accentSoft || T.accent || T.lineSub}` : 'none',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 10px',
          borderBottom: block.hidden ? 'none' : `1px solid ${T.lineSub}`,
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          color: T.inkDim,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M1.5 8C3 3.5 5 3.5 6.5 8S10 12.5 11.5 8 14 3.5 15 8" strokeLinecap="round"/>
          </svg>
          <span style={{ color: T.ink }}>PLOT POINTS</span>
          <span style={{ opacity: 0.75 }}>Depth {depth}</span>
          <div style={{ flex: 1 }} />
          {aiActive && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              border: `1px solid ${T.lineSub}`,
              borderRadius: 999,
              background: T.bg,
              color: T.accent || T.ink,
              padding: '3px 7px',
              textTransform: 'none',
              letterSpacing: 0,
              fontFamily: 'var(--mn-ui)',
              fontSize: 11,
            }}>
              <MnAiIcon size={11} /> AI working
              <span className="mn-ai-live-dots" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span /> <span /> <span />
              </span>
            </span>
          )}
          <button onClick={() => onChangeKind(block.id, { hidden: !block.hidden })} style={mnTinyIconButton(T)}>{block.hidden ? 'Show' : 'Hide'}</button>
          <button disabled={aiActive} onClick={() => onAiAction?.('summarize', 'section', { blockId: block.id, plotPointsAction: 'summarize' })} style={aiButtonStyle}>Summarize</button>
          <button disabled={aiActive} onClick={() => onAiAction?.('write', 'section', { blockId: block.id, plotPointsAction: 'write-scene' })} style={aiButtonStyle}>Write Scene</button>
          <button disabled={aiActive} onClick={() => onAiAction?.('improve', 'section', { blockId: block.id, plotPointsAction: 'improve' })} style={aiButtonStyle}>Improve</button>
          <button onClick={() => onDelete(block.id)} style={{ ...mnTinyIconButton(T), color: T.danger || T.warn }}>x</button>
        </div>
        {!block.hidden && (
          <div style={{ display: 'grid', gap: 7, padding: 10 }}>
            <textarea
              value={beats.join('\n')}
              onChange={(e) => updateBeatsText(e.target.value)}
              placeholder="One plot point per line"
              rows={Math.max(4, Math.min(12, beats.length + 1))}
              style={{
                width: '100%',
                minHeight: 104,
                resize: 'vertical',
                border: `1px solid ${T.lineSub}`,
                borderRadius: 7,
                background: T.bg,
                color: T.ink,
                padding: '8px 9px',
                fontFamily: 'var(--mn-ui)',
                fontSize: 12.5,
                lineHeight: 1.5,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button onClick={() => setContextPickerOpen(value => !value)} style={mnTinyIconButton(T)}>Add context</button>
            </div>
            {contextPickerOpen && (
              <div style={{
                border: `1px solid ${T.lineSub}`,
                borderRadius: 7,
                background: T.bg,
                padding: 7,
                display: 'grid',
                gap: 5,
              }}>
                <input
                  value={contextQuery}
                  onChange={(e) => setContextQuery(e.target.value)}
                  autoFocus
                  placeholder="Find page to link"
                  style={{
                    border: `1px solid ${T.lineSub}`,
                    borderRadius: 6,
                    background: T.bgSub,
                    color: T.ink,
                    padding: '6px 8px',
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 12.5,
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'grid', gap: 3, maxHeight: 180, overflow: 'auto' }}>
                  {pageOptions.map(note => (
                    <button
                      key={note.id}
                      onClick={() => addContextPage(note)}
                      style={{
                        border: 'none',
                        borderRadius: 5,
                        background: 'transparent',
                        color: T.ink,
                        cursor: 'pointer',
                        padding: '6px 7px',
                        textAlign: 'left',
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {note.title}
                    </button>
                  ))}
                  {!pageOptions.length && (
                    <div style={{ padding: '8px 7px', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim }}>
                      No available pages
                    </div>
                  )}
                </div>
              </div>
            )}
            {contexts.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {contexts.map((context, index) => (
                  <span
                    key={index}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      border: `1px solid ${T.lineSub}`,
                      borderRadius: 999,
                      background: T.bg,
                      color: T.inkMed,
                      padding: '4px 9px',
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10.5,
                    }}>
                    {context}
                    <button
                      onClick={() => removeContext(index)}
                      title="Remove context"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: T.inkDim,
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'var(--mn-mono)',
                        fontSize: 10,
                        lineHeight: 1,
                      }}>x</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function mnTinyIconButton(T) {
  return {
    minHeight: 23,
    borderRadius: 5,
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    cursor: 'pointer',
    padding: '3px 7px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11,
  };
}

function MnInlineAiButton({ block, T, onAiAction }) {
  return (
    <button
      className="mn-block-ai"
      title="AI actions for this section"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAiAction && onAiAction('improve', 'section-menu', {
          blockId: block.id,
          x: e.clientX,
          y: e.clientY,
        });
      }}
      style={{
        display: 'flex',
        width: 21,
        height: 21,
        marginLeft: 8,
        marginTop: mnGripPadTop(block),
        flexShrink: 0,
        borderRadius: 6,
        border: `1px solid ${T.lineSub}`,
        background: T.bg,
        color: T.inkDim,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        cursor: 'pointer',
        opacity: 0,
        transition: 'opacity 120ms, background 120ms, color 120ms, box-shadow 120ms',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = T.bgHover;
        e.currentTarget.style.color = T.accent || T.ink;
        e.currentTarget.style.boxShadow = `0 6px 18px color-mix(in oklab, ${T.accent || T.ink} 18%, transparent)`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = T.bg;
        e.currentTarget.style.color = T.inkDim;
        e.currentTarget.style.boxShadow = 'none';
      }}>
      <MnAiIcon size={12} />
    </button>
  );
}

function mnSmartViewEmbedSource(result = {}) {
  return result.sourceNoteTitle || result.noteTitle || result.source?.noteTitle || '';
}

function mnSmartViewEmbedPreview(result = {}) {
  if (result.type === 'note') {
    return String(result.note?.body || '')
      .split('\n')
      .map(line => line.replace(/^#{1,4}\s+/, '').replace(/^\s*-\s+\[[ xX]\]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 1)
      .join(' ');
  }
  return result.label || result.text || '';
}

function MnSmartViewEmbedFallback({ raw, error, T }) {
  return (
    <div style={{
      margin: '6px 0',
      padding: '8px 10px',
      border: `1px dashed ${T.warn || T.line}`,
      borderRadius: 6,
      background: T.bgSub,
      color: T.inkMed,
      fontFamily: 'var(--mn-mono)',
      fontSize: 11,
      whiteSpace: 'pre-wrap',
    }}>
      <div>{raw}</div>
      {error && (
        <div style={{ marginTop: 5, color: T.warn || T.inkDim }}>
          Smart View embed not rendered: {error}
        </div>
      )}
    </div>
  );
}

function MnSmartViewEmbed({ embed, allNotes = [], T, onOpen }) {
  const helpers = MN_APP_HELPERS;
  if (!embed?.ok || !embed.definition || !helpers.smartViewQuery) {
    return <MnSmartViewEmbedFallback raw={embed?.raw || ''} error={embed?.error || 'Smart Views are unavailable.'} T={T} />;
  }
  let results = [];
  try {
    results = helpers.smartViewQuery(allNotes, embed.definition, { parser: MN_REMIND, walk: mnWalk, allNotes });
  } catch (error) {
    return <MnSmartViewEmbedFallback raw={embed.raw} error={error?.message || 'Smart View query failed.'} T={T} />;
  }
  const visible = results.slice(0, 6);
  return (
    <div
      data-mn-smart-view-embed="rendered"
      style={{
        margin: '6px 0',
        padding: '9px 11px',
        background: T.bgSub,
        border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${T.focus || T.accent}`,
        borderRadius: 6,
        fontFamily: 'var(--mn-ui)',
      }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 7,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 760, color: T.ink }}>
            {embed.definition.title || 'Smart View'}
          </div>
          <div style={{ marginTop: 2, fontSize: 10.5, color: T.inkDim }}>
            Smart View - {results.length} result{results.length === 1 ? '' : 's'}
          </div>
        </div>
        <span style={{
          flexShrink: 0,
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          color: T.inkDim,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 4,
          padding: '2px 5px',
          background: T.bg,
        }}>{embed.mode || 'inline'}</span>
      </div>
      {!visible.length ? (
        <div style={{ fontSize: 12, color: T.inkDim }}>No results</div>
      ) : visible.map(result => {
        const noteId = result.noteId || result.source?.noteId || '';
        const source = mnSmartViewEmbedSource(result);
        return (
          <div key={result.key || result.id || `${noteId}:${result.label || result.title}`} style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: 8,
            padding: '6px 0',
            borderTop: `1px solid ${T.lineSub}`,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12.5,
                fontWeight: 650,
                color: T.ink,
              }}>{result.title || result.label || 'Untitled'}</div>
              <div style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 2,
                fontSize: 11,
                color: T.inkDim,
              }}>{source || mnSmartViewEmbedPreview(result)}</div>
            </div>
            {noteId && (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(null, noteId);
                }}
                style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 5,
                  background: T.bg,
                  color: T.ink,
                  padding: '4px 7px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Open
              </button>
            )}
          </div>
        );
      })}
      {results.length > visible.length && (
        <div style={{ marginTop: 4, fontSize: 10.5, color: T.inkDim }}>
          + {results.length - visible.length} more
        </div>
      )}
    </div>
  );
}

function MnMarkdownTable({ markdown, T }) {
  const rows = mnMarkdownTableToRows ? mnMarkdownTableToRows(markdown || '') : [];
  if (!rows.length) {
    return <span style={{ color: T.inkDim, fontStyle: 'italic' }}>Empty table</span>;
  }
  const cellBase = {
    padding: '6px 9px',
    border: `1px solid ${T.lineSub}`,
    textAlign: 'left',
    verticalAlign: 'top',
    whiteSpace: 'pre-wrap',
  };
  return (
    <div style={{
      overflowX: 'auto',
      maxWidth: '100%',
      padding: '2px 0',
    }}>
      <table style={{
        borderCollapse: 'collapse',
        minWidth: 280,
        maxWidth: '100%',
        fontFamily: 'var(--mn-ui)',
        fontSize: 12.5,
        lineHeight: 1.45,
        color: T.ink,
        background: T.bg,
      }}>
        <thead>
          <tr>
            {rows[0].map((cell, i) => (
              <th key={i} style={{
                ...cellBase,
                background: T.bgSub,
                fontWeight: 650,
                color: T.ink,
              }}>{cell || '\u00a0'}</th>
            ))}
          </tr>
        </thead>
        {rows.length > 1 && (
          <tbody>
            {rows.slice(1).map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{
                    ...cellBase,
                    background: r % 2 ? T.bgSub : T.bg,
                    color: T.inkMed,
                  }}>{cell || '\u00a0'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────
function mnEditorFontScale(size) {
  if (size === 'small') return 0.9;
  if (size === 'large') return 1.1;
  if (size === 'x-large') return 1.22;
  return 1;
}

function mnGetFontStyle(block, T, editorFontSize) {
  const scale = mnEditorFontScale(editorFontSize);
  if (block.kind === 'heading') {
    const sizes = { 1: 26, 2: 20, 3: 17, 4: 15.5, 5: 14.5, 6: 14.5 };
    return {
      fontFamily: 'var(--mn-body)', fontSize: (sizes[block.level] || 17) * scale,
      fontWeight: 600, color: T.ink, letterSpacing: 0, lineHeight: 1.25,
    };
  }
  if (block.kind === 'code') {
    return {
      fontFamily: 'var(--mn-mono)', fontSize: 13 * scale, color: T.ink, lineHeight: 1.5,
    };
  }
  if (block.kind === 'table') {
    return {
      fontFamily: 'var(--mn-mono)', fontSize: 12.5 * scale, color: T.ink, lineHeight: 1.45,
    };
  }
  if (block.kind === 'quote') {
    return {
      fontFamily: 'var(--mn-body)', fontSize: 14.5 * scale, fontStyle: 'italic',
      color: T.inkMed, lineHeight: 1.55,
    };
  }
  return {
    fontFamily: 'var(--mn-body)', fontSize: 14.5 * scale, color: T.ink, lineHeight: 1.55,
  };
}
function mnAffordancePadTop(block) {
  if (block.kind === 'heading') return 0;
  if (block.kind === 'bullet') return 5;
  // Wrapper provides only enough padding so the bullet/grip span sits at the
  // top of the row; per-block fine-tuning happens in mnGripPadTop.
  return 0;
}
// Grip handle baseline: align with vertical center of first line of text.
// Body text uses lineHeight 1.55, font 14.5px → row≈22.5px, text center≈12px.
// Grip span is 14×14, so marginTop = 12 − 7 = 5 puts the grip center on the
// text center.
function mnGripPadTop(block) {
  if (block.kind === 'heading') {
    // h1=26px*1.25=32.5 line, center 16, padTop=9
    // h2=20px*1.25=25,    center 12.5, padTop=6
    // h3=17px*1.25=21.25, center 10.6, padTop=4
    if (block.level === 1) return 9;
    if (block.level === 2) return 6;
    return 4;
  }
  if (block.kind === 'quote') return 5;
  if (block.kind === 'code') return 8;
  if (block.kind === 'table') return 6;
  return 5;
}
function mnPlaceholder(block) {
  if (block.kind === 'heading') return `Heading ${block.level || 1}`;
  if (block.kind === 'bullet') return 'List item';
  if (block.kind === 'todo')   return 'Task';
  if (block.kind === 'quote')  return 'Quote';
  if (block.kind === 'code')   return 'Code';
  if (block.kind === 'table')  return '| Column 1 | Column 2 |';
  return 'Type / for commands';
}

// ── Popover primitives ─────────────────────────────────────────────────

export { MnPlotPointsBlock, MnInlineAiButton, MnSmartViewEmbedFallback, MnSmartViewEmbed, MnMarkdownTable, mnEditorFontScale, mnGetFontStyle, mnAffordancePadTop, mnGripPadTop, mnPlaceholder };
