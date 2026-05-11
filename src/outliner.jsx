// VispNote outliner — typed-block editor.
//
// Block kinds: paragraph (default), heading, bullet, todo, quote, code, table, divider.
// - Enter behavior depends on kind (see handleEnter).
// - Tab/Shift+Tab: indent/outdent (only for bullet/todo).
// - Disclosure triangle: separate from bullet, only shown when block has children.
// - Selection toolbar: appears on text selection, applies annotations.
// - Slash menu: type "/" at start of an empty block (or after space) to convert.

const { useState: useStateOE, useRef: useRefOE, useEffect: useEffectOE,
        useMemo: useMemoOE, useLayoutEffect: useLayoutEffectOE } = React;
const {
  mkBlock, mnLocate, mnCloneBlocks, mnFlatten, mnIsListLike,
  mnBlocksToMd, mnMdToBlocks, mnNormalizeBlockLabels,
} = window.MN_OUTLINE;
const MnInline = window.MnInline;
const MnWorkflowPill = window.MnWorkflowPill;
const MnPropertyRow = window.MnPropertyRow;
const MnPageEmbed = window.MnPageEmbed;
const MnBlockEmbed = window.MnBlockEmbed;
const MnCanvasEmbed = window.MnCanvasEmbed;
const MnBlockContextMenu = window.MnBlockContextMenu;
const MnZoomBar = window.MnZoomBar;
const {
  clearAnnotationRange: mnClearAnnotationRange,
  applyAnnotationRange: mnApplyAnnotationRange,
  replaceTextRange: mnReplaceTextRange,
  updateBlockContent: mnUpdateBlockContent,
  splitBlock: mnSplitBlock,
  splitAnnotations: mnSplitAnnotations,
  mergeBlockContent: mnMergeBlockContent,
} = window.MN_EDITOR_OPS;
const {
  clipboardEventToMarkdownTable: mnClipboardEventToMarkdownTable,
  markdownTableToRows: mnMarkdownTableToRows,
  markdownTableToHtml: mnMarkdownTableToHtml,
} = window.MN_TABLE_OPS || {};
const {
  createEditorHistory: mnCreateEditorHistory,
  shareBlockTree: mnShareBlockTree,
} = window.MN_OUTLINER_HISTORY || {};

const MN_AI_ACTIONS = [
  {
    id: 'improve',
    icon: '✦',
    pageLabel: 'Improve writing on this page',
    sectionLabel: 'Improve this section',
    selectionLabel: 'Improve selected text',
    hint: 'Polish wording while preserving meaning',
    instruction: 'Improve the writing. Keep the meaning, tone, markdown structure, wiki-links, tags, and tasks intact.',
  },
  {
    id: 'format',
    icon: '≡',
    pageLabel: 'Format this page',
    sectionLabel: 'Format this section',
    selectionLabel: 'Format selected text',
    hint: 'Clean up structure and markdown',
    instruction: 'Format and organize the text. Improve markdown structure without adding new facts.',
  },
  {
    id: 'summarize',
    icon: 'Σ',
    pageLabel: 'Summarize this page',
    sectionLabel: 'Summarize this section',
    selectionLabel: 'Summarize selected text',
    hint: 'Replace with a concise summary',
    instruction: 'Summarize the text concisely. Preserve concrete decisions, tasks, dates, and named references.',
  },
  {
    id: 'concise',
    icon: '↘',
    pageLabel: 'Make this page concise',
    sectionLabel: 'Make this section concise',
    selectionLabel: 'Make selected text concise',
    hint: 'Shorten without losing meaning',
    instruction: 'Make the text more concise while preserving the important meaning and markdown structure.',
  },
  {
    id: 'fix',
    icon: '✓',
    pageLabel: 'Fix spelling and grammar on this page',
    sectionLabel: 'Fix spelling and grammar in this section',
    selectionLabel: 'Fix selected text',
    hint: 'Correct spelling and grammar',
    instruction: 'Fix spelling, grammar, and punctuation only. Do not rewrite more than necessary.',
  },
  {
    id: 'write',
    icon: '+',
    pageLabel: 'Write on this page',
    sectionLabel: 'Write in this section',
    selectionLabel: 'Write for selected text',
    hint: 'Draft new text from your instruction',
    instruction: 'Write new text for this location based on the user request. Preserve useful markdown style and return only the replacement text.',
    needsPrompt: true,
    preview: true,
  },
];

function mnAiAction(id) {
  return MN_AI_ACTIONS.find(a => a.id === id) || MN_AI_ACTIONS[0];
}

function MnAiIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
      <path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" strokeLinejoin="round"/>
      <path d="M4 3.5L4.7 5.1L6.2 5.8L4.7 6.5L4 8L3.3 6.5L1.8 5.8L3.3 5.1L4 3.5Z" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Annotated text rendering ───────────────────────────────────────────
// Annotations: array of { start, end, kind } overlapping spans
function mnRenderAnnotated(text, annotations, T, onOpen, onTagClick, allNotes) {
  if (!annotations || annotations.length === 0) {
    return <MnInline text={text} T={T} onOpen={onOpen} onTagClick={onTagClick} allNotes={allNotes} />;
  }
  // Build segments: split text at every annotation boundary
  const points = new Set([0, text.length]);
  for (const a of annotations) { points.add(a.start); points.add(a.end); }
  const sorted = [...points].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1];
    if (s === e) continue;
    const kinds = annotations.filter(a => a.start <= s && a.end >= e).map(a => a.kind);
    segs.push({ s, e, kinds });
  }
  return (
    <>
      {segs.map((seg, i) => {
        const sub = text.slice(seg.s, seg.e);
        let content = <MnInline text={sub} T={T} onOpen={onOpen} onTagClick={onTagClick} allNotes={allNotes} />;
        let style = {};
        let wrap = (n) => n;
        for (const k of seg.kinds) {
          if (k === 'bold') style.fontWeight = 600;
          else if (k === 'italic') style.fontStyle = 'italic';
          else if (k === 'strike') style.textDecoration = 'line-through';
          else if (k === 'underline') style.textDecoration = (style.textDecoration ? style.textDecoration + ' underline' : 'underline');
          else if (k === 'code') {
            style.fontFamily = 'var(--mn-mono)';
            style.fontSize = '0.92em';
            style.background = T.bgSub;
            style.padding = '1px 5px';
            style.borderRadius = 3;
            style.border = `1px solid ${T.lineSub}`;
          }
          else if (k === 'hi-yellow') style.background = 'oklch(0.93 0.10 95 / 0.55)';
          else if (k === 'hi-green')  style.background = 'oklch(0.92 0.09 145 / 0.55)';
          else if (k === 'hi-pink')   style.background = 'oklch(0.90 0.08 0 / 0.55)';
          else if (k === 'hi-blue')   style.background = 'oklch(0.91 0.08 240 / 0.55)';
          else if (k === 'color-red')    style.color = 'oklch(0.55 0.18 27)';
          else if (k === 'color-blue')   style.color = 'oklch(0.50 0.16 240)';
          else if (k === 'color-purple') style.color = 'oklch(0.50 0.18 290)';
          else if (k === 'color-green')  style.color = 'oklch(0.50 0.13 150)';
          else if (k === 'fs-small') style.fontSize = '0.88em';
          else if (k === 'fs-default') style.fontSize = '1em';
          else if (k === 'fs-large') style.fontSize = '1.14em';
          else if (k === 'fs-x-large') style.fontSize = '1.3em';
        }
        return <span key={i} style={style}>{content}</span>;
      })}
    </>
  );
}

const MN_CODE_LANGUAGES = window.MN_CODE_HIGHLIGHTER?.languages || [];

function mnNormalizeCodeLanguage(value) {
  return window.MN_CODE_HIGHLIGHTER?.normalizeLanguage?.(value) || '';
}

function mnCodeLanguageLabel(value) {
  return window.MN_CODE_HIGHLIGHTER?.languageLabel?.(value) || 'Plain text';
}

function mnRenderCode(text, language, T) {
  return window.MN_CODE_HIGHLIGHTER?.render?.(text, language, T) ?? String(text || '');
}

// KaTeX block renderer. Renders the source as displayMode TeX. KaTeX is
// loaded as a UMD <script> in vispnote.html so this is a no-op fallback if
// it failed to load (e.g. user replaced the bundle).
function MnMathBlock({ source, T }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    if (!window.katex) {
      ref.current.textContent = String(source || '');
      return;
    }
    try {
      window.katex.render(String(source || ''), ref.current, {
        displayMode: true,
        throwOnError: false,
        output: 'html',
      });
    } catch (e) {
      ref.current.textContent = `Math error: ${e.message || e}`;
    }
  }, [source]);
  return (
    <div
      ref={ref}
      style={{
        fontFamily: 'KaTeX_Main, Newsreader, serif',
        fontSize: 16,
        color: T.ink,
        overflowX: 'auto',
        padding: '4px 0',
      }}
    />
  );
}

// Mermaid block renderer. Mermaid is async — renderToString creates a fresh
// SVG keyed by id. We dedupe on (source, T.bg) so the diagram only
// re-renders when content or theme changes, not on every keystroke elsewhere.
let _mnMermaidInited = false;
function mnMermaidInit(theme) {
  if (!window.mermaid) return false;
  if (_mnMermaidInited) return true;
  try {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit',
    });
    _mnMermaidInited = true;
  } catch (e) {
    console.warn('mermaid init failed', e);
  }
  return _mnMermaidInited;
}

function mnDetectThemeFromT(T) {
  return (T && window.MN_THEMES && T === window.MN_THEMES.dark) ? 'dark' : 'light';
}

function mnMermaidSvgHeight(svg) {
  const text = String(svg || '');
  const viewBox = text.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s*["']/i);
  const viewBoxHeight = viewBox ? Number(viewBox[1]) : 0;
  if (Number.isFinite(viewBoxHeight) && viewBoxHeight > 0) return Math.ceil(viewBoxHeight + 16);
  const height = text.match(/\bheight=["']\s*([\d.]+)(?:px)?\s*["']/i);
  const attrHeight = height ? Number(height[1]) : 0;
  if (Number.isFinite(attrHeight) && attrHeight > 0) return Math.ceil(attrHeight + 16);
  return 260;
}

function MnMermaidBlock({ source, T }) {
  const idRef = React.useRef(`mn_mer_${Math.random().toString(36).slice(2, 10)}`);
  const [error, setError] = React.useState(null);
  const [doc, setDoc] = React.useState('');
  const [height, setHeight] = React.useState(0);
  const themeMode = mnDetectThemeFromT(T);
  React.useEffect(() => {
    let cancelled = false;
    const code = String(source || '').trim();
    if (!code) { setDoc(''); setHeight(0); setError(null); return; }
    if (!mnMermaidInit(themeMode)) {
      setDoc('');
      setHeight(0);
      setError('Mermaid renderer unavailable');
      return;
    }
    setError(null);
    window.mermaid.render(idRef.current, code).then(({ svg }) => {
      if (cancelled) return;
      setHeight(mnMermaidSvgHeight(svg));
      setDoc(`<!doctype html><html><head><style>html,body{margin:0;background:transparent;}body{display:flex;justify-content:center;align-items:flex-start;overflow:visible;padding:4px 0;}svg{max-width:100%;height:auto;font-family:inherit;}</style></head><body>${svg}</body></html>`);
    }).catch(err => {
      if (cancelled) return;
      setDoc('');
      setHeight(0);
      setError(err?.message || String(err));
    });
    return () => { cancelled = true; };
  }, [source, themeMode]);
  if (error) {
    return (
      <pre style={{
        margin: 0, padding: 8, color: T.warn || T.ink,
        fontFamily: 'var(--mn-mono)', fontSize: 12,
        whiteSpace: 'pre-wrap',
      }}>Mermaid error: {error}</pre>
    );
  }
  return (
    <iframe
      title="Mermaid diagram"
      sandbox=""
      srcDoc={doc || '<!doctype html><html><body></body></html>'}
      style={{
        display: 'block',
        width: '100%',
        height: doc ? Math.max(160, height) : 0,
        minHeight: doc ? 160 : 0,
        border: 0,
        overflowX: 'auto',
        pointerEvents: 'none',
      }}
    />
  );
}

window.MnMathBlock = MnMathBlock;
window.MnMermaidBlock = MnMermaidBlock;

function mnSpellWords(text) {
  return Array.from(new Set(String(text || '')
    .match(/[A-Za-z][A-Za-z']{2,}/g) || []))
    .filter(word => !/[A-Z][a-z]+[A-Z]/.test(word))
    .slice(0, 120);
}

function mnRenderSpellCheckedText(text, issues, T, onOpenMenu) {
  const value = String(text || '');
  const issueMap = issues || {};
  const out = [];
  const re = /[A-Za-z][A-Za-z']{2,}/g;
  let last = 0, match, key = 0;
  while ((match = re.exec(value))) {
    if (match.index > last) out.push(<span key={key++}>{value.slice(last, match.index)}</span>);
    const word = match[0];
    const normalized = word.toLowerCase();
    const start = match.index;
    const end = start + word.length;
    if (issueMap[normalized]) {
      out.push(
        <span
          key={key++}
          title="Spelling suggestion"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenMenu && onOpenMenu({
              word,
              normalized,
              start,
              end,
              suggestions: issueMap[normalized] || [],
              x: e.clientX,
              y: e.clientY,
            });
          }}
          style={{
            textDecorationLine: 'underline',
            textDecorationStyle: 'wavy',
            textDecorationColor: T.danger || '#d94841',
            textDecorationThickness: '1.2px',
            textUnderlineOffset: 3,
          }}>{word}</span>
      );
    } else {
      out.push(<span key={key++}>{word}</span>);
    }
    last = end;
  }
  if (last < value.length) out.push(<span key={key++}>{value.slice(last)}</span>);
  return out;
}

function MnSpellSuggestionMenu({ menu, onPick, onAdd, onClose, T }) {
  if (!menu) return null;
  const suggestions = menu.suggestions || [];
  return (
    <div
      className="mn-spell-menu"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        top: menu.y,
        left: menu.x,
        zIndex: 12000,
        width: 190,
        background: T.bg,
        border: `1px solid ${T.line}`,
        borderRadius: 7,
        boxShadow: `0 12px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        padding: 5,
      }}>
      {suggestions.length ? suggestions.map(suggestion => (
        <button
          key={suggestion}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick && onPick(suggestion);
          }}
          style={mnSpellMenuButton(T, true)}>
          {suggestion}
        </button>
      )) : (
        <div style={{
          padding: '7px 8px',
          fontFamily: 'var(--mn-ui)',
          fontSize: 12,
          color: T.inkDim,
        }}>No suggestions</div>
      )}
      <div style={{ height: 1, background: T.lineSub, margin: '4px 3px' }} />
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onAdd && onAdd(menu.normalized);
        }}
        style={mnSpellMenuButton(T, false)}>
        Ignore word
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onClose && onClose();
        }}
        style={mnSpellMenuButton(T, false)}>
        Close
      </button>
    </div>
  );
}

function mnSpellMenuButton(T, strong) {
  return {
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: strong ? T.ink : T.inkMed,
    borderRadius: 5,
    padding: '6px 8px',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: strong ? 'var(--mn-mono)' : 'var(--mn-ui)',
    fontSize: strong ? 12 : 12.5,
  };
}

function MnCanvasPicker({ canvases = [], onPick, onCreate, onClose, T }) {
  useEffectOE(() => {
    const onDown = (e) => {
      if (e.target.closest?.('.mn-canvas-picker')) return;
      onClose && onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      className="mn-canvas-picker"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        zIndex: 1200,
        top: 'calc(100% + 6px)',
        left: 0,
        width: 260,
        maxHeight: 280,
        overflow: 'auto',
        background: T.bg,
        color: T.ink,
        border: `1px solid ${T.line}`,
        borderRadius: 8,
        padding: 6,
        boxShadow: `0 14px 38px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        fontFamily: 'var(--mn-ui)',
      }}>
      <div style={{
        padding: '6px 8px',
        fontFamily: 'var(--mn-mono)',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: T.inkDim,
      }}>Attach canvas</div>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onCreate && onCreate();
        }}
        style={{
          width: '100%',
          border: `1px solid ${T.lineSub}`,
          background: T.bgSub,
          color: T.ink,
          borderRadius: 6,
          padding: '8px 9px',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'var(--mn-ui)',
          fontSize: 12.5,
          fontWeight: 600,
        }}>
        Create new canvas
      </button>
      <div style={{ height: 1, background: T.lineSub, margin: '6px 2px' }} />
      {canvases.length === 0 ? (
        <div style={{
          padding: '10px 8px',
          color: T.inkDim,
          fontSize: 12,
        }}>No existing canvases</div>
      ) : canvases.map(canvas => (
        <button
          key={canvas.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick && onPick(canvas.id);
          }}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: T.ink,
            borderRadius: 6,
            padding: '7px 8px',
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'var(--mn-ui)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {canvas.title || 'Untitled canvas'}
          </div>
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, marginTop: 2 }}>
            {canvas.elementCount || 0} item{canvas.elementCount === 1 ? '' : 's'}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Disclosure triangle ────────────────────────────────────────────────
function MnDisclosure({ open, hasChildren, onClick, T, padTop }) {
  return (
    <button
      onClick={onClick}
      className="mn-disclosure"
      title={hasChildren ? (open ? 'Collapse' : 'Expand') : ''}
      style={{
        width: 18, height: 22, background: 'none', border: 'none',
        padding: 0, flexShrink: 0,
        cursor: hasChildren ? 'pointer' : 'default',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        // Pad so the visible triangle aligns with the text baseline of the
        // first line. Caller passes the same value used for the grip handle.
        paddingTop: (padTop != null ? padTop : 4) - 1,
        // Always visible when collapsed (signals hidden content);
        // hover-revealed when expanded.
        opacity: hasChildren ? (open ? 0 : 1) : 0,
        transition: 'opacity 80ms',
        marginRight: 0,
      }}>
      <svg width="11" height="11" viewBox="0 0 10 10" style={{
        transform: open ? 'rotate(0)' : 'rotate(-90deg)',
        transition: 'transform 120ms cubic-bezier(0.4, 0, 0.2, 1)',
        color: T.ink, display: 'block',
      }}>
        <path d="M2 3.5 L5 6.8 L8 3.5" fill="currentColor" stroke="none"/>
      </svg>
    </button>
  );
}

// ── Slash command catalog ─────────────────────────────────────────────
const MN_SLASH_CMDS = [
  { id: 'h1',     label: 'Heading 1',  hint: 'Large section title',  kbd: '#',   icon: 'H1', kind: 'heading', level: 1 },
  { id: 'h2',     label: 'Heading 2',  hint: 'Medium section title', kbd: '##',  icon: 'H2', kind: 'heading', level: 2 },
  { id: 'h3',     label: 'Heading 3',  hint: 'Subsection',           kbd: '###', icon: 'H3', kind: 'heading', level: 3 },
  { id: 'p',      label: 'Paragraph',  hint: 'Plain text',           kbd: '',    icon: '¶',  kind: 'paragraph' },
  { id: 'bullet', label: 'Bullet',     hint: 'List item',            kbd: '-',   icon: '•',  kind: 'bullet' },
  { id: 'todo',   label: 'To-do',      hint: 'Task with checkbox',   kbd: '[ ]', icon: '☐',  kind: 'todo', checked: false },
  { id: 'quote',  label: 'Quote',      hint: 'Blockquote',           kbd: '>',   icon: '❝',  kind: 'quote' },
  { id: 'code',   label: 'Code block', hint: 'Monospaced fenced',    kbd: '```', icon: '{}', kind: 'code' },
  { id: 'table',  label: 'Table',      hint: 'Markdown table',       kbd: '|',   icon: '▦',  kind: 'table', content: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |' },
  { id: 'div',    label: 'Divider',    hint: 'Horizontal rule',      kbd: '---', icon: '—',  kind: 'divider' },
  { id: 'canvas', label: 'Attach canvas', hint: 'Embed an existing or new canvas', kbd: '/canvas', icon: '□', canvasAction: true },
  { id: 'link',   label: 'Link to note', hint: 'Wiki-link to a note', kbd: '[[', icon: '⇉', insert: '[[' },
  { id: 'tag',    label: 'Tag',        hint: 'Categorize',           kbd: '#tag', icon: '#', insert: '#' },
  { id: 'block-label', label: 'Label',  hint: 'Add attention label to this block', kbd: '/label', icon: 'Lbl', blockLabelAction: true },
  { id: 'date',   label: "Today's date", hint: 'Insert YYYY-MM-DD',  kbd: '@today', icon: '☉',
    insertFn: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }},
  { id: 'remind', label: 'Reminder',   hint: 'Schedule reminder',   kbd: '@remind', icon: '⏰', insertFn: () => window.MN_REMIND?.defaultText?.() || '@remind YYYY-MM-DD 09:00 ' },
  { id: 'ai-improve-page', label: 'AI: Improve writing on this page', hint: 'Rewrite the whole page body', kbd: '/ai improve', icon: '✦', aiAction: 'improve', aiScope: 'page' },
  { id: 'ai-format-page', label: 'AI: Format this page', hint: 'Clean up the whole page body', kbd: '/ai format', icon: 'AI', aiAction: 'format', aiScope: 'page' },
  { id: 'ai-summarize-page', label: 'AI: Summarize this page', hint: 'Replace page body with a summary', kbd: '/ai summary', icon: 'Σ', aiAction: 'summarize', aiScope: 'page' },
  { id: 'ai-concise-page', label: 'AI: Make this page concise', hint: 'Shorten the whole page body', kbd: '/ai concise', icon: '↘', aiAction: 'concise', aiScope: 'page' },
  { id: 'ai-fix-page', label: 'AI: Fix spelling on this page', hint: 'Correct the whole page body', kbd: '/ai fix', icon: '✓', aiAction: 'fix', aiScope: 'page' },
  { id: 'ai-write-section', label: 'AI: Write in this section', hint: 'Preview generated text before applying', kbd: '/ai write', icon: '+', aiAction: 'write', aiScope: 'section' },
];

const MN_NOVELIST_SLASH_CMDS = [
  { id: 'plot-points', label: 'Plot Points', hint: 'Scene beats and context', kbd: '/plot points', icon: '~', kind: 'plot-points', content: 'Plot Points', beats: ['Opening beat'], contexts: [] },
];

function mnWorkflowSlashCommands() {
  const states = window.MN_LOGSEQ?.WORKFLOW_STATES || [];
  return states.map(state => ({
    id: `wf-${String(state.id || '').toLowerCase()}`,
    label: `Marker: ${state.id}`,
    hint: `Add a block marker for ${state.id.toLowerCase()}`,
    kbd: `/${state.id}`,
    icon: String(state.id || '?').slice(0, 1),
    workflow: state.id,
  }));
}

function mnSlashCommands(options = {}) {
  return [
    ...MN_SLASH_CMDS,
    ...(options.novelistMode ? MN_NOVELIST_SLASH_CMDS : []),
    ...mnWorkflowSlashCommands(),
  ];
}

function mnFindSlashCommandTrigger(text, cursor) {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[^A-Za-z0-9_])\/([A-Za-z0-9-]*)$/);
  if (!match) return null;
  const slashStart = before.length - match[2].length - 1;
  return {
    query: match[2],
    start: slashStart,
    end: cursor,
  };
}

function mnSlashCommandScore(cmd, query) {
  const q = (query || '').toLowerCase();
  if (!q) return 100;
  const label = cmd.label.toLowerCase();
  const id = cmd.id.toLowerCase();
  const hint = cmd.hint.toLowerCase();
  const kbd = (cmd.kbd || '').replace(/^\//, '').toLowerCase();
  if (label === q || id === q || kbd === q) return 0;
  if (label.startsWith(q) || id.startsWith(q) || kbd.startsWith(q)) return 10;
  if (hint.includes(q)) return 50;
  if (label.includes(q) || id.includes(q)) return 60;
  return Infinity;
}

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

const MN_BLOCK_CLIPBOARD_TYPE = 'application/x-omininote-blocks';
const MN_BLOCK_KINDS = new Set(['paragraph', 'heading', 'bullet', 'todo', 'quote', 'code', 'table', 'divider', 'plot-points']);

function mnIsClipboardBlock(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.content === 'string'
    && (!value.kind || MN_BLOCK_KINDS.has(value.kind))
    && (!value.children || Array.isArray(value.children));
}

function mnReidBlocks(blocks) {
  let seq = 0;
  const nextId = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${seq++}`;
  const next = mnCloneBlocks(blocks || []);
  const reid = (b) => {
    b.id = nextId();
    (b.children || []).forEach(reid);
  };
  next.forEach(reid);
  return next;
}

function mnNormalizeClipboardMarkdown(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mnLooksLikeBlockMarkdown(text) {
  const normalized = mnNormalizeClipboardMarkdown(text);
  const lines = normalized.split('\n').filter(line => line.trim());
  if (lines.length < 2) return false;
  if (/\n\s*\n/.test(normalized)) return true;
  return lines.some(line => /^(#{1,3}\s+|>\s+|---+$|\s*-\s+|\|.+\|)/.test(line));
}

// ── Selection toolbar (floats above selected text) ────────────────────
function MnSelectionToolbar({ rect, selectionKind, onApply, onOpenAiMenu, onDelete, onUndo, onRedo, onClose, T }) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  if (!rect) return null;
  const primaryGroups = [
    [
      {
        id: '_ai_menu',
        aiMenu: true,
        icon: <MnAiIcon size={13} />,
        hint: selectionKind === 'blocks' ? 'AI options for selected blocks' : 'AI options for selected text',
      },
    ],
    ...(selectionKind === 'text' ? [
      [
        { id: 'bold',   icon: <span style={{fontWeight: 700}}>B</span>, hint: 'Bold' },
        { id: 'italic', icon: <span style={{fontStyle: 'italic', fontFamily: 'serif'}}>I</span>, hint: 'Italic' },
        { id: 'underline', icon: <span style={{textDecoration: 'underline'}}>U</span>, hint: 'Underline' },
        { id: 'fs-small', icon: <span style={{fontSize: 15}}>-</span>, hint: 'Smaller text' },
        { id: 'fs-large', icon: <span style={{fontSize: 15}}>+</span>, hint: 'Larger text' },
      ],
    ] : []),
    [
      { id: '_delete', command: 'delete', icon: <span style={{fontSize: 14}}>⌫</span>, hint: selectionKind === 'blocks' ? 'Delete selected blocks' : 'Delete selected text' },
      { id: '_undo', command: 'undo', icon: <span style={{fontSize: 14}}>↶</span>, hint: 'Undo' },
      { id: '_redo', command: 'redo', icon: <span style={{fontSize: 14}}>↷</span>, hint: 'Redo' },
      ...(selectionKind === 'text' ? [{ id: '_more', command: 'more', icon: <span style={{fontSize: 15}}>...</span>, hint: 'More formatting' }] : []),
    ],
  ];
  const moreGroups = selectionKind === 'text' ? [
      [
        { id: 'strike', icon: <span style={{textDecoration: 'line-through'}}>S</span>, hint: 'Strikethrough' },
        { id: 'code',   icon: <span style={{fontFamily: 'var(--mn-mono)', fontSize: 11}}>{'</>'}</span>, hint: 'Code' },
        { id: 'fs-default', icon: <span style={{fontSize: 12}}>A</span>, hint: 'Default text size' },
        { id: 'fs-x-large', icon: <span style={{fontSize: 16}}>A</span>, hint: 'Extra large text' },
      ],
      [
        { id: 'hi-yellow', swatch: 'oklch(0.93 0.10 95 / 0.7)',  hint: 'Yellow' },
        { id: 'hi-green',  swatch: 'oklch(0.92 0.09 145 / 0.7)', hint: 'Green' },
        { id: 'hi-pink',   swatch: 'oklch(0.90 0.08 0 / 0.7)',   hint: 'Pink' },
        { id: 'hi-blue',   swatch: 'oklch(0.91 0.08 240 / 0.7)', hint: 'Blue' },
      ],
      [
        { id: 'color-red',    color: 'oklch(0.55 0.18 27)',  letter: 'A', hint: 'Red text' },
        { id: 'color-blue',   color: 'oklch(0.50 0.16 240)', letter: 'A', hint: 'Blue text' },
        { id: 'color-purple', color: 'oklch(0.50 0.18 290)', letter: 'A', hint: 'Purple text' },
        { id: 'color-green',  color: 'oklch(0.50 0.13 150)', letter: 'A', hint: 'Green text' },
      ],
      [
        { id: '_clear', icon: <span style={{fontSize: 11}}>x</span>, hint: 'Clear formatting' },
      ],
  ] : [];
  const renderButton = (b) => (
    <button
      key={b.id}
      onMouseDown={(e) => {
        e.preventDefault();
        if (b.aiMenu) onOpenAiMenu && onOpenAiMenu(e);
        else if (b.command === 'delete') onDelete && onDelete();
        else if (b.command === 'undo') onUndo && onUndo();
        else if (b.command === 'redo') onRedo && onRedo();
        else if (b.command === 'more') setMoreOpen(v => !v);
        else onApply(b.id);
      }}
      title={b.hint}
      style={{
        width: 28, height: 28, padding: 0,
        background: b.command === 'more' && moreOpen ? T.bgHover : 'transparent',
        border: 'none', borderRadius: 5,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: b.color || T.ink, fontFamily: 'var(--mn-ui)',
        position: 'relative',
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
      onMouseLeave={e => e.currentTarget.style.background = b.command === 'more' && moreOpen ? T.bgHover : 'transparent'}>
      {b.swatch ? (
        <span style={{
          width: 16, height: 16, borderRadius: 3, background: b.swatch,
          border: `1px solid color-mix(in oklab, ${T.ink} 12%, transparent)`,
        }} />
      ) : b.letter ? (
        <span style={{
          fontFamily: 'serif', fontSize: 14, fontWeight: 600,
          borderBottom: `2px solid ${b.color}`,
          color: b.color, lineHeight: 1, paddingBottom: 0,
        }}>{b.letter}</span>
      ) : b.icon}
    </button>
  );
  // Position above selection
  const top = rect.top - 48;
  const left = rect.left + rect.width / 2 - 140;
  return (
    <div
      className="mn-selection-toolbar"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed', top: Math.max(8, top), left: Math.max(8, left), zIndex: 100,
        width: 356,
        display: 'flex', gap: 4, padding: 5,
        background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8,
        boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 18%, transparent), 0 1px 2px color-mix(in oklab, ${T.ink} 10%, transparent)`,
        fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.ink,
      }}>
      {primaryGroups.map((grp, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <div style={{ width: 1, background: T.lineSub, margin: '4px 2px' }} />}
          {grp.map(renderButton)}
        </React.Fragment>
      ))}
      {moreOpen && moreGroups.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          width: 220,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: 6,
          background: T.bg,
          border: `1px solid ${T.line}`,
          borderRadius: 8,
          boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        }}>
          {moreGroups.map((grp, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && <div style={{ flexBasis: '100%', height: 1, background: T.lineSub, margin: '2px 0' }} />}
              {grp.map(renderButton)}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Block row ─────────────────────────────────────────────────────────
function MnBlockRow({
  block, depth, focusId, T, allNotes,
  allCanvases = [], onOpenCanvas, onCreateCanvas,
  onChange, onChangeKind, onIndent, onOutdent, onSplit, onMergePrev,
  onInsertBlocksAt,
  onToggleCollapse, onToggleCheck, onSetAnnotation, onClearAnnotation,
  onFocusNext, onFocusPrev, onDelete, onOpen, onTagClick,
  onSelectionChange, setFocusId,
  onMove, onContextMenu, onZoom, onAiAction, aiTarget,
  onBlockMouseDown, onBlockMouseEnter, selectedBlockIds,
  onBeginContentEdit, onEndContentEdit,
  editorFontSize,
  indentGuides = true,
  spellCheck = true,
  autoLink = true,
  collapseByDefault = false,
  parseClipboardBlocks,
  novelistMode = false,
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
    if (!spellCheck || editing || block.kind === 'code' || block.kind === 'table' || !window.mn?.spellcheck) {
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
        const res = await window.mn.spellcheck(words);
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
    return mnSlashCommands({ novelistMode })
      .map((cmd, index) => ({ cmd, index, score: mnSlashCommandScore(cmd, slashQ.query) }))
      .filter(x => x.score !== Infinity)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(x => x.cmd);
  }, [slashQ, novelistMode]);

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
      const pos = ta.selectionStart;
      const v = ta.value;
      const next = v.slice(0, pos) + '\n' + v.slice(pos);
      onChange(block.id, next);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(pos + 1, pos + 1);
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
    const pos = ta?.selectionStart ?? block.content.length;
    // Empty block on Enter outdents nested blocks or exits to paragraph.
    // Empty bullet → paragraph; empty paragraph keeps creating new paragraph.
    if (block.content.trim() === '' && (block.kind === 'bullet' || block.kind === 'todo')) {
      // If indented, outdent first; else convert to paragraph
      if (depth > 0) { onOutdent(block.id); return; }
      onChangeKind(block.id, { kind: 'paragraph', level: 0, checked: null });
      return;
    }

    // What kind should the next block be?
    // Default: paragraph (plain text). Bullets/todos continue their kind so
    // a list flows naturally. Headings/quotes/code break out to paragraph.
    let nextKind = 'paragraph';
    let nextChecked = null;
    let nextLevel = 0;
    if (block.kind === 'bullet') nextKind = 'bullet';
    else if (block.kind === 'todo') { nextKind = 'todo'; nextChecked = false; }
    // paragraph, heading, quote, code, divider → paragraph

    onSplit(block.id, pos, { kind: nextKind, checked: nextChecked, level: nextLevel });
  };

  // ── input handlers ───────────────────────────────────────────────
  const handleInput = (e) => {
    const v = e.target.value;
    onChange(block.id, v);
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
    const pos = e.target.selectionStart;
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

  const handlePaste = (e) => {
    const markdown = mnClipboardEventToMarkdownTable && mnClipboardEventToMarkdownTable(e);
    const ta = inputRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
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
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
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
    onChange(block.id, newVal);
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
    const fallback = block.content.length;
    pendingCaretRef.current = e
      ? textOffsetFromPoint(displayTextRef.current, e.clientX, e.clientY, fallback)
      : fallback;
    onBeginContentEdit && onBeginContentEdit(block.id);
    setFocusId && setFocusId(block.id);
    setEditing(true);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = pendingCaretRef.current ?? fallback;
        pendingCaretRef.current = null;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  // ── visual params per kind ──────────────────────────────────────
  const fontStyle = mnGetFontStyle(block, T, editorFontSize);

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
        aiActive={aiActive}
      />
    );
  }

  // ── special render: divider ────────────────────────────────────
  if (block.kind === 'divider') {
    return (
      <div style={{
        marginLeft: indentPx, padding: '14px 0',
        position: 'relative',
      }}>
        <div style={{ height: 1, background: T.line, width: '100%' }} />
      </div>
    );
  }

  // ── render ──────────────────────────────────────────────────────
  return (
    <div
      className="mn-block-row"
      data-block-id={block.id}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/mn-block')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;
        // Top 25% → before, bottom 25% → after, middle → child
        if (y < h * 0.25) setDropPos('before');
        else if (y > h * 0.75) setDropPos('after');
        else setDropPos('child');
      }}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        const srcId = e.dataTransfer.getData('text/mn-block');
        if (!srcId || !dropPos) { setDropPos(null); return; }
        e.preventDefault();
        onMove && onMove(srcId, block.id, dropPos);
        setDropPos(null);
      }}
      onMouseDown={(e) => onBlockMouseDown && onBlockMouseDown(block.id, e)}
      onMouseEnter={() => onBlockMouseEnter && onBlockMouseEnter(block.id)}
      style={{
        display: 'flex', alignItems: 'flex-start',
        paddingLeft: indentPx,
        marginTop: block.kind === 'heading'
          ? (block.level === 1 ? 22 : block.level === 2 ? 16 : 10)
          : (block.kind === 'paragraph' && depth === 0 ? 4 : 1),
        position: 'relative',
        ...(dropPos === 'before' ? { boxShadow: `inset 0 2px 0 0 ${T.accent}` } : {}),
        ...(dropPos === 'after' ? { boxShadow: `inset 0 -2px 0 0 ${T.accent}` } : {}),
        ...(dropPos === 'child' ? { background: T.bgHover, outline: `1px dashed ${T.accent}`, outlineOffset: -2 } : {}),
        ...(selectedAsArea ? { background: T.selBg, outline: `1px solid color-mix(in oklab, ${T.accent || T.ink} 32%, transparent)`, outlineOffset: -1 } : {}),
      }}>
      {/* Vertical guide lines for each ancestor level */}
      {indentGuides && Array.from({ length: depth }, (_, i) => (
        <div key={i} style={{
          position: 'absolute',
          // Align with the bullet center of the ancestor at depth i:
          // paddingLeft (i*24) + disclosure(18) + bullet halfWidth (9) = i*24 + 27
          left: i * 24 + 27, top: 0, bottom: 0,
          width: 1, background: T.line,
          pointerEvents: 'none',
          opacity: 0.55,
        }} />
      ))}

      {/* Disclosure triangle (separate from bullet) */}
      <MnDisclosure
        open={!block.collapsed}
        hasChildren={hasChildren}
        onClick={() => hasChildren && onToggleCollapse(block.id)}
        padTop={mnGripPadTop(block)}
        T={T}
      />

      {/* Block-kind affordance: bullet dot + drag handle */}
      <div
        title="Drag to move · Click to zoom · Right-click for menu"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/mn-block', block.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (onContextMenu) onContextMenu(block.id, e.clientX, e.clientY);
        }}
        onClick={(e) => {
          // Click on bullet (not drag) zooms into the block.
          // Only fire on plain left click without modifiers.
          if (e.button === 0 && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
            if (onZoom) { e.stopPropagation(); onZoom(block.id); }
          }
        }}
        style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          paddingTop: mnAffordancePadTop(block),
          marginRight: 8,
          minWidth: 18,
          cursor: 'grab',
        }}>
        {block.kind === 'todo' ? (
          <button
            onClick={() => onToggleCheck(block.id)}
            style={{
              width: 15, height: 15,
              border: `1.5px solid ${block.checked ? T.accent : T.line}`,
              background: block.checked ? T.accent : 'transparent',
              borderRadius: 3, cursor: 'pointer', padding: 0, marginTop: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {block.checked && (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        ) : block.kind === 'bullet' ? (
          // Real bullet — a small filled dot. Becomes filled-with-halo when collapsed.
          <span style={{
            width: 14, height: 14, borderRadius: '50%',
            background: hasChildren && block.collapsed ? T.bgActive : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginTop: 0,
            transition: 'background 120ms',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: T.ink,
            }} />
          </span>
        ) : block.kind === 'divider' ? (
          <span style={{ width: 0 }} />
        ) : (
          // Heading, paragraph, quote, code — no visible dot in default state.
          // Hover-revealed 6-dot grip handle for drag + zoom + right-click context.
          <span className="mn-grip" style={{
            width: 14, height: 14, borderRadius: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginTop: mnGripPadTop(block),
            opacity: 0,
            transition: 'opacity 100ms, background 100ms',
            color: T.inkDim,
          }}>
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="2.5" cy="3"  r="1"/>
              <circle cx="7.5" cy="3"  r="1"/>
              <circle cx="2.5" cy="7"  r="1"/>
              <circle cx="7.5" cy="7"  r="1"/>
              <circle cx="2.5" cy="11" r="1"/>
              <circle cx="7.5" cy="11" r="1"/>
            </svg>
          </span>
        )}
      </div>

      {/* Content */}
      <div className={aiActive ? 'mn-ai-text-working' : ''} style={{
        flex: 1,
        minWidth: 0,
        maxWidth: '100%',
        position: 'relative',
        borderRadius: aiActive ? 6 : undefined,
        paddingInline: aiActive ? 3 : undefined,
        ...(block.kind === 'quote' ? {
          borderLeft: `3px solid ${T.line}`, paddingLeft: 14,
        } : {}),
        ...(block.kind === 'code' ? {
          background: T.bgSub, border: `1px solid ${T.lineSub}`,
          borderRadius: 6, padding: '8px 12px',
        } : {}),
      }}>
        {block.kind === 'code' && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 8, paddingBottom: 7,
              borderBottom: `1px solid ${T.lineSub}`,
            }}>
            <select
              value={mnNormalizeCodeLanguage(block.language)}
              onChange={(e) => onChangeKind(block.id, { language: e.target.value })}
              title="Code language"
              spellCheck={false}
              style={{
                maxWidth: 170,
                border: `1px solid ${T.lineSub}`,
                background: T.bg,
                color: T.inkMed,
                borderRadius: 5,
                padding: '3px 24px 3px 7px',
                fontFamily: 'var(--mn-mono)',
                fontSize: 10.5,
                outline: 'none',
              }}>
              {MN_CODE_LANGUAGES.map(lang => (
                <option key={lang.value || 'plain'} value={lang.value}>{lang.label}</option>
              ))}
            </select>
            <span style={{
              fontFamily: 'var(--mn-mono)', fontSize: 10,
              color: T.inkDim,
            }}>{mnCodeLanguageLabel(block.language)}</span>
          </div>
        )}
        {(blockLabels.length > 0 || labelMenu) && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 4,
              margin: blockLabels.length ? '0 0 3px' : 0,
            }}>
            {blockLabels.map(label => {
              const palette = mnBlockLabelPalette(label.color);
              const editingLabel = editingLabelId === label.id || !String(label.text || '').trim();
              const inputWidth = Math.max(42, Math.min(170, (String(label.text || '').length || 5) * 7 + 22));
              return (
                <span
                  key={label.id}
                  onClick={(e) => { e.stopPropagation(); setEditingLabelId(label.id); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setLabelMenu({ labelId: label.id, x: e.clientX, y: e.clientY });
                  }}
                  title="Click to edit label · Right-click to change color"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    minHeight: 20,
                    borderRadius: 4,
                    border: `1px solid ${palette.border}`,
                    background: palette.bg,
                    color: palette.ink,
                    padding: '1px 4px',
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10.5,
                    lineHeight: 1.2,
                    cursor: 'text',
                  }}>
                  {editingLabel ? (
                    <input
                      value={label.text || ''}
                      autoFocus
                      onChange={(e) => updateBlockLabel(label.id, { text: e.target.value })}
                      onBlur={() => setEditingLabelId(current => current === label.id ? null : current)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); setEditingLabelId(null); }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingLabelId(null); }
                      }}
                      placeholder="label"
                      spellCheck={false}
                      style={{
                        width: inputWidth,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: palette.ink,
                        fontFamily: 'var(--mn-mono)',
                        fontSize: 10.5,
                        padding: 0,
                      }}
                    />
                  ) : (
                    <span>{label.text}</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeBlockLabel(label.id); }}
                    title="Remove label"
                    style={{
                      width: 14,
                      height: 14,
                      border: 'none',
                      background: 'transparent',
                      color: palette.ink,
                      opacity: 0.72,
                      cursor: 'pointer',
                      padding: 0,
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10,
                      lineHeight: 1,
                    }}>x</button>
                </span>
              );
            })}
            {labelMenu && (
              <div
                className="mn-label-color-menu"
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  left: Math.min(labelMenu.x, window.innerWidth - 174),
                  top: Math.min(labelMenu.y, window.innerHeight - 94),
                  zIndex: 260,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 4,
                  width: 166,
                  padding: 6,
                  borderRadius: 7,
                  border: `1px solid ${T.line}`,
                  background: T.bg,
                  boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
                }}>
                {MN_BLOCK_LABEL_COLORS.map(color => (
                  <button
                    key={color.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBlockLabel(labelMenu.labelId, { color: color.id });
                      setLabelMenu(null);
                    }}
                    title={color.label}
                    style={{
                      height: 24,
                      borderRadius: 5,
                      border: `1px solid ${color.border}`,
                      background: color.bg,
                      color: color.ink,
                      cursor: 'pointer',
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 9.5,
                    }}>{color.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {editing ? (
          <>
            <textarea
              ref={inputRef}
              value={block.content}
              onChange={handleInput}
              onPaste={handlePaste}
              onCopy={handleCopy}
              onCut={handleCut}
              onSelect={handleSelect}
              onMouseUp={handleSelect}
              onKeyUp={handleSelect}
              onBlur={() => {
                setTimeout(() => {
                  onEndContentEdit && onEndContentEdit(block.id);
                  setEditing(false); setAutoQ(null); setSlashQ(null);
                }, 100);
              }}
              onKeyDown={handleKey}
              spellCheck={block.kind === 'code' ? false : spellCheck}
              rows={1}
              placeholder={mnPlaceholder(block)}
              style={{
                width: '100%', border: 'none', outline: 'none',
                background: 'transparent', resize: 'none', padding: 0,
                ...fontStyle,
                lineHeight: fontStyle.lineHeight || 1.55,
                overflow: 'hidden',
              }} />
            {wikiSuggestions.length > 0 && (
              <MnPopover T={T} anchorRef={inputRef}>
                <MnPopoverHeader T={T}>Link to note</MnPopoverHeader>
                {wikiSuggestions.map((s, i) => (
                  <MnPopoverItem
                    key={s.id}
                    active={i === autoIdx}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s.title); }}
                    onMouseEnter={() => setAutoIdx(i)}
                    T={T}>
                    {s.title}
                  </MnPopoverItem>
                ))}
              </MnPopover>
            )}
            {slashQ != null && (
              <MnPopover T={T} wide anchorRef={inputRef}>
                <MnPopoverHeader T={T}>
                  Insert{slashQ.query ? <> <span style={{opacity:0.5}}>/</span><span style={{color:T.ink, textTransform:'none', letterSpacing:0}}>{slashQ.query}</span></> : null}
                </MnPopoverHeader>
                {slashMatches.length === 0 ? (
                  <div style={{
                    padding: '12px 10px', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                    color: T.inkDim, textAlign: 'center',
                  }}>No matching commands</div>
                ) : slashMatches.map((cmd, i) => (
                  <div key={cmd.id}
                    onMouseDown={(e) => { e.preventDefault(); applySlashCmd(cmd); }}
                    onMouseEnter={() => setSlashIdx(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 10px', borderRadius: 5, cursor: 'pointer',
                      background: i === slashIdx ? T.selBg : 'transparent',
                    }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 5, flexShrink: 0,
                      background: T.bg, border: `1px solid ${T.lineSub}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--mn-mono)', fontSize: 11, fontWeight: 500,
                      color: T.inkMed,
                    }}>{cmd.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.ink,
                        fontWeight: i === slashIdx ? 500 : 400,
                      }}>{cmd.label}</div>
                      <div style={{
                        fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim,
                        marginTop: 1,
                      }}>{cmd.hint}</div>
                    </div>
                    {cmd.kbd && (
                      <div style={{
                        fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
                        padding: '2px 5px', borderRadius: 3,
                        background: T.bgSub, border: `1px solid ${T.lineSub}`,
                        flexShrink: 0,
                      }}>{cmd.kbd}</div>
                    )}
                  </div>
                ))}
              </MnPopover>
            )}
          </>
        ) : (
          <div
            onClick={startEdit}
            onCopy={handleCopy}
            spellCheck={false}
            style={{
              ...fontStyle,
              lineHeight: fontStyle.lineHeight || 1.55,
              color: block.checked ? T.inkDim : fontStyle.color,
              textDecoration: block.checked ? 'line-through' : (fontStyle.textDecoration || 'none'),
              cursor: 'text', padding: '1px 2px', borderRadius: 3,
              minHeight: 18,
              whiteSpace: 'pre-wrap',
            }}>
            {block.workflow && (
              <MnWorkflowPill
                state={block.workflow}
                onClick={(e) => {
                  e.stopPropagation();
                  const cur = window.MN_LOGSEQ.mnWorkflow(block.workflow);
                  onChangeKind(block.id, { workflow: cur?.next || null });
                }}
                T={T}
              />
            )}
            <span ref={displayTextRef}>
              {(() => {
                const content = block.content || '';
                // Page-property line: key:: value
                if (window.MN_LOGSEQ.mnIsPropertyLine(content)) {
                  const prop = window.MN_LOGSEQ.mnParseProperty(content);
                  if (prop) return <MnPropertyRow property={prop} T={T} />;
                }
                // Block-level embed: {{embed [[Page]]}} or {{embed ((id))}}
                const pageEmbed = content.match(/^\{\{embed\s+\[\[(.+?)\]\]\}\}$/);
                if (pageEmbed) {
                  return <MnPageEmbed title={pageEmbed[1]} allNotes={allNotes} T={T} onOpenNote={(id) => onOpen && onOpen(null, id)} />;
                }
                const blockEmbed = content.match(/^\{\{embed\s+\(\(([^)]+)\)\)\}\}$/);
                if (blockEmbed) {
                  return <MnBlockEmbed refId={blockEmbed[1]} allNotes={allNotes} T={T} onOpenBlock={(noteId, blockId) => onOpen && onOpen(null, noteId, blockId)} />;
                }
                const canvasEmbed = content.match(/^\{\{canvas\s+([A-Za-z0-9_-]+)\}\}$/);
                if (canvasEmbed) {
                  return <MnCanvasEmbed canvasId={canvasEmbed[1]} canvases={allCanvases} T={T} onOpenCanvas={onOpenCanvas} />;
                }
                if (block.kind === 'table') {
                  return <MnMarkdownTable markdown={content} T={T} />;
                }
                if (block.kind === 'code') {
                  if (!content) {
                    return <span style={{ color: T.inkDim, fontStyle: 'italic' }}>{mnPlaceholder(block)}</span>;
                  }
                  const lang = mnNormalizeCodeLanguage(block.language);
                  if (lang === 'math') return <MnMathBlock source={content} T={T} />;
                  if (lang === 'mermaid') return <MnMermaidBlock source={content} T={T} />;
                  return mnRenderCode(content, block.language, T);
                }
                if (spellCheck && Object.keys(spellIssues || {}).length) {
                  return mnRenderSpellCheckedText(content, spellIssues, T, setSpellMenu);
                }
                if (content) {
                  return mnRenderAnnotated(content, block.annotations, T, onOpen, onTagClick, allNotes);
                }
                return <span style={{ color: T.inkDim, fontStyle: 'italic' }}>{mnPlaceholder(block)}</span>;
              })()}
            </span>
            <MnSpellSuggestionMenu
              menu={spellMenu}
              onPick={applySpellSuggestion}
              onAdd={ignoreSpellWord}
              onClose={() => setSpellMenu(null)}
              T={T}
            />
            {canvasPicker && (
              <MnCanvasPicker
                canvases={allCanvases}
                onPick={(canvasId) => {
                  onChange(block.id, `{{canvas ${canvasId}}}`);
                  setCanvasPicker(false);
                  setFocusId && setFocusId(block.id);
                }}
                onCreate={async () => {
                  const canvas = await onCreateCanvas?.('Untitled canvas', { open: false });
                  if (canvas?.id) {
                    onChange(block.id, `{{canvas ${canvas.id}}}`);
                    setCanvasPicker(false);
                    setFocusId && setFocusId(block.id);
                  }
                }}
                onClose={() => setCanvasPicker(false)}
                T={T}
              />
            )}
            {block.collapsed && hasChildren && (
              <span style={{
                marginLeft: 8, fontFamily: 'var(--mn-mono)',
                fontSize: 10, color: T.inkDim, fontWeight: 400,
                padding: '1px 6px', borderRadius: 3,
                background: T.bgSub, border: `1px solid ${T.lineSub}`,
              }}>
                {block.children.length} hidden
              </span>
            )}
          </div>
        )}
      </div>
      <MnInlineAiButton
        block={block}
        T={T}
        onAiAction={onAiAction}
      />
    </div>
  );
}

function mnBlockRowMemoEqual(prev, next) {
  return prev.block === next.block &&
    prev.depth === next.depth &&
    prev.focusId === next.focusId &&
    prev.T === next.T &&
    prev.allNotes === next.allNotes &&
    prev.allCanvases === next.allCanvases &&
    prev.aiPreview === next.aiPreview &&
    prev.aiTarget === next.aiTarget &&
    prev.selectedBlockIds === next.selectedBlockIds &&
    prev.editorFontSize === next.editorFontSize &&
    prev.indentGuides === next.indentGuides &&
    prev.spellCheck === next.spellCheck &&
    prev.autoLink === next.autoLink &&
    prev.collapseByDefault === next.collapseByDefault &&
    prev.novelistMode === next.novelistMode;
}

const MnMemoBlockRow = React.memo(MnBlockRow, mnBlockRowMemoEqual);

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
    const sizes = { 1: 26, 2: 20, 3: 17 };
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
      padding: '6px 10px 4px', fontFamily: 'var(--mn-mono)', fontSize: 9,
      letterSpacing: '0.12em', textTransform: 'uppercase', color: T.inkDim,
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
        fontFamily: 'var(--mn-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
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
            onClick={() => window.MN_AI_REPORT?.report?.({ output: preview.text, scope: 'AI writing preview' })}
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
              onClick={() => window.MN_AI_REPORT?.report?.({ output: text, scope: 'AI inline preview' })}
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

  useEffectOE(() => {
    const onKey = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key || '';
      const lowerKey = key.toLowerCase();
      const target = e.target;
      const tag = target?.tagName;
      const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      const currentSelection = selectionRef.current;
      const isUndo = isMod && lowerKey === 'z' && !e.shiftKey;
      const isRedo = (isMod && e.shiftKey && lowerKey === 'z') || (isMod && lowerKey === 'y');
      const isCopy = isMod && lowerKey === 'c' && !e.altKey && !e.shiftKey;
      const isCut = isMod && lowerKey === 'x' && !e.altKey && !e.shiftKey;
      const isPaste = isMod && lowerKey === 'v' && !e.altKey && !e.shiftKey;
      const isSelectAll = isMod && lowerKey === 'a' && !e.altKey && !e.shiftKey;
      const isBlockEditCommand = currentSelection?.kind === 'blocks' && (isCopy || isCut || isPaste);
      const isOutlinerSelectAll = isSelectAll && !isFormField;
      const isTextDelete = (key === 'Backspace' || key === 'Delete') && currentSelection?.kind === 'text' && !isMod;
      const isAreaDelete = (key === 'Backspace' || key === 'Delete') && currentSelection?.kind === 'blocks' && !isMod;
      const isBlockZoom = isMod && key === 'Enter';
      const isBlockMoveUp = e.altKey && !isMod && key === 'ArrowUp';
      const isBlockMoveDown = e.altKey && !isMod && key === 'ArrowDown';
      const isBlockDuplicate = isMod && lowerKey === 'd';
      const isBlockDelete = isMod && (key === 'Backspace' || key === 'Delete') && !isFormField;
      const isBlockShortcut = isBlockZoom || isBlockMoveUp || isBlockMoveDown || isBlockDuplicate || isBlockDelete;
      if (!isUndo && !isRedo && !isTextDelete && !isAreaDelete && !isBlockShortcut && !isBlockEditCommand && !isOutlinerSelectAll) return;
      if ((isUndo || isRedo) && isFormField && !target.closest?.('.mn-block-row')) return;
      const insideOutliner = !!target.closest?.('.mn-outliner');
      const activeInsideOutliner = !!document.activeElement?.closest?.('.mn-outliner');
      if ((isTextDelete || isBlockShortcut || isBlockEditCommand || isOutlinerSelectAll) && !insideOutliner && !activeInsideOutliner) return;
      const activeBlockId = () => {
        const currentSelection = selectionRef.current;
        if (currentSelection?.kind === 'blocks' && currentSelection.blockIds?.length) return currentSelection.blockIds[0];
        return focusIdRef.current;
      };
      if (isBlockShortcut && !activeBlockId()) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation && e.stopImmediatePropagation();
      if (isTextDelete || isAreaDelete) deleteSelectionRef.current && deleteSelectionRef.current();
      else if (isCopy) keyboardEditActionsRef.current?.copySelectedBlocks?.();
      else if (isCut) keyboardEditActionsRef.current?.cutSelectedBlocks?.();
      else if (isPaste) keyboardEditActionsRef.current?.pasteForKeyboard?.();
      else if (isSelectAll) keyboardEditActionsRef.current?.selectAllBlocks?.();
      else if (isUndo) undoActionRef.current && undoActionRef.current();
      else if (isRedo) redoActionRef.current && redoActionRef.current();
      else if (isBlockZoom) zoomBlockRef.current && zoomBlockRef.current(activeBlockId());
      else if (isBlockMoveUp) moveBlockRef.current && moveBlockRef.current(activeBlockId(), activeBlockId(), 'up');
      else if (isBlockMoveDown) moveBlockRef.current && moveBlockRef.current(activeBlockId(), activeBlockId(), 'down');
      else if (isBlockDuplicate) duplicateBlockRef.current && duplicateBlockRef.current(activeBlockId());
      else if (isBlockDelete) deleteBlockRef.current && deleteBlockRef.current(activeBlockId());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

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

  const onChangeKind = (id, patch) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (!loc) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
      mnUpdateBlockContent(loc.block, patch.content);
      const { content, ...rest } = patch;
      Object.assign(loc.block, rest);
      return;
    }
    Object.assign(loc.block, patch);
  });

  const onToggleCollapse = (id) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (loc) loc.block.collapsed = !loc.block.collapsed;
  });

  const onToggleCheck = (id) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (loc && loc.block.kind === 'todo') loc.block.checked = !loc.block.checked;
  });

  const onIndent = (id) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (!loc || loc.idx === 0) return;
    const prev = loc.arr[loc.idx - 1];
    // Any block can be a parent except dividers.
    if (prev.kind === 'divider') return;
    loc.arr.splice(loc.idx, 1);
    prev.children.push(loc.block);
    prev.collapsed = false;
  });

  const onOutdent = (id) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (!loc || !loc.parent) return;
    const parentLoc = mnLocate(bs, loc.parent.id);
    if (!parentLoc) return;
    loc.arr.splice(loc.idx, 1);
    parentLoc.arr.splice(parentLoc.idx + 1, 0, loc.block);
  });

  const onSplit = (id, cursor, nextProps) => {
    const nb = mkBlock({ ...nextProps });
    mutate(bs => {
      const loc = mnLocate(bs, id);
      if (!loc) return;
      mnSplitBlock(loc.block, cursor, nb);
      loc.arr.splice(loc.idx + 1, 0, nb);
    });
    setFocusId(nb.id);
  };

  const onInsertBlocksAt = (id, start, end, insertedBlocks) => {
    const firstInserted = insertedBlocks && insertedBlocks[0];
    mutate(bs => {
      const loc = mnLocate(bs, id);
      if (!loc || !insertedBlocks?.length) return;
      const text = String(loc.block.content || '');
      const safeStart = Math.max(0, Math.min(text.length, Number(start) || 0));
      const safeEnd = Math.max(safeStart, Math.min(text.length, Number(end) || safeStart));
      const beforeSplit = mnSplitAnnotations(loc.block.annotations || [], safeStart, text.length);
      const afterSplit = mnSplitAnnotations(loc.block.annotations || [], safeEnd, text.length);
      const tailText = text.slice(safeEnd);
      const blocksToInsert = mnCloneBlocks(insertedBlocks);
      const tailBlocks = tailText
        ? [mkBlock({
            kind: loc.block.kind,
            level: loc.block.level || 0,
            checked: loc.block.checked,
            content: tailText,
            annotations: afterSplit.after,
            workflow: loc.block.workflow || null,
            language: loc.block.language || '',
            children: safeStart === 0 ? (loc.block.children || []) : [],
          })]
        : [];
      if (safeStart === 0) {
        loc.arr.splice(loc.idx, 1, ...blocksToInsert, ...tailBlocks);
        return;
      }
      loc.block.content = text.slice(0, safeStart);
      loc.block.annotations = beforeSplit.before;
      loc.arr.splice(loc.idx + 1, 0, ...blocksToInsert, ...tailBlocks);
    });
    if (firstInserted) setFocusId(firstInserted.id);
  };

  const onMergePrev = (id) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (!loc || loc.idx === 0) return;
    const prev = loc.arr[loc.idx - 1];
    // Find deepest end of prev's tree
    let target = prev;
    while (target.children.length && !target.collapsed) target = target.children[target.children.length - 1];
    mnMergeBlockContent(target, loc.block);
    // Move children of deleted block to target's children
    target.children = target.children.concat(loc.block.children || []);
    loc.arr.splice(loc.idx, 1);
    setFocusId(target.id);
  });

  const onDelete = (id) => mutate(bs => {
    const loc = mnLocate(bs, id);
    if (!loc) return;
    if (loc.idx > 0) {
      const prev = loc.arr[loc.idx - 1];
      let target = prev;
      while (target.children.length && !target.collapsed) target = target.children[target.children.length - 1];
      setFocusId(target.id);
    } else if (loc.parent) {
      setFocusId(loc.parent.id);
    }
    loc.arr.splice(loc.idx, 1);
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

  const onFocusNext = (id) => {
    const flat = mnFlatten(blocks);
    const i = flat.findIndex(f => f.block.id === id);
    if (i >= 0 && i < flat.length - 1) setFocusId(flat[i + 1].block.id);
  };
  const onFocusPrev = (id) => {
    const flat = mnFlatten(blocks);
    const i = flat.findIndex(f => f.block.id === id);
    if (i > 0) setFocusId(flat[i - 1].block.id);
  };

  // Move srcId to position relative to destId. position: 'before' | 'after' | 'child'
  const onMove = (srcId, destId, position = 'after') => {
    if (srcId === destId && position !== 'up' && position !== 'down') return;
    mutate(bs => {
      const srcLoc = mnLocate(bs, srcId);
      if (!srcLoc) return;
      if (position === 'up') {
        if (srcLoc.idx > 0) {
          const [block] = srcLoc.arr.splice(srcLoc.idx, 1);
          srcLoc.arr.splice(srcLoc.idx - 1, 0, block);
        }
        return;
      }
      if (position === 'down') {
        if (srcLoc.idx < srcLoc.arr.length - 1) {
          const [block] = srcLoc.arr.splice(srcLoc.idx, 1);
          srcLoc.arr.splice(srcLoc.idx + 1, 0, block);
        }
        return;
      }
      // Prevent moving a block into its own descendant
      const isDescendant = (parent, targetId) => {
        if (!parent) return false;
        if (parent.id === targetId) return true;
        return (parent.children || []).some(c => isDescendant(c, targetId));
      };
      if (isDescendant(srcLoc.block, destId)) return;
      const block = srcLoc.block;
      // Remove from current position
      srcLoc.arr.splice(srcLoc.idx, 1);
      // Re-locate destination after removal
      const destLoc = mnLocate(bs, destId);
      if (!destLoc) {
        // destination missing — restore
        srcLoc.arr.splice(srcLoc.idx, 0, block);
        return;
      }
      if (position === 'child') {
        destLoc.block.children.push(block);
        destLoc.block.collapsed = false;
      } else if (position === 'before') {
        destLoc.arr.splice(destLoc.idx, 0, block);
      } else {
        destLoc.arr.splice(destLoc.idx + 1, 0, block);
      }
    });
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
    const top = Math.min(...rects.map(r => r.top));
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.right));
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

  const parseAiBlocks = (text) => {
    const parsed = mnMdToBlocks(String(text || '').trim());
    return parsed.length ? parsed : [mkBlock({ kind: 'paragraph', content: String(text || '').trim() })];
  };

  const requestAiEdit = async (actionId, scope, sourceText, instructionOverride, options = {}) => {
    const action = mnAiAction(actionId);
    const novelConfig = readNovelistAiConfig();
    if (!window.mn?.ai?.edit) throw new Error('AI editing is not available');
	    const payload = {
	      text: sourceText,
	      instruction: instructionOverride || action.instruction,
	      scope,
	      vaultId,
	      useNovelistConfig: !!novelConfig,
	    };
    const res = options.onToken && window.mn.ai.editStream
      ? await window.mn.ai.editStream(payload, options.onToken)
      : await window.mn.ai.edit(payload);
    if (!res.ok) throw new Error(res.error || 'AI edit failed');
    if (res.value && !res.value.ok) throw new Error(res.value.error || 'AI edit failed');
    return res.value.text;
  };

  const readNovelistAiConfig = () => {
    if (!(noteTags || []).some(tag => String(tag || '').startsWith('novel-'))) return null;
    const config = window.mnReadNovelistAiConfig?.(vaultId);
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
  const makeAiPreview = (requestNoteId, preview) => ({ ...preview, noteId: requestNoteId || noteIdRef.current || '' });

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
            setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'blocks', blockIds: ids } }));
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
          setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'text', blockId: selection.blockId, start: selection.start, end: selection.end } }));
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
                  actionId,
                  text: edited,
                  streaming: false,
                  target: appendPlotWrite ? { kind: 'append-page' } : { kind: 'insert-after', blockId },
                }
          ));
          return;
        }
        if (action.preview) {
          setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'section', blockId } }));
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
                actionId,
                text: edited,
                streaming: false,
                target: { kind: 'append-page' },
              }
        ));
        return;
      }
      if (action.preview) {
        setAiPreview(makeAiPreview(requestNoteId, { actionId, text: edited, target: { kind: 'page' } }));
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
    onAiAction: runAiAction,
    aiPreview: previewForCurrentNote,
    onApplyAiPreview: applyAiPreview,
    onCancelAiPreview: cancelAiPreview,
    aiTarget: (!aiTarget?.noteId || !noteId || aiTarget.noteId === noteId) ? aiTarget : null,
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
  };

  // Find zoomed block.
  const zoomLoc = zoomBlockId ? mnLocate(blocks, zoomBlockId) : null;
  const zoomBlock = zoomLoc ? zoomLoc.block : null;
  // When zoomed: show the zoom block's content AS the title in the zoom bar,
  // and its children become the editable list.
  const renderBlocks = zoomBlock ? (zoomBlock.children || []) : blocks;
  const ctxBlock = ctxMenu ? mnLocate(blocks, ctxMenu.blockId)?.block : null;
  const currentAiTarget = (!aiTarget?.noteId || !noteId || aiTarget.noteId === noteId) ? aiTarget : null;

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

window.MnOutliner = MnOutliner;
window.MnBlockRow = MnBlockRow;
window.MnMemoBlockRow = MnMemoBlockRow;
