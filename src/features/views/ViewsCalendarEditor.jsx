// The planning strip under the Views calendar.
//
// Everything the agenda lets you do to a dated item, done from a view: add a
// todo or a reminder to the day you picked, retype it, move it, tick it off,
// snooze it, or open the note it lives in. The controls are the agenda's own
// (`mnCalendarInput`, `mnCalendarPrimaryButton`) so the two surfaces are the
// same instrument rather than two dialects of one.
//
// It writes through the same actions the agenda writes through, which is why a
// todo added here is a `- [ ]` line in a real note rather than a record in some
// calendar of its own — a view has nowhere of its own to keep anything.
//
// State lives in useViewsPlanner; this file is the form for it.

import { DS_RADIUS, dsGroupLabelStyle, dsMachineStyle } from '../../shared/designSystem.js';
import { mnCalendarInput, mnCalendarPrimaryButton } from '../../panels/calendarChrome.jsx';

const MN_VIEWS_NEW_NOTE = '__mn_views_new_note';

function pillButton(T, active) {
  return {
    height: 28, boxSizing: 'border-box', padding: '0 11px',
    border: `1px solid ${active ? T.selLine : T.lineSub}`,
    background: active ? T.accentSoft : T.bg,
    color: active ? T.accent : T.inkMed,
    borderRadius: DS_RADIUS.control,
    fontFamily: 'var(--mn-ui)', fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  };
}

function ViewsCreateRow({ plan, T }) {
  const disabled = !plan.createText.trim();
  return (
    <div style={{
      marginTop: 12, padding: 12, borderRadius: DS_RADIUS.row,
      border: `1px solid ${T.selLine}`, background: T.selBg,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 600, color: T.ink }}>
          New item on {plan.createDate}
        </span>
        <button type="button" aria-label="Close add item" title="Close" onClick={plan.closeCreate} style={{ ...pillButton(T, false), width: 28, padding: 0 }}>×</button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => plan.setCreateType('todo')} style={pillButton(T, plan.createType === 'todo')}>Todo</button>
          <button type="button" onClick={() => plan.setCreateType('reminder')} style={pillButton(T, plan.createType === 'reminder')}>Reminder</button>
        </div>
        <input
          aria-label="New item text"
          placeholder="Task or reminder text"
          value={plan.createText}
          onChange={event => plan.setCreateText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !disabled) { event.preventDefault(); plan.submitCreate(); } }}
          style={mnCalendarInput(T)}
        />
        {/* A view has no store of its own: an item has to live in a note. The
            last option makes one rather than making you leave to create it. */}
        <select aria-label="Note this item lives in" value={plan.createNoteId} onChange={event => plan.setCreateNoteId(event.target.value)} style={mnCalendarInput(T)}>
          {plan.noteOptions.map(note => (
            <option key={note.id} value={note.id}>{note.title || 'Untitled'}</option>
          ))}
          <option value={MN_VIEWS_NEW_NOTE}>＋ New note for this item</option>
        </select>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
          <input
            aria-label="Schedule phrase"
            placeholder="When — try “tomorrow 9am”"
            value={plan.createWhen}
            onChange={event => plan.setCreateWhen(event.target.value)}
            style={mnCalendarInput(T)}
          />
          <button type="button" onClick={plan.applyCreateWhen} disabled={!plan.createWhen.trim()} style={pillButton(T, false)}>Apply</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: 8 }}>
          <input aria-label="Item date" type="date" value={plan.createDate} onChange={event => plan.setCreateDate(event.target.value)} style={mnCalendarInput(T)} />
          <input
            aria-label="Item time"
            type="time"
            value={plan.createTime}
            disabled={plan.createType !== 'reminder'}
            title={plan.createType === 'reminder' ? 'Time this reminder fires' : 'A todo is due on a day, not at a time'}
            onChange={event => plan.setCreateTime(event.target.value)}
            style={{ ...mnCalendarInput(T), opacity: plan.createType === 'reminder' ? 1 : 0.5 }}
          />
        </div>
        {plan.error && <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.danger }}>{plan.error}</div>}
        <button type="button" onClick={plan.submitCreate} disabled={disabled} style={mnCalendarPrimaryButton(T, disabled)}>Add</button>
      </div>
    </div>
  );
}

function ViewsEditRow({ plan, onOpen, T }) {
  const row = plan.activeRow;
  const noteId = row.noteId || row.source?.noteId || '';
  const disabled = !plan.draftText.trim();
  // A note row is the note, not a line in one. The only thing to save is its
  // title, and its date is the file's own modified time — so the schedule
  // controls are not drawn rather than drawn and refusing.
  const isNote = Boolean(plan.activeIsNote);
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.lineSub}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ ...dsGroupLabelStyle(T), flex: 1 }}>{isNote ? 'Renaming this note' : 'Editing this row'}</span>
        <span style={dsMachineStyle(T)}>{row.type || 'row'}</span>
        <button type="button" aria-label="Stop editing this row" title="Done" onClick={() => plan.setActiveKey('')} style={{ ...pillButton(T, false), width: 28, padding: 0 }}>×</button>
      </div>
      <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
        <input aria-label="Row text" value={plan.draftText} onChange={event => plan.setDraftText(event.target.value)} style={mnCalendarInput(T)} />
        {!isNote && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
            <input aria-label="Edit schedule phrase" placeholder="When" value={plan.draftWhen} onChange={event => plan.setDraftWhen(event.target.value)} style={mnCalendarInput(T)} />
            <button type="button" onClick={plan.applyDraftWhen} disabled={!plan.draftWhen.trim()} style={pillButton(T, false)}>Apply</button>
          </div>
        )}
        {!isNote && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: 8 }}>
            <input aria-label="Row date" type="date" value={plan.draftDate} onChange={event => plan.setDraftDate(event.target.value)} style={mnCalendarInput(T)} />
            <input aria-label="Row time" type="time" value={plan.draftTime} onChange={event => plan.setDraftTime(event.target.value)} style={mnCalendarInput(T)} />
          </div>
        )}
        {plan.error && <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.danger }}>{plan.error}</div>}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button type="button" onClick={plan.saveActive} disabled={disabled} style={mnCalendarPrimaryButton(T, disabled)}>Save</button>
          {!isNote && <button type="button" onClick={plan.clearActiveDate} disabled={!plan.draftDate} style={pillButton(T, false)}>Clear date</button>}
          {plan.canSnooze && <button type="button" onClick={plan.snoozeActive} style={pillButton(T, false)}>Snooze {plan.snoozeMinutes}m</button>}
          {row.type === 'task' && (
            <button type="button" onClick={plan.toggleActive} style={pillButton(T, false)}>{row.checked ? 'Reopen' : 'Complete'}</button>
          )}
          {noteId && <button type="button" onClick={() => onOpen?.(noteId)} style={pillButton(T, false)}>Open note</button>}
        </div>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim }}>
          {isNote
            ? 'This is the note itself. Saving renames it, and every [[link]] to it follows.'
            : `Lives in ${row.sourceNoteTitle || row.noteTitle || 'a note'}. Editing here writes to that note.`}
        </div>
      </div>
    </div>
  );
}

// The strip docks to the bottom of the scrolling body. A six-row month grid is
// taller than the panel, so a form rendered after it opened somewhere you could
// not see — you clicked + and nothing appeared to happen.
function ViewsCalendarEditor({ plan, onOpen, T }) {
  if (!plan?.enabled) return null;
  const showing = plan.createOpen || plan.activeRow;
  if (!showing) return null;
  return (
    <div
      data-mn-views-planner="true"
      style={{
        position: 'sticky', bottom: 0, zIndex: 3, marginTop: 8,
        padding: '0 0 8px',
        background: T.bg,
        boxShadow: `0 -12px 20px -12px color-mix(in oklab, ${T.ink} 22%, transparent)`,
      }}>
      {plan.createOpen && <ViewsCreateRow plan={plan} T={T} />}
      {plan.activeRow && <ViewsEditRow plan={plan} onOpen={onOpen} T={T} />}
    </div>
  );
}

export { ViewsCalendarEditor, MN_VIEWS_NEW_NOTE };
