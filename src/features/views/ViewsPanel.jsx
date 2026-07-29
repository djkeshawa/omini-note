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
// The chrome is two rows, built to the v2 prototype: a tab bar where every
// saved view is a tab, and a control strip saying what a row is and how it
// is drawn. Its parts live in ViewsChrome.jsx to keep this file a shell.

import { MN_REMIND } from '../../shared/markdown.jsx';
import { DS_HEIGHT, DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';
import { DsEmptyState, DsGroupLabel } from '../../shared/components/DesignPrimitives.jsx';
import { MN_VIEW_LAYOUTS, mnViewLayout } from '../../shared/viewLayout.js';
import { mnViewsRenderResults } from './ViewsLayouts.jsx';
import { mnViewsRenderBoard, mnViewsBoardGroup } from './ViewsBoard.jsx';
import { mnViewsRenderCalendar } from './ViewsCalendar.jsx';
import { mnViewsActionItem } from './viewsWrite.js';
import { ViewTabs, ViewsRowSearch, ViewsSaveState, mnViewChipStyle } from './ViewsChrome.jsx';

// mnSentenceCase only rewrites ALL-CAPS strings, so it leaves a lowercase
// layout id alone. These are labels, not machine values, so they get a
// capital.
function mnViewLayoutLabel(mode) {
  const value = String(mode || '');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function mnViewsPrimaryButton(T) {
  return {
    height: DS_HEIGHT.primary, padding: '0 14px',
    borderRadius: DS_RADIUS.control, border: 'none',
    background: T.ink, color: T.bg, cursor: 'pointer',
    fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600,
  };
}

// The row search runs over what the row actually shows — its own text, the
// note it came from, and the preview — so what you type matches what you see.
function mnViewsRowMatches(result, needle) {
  if (!needle) return true;
  const haystack = [
    result?.title, result?.label, result?.text,
    result?.sourceNoteTitle, result?.noteTitle, result?.note?.title,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
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
  onUpdateTaskItem,
  onNotice,
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
  const [rowQuery, setRowQuery] = useStateV('');
  const layout = layoutOverride && layoutOverride.id === activeDefinition?.id
    ? layoutOverride.mode
    : mnViewLayout(activeDefinition);

  const results = useMemoV(() => (
    helpers.smartViewQuery
      ? helpers.smartViewQuery(notes, activeDefinition, { parser: MN_REMIND, walk, allNotes: notes })
      : []
  ), [helpers, notes, activeDefinition, walk]);

  const needle = rowQuery.trim().toLowerCase();
  const visibleResults = useMemoV(
    () => (needle ? results.filter(result => mnViewsRowMatches(result, needle)) : results),
    [results, needle]
  );

  // A definition can say how to group its rows — by tag, or by any property
  // the notes carry. This is the first thing to actually read that field;
  // ungrouped views come back as a single unlabelled bucket.
  const groups = useMemoV(() => {
    if (!helpers.smartViewGroup) return null;
    // A board is columns, so it always groups; every other layout groups only
    // when the definition asks for it.
    const group = layout === 'board' ? mnViewsBoardGroup(activeDefinition) : activeDefinition?.group;
    if (!group?.by) return null;
    return helpers.smartViewGroup(visibleResults, group, {});
  }, [helpers, visibleResults, activeDefinition, layout]);

  // Ticking a task from a view writes to the note it came from. The row
  // remembers the block it was parsed out of, so the edit lands exactly
  // there; when that anchor is gone and the text is ambiguous we say so
  // rather than editing a line that might be the wrong one.
  const toggleCheck = (result) => {
    if (!onUpdateTaskItem) return;
    const note = (notes || []).find(candidate => candidate.id === result.noteId) || null;
    const resolved = mnViewsActionItem(result, { note, walk });
    if (!resolved.ok) {
      onNotice?.(
        'That task could not be updated',
        resolved.reason === 'ambiguous'
          ? 'The same line appears more than once in that note, so there is no way to tell which one you meant. Open the note and tick it there.'
          : 'The line this row came from is no longer in that note. Open the note to check it.',
        'warn'
      );
      return;
    }
    const ok = onUpdateTaskItem(resolved.item, { checked: !result.checked });
    if (ok === false) {
      onNotice?.('That task could not be updated', 'The note it came from did not change. Open the note to edit it directly.', 'warn');
    }
  };

  // Tabs carry their own counts, so the shape of the vault is legible without
  // opening each view. That is one whole-vault query per saved view; it is
  // bounded by the 24-definition cap and only runs while Views is on screen.
  const tabCounts = useMemoV(() => {
    if (!helpers.smartViewQuery) return {};
    const counts = {};
    safeDefinitions.forEach(definition => {
      counts[definition.id] = definition.id === activeDefinition?.id
        ? results.length
        : helpers.smartViewQuery(notes, definition, { parser: MN_REMIND, walk, allNotes: notes }).length;
    });
    return counts;
  }, [helpers, notes, safeDefinitions, walk, activeDefinition, results]);

  const selectDefinition = (id) => {
    setActiveId(id);
    setLayoutOverride(null);
    setRowQuery('');
    onActiveDefinitionChange?.(id);
  };

  return (
    <div
      data-mn-views-panel="true"
      style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>

      {/* Tab bar. Every saved view is a tab carrying its own count, so the
          shape of the vault is legible without opening anything. */}
      <div style={{
        height: 46, flexShrink: 0, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 4, padding: '0 20px',
        borderBottom: `1px solid ${T.lineSub}`, position: 'relative', zIndex: 2,
      }} role="tablist" aria-label="Saved views">
        <span style={{
          fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600,
          color: T.ink, marginRight: 10,
        }}>Views</span>
        <ViewTabs
          definitions={safeDefinitions}
          activeId={activeDefinition?.id}
          counts={tabCounts}
          onPick={selectDefinition}
          onOpenMenu={() => onNotice?.('Not wired up yet', 'Renaming, duplicating and deleting a view arrive in the next step.', 'info')}
          onNewView={() => onNotice?.('Not wired up yet', 'Creating a view arrives in the next step.', 'info')}
          T={T}
        />
        <span style={{ flex: 1 }} />
        <ViewsRowSearch
          value={rowQuery}
          onChange={event => setRowQuery(event.target.value)}
          onClear={() => setRowQuery('')}
          T={T}
        />
        <ViewsSaveState dirty={false} T={T} />
      </div>

      {/* Control strip: what a row is, and how it is drawn. */}
      <div style={{
        height: 48, flexShrink: 0, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 7, padding: '0 20px',
        borderBottom: `1px solid ${T.lineSub}`, background: T.bgSub,
        position: 'relative', zIndex: 1,
      }}>
        <span style={mnViewChipStyle(false, T)} title="What one row in this view is">
          Rows
          <span style={{ fontWeight: 600, color: T.ink }}>{String(activeDefinition?.type || 'notes')}</span>
        </span>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: T.lineSub, margin: '0 3px' }} />
        <span style={{ ...dsMachineStyle(T), fontSize: 11 }}>
          {visibleResults.length}{rowQuery ? ` of ${results.length}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <div role="tablist" aria-label="Layout" style={{
          display: 'flex', padding: 2, gap: 2,
          borderRadius: DS_RADIUS.control,
          background: T.bg, border: `1px solid ${T.lineSub}`,
        }}>
          {MN_VIEW_LAYOUTS.map(mode => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={layout === mode}
              onClick={() => setLayoutOverride({ id: activeDefinition?.id || '', mode })}
              style={{
                height: 24, padding: '0 11px',
                borderRadius: DS_RADIUS.icon,
                border: `1px solid ${layout === mode ? T.selLine : 'transparent'}`,
                background: layout === mode ? T.selBg : 'transparent',
                color: layout === mode ? T.ink : T.inkMed,
                fontFamily: 'var(--mn-ui)', fontSize: 12,
                fontWeight: layout === mode ? 600 : 400,
                cursor: 'pointer',
              }}>{mnViewLayoutLabel(mode)}</button>
          ))}
        </div>
      </div>

      <div
        data-mn-views-body="true"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px 24px' }}>
        {visibleResults.length
          ? (layout === 'calendar'
            ? mnViewsRenderCalendar({
              results: visibleResults, helpers, onOpen, weekStart, T,
              anchor: calendarAnchor,
              onAnchorChange: setCalendarAnchor,
            })
            : layout === 'board'
            ? mnViewsRenderBoard({ groups: groups || [], helpers, onOpen, onToggleCheck: toggleCheck, T })
            : groups
            ? groups
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
            : mnViewsRenderResults({ layout, results: visibleResults, helpers, onOpen, T }))
          : (
            <DsEmptyState
              headline={rowQuery ? 'No rows match that search' : 'Nothing matches this view yet'}
              body={rowQuery
                ? 'The search runs over the rows this view returned. Clear it to see them all.'
                : 'Views read your notes live. Narrow or widen the definition, or write a note that fits it.'}
              action={rowQuery ? (
                <button type="button" onClick={() => setRowQuery('')} style={mnViewsPrimaryButton(T)}>Clear search</button>
              ) : onOpenAllNotes ? (
                <button type="button" onClick={onOpenAllNotes} style={mnViewsPrimaryButton(T)}>Open all notes</button>
              ) : null}
              T={T}
            />
          )}
      </div>
    </div>
  );
}

export { MnViewsPanel, MN_VIEWS_FALLBACK };
const { useEffect: useEffectV, useMemo: useMemoV, useState: useStateV } = React;
