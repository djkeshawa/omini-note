// Smart Views dashboard presentations.

import MN_APP_HELPERS from '../app/appHelpers.js';
import { mnWalk } from '../editor/outline.jsx';
import { MN_REMIND } from '../shared/markdown.jsx';
import { MN_VIEW_LAYOUTS, mnViewLayout } from '../shared/viewLayout.js';

const { useEffect: useEffectSV, useMemo: useMemoSV, useState: useStateSV } = React;

const MN_SMART_VIEW_PRESENTATIONS = MN_VIEW_LAYOUTS;

// Delegates to the shared resolver so the Views feature and this panel agree
// on what a saved layout means.
function mnSmartViewPresentation(definition) {
  return mnViewLayout(definition, MN_SMART_VIEW_PRESENTATIONS);
}

function mnSmartViewResultDate(result = {}, helpers = {}) {
  return result.reminderDate
    || result.modifiedDate
    || result.createdDate
    || helpers.rollupDateKey?.(result.noteModifiedAt || result.noteDate)
    || '';
}

function mnSmartViewResultSource(result = {}) {
  return result.sourceNoteTitle || result.noteTitle || result.source?.noteTitle || 'Source note';
}

function mnSmartViewResultKind(result = {}) {
  if (result.type === 'task') return result.status || 'task';
  if (result.type === 'reminder') return 'reminder';
  return 'note';
}

function mnSmartViewResultTags(result = {}) {
  return result.tags || result.noteTags || [];
}

function mnSmartViewResultPreview(result = {}) {
  if (result.type === 'note') {
    return String(result.note?.body || '')
      .split('\n')
      .map(line => line.replace(/^#{1,4}\s+/, '').replace(/^\s*-\s+\[[ xX]\]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');
  }
  return result.label || result.text || '';
}

function MnSmartViewActionButton({ result, onOpen, T }) {
  const noteId = result.noteId || result.source?.noteId || '';
  if (!noteId) return null;
  return (
    <button
      type="button"
      title={`Open ${mnSmartViewResultSource(result)}`}
      aria-label={`Open ${mnSmartViewResultSource(result)}`}
      onClick={() => onOpen?.(noteId)}
      style={{
        border: `1px solid ${T.line}`,
        borderRadius: 7,
        background: T.bg,
        color: T.ink,
        padding: '5px 8px',
        fontSize: 11,
        fontWeight: 650,
        cursor: 'pointer',
      }}
    >
      Open
    </button>
  );
}

function MnSmartViewStatusChip({ result, T }) {
  const kind = mnSmartViewResultKind(result);
  const tone = kind === 'completed'
    ? T.success || T.accent
    : kind === 'deferred'
      ? T.warn || T.accent
      : kind === 'reminder'
        ? T.focus || T.accent
        : T.accent;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 20,
      padding: '0 7px',
      borderRadius: 999,
      border: `1px solid color-mix(in oklab, ${tone} 42%, ${T.line})`,
      background: `color-mix(in oklab, ${tone} 10%, ${T.bg})`,
      color: T.ink,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0,
    }}>{kind}</span>
  );
}

function MnSmartViewResultRow({ result, helpers, onOpen, T }) {
  const date = mnSmartViewResultDate(result, helpers);
  const preview = mnSmartViewResultPreview(result);
  const tags = mnSmartViewResultTags(result);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: 12,
      padding: '12px 0',
      borderBottom: `1px solid ${T.lineSub}`,
      alignItems: 'center',
      minWidth: 0,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, minWidth: 0 }}>
          <MnSmartViewStatusChip result={result} T={T} />
          <div style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 14,
            fontWeight: 720,
            color: T.ink,
          }}>{result.title || result.label || 'Untitled'}</div>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          fontSize: 11.5,
          color: T.inkDim,
        }}>
          <span>{mnSmartViewResultSource(result)}</span>
          {date && <span>{date}</span>}
          {/* No hue in scope here, so the name stands alone rather than
              wearing a colour that would not match the tag's own. */}
          {tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}
        </div>
        {preview && <div style={{
          marginTop: 6,
          fontSize: 12.5,
          lineHeight: 1.45,
          color: T.inkMed,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>{preview}</div>}
      </div>
      <MnSmartViewActionButton result={result} onOpen={onOpen} T={T} />
    </div>
  );
}

function mnSmartViewList({ results, helpers, onOpen, T }) {
  return (
    <div>
      {results.map(result => (
        <MnSmartViewResultRow key={result.key || result.id} result={result} helpers={helpers} onOpen={onOpen} T={T} />
      ))}
    </div>
  );
}

function mnSmartViewTable({ results, helpers, onOpen, T }) {
  return (
    <div style={{ overflow: 'auto', borderTop: `1px solid ${T.lineSub}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: T.inkDim, textAlign: 'left' }}>
            {['Type', 'Title', 'Source', 'Date', ''].map(label => (
              <th key={label} style={{ padding: '9px 8px', borderBottom: `1px solid ${T.lineSub}`, fontWeight: 700 }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map(result => (
            <tr key={result.key || result.id}>
              <td style={{ padding: '9px 8px', borderBottom: `1px solid ${T.lineSub}` }}>{mnSmartViewResultKind(result)}</td>
              <td style={{ padding: '9px 8px', borderBottom: `1px solid ${T.lineSub}`, color: T.ink, fontWeight: 650 }}>{result.title || result.label || 'Untitled'}</td>
              <td style={{ padding: '9px 8px', borderBottom: `1px solid ${T.lineSub}`, color: T.inkMed }}>{mnSmartViewResultSource(result)}</td>
              <td style={{ padding: '9px 8px', borderBottom: `1px solid ${T.lineSub}`, color: T.inkDim }}>{mnSmartViewResultDate(result, helpers)}</td>
              <td style={{ padding: '9px 8px', borderBottom: `1px solid ${T.lineSub}`, textAlign: 'right' }}><MnSmartViewActionButton result={result} onOpen={onOpen} T={T} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function mnSmartViewCards({ results, helpers, onOpen, T }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
      {results.map(result => (
        <div key={result.key || result.id} style={{
          minWidth: 0,
          border: `1px solid ${T.line}`,
          borderRadius: 8,
          background: T.bgSub || T.bg,
          padding: 13,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <MnSmartViewStatusChip result={result} T={T} />
            <span style={{ fontSize: 11, color: T.inkDim }}>{mnSmartViewResultDate(result, helpers)}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 6 }}>{result.title || result.label || 'Untitled'}</div>
          <div style={{ fontSize: 11.5, color: T.inkDim, marginBottom: 8 }}>{mnSmartViewResultSource(result)}</div>
          <div style={{ minHeight: 38, fontSize: 12.5, lineHeight: 1.45, color: T.inkMed }}>{mnSmartViewResultPreview(result)}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><MnSmartViewActionButton result={result} onOpen={onOpen} T={T} /></div>
        </div>
      ))}
    </div>
  );
}

function mnSmartViewTimeline({ results, helpers, onOpen, T }) {
  const groups = new Map();
  results.forEach(result => {
    const key = mnSmartViewResultDate(result, helpers) || 'No date';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  });
  const ordered = Array.from(groups.entries()).sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  return (
    <div>
      {ordered.map(([date, items]) => (
        <div key={date} style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 14, padding: '10px 0' }}>
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkDim, paddingTop: 2 }}>{date}</div>
          <div style={{ borderLeft: `1px solid ${T.line}`, paddingLeft: 14 }}>
            {items.map(result => (
              <MnSmartViewResultRow key={result.key || result.id} result={result} helpers={helpers} onOpen={onOpen} T={T} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MnSmartViewsPanel({
  notes = [],
  tags = [],
  definitions = [],
  activeDefinitionId = '',
  onActiveDefinitionChange,
  onOpen,
  onOpenAllNotes,
  T,
}) {
  const helpers = MN_APP_HELPERS;
  const safeDefinitions = definitions.length ? definitions : [{
    id: 'all_notes',
    title: 'All notes',
    type: 'notes',
    filters: {},
    sort: { field: 'modified', direction: 'desc' },
    limit: 50,
  }];
  const [activeId, setActiveId] = useStateSV(() => safeDefinitions[0]?.id || '');
  const activeDefinition = safeDefinitions.find(item => item.id === activeId) || safeDefinitions[0];
  // The switcher overrides the saved layout for as long as you stay on this
  // definition. Tying the override to a definition id means switching views
  // drops it, so each view opens the way it was saved.
  const [presentationOverride, setPresentationOverride] = useStateSV(null);
  const viewMode = presentationOverride && presentationOverride.id === activeDefinition?.id
    ? presentationOverride.mode
    : mnSmartViewPresentation(activeDefinition);
  const setViewMode = (mode) => setPresentationOverride({ id: activeDefinition?.id || '', mode });
  useEffectSV(() => {
    if (!activeDefinitionId) return;
    if (!safeDefinitions.some(item => item.id === activeDefinitionId)) return;
    setActiveId(activeDefinitionId);
  }, [activeDefinitionId, safeDefinitions]);
  const results = useMemoSV(() => (
    helpers.smartViewQuery
      ? helpers.smartViewQuery(notes, activeDefinition, { parser: MN_REMIND, walk: mnWalk, allNotes: notes })
      : []
  ), [helpers, notes, activeDefinition]);
  const resultCount = results.length;
  const tagCount = new Set(tags.map(tag => tag.name).filter(Boolean)).size;

  const renderResults = () => {
    if (viewMode === 'table') return mnSmartViewTable({ results, helpers, onOpen, T });
    if (viewMode === 'cards') return mnSmartViewCards({ results, helpers, onOpen, T });
    if (viewMode === 'timeline') return mnSmartViewTimeline({ results, helpers, onOpen, T });
    return mnSmartViewList({ results, helpers, onOpen, T });
  };

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: T.bg,
      color: T.ink,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '18px 22px 14px',
        borderBottom: `1px solid ${T.line}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 760, color: T.ink }}>Smart views</div>
          <div style={{ marginTop: 4, fontSize: 12, color: T.inkDim }}>
            {resultCount} result{resultCount === 1 ? '' : 's'} · {notes.length} notes · {tagCount} tags
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <select value={activeDefinition?.id || ''} onChange={(event) => {
            const nextId = event.target.value;
            setActiveId(nextId);
            onActiveDefinitionChange?.(nextId);
          }} style={{
            height: 32,
            border: `1px solid ${T.line}`,
            borderRadius: 7,
            background: T.bg,
            color: T.ink,
            padding: '0 10px',
            fontSize: 12.5,
          }}>
            {safeDefinitions.map(definition => (
              <option key={definition.id} value={definition.id}>{definition.title}</option>
            ))}
          </select>
          <div role="tablist" aria-label="Smart View presentation" style={{
            display: 'flex',
            border: `1px solid ${T.line}`,
            borderRadius: 7,
            overflow: 'hidden',
            background: T.bgSub || T.bg,
          }}>
            {MN_SMART_VIEW_PRESENTATIONS.map(mode => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                onClick={() => setViewMode(mode)}
                style={{
                  border: 0,
                  borderRight: mode === 'timeline' ? 0 : `1px solid ${T.line}`,
                  background: viewMode === mode ? T.ink : 'transparent',
                  color: viewMode === mode ? T.bg : T.inkMed,
                  padding: '7px 9px',
                  fontSize: 11.5,
                  fontWeight: 700,
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 22px 28px' }}>
        {!results.length ? (
          <div style={{
            maxWidth: 360,
            margin: '70px auto 0',
            textAlign: 'center',
            color: T.inkDim,
          }}>
            <div style={{ fontSize: 15, fontWeight: 720, color: T.ink, marginBottom: 8 }}>No Smart View results</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 14 }}>No notes or actions match this view.</div>
            <button type="button" onClick={onOpenAllNotes} style={{
              border: `1px solid ${T.line}`,
              borderRadius: 7,
              background: T.ink,
              color: T.bg,
              padding: '7px 11px',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}>
              Open Notes
            </button>
          </div>
        ) : renderResults()}
      </div>
    </div>
  );
}

export { MnSmartViewsPanel, mnSmartViewPresentation, mnSmartViewList, mnSmartViewTable, mnSmartViewCards, mnSmartViewTimeline };
