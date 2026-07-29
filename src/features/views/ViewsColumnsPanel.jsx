// The Columns menu, built to the v2 prototype.
//
// It opens on a claim: every key in here exists because someone wrote it in a
// note. There is no schema step in this app, so the list is grouped by where
// each key came from — a property line you typed, or a field read off the note
// — and each row shows how many of the rows in front of you actually carry it.
//
// The coverage bar is the honest part. A key on two rows out of ninety is
// still a key, and the bar says so before you turn it into a column and
// wonder why the table is mostly empty.

import { DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';

function mnViewsCoverageTone(count, total, T) {
  if (!count) return T.lineSub;
  return (count / Math.max(1, total)) < 0.34 ? T.warn : T.accent;
}

function ColumnRow({ column, total, on, movable, onToggle, onMove, T }) {
  const pct = total ? Math.round((column.count / total) * 100) : 0;
  const property = column.origin === 'property';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '15px minmax(0, 1fr) 62px 74px 34px',
      alignItems: 'center', gap: 9, width: '100%', padding: '6px 9px',
      borderRadius: 7,
    }}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={`${on ? 'Hide' : 'Show'} the ${column.key} column`}
        disabled={column.fixed}
        title={column.fixed ? 'This column is the row itself, so it always shows.' : undefined}
        onClick={() => onToggle?.(column.key)}
        style={{
          width: 15, height: 15, flexShrink: 0, padding: 0,
          borderRadius: 4,
          border: `1.5px solid ${on ? T.accent : T.line}`,
          background: on ? T.accent : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: column.fixed ? 'default' : 'pointer',
          opacity: column.fixed ? 0.5 : 1,
        }}>
        {on && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 5L4 7L8 3" stroke={T.bg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{
          fontFamily: property ? 'var(--mn-mono)' : 'var(--mn-ui)',
          fontSize: property ? 11.5 : 12.5,
          fontWeight: property ? 400 : 550,
          color: column.count ? T.ink : T.inkDim,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{property ? `${column.key}::` : column.label}</span>
        <span style={{
          fontSize: 10.5, color: T.inkDim,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{column.source}</span>
      </span>

      <span style={{ fontSize: 10.5, color: T.inkDim }}>{column.type}</span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...dsMachineStyle(T, T.inkDim), fontSize: 10 }}>
          {column.count} of {total}
        </span>
        <span style={{ height: 3, borderRadius: 2, background: T.bgSub, overflow: 'hidden' }}>
          <span style={{
            display: 'block', width: `${pct}%`, height: 3, borderRadius: 2,
            background: mnViewsCoverageTone(column.count, total, T),
          }} />
        </span>
      </span>

      <span style={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        {movable && [['left', -1], ['right', 1]].map(([way, delta]) => (
          <button
            key={way}
            type="button"
            title={`Move ${way}`}
            aria-label={`Move the ${column.key} column ${way}`}
            onClick={() => onMove?.(column.key, delta)}
            style={{
              width: 15, height: 18, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 4, background: 'transparent',
              color: T.inkDim, cursor: 'pointer',
            }}>
            <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"
              style={{ transform: delta < 0 ? 'rotate(180deg)' : 'none' }} aria-hidden="true">
              <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </span>
    </div>
  );
}

function ViewsColumnsMenu({ catalogue = [], visible = [], total = 0, onToggle, onMove, T }) {
  const shown = new Set(visible);
  const section = (label) => (
    <div style={{
      padding: '9px 9px 5px',
      fontFamily: 'var(--mn-ui)', fontSize: 10.5, fontWeight: 600,
      letterSpacing: '0.04em', textTransform: 'uppercase', color: T.inkDim,
    }}>{label}</div>
  );
  const rowsFor = (origin) => catalogue
    .filter(column => (origin === 'property' ? column.origin === 'property' : column.origin !== 'property'))
    .map(column => (
      <ColumnRow
        key={column.key}
        column={column}
        total={total}
        on={shown.has(column.key)}
        movable={shown.has(column.key) && !column.fixed}
        onToggle={onToggle}
        onMove={onMove}
        T={T}
      />
    ));
  const properties = rowsFor('property');

  return (
    <div
      data-mn-views-columns="true"
      role="dialog"
      aria-label="Columns"
      style={{
        position: 'absolute', top: 32, left: 0, zIndex: 60, width: 424,
        maxHeight: 460, overflowY: 'auto',
        background: T.bgElevated || T.bg,
        border: `1px solid ${T.line}`,
        borderRadius: DS_RADIUS.row,
        boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        padding: 5,
      }}>
      <div style={{
        padding: '6px 9px 7px',
        fontFamily: 'var(--mn-serif, var(--mn-ui))', fontSize: 12.5,
        lineHeight: 1.45, color: T.inkMed,
      }}>
        Every key any row in this view carries. Nothing here was declared — it was written.
      </div>

      {section('Property lines in your notes')}
      {properties.length ? properties : (
        <div style={{ padding: '4px 9px 8px', fontSize: 11.5, color: T.inkDim, lineHeight: 1.45 }}>
          None yet. Write <span style={{ ...dsMachineStyle(T, T.inkMed), fontSize: 11 }}>owner:: sam</span> on
          its own line in a note and it turns up here.
        </div>
      )}

      {section('Read from the note')}
      {rowsFor('file')}

      <div style={{
        marginTop: 6, padding: '8px 9px 4px',
        borderTop: `1px solid ${T.lineSub}`,
        fontFamily: 'var(--mn-serif, var(--mn-ui))', fontSize: 12,
        lineHeight: 1.5, color: T.inkDim,
      }}>
        Rows without the key show <span style={{ ...dsMachineStyle(T, T.inkDim), fontSize: 11 }}>—</span>.
        The coverage bar is there so you can see that before you turn one on.
      </div>
    </div>
  );
}

export { ViewsColumnsMenu, mnViewsCoverageTone };
