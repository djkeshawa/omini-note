import { DS_TYPE, DS_HEIGHT, DS_RADIUS, dsMachineStyle } from '../shared/designSystem.js';
// Agenda panel for dated reminders and todo planning.

import MN_APP_HELPERS from '../app/appHelpers.js';
import { mnGetTagColor, mnTagHueMap } from '../shared/theme.jsx';
import { mnCalendarDateKey, mnCalendarDateFromKey, mnCalendarMonthDays, mnCalendarItemDateKey, mnCalendarTimeText } from './calendarDates.js';
import { mnCalendarIcon, mnAgendaStepBtn, mnCalendarInput, mnCalendarPrimaryButton, MnDayChip, MnItemCard } from './calendarChrome.jsx';

const { useEffect: useEffectC, useMemo: useMemoC, useState: useStateC } = React;

function MnCalendarPanel({
  notes = [],
  tags = [],
  items = [],
  selectedNoteId = '',
  weekStart = 'monday',
  snoozeMinutes = '15',
  onOpen,
  onCreateItem,
  onUpdateItem,
  onToggleCheck,
  onSnoozeItem,
  T,
  theme,
}) {
  const todayKey = mnCalendarDateKey(new Date());
  const [anchor, setAnchor] = useStateC(() => mnCalendarDateFromKey(todayKey));
  const [selectedKey, setSelectedKey] = useStateC(todayKey);
  const [mode, setMode] = useStateC('month');
  const [activeKey, setActiveKey] = useStateC('');
  const [draftText, setDraftText] = useStateC('');
  const [draftDate, setDraftDate] = useStateC('');
  const [draftTime, setDraftTime] = useStateC('');
  const [createOpen, setCreateOpen] = useStateC(false);
  const [createType, setCreateType] = useStateC('reminder');
  const [createText, setCreateText] = useStateC('');
  const [createDate, setCreateDate] = useStateC(todayKey);
  const [createTime, setCreateTime] = useStateC('09:00');
  const [createNoteId, setCreateNoteId] = useStateC(selectedNoteId || notes[0]?.id || '');
  const [filterStatus, setFilterStatus] = useStateC('all');
  const [filterTag, setFilterTag] = useStateC('');
  const [filterSourceId, setFilterSourceId] = useStateC('');
  const [createWhen, setCreateWhen] = useStateC('');
  const [draftWhen, setDraftWhen] = useStateC('');
  const [scheduleError, setScheduleError] = useStateC('');
  const [showAllUpcoming, setShowAllUpcoming] = useStateC(false);
  const helpers = MN_APP_HELPERS;

  useEffectC(() => {
    if (selectedNoteId) setCreateNoteId(selectedNoteId);
    else if (!createNoteId && notes[0]?.id) setCreateNoteId(notes[0].id);
  }, [selectedNoteId, notes, createNoteId]);

  useEffectC(() => {
    setCreateDate(selectedKey || todayKey);
  }, [selectedKey, todayKey]);

  const tagHue = useMemoC(() => mnTagHueMap(tags), [tags]);

  const filteredItems = useMemoC(() => (
    helpers.agendaFilterActionItems
      ? helpers.agendaFilterActionItems(items, notes, { status: filterStatus, tag: filterTag, sourceNoteId: filterSourceId })
      : (items || [])
  ), [helpers, items, notes, filterStatus, filterTag, filterSourceId]);
  const sourceOptions = useMemoC(() => {
    const ids = new Set((items || []).map(item => item.noteId).filter(Boolean));
    return notes.filter(note => ids.has(note.id));
  }, [items, notes]);
  const tagOptions = useMemoC(() => {
    const names = new Set();
    (items || []).forEach(item => (item.actionDetail?.inheritedTags || item.noteTags || []).forEach(tag => names.add(tag)));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [items, tags]);
  const activeItem = useMemoC(() => filteredItems.find(item => item.key === activeKey) || null, [filteredItems, activeKey]);

  // Keyed on which item is selected, not on the item object itself. The
  // decorated items are re-cloned whenever any note changes in the background
  // (an autosave, a checkbox elsewhere), so keying on the object identity
  // wiped an edit you were mid-way through typing.
  useEffectC(() => {
    if (!activeItem) return;
    setDraftText(activeItem.label || activeItem.text || '');
    setDraftDate(activeItem.remindAt?.date || '');
    setDraftTime(activeItem.remindAt?.time || '');
    setDraftWhen('');
    setScheduleError('');
  }, [activeKey]);

  const grouped = useMemoC(() => {
    const byDate = {};
    const undated = [];
    const now = new Date();
    const overdue = [];
    const upcoming = [];
    filteredItems.forEach(item => {
      if (item.checked) return;
      const key = mnCalendarItemDateKey(item);
      if (!key) {
        if (!item.isReminderOnly) undated.push(item);
        return;
      }
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(item);
      const at = item.remindAt?.at;
      if (at && at < now) overdue.push(item);
      else upcoming.push(item);
    });
    const byTime = (a, b) => String(a.remindAt?.time || '').localeCompare(String(b.remindAt?.time || ''));
    Object.values(byDate).forEach(list => list.sort(byTime));
    overdue.sort((a, b) => (a.remindAt?.at || 0) - (b.remindAt?.at || 0));
    upcoming.sort((a, b) => (a.remindAt?.at || 0) - (b.remindAt?.at || 0));
    return { byDate, undated, overdue, upcoming };
  }, [filteredItems]);

  const days = useMemoC(() => mnCalendarMonthDays(anchor, weekStart), [anchor, weekStart]);
  const selectedItems = grouped.byDate[selectedKey] || [];
  const weekLabels = weekStart === 'sunday'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const monthTitle = anchor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const selectedTitle = mnCalendarDateFromKey(selectedKey).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const moveMonth = delta => {
    const next = new Date(anchor);
    next.setMonth(anchor.getMonth() + delta, 1);
    setAnchor(next);
  };

  const selectToday = () => {
    const today = new Date();
    setAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedKey(todayKey);
  };

  const resolveSchedulePhrase = (value, fallbackDate, fallbackTime) => {
    const phrase = String(value || '').trim();
    if (!phrase) return { ok: true, date: fallbackDate, time: fallbackTime };
    const parsed = helpers.agendaParseScheduleInput?.(phrase);
    if (!parsed?.ok) {
      setScheduleError(parsed?.error || 'Unsupported schedule phrase.');
      return { ok: false };
    }
    setScheduleError('');
    return { ok: true, date: parsed.date, time: parsed.time || fallbackTime };
  };

  const applyCreateWhen = () => {
    const resolved = resolveSchedulePhrase(createWhen, createDate, createTime);
    if (!resolved.ok) return false;
    setCreateDate(resolved.date);
    setCreateTime(resolved.time || createTime);
    return true;
  };

  const applyDraftWhen = () => {
    const resolved = resolveSchedulePhrase(draftWhen, draftDate, draftTime);
    if (!resolved.ok) return false;
    setDraftDate(resolved.date);
    setDraftTime(resolved.time || draftTime);
    return true;
  };

  const addItem = () => {
    const text = createText.trim();
    if (!text || !createNoteId) return;
    const isReminder = createType === 'reminder';
    const resolved = resolveSchedulePhrase(createWhen, createDate, createTime);
    if (!resolved.ok) return;
    const result = onCreateItem?.({
      noteId: createNoteId,
      text,
      type: createType,
      date: resolved.date,
      time: isReminder ? resolved.time : '',
    });
    if (result !== false) {
      setCreateText('');
      setCreateWhen('');
      setCreateOpen(false);
    }
  };

  const openCreateForDate = (dateKey = selectedKey, type = 'reminder') => {
    const nextKey = dateKey || todayKey;
    setSelectedKey(nextKey);
    setCreateDate(nextKey);
    setCreateType(type);
    setCreateOpen(true);
    setActiveKey('');
  };

  const saveActive = () => {
    if (!activeItem || !draftText.trim()) return;
    const resolved = resolveSchedulePhrase(draftWhen, draftDate, draftTime);
    if (!resolved.ok) return;
    onUpdateItem?.(activeItem, {
      text: draftText.trim(),
      date: resolved.date,
      time: resolved.time,
    });
  };

  const clearActiveDate = () => {
    if (!activeItem) return;
    onUpdateItem?.(activeItem, {
      text: draftText.trim() || activeItem.label || activeItem.text || '',
      date: '',
      time: '',
    });
  };

  const pillBtn = (active) => ({
    height: DS_HEIGHT.toolbar,
    boxSizing: 'border-box',
    border: `1px solid ${active ? T.selLine : T.lineSub}`,
    background: active ? T.accentSoft : T.bg,
    color: active ? T.accent : T.inkMed,
    borderRadius: DS_RADIUS.control,
    padding: '0 11px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
    // Weight carries the selected state alongside the tint; an unselected
    // control has no reason to shout.
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  });

  const smallIconBtn = (active = false) => ({
    width: 28,
    height: 28,
    border: `1px solid ${active ? T.selLine : T.lineSub}`,
    background: active ? T.accentSoft : T.bg,
    color: active ? T.accent : T.inkMed,
    borderRadius: 6,
    fontFamily: 'var(--mn-ui)',
    fontSize: 15,
    fontWeight: 700,
    lineHeight: '26px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  // A month cell entry: a flat tinted chip carrying the time and the label.
  // The tone is the same three-way read the rail's card uses on its left edge.

  const itemCtx = { T, theme, tagHue, notes, helpers, activeKey, setActiveKey, onToggleCheck };

  const agendaList = (label, list, empty) => (
    <div style={{ marginTop: 16 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
        fontFamily: 'var(--mn-ui)', fontWeight: 600,
        fontSize: 11.5,
        color: T.inkDim,
      }}>
        <span>{label}</span>
        <span>{list.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {list.map(item => <MnItemCard key={item.key} item={item} ctx={itemCtx} />)}
        {!list.length && <div style={{ color: T.inkDim, fontSize: 12.5, fontStyle: 'italic', padding: '8px 2px' }}>{empty}</div>}
      </div>
    </div>
  );

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: '100%',
      overflow: 'hidden',
      background: T.bg,
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
    }}>
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* One header row: the month you are on, how to move, and what is
            actually pressing. The month name carries the date, so the panel
            title stays a plain label. A 52px bar like every other panel —
            this used to be a loose strip floating in a centred, inset page. */}
        <div style={{
          height: DS_HEIGHT.panelHeader,
          flexShrink: 0,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 20px',
          borderBottom: `1px solid ${T.lineSub}`,
        }}>
          <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>Agenda</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button onClick={() => moveMonth(-1)} aria-label="Previous month" title="Previous month" style={mnAgendaStepBtn(T)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M10 3L5 8L10 13" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span style={{ minWidth: 116, textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: T.ink }}>{monthTitle}</span>
            <button onClick={() => moveMonth(1)} aria-label="Next month" title="Next month" style={mnAgendaStepBtn(T)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M6 3L11 8L6 13" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <button onClick={selectToday} style={pillBtn(selectedKey === todayKey)}>Today</button>
          {/* A segmented control, not two loose pills — they are one choice.
              The second mode is "List": calling it Agenda inside the Agenda
              panel named the panel, not the view. */}
          <div style={{
            display: 'flex',
            padding: 2,
            borderRadius: DS_RADIUS.control,
            background: T.bgSub,
            border: `1px solid ${T.lineSub}`,
          }}>
            {[['month', 'Month'], ['agenda', 'List']].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                style={{
                  height: 24,
                  padding: '0 12px',
                  borderRadius: DS_RADIUS.icon,
                  border: `1px solid ${mode === value ? T.lineSub : 'transparent'}`,
                  background: mode === value ? T.bg : 'transparent',
                  color: mode === value ? T.ink : T.inkMed,
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12,
                  fontWeight: mode === value ? 600 : 400,
                  cursor: 'pointer',
                }}>{label}</button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: T.inkDim }}>
            {grouped.overdue.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.danger }} />
                {grouped.overdue.length} overdue
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent }} />
              {grouped.upcoming.length} scheduled
            </span>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          flexShrink: 0, padding: '10px 20px',
          borderBottom: `1px solid ${T.lineSub}`,
        }}>
          {[
            ['all', 'All'],
            ['overdue', 'Overdue'],
            ['today', 'Today'],
            ['upcoming', 'Upcoming'],
            ['unscheduled', 'Unscheduled'],
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilterStatus(value)} style={pillBtn(filterStatus === value)}>
              {label}
            </button>
          ))}
          <select aria-label="Filter Agenda by tag" value={filterTag} onChange={event => setFilterTag(event.target.value)} style={{ ...mnCalendarInput(T), width: 170 }}>
            <option value="">All tags</option>
            {tagOptions.map(tag => <option key={tag} value={tag}>#{tag}</option>)}
          </select>
          <select aria-label="Filter Agenda by source note" value={filterSourceId} onChange={event => setFilterSourceId(event.target.value)} style={{ ...mnCalendarInput(T), width: 210 }}>
            <option value="">All source notes</option>
            {sourceOptions.map(note => <option key={note.id} value={note.id}>{note.title || 'Untitled'}</option>)}
          </select>
          {(filterStatus !== 'all' || filterTag || filterSourceId) && (
            <button type="button" onClick={() => { setFilterStatus('all'); setFilterTag(''); setFilterSourceId(''); }} style={pillBtn(false)}>
              Clear filters
            </button>
          )}
        </div>

        <div style={{
          display: 'grid',
          // The day rail is a fixed column in both modes: the agenda list and
          // the month grid are two ways of choosing a day, and the rail is what
          // you chose.
          gridTemplateColumns: mode === 'month' ? 'minmax(0, 1fr) 340px' : 'minmax(0, 1fr)',
          gap: 0,
          // Full-bleed now, so both columns fill the row rather than sitting
          // content-height against the panel background.
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {/* No card and no second month title: the header bar already says
              which month this is, and the rail already says which day. */}
          {mode === 'month' && (
            <div style={{
              minWidth: 0,
              height: '100%',
              minHeight: 0,
              overflow: 'hidden',
              borderRight: `1px solid ${T.lineSub}`,
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: `1px solid ${T.lineSub}` }}>
                {weekLabels.map(label => (
                  <div key={label} style={{
                    padding: '8px 6px',
                    textAlign: 'center',
                    fontFamily: 'var(--mn-ui)', fontWeight: 600,
                    fontSize: 11,
                    color: T.inkDim,
                  }}>{label}</div>
                ))}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gridTemplateRows: 'repeat(6, minmax(86px, 1fr))',
                flex: 1,
                minHeight: 0,
              }}>
                {days.map((day, index) => {
                  const dayItems = grouped.byDate[day.key] || [];
                  const selected = day.key === selectedKey;
                  return (
                    <div
                      key={day.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedKey(day.key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedKey(day.key);
                        }
                      }}
                      style={{
                        minHeight: 0,
                        padding: 7,
                        borderRight: index % 7 === 6 ? 'none' : `1px solid ${T.lineSub}`,
                        borderBottom: index >= 35 ? 'none' : `1px solid ${T.lineSub}`,
                        background: selected
                          ? T.selBg
                          : day.today
                            ? `color-mix(in oklab, ${T.accent} 5%, ${T.bg})`
                            : day.inMonth ? T.bg : T.bgSub,
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: day.inMonth ? T.ink : T.inkDim,
                        overflow: 'hidden',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 5,
                        fontFamily: 'var(--mn-mono)',
                        fontSize: 10.5,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <span style={{
                            width: 22,
                            height: 22,
                            borderRadius: 5,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: day.today ? T.accent : selected ? T.bg : 'transparent',
                            color: day.today ? T.bg : 'inherit',
                            fontWeight: day.today || selected ? 700 : 500,
                          }}>{day.date.getDate()}</span>
                          {!!dayItems.length && <span style={{ color: T.inkDim }}>{dayItems.length}</span>}
                        </div>
                        {selected && (
                          <button
                            type="button"
                            title={`Add item on ${day.key}`}
                            aria-label={`Add item on ${day.key}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openCreateForDate(day.key);
                            }}
                            style={{
                              ...smallIconBtn(true),
                              width: 24,
                              height: 24,
                              lineHeight: '22px',
                              fontSize: 14,
                            }}>+</button>
                        )}
                      </div>
                      {/* A cell entry is a chip, not a card. A bordered card
                          with its own checkbox is the rail's job; in a 7-wide
                          grid it only has room to say when and what. */}
                      <div>
                        {dayItems.slice(0, selected ? 2 : 1).map((item, chipIndex) => (
                          <MnDayChip key={item.key} item={item} first={chipIndex === 0} onPick={setActiveKey} T={T} />
                        ))}
                        {dayItems.length > (selected ? 2 : 1) && (
                          <div style={{ marginTop: 3, fontSize: 11, color: T.inkDim, padding: '0 6px' }}>
                            +{dayItems.length - (selected ? 2 : 1)} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{
            borderLeft: mode === 'month' ? 'none' : `1px solid ${T.lineSub}`,
            background: T.bgSub,
            padding: '18px 16px 24px',
            minWidth: 0,
            height: '100%',
            minHeight: 0,
            overflow: 'auto',
            boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...DS_TYPE.sectionHead, fontSize: 20, color: T.ink }}>{mode === 'agenda' ? 'Agenda' : selectedTitle}</div>
                {mode !== 'agenda' && (
                  <div style={{ marginTop: 3, fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim }}>
                    {selectedItems.length} scheduled
                  </div>
                )}
              </div>
              <button
                onClick={() => openCreateForDate(selectedKey)}
                title="Add item to selected day"
                style={pillBtn(true)}
              >+ New</button>
            </div>

            {createOpen && (
              <div style={{
                marginTop: 12,
                padding: 12,
                border: `1px solid ${T.selLine}`,
                background: T.selBg,
                borderRadius: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: T.ink }}>
                    New item
                  </div>
                  <button
                    onClick={() => setCreateOpen(false)}
                    aria-label="Close add item"
                    title="Close"
                    style={smallIconBtn(false)}
                  >x</button>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setCreateType('todo')} style={pillBtn(createType === 'todo')}>Todo</button>
                    <button onClick={() => setCreateType('reminder')} style={pillBtn(createType === 'reminder')}>Reminder</button>
                  </div>
                  <input value={createText} onChange={e => setCreateText(e.target.value)} placeholder="Task or reminder text" style={mnCalendarInput(T)} />
                  <select value={createNoteId} onChange={e => setCreateNoteId(e.target.value)} style={mnCalendarInput(T)}>
                    {notes.map(note => <option key={note.id} value={note.id}>{note.title || 'Untitled'}</option>)}
                  </select>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                    <input aria-label="Schedule phrase" value={createWhen} onChange={e => setCreateWhen(e.target.value)} placeholder="When" style={mnCalendarInput(T)} />
                    <button type="button" onClick={applyCreateWhen} disabled={!createWhen.trim()} style={pillBtn(false)}>Apply</button>
                  </div>
                  {createType === 'reminder' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 8 }}>
                      <input type="date" value={createDate} onChange={e => setCreateDate(e.target.value)} style={mnCalendarInput(T)} />
                      <input type="time" value={createTime} onChange={e => setCreateTime(e.target.value)} style={mnCalendarInput(T)} />
                    </div>
                  )}
                  {scheduleError && <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.danger }}>{scheduleError}</div>}
                  <button onClick={addItem} disabled={!createText.trim() || !createNoteId} style={mnCalendarPrimaryButton(T, !createText.trim() || !createNoteId)}>Add</button>
                </div>
              </div>
            )}

            {agendaList(mode === 'agenda' ? 'Upcoming' : 'Selected day', mode === 'agenda' && !showAllUpcoming ? grouped.upcoming.slice(0, 12) : mode === 'agenda' ? grouped.upcoming : selectedItems, 'No scheduled items for this day')}
            {/* The header count says how many are scheduled, so the list must
                not silently stop at twelve of them. */}
            {mode === 'agenda' && grouped.upcoming.length > 12 && (
              <button
                type="button"
                onClick={() => setShowAllUpcoming(value => !value)}
                style={{ ...pillBtn(false), marginTop: 8 }}>
                {showAllUpcoming ? 'Show fewer' : `Show all ${grouped.upcoming.length}`}
              </button>
            )}
            {agendaList('Overdue', grouped.overdue, 'No overdue reminders')}
            {agendaList('Inbox todos', grouped.undated, 'No undated todos')}

            {activeItem && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.lineSub}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>Edit item</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <input value={draftText} onChange={e => setDraftText(e.target.value)} style={mnCalendarInput(T)} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                    <input aria-label="Edit schedule phrase" value={draftWhen} onChange={e => setDraftWhen(e.target.value)} placeholder="When" style={mnCalendarInput(T)} />
                    <button type="button" onClick={applyDraftWhen} disabled={!draftWhen.trim()} style={pillBtn(false)}>Apply</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 8 }}>
                    <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)} style={mnCalendarInput(T)} />
                    <input type="time" value={draftTime} onChange={e => setDraftTime(e.target.value)} style={mnCalendarInput(T)} />
                  </div>
                  {scheduleError && <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.danger }}>{scheduleError}</div>}
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    <button onClick={saveActive} disabled={!draftText.trim()} style={mnCalendarPrimaryButton(T, !draftText.trim())}>Save</button>
                    <button onClick={clearActiveDate} disabled={!activeItem.remindAt} style={pillBtn(false)}>Clear date</button>
                    {activeItem.remindAt && <button onClick={() => onSnoozeItem?.(activeItem, Number(snoozeMinutes || 15) || 15)} style={pillBtn(false)}>Snooze</button>}
                    {!activeItem.isReminderOnly && <button onClick={() => onToggleCheck?.(activeItem)} style={pillBtn(false)}>{activeItem.checked ? 'Reopen' : 'Complete'}</button>}
                    <button onClick={() => onOpen?.(activeItem.noteId)} style={pillBtn(false)}>Open note</button>
                  </div>
                  <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim }}>
                    Linked to {activeItem.noteTitle || 'Untitled'}.
                  </div>
                  {(() => {
                    const detail = activeItem.actionDetail || helpers.agendaActionDetail?.(activeItem, notes) || {};
                    const rows = [
                      ['Source', detail.sourceNoteTitle || activeItem.noteTitle || 'Untitled'],
                      ['Reason', detail.reason || 'from note'],
                      ['Scheduled', detail.scheduledDate ? `${detail.scheduledDate}${detail.scheduledTime ? ` ${detail.scheduledTime}` : ''}` : 'Unscheduled'],
                      ['Created/title', detail.createdDate || detail.titleDate || 'Unknown'],
                      ['Modified', detail.modifiedDate || 'Unknown'],
                      ['Tags', (detail.inheritedTags || []).length ? detail.inheritedTags.map(tag => `#${tag}`).join(' ') : 'None'],
                    ];
                    return (
                      <div style={{ display: 'grid', gap: 4, fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim }}>
                        {rows.map(([label, value]) => (
                          <div key={label} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: 8 }}>
                            <span>{label}</span>
                            <span style={{ ...dsMachineStyle(T), color: T.inkMed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { MnCalendarPanel };
