// The board layout: one column per group.
//
// It deliberately does not reuse the workflow board's Card and DropColumn.
// Those take a `board` bag of about fifteen drag callbacks and assume a
// workflow item shape; a read-only board has no drag handlers at all, so
// reusing them would mean either faking that bag or loosening components
// that work. The card reads its row through the same helpers the other
// layouts use, so a row is described identically wherever it appears.
//
// Columns come from the grouping added in the previous step, which is why
// a board view needs a group — see mnViewsBoardGroup.

import { DS_RADIUS, dsGroupLabelStyle, dsMachineStyle } from '../../shared/designSystem.js';
import {
  mnSmartViewResultDate,
  mnSmartViewResultSource,
  mnSmartViewResultKind,
  mnSmartViewResultTags,
  mnSmartViewResultPreview,
} from '../../panels/smartViewsPanel.jsx';

// A board without columns is a list. When a definition asks for the board
// layout without saying how to split it, status is the assumption — it is
// what the workflow board has always grouped by.
function mnViewsBoardGroup(definition) {
  const by = definition?.group?.by;
  if (by) return definition.group;
  return { by: 'status', direction: 'asc' };
}

function BoardCard({ result, helpers, onOpen, T }) {
  const noteId = result.noteId || result.source?.noteId || '';
  const tags = mnSmartViewResultTags(result);
  const preview = mnSmartViewResultPreview(result);
  const date = mnSmartViewResultDate(result, helpers);
  return (
    <div
      role={noteId ? 'button' : undefined}
      tabIndex={noteId ? 0 : undefined}
      onClick={() => noteId && onOpen?.(noteId)}
      onKeyDown={(e) => {
        if (!noteId) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(noteId); }
      }}
      title={noteId ? `Open ${mnSmartViewResultSource(result)}` : undefined}
      style={{
        padding: '10px 11px',
        borderRadius: DS_RADIUS.icon,
        background: T.bg,
        border: `1px solid ${T.lineSub}`,
        cursor: noteId ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: 6,
        minWidth: 0,
      }}>
      <div style={{
        fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 600, color: T.ink,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{result.title || result.label || 'Untitled'}</div>
      {preview && (
        <div style={{
          fontFamily: 'var(--mn-body)', fontSize: 12.5, lineHeight: 1.4, color: T.inkMed,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{preview}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{
          fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1,
        }}>{mnSmartViewResultSource(result)}</span>
        {date && <span style={{ ...dsMachineStyle(T), fontSize: 10 }}>{date}</span>}
      </div>
      {!!tags.length && (
        <div style={{ display: 'flex', gap: 5, overflow: 'hidden' }}>
          {tags.slice(0, 3).map(tag => (
            <span key={tag} style={{ ...dsMachineStyle(T), fontSize: 10, whiteSpace: 'nowrap' }}>#{tag}</span>
          ))}
          {tags.length > 3 && <span style={{ ...dsMachineStyle(T), fontSize: 10 }}>+{tags.length - 3}</span>}
        </div>
      )}
      <span style={{ ...dsMachineStyle(T), fontSize: 10 }}>{mnSmartViewResultKind(result)}</span>
    </div>
  );
}

function mnViewsRenderBoard({ groups, helpers, onOpen, T }) {
  // Every column stays on screen, including empty ones — a board whose
  // columns appear and vanish as work moves is hard to read.
  const columns = (groups || []).filter(bucket => bucket.key !== '' || bucket.items.length);
  return (
    <div style={{
      display: 'grid',
      gridAutoFlow: 'column',
      gridAutoColumns: 'minmax(240px, 1fr)',
      gap: 10,
      alignItems: 'start',
      overflowX: 'auto',
      paddingBottom: 6,
    }}>
      {columns.map(bucket => (
        <div key={bucket.key || '__unfiled'} style={{
          minWidth: 0,
          borderRadius: DS_RADIUS.row,
          border: `1px solid ${T.lineSub}`,
          background: T.bgSub,
          padding: 9,
          display: 'flex', flexDirection: 'column', gap: 7,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 1px 2px' }}>
            <span style={{ ...dsGroupLabelStyle(T), flex: 1, minWidth: 0 }}>{bucket.label || 'Ungrouped'}</span>
            <span style={dsMachineStyle(T)}>{bucket.items.length}</span>
          </div>
          {bucket.items.map(result => (
            <BoardCard key={result.key || result.id} result={result} helpers={helpers} onOpen={onOpen} T={T} />
          ))}
          {!bucket.items.length && (
            <div style={{
              padding: '14px 8px', textAlign: 'center',
              fontFamily: 'var(--mn-body)', fontSize: 12, fontStyle: 'italic', color: T.inkDim,
              border: `1px dashed ${T.lineSub}`, borderRadius: DS_RADIUS.icon,
            }}>Nothing here</div>
          )}
        </div>
      ))}
    </div>
  );
}

export { mnViewsRenderBoard, mnViewsBoardGroup };
