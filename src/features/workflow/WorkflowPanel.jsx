import { mnNormalizeWorkflowId, mnNormalizeWorkflowStates, mnWorkflowIsClosed } from '../../editor/blockFeatures.jsx';
import { SectionHead } from '../../panels/panelShared.jsx';
import { DS_RADIUS, dsGroupLabelStyle, mnSentenceCase } from '../../shared/designSystem.js';
import { mnTagHueMap } from '../../shared/theme.jsx';

const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;
import { WorkflowStateManager, ArchivedWorkflowNotes } from './WorkflowSupportPanels.jsx';
import { WorkflowTable } from './WorkflowTable.jsx';
import { ModeButton, SummaryStat, StatePill, ArchiveButton, Card, WorkflowDragPreview, DropColumn } from './WorkflowBoardParts.jsx';

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
  const tagHue = useMemoP(() => mnTagHueMap(tags), [tags]);
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

  // One bag for the drag plumbing the board parts need. Their component
  // types live at module scope now, so a re-render updates cards in place
  // instead of rebuilding them — which used to happen on every pointer move
  // of a drag, tearing down the exact card the user was holding.
  const board = {
    T, theme, tagHue, mode, dragItem, dragItemRef, dragOverState, dragPreview,
    workflowStates, countFor, isClosedState, onOpen, archiveNote,
    setActiveDragItem, clearActiveDragItem, updateDragPreview,
    setTransparentDragImage, workflowStateFromPoint, setDragOverState,
    beginCardPointerDrag, suppressCardClickRef,
    hasWorkflowDropData, readDropNoteId, moveItem, moveWorkflowNote,
  };

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
            <ModeButton id="kanban" label="Kanban" mode={mode} setMode={setMode} T={T} />
            <ModeButton id="table" label="Table" mode={mode} setMode={setMode} T={T} />
            <ModeButton id="list" label="List" mode={mode} setMode={setMode} T={T} />
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
              <SummaryStat label="Items" value={total} accent={T.accent} T={T} />
              <SummaryStat label="Columns" value={(workflowStates || []).length} accent={T.warn} T={T} />
              <SummaryStat label="Active cols" value={populatedStateCount} accent={T.inkMed} T={T} />
              <SummaryStat label="Archived" value={archivedNotes.length} accent={T.success} T={T} />
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
                      <DropColumn key={state.id} state={state} empty={!items.length} board={board}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {items.map(item => <Card key={item.id} item={item} state={state} board={board} />)}
                        </div>
                      </DropColumn>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === 'table' && (
              <WorkflowTable
                allItems={allItems}
                workflowStates={workflowStates}
                shownColumns={shownColumns}
                tableGrid={tableGrid}
                tableMinWidth={tableMinWidth}
                StatePill={StatePill}
                ArchiveButton={ArchiveButton}
                archiveNote={archiveNote}
                onOpen={onOpen}
                moveItem={moveItem}
                tags={tags}
                onSetNoteTags={onSetNoteTags}
                tagHue={tagHue}
                theme={theme}
                T={T}
              />
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
                      {items.map(item => <Card key={item.id} item={item} state={state} board={board} />)}
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
            <WorkflowDragPreview board={board} />
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
