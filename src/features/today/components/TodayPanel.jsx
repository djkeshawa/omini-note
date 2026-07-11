const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;

function MnTodayPanel({
  notes = [], tags = [], tasks = [], reminders = [], todayNote = null, agendaItems = [],
  staleTasks = [], unlinkedNotes = [], resurfacedNotes = [],
  onOpen, onOpenOrCreateDailyNote, onAddQuickTask, onAddReflection, onEndDayRecap, onOpenAgenda, onPlanItem, T, theme, rollupFormat = 'long',
  rollupDefaultRange = 'today', rollupGroupBy = 'created', rollupShowPreviews = true,
  rollupShowTasks = true, rollupShowReminders = true, rollupCollapseOlder = true,
  todayAiRecap = null, todayAiRecapBusy = false, todayAiRecapError = '', onGenerateAiRecap,
  weekStart = 'monday', helpers = {},
}) {
  const normalizeRange = helpers.rollupNormalizeRange || (value => value || 'today');
  const normalizeGroupBy = helpers.rollupNormalizeGroupBy || (value => value || 'created');
  const [range, setRange] = useStateP(normalizeRange(rollupDefaultRange));
  const [groupBy, setGroupBy] = useStateP(normalizeGroupBy(rollupGroupBy));
  const [quickTask, setQuickTask] = useStateP('');
  const [collapsedGroups, setCollapsedGroups] = useStateP({});

  useEffectP(() => {
    setRange(normalizeRange(rollupDefaultRange));
  }, [rollupDefaultRange]);

  useEffectP(() => {
    setGroupBy(normalizeGroupBy(rollupGroupBy));
  }, [rollupGroupBy]);

  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);

  const noteGroups = useMemoP(() => (
    helpers.rollupGroupNotes
      ? helpers.rollupGroupNotes(notes, { range, groupBy, weekStart })
      : []
  ), [notes, range, groupBy, weekStart]);

  const todayGroups = useMemoP(() => (
    helpers.rollupGroupNotes
      ? helpers.rollupGroupNotes(notes, { range: 'today', groupBy, weekStart })
      : []
  ), [notes, groupBy, weekStart]);

  const visibleAgendaItems = useMemoP(() => (
    helpers.digestUniqueActionItems
      ? helpers.digestUniqueActionItems(agendaItems, { limit: 5 })
      : (agendaItems || []).slice(0, 5)
  ), [agendaItems]);
  const agendaKeys = useMemoP(() => new Set(visibleAgendaItems.map(item => helpers.digestActionItemKey?.(item)).filter(Boolean)), [visibleAgendaItems]);

  const visibleTasks = useMemoP(() => {
    const items = rollupShowTasks && helpers.rollupFilterTaskItems
      ? helpers.rollupFilterTaskItems(tasks, notes, { range, groupBy, weekStart })
      : [];
    return helpers.digestUniqueActionItems
      ? helpers.digestUniqueActionItems(items, { excludeKeys: [...agendaKeys] })
      : items;
  }, [rollupShowTasks, tasks, notes, range, groupBy, weekStart, agendaKeys]);

  const todayTasks = useMemoP(() => (
    helpers.rollupFilterTaskItems
      ? helpers.rollupFilterTaskItems(tasks, notes, { range: 'today', groupBy, weekStart })
      : []
  ), [tasks, notes, groupBy, weekStart]);

  const visibleReminders = useMemoP(() => (
    rollupShowReminders && helpers.rollupFilterReminderItems
      ? helpers.rollupFilterReminderItems(reminders, notes, { range, groupBy, weekStart })
      : []
  ), [rollupShowReminders, reminders, notes, range, groupBy, weekStart]);

  const todayReminders = useMemoP(() => (
    helpers.rollupFilterReminderItems
      ? helpers.rollupFilterReminderItems(reminders, notes, { range: 'today', groupBy, weekStart })
      : []
  ), [reminders, notes, groupBy, weekStart]);

  const todayNoteCount = todayGroups.reduce((sum, group) => sum + group.notes.length, 0);
  const rangeNoteCount = noteGroups.reduce((sum, group) => sum + group.notes.length, 0);
  const todayKey = helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10);
  const dailyNote = todayNote || (notes || []).find(note => String(note.title || '').trim() === todayKey) || null;
  const noteById = useMemoP(() => new Map((notes || []).map(note => [note.id, note])), [notes]);
  const reminderGroups = useMemoP(() => ([
    { key: 'overdue', label: 'Overdue', items: visibleReminders.filter(item => item.rollupStatus === 'overdue') },
    { key: 'due-today', label: 'Due today', items: visibleReminders.filter(item => item.rollupStatus === 'due-today') },
    { key: 'upcoming', label: 'Upcoming', items: visibleReminders.filter(item => item.rollupStatus === 'upcoming') },
  ]), [visibleReminders]);

  const rangeOptions = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
  ];
  const groupOptions = [
    { value: 'created', label: 'Created' },
    { value: 'modified', label: 'Modified' },
    { value: 'title-date', label: 'Title date' },
  ];

  const panelButton = (active = false) => ({
    border: `1px solid ${active ? T.accent : T.lineSub}`,
    background: active ? `color-mix(in oklab, ${T.accent} 13%, ${T.bg})` : T.bg,
    color: active ? T.accent : T.inkMed,
    borderRadius: 6,
    padding: '7px 10px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
    fontWeight: 650,
    letterSpacing: 0,
  });

  const sectionShell = {
    borderTop: `1px solid ${T.lineSub}`,
    paddingTop: 18,
    marginTop: 20,
  };

  const headingDate = (group) => (
    group.date.toLocaleDateString([], rollupFormat === 'short'
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { weekday: 'long', month: 'long', day: 'numeric' })
  );

  const setGroupCollapsed = (key, value) => {
    setCollapsedGroups(current => ({ ...current, [key]: value }));
  };

  const runQuickTask = (event) => {
    event.preventDefault();
    const text = quickTask.trim();
    if (!text) return;
    if (onAddQuickTask?.(text) !== false) setQuickTask('');
  };

  const stat = (label, value) => (
    <div style={{
      minWidth: 92,
      border: `1px solid ${T.lineSub}`,
      borderRadius: 7,
      background: T.bgSub,
      padding: '9px 10px',
    }}>
      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
      <div style={{ marginTop: 3, fontFamily: 'var(--mn-ui)', fontSize: 20, fontWeight: 760, color: T.ink }}>{value}</div>
    </div>
  );

  const taskLabel = item => item.label || item.text || 'Untitled task';
  const reminderLabel = item => item.text || item.label || 'Reminder';
  const agendaLabel = item => item.label || item.text || 'Agenda item';
  const agendaWhen = item => item.remindAt?.time || item.remindAt?.date || '';
  const reminderWhen = item => [item.remindAt?.date || item.rollupDateKey, item.remindAt?.time || ''].filter(Boolean).join(' ');
  const recapSections = Array.isArray(todayAiRecap?.sections) ? todayAiRecap.sections : [];
  const recapSources = Array.isArray(todayAiRecap?.sources) ? todayAiRecap.sources : [];
  const sourceButton = (source, index) => (
    <button key={source.id || `${source.title}-${index}`} type="button" onClick={() => source.id && onOpen?.(source.id)} style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 999,
      background: T.bg,
      color: T.inkMed,
      padding: '4px 8px',
      cursor: source.id ? 'pointer' : 'default',
      fontFamily: 'var(--mn-ui)',
      fontSize: 11.5,
      maxWidth: 180,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>{source.title || source.id || 'Source'}</button>
  );

  return (
    <div style={{
      flex: 1, height: '100%', background: T.bg,
      padding: '32px 24px 28px', overflow: 'auto',
    }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 26, fontWeight: 700,
          color: T.ink, marginBottom: 3, letterSpacing: 0,
        }}>Today</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 18,
        }}>daily note, notes, open loops, and reminders</div>

        <div style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bgSub,
          padding: 14,
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 220, flex: 1 }}>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 720, color: T.ink }}>
                {dailyNote ? dailyNote.title : todayKey}
              </div>
              <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                {dailyNote ? 'daily note ready' : 'daily note not created'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {stat('notes', todayNoteCount)}
              {stat('tasks', todayTasks.length)}
              {stat('reminders', todayReminders.length)}
            </div>
            <button type="button" onClick={onOpenOrCreateDailyNote} style={panelButton(true)}>
              {dailyNote ? 'Open daily note' : 'Create daily note'}
            </button>
            <button type="button" onClick={onAddReflection} style={panelButton(false)}>
              Add reflection
            </button>
            <button type="button" onClick={onEndDayRecap} style={panelButton(false)}>
              End-day recap
            </button>
            {!!onGenerateAiRecap && (
              <button type="button" onClick={onGenerateAiRecap} disabled={todayAiRecapBusy} style={{
                ...panelButton(false),
                opacity: todayAiRecapBusy ? 0.65 : 1,
                cursor: todayAiRecapBusy ? 'default' : 'pointer',
              }}>
                {todayAiRecapBusy ? 'Generating...' : 'AI recap'}
              </button>
            )}
          </div>
          <form onSubmit={runQuickTask} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input
              value={quickTask}
              onChange={(event) => setQuickTask(event.target.value)}
              placeholder="Quick task"
              style={{
                flex: '1 1 220px',
                minWidth: 0,
                border: `1px solid ${T.lineSub}`,
                borderRadius: 6,
                background: T.bg,
                color: T.ink,
                padding: '8px 10px',
                fontFamily: 'var(--mn-ui)',
                fontSize: 13,
              }}
            />
            <button type="submit" disabled={!quickTask.trim()} style={{
              ...panelButton(true),
              opacity: quickTask.trim() ? 1 : 0.55,
              cursor: quickTask.trim() ? 'pointer' : 'default',
            }}>Add task</button>
          </form>
        </div>

        {(todayAiRecap || todayAiRecapBusy || todayAiRecapError) && (
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: 12,
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 9 }}>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink }}>AI daily recap</div>
              {todayAiRecap?.providerModelLabel && (
                <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{todayAiRecap.providerModelLabel}</div>
              )}
              <div style={{ flex: 1 }} />
              {!!onGenerateAiRecap && (
                <button type="button" onClick={onGenerateAiRecap} disabled={todayAiRecapBusy} style={panelButton(false)}>
                  {todayAiRecapBusy ? 'Generating...' : 'Refresh'}
                </button>
              )}
            </div>
            {todayAiRecapError && (
              <div style={{
                border: `1px solid color-mix(in oklab, ${T.warn || T.danger || T.ink} 35%, ${T.lineSub})`,
                borderRadius: 7,
                background: T.bg,
                color: T.warn || T.danger || T.ink,
                padding: '8px 10px',
                fontFamily: 'var(--mn-ui)',
                fontSize: 12.5,
              }}>{todayAiRecapError}</div>
            )}
            {todayAiRecapBusy && !todayAiRecap && !todayAiRecapError && (
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkDim }}>Generating recap...</div>
            )}
            {recapSections.length > 0 && (
              <div style={{ display: 'grid', gap: 9 }}>
                {recapSections.map(section => (
                  <div key={`${section.kind}:${section.title}`} style={{
                    border: `1px solid ${T.lineSub}`,
                    borderRadius: 7,
                    background: T.bg,
                    padding: '9px 10px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 4 }}>
                      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 720, color: T.ink }}>{section.title}</div>
                      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: section.kind === 'suggestion' ? T.accent : T.inkDim, textTransform: 'uppercase' }}>{section.kind}</div>
                    </div>
                    <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.8, lineHeight: 1.45, color: T.inkMed, whiteSpace: 'pre-wrap' }}>
                      {section.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {recapSources.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {recapSources.map(sourceButton)}
              </div>
            )}
          </div>
        )}

        <div style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bgSub,
          padding: 12,
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink }}>Agenda today</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{visibleAgendaItems.length}</div>
            <div style={{ flex: 1 }} />
            {(onOpenAgenda || onPlanItem) && <button type="button" onClick={onOpenAgenda || onPlanItem} style={panelButton(false)}>Open Agenda</button>}
          </div>
          {visibleAgendaItems.length === 0 && (
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkDim, padding: '3px 0' }}>No agenda items today</div>
          )}
          {visibleAgendaItems.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {visibleAgendaItems.map(item => (
                <button key={item.key || `${item.noteId}:${agendaWhen(item)}:${agendaLabel(item)}`} type="button" onClick={() => onPlanItem?.(item)} style={{
                  border: `1px solid ${T.lineSub}`,
                  borderRadius: 7,
                  background: T.bg,
                  color: T.ink,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.accent, minWidth: 44 }}>{agendaWhen(item) || 'Today'}</span>
                    <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 650, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agendaLabel(item)}</span>
                  </div>
                  <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{item.noteTitle || 'Untitled'}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {(staleTasks.length > 0 || unlinkedNotes.length > 0) && (
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: 12,
            marginBottom: 16,
          }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 8 }}>
              Needs attention
            </div>
            {staleTasks.length > 0 && (
              <div style={{ marginBottom: unlinkedNotes.length ? 10 : 0 }}>
                <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.inkDim, marginBottom: 5 }}>
                  Stale todos · notes untouched 2+ weeks
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {staleTasks.map(item => (
                    <button key={item.key || `${item.noteId}:${item.label}`} type="button" onClick={() => onOpen?.(item.noteId)} style={{
                      border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg, color: T.ink,
                      padding: '7px 10px', cursor: 'pointer', textAlign: 'left',
                    }}>
                      <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600 }}>{item.label || item.text}</span>
                      <span style={{ marginLeft: 8, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{item.noteTitle || 'Untitled'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {unlinkedNotes.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.inkDim, marginBottom: 5 }}>
                  Recently edited, not linked anywhere
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {unlinkedNotes.map(note => (
                    <button key={note.id} type="button" onClick={() => onOpen?.(note.id)} style={{
                      border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg, color: T.ink,
                      padding: '7px 10px', cursor: 'pointer', textAlign: 'left',
                      fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600,
                    }}>
                      {note.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {resurfacedNotes.length > 0 && (
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: 12,
            marginBottom: 16,
          }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 3 }}>
              Worth revisiting
            </div>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim, marginBottom: 8 }}>
              Useful context from the last few weeks
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {resurfacedNotes.map(note => (
                <button key={note.id} type="button" onClick={() => onOpen?.(note.id)} aria-label={`Open ${note.title}`} style={{
                  border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg, color: T.ink,
                  padding: '7px 10px', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
                }}>
                  <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.title}</span>
                  <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim, flexShrink: 0 }}>{note.reason}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          {rangeOptions.map(option => (
            <button key={option.value} type="button" onClick={() => setRange(option.value)} style={panelButton(range === option.value)}>
              {option.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 6,
            background: T.bg,
            color: T.inkMed,
            padding: '7px 9px',
            fontFamily: 'var(--mn-ui)',
            fontSize: 12,
            fontWeight: 650,
          }} aria-label="Group Today by date source">
            {groupOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        {noteGroups.length === 0 && (
          <div style={{
            border: `1px dashed ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: 18,
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 700, color: T.ink }}>
                {range === 'today' ? 'No notes today' : 'No notes in this range'}
              </div>
              <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                {rangeNoteCount} notes
              </div>
            </div>
            {range === 'today' && (
              <button type="button" onClick={onOpenOrCreateDailyNote} style={panelButton(true)}>
                {dailyNote ? 'Open daily note' : 'Create daily note'}
              </button>
            )}
          </div>
        )}

        {noteGroups.map(g => {
          const defaultCollapsed = rollupCollapseOlder && g.isOlder;
          const collapsed = Object.prototype.hasOwnProperty.call(collapsedGroups, g.key)
            ? collapsedGroups[g.key]
            : defaultCollapsed;
          return (
          <div key={g.key} style={{ marginBottom: 22 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              marginBottom: 10,
            }}>
              <button type="button" onClick={() => setGroupCollapsed(g.key, !collapsed)} style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: `1px solid ${T.lineSub}`,
                background: T.bg,
                color: T.inkDim,
                cursor: 'pointer',
                fontFamily: 'var(--mn-mono)',
                fontSize: 13,
                lineHeight: 1,
              }} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${headingDate(g)}`}>
                {collapsed ? '+' : '-'}
              </button>
              <div style={{
                fontFamily: 'var(--mn-body)', fontSize: 16, fontWeight: 600,
                color: T.ink, letterSpacing: 0,
              }}>{headingDate(g)}</div>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
              }}>{g.notes.length} note{g.notes.length > 1 ? 's' : ''}</div>
              <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
            </div>
            {!collapsed && <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {g.notes.map(n => (
                <button key={n.id} type="button" onClick={() => onOpen(n.id)} style={{
                  padding: '9px 11px',
                  borderRadius: 7,
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: '52px minmax(0, 1fr)',
                  gap: 10,
                  textAlign: 'left',
                  border: `1px solid transparent`,
                  background: 'transparent',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
                    paddingTop: 1,
                  }}>{new Date(n.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 650, color: T.ink,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{n.title}</div>
                    {rollupShowPreviews && helpers.rollupNotePreview?.(n) && (
                      <div style={{
                        marginTop: 3,
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12.5,
                        color: T.inkMed,
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}>{helpers.rollupNotePreview(n)}</div>
                    )}
                    {!!(n.tags || []).length && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
                        {(n.tags || []).map(t => (
                          <span key={t} style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            border: `1px solid ${T.lineSub}`,
                            borderRadius: 999,
                            background: T.bg,
                            color: T.inkMed,
                            padding: '2px 6px',
                            fontFamily: 'var(--mn-mono)',
                            fontSize: 10,
                          }}>
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: mnGetTagColor(tagHue[t] ?? 240, theme),
                              display: 'inline-block',
                            }} />
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>}
          </div>
        );})}

        {rollupShowTasks && (
          <div style={sectionShell}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 720, color: T.ink }}>Open loops</div>
              <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{visibleTasks.length}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {visibleTasks.length === 0 && (
                <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkDim, padding: '6px 0' }}>No open loops for this range</div>
              )}
              {visibleTasks.map(item => (
                <div key={item.key || `${item.noteId}:${item.line || item.blockId || taskLabel(item)}`} style={{
                  border: `1px solid ${T.lineSub}`,
                  borderRadius: 7,
                  background: T.bgSub,
                  padding: '9px 11px',
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" onClick={() => onOpen(item.noteId)} style={{
                      flex: 1,
                      minWidth: 0,
                      border: 0,
                      background: 'transparent',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}>
                      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 650, color: T.ink }}>{taskLabel(item)}</div>
                      <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--mn-mono)', fontSize: 10.5 }}>
                        <span style={{ color: T.accent }}>{helpers.rollupTaskReasonLabel?.(item, noteById.get(item.noteId)) || 'from note'}</span>
                        <span style={{ color: T.inkDim }}>{item.noteTitle || 'Untitled'}</span>
                      </div>
                    </button>
                    <button type="button" onClick={() => onPlanItem?.(item)} aria-label={`Plan ${taskLabel(item)}`} style={panelButton(false)}>Plan</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {rollupShowReminders && (
          <div style={sectionShell}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 720, color: T.ink }}>Reminders</div>
              <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{visibleReminders.length}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {visibleReminders.length === 0 && (
                <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkDim, padding: '6px 0' }}>No reminders due in this range</div>
              )}
              {reminderGroups.map(group => (
                <div key={group.key} style={{ marginBottom: 8 }}>
                  <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, margin: '2px 0 5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {group.label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {group.items.length === 0 && (
                      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkDim, padding: '2px 0 5px' }}>No {group.label.toLowerCase()} reminders</div>
                    )}
                    {group.items.map(item => {
                      const statusColor = item.rollupStatus === 'overdue' ? T.danger : item.rollupStatus === 'due-today' ? T.warn : T.inkDim;
                      return (
                        <div key={item.key || `${item.noteId}:${reminderWhen(item)}:${reminderLabel(item)}`} style={{
                          border: `1px solid ${T.lineSub}`,
                          borderLeft: `3px solid ${statusColor}`,
                          borderRadius: 7,
                          background: T.bgSub,
                          padding: '9px 11px',
                        }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button type="button" onClick={() => onOpen(item.noteId)} style={{
                              flex: 1,
                              minWidth: 0,
                              border: 0,
                              background: 'transparent',
                              padding: 0,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}>
                              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 650, color: T.ink }}>{reminderLabel(item)}</div>
                              <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--mn-mono)', fontSize: 10.5 }}>
                                <span style={{ color: statusColor }}>{helpers.rollupReminderReasonLabel?.(item) || (item.rollupStatus === 'overdue' ? 'overdue' : item.rollupStatus === 'due-today' ? 'due today' : 'upcoming')}</span>
                                <span style={{ color: T.inkDim }}>{reminderWhen(item)}</span>
                                <span style={{ color: T.inkDim }}>{item.noteTitle || 'Untitled'}</span>
                              </div>
                            </button>
                            <button type="button" onClick={() => onPlanItem?.(item)} aria-label={`Plan ${reminderLabel(item)}`} style={panelButton(false)}>Plan</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { MnTodayPanel };
import { mnGetTagColor } from '../../../shared/theme.jsx';
