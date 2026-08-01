// The calendar layout: a month grid of whatever the view returned, and a day
// you can actually write to.
//
// Rows are placed by the same date the other layouts print, so a row never
// appears under one date in the table and another in the calendar. For a task
// that is its reminder date; for a note, when it was last modified.
//
// The month maths is the agenda's — mnCalendarMonthDays returns the 42-cell
// matrix with in-month and today already resolved — so the two surfaces cannot
// drift on which week a date belongs to. The planning strip below the grid is
// the agenda's capability rather than its markup: pick a day, add a todo or a
// reminder to a note, edit what is already there, tick it off.
//
// This stays a plain function rather than a component. It is called during the
// panel's render, so a hook here would be the panel's hook; the day you have
// selected and the item you are editing live in useViewsPlanner instead and
// arrive as `plan`. Without a plan the grid is read-only and chips open notes,
// which is how it behaves anywhere the planning actions are not wired.

import { DS_HEIGHT, DS_RADIUS, dsGroupLabelStyle, dsMachineStyle } from '../../shared/designSystem.js';
import { mnCalendarDateKey, mnCalendarMonthDays } from '../../panels/calendarDates.js';
import { mnSmartViewResultDate, mnSmartViewResultSource } from '../../panels/smartViewsPanel.jsx';
import { mnViewsRowHue } from './viewsHue.js';
import { mnViewsRowKey } from './viewsOrder.js';
import { ViewsCalendarEditor } from './ViewsCalendarEditor.jsx';

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

function DayChip({ result, hue, active, onOpen, onPick, T }) {
  const noteId = result.noteId || result.source?.noteId || '';
  const time = result.remindAt?.time || '';
  // With a planner, a chip selects the row for editing; without one there is
  // nothing to edit, so it goes back to being a shortcut into the note.
  const act = onPick ? () => onPick(mnViewsRowKey(result)) : (noteId && onOpen ? () => onOpen(noteId) : null);
  return (
    <div
      role={act ? 'button' : undefined}
      tabIndex={act ? 0 : undefined}
      onClick={(e) => { e.stopPropagation(); act?.(); }}
      onKeyDown={(e) => {
        if (!act) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); act(); }
      }}
      title={onPick ? `Edit ${result.title || result.label || 'this row'}` : (result.title || result.label || mnSmartViewResultSource(result))}
      style={{
        marginTop: 3, height: 19, padding: '0 6px', borderRadius: 5,
        display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
        background: `color-mix(in oklab, ${hue} ${active ? 26 : 12}%, ${T.bg})`,
        border: `1px solid ${active ? hue : 'transparent'}`,
        boxSizing: 'border-box',
        cursor: act ? 'pointer' : 'default',
      }}>
      {time && <span style={{ ...dsMachineStyle(T, hue), fontSize: 9.5, flexShrink: 0 }}>{time}</span>}
      <span style={{
        fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.ink, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: result.checked ? 'line-through' : 'none',
      }}>{result.title || result.label || 'Untitled'}</span>
    </div>
  );
}

function mnViewsRenderCalendar({
  results, helpers, onOpen, weekStart = 'monday', anchor, onAnchorChange,
  plan = null, tagHue, theme, T,
}) {
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
  const planning = Boolean(plan?.enabled);
  const hueOf = result => mnViewsRowHue(result, { tagHue, theme, T });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button type="button" aria-label="Previous month" title="Previous month" onClick={() => step(-1)} style={mnStepButton(T)}>‹</button>
        <span style={{ minWidth: 116, textAlign: 'center', fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600, color: T.ink }}>{monthTitle}</span>
        <button type="button" aria-label="Next month" title="Next month" onClick={() => step(1)} style={mnStepButton(T)}>›</button>
        <button type="button" onClick={() => {
          onAnchorChange?.(new Date());
          plan?.setSelectedKey?.(mnCalendarDateKey(new Date()));
        }} style={{
          height: DS_HEIGHT.toolbar, padding: '0 11px', boxSizing: 'border-box',
          border: `1px solid ${T.lineSub}`, borderRadius: DS_RADIUS.control,
          background: T.bg, color: T.inkMed, cursor: 'pointer',
          fontFamily: 'var(--mn-ui)', fontSize: 12,
        }}>Today</button>
        <span style={{ flex: 1 }} />
        {planning && (
          <button
            type="button"
            aria-label="Add to the selected day"
            title={`Add a todo or reminder on ${plan.selectedKey}`}
            onClick={() => plan.openCreate(plan.selectedKey)}
            style={{
              height: DS_HEIGHT.toolbar, padding: '0 11px', boxSizing: 'border-box',
              border: `1px solid ${T.selLine}`, borderRadius: DS_RADIUS.control,
              background: T.accentSoft, color: T.accent, cursor: 'pointer',
              fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 600,
            }}>+ New</button>
        )}
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
          const selected = planning && plan.selectedKey === day.key;
          const shown = selected ? 3 : 2;
          return (
            <div
              key={day.key}
              role={planning ? 'button' : undefined}
              tabIndex={planning ? 0 : undefined}
              aria-label={planning ? `Select ${day.key}` : undefined}
              onClick={planning ? () => plan.setSelectedKey(day.key) : undefined}
              onKeyDown={(event) => {
                if (!planning) return;
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); plan.setSelectedKey(day.key); }
              }}
              style={{
                minHeight: 0, padding: 7, boxSizing: 'border-box', overflow: 'hidden',
                borderRight: index % 7 === 6 ? 'none' : `1px solid ${T.lineSub}`,
                borderBottom: index >= 35 ? 'none' : `1px solid ${T.lineSub}`,
                background: selected
                  ? T.selBg
                  : day.today ? `color-mix(in oklab, ${T.accent} 5%, ${T.bg})` : day.inMonth ? T.bg : T.bgSub,
                color: day.inMonth ? T.ink : T.inkDim,
                cursor: planning ? 'pointer' : 'default',
                outline: 'none',
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
                <span style={{ flex: 1 }} />
                {selected && (
                  <button
                    type="button"
                    title={`Add an item on ${day.key}`}
                    aria-label={`Add an item on ${day.key}`}
                    onClick={(event) => { event.stopPropagation(); plan.openCreate(day.key); }}
                    style={{
                      width: 20, height: 20, padding: 0, lineHeight: 1,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${T.selLine}`, borderRadius: 5,
                      background: T.bg, color: T.accent, cursor: 'pointer',
                      fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 700,
                    }}>+</button>
                )}
              </div>
              {items.slice(0, shown).map(result => (
                <DayChip
                  key={mnViewsRowKey(result)}
                  result={result}
                  hue={hueOf(result)}
                  active={planning && plan.activeKey === mnViewsRowKey(result)}
                  onOpen={onOpen}
                  onPick={planning ? plan.setActiveKey : null}
                  T={T}
                />
              ))}
              {items.length > shown && (
                <div style={{ marginTop: 3, padding: '0 6px', fontSize: 11, color: T.inkDim }}>+{items.length - shown} more</div>
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
              <DayChip
                key={mnViewsRowKey(result)}
                result={result}
                hue={hueOf(result)}
                active={planning && plan.activeKey === mnViewsRowKey(result)}
                onOpen={onOpen}
                onPick={planning ? plan.setActiveKey : null}
                T={T}
              />
            ))}
          </div>
        </div>
      )}

      {/* Last child, and sticky to the bottom of the scroll: a six-row grid is
          taller than the panel, so a form drawn above this point opens where
          you cannot see it. */}
      {planning && <ViewsCalendarEditor plan={plan} onOpen={onOpen} T={T} />}
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
