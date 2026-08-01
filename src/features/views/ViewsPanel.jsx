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
import { mnTagHueMap } from '../../shared/theme.jsx';
import { mnViewsRenderResults } from './ViewsLayouts.jsx';
import { mnViewsRenderBoard, mnViewsBoardGroup } from './ViewsBoard.jsx';
import { mnViewsRenderCalendar } from './ViewsCalendar.jsx';
import { mnViewsRenderTable } from './ViewsTable.jsx';
import { useViewsPlanner } from './useViewsPlanner.js';
import { useViewsRowActions } from './useViewsRowActions.js';
import { mnViewsOrderIsSet } from './viewsOrder.js';
import {
  mnViewsNextSort, mnViewsSortIsStorable, mnViewsSortField, mnViewsSortFromDefinition,
  mnViewsColumns, mnViewsCatalogue, mnViewsToggleColumn, mnViewsMoveColumn,
  mnViewsDiscoverProperties,
} from './viewsColumns.js';
import { ViewsControlStrip } from './ViewsControlStrip.jsx';
import { mnViewsToggleScope, mnViewsClearScope } from './viewsScope.js';
import {
  mnViewsAddCondition, mnViewsUpdateCondition, mnViewsRemoveCondition,
  mnViewsSetConditionsMatch, mnViewsClearConditions,
} from './viewsConditions.js';
import { ViewsTabBar, mnViewChipStyle } from './ViewsChrome.jsx';
import {
  mnViewsCreate, mnViewsDuplicate, mnViewsRename, mnViewsDelete,
  mnViewsApplyDraft, mnViewsDraftDiffers,
} from './viewsManage.js';
import { useViewsDropdownMenu } from './useViewsDropdownMenu.js';

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

// Every refusal from the management layer is a reason code; this is the only
// place that turns one into a sentence, so the wording stays in one file.
const MN_VIEWS_REFUSALS = {
  cap: ['That is as many views as a vault holds', 'A vault keeps up to 24 saved views. Delete one you no longer use, then try again.'],
  last: ['That view cannot be deleted', 'A vault keeps at least one view. Make another one first, then delete this.'],
  duplicate: ['That name is already taken', 'Another view already uses that name. Views are told apart by name, so pick a different one.'],
  empty: ['A view needs a name', 'Type a name for this view before saving it.'],
  missing: ['That view is no longer there', 'It may have been deleted in another window. Pick a view from the tabs above.'],
  id: ['That view could not be created', 'The name produced an identifier the vault cannot store. Try a name with some letters or numbers in it.'],
};

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
  tags = [],
  definitions = [],
  activeDefinitionId = '',
  onActiveDefinitionChange,
  onDefinitionsChange,
  onOpen,
  onOpenAllNotes,
  onUpdateTaskItem,
  onRenameNote,
  onSetProperty,
  onCreateItem,
  onCreateNote,
  onNotice,
  selectedNoteId = '',
  snoozeMinutes = '15',
  weekStart = 'monday',
  viewFormat,
  helpers = {},
  walk,
  theme,
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

  // A view opens as it was saved. Changing the layout edits a draft rather
  // than the saved definition, so the state pill can say the view has unsaved
  // changes instead of the change vanishing the next time you switch tabs.
  const [draft, setDraft] = useStateV(null);
  const [calendarAnchor, setCalendarAnchor] = useStateV(() => new Date());
  // A hand-made arrangement of the cards, per view. It is not saved with the
  // definition — see viewsOrder.js for why — so it is held here and dropped
  // when you leave the view, and the strip says so while it is in force.
  const [cardOrder, setCardOrder] = useStateV({});
  const [rowQuery, setRowQuery] = useStateV('');
  const [confirmDelete, setConfirmDelete] = useStateV(false);
  const [renamingId, setRenamingId] = useStateV('');
  const [renameValue, setRenameValue] = useStateV('');
  const { openMenu, closeMenu, toggleMenu } = useViewsDropdownMenu(() => setConfirmDelete(false));
  const menuOpen = openMenu === 'view';
  const columnsOpen = openMenu === 'columns';
  const scopeOpen = openMenu === 'scope';
  const conditionsOpen = openMenu === 'conditions';

  // The table's sort starts as whatever the view was saved with. Only four
  // fields survive a save, so a sort on anything else lives here and nowhere
  // else; the header says which kind you are looking at.
  const [tableSort, setTableSort] = useStateV(null);
  const activeDraft = draft && draft.id === activeDefinition?.id ? draft : null;
  const dirty = mnViewsDraftDiffers(activeDefinition, activeDraft);
  // Everything downstream reads the draft-merged definition, so a scope or a
  // column you change shows its effect before you decide whether to keep it.
  const queryDefinition = activeDraft ? { ...activeDefinition, ...activeDraft } : activeDefinition;
  const layout = activeDraft?.layout || mnViewLayout(activeDefinition);

  const results = useMemoV(() => (
    helpers.smartViewQuery
      ? helpers.smartViewQuery(notes, queryDefinition, { parser: MN_REMIND, walk, allNotes: notes })
      : []
  ), [helpers, notes, queryDefinition, walk]);

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
    const group = layout === 'board' ? mnViewsBoardGroup(queryDefinition) : queryDefinition?.group;
    if (!group?.by) return null;
    return helpers.smartViewGroup(visibleResults, group, {});
  }, [helpers, visibleResults, queryDefinition, layout]);

  // Everything a gesture on a row can mean — tick it, retype it, drag it into
  // another column — resolves to a write in useViewsRowActions, which is also
  // where a refusal gets its sentence.
  const { writeRow, toggleCheck, renameRow, moveCard } = useViewsRowActions({
    notes, walk, onUpdateTaskItem, onRenameNote, onSetProperty, onNotice,
  });
  const canRename = (onRenameNote || onUpdateTaskItem) ? renameRow : null;

  // The colour a row wears comes from its first registered tag, so a card here
  // and the same note in the sidebar are the same colour.
  const tagHue = useMemoV(() => mnTagHueMap(tags), [tags]);

  // The planner turns itself off when nothing is wired to write with, so a
  // Views panel mounted without the planning actions draws a plain month grid
  // rather than a form whose every button would refuse.
  const plan = useViewsPlanner({
    rows: visibleResults, notes, selectedNoteId, helpers, snoozeMinutes,
    onCreateItem, onCreateNote, onWriteRow: onUpdateTaskItem ? writeRow : null,
    onRenameRow: canRename, onNotice,
  });

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

  // One bag of everything a layout needs to draw a row and write to it, so the
  // four call sites below stay readable and cannot drift apart.
  const rowProps = {
    helpers, onOpen, onToggleCheck: toggleCheck,
    onRename: canRename,
    tagHue, theme, T,
  };
  const activeOrder = cardOrder[activeDefinition?.id || ''] || null;
  const setActiveOrder = (next) => setCardOrder(current => ({ ...current, [activeDefinition?.id || '']: next }));
  const arranged = layout === 'cards' && mnViewsOrderIsSet(activeOrder, visibleResults);

  const selectDefinition = (id) => {
    setActiveId(id);
    setDraft(null);
    setRowQuery('');
    setTableSort(null);
    closeMenu();
    setRenamingId('');
    onActiveDefinitionChange?.(id);
  };

  // Every management action lands here: apply the transform, explain a refusal,
  // otherwise persist the whole list and follow the result.
  const commit = (result) => {
    if (!result?.ok) {
      const [headline, body] = MN_VIEWS_REFUSALS[result?.reason] || MN_VIEWS_REFUSALS.missing;
      onNotice?.(headline, body, 'warn');
      return false;
    }
    if (!onDefinitionsChange) {
      onNotice?.('Views cannot be changed here', 'This window has no way to save view settings.', 'warn');
      return false;
    }
    // A false return means the save was refused further down; leaving the draft
    // in place keeps the change on screen rather than silently dropping it.
    if (onDefinitionsChange(result.definitions) === false) return false;
    setDraft(null);
    closeMenu();
    setRenamingId('');
    if (result.activeId && result.activeId !== activeId) selectDefinition(result.activeId);
    return true;
  };

  const sort = tableSort || mnViewsSortFromDefinition(activeDefinition);

  const catalogue = useMemoV(
    () => mnViewsCatalogue(queryDefinition, visibleResults),
    [queryDefinition, visibleResults]
  );
  const visibleColumnKeys = mnViewsColumns(queryDefinition).map(column => column.key);

  // Conditions are tested against keys discovered from the whole vault, not
  // from the rows currently showing: a condition that matches nothing would
  // otherwise empty the very list you need in order to correct it.
  const conditionKeys = useMemoV(
    () => mnViewsDiscoverProperties((notes || []).map(note => ({ note })), []).map(column => column.key),
    [notes]
  );

  const MN_VIEWS_FILTER_REFUSALS = {
    cap: ['That is as many as a view holds', 'A view can carry up to 40 scope entries and 20 conditions. Remove one before adding another.'],
    long: ['That value is too long', 'A single condition value can be up to 500 characters.'],
    key: ['That condition needs a property', 'Pick the key this condition should test.'],
    missing: ['That condition is no longer there', 'It may have been removed already. Close the menu and open it again.'],
  };

  const editScope = (result) => {
    if (!result.ok) {
      onNotice?.(
        'That scope could not be set',
        result.reason === 'cap'
          ? 'A view can be scoped by up to 40 tags or links. Remove one before adding another.'
          : 'That tag or note name is too long to store.',
        'warn'
      );
      return;
    }
    setDraft(current => ({
      ...(current && current.id === activeDefinition?.id ? current : {}),
      id: activeDefinition?.id || '',
      filters: result.filters,
    }));
  };

  const editConditions = (result) => {
    if (!result.ok) {
      const [headline, body] = MN_VIEWS_FILTER_REFUSALS[result.reason] || MN_VIEWS_FILTER_REFUSALS.missing;
      onNotice?.(headline, body, 'warn');
      return;
    }
    setDraft(current => ({
      ...(current && current.id === activeDefinition?.id ? current : {}),
      id: activeDefinition?.id || '',
      filters: result.filters,
    }));
  };

  const editColumns = (result) => {
    if (!result.ok) {
      onNotice?.(
        result.reason === 'fixed' ? 'That column always shows' : 'That column is already at the end',
        result.reason === 'fixed'
          ? 'The first column is the row itself, so there is always something to click.'
          : 'There is nothing on that side to swap it with.',
        'info'
      );
      return;
    }
    setDraft(current => ({
      ...(current && current.id === activeDefinition?.id ? current : {}),
      id: activeDefinition?.id || '',
      columns: result.columns,
    }));
  };

  const sortByColumn = (key) => {
    const next = mnViewsNextSort(sort, key);
    setTableSort(next);
    // A sort the vault can store becomes part of the draft, so Save view keeps
    // it. One it cannot store is left out of the draft rather than saved as a
    // value the preference layer would reject.
    if (next && mnViewsSortIsStorable(next.key)) {
      setDraft(current => ({
        ...(current && current.id === activeDefinition?.id ? current : {}),
        id: activeDefinition?.id || '',
        sort: { field: mnViewsSortField(next.key), direction: next.direction },
      }));
    }
  };

  const startRename = () => {
    closeMenu();
    setRenameValue(activeDefinition?.title || '');
    setRenamingId(activeDefinition?.id || '');
  };

  const finishRename = () => {
    const id = renamingId;
    setRenamingId('');
    if (!id) return;
    const next = renameValue.trim();
    // Closing the box without changing anything is not a rename, and an empty
    // box is a cancel rather than an error worth interrupting for.
    if (!next || next === (activeDefinition?.title || '')) return;
    commit(mnViewsRename(safeDefinitions, id, next));
  };

  return (
    <div
      data-mn-views-panel="true"
      style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>

      <ViewsTabBar
        definitions={safeDefinitions}
        activeDefinition={activeDefinition}
        counts={tabCounts}
        dirty={dirty}
        rowQuery={rowQuery}
        renamingId={renamingId}
        renameValue={renameValue}
        menuOpen={menuOpen}
        confirmDelete={confirmDelete}
        onRenameInput={setRenameValue}
        onRenameCommit={finishRename}
        onRenameCancel={() => setRenamingId('')}
        onStartRename={startRename}
        onRowQuery={setRowQuery}
        onPick={selectDefinition}
        onOpenMenu={() => toggleMenu('view')}
        onCloseMenu={closeMenu}
        onNewView={() => commit(mnViewsCreate(safeDefinitions, { title: 'New view', format: viewFormat }))}
        onDuplicate={() => commit(mnViewsDuplicate(safeDefinitions, activeDefinition?.id, { format: viewFormat }))}
        onAskDelete={() => setConfirmDelete(true)}
        onConfirmDelete={() => commit(mnViewsDelete(safeDefinitions, activeDefinition?.id))}
        onRevert={() => setDraft(null)}
        onSave={() => commit(mnViewsApplyDraft(safeDefinitions, activeDraft))}
        T={T}
      />

      <ViewsControlStrip
        definition={queryDefinition}
        tags={tags}
        notes={notes}
        catalogue={catalogue}
        visibleColumns={visibleColumnKeys}
        rowCount={visibleResults.length}
        totalCount={results.length}
        filtered={Boolean(rowQuery)}
        layout={layout}
        conditionKeys={conditionKeys}
        scopeOpen={scopeOpen}
        columnsOpen={columnsOpen}
        conditionsOpen={conditionsOpen}
        onToggleScopeMenu={() => toggleMenu('scope')}
        onToggleColumnsMenu={() => toggleMenu('columns')}
        onToggleConditionsMenu={() => toggleMenu('conditions')}
        onAddCondition={key => editConditions(mnViewsAddCondition(queryDefinition, key))}
        onUpdateCondition={(index, patch) => editConditions(mnViewsUpdateCondition(queryDefinition, index, patch))}
        onRemoveCondition={index => editConditions(mnViewsRemoveCondition(queryDefinition, index))}
        onConditionsMatch={value => editConditions(mnViewsSetConditionsMatch(queryDefinition, value))}
        onClearConditions={() => editConditions(mnViewsClearConditions(queryDefinition))}
        onToggleTag={tag => editScope(mnViewsToggleScope(queryDefinition, 'tags', tag))}
        onToggleLink={title => editScope(mnViewsToggleScope(queryDefinition, 'linkedNotes', title))}
        onClearScope={() => editScope(mnViewsClearScope(queryDefinition))}
        onToggleColumn={key => editColumns(mnViewsToggleColumn(queryDefinition, key))}
        onMoveColumn={(key, delta) => editColumns(mnViewsMoveColumn(queryDefinition, key, delta))}
        onLayout={mode => setDraft(current => ({
          ...(current && current.id === activeDefinition?.id ? current : {}),
          id: activeDefinition?.id || '',
          layout: mode,
        }))}
        T={T}
      />

      <div
        data-mn-views-body="true"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px 24px' }}>
        {/* A hand-made arrangement overrides the view's sort, which is a
            surprising thing to have happen silently — so it says so, and says
            how to undo it, for as long as it is in force. */}
        {arranged && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ ...dsMachineStyle(T), fontSize: 11 }}>arranged by hand</span>
            <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim }}>
              Kept until you leave this view — a saved view stores a sort, not positions.
            </span>
            <button type="button" onClick={() => setActiveOrder(null)} style={mnViewChipStyle(false, T)}>Reset order</button>
          </div>
        )}
        {visibleResults.length
          ? (layout === 'calendar'
            ? mnViewsRenderCalendar({
              results: visibleResults, weekStart, plan,
              anchor: calendarAnchor, onAnchorChange: setCalendarAnchor,
              ...rowProps,
            })
            : layout === 'board'
            ? mnViewsRenderBoard({
              groups: groups || [], definition: queryDefinition,
              onMoveCard: onSetProperty ? moveCard : null,
              ...rowProps,
            })
            : layout === 'table'
            ? mnViewsRenderTable({
              results: visibleResults, definition: queryDefinition, sort, onSort: sortByColumn,
              ...rowProps,
            })
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
                  {mnViewsRenderResults({ layout, results: bucket.items, ...rowProps })}
                </div>
              ))
            : mnViewsRenderResults({
              layout, results: visibleResults,
              order: activeOrder, onReorder: setActiveOrder,
              ...rowProps,
            }))
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
