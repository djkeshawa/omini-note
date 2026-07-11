import { MnAiIcon } from '../outlinerRenderers.jsx';

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

export { MnSelectionToolbar };
