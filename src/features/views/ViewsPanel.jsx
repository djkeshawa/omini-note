// Views — one saved surface for looking at notes, tasks and dates.
//
// The query engine already exists: this reads the same saved definitions the
// Smart Views panel does, so a definition written by either opens in both.
// What is new is the shell — a view list you navigate, a header that says
// what the view is, and a layout that comes from the definition rather than
// from wherever you last clicked.
//
// `helpers`, `walk` and `parser` arrive as props rather than imports: a
// feature may not reach into src/app, and passing them keeps the panel
// testable without a module graph.
//
// Board and calendar layouts land in later steps.

import { MN_REMIND } from '../../shared/markdown.jsx';
import { DS_HEIGHT, DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';
import { DsEmptyState, DsGroupLabel } from '../../shared/components/DesignPrimitives.jsx';
import { MN_VIEW_LAYOUTS, mnViewLayout } from '../../shared/viewLayout.js';
import { mnViewsRenderResults } from './ViewsLayouts.jsx';
import { mnViewsRenderBoard, mnViewsBoardGroup } from './ViewsBoard.jsx';
import { mnViewsRenderCalendar } from './ViewsCalendar.jsx';

function ViewRow({ definition, active, onSelect, T }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => onSelect(definition.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        height: DS_HEIGHT.navRow, padding: '0 10px',
        border: `1px solid ${active ? T.selLine : 'transparent'}`,
        borderRadius: DS_RADIUS.row,
        background: active ? T.selBg : 'transparent',
        color: T.ink, cursor: 'pointer', textAlign: 'left',
        fontFamily: 'var(--mn-ui)', fontSize: 13,
        fontWeight: active ? 600 : 400,
      }}>
      <span style={{
        flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{definition.title || 'Untitled view'}</span>
    </button>
  );
}

// mnSentenceCase only rewrites ALL-CAPS strings, so it leaves a lowercase
// layout id alone. These are labels, not machine values, so they get a
// capital.
function mnViewLayoutLabel(mode) {
  const value = String(mode || '');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const MN_VIEWS_FALLBACK = {
  id: 'all_notes',
  title: 'All notes',
  type: 'notes',
  filters: {},
  sort: { field: 'modified', direction: 'desc' },
  limit: 50,
  layout: 'list',
};

function MnViewsPanel({
  notes = [],
  definitions = [],
  activeDefinitionId = '',
  onActiveDefinitionChange,
  onOpen,
  onOpenAllNotes,
  weekStart = 'monday',
  helpers = {},
  walk,
  T,
}) {
  const safeDefinitions = definitions.length ? definitions : [MN_VIEWS_FALLBACK];
  const [activeId, setActiveId] = useStateV(() => activeDefinitionId || safeDefinitions[0]?.id || '');
  const activeDefinition = safeDefinitions.find(item => item.id === activeId) || safeDefinitions[0];

  useEffectV(() => {
    if (!activeDefinitionId) return;
    if (!safeDefinitions.some(item => item.id === activeDefinitionId)) return;
    setActiveId(activeDefinitionId);
  }, [activeDefinitionId, safeDefinitions]);

  // The saved layout is what a view opens as. The switcher overrides it only
  // while you stay on that view, so each one keeps the shape it was given.
  const [layoutOverride, setLayoutOverride] = useStateV(null);
  const [calendarAnchor, setCalendarAnchor] = useStateV(() => new Date());
  const layout = layoutOverride && layoutOverride.id === activeDefinition?.id
    ? layoutOverride.mode
    : mnViewLayout(activeDefinition);

  const results = useMemoV(() => (
    helpers.smartViewQuery
      ? helpers.smartViewQuery(notes, activeDefinition, { parser: MN_REMIND, walk, allNotes: notes })
      : []
  ), [helpers, notes, activeDefinition, walk]);

  // A definition can say how to group its rows — by tag, or by any property
  // the notes carry. This is the first thing to actually read that field;
  // ungrouped views come back as a single unlabelled bucket.
  const groups = useMemoV(() => {
    if (!helpers.smartViewGroup) return null;
    // A board is columns, so it always groups; every other layout groups only
    // when the definition asks for it.
    const group = layout === 'board' ? mnViewsBoardGroup(activeDefinition) : activeDefinition?.group;
    if (!group?.by) return null;
    return helpers.smartViewGroup(results, group, {});
  }, [helpers, results, activeDefinition, layout]);

  const selectDefinition = (id) => {
    setActiveId(id);
    setLayoutOverride(null);
    onActiveDefinitionChange?.(id);
  };

  return (
    <div
      data-mn-views-panel="true"
      style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', background: T.bg }}>

      <div style={{
        width: 232, flexShrink: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        borderRight: `1px solid ${T.lineSub}`, background: T.bgSub,
      }}>
        <div style={{
          height: DS_HEIGHT.panelHeader, flexShrink: 0, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
          borderBottom: `1px solid ${T.lineSub}`,
        }}>
          <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>Views</span>
          <span style={{ ...dsMachineStyle(T), fontSize: 11 }}>{safeDefinitions.length}</span>
        </div>
        <div role="listbox" aria-label="Saved views" style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {safeDefinitions.map(definition => (
            <ViewRow
              key={definition.id}
              definition={definition}
              active={definition.id === activeDefinition?.id}
              onSelect={selectDefinition}
              T={T}
            />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          height: DS_HEIGHT.panelHeader, flexShrink: 0, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px',
          borderBottom: `1px solid ${T.lineSub}`,
        }}>
          <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>
            {activeDefinition?.title || 'Untitled view'}
          </span>
          <span style={{ ...dsMachineStyle(T), fontSize: 11, whiteSpace: 'nowrap' }}>
            {results.length} {String(activeDefinition?.type || 'notes')}
          </span>
          <span style={{ flex: 1 }} />
          <div role="tablist" aria-label="Layout" style={{
            display: 'flex', padding: 2, gap: 2,
            borderRadius: DS_RADIUS.control,
            background: T.bgSub, border: `1px solid ${T.lineSub}`,
          }}>
            {MN_VIEW_LAYOUTS.map(mode => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={layout === mode}
                onClick={() => setLayoutOverride({ id: activeDefinition?.id || '', mode })}
                style={{
                  height: 24, padding: '0 10px',
                  borderRadius: DS_RADIUS.icon,
                  border: `1px solid ${layout === mode ? T.lineSub : 'transparent'}`,
                  background: layout === mode ? T.bg : 'transparent',
                  color: layout === mode ? T.ink : T.inkMed,
                  fontFamily: 'var(--mn-ui)', fontSize: 12,
                  fontWeight: layout === mode ? 600 : 400,
                  cursor: 'pointer',
                }}>{mnViewLayoutLabel(mode)}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px 24px' }}>
          {results.length
            ? (layout === 'calendar'
              ? mnViewsRenderCalendar({
                results, helpers, onOpen, weekStart, T,
                anchor: calendarAnchor,
                onAnchorChange: setCalendarAnchor,
              })
              : layout === 'board'
              ? mnViewsRenderBoard({ groups: groups || [], helpers, onOpen, T })
              : groups
              ? groups
                // An empty unfiled bucket is noise; a populated one is a
                // finding, so it stays.
                .filter(bucket => bucket.items.length)
                .map(bucket => (
                  <div key={bucket.key || '__unfiled'} style={{ marginBottom: 18 }}>
                    <DsGroupLabel
                      label={bucket.label || 'Ungrouped'}
                      count={bucket.items.length}
                      rule
                      T={T}
                      style={{ marginBottom: 8 }}
                    />
                    {mnViewsRenderResults({ layout, results: bucket.items, helpers, onOpen, T })}
                  </div>
                ))
              : mnViewsRenderResults({ layout, results, helpers, onOpen, T }))
            : (
              <DsEmptyState
                headline="Nothing matches this view yet"
                body="Views read your notes live. Narrow or widen the definition, or write a note that fits it."
                action={onOpenAllNotes ? (
                  <button type="button" onClick={onOpenAllNotes} style={{
                    height: DS_HEIGHT.primary, padding: '0 14px',
                    borderRadius: DS_RADIUS.control, border: 'none',
                    background: T.ink, color: T.bg, cursor: 'pointer',
                    fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600,
                  }}>Open all notes</button>
                ) : null}
                T={T}
              />
            )}
        </div>
      </div>
    </div>
  );
}

export { MnViewsPanel, MN_VIEWS_FALLBACK };
const { useEffect: useEffectV, useMemo: useMemoV, useState: useStateV } = React;
