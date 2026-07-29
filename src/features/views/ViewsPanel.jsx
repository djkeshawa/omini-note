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
import { mnViewsRenderTable } from './ViewsTable.jsx';
import {
  mnViewsNextSort, mnViewsSortIsStorable, mnViewsSortField, mnViewsSortFromDefinition,
  mnViewsColumns, mnViewsCatalogue, mnViewsToggleColumn, mnViewsMoveColumn,
} from './viewsColumns.js';
import { ViewsControlStrip } from './ViewsControlStrip.jsx';
import { mnViewsToggleScope, mnViewsClearScope } from './viewsScope.js';
import { mnViewsActionItem } from './viewsWrite.js';
import { ViewTabs, ViewMenu, ViewsRowSearch, ViewsSaveState, mnViewChipStyle } from './ViewsChrome.jsx';
import {
  mnViewsCreate, mnViewsDuplicate, mnViewsRename, mnViewsDelete,
  mnViewsApplyDraft, mnViewsDraftDiffers,
} from './viewsManage.js';

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
  onNotice,
  weekStart = 'monday',
  viewFormat,
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

  // A view opens as it was saved. Changing the layout edits a draft rather
  // than the saved definition, so the state pill can say the view has unsaved
  // changes instead of the change vanishing the next time you switch tabs.
  const [draft, setDraft] = useStateV(null);
  const [calendarAnchor, setCalendarAnchor] = useStateV(() => new Date());
  const [rowQuery, setRowQuery] = useStateV('');
  const [menuOpen, setMenuOpen] = useStateV(false);
  const [columnsOpen, setColumnsOpen] = useStateV(false);
  const [scopeOpen, setScopeOpen] = useStateV(false);
  const [confirmDelete, setConfirmDelete] = useStateV(false);
  const [renamingId, setRenamingId] = useStateV('');
  const [renameValue, setRenameValue] = useStateV('');

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
    setDraft(null);
    setRowQuery('');
    setTableSort(null);
    setMenuOpen(false);
    setColumnsOpen(false);
    setScopeOpen(false);
    setConfirmDelete(false);
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
    setMenuOpen(false);
    setConfirmDelete(false);
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
    setMenuOpen(false);
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
          renamingId={renamingId}
          renameValue={renameValue}
          onRenameInput={event => setRenameValue(event.target.value)}
          onRenameKey={event => {
            if (event.key === 'Enter') { event.preventDefault(); finishRename(); }
            if (event.key === 'Escape') { event.preventDefault(); setRenamingId(''); }
          }}
          onRenameEnd={finishRename}
          menu={menuOpen ? (
            <ViewMenu
              definition={activeDefinition || {}}
              canDelete={safeDefinitions.length > 1}
              confirming={confirmDelete}
              onRename={startRename}
              onDuplicate={() => commit(mnViewsDuplicate(safeDefinitions, activeDefinition?.id, { format: viewFormat }))}
              onDelete={() => setConfirmDelete(true)}
              onConfirmDelete={() => commit(mnViewsDelete(safeDefinitions, activeDefinition?.id))}
              onCancelDelete={() => { setConfirmDelete(false); setMenuOpen(false); }}
              T={T}
            />
          ) : null}
          onPick={selectDefinition}
          onOpenMenu={() => { setConfirmDelete(false); setMenuOpen(open => !open); }}
          onNewView={() => commit(mnViewsCreate(safeDefinitions, { title: 'New view', format: viewFormat }))}
          T={T}
        />
        <span style={{ flex: 1 }} />
        <ViewsRowSearch
          value={rowQuery}
          onChange={event => setRowQuery(event.target.value)}
          onClear={() => setRowQuery('')}
          T={T}
        />
        <ViewsSaveState
          dirty={dirty}
          onRevert={() => setDraft(null)}
          onSave={() => commit(mnViewsApplyDraft(safeDefinitions, activeDraft))}
          T={T}
        />
      </div>

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
        scopeOpen={scopeOpen}
        columnsOpen={columnsOpen}
        onToggleScopeMenu={() => setScopeOpen(open => !open)}
        onToggleColumnsMenu={() => setColumnsOpen(open => !open)}
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
        {visibleResults.length
          ? (layout === 'calendar'
            ? mnViewsRenderCalendar({
              results: visibleResults, helpers, onOpen, weekStart, T,
              anchor: calendarAnchor,
              onAnchorChange: setCalendarAnchor,
            })
            : layout === 'board'
            ? mnViewsRenderBoard({ groups: groups || [], helpers, onOpen, onToggleCheck: toggleCheck, T })
            : layout === 'table'
            ? mnViewsRenderTable({
              results: visibleResults, definition: queryDefinition, sort,
              onSort: sortByColumn, onOpen, onToggleCheck: toggleCheck, helpers, T,
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
