const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');
const { createSmartViewHelpers } = require('../src/app/helpers/smartViewHelpers.js');

// Called with nothing. Every helper in the Today/Views layer takes an options
// bag, and the renderer routinely omits it -- so each default has to hold on
// its own. These cases use the real clock deliberately: what is pinned is that
// the defaults exist and are self-consistent, not what today's date is.

test('the Today helpers all work with no options at all', () => {
  assert.equal(typeof helpers.todayIsoDate(), 'string');
  const today = helpers.todayIsoDate();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

  const bounds = helpers.rollupDateRangeBounds();
  assert.deepEqual(bounds, { start: today, end: today, today }, 'the default range is today');
  assert.equal(helpers.rollupDateRangeBounds('week').start <= today, true);
  assert.equal(helpers.rollupDateKeyInRange(today), true);
  assert.equal(helpers.rollupDateKeyInRange('1999-01-01'), false);
  assert.equal(helpers.rollupIsOlderGroup('1999-01-01'), true);
  assert.equal(helpers.rollupIsOlderGroup(today), false);

  const notes = [{ id: 'n1', title: 'Today', date: new Date().toISOString(), tags: [] }];
  assert.equal(helpers.rollupGroupNotes(notes).length, 1, 'grouping with no options groups today');
  assert.equal(helpers.rollupGroupNotes(notes)[0].key, today);
  assert.equal(helpers.rollupFilterTaskItems([], notes).length, 0);
  assert.equal(helpers.rollupFilterReminderItems([], notes).length, 0);
  assert.equal(helpers.rollupFindDailyNote([{ id: 'd', title: today }]).id, 'd');
  assert.equal(helpers.rollupTaskReasonLabel(), 'source note');
  assert.equal(helpers.agendaActionStatus(), 'unscheduled');
  assert.equal(helpers.agendaActionReasonLabel(), 'source note');
  assert.equal(helpers.agendaActionDetail().status, 'unscheduled');
  assert.deepEqual(helpers.agendaDecorateActionItems(), []);
  assert.deepEqual(helpers.agendaFilterActionItems(), []);
  assert.equal(helpers.agendaIsDeferred({}), false);
  assert.match(helpers.rollupAppendReflection(''), new RegExp(`## Reflection - ${today}`));
  assert.match(helpers.rollupBuildEndDayRecap(), new RegExp(`^## End-day recap - ${today}`));
  assert.match(helpers.rollupAppendEndDayRecap(''), /## End-day recap/);
  assert.ok(helpers.agendaParseScheduleInput('today').ok, 'a schedule phrase parses against the real clock');
});

test('an action row falls back to the note title when it has no text of its own', () => {
  const recap = helpers.rollupBuildEndDayRecap({
    notes: [{ id: 'n1', title: 'Today note', date: new Date().toISOString(), tags: [], body: '' }],
    tasks: [
      { type: 'todo', noteId: 'n1', noteTitle: 'A source note', checked: false },
      { type: 'todo', noteId: 'n1', noteTitle: 'Another', text: '  a  task  ', checked: false },
    ],
  });
  assert.match(recap, /- \[ \] A source note \(A source note\)/m,
    'a task with no label of its own is listed by the note it came from');
  assert.match(recap, /- \[ \] a task \(Another\)/m, 'whitespace in a label is collapsed');
  assert.match(recap, /- \[\[Today note\]\]$/m, 'a note with no body is listed by its title alone');

  const withDecisions = helpers.rollupBuildEndDayRecap({
    notes: [{ id: 'n1', title: 'Meeting', date: new Date().toISOString(), tags: [], body: [
      'A decision was made to ship.',
      'Another decision: hire.',
      'Just prose.',
      'A third decision follows.',
    ].join('\n') }],
    limit: 2,
  });
  assert.equal((withDecisions.match(/### Decisions\n([\s\S]*?)\n\n/)[1].match(/^- /gm) || []).length, 2,
    'the decision list respects the limit it was given');
});

test('the Views helpers build even from a scope that declares nothing', () => {
  // appHelpers wires a full scope; a partial one must still produce helpers
  // that fall back to safe defaults rather than throwing on the first call.
  const bare = createSmartViewHelpers({
    SMART_VIEW_TYPES: ['notes'],
    SMART_VIEW_SORT_FIELDS: ['modified'],
    normalizeTagName: value => String(value || '').toLowerCase(),
    rollupDateKey: value => String(value || '').slice(0, 10),
    rollupIsValidIsoDateKey: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')),
    bodyPropertyLineRe: () => /(?!)/,
    bodyPropertyValue: () => '',
    novelTitleKey: value => String(value || '').toLowerCase(),
    novelWikiTitles: () => [],
    normalizeWorkflowStatus: () => '',
    agendaCleanActionText: text => String(text || ''),
    agendaIsDeferred: () => false,
    collectTaskItems: () => [],
    taskItemKey: () => 'key',
  });

  const definition = bare.smartViewNormalizeDefinition({});
  assert.equal(definition.layout, 'list', 'with no layouts declared, list is the only one');
  assert.equal(definition.type, 'notes');
  assert.equal(definition.limit, 100);

  assert.equal(bare.smartViewNormalizeLayout('table'), 'list', 'an undeclared layout is refused');
  assert.deepEqual(bare.smartViewNormalizeDefinition({ filters: { properties: [{ key: 'k', value: 'v', op: 'not' }] } })
    .filters.properties[0].op, 'is', 'with no operators declared, everything means `is`');

  assert.throws(() => bare.smartViewValidateSavedDefinition({ id: 'aView', title: 'A', format: 'anything' }),
    /Unsupported Smart View format/, 'with no format list, only the current format is accepted');
  assert.equal(bare.smartViewValidateSavedDefinition({ id: 'aView', title: 'A' }).format, undefined,
    'a scope that declares no format stamps none');
});

test('a view helper called with nothing still returns its empty shape', () => {
  assert.deepEqual(helpers.smartViewQuery(), []);
  assert.deepEqual(helpers.smartViewQueryNotes(), []);
  assert.deepEqual(helpers.smartViewQueryActions(), []);
  assert.deepEqual(helpers.smartViewGroup(), [{ key: '', label: '', items: [] }]);
  assert.equal(helpers.smartViewMatchesNote(), false, 'nothing is not a note, so it matches nothing');
  assert.equal(helpers.smartViewMatchesNote({ id: 'n1', tags: [] }), true, 'a view with no filters matches every note');
  assert.deepEqual(helpers.smartViewUpsertSavedDefinition([], { id: 'aView', title: 'A' }).length, 1);
  assert.equal(helpers.smartViewParseEmbedBlock(), null);
  assert.deepEqual(helpers.smartViewNormalizeDefinition().filters.properties, []);
});

test('the capture and workflow helpers survive being called bare', () => {
  assert.equal(helpers.captureTitleFromBody(), 'Untitled');
  assert.ok(helpers.captureTemplateChoices().length);
  assert.ok(helpers.captureDestinationChoices().length);
  assert.equal(helpers.captureDestinationById().id, 'new');
  assert.ok(helpers.expandCaptureTemplate().id);
  assert.ok(helpers.expandTemplate().id);
  assert.equal(helpers.captureBuildAppendMarkdown(), '');
  assert.equal(helpers.captureBuildSavePlan().type, 'capture-save-plan');
  assert.deepEqual(helpers.filterCommands(), []);
  assert.deepEqual(helpers.decorateNotesWithSearchDetails(), []);
  assert.equal(helpers.normalizeWorkflowStatus(), '');
  assert.equal(helpers.workflowNotePreview(), '');
  assert.deepEqual(helpers.collectWorkflowNotes().counts, {});
  assert.deepEqual(helpers.collectTaskItems(), []);
  assert.deepEqual(helpers.collectReminderItems(), []);
  assert.equal(helpers.zoteroBuildSourceNotePlan().action, 'unavailable');
  assert.equal(helpers.zoteroFindSourceNote(), null);
  assert.deepEqual(helpers.normalizeNovelImportCandidates(), []);
  assert.deepEqual(helpers.buildNovelImportPlan().summary, { candidates: 0, created: 0, updated: 0, skipped: 0 });
  assert.deepEqual(helpers.buildNovelistStructure().acts, []);
  assert.deepEqual(helpers.buildNovelistStarterNotes(), []);
  assert.deepEqual(helpers.normalizeNotes(), []);
  assert.equal(helpers.normalizeNoteBody(), '');
  assert.equal(helpers.contextualAiResult().type, 'contextual-ai-result');
  assert.deepEqual(helpers.contextualAiSourcesFromNotes(), []);
  assert.deepEqual(helpers.digestStaleTodoItems(), []);
  assert.deepEqual(helpers.digestUnlinkedRecentNotes(), []);
  assert.deepEqual(helpers.digestResurfacedNotes(), []);
  assert.deepEqual(helpers.digestUniqueActionItems(), []);
  assert.equal(helpers.digestActionItemKey(), '|untitled action|',
    'an item with nothing on it still keys consistently, so it dedupes against itself');
  assert.equal(helpers.digestActionItemKey(null), '||', 'a null entry keys without reading a label off it');
  assert.ok(helpers.contextualAiBuildTodayRecapContext().today);
  assert.ok(helpers.contextualAiBuildTodayRecapPrompt().length);
  assert.ok(helpers.contextualAiBuildTodayRecapResult().sections.length);
});
