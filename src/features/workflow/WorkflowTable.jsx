// The workflow table: one row per note, with the discovered property columns
// the panel offers alongside the fixed four.
//
// Columns are a union of the `key:: value` lines present on the notes in view,
// so a note that gains a `pov::` line starts offering pov as a column with no
// schema to update anywhere.

function TagEditorCell({ item, tags, onSetNoteTags, tagHue, theme, T }) {
  const current = item.noteTags || [];
  const available = (tags || []).filter(t => !current.includes(t.name));
  const setTagsForNote = (nextTags) => onSetNoteTags && onSetNoteTags(item.noteId, nextTags);
  return (
    <div style={{
      display: 'flex', gap: 5, alignItems: 'center',
      flexWrap: 'wrap', minWidth: 0, maxHeight: 50,
      overflow: 'hidden',
    }}>
      {current.slice(0, 3).map(t => (
        <button
          key={t}
          type="button"
          title="Remove tag"
          onClick={(e) => {
            e.stopPropagation();
            setTagsForNote(current.filter(x => x !== t));
          }}
          style={{
            maxWidth: 92,
            padding: '2px 6px',
            borderRadius: 999,
            border: `1px solid ${T.lineSub}`,
            background: mnGetTagBg(tagHue[t] ?? 240, theme),
            color: mnGetTagColor(tagHue[t] ?? 240, theme),
            fontFamily: 'var(--mn-mono)',
            fontSize: 10,
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>#{t}</button>
      ))}
      {current.length > 3 && (
        <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>+{current.length - 3}</span>
      )}
      <select
        value=""
        title="Add tag"
        disabled={!available.length}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          if (!e.target.value) return;
          setTagsForNote([...current, e.target.value]);
          e.target.value = '';
        }}
        style={{
          maxWidth: 92,
          border: `1px dashed ${T.line}`,
          borderRadius: 999,
          background: T.bg,
          color: T.inkDim,
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          padding: '2px 5px',
          cursor: available.length ? 'pointer' : 'default',
        }}>
        <option value="">+ tag</option>
        {available.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
      </select>
    </div>
  );
}

function WorkflowTable({
  allItems, workflowStates, shownColumns, tableGrid, tableMinWidth,
  StatePill, ArchiveButton, onOpen, moveItem,
  tags, onSetNoteTags, tagHue, theme, T,
}) {
  return (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      overflowX: 'auto',
      overflowY: 'auto',
      maxHeight: 'calc(100vh - 205px)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: tableGrid,
        gap: 0,
        padding: '8px 12px',
        background: T.bgSub,
        borderBottom: `1px solid ${T.lineSub}`,
        position: 'sticky',
        top: 0,
        zIndex: 1,
        fontFamily: 'var(--mn-ui)', fontWeight: 600,
        fontSize: 11,
        color: T.inkDim,
        minWidth: tableMinWidth,
        boxSizing: 'border-box',
      }}>
        <span>Status</span><span>Note</span><span>Title</span><span>Tags</span>
        {shownColumns.map(key => <span key={key}>{key}</span>)}
        <span>Change</span>
      </div>
      {allItems.map(({ state, ...item }) => (
        <div key={item.id} style={{
          display: 'grid',
          gridTemplateColumns: tableGrid,
          gap: 0,
          padding: '10px 12px',
          borderBottom: `1px solid ${T.lineSub}`,
          alignItems: 'start',
          fontFamily: 'var(--mn-ui)',
          fontSize: 13,
          minWidth: tableMinWidth,
          boxSizing: 'border-box',
          background: T.bg,
        }}>
          <div style={{ minWidth: 0, paddingTop: 3, overflow: 'hidden' }}>
            <StatePill state={state} />
          </div>
          <span onClick={() => onOpen(item.noteId)} style={{
            color: T.ink, cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'normal',
            lineHeight: 1.35,
            paddingTop: 3,
            minWidth: 0,
          }}>{item.text || 'No preview'}</span>
          <span onClick={() => onOpen(item.noteId)} style={{
            color: T.inkMed,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            paddingTop: 3,
            minWidth: 0,
          }}>{item.noteTitle}</span>
          <TagEditorCell item={item} tags={tags} onSetNoteTags={onSetNoteTags} tagHue={tagHue} theme={theme} T={T} />
          {/* Discovered property cells. Read-only for now: writing a
              cell is a markdown edit and wants its own single writer. */}
          {shownColumns.map(key => (
            <div key={key} style={{
              minWidth: 0, paddingTop: 3, paddingRight: 10,
              fontFamily: 'var(--mn-ui)', fontSize: 12,
              color: item.properties?.[key] ? T.inkMed : T.inkDim,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{item.properties?.[key] || '—'}</div>
          ))}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
            <select value={state.id} onChange={(e) => moveItem(item, e.target.value)} style={{
              border: `1px solid ${T.line}`,
              borderRadius: 5,
              background: T.bg,
              color: T.ink,
              fontFamily: 'var(--mn-ui)',
              fontSize: 12,
              padding: '4px 6px',
              minWidth: 0,
              flex: 1,
              boxSizing: 'border-box',
            }}>
              {(workflowStates || []).map(s => <option key={s.id} value={s.id}>{mnSentenceCase(s.id)}</option>)}
            </select>
            <ArchiveButton item={item} compact />
          </div>
        </div>
      ))}
      {!allItems.length && (
        <div style={{ padding: 22, textAlign: 'center', color: T.inkDim, fontFamily: 'var(--mn-body)', fontStyle: 'italic' }}>No workflow notes yet</div>
      )}
    </div>
  );
}

export { WorkflowTable };
import { mnSentenceCase } from '../../shared/designSystem.js';
import { mnGetTagBg, mnGetTagColor } from '../../shared/theme.jsx';
