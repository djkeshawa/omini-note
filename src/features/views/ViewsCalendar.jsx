// The calendar layout: a month grid of whatever the view returned.
//
// Rows are placed by the same date the other layouts print, so a row never
// appears under one date in the table and another in the calendar. For a
// task that is its reminder date; for a note, when it was last modified.
//
// The month maths is the agenda's — mnCalendarMonthDays returns the 42-cell
// matrix with in-month and today already resolved — so the two surfaces
// cannot drift on which week a date belongs to.

import { DS_HEIGHT, DS_RADIUS, dsGroupLabelStyle, dsMachineStyle } from '../../shared/designSystem.js';
import { mnCalendarDateKey, mnCalendarMonthDays } from '../../panels/calendarDates.js';
import { mnSmartViewResultDate, mnSmartViewResultSource } from '../../panels/smartViewsPanel.jsx';

const MN_WEEK_LABELS = {
  monday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  sunday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

function mnViewsResultsByDate(results, helpers) {
  const byDate = new Map();
  const undated = [];
  (results || []).forEach(result => {
    const key = mnSmartViewResultDate(result, helpers);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) { undated.push(result); return; }
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(result);
  });
  return { byDate, undated };
}

function DayChip({ result, onOpen, T }) {
  const noteId = result.noteId || result.source?.noteId || '';
  const time = result.remindAt?.time || '';
  return (
    <div
      role={noteId ? 'button' : undefined}
      tabIndex={noteId ? 0 : undefined}
      onClick={(e) => { e.stopPropagation(); if (noteId) onOpen?.(noteId); }}
      onKeyDown={(e) => {
        if (!noteId) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpen?.(noteId); }
      }}
      title={result.title || result.label || mnSmartViewResultSource(result)}
      style={{
        marginTop: 3, height: 19, padding: '0 6px', borderRadius: 5,
        display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
        background: `color-mix(in oklab, ${T.accent} 12%, ${T.bg})`,
        cursor: noteId ? 'pointer' : 'default',
      }}>
      {time && <span style={{ ...dsMachineStyle(T, T.accent), fontSize: 9.5, flexShrink: 0 }}>{time}</span>}
      <span style={{
        fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.ink, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{result.title || result.label || 'Untitled'}</span>
    </div>
  );
}

function mnViewsRenderCalendar({ results, helpers, onOpen, weekStart = 'monday', anchor, onAnchorChange, T }) {
  const { byDate, undated } = mnViewsResultsByDate(results, helpers);
  const days = mnCalendarMonthDays(anchor, weekStart);
  // Tested against 'sunday' the way calendarPanel and mnCalendarMonthDays do.
  // Indexing by the raw preference meant a stored value naming an
  // Object.prototype member resolved to a function, and labels.map threw.
  const labels = weekStart === 'sunday' ? MN_WEEK_LABELS.sunday : MN_WEEK_LABELS.monday;
  const monthTitle = anchor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const step = (delta) => {
    const next = new Date(anchor);
    next.setMonth(anchor.getMonth() + delta, 1);
    onAnchorChange?.(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button type="button" aria-label="Previous month" title="Previous month" onClick={() => step(-1)} style={mnStepButton(T)}>‹</button>
        <span style={{ minWidth: 116, textAlign: 'center', fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600, color: T.ink }}>{monthTitle}</span>
        <button type="button" aria-label="Next month" title="Next month" onClick={() => step(1)} style={mnStepButton(T)}>›</button>
        <button type="button" onClick={() => onAnchorChange?.(new Date())} style={{
          height: DS_HEIGHT.toolbar, padding: '0 11px', boxSizing: 'border-box',
          border: `1px solid ${T.lineSub}`, borderRadius: DS_RADIUS.control,
          background: T.bg, color: T.inkMed, cursor: 'pointer',
          fontFamily: 'var(--mn-ui)', fontSize: 12,
        }}>Today</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: `1px solid ${T.lineSub}` }}>
        {labels.map(label => (
          <div key={label} style={{ padding: '8px 6px', textAlign: 'center', ...dsGroupLabelStyle(T), justifyContent: 'center' }}>{label}</div>
        ))}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(6, minmax(86px, auto))',
        border: `1px solid ${T.lineSub}`, borderTop: 'none',
      }}>
        {days.map((day, index) => {
          const items = byDate.get(day.key) || [];
          return (
            <div key={day.key} style={{
              minHeight: 0, padding: 7, boxSizing: 'border-box', overflow: 'hidden',
              borderRight: index % 7 === 6 ? 'none' : `1px solid ${T.lineSub}`,
              borderBottom: index >= 35 ? 'none' : `1px solid ${T.lineSub}`,
              background: day.today ? `color-mix(in oklab, ${T.accent} 5%, ${T.bg})` : day.inMonth ? T.bg : T.bgSub,
              color: day.inMonth ? T.ink : T.inkDim,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 5,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  ...dsMachineStyle(T, day.today ? T.bg : undefined),
                  background: day.today ? T.accent : 'transparent',
                  fontWeight: day.today ? 700 : 500,
                }}>{day.date.getDate()}</span>
                {!!items.length && <span style={dsMachineStyle(T)}>{items.length}</span>}
              </div>
              {items.slice(0, 2).map(result => (
                <DayChip key={result.key || result.id} result={result} onOpen={onOpen} T={T} />
              ))}
              {items.length > 2 && (
                <div style={{ marginTop: 3, padding: '0 6px', fontSize: 11, color: T.inkDim }}>+{items.length - 2} more</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Rows the view returned that carry no date. A calendar that quietly
          drops them would under-report what the view actually matched. */}
      {!!undated.length && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...dsGroupLabelStyle(T), marginBottom: 8 }}>
            <span>No date</span>
            <span style={dsMachineStyle(T)}>{undated.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {undated.map(result => (
              <DayChip key={result.key || result.id} result={result} onOpen={onOpen} T={T} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function mnStepButton(T) {
  return {
    width: DS_HEIGHT.toolbar, height: DS_HEIGHT.toolbar, padding: 0,
    border: `1px solid ${T.lineSub}`, borderRadius: DS_RADIUS.control,
    background: T.bg, color: T.inkMed, cursor: 'pointer',
    fontFamily: 'var(--mn-ui)', fontSize: 14, lineHeight: 1,
  };
}

export { mnViewsRenderCalendar, mnViewsResultsByDate };
export { mnCalendarDateKey };
