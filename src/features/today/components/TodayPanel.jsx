import { mnGetTagColor, mnTagHueMap } from '../../../shared/theme.jsx';
import { DS_TYPE, dsGroupLabelStyle, mnSentenceCase } from '../../../shared/designSystem.js';

const { useEffect, useMemo, useState } = React;

const defaultNormalizeRange = value => value || 'today';
const defaultNormalizeGroupBy = value => value || 'created';

function sectionStyle(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    borderRadius: 8,
    background: T.bgSub,
    padding: 12,
    marginBottom: 16,
  };
}

// A single number and what it counts. Numbers are set in the writing voice —
// they are the sentence the page is making.
function TodayStat({ value, label, tone, T }) {
  return (
    <div>
      <div style={{ ...DS_TYPE.sectionHead, fontSize: 24, color: tone || T.ink }}>{value}</div>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim }}>{label}</div>
    </div>
  );
}

function TodaySection({ title, count, action = null, name, children, T }) {
  return (
    <section data-mn-today-section={name} style={sectionStyle(T)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>{title}</h2>
        {Number.isFinite(count) && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{count}</span>
        )}
        <div style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </section>
  );
}

function TodayNoteGroups({
  groups, collapsedGroups, setGroupCollapsed, headingDate, notePreview, showPreviews,
  collapseOlder, onOpen, tagHue, theme, T, title = 'Notes today', sectionName = 'notes',
}) {
  if (!groups.length) return null;
  return (
    <section data-mn-today-section={sectionName} style={{ marginBottom: 18 }}>
      {title && (
        <h2 style={{ margin: '0 0 10px', fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>
          {title}
        </h2>
      )}
      {groups.map(group => {
        const defaultCollapsed = collapseOlder && group.isOlder;
        const collapsed = Object.prototype.hasOwnProperty.call(collapsedGroups, group.key)
          ? collapsedGroups[group.key]
          : defaultCollapsed;
        return (
          <div key={group.key} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
              <button
                type="button"
                onClick={() => setGroupCollapsed(group.key, !collapsed)}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${headingDate(group)}`}
                style={{
                  width: 32, height: 32, borderRadius: 6, border: `1px solid ${T.lineSub}`,
                  background: T.bg, color: T.inkDim, cursor: 'pointer', fontFamily: 'var(--mn-mono)', fontSize: 13,
                }}>
                {collapsed ? '+' : '-'}
              </button>
              <div style={{ fontFamily: 'var(--mn-body)', fontSize: 16, fontWeight: 600, color: T.ink }}>{headingDate(group)}</div>
              <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                {group.notes.length} note{group.notes.length === 1 ? '' : 's'}
              </div>
              <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
            </div>
            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {group.notes.map(note => {
                  const preview = notePreview?.(note) || '';
                  const noteTime = new Date(note.date);
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => onOpen?.(note.id)}
                      aria-label={`Open ${note.title || 'Untitled'}`}
                      style={{
                        padding: '9px 11px', borderRadius: 7, cursor: 'pointer', display: 'grid',
                        gridTemplateColumns: '52px minmax(0, 1fr)', gap: 10, textAlign: 'left',
                        border: '1px solid transparent', background: 'transparent', minHeight: 44,
                      }}
                      onMouseEnter={event => { event.currentTarget.style.background = T.bgHover; }}
                      onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
                      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, paddingTop: 1 }}>
                        {Number.isFinite(noteTime.getTime())
                          ? noteTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                          : ''}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 650, color: T.ink,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{note.title || 'Untitled'}</div>
                        {showPreviews && preview && (
                          <div style={{
                            marginTop: 3, fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkMed,
                            lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          }}>{preview}</div>
                        )}
                        {!!(note.tags || []).length && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
                            {(note.tags || []).map(tag => (
                              <span key={tag} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${T.lineSub}`,
                                borderRadius: 999, background: T.bg, color: T.inkMed, padding: '2px 6px',
                                fontFamily: 'var(--mn-ui)', fontSize: 11,
                              }}>
                                <span aria-hidden="true" style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: mnGetTagColor(tagHue.get(tag) ?? 240, theme), display: 'inline-block',
                                }} />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function AiRecap({ recap, busy, error, onGenerate, onOpen, buttonStyle, T }) {
  if (!recap && !busy && !error) return null;
  const sections = Array.isArray(recap?.sections) ? recap.sections : [];
  const sources = Array.isArray(recap?.sources) ? recap.sources : [];
  return (
    <TodaySection
      name="ai-recap"
      title="AI daily recap"
      action={onGenerate ? (
        <button type="button" onClick={onGenerate} disabled={busy} style={buttonStyle(false, busy)}>
          {busy ? 'Generating...' : 'Refresh'}
        </button>
      ) : null}
      T={T}>
      {recap?.providerModelLabel && (
        <div style={{ margin: '-5px 0 9px', fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
          {recap.providerModelLabel}
        </div>
      )}
      {error && (
        <div role="status" style={{
          border: `1px solid color-mix(in oklab, ${T.warn || T.danger || T.ink} 35%, ${T.lineSub})`,
          borderRadius: 7, background: T.bg, color: T.warn || T.danger || T.ink,
          padding: '8px 10px', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
        }}>{error}</div>
      )}
      {busy && !recap && !error && (
        <div role="status" style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkDim }}>Generating recap...</div>
      )}
      {!!sections.length && (
        <div style={{ display: 'grid', gap: 9 }}>
          {sections.map(section => (
            <div key={`${section.kind}:${section.title}`} style={{
              border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg, padding: '9px 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 4 }}>
                <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 650, color: T.ink }}>{section.title}</div>
                <div style={{
                  ...dsGroupLabelStyle(T),
                  color: section.kind === 'suggestion' ? T.accent : T.inkDim,
                }}>{mnSentenceCase(section.kind)}</div>
              </div>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.8, lineHeight: 1.45, color: T.inkMed, whiteSpace: 'pre-wrap' }}>
                {section.content}
              </div>
            </div>
          ))}
        </div>
      )}
      {!!sources.length && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {sources.map((source, index) => (
            <button
              key={source.id || `${source.title}-${index}`}
              type="button"
              onClick={() => source.id && onOpen?.(source.id)}
              disabled={!source.id}
              style={{
                border: `1px solid ${T.lineSub}`, borderRadius: 999, background: T.bg, color: T.inkMed,
                padding: '5px 9px', cursor: source.id ? 'pointer' : 'default', fontFamily: 'var(--mn-ui)',
                fontSize: 11.5, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
              {source.title || source.id || 'Source'}
            </button>
          ))}
        </div>
      )}
    </TodaySection>
  );
}

function MnTodayPanel({
  notes = [], tags = [], tasks = [], reminders = [], todayNote = null, agendaItems = [], reviewItems = [],
  onOpen, onOpenOrCreateDailyNote, onAddQuickTask, onAddReflection, onEndDayRecap, onOpenAgenda, onPlanItem,
  onDismissReviewItem, onSnoozeReviewItem, T, theme, rollupFormat = 'long', rollupDefaultRange = 'today',
  rollupGroupBy = 'created', rollupShowPreviews = true, rollupShowTasks = true, rollupShowReminders = true,
  rollupCollapseOlder = true, todayAiRecap = null, todayAiRecapBusy = false, todayAiRecapError = '',
  onGenerateAiRecap, weekStart = 'monday', helpers = {},
}) {
  const normalizeRange = helpers.rollupNormalizeRange || defaultNormalizeRange;
  const normalizeGroupBy = helpers.rollupNormalizeGroupBy || defaultNormalizeGroupBy;
  const initialRange = normalizeRange(rollupDefaultRange);
  const [pastRange, setPastRange] = useState(initialRange === 'today' ? 'week' : initialRange);
  const todayGroupBy = normalizeGroupBy(rollupGroupBy);
  const [pastGroupBy, setPastGroupBy] = useState(todayGroupBy);
  const [quickTask, setQuickTask] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});

  useEffect(() => {
    const next = normalizeRange(rollupDefaultRange);
    setPastRange(next === 'today' ? 'week' : next);
  }, [normalizeRange, rollupDefaultRange]);

  useEffect(() => setPastGroupBy(normalizeGroupBy(rollupGroupBy)), [normalizeGroupBy, rollupGroupBy]);

  const todayKey = helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10);
  const dailyNote = todayNote || notes.find(note => String(note.title || '').trim() === todayKey) || null;
  const tagHue = useMemo(() => mnTagHueMap(tags), [tags]);
  const noteById = useMemo(() => new Map(notes.map(note => [note.id, note])), [notes]);
  const visibleAgendaItems = useMemo(() => (
    helpers.digestUniqueActionItems ? helpers.digestUniqueActionItems(agendaItems, { limit: 5 }) : agendaItems.slice(0, 5)
  ), [agendaItems, helpers]);
  const agendaKeys = useMemo(() => new Set(
    visibleAgendaItems.map(item => helpers.digestActionItemKey?.(item)).filter(Boolean)
  ), [helpers, visibleAgendaItems]);

  const todayGroups = useMemo(() => {
    const groups = helpers.rollupGroupNotes
      ? helpers.rollupGroupNotes(notes, { range: 'today', groupBy: todayGroupBy, weekStart })
      : [];
    return groups
      .map(group => ({ ...group, notes: group.notes.filter(note => note.id !== dailyNote?.id) }))
      .filter(group => group.notes.length);
  }, [dailyNote?.id, helpers, notes, todayGroupBy, weekStart]);

  const historyAvailable = useMemo(() => (
    helpers.rollupGroupNotes
      ? helpers.rollupGroupNotes(notes, { range: 'month', groupBy: 'created', weekStart }).some(group => group.key !== todayKey)
      : false
  ), [helpers, notes, todayKey, weekStart]);

  const historyGroups = useMemo(() => (
    helpers.rollupGroupNotes
      ? helpers.rollupGroupNotes(notes, { range: pastRange, groupBy: pastGroupBy, weekStart }).filter(group => group.key !== todayKey)
      : []
  ), [helpers, notes, pastGroupBy, pastRange, todayKey, weekStart]);

  const todayTasks = useMemo(() => {
    const items = rollupShowTasks && helpers.rollupFilterTaskItems
      ? helpers.rollupFilterTaskItems(tasks, notes, { range: 'today', groupBy: todayGroupBy, weekStart })
      : [];
    return helpers.digestUniqueActionItems
      ? helpers.digestUniqueActionItems(items, { excludeKeys: [...agendaKeys] })
      : items;
  }, [agendaKeys, helpers, notes, rollupShowTasks, tasks, todayGroupBy, weekStart]);

  const todayReminders = useMemo(() => {
    const items = rollupShowReminders && helpers.rollupFilterReminderItems
      ? helpers.rollupFilterReminderItems(
        reminders.filter(item => item?.status !== 'snoozed' && (Number(item?.snoozedUntil) || 0) <= Date.now()),
        notes,
        { range: 'today', groupBy: todayGroupBy, weekStart }
      )
      : [];
    return helpers.digestUniqueActionItems
      ? helpers.digestUniqueActionItems(items, { excludeKeys: [...agendaKeys] })
      : items;
  }, [agendaKeys, helpers, notes, reminders, rollupShowReminders, todayGroupBy, weekStart]);

  const reminderGroups = useMemo(() => ([
    { key: 'overdue', label: 'Overdue', items: todayReminders.filter(item => item.rollupStatus === 'overdue') },
    { key: 'due-today', label: 'Due today', items: todayReminders.filter(item => item.rollupStatus === 'due-today') },
  ].filter(group => group.items.length)), [todayReminders]);

  const hasActivity = Boolean(
    dailyNote || todayGroups.length || visibleAgendaItems.length || todayTasks.length || todayReminders.length || reviewItems.length
  );
  const emptyToday = !hasActivity;
  const formattedToday = new Date(`${todayKey}T12:00:00`).toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const buttonStyle = (active = false, disabled = false) => ({
    border: `1px solid ${active ? T.accent : T.lineSub}`,
    background: active ? `color-mix(in oklab, ${T.accent} 13%, ${T.bg})` : T.bg,
    color: active ? T.accent : T.inkMed,
    borderRadius: 6, padding: '8px 11px', minHeight: 36, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1, fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 650,
  });
  const headingDate = group => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(group.key || ''))
      ? new Date(`${group.key}T12:00:00`)
      : group.date;
    return date.toLocaleDateString([], rollupFormat === 'short'
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { weekday: 'long', month: 'long', day: 'numeric' });
  };
  const setGroupCollapsed = (key, value) => setCollapsedGroups(current => ({ ...current, [key]: value }));
  const actionLabel = item => item.label || item.text || 'Untitled task';
  const reminderLabel = item => item.text || item.label || 'Reminder';
  const reminderWhen = item => [item.remindAt?.date || item.rollupDateKey, item.remindAt?.time || ''].filter(Boolean).join(' ');

  const runQuickTask = event => {
    event.preventDefault();
    const text = quickTask.trim();
    if (text && onAddQuickTask?.(text) !== false) setQuickTask('');
  };

  const overdueCount = todayReminders.filter(item => item.rollupStatus === 'overdue').length;
  const openLoopCount = todayReminders.length;
  const notesWrittenCount = todayGroups.reduce((total, group) => total + group.notes.length, 0);
  // Say what the numbers mean, and only mention overdue when there is some.
  const todaySummaryLine = openLoopCount
    ? `${openLoopCount} thing${openLoopCount === 1 ? '' : 's'} want your attention.${overdueCount ? ` ${overdueCount} ${overdueCount === 1 ? 'is' : 'are'} overdue.` : ''}`
    : 'Nothing is waiting on you today.';

  return (
    <main
      data-mn-today-root="true"
      data-mn-today-empty={emptyToday ? 'true' : 'false'}
      style={{ flex: 1, height: '100%', background: T.bg, padding: '32px 24px 28px', overflow: 'auto' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {/* The date is the heading; the counts stand beside it so the day's
            shape reads before any control does. */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22,
        }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{
              margin: 0, ...DS_TYPE.sectionHead, fontSize: 32, lineHeight: 1.1, color: T.ink,
            }}>{formattedToday}</h1>
            <div style={{ marginTop: 6, fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkMed }}>
              {todaySummaryLine}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 22, paddingBottom: 4 }}>
            <TodayStat value={openLoopCount} label="open loops" T={T} />
            <TodayStat value={overdueCount} label="overdue" tone={overdueCount ? T.danger : undefined} T={T} />
            <TodayStat value={notesWrittenCount} label="notes written" T={T} />
          </div>
        </div>

        <section aria-label="Today actions" style={{ ...sectionStyle(T), padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={onOpenOrCreateDailyNote} style={buttonStyle(true)}>
              {dailyNote ? 'Open daily note' : 'Create daily note'}
            </button>
            {hasActivity && onAddReflection && (
              <button type="button" onClick={onAddReflection} style={buttonStyle(false)}>Add reflection</button>
            )}
            {hasActivity && onEndDayRecap && (
              <button type="button" onClick={onEndDayRecap} style={buttonStyle(false)}>End-day recap</button>
            )}
            {hasActivity && onGenerateAiRecap && (
              <button type="button" onClick={onGenerateAiRecap} disabled={todayAiRecapBusy} style={buttonStyle(false, todayAiRecapBusy)}>
                {todayAiRecapBusy ? 'Generating...' : 'AI recap'}
              </button>
            )}
          </div>
          <form onSubmit={runQuickTask} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input
              value={quickTask}
              onChange={event => setQuickTask(event.target.value)}
              aria-label="Quick task"
              placeholder="Quick task"
              style={{
                flex: '1 1 220px', minWidth: 0, minHeight: 36, border: `1px solid ${T.lineSub}`,
                borderRadius: 6, background: T.bg, color: T.ink, padding: '8px 10px',
                fontFamily: 'var(--mn-ui)', fontSize: 13,
              }}
            />
            <button type="submit" disabled={!quickTask.trim()} style={buttonStyle(true, !quickTask.trim())}>Add task</button>
          </form>
        </section>

        {/* Do on the left, what was written on the right, at the prototype's
            1.25 : 1 split. Two real columns rather than one grid: paired rows
            would tie each side's height to the other's. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)',
          gap: 28, alignItems: 'start',
        }}>

          {/* Do — agenda, loops and reminders, in order */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!!visibleAgendaItems.length && (
          <TodaySection
            name="agenda"
            title="Agenda"
            count={visibleAgendaItems.length}
            action={onOpenAgenda ? <button type="button" onClick={onOpenAgenda} style={buttonStyle(false)}>Open agenda</button> : null}
            T={T}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {visibleAgendaItems.map(item => (
                <button
                  key={item.key || `${item.noteId}:${item.remindAt?.date || ''}:${actionLabel(item)}`}
                  type="button"
                  onClick={() => onPlanItem?.(item)}
                  aria-label={`Plan ${actionLabel(item)}`}
                  style={{
                    border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg, color: T.ink,
                    padding: '8px 10px', minHeight: 44, cursor: 'pointer', textAlign: 'left',
                  }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.accent, minWidth: 44 }}>
                      {item.remindAt?.time || 'Today'}
                    </span>
                    <span style={{
                      fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 650, color: T.ink,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{actionLabel(item)}</span>
                  </div>
                  <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                    {item.noteTitle || 'Untitled'}
                  </div>
                </button>
              ))}
            </div>
          </TodaySection>
        )}
        {!!todayTasks.length && (
          <TodaySection name="open-loops" title="Open loops" count={todayTasks.length} T={T}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {todayTasks.map(item => (
                <div key={item.key || `${item.noteId}:${item.line || item.blockId || actionLabel(item)}`} style={{
                  border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg, padding: '9px 11px',
                  display: 'flex', gap: 8, alignItems: 'center',
                }}>
                  <button type="button" onClick={() => onOpen?.(item.noteId)} style={{
                    flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: 0,
                    cursor: 'pointer', textAlign: 'left', minHeight: 36,
                  }}>
                    <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 650, color: T.ink }}>{actionLabel(item)}</div>
                    <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--mn-mono)', fontSize: 10.5 }}>
                      <span style={{ color: T.accent }}>{helpers.rollupTaskReasonLabel?.(item, noteById.get(item.noteId)) || 'from note'}</span>
                      <span style={{ color: T.inkDim }}>{item.noteTitle || 'Untitled'}</span>
                    </div>
                  </button>
                  {onPlanItem && (
                    <button type="button" onClick={() => onPlanItem(item)} aria-label={`Plan ${actionLabel(item)}`} style={buttonStyle(false)}>Plan</button>
                  )}
                </div>
              ))}
            </div>
          </TodaySection>
        )}
        {!!todayReminders.length && (
          <TodaySection name="reminders" title="Reminders" count={todayReminders.length} T={T}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reminderGroups.map(group => (
                <div key={group.key}>
                  <div style={{ ...dsGroupLabelStyle(T), margin: '2px 0 5px' }}>{group.label}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {group.items.map(item => {
                      const statusColor = item.rollupStatus === 'overdue' ? T.danger : T.warn;
                      return (
                        <div key={item.key || `${item.noteId}:${reminderWhen(item)}:${reminderLabel(item)}`} style={{
                          border: `1px solid ${T.lineSub}`, borderLeft: `3px solid ${statusColor}`,
                          borderRadius: 7, background: T.bg, padding: '9px 11px', display: 'flex', gap: 8, alignItems: 'center',
                        }}>
                          <button type="button" onClick={() => onOpen?.(item.noteId)} style={{
                            flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: 0,
                            cursor: 'pointer', textAlign: 'left', minHeight: 36,
                          }}>
                            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 650, color: T.ink }}>
                              {reminderLabel(item)}
                            </div>
                            <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--mn-mono)', fontSize: 10.5 }}>
                              <span style={{ color: statusColor }}>{helpers.rollupReminderReasonLabel?.(item) || group.label.toLowerCase()}</span>
                              <span style={{ color: T.inkDim }}>{reminderWhen(item)}</span>
                              <span style={{ color: T.inkDim }}>{item.noteTitle || 'Untitled'}</span>
                            </div>
                          </button>
                          {onPlanItem && (
                            <button type="button" onClick={() => onPlanItem(item)} aria-label={`Plan ${reminderLabel(item)}`} style={buttonStyle(false)}>Plan</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </TodaySection>
        )}
          </div>
          {/* Written — recap, revisits and the notes themselves */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AiRecap
          recap={todayAiRecap}
          busy={todayAiRecapBusy}
          error={todayAiRecapError}
          onGenerate={onGenerateAiRecap}
          onOpen={onOpen}
          buttonStyle={buttonStyle}
          T={T}
        />
        {!!reviewItems.length && (
          <TodaySection name="worth-revisiting" title="Worth revisiting" count={reviewItems.length} T={T}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reviewItems.slice(0, 3).map(item => (
                <div key={item.id} data-mn-today-review-item={item.id} style={{
                  border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg,
                  padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <button type="button" onClick={() => onOpen?.(item.noteId)} aria-label={`Open ${item.title}`} style={{
                    flex: '1 1 240px', minWidth: 0, border: 0, background: 'transparent', padding: 0,
                    cursor: 'pointer', textAlign: 'left', minHeight: 36,
                  }}>
                    <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 650, color: T.ink }}>{item.title}</div>
                    <div style={{ marginTop: 3, fontFamily: 'var(--mn-ui)', fontSize: 11.8, color: T.inkDim }}>{item.reason}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSnoozeReviewItem?.(item.id)}
                    aria-label={`Snooze ${item.title} for 7 days`}
                    style={buttonStyle(false)}>Snooze 7 days</button>
                  <button
                    type="button"
                    onClick={() => onDismissReviewItem?.(item.id)}
                    aria-label={`Dismiss ${item.title}`}
                    style={buttonStyle(false)}>Dismiss</button>
                </div>
              ))}
            </div>
          </TodaySection>
        )}
        <TodayNoteGroups
          groups={todayGroups}
          collapsedGroups={collapsedGroups}
          setGroupCollapsed={setGroupCollapsed}
          headingDate={headingDate}
          notePreview={helpers.rollupNotePreview}
          showPreviews={rollupShowPreviews}
          collapseOlder={false}
          onOpen={onOpen}
          tagHue={tagHue}
          theme={theme}
          T={T}
        />
        {historyAvailable && (
          <details data-mn-today-section="history" style={{ ...sectionStyle(T), padding: 0 }}>
            <summary style={{
              cursor: 'pointer', padding: 12, minHeight: 44, boxSizing: 'border-box',
              fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink,
            }}>Review past days</summary>
            <div style={{ padding: '0 12px 12px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                {[
                  ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPastRange(value)}
                    aria-pressed={pastRange === value}
                    style={buttonStyle(pastRange === value)}>{label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <select value={pastGroupBy} onChange={event => setPastGroupBy(event.target.value)} aria-label="Group past days by date source" style={{
                  border: `1px solid ${T.lineSub}`, borderRadius: 6, background: T.bg, color: T.inkMed,
                  padding: '8px 9px', minHeight: 36, fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 650,
                }}>
                  <option value="created">Created</option>
                  <option value="modified">Modified</option>
                  <option value="title-date">Title date</option>
                </select>
              </div>
              {!historyGroups.length && (
                <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkDim, padding: '3px 0 8px' }}>
                  No notes in this range
                </div>
              )}
              <TodayNoteGroups
                groups={historyGroups}
                collapsedGroups={collapsedGroups}
                setGroupCollapsed={setGroupCollapsed}
                headingDate={headingDate}
                notePreview={helpers.rollupNotePreview}
                showPreviews={rollupShowPreviews}
                collapseOlder={rollupCollapseOlder}
                onOpen={onOpen}
                tagHue={tagHue}
                theme={theme}
                T={T}
                title={null}
                sectionName="history-notes"
              />
            </div>
          </details>
        )}
          </div>
        </div>
      </div>
    </main>
  );
}

export { MnTodayPanel };
