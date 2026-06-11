// Agenda panel for dated reminders and todo planning.

const { useEffect: useEffectC, useMemo: useMemoC, useState: useStateC } = React;

function mnCalendarDateKey(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function mnCalendarDateFromKey(key) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function mnCalendarMonthDays(anchor, weekStart = 'monday') {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  const startDay = weekStart === 'sunday' ? first.getDay() : (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - startDay);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      date: day,
      key: mnCalendarDateKey(day),
      inMonth: day.getMonth() === anchor.getMonth(),
      today: mnCalendarDateKey(day) === mnCalendarDateKey(new Date()),
    };
  });
}

function mnCalendarItemDateKey(item) {
  return item?.remindAt?.date || '';
}

function mnCalendarTimeText(item) {
  return item?.remindAt?.time || 'all day';
}

function mnCalendarIcon(kind, T) {
  if (kind === 'bell') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M4.5 7C4.5 4.8 5.8 3.2 8 3.2S11.5 4.8 11.5 7V9.5L13 11H3L4.5 9.5V7Z" />
        <path d="M6.8 12.2C7.1 13 7.5 13.3 8 13.3S8.9 13 9.2 12.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'calendar') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" />
        <path d="M5 2.5V5M11 2.5V5M2.5 7H13.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <span style={{
      width: 13,
      height: 13,
      borderRadius: 3,
      border: `1.5px solid ${T.line}`,
      display: 'inline-block',
      boxSizing: 'border-box',
    }} />
  );
}

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
  const helpers = window.MN_APP_HELPERS || {};

  useEffectC(() => {
    if (selectedNoteId) setCreateNoteId(selectedNoteId);
    else if (!createNoteId && notes[0]?.id) setCreateNoteId(notes[0].id);
  }, [selectedNoteId, notes, createNoteId]);

  useEffectC(() => {
    setCreateDate(selectedKey || todayKey);
  }, [selectedKey, todayKey]);

  const tagHue = useMemoC(() => {
    const map = {};
    tags.forEach(tag => { map[tag.name] = tag.hue; });
    return map;
  }, [tags]);

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
    tags.forEach(tag => { if (names.has(tag.name)) names.add(tag.name); });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [items, tags]);
  const activeItem = useMemoC(() => filteredItems.find(item => item.key === activeKey) || null, [filteredItems, activeKey]);

  useEffectC(() => {
    if (!activeItem) return;
    setDraftText(activeItem.label || activeItem.text || '');
    setDraftDate(activeItem.remindAt?.date || '');
    setDraftTime(activeItem.remindAt?.time || '');
    setDraftWhen('');
    setScheduleError('');
  }, [activeItem]);

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
    minHeight: 30,
    border: `1px solid ${active ? T.selLine : T.lineSub}`,
    background: active ? T.accentSoft : T.bg,
    color: active ? T.accent : T.inkMed,
    borderRadius: 7,
    padding: '0 10px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
    fontWeight: 650,
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

  const ItemCard = ({ item, compact = false }) => {
    const overdue = item.remindAt?.at && item.remindAt.at < new Date();
    const label = item.label || item.text || 'Reminder';
    const detail = item.actionDetail || helpers.agendaActionDetail?.(item, notes) || {};
    const detailTags = detail.inheritedTags || item.noteTags || [];
    const dateDetails = [
      detail.scheduledDate ? `scheduled ${detail.scheduledDate}${detail.scheduledTime ? ` ${detail.scheduledTime}` : ''}` : '',
      detail.createdDate ? `created ${detail.createdDate}` : detail.titleDate ? `title ${detail.titleDate}` : '',
      detail.modifiedDate ? `modified ${detail.modifiedDate}` : '',
    ].filter(Boolean);
    return (
      <div
        onClick={() => setActiveKey(item.key)}
        style={{
          border: `1px solid ${activeKey === item.key ? T.selLine : T.lineSub}`,
          background: activeKey === item.key ? T.selBg : T.bg,
          borderLeft: `3px solid ${item.isReminderOnly ? T.warn : overdue ? T.danger : T.accent}`,
          borderRadius: 7,
          padding: compact ? '7px 8px' : '9px 10px',
          cursor: 'pointer',
          minWidth: 0,
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          {item.isReminderOnly ? (
            <span style={{
              color: T.warn,
              flexShrink: 0,
              marginTop: 2,
              display: 'inline-flex',
            }}>
              {mnCalendarIcon('bell', T)}
            </span>
          ) : (
            <button
              type="button"
              aria-label={`${item.checked ? 'Reopen' : 'Complete'} ${label}`}
              title={item.checked ? 'Reopen todo' : 'Complete todo'}
              onClick={(event) => {
                event.stopPropagation();
                onToggleCheck?.(item);
              }}
              style={{
                width: 15,
                height: 15,
                marginTop: 2,
                flexShrink: 0,
                border: `1.5px solid ${item.checked ? T.accent : T.line}`,
                background: item.checked ? T.accent : 'transparent',
                borderRadius: 4,
                cursor: 'pointer',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {item.checked && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: compact ? 12.5 : 13.5,
              lineHeight: 1.35,
              color: item.checked ? T.inkDim : T.ink,
              textDecoration: item.checked ? 'line-through' : 'none',
              whiteSpace: compact ? 'nowrap' : 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{label}</div>
            {!compact && (
              <div style={{
                marginTop: 5,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                flexWrap: 'wrap',
                color: T.inkDim,
                fontFamily: 'var(--mn-mono)',
                fontSize: 10,
              }}>
                <span style={{ color: T.inkMed }}>{detail.sourceNoteTitle || item.noteTitle}</span>
                {detail.reason && <span style={{ color: overdue ? T.danger : T.accent }}>{detail.reason}</span>}
                {item.remindAt && <span style={{ color: overdue ? T.danger : T.warn }}>{mnCalendarTimeText(item)}</span>}
                {detailTags.slice(0, 3).map(tag => (
                  <span key={tag} style={{ color: mnGetTagColor(tagHue[tag] ?? 240, theme) }}>#{tag}</span>
                ))}
                {dateDetails.slice(0, 2).map(text => <span key={text}>{text}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const agendaList = (label, list, empty) => (
    <div style={{ marginTop: 16 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
        fontFamily: 'var(--mn-mono)',
        fontSize: 10.5,
        color: T.inkDim,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        <span>{label}</span>
        <span>{list.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {list.map(item => <ItemCard key={item.key} item={item} />)}
        {!list.length && <div style={{ color: T.inkDim, fontSize: 12.5, fontStyle: 'italic', padding: '8px 2px' }}>{empty}</div>}
      </div>
    </div>
  );

  return (
    <div style={{
      flex: 1,
      height: '100%',
      overflow: 'hidden',
      background: `linear-gradient(180deg, ${T.bgElevated || T.bg} 0%, ${T.bg} 28%)`,
      padding: '28px max(58px, clamp(18px, 3vw, 34px)) 22px clamp(18px, 3vw, 34px)',
      boxSizing: 'border-box',
    }}>
      <div style={{
        maxWidth: 1280,
        height: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ color: T.accent, display: 'inline-flex' }}>{mnCalendarIcon('calendar', T)}</span>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 24, fontWeight: 720, color: T.ink, letterSpacing: 0 }}>Agenda</div>
            </div>
            <div style={{ marginTop: 4, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, letterSpacing: '0.06em' }}>
              {grouped.upcoming.length} scheduled · {grouped.undated.length} inbox todo{grouped.undated.length === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <button onClick={() => moveMonth(-1)} title="Previous month" style={pillBtn(false)}>Prev</button>
            <button onClick={selectToday} style={pillBtn(selectedKey === todayKey)}>Today</button>
            <button onClick={() => moveMonth(1)} title="Next month" style={pillBtn(false)}>Next</button>
            <button onClick={() => setMode('month')} style={pillBtn(mode === 'month')}>Month</button>
            <button onClick={() => setMode('agenda')} style={pillBtn(mode === 'agenda')}>Agenda</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
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
          gridTemplateColumns: mode === 'agenda' ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(300px, 380px)',
          gap: 14,
          alignItems: 'start',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {mode === 'month' && (
            <div style={{
              border: `1px solid ${T.lineSub}`,
              background: T.bg,
              borderRadius: 8,
              overflow: 'hidden',
              minWidth: 0,
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderBottom: `1px solid ${T.lineSub}`,
                background: T.bgSub,
              }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: T.ink }}>{monthTitle}</div>
                <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{selectedTitle}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: `1px solid ${T.lineSub}` }}>
                {weekLabels.map(label => (
                  <div key={label} style={{
                    padding: '8px 6px',
                    textAlign: 'center',
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10,
                    color: T.inkDim,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {dayItems.slice(0, 2).map(item => <ItemCard key={item.key} item={item} compact />)}
                        {dayItems.length > 2 && (
                          <div style={{ fontSize: 11, color: T.inkDim, padding: '2px 4px' }}>+{dayItems.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{
            border: `1px solid ${T.lineSub}`,
            background: T.bg,
            borderRadius: 8,
            padding: 14,
            minWidth: 0,
            height: '100%',
            minHeight: 0,
            overflow: 'auto',
            boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{mode === 'agenda' ? 'Agenda' : selectedTitle}</div>
                {mode !== 'agenda' && (
                  <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
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
                  {scheduleError && <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.danger }}>{scheduleError}</div>}
                  <button onClick={addItem} disabled={!createText.trim() || !createNoteId} style={mnCalendarPrimaryButton(T, !createText.trim() || !createNoteId)}>Add</button>
                </div>
              </div>
            )}

            {agendaList(mode === 'agenda' ? 'Upcoming' : 'Selected day', mode === 'agenda' ? grouped.upcoming.slice(0, 12) : selectedItems, 'No scheduled items for this day')}
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
                  {scheduleError && <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.danger }}>{scheduleError}</div>}
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    <button onClick={saveActive} disabled={!draftText.trim()} style={mnCalendarPrimaryButton(T, !draftText.trim())}>Save</button>
                    <button onClick={clearActiveDate} disabled={!activeItem.remindAt} style={pillBtn(false)}>Clear date</button>
                    {activeItem.remindAt && <button onClick={() => onSnoozeItem?.(activeItem, Number(snoozeMinutes || 15) || 15)} style={pillBtn(false)}>Snooze</button>}
                    {!activeItem.isReminderOnly && <button onClick={() => onToggleCheck?.(activeItem)} style={pillBtn(false)}>{activeItem.checked ? 'Reopen' : 'Complete'}</button>}
                    <button onClick={() => onOpen?.(activeItem.noteId)} style={pillBtn(false)}>Open note</button>
                  </div>
                  <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
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
                      <div style={{ display: 'grid', gap: 4, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                        {rows.map(([label, value]) => (
                          <div key={label} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: 8 }}>
                            <span>{label}</span>
                            <span style={{ color: T.inkMed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
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

function mnCalendarInput(T) {
  return {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: `1px solid ${T.lineSub}`,
    borderRadius: 7,
    background: T.bgSub,
    color: T.ink,
    padding: '8px 9px',
    outline: 'none',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
  };
}

function mnCalendarPrimaryButton(T, disabled) {
  return {
    minHeight: 32,
    border: `1px solid ${disabled ? T.lineSub : T.ink}`,
    background: disabled ? T.bgSub : T.ink,
    color: disabled ? T.inkDim : T.bg,
    borderRadius: 7,
    padding: '0 12px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
  };
}

window.MnCalendarPanel = MnCalendarPanel;
