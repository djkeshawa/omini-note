// The Views table, built to the v2 prototype.
//
// A CSS grid rather than a <table>, because the prototype sizes each column
// by what it holds: `30px <per-property widths> 40px`, a 34px header row and
// 40px data rows at 20px gutters.
//
// The header is where a property column earns its keep. A column read from
// the file shows a plain 11px label; a column that exists because someone
// wrote `key::` in a note shows the key in mono with its colons, and every
// header carries a tooltip naming where the value came from. The point is
// that nothing in this table was configured into existence — it was written.

import { DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';
import {
  mnViewsCachedCellValue, mnViewsColumns, mnViewsCellValue, mnViewsSortResults, mnViewsSortIsStorable,
} from './viewsColumns.js';
import { mnViewsRowHue } from './viewsHue.js';
import { ViewsOpenMark } from './ViewsCardParts.jsx';

function mnViewsGridColumns(columns) {
  return `30px ${columns.map(column => column.width).join(' ')} 40px`;
}

function ViewsTableHeader({ columns, sort, onSort, T }) {
  return (
    <div role="row" style={{
      display: 'grid', gridTemplateColumns: mnViewsGridColumns(columns),
      alignItems: 'center', height: 34, padding: '0 20px', gap: 9,
      borderBottom: `1px solid ${T.line}`, background: T.bg,
      position: 'sticky', top: 0, zIndex: 1,
    }}>
      <span role="columnheader" aria-label="Completion" />
      {columns.map(column => {
        const active = sort?.key === column.key;
        const storable = mnViewsSortIsStorable(column.key);
        const origin = column.origin === 'property'
          ? `A property line in your notes — ${column.source}`
          : `Read from the note — ${column.source}`;
        const sorting = storable
          ? 'Click to sort. This view can remember this sort.'
          : 'Click to sort. This sort lasts until you leave — a view can only store sorting by title, created, modified or due.';
        return (
          <div
            key={column.key}
            role="columnheader"
            aria-sort={active ? (sort.direction === 'desc' ? 'descending' : 'ascending') : undefined}
            style={{ minWidth: 0 }}>
            <button
              type="button"
              title={`${origin} · ${sorting}`}
              aria-label={`Sort by ${column.label}`}
              onClick={() => onSort?.(column.key)}
              style={{
                width: '100%', display: 'inline-flex', alignItems: 'center', gap: 5,
                justifyContent: column.type === 'number' ? 'flex-end' : 'flex-start',
                height: 24, padding: 0, border: 'none', background: 'transparent',
                fontFamily: column.origin === 'property' ? 'var(--mn-mono)' : 'var(--mn-ui)',
                fontSize: column.origin === 'property' ? 10.5 : 11,
                fontWeight: 600,
                color: active ? T.ink : T.inkDim,
                cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {column.origin === 'property' ? `${column.key}::` : column.label}
              </span>
              {active && <span aria-hidden="true">{sort.direction === 'desc' ? '↓' : '↑'}</span>}
            </button>
          </div>
        );
      })}
      <span role="columnheader" aria-label="Actions" />
    </div>
  );
}

function ViewsTableCell({ result, column, value, T }) {
  const empty = Array.isArray(value) ? !value.length : !String(value ?? '').length;

  if (column.fixed) {
    return (
      <span role="cell" style={{
        fontSize: 13.5, fontWeight: 600,
        color: result.completed ? T.inkDim : T.ink,
        textDecoration: result.completed ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value || 'Untitled'}</span>
    );
  }

  if (empty) {
    return <span role="cell" style={{ color: T.inkDim, fontSize: 11.5 }} title={`No ${column.label.toLowerCase()} — ${column.source}`}>—</span>;
  }

  if (column.type === 'multi') {
    return (
      <span role="cell" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 11.5, color: T.inkMed,
      }}>
        {value.map(tag => (
          <span key={tag} style={{
            padding: '1px 7px', borderRadius: DS_RADIUS.pill,
            background: T.bgSub, border: `1px solid ${T.lineSub}`,
          }}>{tag}</span>
        ))}
      </span>
    );
  }

  if (column.type === 'number') {
    return <span role="cell" style={{ ...dsMachineStyle(T, T.inkMed), fontSize: 11, textAlign: 'right' }}>{value}</span>;
  }

  // Dates and property values are machine-written strings, so they get the
  // mono face that everything else machine-written in the app uses.
  const machine = column.type === 'date' || column.origin === 'property';
  return (
    <span
      role="cell"
      title={column.origin === 'property' ? `${column.key}:: ${value}` : undefined}
      style={{
        ...(machine ? dsMachineStyle(T, T.inkMed) : { color: T.inkMed, fontFamily: 'var(--mn-ui)' }),
        fontSize: machine ? 11 : 12,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</span>
  );
}

function mnViewsPrepareRows(results = [], columns = [], helpers = {}) {
  return results.map(result => {
    const cells = new Map();
    columns.forEach(column => cells.set(column.key, mnViewsCellValue(result, column, helpers)));
    return { ...result, __cells: cells };
  });
}

function mnViewsRenderTable({ results = [], definition = {}, sort, onSort, onOpen, onToggleCheck, helpers = {}, tagHue, theme, T }) {
  const columns = mnViewsColumns(definition);
  // Cell values are read once per row and cached on the row so sorting does
  // not re-read every note body on every comparison.
  const rows = mnViewsPrepareRows(results, columns, helpers);
  const sorted = mnViewsSortResults(rows, columns, sort);
  const grid = mnViewsGridColumns(columns);
  const actionable = row => row.type === 'task' || row.type === 'reminder';

  return (
    <div role="table" aria-label="View results" data-mn-views-table="true" style={{ margin: '0 -20px' }}>
      <ViewsTableHeader columns={columns} sort={sort} onSort={onSort} T={T} />
      {sorted.map(row => {
        const noteId = row.noteId || row.source?.noteId || row.id;
        // The row is the note, so the row is the target. It was reachable only
        // through the chevron at its right edge, which meant a 40px-tall row
        // had one 24px-wide place you could click.
        const open = noteId && onOpen ? () => onOpen(noteId) : null;
        const hue = mnViewsRowHue(row, { tagHue, theme, T });
        return (
        <div
          key={row.key || row.id}
          className="mn-view-row"
          role="row"
          data-mn-view-row="true"
          tabIndex={open ? 0 : undefined}
          title={open ? `Open ${row.sourceNoteTitle || row.noteTitle || 'this note'}` : undefined}
          onClick={open || undefined}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === 'Enter') { event.preventDefault(); open(); }
          }}
          style={{
            display: 'grid', gridTemplateColumns: grid, gap: 9,
            alignItems: 'center', height: 40, padding: '0 20px',
            borderBottom: `1px solid ${T.lineSub}`,
            boxShadow: `inset 3px 0 0 ${hue}`,
            cursor: open ? 'pointer' : 'default',
          }}>
          <span role="cell">
            {actionable(row) && onToggleCheck ? (
              <button
                type="button"
                aria-label={row.checked ? 'Reopen task' : 'Complete task'}
                onClick={(event) => { event.stopPropagation(); onToggleCheck(row); }}
                style={{
                  width: 15, height: 15, padding: 0, borderRadius: 4,
                  border: `1.5px solid ${row.checked ? T.accent : T.line}`,
                  background: row.checked ? T.accent : 'transparent',
                  cursor: 'pointer',
                }}
              />
            ) : null}
          </span>
          {columns.map(column => (
            <ViewsTableCell
              key={column.key}
              result={row}
              column={column}
              value={mnViewsCachedCellValue(row, column.key)}
              T={T}
            />
          ))}
          <span role="cell" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ViewsOpenMark hue={hue} label="Open note" onOpen={open} T={T} />
          </span>
        </div>
        );
      })}
    </div>
  );
}

export { mnViewsRenderTable, mnViewsGridColumns, mnViewsPrepareRows };
