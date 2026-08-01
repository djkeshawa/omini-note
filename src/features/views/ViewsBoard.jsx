// The board layout: one column per group, and the cards move.
//
// The columns come from the same grouping every other layout can use, so a
// board is not a separate feature — it is a view whose group is drawn sideways.
// What a board adds is that dragging a card *means* something: it writes the
// group's own property onto the note, exactly as moving a card on the workflow
// board writes `status::`. Nothing is stored about the board itself; the note
// says where it belongs, so the same move shows up in the editor, in Workflow,
// and in a table grouped by the same key.
//
// Two groupings cannot be written back and say so instead of pretending:
// grouping by tag (a note carries a list, so which one would a drop replace?)
// and grouping by a date the app derives rather than stores.
//
// The column header stays exactly two children — a label and a count. The
// regression harness identifies a board column by that shape.

import { DS_RADIUS, dsGroupLabelStyle, dsMachineStyle } from '../../shared/designSystem.js';
import {
  mnSmartViewResultDate, mnSmartViewResultSource, mnSmartViewResultPreview,
} from '../../panels/smartViewsPanel.jsx';
import { mnViewsRowHue, mnViewsRowTags, mnViewsTint } from './viewsHue.js';
import { mnViewsRowKey } from './viewsOrder.js';
import {
  ViewsOpenMark, ViewsHoverBar, ViewsBarButton, ViewsInlineTitle, ViewsCheck,
  mnViewsCardStyle, mnViewsRowSource,
} from './ViewsCardParts.jsx';

const { useState: useStateVB } = React;

// A board without columns is a list. When a definition asks for the board
// layout without saying how to split it, status is the assumption — it is
// what the workflow board has always grouped by.
function mnViewsBoardGroup(definition) {
  const by = definition?.group?.by;
  if (by) return definition.group;
  return { by: 'status', direction: 'asc' };
}

// Dropping writes one property line. `tag` is a list on the note and a date is
// computed from the file, so neither has a single value a drop could set.
const MN_VIEWS_UNWRITABLE_GROUPS = new Set(['tag', 'tags', 'created', 'modified', 'date', 'reminder', 'due']);

function mnViewsBoardWritableKey(definition) {
  const by = String(mnViewsBoardGroup(definition)?.by || '').trim();
  if (!by || MN_VIEWS_UNWRITABLE_GROUPS.has(by.toLowerCase())) return '';
  return by;
}

function BoardCard({ result, hue, bucketKey, ctx }) {
  const { T, helpers, onOpen, onToggleCheck, onRename, writeKey, drag, setDrag, editingKey, setEditingKey, draft, setDraft } = ctx;
  const key = mnViewsRowKey(result);
  const noteId = result.noteId || result.source?.noteId || '';
  const editing = editingKey === key;
  const dragging = drag.key === key;
  const preview = mnSmartViewResultPreview(result);
  const date = mnSmartViewResultDate(result, helpers);
  const tags = mnViewsRowTags(result);

  const startEdit = () => {
    if (!onRename) return;
    setDraft(result.title || result.label || '');
    setEditingKey(key);
  };
  const commit = () => {
    const next = draft.trim();
    setEditingKey('');
    if (!next || next === (result.title || result.label || '')) return;
    onRename(result, next);
  };

  return (
    <div
      className="mn-view-card"
      data-mn-view-row="true"
      role="button"
      tabIndex={0}
      draggable={Boolean(writeKey) && !editing}
      title={writeKey
        ? `Click to rename · drag to another column to set ${writeKey}::`
        : 'Click to rename · open it from the bar along the bottom'}
      onClick={startEdit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startEdit(); }
      }}
      onDragStart={(event) => {
        // The row travels with the drag, not just its key: the drop has to
        // write to the note the card came from, and re-finding it by key would
        // mean searching every column for something we already had.
        setDrag({ key, from: bucketKey, overColumn: '', result });
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/mn-view-card', key); } catch { /* older platforms */ }
      }}
      onDragEnd={() => setDrag({ key: '', from: '', overColumn: '', result: null })}
      style={{ ...mnViewsCardStyle(hue, T, { dragging, editing }), padding: '9px 10px 34px', gap: 5 }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        {result.type === 'task' && (
          <ViewsCheck checked={result.checked} onToggle={onToggleCheck ? () => onToggleCheck(result) : null} T={T} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <ViewsInlineTitle
              value={draft}
              onChange={setDraft}
              onCommit={commit}
              onCancel={() => setEditingKey('')}
              label={`Rename ${result.title || result.label || 'row'}`}
              T={T}
            />
          ) : (
            <div style={{
              fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 600,
              color: result.checked ? T.inkDim : T.ink,
              textDecoration: result.checked ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{result.title || result.label || 'Untitled'}</div>
          )}
        </div>
      </div>

      {preview && (
        <div style={{
          fontFamily: 'var(--mn-body)', fontSize: 12.5, lineHeight: 1.4, color: T.inkMed,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{preview}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{
          fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>{mnViewsRowSource(result)}</span>
        {date && <span style={{ ...dsMachineStyle(T), fontSize: 10 }}>{date}</span>}
      </div>

      {!!tags.length && (
        <div style={{ display: 'flex', gap: 5, overflow: 'hidden' }}>
          {tags.slice(0, 3).map(tag => (
            <span key={tag} style={{ ...dsMachineStyle(T, hue), fontSize: 10, whiteSpace: 'nowrap' }}>#{tag}</span>
          ))}
          {tags.length > 3 && <span style={{ ...dsMachineStyle(T), fontSize: 10 }}>+{tags.length - 3}</span>}
        </div>
      )}

      <ViewsHoverBar hue={hue} T={T}>
        {Boolean(writeKey) && <span style={{ ...dsMachineStyle(T), fontSize: 10, cursor: 'grab' }}>drag</span>}
        <span style={{ flex: 1 }} />
        {onRename && !editing && (
          <ViewsBarButton hue={hue} label="Rename" title={`Rename ${result.title || result.label || 'this row'}`} onClick={startEdit} T={T} />
        )}
        {noteId && (
          <ViewsOpenMark hue={hue} label={`Open ${mnSmartViewResultSource(result)}`} onOpen={() => onOpen?.(noteId)} T={T} className="" />
        )}
      </ViewsHoverBar>
    </div>
  );
}

function BoardColumn({ bucket, ctx }) {
  const { T, tagHue, theme, writeKey, drag, setDrag, onMoveCard } = ctx;
  const bucketKey = bucket.key || '';
  const over = Boolean(writeKey) && drag.key && drag.overColumn === bucketKey && drag.from !== bucketKey;
  return (
    <div
      data-mn-views-board-column={bucketKey}
      onDragOver={(event) => {
        if (!writeKey || !drag.key) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (drag.overColumn !== bucketKey) setDrag(current => ({ ...current, overColumn: bucketKey }));
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDrag(current => (current.overColumn === bucketKey ? { ...current, overColumn: '' } : current));
      }}
      onDrop={(event) => {
        event.preventDefault();
        const moved = drag.result;
        const from = drag.from;
        setDrag({ key: '', from: '', overColumn: '', result: null });
        if (moved && from !== bucketKey) onMoveCard?.(moved, bucketKey, writeKey);
      }}
      style={{
        minWidth: 0, borderRadius: DS_RADIUS.row,
        border: `1px solid ${over ? T.accent : T.lineSub}`,
        background: over ? T.bgHover : T.bgSub,
        padding: 9, transition: 'background 100ms',
        display: 'flex', flexDirection: 'column', gap: 7,
      }}>
      {/* Exactly two children: the regression identifies a column by this. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 1px 2px' }}>
        <span style={{ ...dsGroupLabelStyle(T), flex: 1, minWidth: 0 }}>{bucket.label || 'Ungrouped'}</span>
        <span style={dsMachineStyle(T)}>{bucket.items.length}</span>
      </div>
      {over && (
        <div style={{
          height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px dashed ${T.accent}`, borderRadius: DS_RADIUS.icon,
          background: `color-mix(in oklab, ${T.accent} 8%, ${T.bg})`,
          color: T.accent, fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 600,
        }}>Release to move here</div>
      )}
      {bucket.items.map(result => (
        <BoardCard
          key={mnViewsRowKey(result)}
          result={result}
          bucketKey={bucketKey}
          hue={mnViewsRowHue(result, { tagHue, theme, T })}
          ctx={ctx}
        />
      ))}
      {!bucket.items.length && !over && (
        <div style={{
          padding: '14px 8px', textAlign: 'center',
          fontFamily: 'var(--mn-body)', fontSize: 12, fontStyle: 'italic', color: T.inkDim,
          border: `1px dashed ${T.lineSub}`, borderRadius: DS_RADIUS.icon,
        }}>{writeKey ? 'Drop here' : 'Nothing here'}</div>
      )}
    </div>
  );
}

function ViewsBoardView({ groups = [], definition = {}, helpers, onOpen, onToggleCheck, onRename, onMoveCard, tagHue, theme, T }) {
  const [drag, setDrag] = useStateVB({ key: '', from: '', overColumn: '', result: null });
  const [editingKey, setEditingKey] = useStateVB('');
  const [draft, setDraft] = useStateVB('');
  const writeKey = onMoveCard ? mnViewsBoardWritableKey(definition) : '';
  // Every column stays on screen, including empty ones — a board whose
  // columns appear and vanish as work moves is hard to read, and an empty
  // column you cannot see is one you cannot drop into.
  const columns = (groups || []).filter(bucket => bucket.key !== '' || bucket.items.length || writeKey);
  const total = columns.reduce((sum, bucket) => sum + bucket.items.length, 0);
  const ctx = { T, tagHue, theme, helpers, onOpen, onToggleCheck, onRename, onMoveCard, writeKey, drag, setDrag, editingKey, setEditingKey, draft, setDraft };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim }}>
          {writeKey
            ? `Drag a card to another column to set its ${writeKey}`
            : onMoveCard
            ? `Grouped by ${mnViewsBoardGroup(definition)?.by || 'status'} — a note does not store that as one value, so cards stay put`
            : `Grouped by ${mnViewsBoardGroup(definition)?.by || 'status'}`}
        </span>
        <span style={{ flex: 1 }} />
        {/* Where the work sits, at a glance — one segment per column, sized by
            share. The workflow board draws the same bar for the same reason. */}
        {total > 0 && (
          <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 3, height: 8, width: 180, borderRadius: 4, overflow: 'hidden' }}>
            {columns.filter(bucket => bucket.items.length).map((bucket, index) => (
              <span
                key={bucket.key || '__unfiled'}
                title={`${bucket.label || 'Ungrouped'}: ${bucket.items.length}`}
                style={{
                  flex: bucket.items.length, height: '100%', borderRadius: 4,
                  // Columns have no colour of their own here, so the segments
                  // step down in weight left to right — enough to tell them
                  // apart without inventing a palette the columns do not have.
                  background: mnViewsTint(T.accent, Math.max(30, 100 - index * 18), T.bgSub),
                }}
              />
            ))}
          </span>
        )}
      </div>
      <div style={{
        display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(240px, 1fr)',
        gap: 10, alignItems: 'start', overflowX: 'auto', paddingBottom: 6,
      }}>
        {columns.map(bucket => (
          <BoardColumn key={bucket.key || '__unfiled'} bucket={bucket} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function mnViewsRenderBoard(props) {
  return <ViewsBoardView {...props} />;
}

export { mnViewsRenderBoard, mnViewsBoardGroup, mnViewsBoardWritableKey, ViewsBoardView };
