// VispNote block features: workflow markers, block refs, embeds, properties, context menu.
//
// Block markers: legacy workflow tokens kept for markdown compatibility.
//   - stored in block.workflow (string | null)
//   - rendered as colored pill at start of block content
//   - slash command sets it; clicking pill cycles through states
//
// Block refs: ((block-id-here)) → renders inline as a quoted excerpt of the target block
// Block embeds: {{embed [[Page Title]]}} or {{embed ((id))}} → renders inline as a card
// Page properties: leading lines matching `key:: value` → rendered as a properties table
//
// Right-click context menu on bullet: copy ref, copy embed, zoom in, move, indent/outdent, delete

const MN_DEFAULT_WORKFLOW_STATES = [
  { id: 'TODO',      next: 'DOING',     color: 'oklch(0.55 0.18 30)',  bg: 'oklch(0.96 0.04 30)'  },
  { id: 'DOING',     next: 'DONE',      color: 'oklch(0.55 0.18 250)', bg: 'oklch(0.95 0.04 250)' },
  { id: 'DONE',      next: null,        color: 'oklch(0.55 0.15 145)', bg: 'oklch(0.95 0.04 145)' },
  { id: 'LATER',     next: 'NOW',       color: 'oklch(0.55 0.16 290)', bg: 'oklch(0.95 0.04 290)' },
  { id: 'NOW',       next: 'DONE',      color: 'oklch(0.55 0.18 30)',  bg: 'oklch(0.96 0.04 30)'  },
  { id: 'WAIT',      next: 'TODO',      color: 'oklch(0.55 0.10 60)',  bg: 'oklch(0.95 0.04 60)'  },
  { id: 'CANCELLED', next: null,        color: 'oklch(0.55 0.05 250)', bg: 'oklch(0.95 0.02 250)' },
];

let MN_WORKFLOW_STATES = MN_DEFAULT_WORKFLOW_STATES;

function mnNormalizeWorkflowId(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
}

function mnWorkflowColor(index) {
  const hues = [30, 250, 145, 290, 15, 60, 205, 330, 115, 275, 180, 5];
  return hues[index % hues.length];
}

function mnNormalizeWorkflowStates(states) {
  if (Array.isArray(states) && states.length === 0) return [];
  const byDefault = Object.fromEntries(MN_DEFAULT_WORKFLOW_STATES.map(s => [s.id, s]));
  const seen = new Set();
  const source = Array.isArray(states) && states.length ? states : MN_DEFAULT_WORKFLOW_STATES;
  const next = source.map((state, index) => {
    const id = mnNormalizeWorkflowId(state?.id || state);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const fallback = byDefault[id] || {};
    const hue = mnWorkflowColor(index);
    return {
      id,
      color: state?.color || fallback.color || `oklch(0.55 0.16 ${hue})`,
      bg: state?.bg || fallback.bg || `oklch(0.95 0.04 ${hue})`,
      next: Object.prototype.hasOwnProperty.call(state || {}, 'next')
        ? (state.next ? mnNormalizeWorkflowId(state.next) : null)
        : (Object.prototype.hasOwnProperty.call(fallback, 'next')
          ? (fallback.next ? mnNormalizeWorkflowId(fallback.next) : null)
          : undefined),
    };
  }).filter(Boolean);
  const safe = next.length ? next : MN_DEFAULT_WORKFLOW_STATES;
  const safeIds = new Set(safe.map(state => state.id));
  return safe.map((state, index) => ({
    ...state,
    next: state.next === undefined
      ? (safe[index + 1]?.id || null)
      : (state.next && safeIds.has(state.next) ? state.next : null),
  }));
}

function mnSetWorkflowStates(states) {
  MN_WORKFLOW_STATES = mnNormalizeWorkflowStates(states);
  if (window.MN_LOGSEQ) window.MN_LOGSEQ.WORKFLOW_STATES = MN_WORKFLOW_STATES;
  return MN_WORKFLOW_STATES;
}

function mnWorkflow(id) {
  return MN_WORKFLOW_STATES.find(s => s.id === id) || null;
}

function mnWorkflowIsClosed(state) {
  const workflow = typeof state === 'string' ? mnWorkflow(state) : state;
  return !!workflow && workflow.next === null;
}

function MnWorkflowPill({ state, onClick, T }) {
  const s = mnWorkflow(state);
  if (!s) return null;
  return (
    <button
      onClick={onClick}
      title={`Click to cycle block marker (next: ${s.next || 'remove'})`}
      style={{
        fontFamily: 'var(--mn-mono)', fontSize: 9.5,
        fontWeight: 700, letterSpacing: '0.06em',
        color: s.color, background: s.bg,
        padding: '1px 5px', borderRadius: 3,
        border: 'none', cursor: 'pointer',
        marginRight: 5,
        verticalAlign: 'middle', display: 'inline-block',
        lineHeight: 1.5,
        textDecoration: mnWorkflowIsClosed(s) ? 'line-through' : 'none',
        opacity: mnWorkflowIsClosed(s) ? 0.7 : 1,
      }}>{s.id}</button>
  );
}

// Detect a property line: "key:: value"
function mnIsPropertyLine(content) {
  return /^[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(content);
}
function mnParseProperty(content) {
  const m = content.match(/^([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
  if (!m) return null;
  return { key: m[1], value: m[2] };
}

// Render a property line as a key-value chip
function MnPropertyRow({ property, T }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'var(--mn-mono)', fontSize: 11,
      padding: '1px 0',
    }}>
      <span style={{ color: T.inkDim, letterSpacing: '0.02em' }}>{property.key}</span>
      <span style={{ color: T.lineSub }}>::</span>
      <span style={{
        color: T.ink,
        background: T.bgSub, padding: '1px 6px', borderRadius: 3,
        fontFamily: 'var(--mn-body)', fontSize: 12,
      }}>{property.value || <span style={{ color: T.inkDim, fontStyle: 'italic' }}>empty</span>}</span>
    </span>
  );
}

// Look up a block by id across all blocks (recursive)
function mnFindBlockById(blocks, id) {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children && b.children.length) {
      const found = mnFindBlockById(b.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Render a block reference inline: shows the target block's content as a chip.
// `allNotes` is array of {id, title, blocks}
function MnBlockRef({ refId, allNotes, T, onOpenBlock }) {
  // Find the block across all notes
  let targetBlock = null;
  let parentNote = null;
  for (const n of (allNotes || [])) {
    const blocks = n.blocks || [];
    const found = mnFindBlockById(blocks, refId);
    if (found) { targetBlock = found; parentNote = n; break; }
  }
  if (!targetBlock) {
    return (
      <span style={{
        fontFamily: 'var(--mn-mono)', fontSize: 11,
        color: T.warn, padding: '0 4px', borderRadius: 3,
        border: `1px dashed ${T.warn}`,
      }}>?? ref({refId.slice(-6)})</span>
    );
  }
  return (
    <a
      onClick={(e) => { e.preventDefault(); onOpenBlock && onOpenBlock(parentNote.id, targetBlock.id); }}
      title={`In: ${parentNote.title}`}
      style={{
        display: 'inline', cursor: 'pointer',
        background: T.bgSub, color: T.ink,
        padding: '1px 6px', borderRadius: 3,
        borderBottom: `1px dotted ${T.accent}`,
        fontFamily: 'var(--mn-body)', fontSize: 'inherit',
      }}>
      <span style={{
        marginRight: 4, fontFamily: 'var(--mn-mono)', fontSize: 9.5,
        color: T.inkDim, letterSpacing: '0.04em',
      }}>«</span>
      {targetBlock.content.slice(0, 80) || <em style={{color: T.inkDim}}>empty block</em>}
      {targetBlock.content.length > 80 && '…'}
    </a>
  );
}

// Render a page embed as a card. Note titles are case-insensitive matched.
function MnPageEmbed({ title, allNotes, T, onOpenNote }) {
  const note = (allNotes || []).find(n => n.title.toLowerCase() === title.toLowerCase());
  if (!note) {
    return (
      <div style={{
        margin: '4px 0', padding: '6px 10px',
        fontFamily: 'var(--mn-mono)', fontSize: 11,
        color: T.warn, border: `1px dashed ${T.warn}`, borderRadius: 4,
      }}>?? embed: page "{title}" not found</div>
    );
  }
  // Render first 6 blocks flat
  const flat = (note.blocks || []).slice(0, 6);
  return (
    <div
      onClick={() => onOpenNote && onOpenNote(note.id)}
      style={{
        margin: '6px 0', padding: '8px 12px',
        background: T.bgSub, border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${T.accent}`, borderRadius: 4,
        cursor: 'pointer',
      }}>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4,
      }}>↗ Embedded page</div>
      <div style={{ fontFamily: 'var(--mn-body)', fontSize: 14, fontWeight: 600, color: T.ink, marginBottom: 4 }}>
        {note.title}
      </div>
      {flat.map(b => (
        <div key={b.id} style={{
          fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed,
          padding: '1px 0',
        }}>
          {b.kind === 'bullet' && '• '}
          {b.kind === 'todo' && (b.checked ? '☑ ' : '☐ ')}
          {b.kind === 'heading' && `${'#'.repeat(b.level || 1)} `}
          {b.content || <em style={{color: T.inkDim}}>empty</em>}
        </div>
      ))}
      {(note.blocks || []).length > 6 && (
        <div style={{ fontSize: 11, color: T.inkDim, marginTop: 3 }}>
          + {note.blocks.length - 6} more blocks…
        </div>
      )}
    </div>
  );
}

// Block embed: render the target block + its children in a card
function MnBlockEmbed({ refId, allNotes, T, onOpenBlock }) {
  let targetBlock = null;
  let parentNote = null;
  for (const n of (allNotes || [])) {
    const found = mnFindBlockById(n.blocks || [], refId);
    if (found) { targetBlock = found; parentNote = n; break; }
  }
  if (!targetBlock) {
    return (
      <div style={{
        margin: '4px 0', padding: '6px 10px',
        fontFamily: 'var(--mn-mono)', fontSize: 11,
        color: T.warn, border: `1px dashed ${T.warn}`, borderRadius: 4,
      }}>?? embed: block ({refId.slice(-6)}) not found</div>
    );
  }
  const renderBlock = (b, depth = 0) => (
    <div key={b.id} style={{ paddingLeft: depth * 14, padding: '1px 0' }}>
      <span style={{
        fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkMed,
      }}>
        {b.kind === 'bullet' && '• '}
        {b.kind === 'todo' && (b.checked ? '☑ ' : '☐ ')}
        {b.kind === 'heading' && (
          <span style={{ fontWeight: 600, color: T.ink }}>{'#'.repeat(b.level || 1)} </span>
        )}
        {b.content || <em style={{color: T.inkDim}}>empty</em>}
      </span>
      {b.children && b.children.map(c => renderBlock(c, depth + 1))}
    </div>
  );
  return (
    <div
      onClick={() => onOpenBlock && onOpenBlock(parentNote.id, targetBlock.id)}
      style={{
        margin: '6px 0', padding: '8px 12px',
        background: T.bgSub, border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${T.accent2 || T.accent}`, borderRadius: 4,
        cursor: 'pointer',
      }}>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4,
      }}>↗ Embedded block · in {parentNote.title}</div>
      {renderBlock(targetBlock)}
    </div>
  );
}

// Right-click context menu on a bullet
function MnBlockContextMenu({
  block, x, y, onClose, onCopyRef, onCopyEmbed, onCopyBlock, onCutBlock,
  onPasteAfter, onZoom, onIndent, onOutdent, onMoveUp, onMoveDown,
  onDelete, onDuplicate, onAddLabel, onSetWorkflow, onChangeKind, T
}) {
  React.useEffect(() => {
    const onDown = (e) => {
      // Close on click outside menu
      if (!e.target.closest('.mn-block-ctx-menu')) onClose();
    };
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const Item = ({ icon, label, kbd, onClick, divider, danger }) => {
    if (divider) return <div style={{ height: 1, background: T.lineSub, margin: '4px 0' }} />;
    return (
      <button
        onMouseDown={(e) => { e.preventDefault(); onClick(); onClose(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '5px 10px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--mn-ui)', fontSize: 12.5,
          color: danger ? T.warn : T.ink,
        }}
        onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <span style={{ width: 14, fontSize: 12, color: T.inkDim, textAlign: 'center' }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {kbd && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{kbd}</span>
        )}
      </button>
    );
  };

  // Constrain to viewport
  const w = 230, h = 360;
  const px = Math.min(x, window.innerWidth - w - 8);
  const py = Math.min(y, window.innerHeight - h - 8);

  return (
    <div className="mn-block-ctx-menu" style={{
      position: 'fixed', top: py, left: px, width: w,
      background: T.bg, border: `1px solid ${T.line}`,
      borderRadius: 6, padding: '4px 0',
      boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
      zIndex: 200,
      fontFamily: 'var(--mn-ui)',
    }}>
      <div style={{
        padding: '4px 10px 6px',
        fontFamily: 'var(--mn-mono)', fontSize: 9, color: T.inkDim,
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>Block · {block.id.slice(-6)}</div>
      <Item icon="⤓" label="Zoom into block"      kbd="⌘↵"   onClick={onZoom} />
      <Item divider />
      <Item icon="⌘"  label="Copy block ref"      onClick={onCopyRef} />
      <Item icon="⎘"  label="Copy block embed"    onClick={onCopyEmbed} />
      <Item icon="C"  label="Copy block"          kbd="⌘C"   onClick={onCopyBlock} />
      <Item icon="X"  label="Cut block"           kbd="⌘X"   onClick={onCutBlock} />
      <Item icon="V"  label="Paste after"         kbd="⌘V"   onClick={onPasteAfter} />
      <Item divider />
      <Item icon="→"  label="Indent"               kbd="Tab"   onClick={onIndent} />
      <Item icon="←"  label="Outdent"              kbd="⇧Tab"  onClick={onOutdent} />
      <Item icon="↑"  label="Move up"              kbd="⌥↑"   onClick={onMoveUp} />
      <Item icon="↓"  label="Move down"            kbd="⌥↓"   onClick={onMoveDown} />
      <Item divider />
      <Item icon="⊕"  label="Duplicate"            kbd="⌘D"   onClick={onDuplicate} />
      <Item icon="L"  label="Add label"            kbd="/label" onClick={onAddLabel} />
      <Item divider />
      <div style={{
        padding: '4px 10px 4px',
        fontFamily: 'var(--mn-mono)', fontSize: 9, color: T.inkDim,
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>Convert to</div>
      {[
        { kind: 'paragraph', label: 'Paragraph', icon: '¶' },
        { kind: 'bullet',    label: 'Bullet',    icon: '•' },
        { kind: 'todo',      label: 'To-do',     icon: '☐' },
        { kind: 'heading',   label: 'Heading',   icon: 'H', level: 2 },
        { kind: 'quote',     label: 'Quote',     icon: '❝' },
      ].filter(opt => block.kind !== opt.kind).map(opt => (
        <Item key={opt.kind} icon={opt.icon} label={opt.label}
          onClick={() => onChangeKind && onChangeKind({
            kind: opt.kind, level: opt.level || 0,
            checked: opt.kind === 'todo' ? false : null,
          })} />
      ))}
      <Item divider />
      <div style={{
        padding: '4px 10px 4px',
        fontFamily: 'var(--mn-mono)', fontSize: 9, color: T.inkDim,
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>Block marker</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 10px 6px' }}>
        {MN_WORKFLOW_STATES.map(s => (
          <button key={s.id}
            onMouseDown={(e) => { e.preventDefault(); onSetWorkflow(s.id); onClose(); }}
            style={{
              fontFamily: 'var(--mn-mono)', fontSize: 9.5, fontWeight: 700,
              padding: '2px 5px', borderRadius: 3,
              color: s.color, background: s.bg, border: 'none', cursor: 'pointer',
              letterSpacing: '0.06em',
            }}>{s.id}</button>
        ))}
        <button
          onMouseDown={(e) => { e.preventDefault(); onSetWorkflow(null); onClose(); }}
          style={{
            fontFamily: 'var(--mn-mono)', fontSize: 9.5,
            padding: '2px 5px', borderRadius: 3,
            color: T.inkDim, background: T.bgSub, border: `1px solid ${T.line}`, cursor: 'pointer',
          }}>clear</button>
      </div>
      <Item divider />
      <Item icon="🗑" label="Delete block"          kbd="⌘⌫"  onClick={onDelete} danger />
    </div>
  );
}

// Zoom-into-block bar at top of editor when zoomed
function MnZoomBar({ block, noteTitle, onExit, onCopyRef, T, onChangeContent }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(block.content);
  React.useEffect(() => setDraft(block.content), [block.id, block.content]);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 0',
        fontFamily: 'var(--mn-mono)', fontSize: 11,
        color: T.inkDim,
      }}>
        <button onClick={onExit} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '2px 6px 2px 0', borderRadius: 4,
          fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.ink,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M7.5 3L4.5 6L7.5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>{noteTitle || 'Note'}</span>
        </button>
        <span style={{ color: T.lineSub }}>›</span>
        <span style={{ flex: 1 }}>
          Zoomed block <span style={{ color: T.ink }}>{block.id.slice(-6)}</span>
        </span>
        <button onClick={onCopyRef} title="Copy block reference" style={{
          background: 'transparent', border: `1px solid ${T.line}`, cursor: 'pointer',
          padding: '2px 7px', borderRadius: 4,
          fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkMed,
        }}>copy ref</button>
      </div>
      {/* Zoomed block's content rendered as a "title" — click to edit */}
      <div
        onClick={() => setEditing(true)}
        style={{
          fontFamily: 'var(--mn-body)', fontSize: 24, fontWeight: 600,
          color: T.ink, letterSpacing: '-0.015em', lineHeight: 1.25,
          padding: '4px 0 12px', cursor: 'text',
          borderBottom: `1px solid ${T.lineSub}`,
          marginBottom: 12,
        }}>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); onChangeContent && onChangeContent(draft); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                setEditing(false);
                onChangeContent && onChangeContent(draft);
              }
            }}
            style={{
              width: '100%', border: 'none', outline: 'none',
              background: 'transparent', resize: 'none',
              fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
              color: 'inherit', letterSpacing: 'inherit', lineHeight: 'inherit',
              padding: 0,
            }} />
        ) : (
          block.content || <span style={{ color: T.inkDim, fontStyle: 'italic' }}>Empty block</span>
        )}
      </div>
    </div>
  );
}

window.MN_LOGSEQ = {
  WORKFLOW_STATES: MN_WORKFLOW_STATES,
  DEFAULT_WORKFLOW_STATES: MN_DEFAULT_WORKFLOW_STATES,
  mnNormalizeWorkflowId,
  mnNormalizeWorkflowStates,
  setWorkflowStates: mnSetWorkflowStates,
  mnWorkflow,
  mnWorkflowIsClosed,
  mnIsPropertyLine, mnParseProperty,
  mnFindBlockById,
};
window.MnWorkflowPill = MnWorkflowPill;
window.MnPropertyRow = MnPropertyRow;
window.MnBlockRef = MnBlockRef;
window.MnPageEmbed = MnPageEmbed;
window.MnBlockEmbed = MnBlockEmbed;
window.MnBlockContextMenu = MnBlockContextMenu;
window.MnZoomBar = MnZoomBar;
