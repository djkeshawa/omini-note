// The board's presentational pieces, at module scope.
//
// Declared inside MnWorkflowPanel they were a new component type on every
// render, so React rebuilt their DOM instead of updating it. For most of them
// that was waste; for Card it was a live bug — dragging a card fires a state
// update per pointer move, so the card being dragged was torn down and
// rebuilt continuously while it was the one thing the user was holding.
//
// The drag plumbing travels as one `board` object rather than a dozen props:
// what matters for reconciliation is that the component types are stable.

import { DS_RADIUS, mnSentenceCase } from '../../shared/designSystem.js';
import { mnGetTagColor } from '../../shared/theme.jsx';

function ModeButton({ id, label, mode, setMode, T }) {
  return (
    <button onClick={() => setMode(id)} style={{
      padding: '5px 10px',
      borderRadius: 5,
      border: 'none',
      background: mode === id ? T.bg : 'transparent',
      color: mode === id ? T.ink : T.inkMed,
      fontFamily: 'var(--mn-ui)',
      fontSize: 12,
      fontWeight: mode === id ? 600 : 500,
      cursor: 'pointer',
      boxShadow: mode === id ? `0 1px 3px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
    }}>{label}</button>
  );
}

function SummaryStat({ label, value, accent, T }) {
  return (
    <div style={{
      minWidth: 92,
      padding: '8px 10px',
      borderRadius: 7,
      border: `1px solid ${T.lineSub}`,
      background: `color-mix(in oklab, ${accent || T.bgSub} 12%, ${T.bg})`,
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10,
    }}>
      <span style={{
        fontFamily: 'var(--mn-ui)', fontWeight: 600,
        fontSize: 11,
        color: T.inkDim,
        whiteSpace: 'nowrap',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--mn-ui)',
        fontSize: 16,
        fontWeight: 650,
        color: accent || T.ink,
        lineHeight: 1,
      }}>{value}</span>
    </div>
  );
}

// A state is a dot and a word, not an uppercase mono badge — the colour
// carries the identity, so the label can just be read.
function StatePill({ state, T }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      minWidth: 0, flexShrink: 1,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: state.color, flexShrink: 0,
      }} />
      <span style={{
        fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600, color: T.ink,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{mnSentenceCase(state.id)}</span>
    </span>
  );
}

function ArchiveButton({ item, compact = false, archiveNote, T }) {
  return (
    <button
      type="button"
      title="Archive note from workflow"
      onClick={(e) => {
        e.stopPropagation();
        archiveNote(item.noteId, true);
      }}
      style={{
        height: compact ? 24 : 22,
        padding: compact ? '0 8px' : '0 6px',
        borderRadius: 5,
        border: `1px solid ${T.lineSub}`,
        background: T.bg,
        color: T.inkDim,
        fontFamily: 'var(--mn-ui)',
        fontSize: compact ? 11.5 : 11,
        cursor: 'pointer',
        flexShrink: 0,
      }}>
      Archive
    </button>
  );
}

function Card({ item, state, board }) {
  const {
    T, theme, tagHue, dragItem, isClosedState, onOpen, archiveNote,
    setActiveDragItem, clearActiveDragItem, updateDragPreview,
    setTransparentDragImage, workflowStateFromPoint, setDragOverState,
    beginCardPointerDrag, suppressCardClickRef,
  } = board;
  return (
    <div
      draggable
      onDragStart={(e) => {
        setActiveDragItem(item);
        updateDragPreview(item, state, e);
        setTransparentDragImage(e);
        const payload = JSON.stringify({ noteId: item.noteId });
        e.dataTransfer.setData('text/mn-workflow', payload);
        e.dataTransfer.setData('text/mn-note', payload);
        e.dataTransfer.setData('text/plain', `mn-note:${item.noteId}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDrag={(e) => {
        updateDragPreview(item, state, e);
        const stateId = e.clientX && e.clientY ? workflowStateFromPoint(e.clientX, e.clientY) : '';
        if (stateId) setDragOverState(stateId);
      }}
      onDragEnd={clearActiveDragItem}
      onPointerDown={(e) => beginCardPointerDrag(e, item)}
      onClick={(e) => {
        if (suppressCardClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onOpen(item.noteId);
      }}
      style={{
        height: 116,
        padding: '10px 11px',
        borderRadius: 6,
        background: T.bg,
        border: `1px solid ${T.lineSub}`,
        borderLeft: `3px solid ${state.color}`,
        cursor: dragItem?.id === item.id ? 'grabbing' : 'grab',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        overflow: 'hidden',
        opacity: dragItem?.id === item.id ? 0.5 : 1,
        boxShadow: dragItem?.id === item.id
          ? 'none'
          : `0 1px 2px color-mix(in oklab, ${T.ink} 5%, transparent)`,
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
      onMouseLeave={e => e.currentTarget.style.background = T.bg}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600,
          color: T.ink,
          minWidth: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.noteTitle || 'Untitled'}</div>
        <StatePill state={state} T={T} />
        <ArchiveButton item={item} archiveNote={archiveNote} T={T} />
      </div>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: 13.5,
        color: isClosedState(state) ? T.inkDim : T.ink,
        lineHeight: 1.42,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>{item.text || <span style={{ color: T.inkDim, fontStyle: 'italic' }}>No preview</span>}</div>
      <div style={{ flex: 1 }} />
      <div style={{
        display: 'flex', gap: 5, alignItems: 'center',
        overflow: 'hidden', minHeight: 19,
      }}>
        {item.noteTags.slice(0, 3).map(t => (
          <span key={t} style={{
            maxWidth: 82,
            padding: '2px 6px',
            borderRadius: 999,
            background: `color-mix(in oklab, ${mnGetTagColor(tagHue[t] ?? 240, theme)} 13%, ${T.bgSub})`,
            border: `1px solid ${T.lineSub}`,
            color: mnGetTagColor(tagHue[t] ?? 240, theme),
            fontFamily: 'var(--mn-mono)',
            fontSize: 10,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>#{t}</span>
        ))}
        {item.noteTags.length > 3 && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>+{item.noteTags.length - 3}</span>
        )}
        {!item.noteTags.length && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>no tags</span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, flexShrink: 0 }}>{item.kind}</span>
      </div>
    </div>
  );
}

function WorkflowDragPreview({ board }) {
  const { T, dragPreview, dragOverState, workflowStates } = board;
  if (!dragPreview?.item) return null;
  const targetState = (workflowStates || []).find(state => state.id === (dragOverState || dragPreview.stateId))
    || (workflowStates || []).find(state => state.id === dragPreview.item.workflow)
    || workflowStates?.[0]
    || { id: dragPreview.item.workflow || 'STATUS', color: T.accent, bg: T.accentSoft };
  return (
    <div style={{
      position: 'fixed',
      left: Math.max(12, Math.min(Math.max(12, window.innerWidth - 286), dragPreview.x + 14)),
      top: Math.max(12, Math.min(Math.max(12, window.innerHeight - 128), dragPreview.y + 14)),
      width: 272,
      zIndex: 160,
      pointerEvents: 'none',
      borderRadius: 8,
      border: `1px solid ${T.line}`,
      borderLeft: `4px solid ${targetState.color}`,
      background: T.bg,
      color: T.ink,
      boxShadow: `0 18px 48px color-mix(in oklab, ${T.ink} 22%, transparent)`,
      padding: '10px 11px',
      fontFamily: 'var(--mn-ui)',
      transform: 'rotate(1deg)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13.5,
          fontWeight: 700,
        }}>{dragPreview.item.noteTitle || 'Untitled'}</div>
        <StatePill state={targetState} T={T} />
      </div>
      <div style={{
        marginTop: 7,
        fontFamily: 'var(--mn-body)',
        fontSize: 12.5,
        lineHeight: 1.35,
        color: T.inkMed,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>{dragPreview.item.text || 'No preview'}</div>
    </div>
  );
}

function DropColumn({ state, children, empty, board }) {
  const {
    T, mode, dragItem, dragItemRef, dragOverState, countFor,
    hasWorkflowDropData, readDropNoteId, updateDragPreview,
    setDragOverState, moveItem, moveWorkflowNote, clearActiveDragItem,
  } = board;
  return (
    <div
      data-mn-workflow-state={state.id}
      onDragOver={(e) => {
        if (!hasWorkflowDropData(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const activeItem = dragItemRef.current || dragItem;
        if (activeItem) updateDragPreview(activeItem, state, e);
        setDragOverState(state.id);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOverState(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const noteId = readDropNoteId(e);
        const activeItem = dragItemRef.current || dragItem;
        if (activeItem) moveItem(activeItem, state.id);
        else moveWorkflowNote(noteId, null, state.id);
        clearActiveDragItem();
      }}
      style={{
        background: dragOverState === state.id ? T.bgHover : T.bgSub,
        border: `1px solid ${dragOverState === state.id ? T.accent : T.lineSub}`,
        borderRadius: DS_RADIUS.row,
        padding: 9,
        minHeight: mode === 'kanban' ? 'min(470px, calc(100vh - 230px))' : 0,
        transition: 'background 100ms',
        minWidth: 0,
      }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        margin: '0 1px 9px',
        position: 'sticky',
        top: 0,
        zIndex: 1,
        background: dragOverState === state.id ? T.bgHover : T.bgSub,
        paddingBottom: 1,
      }}>
        <StatePill state={state} T={T} />
        <span style={{
          fontFamily: 'var(--mn-mono)',
          fontSize: 10.5,
          color: T.inkDim,
          background: T.bg,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 999,
          padding: '1px 6px',
        }}>{countFor(state.id)}</span>
      </div>
      {dragOverState === state.id && (
        <div style={{
          margin: '-2px 0 8px',
          height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px dashed ${state.color}`,
          borderRadius: 9,
          background: `color-mix(in oklab, ${state.bg} 55%, ${T.bg})`,
          color: state.color,
          fontFamily: 'var(--mn-ui)',
          fontSize: 12,
          fontWeight: 650,
        }}>{/* The column header right above already names the state. */}
          Release to move here
        </div>
      )}
      {children}
      {empty && (
        <div style={{
          padding: '18px 10px', textAlign: 'center',
          fontFamily: 'var(--mn-body)', fontSize: 12.5,
          color: T.inkDim, fontStyle: 'italic',
          border: `1px dashed ${T.lineSub}`,
          borderRadius: 6,
          background: `color-mix(in oklab, ${T.bg} 70%, transparent)`,
        }}>Drop here</div>
      )}
    </div>
  );
}

export { ModeButton, SummaryStat, StatePill, ArchiveButton, Card, WorkflowDragPreview, DropColumn };
