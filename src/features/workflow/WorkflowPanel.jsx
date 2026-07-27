import { mnNormalizeWorkflowId, mnNormalizeWorkflowStates, mnWorkflowIsClosed } from '../../editor/blockFeatures.jsx';
import { SectionHead } from '../../panels/panelShared.jsx';
import { DS_RADIUS, dsGroupLabelStyle, mnSentenceCase } from '../../shared/designSystem.js';
import { mnGetTagBg, mnGetTagColor } from '../../shared/theme.jsx';

const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;
import { WorkflowStateManager, ArchivedWorkflowNotes } from './WorkflowSupportPanels.jsx';

import { mnPanelButton, mnPanelMiniButton, mnPanelInputStyle, mnPanelTextareaStyle, mnPanelMenuItem } from '../../shared/panels/panelStyles.js';

function MnWorkflowPanel({
  workflowStates, workflowItems, archivedNotes = [], tags,
  onOpen, onWorkflowStatesChange, onSetWorkflow, onSetWorkflowArchived, onSetNoteTags, T, theme
}) {
  const [mode, setMode] = useStateP('kanban');
  const [dragItem, setDragItem] = useStateP(null);
  const [dragOverState, setDragOverState] = useStateP(null);
  const [extraColumns, setExtraColumns] = useStateP([]);
  const [columnMenuOpen, setColumnMenuOpen] = useStateP(false);
  const [dragPreview, setDragPreview] = useStateP(null);
  const [showArchived, setShowArchived] = useStateP(false);
  const [stateDraft, setStateDraft] = useStateP('');
  const dragItemRef = useRefP(null);
  const suppressCardClickRef = useRefP(false);
  const cardDragCleanupRef = useRefP(null);
  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);
  const countFor = (id) => (workflowItems?.[id] || []).length;
  const total = (workflowStates || []).reduce((sum, state) => {
    return sum + countFor(state.id);
  }, 0);
  const populatedStateCount = (workflowStates || []).filter(state => countFor(state.id) > 0).length;
  const stateCount = Math.max(1, (workflowStates || []).length);
  const kanbanMinWidth = Math.max(760, stateCount * 172);
  const normalizeStateId = mnNormalizeWorkflowId;
  const normalizeStates = states => Array.isArray(states) && states.length === 0 ? [] : mnNormalizeWorkflowStates(states);
  const isClosedState = mnWorkflowIsClosed;
  const stateColor = (index) => {
    const hues = [30, 250, 145, 290, 15, 60, 205, 330, 115, 275, 180, 5];
    return hues[index % hues.length];
  };

  const dragTypes = (event) => Array.from(event?.dataTransfer?.types || []);
  const hasWorkflowDropData = (event) => {
    const types = dragTypes(event);
    return !!dragItemRef.current || !!dragItem || types.includes('text/mn-workflow') || types.includes('text/mn-note') || types.includes('text/plain');
  };
  const readDropNoteId = (event) => {
    if (dragItemRef.current?.noteId) return dragItemRef.current.noteId;
    if (dragItem?.noteId) return dragItem.noteId;
    for (const type of ['text/mn-workflow', 'text/mn-note']) {
      const raw = event.dataTransfer.getData(type);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.noteId) return parsed.noteId;
      } catch {}
    }
    const plain = event.dataTransfer.getData('text/plain') || '';
    const match = plain.match(/^mn-note:(.+)$/);
    return match ? match[1] : '';
  };
  const moveWorkflowNote = (noteId, itemId, stateId, currentWorkflow = null) => {
    if (!noteId || currentWorkflow === stateId) return;
    onSetWorkflow && onSetWorkflow(noteId, itemId || null, stateId);
  };
  const moveItem = (item, stateId) => {
    if (!item) return;
    moveWorkflowNote(item.noteId, item.id, stateId, item.workflow);
  };
  const setActiveDragItem = (item) => {
    dragItemRef.current = item || null;
    setDragItem(item || null);
  };
  const clearActiveDragItem = () => {
    dragItemRef.current = null;
    setDragItem(null);
    setDragOverState(null);
    setDragPreview(null);
  };
  useEffectP(() => {
    return () => {
      cardDragCleanupRef.current?.();
      cardDragCleanupRef.current = null;
    };
  }, []);
  const updateDragPreview = (item, state, event) => {
    if (!item || !event?.clientX || !event?.clientY) return;
    setDragPreview({
      item,
      stateId: state?.id || item.workflow,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const setTransparentDragImage = (event) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      event.dataTransfer.setDragImage(canvas, 0, 0);
    } catch {}
  };
  const workflowStateFromPoint = (clientX, clientY) => {
    const target = document.elementFromPoint(clientX, clientY);
    return target?.closest?.('[data-mn-workflow-state]')?.getAttribute('data-mn-workflow-state') || '';
  };
  const beginCardPointerDrag = (event, item) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.('button, select, input, textarea, a')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const onMove = (moveEvent) => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!active && distance < 5) return;
      active = true;
      suppressCardClickRef.current = true;
      setActiveDragItem(item);
      const stateId = workflowStateFromPoint(moveEvent.clientX, moveEvent.clientY);
      setDragOverState(stateId);
      updateDragPreview(item, stateId ? (workflowStates || []).find(state => state.id === stateId) : null, moveEvent);
      moveEvent.preventDefault();
    };
    const onUp = (upEvent) => {
      cleanup();
      const stateId = active ? workflowStateFromPoint(upEvent.clientX, upEvent.clientY) : '';
      if (stateId) moveItem(item, stateId);
      clearActiveDragItem();
      if (active) window.setTimeout(() => { suppressCardClickRef.current = false; }, 0);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (cardDragCleanupRef.current === cleanup) cardDragCleanupRef.current = null;
    };
    cardDragCleanupRef.current?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cardDragCleanupRef.current = cleanup;
  };

  const archiveNote = (noteId, archived) => {
    onSetWorkflowArchived && onSetWorkflowArchived(noteId, archived);
  };

  const addWorkflowState = () => {
    const id = normalizeStateId(stateDraft);
    if (!id || (workflowStates || []).some(state => state.id === id)) return;
    const hue = stateColor((workflowStates || []).length);
    const next = normalizeStates([
      ...(workflowStates || []),
      {
        id,
        color: `oklch(0.55 0.16 ${hue})`,
        bg: `oklch(0.95 0.04 ${hue})`,
      },
    ]);
    onWorkflowStatesChange && onWorkflowStatesChange(next);
    setStateDraft('');
  };

  const removeWorkflowState = (stateId) => {
    onWorkflowStatesChange && onWorkflowStatesChange(
      normalizeStates((workflowStates || []).filter(state => state.id !== stateId))
    );
  };

  const ModeButton = ({ id, label }) => (
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

  const SummaryStat = ({ label, value, accent }) => (
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

  // A state is a dot and a word, not an uppercase mono badge — the colour
  // carries the identity, so the label can just be read.
  const StatePill = ({ state }) => (
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

  const ArchiveButton = ({ item, compact = false }) => (
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

  const TagEditorCell = ({ item }) => {
    const current = item.noteTags || [];
    const available = tags.filter(t => !current.includes(t.name));
    const setTagsForNote = (nextTags) => onSetNoteTags && onSetNoteTags(item.noteId, nextTags);
    return (
      <div style={{
        display: 'flex', gap: 5, alignItems: 'center',
        flexWrap: 'wrap', minWidth: 0, maxHeight: 50,
        overflow: 'hidden',
      }}>
        {current.slice(0, 3).map(t => (
          <button
            key={t}
            type="button"
            title="Remove tag"
            onClick={(e) => {
              e.stopPropagation();
              setTagsForNote(current.filter(x => x !== t));
            }}
            style={{
              maxWidth: 92,
              padding: '2px 6px',
              borderRadius: 999,
              border: `1px solid ${T.lineSub}`,
              background: mnGetTagBg(tagHue[t] ?? 240, theme),
              color: mnGetTagColor(tagHue[t] ?? 240, theme),
              fontFamily: 'var(--mn-mono)',
              fontSize: 10,
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>#{t}</button>
        ))}
        {current.length > 3 && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>+{current.length - 3}</span>
        )}
        <select
          value=""
          title="Add tag"
          disabled={!available.length}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (!e.target.value) return;
            setTagsForNote([...current, e.target.value]);
            e.target.value = '';
          }}
          style={{
            maxWidth: 92,
            border: `1px dashed ${T.line}`,
            borderRadius: 999,
            background: T.bg,
            color: T.inkDim,
            fontFamily: 'var(--mn-mono)',
            fontSize: 10,
            padding: '2px 5px',
            cursor: available.length ? 'pointer' : 'default',
          }}>
          <option value="">+ tag</option>
          {available.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
      </div>
    );
  };

  const Card = ({ item, state }) => (
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
        <StatePill state={state} />
        <ArchiveButton item={item} />
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

  const WorkflowDragPreview = () => {
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
          <StatePill state={targetState} />
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
  };

  const DropColumn = ({ state, children, empty }) => (
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
        <StatePill state={state} />
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

  const allItems = (workflowStates || []).flatMap(state => {
    return (workflowItems?.[state.id] || []).map(item => ({ ...item, state }));
  });

  // Columns are the union of property keys present on the notes in view —
  // discovered, never declared, so a note that gains a `pov::` line starts
  // offering pov as a column with no schema to update.
  const RESERVED_KEYS = new Set(['status']);
  const availableColumns = useMemoP(() => {
    const seen = new Map();
    allItems.forEach(item => {
      Object.keys(item.properties || {}).forEach(key => {
        if (RESERVED_KEYS.has(key.toLowerCase())) return;
        seen.set(key, (seen.get(key) || 0) + 1);
      });
    });
    // Most-used first: the key on the most notes is the one worth showing.
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
  }, [allItems]);
  const shownColumns = extraColumns.filter(key => availableColumns.includes(key));
  const tableGrid = [
    '108px', 'minmax(220px, 1.5fr)', 'minmax(150px, 0.8fr)', 'minmax(180px, 1fr)',
    ...shownColumns.map(() => 'minmax(120px, 0.8fr)'),
    '176px',
  ].join(' ');
  const tableMinWidth = 880 + shownColumns.length * 140;

  return (
    <div style={{
      flex: 1, height: '100%', background: T.bg,
      padding: '30px clamp(14px, 2vw, 28px) 24px',
      overflow: 'auto',
      minWidth: 0,
    }}>
      <div style={{ width: '100%', maxWidth: 1480, margin: '0 auto', minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 180 }}>
            <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>Workflow</span>
            <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkDim }}>
              {total} note{total === 1 ? '' : 's'} · {populatedStateCount} of {stateCount} states
            </span>
            {/* Where the work actually sits, at a glance — one segment per
                state, sized by share. Only drawn when there is work to share. */}
            {total > 0 && (
              <span
                aria-hidden="true"
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  height: 8, width: 200, borderRadius: 4, overflow: 'hidden',
                }}>
                {(workflowStates || []).filter(state => countFor(state.id) > 0).map(state => (
                  <span
                    key={state.id}
                    title={`${state.id}: ${countFor(state.id)}`}
                    style={{
                      flex: countFor(state.id), height: '100%', borderRadius: 4,
                      background: state.color || T.accent,
                    }}
                  />
                ))}
              </span>
            )}
          </div>
          <div style={{
            display: 'flex',
            gap: 2,
            padding: 3,
            marginRight: 54,
            border: `1px solid ${T.lineSub}`,
            borderRadius: 7,
            background: T.bgSub,
            flexShrink: 0,
          }}>
            <ModeButton id="kanban" label="Kanban" />
            <ModeButton id="table" label="Table" />
            <ModeButton id="list" label="List" />
            {mode === 'table' && availableColumns.length > 0 && (
              <div style={{ position: 'relative', marginLeft: 4 }}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={columnMenuOpen}
                  onClick={() => setColumnMenuOpen(open => !open)}
                  style={{
                    height: 28, padding: '0 10px', borderRadius: DS_RADIUS.control,
                    border: `1px dashed ${T.line}`, background: 'transparent', color: T.inkMed,
                    fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M6 2.5v7M2.5 6h7" strokeLinecap="round" />
                  </svg>
                  Column{shownColumns.length ? ` · ${shownColumns.length}` : ''}
                </button>
                {columnMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Table columns"
                    style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
                      minWidth: 200, maxHeight: 260, overflowY: 'auto', padding: 6,
                      background: T.bgElevated || T.bg, border: `1px solid ${T.line}`,
                      borderRadius: DS_RADIUS.panel,
                      boxShadow: `0 16px 40px color-mix(in oklab, ${T.ink} 18%, transparent)`,
                    }}>
                    <div style={{ ...dsGroupLabelStyle(T), padding: '4px 8px 6px' }}>
                      Properties on these notes
                    </div>
                    {availableColumns.map(key => {
                      const on = shownColumns.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={on}
                          onClick={() => setExtraColumns(current => (
                            current.includes(key) ? current.filter(k => k !== key) : [...current, key]
                          ))}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                            padding: '7px 8px', borderRadius: DS_RADIUS.control,
                            border: 'none', background: on ? T.selBg : 'transparent',
                            color: T.ink, cursor: 'pointer', textAlign: 'left',
                            fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                          }}>
                          <span style={{
                            width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                            border: `1.5px solid ${on ? T.accent : T.line}`,
                            background: on ? T.accent : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {on && (
                              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke={T.bg} strokeWidth="2" aria-hidden="true">
                                <path d="M2.5 6.5L5 9L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>{key}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setShowArchived(v => !v)} style={{
              padding: '5px 10px',
              borderRadius: 5,
              border: 'none',
              background: showArchived ? T.bg : 'transparent',
              color: showArchived ? T.ink : T.inkMed,
              fontFamily: 'var(--mn-ui)',
              fontSize: 12,
              fontWeight: showArchived ? 600 : 500,
              cursor: 'pointer',
              boxShadow: showArchived ? `0 1px 3px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
            }}>Archived · {archivedNotes.length}</button>
          </div>
        </div>
        {showArchived ? <ArchivedWorkflowNotes archivedNotes={archivedNotes} onOpen={onOpen} archiveNote={archiveNote} T={T} /> : (
          <>
            <WorkflowStateManager
              workflowStates={workflowStates}
              removeWorkflowState={removeWorkflowState}
              stateDraft={stateDraft}
              setStateDraft={setStateDraft}
              addWorkflowState={addWorkflowState}
              normalizeStateId={normalizeStateId}
              T={T}
            />
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
              gap: 8,
              marginBottom: 16,
            }}>
              <SummaryStat label="Items" value={total} accent={T.accent} />
              <SummaryStat label="Columns" value={(workflowStates || []).length} accent={T.warn} />
              <SummaryStat label="Active cols" value={populatedStateCount} accent={T.inkMed} />
              <SummaryStat label="Archived" value={archivedNotes.length} accent={T.success} />
            </div>

            {mode === 'kanban' && (
              <div style={{
                overflowX: 'auto',
                overflowY: 'visible',
                paddingBottom: 10,
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${stateCount}, minmax(172px, 1fr))`,
                  gap: 10,
                  minWidth: kanbanMinWidth,
                }}>
                  {(workflowStates || []).map(state => {
                    const items = workflowItems?.[state.id] || [];
                    return (
                      <DropColumn key={state.id} state={state} empty={!items.length}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {items.map(item => <Card key={item.id} item={item} state={state} />)}
                        </div>
                      </DropColumn>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === 'table' && (
              <div style={{
                border: `1px solid ${T.lineSub}`,
                borderRadius: 8,
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 205px)',
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: tableGrid,
                  gap: 0,
                  padding: '8px 12px',
                  background: T.bgSub,
                  borderBottom: `1px solid ${T.lineSub}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  fontFamily: 'var(--mn-ui)', fontWeight: 600,
                  fontSize: 11,
                  color: T.inkDim,
                  minWidth: tableMinWidth,
                  boxSizing: 'border-box',
                }}>
                  <span>Status</span><span>Note</span><span>Title</span><span>Tags</span>
                  {shownColumns.map(key => <span key={key}>{key}</span>)}
                  <span>Change</span>
                </div>
                {allItems.map(({ state, ...item }) => (
                  <div key={item.id} style={{
                    display: 'grid',
                    gridTemplateColumns: tableGrid,
                    gap: 0,
                    padding: '10px 12px',
                    borderBottom: `1px solid ${T.lineSub}`,
                    alignItems: 'start',
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 13,
                    minWidth: tableMinWidth,
                    boxSizing: 'border-box',
                    background: T.bg,
                  }}>
                    <div style={{ minWidth: 0, paddingTop: 3, overflow: 'hidden' }}>
                      <StatePill state={state} />
                    </div>
                    <span onClick={() => onOpen(item.noteId)} style={{
                      color: T.ink, cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'normal',
                      lineHeight: 1.35,
                      paddingTop: 3,
                      minWidth: 0,
                    }}>{item.text || 'No preview'}</span>
                    <span onClick={() => onOpen(item.noteId)} style={{
                      color: T.inkMed,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      paddingTop: 3,
                      minWidth: 0,
                    }}>{item.noteTitle}</span>
                    <TagEditorCell item={item} />
                    {/* Discovered property cells. Read-only for now: writing a
                        cell is a markdown edit and wants its own single writer. */}
                    {shownColumns.map(key => (
                      <div key={key} style={{
                        minWidth: 0, paddingTop: 3, paddingRight: 10,
                        fontFamily: 'var(--mn-ui)', fontSize: 12,
                        color: item.properties?.[key] ? T.inkMed : T.inkDim,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{item.properties?.[key] || '—'}</div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                      <select value={state.id} onChange={(e) => moveItem(item, e.target.value)} style={{
                        border: `1px solid ${T.line}`,
                        borderRadius: 5,
                        background: T.bg,
                        color: T.ink,
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12,
                        padding: '4px 6px',
                        minWidth: 0,
                        flex: 1,
                        boxSizing: 'border-box',
                      }}>
                        {(workflowStates || []).map(s => <option key={s.id} value={s.id}>{mnSentenceCase(s.id)}</option>)}
                      </select>
                      <ArchiveButton item={item} compact />
                    </div>
                  </div>
                ))}
                {!allItems.length && (
                  <div style={{ padding: 22, textAlign: 'center', color: T.inkDim, fontFamily: 'var(--mn-body)', fontStyle: 'italic' }}>No workflow notes yet</div>
                )}
              </div>
            )}

            {mode === 'list' && (workflowStates || []).map(state => {
              const items = workflowItems?.[state.id] || [];
              return (
                <div key={state.id} style={{ marginBottom: 20 }}>
                  <SectionHead T={T} label={state.id} count={items.length} />
                  {items.length ? (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
                      gap: 8,
                    }}>
                      {items.map(item => <Card key={item.id} item={item} state={state} />)}
                    </div>
                  ) : (
                    <div style={{
                      padding: 14, textAlign: 'center',
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkDim, fontStyle: 'italic',
                      background: T.bgSub, border: `1px solid ${T.lineSub}`,
                      borderRadius: 6,
                    }}>No workflow notes</div>
                  )}
                </div>
              );
            })}
            <WorkflowDragPreview />
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Today view (note rollup)
// ────────────────────────────────────────────────────────────

export { MnWorkflowPanel };
