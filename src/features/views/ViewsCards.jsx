// The cards layout.
//
// A card is not a row with a border round it. On a row, the click is "open" and
// there is nothing else to do. On a card there is room, so the click is the
// small edit — the topic — and opening moves to the bar along the bottom edge,
// which is where the hue and the chevron are. That split is the whole design:
// content stays legible because the affordances are not competing with it.
//
// Cards can also be arranged by hand. The sort is a rule about all of them;
// dragging one says something about that one, which no sort field can express.
// See viewsOrder.js for why the arrangement is not written into the definition.

import { dsMachineStyle, DS_RADIUS } from '../../shared/designSystem.js';
import {
  mnSmartViewResultDate, mnSmartViewResultSource,
  mnSmartViewResultKind, mnSmartViewResultPreview,
} from '../../panels/smartViewsPanel.jsx';
import { mnViewsRowHue, mnViewsRowTags, mnViewsTint, MN_VIEWS_TINT } from './viewsHue.js';
import { mnViewsOrderApply, mnViewsOrderMove, mnViewsRowKey } from './viewsOrder.js';
import {
  ViewsOpenMark, ViewsHoverBar, ViewsBarButton, ViewsInlineTitle, ViewsCheck,
  mnViewsCardStyle, mnViewsRowSource,
} from './ViewsCardParts.jsx';

const { useState: useStateVC } = React;

function ViewsKindPill({ result, hue, T }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      height: 19, padding: '0 8px', borderRadius: DS_RADIUS.pill,
      border: `1px solid ${mnViewsTint(hue, MN_VIEWS_TINT.edge, T.lineSub)}`,
      background: mnViewsTint(hue, MN_VIEWS_TINT.wash, T.bg),
      color: T.inkMed, fontFamily: 'var(--mn-ui)', fontSize: 11,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: hue }} />
      {mnSmartViewResultKind(result)}
    </span>
  );
}

function ViewsCard({ result, hue, ctx }) {
  const {
    T, helpers, onOpen, onToggleCheck, onRename, canReorder,
    editingKey, setEditingKey, draft, setDraft, drag, setDrag, onReorder, results,
  } = ctx;
  const key = mnViewsRowKey(result);
  const noteId = result.noteId || result.source?.noteId || '';
  const editing = editingKey === key;
  const dragging = drag.key === key;
  const over = drag.overKey === key && drag.key !== key;
  const date = mnSmartViewResultDate(result, helpers);
  const preview = mnSmartViewResultPreview(result);
  const source = mnViewsRowSource(result);
  const tags = mnViewsRowTags(result);
  const isTask = result.type === 'task';

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
  const frame = mnViewsCardStyle(hue, T, { dragging, editing });

  return (
    <div
      className="mn-view-card"
      data-mn-view-row="true"
      data-mn-view-card={key}
      role="button"
      tabIndex={0}
      draggable={canReorder && !editing}
      aria-label={`${result.title || result.label || 'Untitled'} — click to rename, open from the bar below`}
      title={onRename ? 'Click to rename · open it from the bar along the bottom' : undefined}
      onClick={startEdit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startEdit(); }
      }}
      onDragStart={(event) => {
        setDrag({ key, overKey: '', before: true });
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/mn-view-card', key); } catch { /* older platforms */ }
      }}
      onDragOver={(event) => {
        if (!drag.key || drag.key === key) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const box = event.currentTarget.getBoundingClientRect();
        // Halfway across decides which side of this card the dragged one lands,
        // so a drop never silently means the opposite of where you aimed.
        const before = (event.clientX - box.left) < box.width / 2;
        if (drag.overKey !== key || drag.before !== before) setDrag(current => ({ ...current, overKey: key, before }));
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (drag.key && drag.key !== key) onReorder?.(mnViewsOrderMove(ctx.order, results, drag.key, key, drag.before));
        setDrag({ key: '', overKey: '', before: true });
      }}
      onDragEnd={() => setDrag({ key: '', overKey: '', before: true })}
      style={{
        ...frame,
        // The dragged card's landing place is drawn on the card it will sit
        // next to, on the side it will land — an insertion line you can aim at.
        boxShadow: over ? `inset ${drag.before ? '3px' : '-3px'} 0 0 ${hue}` : frame.boxShadow,
      }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <ViewsKindPill result={result} hue={hue} T={T} />
        <span style={{ flex: 1 }} />
        {date && <span style={{ ...dsMachineStyle(T), fontSize: 10 }}>{date}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        {isTask && <ViewsCheck checked={result.checked} onToggle={onToggleCheck ? () => onToggleCheck(result) : null} T={T} />}
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
              fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600,
              color: result.checked ? T.inkDim : T.ink,
              textDecoration: result.checked ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{result.title || result.label || 'Untitled'}</div>
          )}
        </div>
      </div>

      {!!source && (
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source}
        </div>
      )}

      {preview && (
        <div style={{
          fontFamily: 'var(--mn-body)', fontSize: 12.5, lineHeight: 1.45, color: T.inkMed,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{preview}</div>
      )}

      {!!tags.length && (
        <div style={{ display: 'flex', gap: 5, overflow: 'hidden' }}>
          {tags.slice(0, 3).map(tag => (
            <span key={tag} style={{ ...dsMachineStyle(T, hue), fontSize: 10, whiteSpace: 'nowrap' }}>#{tag}</span>
          ))}
          {tags.length > 3 && <span style={{ ...dsMachineStyle(T), fontSize: 10 }}>+{tags.length - 3}</span>}
        </div>
      )}

      <ViewsHoverBar hue={hue} T={T}>
        {canReorder && (
          <span title="Drag to arrange" style={{ ...dsMachineStyle(T), fontSize: 10, cursor: 'grab' }}>drag</span>
        )}
        <span style={{ flex: 1 }} />
        {onRename && !editing && (
          <ViewsBarButton hue={hue} label="Rename" title={`Rename ${result.title || result.label || 'this row'}`} onClick={startEdit} T={T} />
        )}
        {noteId && (
          <ViewsOpenMark
            hue={hue}
            label={`Open ${mnSmartViewResultSource(result)}`}
            onOpen={() => onOpen?.(noteId)}
            T={T}
            className=""
          />
        )}
      </ViewsHoverBar>
    </div>
  );
}

function ViewsCardsGrid({ results = [], order = null, onReorder, helpers, onOpen, onToggleCheck, onRename, tagHue, theme, T }) {
  const [editingKey, setEditingKey] = useStateVC('');
  const [draft, setDraft] = useStateVC('');
  const [drag, setDrag] = useStateVC({ key: '', overKey: '', before: true });
  const arranged = mnViewsOrderApply(results, order);
  const ctx = {
    T, helpers, onOpen, onToggleCheck, onRename, results: arranged, order,
    canReorder: Boolean(onReorder), onReorder,
    editingKey, setEditingKey, draft, setDraft, drag, setDrag,
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(238px, 1fr))', gap: 12, alignItems: 'start' }}>
      {arranged.map(result => (
        <ViewsCard
          key={mnViewsRowKey(result)}
          result={result}
          hue={mnViewsRowHue(result, { tagHue, theme, T })}
          ctx={ctx}
        />
      ))}
    </div>
  );
}

function mnViewsRenderCards(props) {
  return <ViewsCardsGrid {...props} />;
}

export { mnViewsRenderCards, ViewsCardsGrid, ViewsKindPill };
