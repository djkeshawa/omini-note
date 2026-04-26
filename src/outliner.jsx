// OminiNote outliner — typed-block editor.
//
// Block kinds: paragraph (default), heading, bullet, todo, quote, code, table, divider.
// - Enter behavior depends on kind (see handleEnter).
// - Tab/Shift+Tab: indent/outdent (only for bullet/todo).
// - Disclosure triangle: separate from bullet, only shown when block has children.
// - Selection toolbar: appears on text selection, applies annotations.
// - Slash menu: type "/" at start of an empty block (or after space) to convert.

const { useState: useStateOE, useRef: useRefOE, useEffect: useEffectOE,
        useMemo: useMemoOE, useLayoutEffect: useLayoutEffectOE } = React;
const { mkBlock, mnLocate, mnCloneBlocks, mnFlatten, mnIsListLike, mnBlocksToMd, mnMdToBlocks } = window.MN_OUTLINE;
const MnInline = window.MnInline;
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
  { id: 'link',   label: 'Link to note', hint: 'Wiki-link to a note', kbd: '[[', icon: '⇉', insert: '[[' },
  { id: 'tag',    label: 'Tag',        hint: 'Categorize',           kbd: '#tag', icon: '#', insert: '#' },
  { id: 'date',   label: "Today's date", hint: 'Insert YYYY-MM-DD',  kbd: '@today', icon: '☉',
    insertFn: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }},
  { id: 'remind', label: 'Reminder',   hint: 'Schedule reminder',   kbd: '@remind', icon: '⏰', insert: '@remind(tomorrow 9am)' },
  { id: 'ai-improve-page', label: 'AI: Improve writing on this page', hint: 'Rewrite the whole page body', kbd: '/ai improve', icon: '✦', aiAction: 'improve', aiScope: 'page' },
  { id: 'ai-format-page', label: 'AI: Format this page', hint: 'Clean up the whole page body', kbd: '/ai format', icon: 'AI', aiAction: 'format', aiScope: 'page' },
  { id: 'ai-summarize-page', label: 'AI: Summarize this page', hint: 'Replace page body with a summary', kbd: '/ai summary', icon: 'Σ', aiAction: 'summarize', aiScope: 'page' },
  { id: 'ai-concise-page', label: 'AI: Make this page concise', hint: 'Shorten the whole page body', kbd: '/ai concise', icon: '↘', aiAction: 'concise', aiScope: 'page' },
  { id: 'ai-fix-page', label: 'AI: Fix spelling on this page', hint: 'Correct the whole page body', kbd: '/ai fix', icon: '✓', aiAction: 'fix', aiScope: 'page' },
  { id: 'ai-write-section', label: 'AI: Write in this section', hint: 'Preview generated text before applying', kbd: '/ai write', icon: '+', aiAction: 'write', aiScope: 'section' },
  // Workflow markers
  { id: 'wf-todo',      label: 'TODO',      hint: 'Workflow: not started', kbd: '/TODO',      icon: 'T', workflow: 'TODO' },
  { id: 'wf-doing',     label: 'DOING',     hint: 'Workflow: in progress', kbd: '/DOING',     icon: 'D', workflow: 'DOING' },
  { id: 'wf-done',      label: 'DONE',      hint: 'Workflow: finished',    kbd: '/DONE',      icon: '✓', workflow: 'DONE' },
  { id: 'wf-later',     label: 'LATER',     hint: 'Workflow: deferred',    kbd: '/LATER',     icon: 'L', workflow: 'LATER' },
  { id: 'wf-now',       label: 'NOW',       hint: 'Workflow: doing now',   kbd: '/NOW',       icon: 'N', workflow: 'NOW' },
  { id: 'wf-wait',      label: 'WAIT',      hint: 'Workflow: blocked',     kbd: '/WAIT',      icon: 'W', workflow: 'WAIT' },
  { id: 'wf-cancelled', label: 'CANCELLED', hint: 'Workflow: cancelled',   kbd: '/CANC',      icon: '✗', workflow: 'CANCELLED' },
];

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
  onChange, onChangeKind, onIndent, onOutdent, onSplit, onMergePrev,
  onInsertBlocksAt,
  onToggleCollapse, onToggleCheck, onSetAnnotation, onClearAnnotation,
  onFocusNext, onFocusPrev, onDelete, onOpen, onTagClick,
  onSelectionChange, setFocusId,
  onMove, onContextMenu, onZoom, onAiAction, aiTarget,
  onBlockMouseDown, onBlockMouseEnter, selectedBlockIds,
  onBeginContentEdit, onEndContentEdit,
  editorFontSize,
}) {
  const [editing, setEditing] = useStateOE(focusId === block.id);
  const [autoQ, setAutoQ] = useStateOE(null);   // wiki autocomplete query
  const [autoIdx, setAutoIdx] = useStateOE(0);
  const [slashQ, setSlashQ] = useStateOE(null); // slash menu query
  const [slashIdx, setSlashIdx] = useStateOE(0);
  const [dropPos, setDropPos] = useStateOE(null); // 'before' | 'after' | 'child' | null
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

  const hasChildren = block.children && block.children.length > 0;
  const isList = mnIsListLike(block.kind);
  const indentPx = depth * 24;
  const aiActive =
    (aiTarget?.scope === 'section' && aiTarget.blockId === block.id) ||
    (aiTarget?.scope === 'selection' && (aiTarget.blockIds || []).includes(block.id));
  const selectedAsArea = selectedBlockIds?.has(block.id);

  const slashMatches = useMemoOE(() => {
    if (slashQ == null) return [];
    return MN_SLASH_CMDS
      .map((cmd, index) => ({ cmd, index, score: mnSlashCommandScore(cmd, slashQ.query) }))
      .filter(x => x.score !== Infinity)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(x => x.cmd);
  }, [slashQ]);

  const wikiSuggestions = useMemoOE(() => {
    if (autoQ == null) return [];
    const q = autoQ.toLowerCase();
    return (allNotes || []).filter(n => n.title.toLowerCase().includes(q)).slice(0, 6);
  }, [autoQ, allNotes]);

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
          onChangeKind(block.id, { kind: 'paragraph', level: 0, checked: null });
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
    const wm = before.match(/\[\[([^\]\n]*)$/);
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
    if (!markdown) return;
    const ta = inputRef.current;
    if (!ta) return;
    e.preventDefault();
    setAutoQ(null);
    setSlashQ(null);
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const fullSelection = start === 0 && end === String(block.content || '').length;
    if (!String(block.content || '').trim() || fullSelection) {
      onChangeKind(block.id, {
        kind: 'table',
        level: 0,
        checked: null,
        content: markdown,
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
  };

  const handleCopy = (e) => {
    if (block.kind !== 'table' || !mnMarkdownTableToHtml) return;
    const html = mnMarkdownTableToHtml(block.content || '');
    if (!html || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', block.content || '');
    e.clipboardData.setData('text/html', html);
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
    if (cmd.kind) {
      // Convert block kind and strip the slash text in one mutation. Splitting
      // this into onChangeKind() then onChange() can lose the kind update when
      // the parent supplies a non-React setBlocks wrapper.
      onChangeKind(block.id, {
        kind: cmd.kind,
        level: cmd.level || 0,
        checked: cmd.checked != null ? cmd.checked : null,
        content: cleanContent || cmd.content || '',
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
      {Array.from({ length: depth }, (_, i) => (
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
        {editing ? (
          <>
            <textarea
              ref={inputRef}
              value={block.content}
              onChange={handleInput}
              onPaste={handlePaste}
              onCopy={handleCopy}
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
                if (block.kind === 'table') {
                  return <MnMarkdownTable markdown={content} T={T} />;
                }
                if (content) {
                  return mnRenderAnnotated(content, block.annotations, T, onOpen, onTagClick, allNotes);
                }
                return <span style={{ color: T.inkDim, fontStyle: 'italic' }}>{mnPlaceholder(block)}</span>;
              })()}
            </span>
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
      fontWeight: 600, color: T.ink, letterSpacing: '-0.015em', lineHeight: 1.25,
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
  // Re-measure every render (cheap; setState bails out via equality guard)
  React.useLayoutEffect(() => { measure(); });
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

// ── Recursive tree renderer ────────────────────────────────────────────
function MnOutlineTree({ blocks, depth, ...handlers }) {
  return (
    <>
      {blocks.map(b => (
        <React.Fragment key={b.id}>
          <MnBlockRow block={b} depth={depth} {...handlers} />
          {b.children && b.children.length > 0 && !b.collapsed && (
            <MnOutlineTree blocks={b.children} depth={depth + 1} {...handlers} />
          )}
        </React.Fragment>
      ))}
    </>
  );
}

// ── Main outliner component ────────────────────────────────────────────
function MnOutliner({ blocks, setBlocks, allNotes, onOpen, onTagClick, T, zoomBlockId, onZoomBlock, onShowToast, noteTitle, fontSize }) {
  const [focusId, setFocusId] = useStateOE(null);
  const [selection, setSelection] = useStateOE(null); // { blockId, start, end, rect }
  const [ctxMenu, setCtxMenu] = useStateOE(null); // { blockId, x, y } | null
  const [aiMenu, setAiMenu] = useStateOE(null); // { scope, blockId, x, y } | null
  const [aiBusy, setAiBusy] = useStateOE(false);
  const [aiTarget, setAiTarget] = useStateOE(null); // { scope, blockId? } | null
  const [aiPreview, setAiPreview] = useStateOE(null);
  const selectDragRef = useRefOE(null);
  const undoStack = useRefOE([]);
  const redoStack = useRefOE([]);
  const undoActionRef = useRefOE(null);
  const redoActionRef = useRefOE(null);
  const selectionRef = useRefOE(null);
  const deleteSelectionRef = useRefOE(null);
  const focusIdRef = useRefOE(null);
  const moveBlockRef = useRefOE(null);
  const duplicateBlockRef = useRefOE(null);
  const deleteBlockRef = useRefOE(null);
  const zoomBlockRef = useRefOE(null);
  const contentEditHistoryRef = useRefOE({ blockId: null, armed: false });

  const snapshotBlocks = (value = blocks) => mnCloneBlocks(value || []);

  useEffectOE(() => {
    undoStack.current = [];
    redoStack.current = [];
  }, [noteTitle]);

  const mutate = (fn, options = {}) => {
    setBlocks(prev => {
      if (options.history !== false) {
        undoStack.current.push(snapshotBlocks(prev));
        if (undoStack.current.length > 80) undoStack.current.shift();
        redoStack.current = [];
      }
      const next = mnCloneBlocks(prev);
      fn(next);
      return next;
    });
  };

  const replaceAllBlocks = (nextBlocks, options = {}) => {
    setBlocks(prev => {
      if (options.history !== false) {
        undoStack.current.push(snapshotBlocks(prev));
        if (undoStack.current.length > 80) undoStack.current.shift();
        redoStack.current = [];
      }
      return snapshotBlocks(nextBlocks);
    });
  };

  const undo = () => {
    if (!undoStack.current.length) return false;
    contentEditHistoryRef.current = { blockId: null, armed: false };
    setBlocks(prev => {
      const prior = undoStack.current.pop();
      if (!prior) return prev;
      redoStack.current.push(snapshotBlocks(prev));
      return snapshotBlocks(prior);
    });
    return true;
  };

  const redo = () => {
    if (!redoStack.current.length) return false;
    contentEditHistoryRef.current = { blockId: null, armed: false };
    setBlocks(prev => {
      const next = redoStack.current.pop();
      if (!next) return prev;
      undoStack.current.push(snapshotBlocks(prev));
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
      const isUndo = isMod && lowerKey === 'z' && !e.shiftKey;
      const isRedo = (isMod && e.shiftKey && lowerKey === 'z') || (isMod && lowerKey === 'y');
      const isAreaDelete = (key === 'Backspace' || key === 'Delete') && selectionRef.current && !isMod;
      const isBlockZoom = isMod && key === 'Enter';
      const isBlockMoveUp = e.altKey && !isMod && key === 'ArrowUp';
      const isBlockMoveDown = e.altKey && !isMod && key === 'ArrowDown';
      const isBlockDuplicate = isMod && lowerKey === 'd';
      const isBlockDelete = isMod && (key === 'Backspace' || key === 'Delete');
      const isBlockShortcut = isBlockZoom || isBlockMoveUp || isBlockMoveDown || isBlockDuplicate || isBlockDelete;
      if (!isUndo && !isRedo && !isAreaDelete && !isBlockShortcut) return;
      const target = e.target;
      const tag = target?.tagName;
      const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      if ((isUndo || isRedo) && isFormField && !target.closest?.('.mn-block-row')) return;
      const insideOutliner = !!target.closest?.('.mn-outliner');
      const activeInsideOutliner = !!document.activeElement?.closest?.('.mn-outliner');
      if ((isAreaDelete || isBlockShortcut) && !insideOutliner && !activeInsideOutliner) return;
      const activeBlockId = () => {
        const currentSelection = selectionRef.current;
        if (currentSelection?.kind === 'blocks' && currentSelection.blockIds?.length) return currentSelection.blockIds[0];
        return focusIdRef.current;
      };
      if (isBlockShortcut && !activeBlockId()) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation && e.stopImmediatePropagation();
      if (isAreaDelete) deleteSelectionRef.current && deleteSelectionRef.current();
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
      if (e.target.closest?.('.mn-selection-toolbar') || e.target.closest?.('.mn-ai-action-menu')) return;
      setSelection(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [selection]);

  const parseAiBlocks = (text) => {
    const parsed = mnMdToBlocks(String(text || '').trim());
    return parsed.length ? parsed : [mkBlock({ kind: 'paragraph', content: String(text || '').trim() })];
  };

  const requestAiEdit = async (actionId, scope, sourceText, instructionOverride) => {
    const action = mnAiAction(actionId);
    if (!window.mn?.ai?.edit) throw new Error('AI editing is not available');
    const res = await window.mn.ai.edit({
      text: sourceText,
      instruction: instructionOverride || action.instruction,
      scope,
    });
    if (!res.ok) throw new Error(res.error || 'AI edit failed');
    if (res.value && !res.value.ok) throw new Error(res.value.error || 'AI edit failed');
    return res.value.text;
  };

  const writeInstruction = (scope, userRequest, sourceText) => {
    return [
      mnAiAction('write').instruction,
      `User request: ${userRequest}`,
      sourceText?.trim()
        ? 'Use the existing text below as local context. Replace it with the newly written text.'
        : 'Write new text for this empty location.',
    ].join('\n\n');
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

  const applyPageReplacement = (text) => replaceAllBlocks(parseAiBlocks(text));

  const applyAiPreview = () => {
    if (!aiPreview) return;
    if (aiPreview.target.kind === 'text') applyTextReplacement(aiPreview.target, aiPreview.text);
    else if (aiPreview.target.kind === 'blocks') applyBlocksReplacement(aiPreview.target, aiPreview.text);
    else if (aiPreview.target.kind === 'section') applySectionReplacement(aiPreview.target, aiPreview.text);
    else if (aiPreview.target.kind === 'page') applyPageReplacement(aiPreview.text);
    onShowToast && onShowToast(`${mnAiAction(aiPreview.actionId).sectionLabel} applied`);
    setAiPreview(null);
    setSelection(null);
  };

  const runAiAction = async (actionId, scope, payload = {}) => {
    if (scope === 'section-menu') {
      setAiMenu({ scope: 'section', blockId: payload.blockId, x: payload.x || 0, y: payload.y || 0 });
      return;
    }
    const action = mnAiAction(actionId);
    let userRequest = null;
    if (action.needsPrompt) {
      userRequest = window.prompt(
        scope === 'page' ? 'What should AI write on this page?' :
        scope === 'section' ? 'What should AI write in this section?' :
        'What should AI write for this selection?',
        ''
      );
      if (!userRequest || !userRequest.trim()) return;
    }
    if (aiBusy) return;
    setAiBusy(true);
    setAiTarget({
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
            setAiPreview({ actionId, text: edited, target: { kind: 'blocks', blockIds: ids } });
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
          setAiPreview({ actionId, text: edited, target: { kind: 'text', blockId: selection.blockId, start: selection.start, end: selection.end } });
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
        const edited = await requestAiEdit(
          actionId,
          'section',
          source,
          action.needsPrompt ? writeInstruction('section', userRequest, source) : null
        );
        if (action.preview) {
          setAiPreview({ actionId, text: edited, target: { kind: 'section', blockId } });
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
      const edited = await requestAiEdit(
        actionId,
        'page',
        source,
        action.needsPrompt ? writeInstruction('page', userRequest, source) : null
      );
      if (action.preview) {
        setAiPreview({ actionId, text: edited, target: { kind: 'page' } });
        return;
      }
      applyPageReplacement(edited);
      onShowToast && onShowToast(`${mnAiAction(actionId).pageLabel} applied`);
    } catch (e) {
      console.error('AI edit failed', e);
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
    aiTarget, focusId, setFocusId, T, allNotes,
    onSelectionChange: setSelection,
    onBlockMouseDown: beginBlockSelection,
    onBlockMouseEnter: extendBlockSelection,
    selectedBlockIds,
    onBeginContentEdit,
    onEndContentEdit,
    editorFontSize: fontSize,
  };

  // Find zoomed block.
  const zoomLoc = zoomBlockId ? mnLocate(blocks, zoomBlockId) : null;
  const zoomBlock = zoomLoc ? zoomLoc.block : null;
  // When zoomed: show the zoom block's content AS the title in the zoom bar,
  // and its children become the editable list.
  const renderBlocks = zoomBlock ? (zoomBlock.children || []) : blocks;
  const ctxBlock = ctxMenu ? mnLocate(blocks, ctxMenu.blockId)?.block : null;

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
        @keyframes mnAiPulse {
          0%, 100% { opacity: 0.34; transform: scale(0.998); }
          50% { opacity: 0.72; transform: scale(1.001); }
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
      {aiTarget?.scope === 'page' && (
        <div className="mn-ai-page-working" style={{
          position: 'absolute',
          inset: '-4px -6px 24px',
          borderRadius: 10,
          pointerEvents: 'none',
          background: `linear-gradient(120deg, transparent, color-mix(in oklab, ${T.accent || T.ink} 3%, transparent), transparent)`,
          zIndex: 0,
        }} />
      )}
      {aiTarget && (
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
          {mnAiAction(aiTarget.actionId).selectionLabel.replace('selected text', aiTarget.scope === 'page' ? 'page' : aiTarget.scope === 'section' ? 'section' : 'selected text')}...
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
      {aiPreview && (
        <MnAiPreviewDialog
          preview={aiPreview}
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
          onZoom={() => onZoomBlock && onZoomBlock(ctxBlock.id)}
          onIndent={() => onIndent(ctxBlock.id)}
          onOutdent={() => onOutdent(ctxBlock.id)}
          onMoveUp={() => onMove(ctxBlock.id, ctxBlock.id, 'up')}
          onMoveDown={() => onMove(ctxBlock.id, ctxBlock.id, 'down')}
          onDuplicate={() => onDuplicate(ctxBlock.id)}
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
