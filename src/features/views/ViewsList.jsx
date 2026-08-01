// The list and timeline layouts.
//
// These were borrowed from the Smart Views panel, where a row is inert and the
// only thing you can click is a solid Open button on its right. In a view the
// row *is* the note, so the row is the target: click anywhere on it, or reach
// it with Tab and press Enter. The open mark stays, washed in the row's hue and
// faint until the pointer is on the row, because a row you can click still has
// to say so.
//
// Smart Views keeps its own renderers untouched — the two surfaces run side by
// side and a change here is not a change there.

import { dsGroupLabelStyle, dsMachineStyle, DS_RADIUS } from '../../shared/designSystem.js';
import {
  mnSmartViewResultDate, mnSmartViewResultSource, mnSmartViewResultPreview,
} from '../../panels/smartViewsPanel.jsx';
import { mnViewsRowHue, mnViewsRowTags } from './viewsHue.js';
import { mnViewsRowKey } from './viewsOrder.js';
import { ViewsOpenMark, ViewsCheck, mnViewsRowSource } from './ViewsCardParts.jsx';
import { ViewsKindPill } from './ViewsCards.jsx';

function ViewsListRow({ result, hue, helpers, onOpen, onToggleCheck, T }) {
  const noteId = result.noteId || result.source?.noteId || '';
  const date = mnSmartViewResultDate(result, helpers);
  const preview = mnSmartViewResultPreview(result);
  const tags = mnViewsRowTags(result);
  const open = noteId && onOpen ? () => onOpen(noteId) : null;
  return (
    <div
      className="mn-view-row"
      data-mn-view-row="true"
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      title={open ? `Open ${mnSmartViewResultSource(result)}` : undefined}
      onClick={open || undefined}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      }}
      style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 12, alignItems: 'center', minWidth: 0,
        padding: '11px 10px 11px 12px',
        borderRadius: DS_RADIUS.control,
        borderBottom: `1px solid ${T.lineSub}`,
        // The hue reads as a spine down the left of the list, so rows that
        // belong together are grouped by colour before you read a word.
        boxShadow: `inset 2px 0 0 ${hue}`,
        cursor: open ? 'pointer' : 'default',
      }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, minWidth: 0 }}>
          {result.type === 'task' && (
            <ViewsCheck checked={result.checked} onToggle={onToggleCheck ? () => onToggleCheck(result) : null} T={T} size={14} />
          )}
          <ViewsKindPill result={result} hue={hue} T={T} />
          <div style={{
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600,
            color: result.checked ? T.inkDim : T.ink,
            textDecoration: result.checked ? 'line-through' : 'none',
          }}>{result.title || result.label || 'Untitled'}</div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim,
        }}>
          {!!mnViewsRowSource(result) && <span>{mnViewsRowSource(result)}</span>}
          {date && <span style={dsMachineStyle(T)}>{date}</span>}
          {tags.slice(0, 3).map(tag => <span key={tag} style={{ color: hue }}>#{tag}</span>)}
        </div>
        {preview && (
          <div style={{
            marginTop: 6, fontFamily: 'var(--mn-body)', fontSize: 12.5, lineHeight: 1.45, color: T.inkMed,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{preview}</div>
        )}
      </div>
      <ViewsOpenMark hue={hue} label={`Open ${mnSmartViewResultSource(result)}`} onOpen={open} T={T} />
    </div>
  );
}

function mnViewsRenderList({ results = [], helpers, onOpen, onToggleCheck, tagHue, theme, T }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {results.map(result => (
        <ViewsListRow
          key={mnViewsRowKey(result)}
          result={result}
          hue={mnViewsRowHue(result, { tagHue, theme, T })}
          helpers={helpers}
          onOpen={onOpen}
          onToggleCheck={onToggleCheck}
          T={T}
        />
      ))}
    </div>
  );
}

// The timeline is the list under date headings. Undated rows are kept and
// labelled rather than dropped, so the count in the strip still adds up.
function mnViewsRenderTimeline({ results = [], helpers, onOpen, onToggleCheck, tagHue, theme, T }) {
  const groups = new Map();
  results.forEach(result => {
    const key = mnSmartViewResultDate(result, helpers) || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  });
  const ordered = [...groups.entries()].sort((a, b) => {
    if (!a[0]) return 1;
    if (!b[0]) return -1;
    return String(b[0]).localeCompare(String(a[0]));
  });
  return (
    <div>
      {ordered.map(([date, items]) => (
        <div key={date || '__undated'} style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 14, padding: '8px 0' }}>
          <div style={{ paddingTop: 12 }}>
            {date
              ? <span style={dsMachineStyle(T, T.inkMed)}>{date}</span>
              : <span style={dsGroupLabelStyle(T)}>No date</span>}
          </div>
          <div style={{ borderLeft: `1px solid ${T.line}`, paddingLeft: 14, minWidth: 0 }}>
            {mnViewsRenderList({ results: items, helpers, onOpen, onToggleCheck, tagHue, theme, T })}
          </div>
        </div>
      ))}
    </div>
  );
}

export { mnViewsRenderList, mnViewsRenderTimeline, ViewsListRow };
