// Overlay panels: Todos aggregator, Today view, Quick-capture, Reminder toast, Tweaks

const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP } = React;

// ────────────────────────────────────────────────────────────
// Aggregated Todos
// ────────────────────────────────────────────────────────────
function MnTodosPanel({ notes, tags, onOpen, onToggleCheck, T, theme, variant }) {
  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);

  // Gather all todos and reminders
  const items = useMemoP(() => {
    const acc = [];
    notes.forEach(n => {
      const lines = n.body.split('\n');
      let listBlockIdx = -1, itemIdxInBlock = -1;
      let curBlock = -1, curItem = -1;
      lines.forEach((line, lineNum) => {
        const m = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
        if (m) {
          const checked = /[xX]/.test(m[2]);
          const remMatch = m[3].match(/@remind\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
          acc.push({
            noteId: n.id, noteTitle: n.title, noteTags: n.tags,
            text: m[3], checked, line: lineNum,
            remindAt: remMatch ? { date: remMatch[1], time: remMatch[2] || '' } : null,
            noteDate: n.date,
          });
        }
      });
      // Also capture bare @remind directives not inside checkboxes
      lines.forEach((line, lineNum) => {
        if (/^\s*-\s+\[/.test(line)) return;
        const rm = line.match(/@remind\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s+(.*)$/);
        if (rm) {
          acc.push({
            noteId: n.id, noteTitle: n.title, noteTags: n.tags,
            text: rm[3], checked: false, line: lineNum, isReminder: true,
            remindAt: { date: rm[1], time: rm[2] || '' }, noteDate: n.date,
          });
        }
      });
    });
    return acc;
  }, [notes]);

  const open = items.filter(i => !i.checked);
  const done = items.filter(i => i.checked);
  const withRem = open.filter(i => i.remindAt);

  const Card = ({ it, idx }) => {
    const isOverdue = it.remindAt && new Date(it.remindAt.date) < new Date();
    return (
      <div key={idx}
        onClick={() => onOpen(it.noteId)}
        style={{
          padding: variant === 'compact' ? '8px 12px' : '12px 14px',
          background: T.bg, border: `1px solid ${T.lineSub}`,
          borderLeft: it.remindAt
            ? `3px solid ${isOverdue ? T.danger : T.warn}`
            : `3px solid ${T.lineSub}`,
          borderRadius: 6, cursor: 'pointer',
          display: 'flex', alignItems: 'flex-start', gap: 10,
          transition: 'background 80ms',
        }}
        onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
        onMouseLeave={e => e.currentTarget.style.background = T.bg}>
        <button onClick={(e) => { e.stopPropagation(); onToggleCheck(it); }} style={{
          width: 15, height: 15, marginTop: 2, flexShrink: 0,
          border: `1.5px solid ${it.checked ? T.accent : T.line}`,
          background: it.checked ? T.accent : 'transparent',
          borderRadius: 4, cursor: 'pointer', padding: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--mn-body)', fontSize: 14.5,
            color: it.checked ? T.inkDim : T.ink,
            textDecoration: it.checked ? 'line-through' : 'none',
            lineHeight: 1.5,
          }}>
            {it.text.replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/, '').trim() || <span style={{ color: T.inkDim, fontStyle: 'italic' }}>Reminder</span>}
          </div>
          <div style={{
            marginTop: 6, display: 'flex', gap: 8, alignItems: 'center',
            fontFamily: 'var(--mn-mono)', fontSize: 10.5,
            color: T.inkDim, flexWrap: 'wrap',
          }}>
            <span style={{ color: T.inkMed }}>{it.noteTitle}</span>
            {it.noteTags.slice(0, 2).map(t => (
              <span key={t} style={{
                color: mnGetTagColor(tagHue[t] ?? 240, theme),
              }}>#{t}</span>
            ))}
            {it.remindAt && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                color: isOverdue ? T.danger : T.warn, fontWeight: 500,
              }}>
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="8" cy="9" r="5.5"/>
                  <path d="M8 6V9L10 10" strokeLinecap="round"/>
                </svg>
                {it.remindAt.date}{it.remindAt.time ? ' ' + it.remindAt.time : ''}
                {isOverdue && ' · overdue'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (variant === 'kanban') {
    const buckets = [
      { k: 'due', label: 'Due / Reminders', items: withRem },
      { k: 'open', label: 'Open', items: open.filter(i => !i.remindAt) },
      { k: 'done', label: 'Done', items: done },
    ];
    return (
      <div style={{
        flex: 1, height: '100%', background: T.bg,
        padding: '40px 28px 28px', overflow: 'auto',
      }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 22, fontWeight: 600,
          color: T.ink, marginBottom: 3, letterSpacing: '-0.015em',
        }}>Todos</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 20,
        }}>{open.length} open · {done.length} done · {withRem.length} with reminders</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {buckets.map(b => (
            <div key={b.k} style={{
              background: T.bgSub, borderRadius: 8, padding: 10,
              border: `1px solid ${T.lineSub}`, minHeight: 400,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, margin: '2px 4px 10px',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{b.label}</span>
                <span>{b.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {b.items.map((it, i) => <Card key={i} it={it} idx={i} />)}
                {b.items.length === 0 && (
                  <div style={{
                    padding: 14, textAlign: 'center',
                    fontFamily: 'var(--mn-body)', fontSize: 12.5,
                    color: T.inkDim, fontStyle: 'italic',
                  }}>nothing here</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default: grouped list
  return (
    <div style={{
      flex: 1, height: '100%', background: T.bg,
      padding: '40px 28px 28px', overflow: 'auto',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 26, fontWeight: 600,
          color: T.ink, marginBottom: 3, letterSpacing: '-0.02em',
        }}>Todos</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 24,
        }}>{open.length} open · {done.length} done · {withRem.length} with reminders</div>

        {withRem.length > 0 && (
          <>
            <SectionHead T={T} label="Reminders" count={withRem.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
              {withRem.map((it, i) => <Card key={i} it={it} idx={i} />)}
            </div>
          </>
        )}

        <SectionHead T={T} label="Open" count={open.filter(i => !i.remindAt).length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
          {open.filter(i => !i.remindAt).map((it, i) => <Card key={i} it={it} idx={'o' + i} />)}
        </div>

        {done.length > 0 && (
          <>
            <SectionHead T={T} label="Done" count={done.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {done.map((it, i) => <Card key={i} it={it} idx={'d' + i} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHead({ label, count, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      fontFamily: 'var(--mn-mono)', fontSize: 10,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: T.inkDim,
    }}>
      <span>{label}</span>
      <span>{count}</span>
      <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Workflow aggregate panel
// ────────────────────────────────────────────────────────────
function MnWorkflowPanel({ workflowStates, workflowItems, tags, onOpen, onSetWorkflow, onSetNoteTags, T, theme }) {
  const [mode, setMode] = useStateP('kanban');
  const [dragItem, setDragItem] = useStateP(null);
  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);
  const countFor = (id) => (workflowItems?.[id] || []).length;
  const total = (workflowStates || []).reduce((sum, state) => {
    return sum + countFor(state.id);
  }, 0);
  const activeCount = countFor('NOW') + countFor('DOING');
  const waitingCount = countFor('WAIT') + countFor('LATER');
  const closedCount = countFor('DONE') + countFor('CANCELLED');
  const openCount = Math.max(0, total - closedCount);
  const stateCount = Math.max(1, (workflowStates || []).length);
  const kanbanMinWidth = Math.max(760, stateCount * 172);

  const moveItem = (item, stateId) => {
    if (!item || item.workflow === stateId) return;
    onSetWorkflow && onSetWorkflow(item.noteId, item.id, stateId);
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
        fontFamily: 'var(--mn-mono)',
        fontSize: 10,
        color: T.inkDim,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
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

  const StatePill = ({ state }) => (
    <span style={{
      fontFamily: 'var(--mn-mono)', fontSize: 9.5,
      fontWeight: 700, letterSpacing: '0.06em',
      color: state.color, background: state.bg,
      padding: '2px 6px', borderRadius: 3,
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>{state.id}</span>
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
        setDragItem(item);
        e.dataTransfer.setData('text/mn-workflow', JSON.stringify({ noteId: item.noteId, blockId: item.id }));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setDragItem(null)}
      onClick={() => onOpen(item.noteId)}
      style={{
        height: 116,
        padding: '10px 11px',
        borderRadius: 6,
        background: T.bg,
        border: `1px solid ${T.lineSub}`,
        borderLeft: `3px solid ${state.color}`,
        cursor: 'pointer',
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
      </div>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: 13.5,
        color: state.id === 'DONE' || state.id === 'CANCELLED' ? T.inkDim : T.ink,
        textDecoration: state.id === 'DONE' || state.id === 'CANCELLED' ? 'line-through' : 'none',
        lineHeight: 1.42,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>{item.text || <span style={{ color: T.inkDim, fontStyle: 'italic' }}>Empty block</span>}</div>
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

  const DropColumn = ({ state, children, empty }) => (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/mn-workflow')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        moveItem(dragItem, state.id);
        setDragItem(null);
      }}
      style={{
        background: dragItem && dragItem.workflow !== state.id ? T.bgHover : T.bgSub,
        border: `1px solid ${T.lineSub}`,
        borderRadius: 8,
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
        background: dragItem && dragItem.workflow !== state.id ? T.bgHover : T.bgSub,
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
          <div style={{ minWidth: 180 }}>
            <div style={{
              fontFamily: 'var(--mn-ui)', fontSize: 25, fontWeight: 650,
              color: T.ink, marginBottom: 4, letterSpacing: '-0.01em',
            }}>Workflow</div>
            <div style={{
              fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
              letterSpacing: '0.06em',
            }}>{total} workflow block{total === 1 ? '' : 's'} across this vault</div>
          </div>
          <div style={{
            display: 'flex',
            gap: 2,
            padding: 3,
            border: `1px solid ${T.lineSub}`,
            borderRadius: 7,
            background: T.bgSub,
            flexShrink: 0,
          }}>
            <ModeButton id="kanban" label="Kanban" />
            <ModeButton id="table" label="Table" />
            <ModeButton id="list" label="List" />
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}>
          <SummaryStat label="Open" value={openCount} accent={T.accent} />
          <SummaryStat label="Active" value={activeCount} accent={T.warn} />
          <SummaryStat label="Waiting" value={waitingCount} accent={T.inkMed} />
          <SummaryStat label="Closed" value={closedCount} accent={T.success} />
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
              gridTemplateColumns: '108px minmax(220px, 1.5fr) minmax(150px, 0.8fr) minmax(180px, 1fr) 126px',
              gap: 0,
              padding: '8px 12px',
              background: T.bgSub,
              borderBottom: `1px solid ${T.lineSub}`,
              position: 'sticky',
              top: 0,
              zIndex: 1,
              fontFamily: 'var(--mn-mono)',
              fontSize: 10,
              color: T.inkDim,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              minWidth: 880,
              boxSizing: 'border-box',
            }}>
              <span>Status</span><span>Block</span><span>Note</span><span>Tags</span><span>Change</span>
            </div>
            {allItems.map(({ state, ...item }) => (
              <div key={item.id} style={{
                display: 'grid',
                gridTemplateColumns: '108px minmax(220px, 1.5fr) minmax(150px, 0.8fr) minmax(180px, 1fr) 126px',
                gap: 0,
                padding: '10px 12px',
                borderBottom: `1px solid ${T.lineSub}`,
                alignItems: 'start',
                fontFamily: 'var(--mn-ui)',
                fontSize: 13,
                minWidth: 880,
                boxSizing: 'border-box',
                background: T.bg,
              }}>
                <div style={{ minWidth: 0, paddingTop: 3, overflow: 'hidden' }}>
                  <StatePill state={state} />
                </div>
                <span onClick={() => onOpen(item.noteId)} style={{
                  color: T.ink, cursor: 'pointer',
                  textDecoration: state.id === 'DONE' || state.id === 'CANCELLED' ? 'line-through' : 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'normal',
                  lineHeight: 1.35,
                  paddingTop: 3,
                  minWidth: 0,
                }}>{item.text || 'Empty block'}</span>
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
                <select value={state.id} onChange={(e) => moveItem(item, e.target.value)} style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 5,
                  background: T.bg,
                  color: T.ink,
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12,
                  padding: '4px 6px',
                  width: '100%',
                  boxSizing: 'border-box',
                }}>
                  {(workflowStates || []).map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                </select>
              </div>
            ))}
            {!allItems.length && (
              <div style={{ padding: 22, textAlign: 'center', color: T.inkDim, fontFamily: 'var(--mn-body)', fontStyle: 'italic' }}>No workflow blocks yet</div>
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
                }}>No workflow blocks</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Today view (note rollup)
// ────────────────────────────────────────────────────────────
function MnTodayPanel({ notes, tags, onOpen, T, theme }) {
  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);
  // Group notes by day
  const groups = useMemoP(() => {
    const g = {};
    [...notes].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(n => {
      const d = new Date(n.date);
      const key = d.toDateString();
      if (!g[key]) g[key] = { date: d, notes: [] };
      g[key].notes.push(n);
    });
    return Object.values(g);
  }, [notes]);

  return (
    <div style={{
      flex: 1, height: '100%', background: T.bg,
      padding: '40px 28px 28px', overflow: 'auto',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 26, fontWeight: 600,
          color: T.ink, marginBottom: 3, letterSpacing: '-0.02em',
        }}>Daily rollup</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 28,
        }}>notes grouped by the day they were written</div>

        {groups.map((g, i) => (
          <div key={i} style={{ marginBottom: 28 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 12,
              marginBottom: 10,
            }}>
              <div style={{
                fontFamily: 'var(--mn-body)', fontSize: 16, fontWeight: 600,
                color: T.ink, letterSpacing: '-0.01em',
              }}>{g.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
              }}>{g.notes.length} note{g.notes.length > 1 ? 's' : ''}</div>
              <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {g.notes.map(n => (
                <div key={n.id} onClick={() => onOpen(n.id)} style={{
                  padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                  display: 'flex', alignItems: 'baseline', gap: 10,
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
                    width: 46, flexShrink: 0,
                  }}>{new Date(n.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 14, color: T.ink, flex: 1,
                  }}>{n.title}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {n.tags.map(t => (
                      <span key={t} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: mnGetTagColor(tagHue[t] ?? 240, theme),
                        display: 'inline-block',
                      }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Quick-capture popover (floating)
// ────────────────────────────────────────────────────────────
function MnQuickCapture({ onSave, onClose, tags, T, theme }) {
  const [title, setTitle] = useStateP('');
  const [body, setBody] = useStateP('');
  const [selected, setSelected] = useStateP([]);
  const titleRef = useRefE(null);

  useEffectP(() => {
    setTimeout(() => titleRef.current?.focus(), 60);
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const submit = () => {
    if (!title.trim() && !body.trim()) return onClose();
    onSave({ title: title.trim() || 'Untitled', body, tags: selected });
  };

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 40,
      background: `color-mix(in oklab, ${T.ink} 22%, transparent)`,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 100, animation: 'mnFadeIn 120ms ease',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 540, background: T.bg, borderRadius: 12,
        border: `1px solid ${T.line}`,
        boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 25%, transparent)`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 14px', borderBottom: `1px solid ${T.lineSub}`,
          fontFamily: 'var(--mn-mono)', fontSize: 10.5,
          color: T.inkDim, letterSpacing: '0.08em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2.5 6L8 2L13.5 6V13C13.5 13.5 13 14 12.5 14H3.5C3 14 2.5 13.5 2.5 13V6Z"/>
          </svg>
          Quick capture
          <div style={{ flex: 1 }} />
          <span style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10,
            padding: '2px 5px', borderRadius: 3,
            background: T.bgSub, border: `1px solid ${T.lineSub}`,
          }}>⌘⇧N</span>
        </div>
        <div style={{ padding: 16 }}>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            style={{
              width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'var(--mn-body)', fontSize: 20, fontWeight: 600,
              color: T.ink, letterSpacing: '-0.01em', marginBottom: 10,
            }}/>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note… use [[double brackets]] to link, - [ ] for todos, @remind 2026-04-30 to schedule"
            style={{
              width: '100%', minHeight: 120,
              fontFamily: 'var(--mn-body)', fontSize: 14.5, lineHeight: 1.6,
              color: T.ink, background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', padding: 0,
            }} />

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
            {tags.map(t => {
              const on = selected.includes(t.name);
              return (
                <button key={t.name}
                  onClick={() => setSelected(s => on ? s.filter(x => x !== t.name) : [...s, t.name])}
                  style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 10.5,
                    padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    color: on ? mnGetTagColor(t.hue, theme) : T.inkDim,
                    background: on ? mnGetTagBg(t.hue, theme) : 'transparent',
                    border: `1px solid ${on ? 'transparent' : T.line}`,
                  }}>#{t.name}</button>
              );
            })}
          </div>
        </div>
        <div style={{
          padding: '10px 14px', borderTop: `1px solid ${T.lineSub}`,
          background: T.bgSub, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
          }}>dated {new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            padding: '4px 12px', borderRadius: 5,
            border: `1px solid ${T.line}`, background: T.bg, color: T.inkMed,
            fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={submit} style={{
            padding: '4px 14px', borderRadius: 5, border: 'none',
            background: T.ink, color: T.bg,
            fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>Save note</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Reminder toast
// ────────────────────────────────────────────────────────────
function MnReminderToast({ toast, onDismiss, onOpen, T, variant }) {
  if (!toast) return null;

  if (variant === 'banner') {
    return (
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
        background: `color-mix(in oklab, ${T.warn} 14%, ${T.bg})`,
        borderBottom: `1px solid color-mix(in oklab, ${T.warn} 30%, transparent)`,
        fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink,
        animation: 'mnSlideDown 200ms ease',
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={T.warn} strokeWidth="1.5">
          <circle cx="8" cy="9" r="5.5"/><path d="M8 6V9L10 10" strokeLinecap="round"/>
          <path d="M3 3L4.5 4.5M13 3L11.5 4.5" strokeLinecap="round"/>
        </svg>
        <span style={{ fontWeight: 500 }}>Reminder:</span>
        <span style={{ color: T.inkMed }}>{toast.text}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => onOpen(toast.noteId)} style={{
          padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
          background: 'transparent', border: `1px solid ${T.line}`, color: T.inkMed,
          fontFamily: 'var(--mn-ui)', fontSize: 11.5,
        }}>Open note</button>
        <button onClick={onDismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: T.inkDim, padding: 4, fontSize: 14,
        }}>✕</button>
      </div>
    );
  }

  // Default: card toast bottom-right
  return (
    <div style={{
      position: 'absolute', bottom: 18, right: 18, zIndex: 50,
      width: 300, background: T.bg, borderRadius: 10,
      border: `1px solid ${T.line}`,
      boxShadow: `0 12px 40px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      padding: 14,
      animation: 'mnSlideUp 220ms cubic-bezier(.2,.8,.2,1)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--mn-mono)', fontSize: 9.5,
        color: T.warn, letterSpacing: '0.1em', textTransform: 'uppercase',
        marginBottom: 8, fontWeight: 600,
      }}>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="9" r="5.5"/><path d="M8 6V9L10 10" strokeLinecap="round"/>
        </svg>
        Reminder
        <div style={{ flex: 1 }} />
        <button onClick={onDismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: T.inkDim, padding: 0, fontSize: 14,
        }}>✕</button>
      </div>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: 14, color: T.ink,
        lineHeight: 1.5, marginBottom: 4,
      }}>{toast.text}</div>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
        marginBottom: 10,
      }}>from {toast.noteTitle}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onOpen(toast.noteId)} style={{
          flex: 1, padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.ink, color: T.bg, border: 'none',
          fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
        }}>Open note</button>
        <button onClick={onDismiss} style={{
          padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.bg, color: T.inkMed, border: `1px solid ${T.line}`,
          fontFamily: 'var(--mn-ui)', fontSize: 12,
        }}>Snooze</button>
      </div>
    </div>
  );
}

window.MnTodosPanel = MnTodosPanel;
window.MnWorkflowPanel = MnWorkflowPanel;
window.MnTodayPanel = MnTodayPanel;
window.MnQuickCapture = MnQuickCapture;
window.MnReminderToast = MnReminderToast;

// ────────────────────────────────────────────────────────────
// Panel grip: thin vertical divider between panels with an always-visible
// pill button at vertical center for collapse/expand. The pill is centered
// so the collapsed-state peek handle aligns at the same Y.
// ────────────────────────────────────────────────────────────

// Icon: a panel + an arrow pointing in the action direction.
const PanelIcon = ({ direction }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
       style={{ transform: direction === 'right' ? 'scaleX(-1)' : 'none' }}>
    <rect x="2" y="3" width="12" height="10" rx="1.5"/>
    <path d="M6 3V13"/>
    <path d="M11 6L9 8L11 10"/>
  </svg>
);

// Top offset so both grip buttons sit at the same Y as the editor toolbar
// buttons — collapsed peek and open grip naturally align across the row.
const GRIP_TOP = 14;

function MnPanelGrip({ side, onCollapse, T }) {
  const [hover, setHover] = useStateP(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 1, flexShrink: 0, position: 'relative',
        background: T.line, zIndex: 5,
      }}>
      <button
        onClick={onCollapse}
        title={`Hide ${side === 'sidebar' ? 'sidebar' : 'note list'}`}
        style={{
          position: 'absolute',
          left: -12, top: GRIP_TOP,
          width: 24, height: 24, padding: 0,
          borderRadius: 6,
          border: `1px solid ${T.line}`,
          background: hover ? T.bgHover : T.bg,
          color: hover ? T.ink : T.inkMed,
          cursor: 'pointer',
          transition: 'background 120ms, color 120ms',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: hover
            ? `0 2px 6px color-mix(in oklab, ${T.ink} 14%, transparent)`
            : `0 1px 2px color-mix(in oklab, ${T.ink} 6%, transparent)`,
        }}>
        <PanelIcon direction="left" />
      </button>
    </div>
  );
}

function MnPanelGripPeek({ onExpand, T, title }) {
  const [hover, setHover] = useStateP(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 1, flexShrink: 0, position: 'relative',
        background: T.line, zIndex: 5,
      }}>
      <button
        onClick={onExpand}
        title={title}
        style={{
          position: 'absolute',
          left: -12, top: GRIP_TOP,
          width: 24, height: 24, padding: 0,
          borderRadius: 6,
          border: `1px solid ${T.line}`,
          background: hover ? T.bgHover : T.bg,
          color: hover ? T.ink : T.inkMed,
          cursor: 'pointer',
          transition: 'background 120ms, color 120ms',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: hover
            ? `0 2px 6px color-mix(in oklab, ${T.ink} 14%, transparent)`
            : `0 1px 2px color-mix(in oklab, ${T.ink} 6%, transparent)`,
        }}>
        <PanelIcon direction="right" />
      </button>
    </div>
  );
}

window.MnPanelGrip = MnPanelGrip;
window.MnPanelGripPeek = MnPanelGripPeek;
