// The state behind the Views calendar's planning strip.
//
// It holds which day is picked, which row is being edited, and the two drafts
// (the new item, and the changes to an existing one). It does no writing of its
// own: `onCreateItem`, `onCreateNote` and `onWriteRow` arrive from the panel,
// which is the only layer that knows how to turn a view row back into a line in
// a note. That keeps this file testable and keeps the panel a shell.
//
// The edit draft is keyed on *which* row is selected, never on the row object.
// Decorated rows are rebuilt whenever any note changes in the background — an
// autosave, a checkbox ticked elsewhere — so keying on identity wiped whatever
// you were part-way through typing. The agenda learned this the hard way.

import { mnCalendarDateKey } from '../../panels/calendarDates.js';
import { mnViewsRowKey } from './viewsOrder.js';
import { MN_VIEWS_NEW_NOTE } from './ViewsCalendarEditor.jsx';

const { useEffect: useEffectVP, useMemo: useMemoVP, useState: useStateVP } = React;

function mnViewsClockKey(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function useViewsPlanner({
  rows = [], notes = [], selectedNoteId = '', helpers = {}, snoozeMinutes = 15,
  onCreateItem, onCreateNote, onWriteRow, onRenameRow, onNotice,
} = {}) {
  const todayKey = mnCalendarDateKey(new Date());
  const [selectedKey, setSelectedKey] = useStateVP(todayKey);
  const [activeKey, setActiveKey] = useStateVP('');
  const [createOpen, setCreateOpen] = useStateVP(false);
  const [createType, setCreateType] = useStateVP('todo');
  const [createText, setCreateText] = useStateVP('');
  const [createNoteId, setCreateNoteId] = useStateVP(selectedNoteId || '');
  const [createDate, setCreateDate] = useStateVP(todayKey);
  const [createTime, setCreateTime] = useStateVP('09:00');
  const [createWhen, setCreateWhen] = useStateVP('');
  const [draftText, setDraftText] = useStateVP('');
  const [draftDate, setDraftDate] = useStateVP('');
  const [draftTime, setDraftTime] = useStateVP('');
  const [draftWhen, setDraftWhen] = useStateVP('');
  const [error, setError] = useStateVP('');
  // An item bound for a note that was made a moment ago and is not in `notes`
  // yet — see the effect below for why it cannot be written in the same tick.
  const [pendingItem, setPendingItem] = useStateVP(null);

  const enabled = Boolean(onCreateItem || onWriteRow);
  const noteOptions = useMemoVP(
    () => (notes || []).map(note => ({ id: note.id, title: note.title || 'Untitled' })),
    [notes]
  );
  const activeRow = useMemoVP(
    () => (activeKey ? (rows || []).find(row => mnViewsRowKey(row) === activeKey) || null : null),
    [rows, activeKey]
  );

  useEffectVP(() => {
    if (!createNoteId && noteOptions.length) setCreateNoteId(selectedNoteId || noteOptions[0].id);
  }, [createNoteId, noteOptions, selectedNoteId]);

  // A note made by "New note for this item" is not in `notes` until the next
  // render, and the app's write actions look a note up in the list they were
  // built with — a write in the same tick found nothing, returned false, and
  // the item silently never landed. So the item waits here and is written the
  // moment the note is real.
  useEffectVP(() => {
    if (!pendingItem) return;
    if (!(notes || []).some(note => note.id === pendingItem.noteId)) return;
    setPendingItem(null);
    if (onCreateItem?.(pendingItem) === false) {
      onNotice?.('That item was not added', 'The note it was headed for did not take it. Open the note and add the line there.', 'warn');
    }
  }, [pendingItem, notes]);

  useEffectVP(() => {
    if (!activeKey) return;
    const row = (rows || []).find(item => mnViewsRowKey(item) === activeKey);
    if (!row) return;
    setDraftText(row.label || row.title || '');
    setDraftDate(row.remindAt?.date || row.reminderDate || '');
    setDraftTime(row.remindAt?.time || '');
    setDraftWhen('');
    setError('');
    // Keyed on the selection, not the row: see the note at the top of the file.
  }, [activeKey]);

  // "tomorrow 9am" and friends. A phrase the parser refuses is reported in the
  // form rather than silently ignored, because the date boxes below it would
  // otherwise look like they had accepted it.
  const resolvePhrase = (value, fallbackDate, fallbackTime) => {
    const phrase = String(value || '').trim();
    if (!phrase) return { ok: true, date: fallbackDate, time: fallbackTime };
    const parsed = helpers.agendaParseScheduleInput?.(phrase);
    if (!parsed?.ok) {
      setError(parsed?.error || 'That is not a date this app knows how to read.');
      return { ok: false };
    }
    setError('');
    return { ok: true, date: parsed.date, time: parsed.time || fallbackTime };
  };

  const applyCreateWhen = () => {
    const resolved = resolvePhrase(createWhen, createDate, createTime);
    if (!resolved.ok) return;
    setCreateDate(resolved.date);
    setCreateTime(resolved.time || createTime);
    setCreateWhen('');
  };

  const applyDraftWhen = () => {
    const resolved = resolvePhrase(draftWhen, draftDate, draftTime);
    if (!resolved.ok) return;
    setDraftDate(resolved.date);
    setDraftTime(resolved.time || draftTime);
    setDraftWhen('');
  };

  const openCreate = (dayKey) => {
    const key = dayKey || selectedKey || todayKey;
    setSelectedKey(key);
    setCreateDate(key);
    setCreateOpen(true);
    setActiveKey('');
    setError('');
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setError('');
  };

  const submitCreate = () => {
    const text = createText.trim();
    if (!text) return;
    const resolved = resolvePhrase(createWhen, createDate, createTime);
    if (!resolved.ok) return;
    const item = {
      noteId: createNoteId,
      text,
      type: createType,
      date: resolved.date,
      time: createType === 'reminder' ? (resolved.time || createTime) : '',
    };
    // A brand-new note is made first, so the item has somewhere to land. If
    // that fails there is nothing to write to and we stop rather than dropping
    // the item into whichever note happened to be selected. The item itself is
    // deferred to the effect above: the note is not in `notes` yet, and a
    // write in the same tick would be asked of a list that cannot hold it.
    if (createNoteId === MN_VIEWS_NEW_NOTE) {
      const noteId = onCreateNote?.({ title: text, body: '' }) || '';
      if (!noteId) {
        onNotice?.('That note could not be made', 'This window has no way to create notes, so there is nowhere to put the item.', 'warn');
        return;
      }
      setCreateNoteId(noteId);
      setPendingItem({ ...item, noteId });
      setCreateText('');
      setCreateWhen('');
      setCreateOpen(false);
      return;
    }
    if (!item.noteId) {
      onNotice?.('That item needs a note', 'Pick the note this item should live in, or make a new one.', 'warn');
      return;
    }
    if (onCreateItem?.(item) === false) {
      onNotice?.('That item was not added', 'The note already has a line saying exactly this, so nothing was written. Change the wording or open the note.', 'warn');
      return;
    }
    setCreateText('');
    setCreateWhen('');
    setCreateOpen(false);
  };

  const write = (patch) => {
    if (!activeRow) return;
    const ok = onWriteRow?.(activeRow, patch);
    if (ok === false) return;
    setError('');
  };

  // A note row is the note itself, not a line inside one: the only thing to
  // save is its title, and that goes through the app rename so every
  // [[wiki link]] pointing at the old name follows. Its date is the file's
  // own modified time, which no form can write — the editor hides those
  // controls for note rows, and every path here routes around the line-write
  // that would otherwise refuse with a sentence about a line that never was.
  const activeIsNote = activeRow?.type === 'note';

  const saveActive = () => {
    const text = draftText.trim();
    if (!text) return;
    if (activeIsNote) {
      if (onRenameRow?.(activeRow, text) !== false) setError('');
      return;
    }
    const resolved = resolvePhrase(draftWhen, draftDate, draftTime);
    if (!resolved.ok) return;
    write({ text, date: resolved.date, time: resolved.time });
  };

  const clearActiveDate = () => write({ text: draftText.trim() || activeRow?.label || '', date: '', time: '' });
  const toggleActive = () => write({ checked: !activeRow?.checked });
  const snoozeActive = () => {
    const minutes = Math.max(1, Number(snoozeMinutes) || 15);
    const next = new Date(Date.now() + minutes * 60 * 1000);
    write({ text: draftText.trim() || activeRow?.label || '', date: mnCalendarDateKey(next), time: mnViewsClockKey(next) });
  };

  return {
    enabled, todayKey, selectedKey, setSelectedKey, activeKey, setActiveKey, activeRow, activeIsNote,
    createOpen, openCreate, closeCreate, createType, setCreateType,
    createText, setCreateText, createNoteId, setCreateNoteId,
    createDate, setCreateDate, createTime, setCreateTime,
    createWhen, setCreateWhen, applyCreateWhen, submitCreate, noteOptions,
    draftText, setDraftText, draftDate, setDraftDate, draftTime, setDraftTime,
    draftWhen, setDraftWhen, applyDraftWhen,
    saveActive, clearActiveDate, toggleActive, snoozeActive,
    canSnooze: Boolean(!activeIsNote && (activeRow?.remindAt || draftDate)),
    snoozeMinutes: Math.max(1, Number(snoozeMinutes) || 15),
    error,
  };
}

export { useViewsPlanner, mnViewsClockKey };
