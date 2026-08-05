function createRollupHelpers(scope = {}) {
  const agendaIsDeferred = (...args) => scope.agendaIsDeferred(...args);
  const rollupDateKey = (...args) => scope.rollupDateKey(...args);
  const rollupDateKeyInRange = (...args) => scope.rollupDateKeyInRange(...args);
  const rollupDateRangeBounds = (...args) => scope.rollupDateRangeBounds(...args);
  const rollupIsValidIsoDateKey = (...args) => scope.rollupIsValidIsoDateKey(...args);
  const rollupNormalizeGroupBy = (...args) => scope.rollupNormalizeGroupBy(...args);
  const rollupNormalizeRange = (...args) => scope.rollupNormalizeRange(...args);
  const rollupNoteDateKey = (...args) => scope.rollupNoteDateKey(...args);
  const rollupNoteSortTime = (...args) => scope.rollupNoteSortTime(...args);
  const rollupShiftDateKey = (...args) => scope.rollupShiftDateKey(...args);
  const rollupTitleDateKey = (...args) => scope.rollupTitleDateKey(...args);
  const todayIsoDate = (...args) => scope.todayIsoDate(...args);
  function rollupIsOlderGroup(dateKey, now = new Date()) {
    const yesterday = rollupDateRangeBounds('yesterday', now).start;
    return rollupIsValidIsoDateKey(dateKey) && dateKey < yesterday;
  }
  
  function rollupGroupNotes(notes = [], options = {}) {
    const range = rollupNormalizeRange(options.range);
    const groupBy = rollupNormalizeGroupBy(options.groupBy);
    const now = options.now || new Date();
    const weekStart = options.weekStart || 'monday';
    const groups = new Map();
    (notes || []).forEach(note => {
      const key = rollupNoteDateKey(note, groupBy);
      if (!rollupDateKeyInRange(key, range, now, weekStart)) return;
      if (!groups.has(key)) {
        groups.set(key, { key, date: new Date(`${key}T12:00:00`), notes: [] });
      }
      groups.get(key).notes.push(note);
    });
    return Array.from(groups.values())
      .map(group => ({
        ...group,
        isOlder: rollupIsOlderGroup(group.key, now),
        notes: group.notes.sort((a, b) => rollupNoteSortTime(b, groupBy) - rollupNoteSortTime(a, groupBy)),
      }))
      .sort((a, b) => String(b.key).localeCompare(String(a.key)));
  }
  
  function rollupPreviewLine(line = '') {
    return String(line || '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/[`*_>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  function rollupNotePreview(note, maxLines = 2) {
    return String(note?.body || '')
      .split('\n')
      .map(rollupPreviewLine)
      .filter(Boolean)
      .slice(0, Math.max(1, Number(maxLines) || 2))
      .join(' · ');
  }
  
  function rollupFilterTaskItems(items = [], notes = [], options = {}) {
    const noteById = new Map((notes || []).map(note => [note.id, note]));
    const range = rollupNormalizeRange(options.range);
    const groupBy = rollupNormalizeGroupBy(options.groupBy);
    const now = options.now || new Date();
    const weekStart = options.weekStart || 'monday';
    return (items || [])
      .filter(item => {
        // The emptiness check has to come first: agendaIsDeferred reads the
        // item's own fields, so testing it before this guard threw on a null
        // entry rather than skipping it.
        if (!item || item.checked || item.isReminderOnly || item.type === 'reminder') return false;
        if (agendaIsDeferred(item, now)) return false;
        const note = noteById.get(item.noteId) || { date: item.noteDate, title: item.noteTitle };
        const key = rollupNoteDateKey(note, groupBy) || rollupDateKey(item.noteDate);
        return rollupDateKeyInRange(key, range, now, weekStart);
      })
      .sort((a, b) => String(a.noteTitle || '').localeCompare(String(b.noteTitle || '')) || String(a.label || a.text || '').localeCompare(String(b.label || b.text || '')));
  }
  
  function rollupReminderDateKey(item) {
    return rollupIsValidIsoDateKey(item?.remindAt?.date)
      ? item.remindAt.date
      : rollupDateKey(item?.remindAt?.at);
  }
  
  function rollupMonthEndDateKey(dateKey) {
    const [year, month] = String(dateKey || '').split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return dateKey;
    // Day 0 of the next month is the last day of this one.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  // A note range looks backwards: a note was created or edited in the past, so
  // it ends at today. A reminder's date is a DUE date, so its range has to look
  // forward instead. Reusing the note bounds meant every reminder dated later
  // than today was computed as "upcoming" and then filtered straight back out,
  // so no range could ever contain tomorrow.
  function rollupReminderRangeBounds(range = 'today', now = new Date(), weekStart = 'monday') {
    const bounds = rollupDateRangeBounds(range, now, weekStart);
    const normalized = rollupNormalizeRange(range);
    if (normalized === 'week') return { ...bounds, end: rollupShiftDateKey(bounds.start, 6) };
    if (normalized === 'month') return { ...bounds, end: rollupMonthEndDateKey(bounds.today) };
    return bounds;
  }

  function rollupFilterReminderItems(items = [], _notes = [], options = {}) {
    const range = rollupNormalizeRange(options.range);
    const now = options.now || new Date();
    const weekStart = options.weekStart || 'monday';
    const bounds = rollupReminderRangeBounds(range, now, weekStart);
    const today = bounds.today;
    return (items || [])
      .map(item => {
        const key = rollupReminderDateKey(item);
        const status = key < today ? 'overdue' : key === today ? 'due-today' : 'upcoming';
        return { ...item, rollupDateKey: key, rollupStatus: status };
      })
      .filter(item => {
        if (agendaIsDeferred(item, now)) return false;
        if (!rollupIsValidIsoDateKey(item.rollupDateKey)) return false;
        // An overdue reminder always shows, whatever range was asked for.
        return item.rollupDateKey < today
          || (item.rollupDateKey >= bounds.start && item.rollupDateKey <= bounds.end);
      })
      .sort((a, b) => String(a.rollupDateKey).localeCompare(String(b.rollupDateKey)) || ((a.remindAt?.at || 0) - (b.remindAt?.at || 0)));
  }
  
  function rollupFindDailyNote(notes = [], now = new Date()) {
    const key = todayIsoDate(now);
    return (notes || []).find(note => String(note?.title || '').trim() === key) || null;
  }
  
  function rollupTaskReasonLabel(item = {}, note = null, now = new Date()) {
    const today = todayIsoDate(now);
    const noteTitle = String(note?.title || item.noteTitle || '').trim();
    const noteDate = rollupDateKey(note?.date || item.noteDate);
    const noteModified = rollupDateKey(note?.modifiedAt);
    if (noteTitle === today && !item.remindAt) return 'unscheduled daily task';
    if (noteTitle === today) return "from today's daily note";
    if (noteDate === today) return 'captured today';
    if (noteModified === today) return 'modified today';
    if (!note) return 'source note';
    return 'from note';
  }
  
  function rollupReminderReasonLabel(item = {}) {
    if (item.rollupStatus === 'overdue') return 'overdue';
    if (item.rollupStatus === 'due-today') return 'due today';
    if (item.rollupStatus === 'upcoming') return 'upcoming';
    const key = rollupReminderDateKey(item);
    const today = todayIsoDate();
    if (key && key < today) return 'overdue';
    if (key === today) return 'due today';
    return 'upcoming';
  }
  
  function agendaActionStatus(item = {}, now = new Date()) {
    if (item.checked) return 'completed';
    if (agendaIsDeferred(item, now)) return 'deferred';
    const key = rollupReminderDateKey(item);
    const today = todayIsoDate(now);
    if (!key) return 'unscheduled';
    if (key < today) return 'overdue';
    if (key === today) return 'today';
    return 'upcoming';
  }
  
  function agendaActionReasonLabel(item = {}, note = null, now = new Date()) {
    const status = agendaActionStatus(item, now);
    if (status === 'completed') return 'completed';
    if (status === 'unscheduled') return rollupTaskReasonLabel(item, note, now);
    if (status === 'overdue') return 'overdue';
    if (status === 'today') return item.isReminderOnly ? 'due today' : 'scheduled today';
    return 'upcoming';
  }
  
  // options.noteById lets a caller decorating many items build the lookup once.
  // Without it this rebuilt a Map of the whole vault for every single item,
  // which made decorating an agenda O(items x notes).
  function agendaActionDetail(item = {}, notes = [], options = {}) {
    const noteById = options.noteById || new Map((notes || []).map(note => [note.id, note]));
    const note = noteById.get(item.noteId) || null;
    const status = agendaActionStatus(item, options.now || new Date());
    const tags = Array.from(new Set([
      ...((Array.isArray(note?.tags) ? note.tags : [])),
      ...((Array.isArray(item.noteTags) ? item.noteTags : [])),
    ].map(tag => String(tag || '').trim()).filter(Boolean)));
    const scheduledDate = rollupReminderDateKey(item);
    return {
      status,
      reason: agendaActionReasonLabel(item, note, options.now || new Date()),
      sourceNoteId: item.noteId || note?.id || '',
      sourceNoteTitle: note?.title || item.noteTitle || 'Untitled',
      titleDate: note ? rollupTitleDateKey(note) : rollupTitleDateKey({ title: item.noteTitle }),
      createdDate: rollupDateKey(note?.date || item.noteDate),
      modifiedDate: rollupDateKey(note?.modifiedAt || item.noteModifiedAt),
      scheduledDate,
      scheduledTime: item.remindAt?.time || '',
      deferUntil: item.deferUntil || '',
      inheritedTags: tags,
    };
  }
  
  function agendaDecorateActionItems(items = [], notes = [], options = {}) {
    const noteById = options.noteById || new Map((notes || []).map(note => [note.id, note]));
    const shared = { ...options, noteById };
    return (items || []).map(item => {
      const detail = agendaActionDetail(item, notes, shared);
      return { ...item, actionStatus: detail.status, actionDetail: detail };
    });
  }
  
  function agendaFilterActionItems(items = [], notes = [], filters = {}, options = {}) {
    const status = String(filters.status || 'all');
    const tag = String(filters.tag || '').trim();
    const sourceNoteId = String(filters.sourceNoteId || '').trim();
    return agendaDecorateActionItems(items, notes, options).filter(item => {
      const detail = item.actionDetail || {};
      if (detail.status === 'deferred' && status !== 'deferred') return false;
      if (status !== 'all' && detail.status !== status) return false;
      if (tag && !(detail.inheritedTags || []).includes(tag)) return false;
      if (sourceNoteId && detail.sourceNoteId !== sourceNoteId) return false;
      return true;
    });
  }
  
  function agendaLocalDateKey(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  
  function agendaLocalTimeKey(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  
  function agendaAddDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }
  
  function agendaParseClock(value = '') {
    const match = String(value || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!match) return '';
    let hour = Number(match[1]);
    const minute = match[2] == null ? 0 : Number(match[2]);
    const suffix = match[3] || '';
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return '';
    if (suffix) {
      if (hour < 1 || hour > 12) return '';
      if (suffix === 'pm' && hour !== 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
    } else if (hour > 23) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  
  function agendaParseScheduleInput(value = '', options = {}) {
    const raw = String(value || '').trim();
    if (!raw) return { ok: false, error: 'Enter a schedule phrase.' };
    const input = raw.toLowerCase().replace(/[,.]+$/g, '').replace(/\s+/g, ' ');
    const now = new Date(options.now || new Date());
    if (Number.isNaN(now.getTime())) return { ok: false, error: 'Invalid reference time.' };
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const make = (date, time = '') => ({ ok: true, date: agendaLocalDateKey(date), time, raw });
  
    if (input === 'today') return make(now);
    if (input === 'tomorrow') return make(agendaAddDays(now, 1));
  
    const hours = input.match(/^in\s+(\d{1,2})\s+hours?$/);
    if (hours) {
      const amount = Number(hours[1]);
      if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'Use a positive hour count.' };
      const next = new Date(now);
      next.setHours(next.getHours() + amount);
      return make(next, agendaLocalTimeKey(next));
    }
  
    const dayMatch = input.match(/^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(.+))?$/);
    if (dayMatch) {
      const forceNext = !!dayMatch[1];
      const targetDay = dayNames.indexOf(dayMatch[2]);
      let offset = (targetDay - now.getDay() + 7) % 7;
      if (forceNext || offset === 0) offset = offset || 7;
      const date = agendaAddDays(now, offset);
      const time = dayMatch[3] ? agendaParseClock(dayMatch[3]) : '';
      if (dayMatch[3] && !time) return { ok: false, error: 'Use a valid time.' };
      return make(date, time);
    }
  
    return { ok: false, error: 'Unsupported schedule phrase.' };
  }
  
  function rollupQuickTaskLine(text = '') {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean ? `- [ ] ${clean}` : '';
  }
  
  function rollupAppendQuickTask(body = '', text = '') {
    const taskLine = rollupQuickTaskLine(text);
    const source = String(body || '');
    if (!taskLine) return source;
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const headingIndex = lines.findIndex(line => /^#{2,6}\s+Tasks\s*$/i.test(String(line || '').trim()));
    if (headingIndex >= 0) {
      for (let i = headingIndex + 1; i < lines.length; i += 1) {
        if (/^\s*-\s+\[\s\]\s*$/.test(lines[i])) {
          lines[i] = taskLine;
          return `${lines.join('\n').replace(/\s+$/g, '')}\n`;
        }
        if (/^#{1,6}\s+\S/.test(String(lines[i] || '').trim())) break;
      }
      let insertAt = headingIndex + 1;
      while (insertAt < lines.length && !/^#{1,6}\s+\S/.test(String(lines[insertAt] || '').trim())) {
        insertAt += 1;
      }
      if (insertAt > headingIndex + 1 && String(lines[insertAt - 1] || '').trim() === '') insertAt -= 1;
      lines.splice(insertAt, 0, taskLine);
      return `${lines.join('\n').replace(/\s+$/g, '')}\n`;
    }
    const trimmed = source.replace(/\s+$/g, '');
    return `${trimmed}${trimmed ? '\n' : ''}${taskLine}\n`;
  }
  
  function rollupAppendMarkdownSection(body = '', section = '') {
    const cleanSection = String(section || '').replace(/\s+$/g, '');
    if (!cleanSection) return String(body || '');
    const trimmed = String(body || '').replace(/\s+$/g, '');
    return `${trimmed}${trimmed ? '\n\n' : ''}${cleanSection}\n`;
  }
  
  function rollupAppendReflection(body = '', options = {}) {
    const date = todayIsoDate(options.now || new Date());
    return rollupAppendMarkdownSection(body, [
      `## Reflection - ${date}`,
      '',
      '- What stood out:',
      '- What I learned:',
      '- What to improve:',
    ].join('\n'));
  }
  
  function rollupItemLabel(item = {}) {
    return String(item.label || item.text || item.noteTitle || 'Untitled').replace(/\s+/g, ' ').trim();
  }
  
  function rollupSourceLine(item = {}) {
    const title = String(item.noteTitle || 'Untitled').replace(/\s+/g, ' ').trim();
    const label = rollupItemLabel(item);
    return label ? `- [ ] ${label} (${title})` : `- [ ] ${title}`;
  }
  
  function rollupNoteLine(note = {}) {
    const title = String(note.title || 'Untitled').replace(/\s+/g, ' ').trim();
    const preview = rollupNotePreview(note, 1);
    return preview ? `- [[${title}]]: ${preview}` : `- [[${title}]]`;
  }
  
  function rollupDecisionLines(notes = [], now = new Date(), limit = 5) {
    const today = todayIsoDate(now);
    const lines = [];
    (notes || []).forEach(note => {
      const noteTitle = String(note?.title || 'Untitled').replace(/\s+/g, ' ').trim();
      String(note?.body || '').split('\n').forEach(line => {
        const clean = rollupPreviewLine(line);
        if (!clean || !/\bdecision\b/i.test(clean)) return;
        lines.push(`- [[${noteTitle}]]: ${clean}`);
      });
    });
    if (lines.length) return lines.slice(0, limit);
    return [`- Review notes from ${today} for decisions to keep.`];
  }
  return { rollupIsOlderGroup, rollupGroupNotes, rollupPreviewLine, rollupNotePreview, rollupFilterTaskItems, rollupReminderDateKey, rollupMonthEndDateKey, rollupReminderRangeBounds, rollupFilterReminderItems, rollupFindDailyNote, rollupTaskReasonLabel, rollupReminderReasonLabel, agendaActionStatus, agendaActionReasonLabel, agendaActionDetail, agendaDecorateActionItems, agendaFilterActionItems, agendaLocalDateKey, agendaLocalTimeKey, agendaAddDays, agendaParseClock, agendaParseScheduleInput, rollupQuickTaskLine, rollupAppendQuickTask, rollupAppendMarkdownSection, rollupAppendReflection, rollupItemLabel, rollupSourceLine, rollupNoteLine, rollupDecisionLines };
}

module.exports = { createRollupHelpers };
