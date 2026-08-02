const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { outlinerSource } = require('./helpers/source.js');
const vm = require('node:vm');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const ops = require('../src/editor/editorOps.js');
const tableOps = require('../src/editor/tableOps.js');
const appHelpers = require('../src/app/appHelpers.js');
const appNovelist = require('../src/app/appNovelist.js');
const appMutations = require('../src/app/appMutations.js');
const appCanvasActions = require('../src/app/appCanvasActions.js');
const panelHelpers = require('../src/panels/panelHelpers.js');
const { aiActions } = loadRendererModule('src/ai/aiActions.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');

test('App helpers expand templates, rank commands, and decorate search results', () => {
  const expanded = appHelpers.expandTemplate(appHelpers.templateById('daily'), { date: '2026-05-06' });
  assert.equal(expanded.noteTitle, '2026-05-06');
  assert.match(expanded.body, /# 2026-05-06/);
  assert.deepEqual(expanded.tags, ['daily']);

  const commands = [
    { id: 'settings', title: 'Open settings', section: 'System' },
    { id: 'daily', title: 'Open daily note', section: 'Create', keywords: 'journal today' },
    { id: 'disabled', title: 'Daily disabled', enabled: false },
  ];
  assert.deepEqual(appHelpers.filterCommands(commands, 'daily').map(cmd => cmd.id), ['daily']);

  const notes = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }];
  const decorated = appHelpers.decorateNotesWithSearchDetails(notes, new Map([
    ['b', { snippet: 'matched body', matchedFields: ['body'] }],
  ]));
  assert.equal(decorated[0].__searchSnippet, undefined);
  assert.equal(decorated[1].__searchSnippet, 'matched body');
  assert.deepEqual(decorated[1].__matchedFields, ['body']);
});

test('Capture helpers expose deterministic destinations and templates', () => {
  const now = new Date('2026-06-06T10:00:00.000Z');
  const notes = [
    { id: 'today', title: '2026-06-06', body: '# 2026-06-06', date: now.toISOString() },
    { id: 'inbox', title: 'Inbox', body: '# Inbox' },
  ];
  const choices = appHelpers.captureDestinationChoices({
    notes,
    currentNote: { id: 'project', title: 'Project Alpha' },
    now,
  });

  assert.deepEqual(choices.map(item => item.id), ['today', 'inbox', 'current', 'new']);
  assert.equal(choices.find(item => item.id === 'today').noteId, 'today');
  assert.equal(choices.find(item => item.id === 'today').noteTitle, '2026-06-06');
  assert.equal(choices.find(item => item.id === 'inbox').noteId, 'inbox');
  assert.equal(choices.find(item => item.id === 'current').noteTitle, 'Project Alpha');
  assert.equal(appHelpers.captureDestinationChoices({ notes, now }).find(item => item.id === 'current').disabled, true);
  assert.equal(appHelpers.captureDestinationChoices({ notes, now }).find(item => item.id === 'current').fallbackDestinationId, 'new');

  const templateIds = appHelpers.captureTemplateChoices().map(item => item.id);
  assert.deepEqual(templateIds, ['meeting', 'research', 'book-paper', 'daily-reflection', 'task']);

  const meeting = appHelpers.expandCaptureTemplate('meeting', { date: '2026-06-06', text: 'Discuss launch' });
  assert.equal(meeting.noteTitle, 'Meeting - 2026-06-06');
  assert.deepEqual(meeting.tags, ['meeting']);
  assert.match(meeting.body, /type:: meeting/);
  assert.match(meeting.body, /Discuss launch/);

  const task = appHelpers.expandCaptureTemplate('task', { date: '2026-06-06', text: 'Email Sam' });
  assert.equal(task.noteTitle, 'Task - 2026-06-06');
  assert.match(task.body, /- \[ \] Email Sam/);

  assert.equal(appHelpers.captureTitleFromBody('\nstatus:: TODO\n# Project kickoff\nDetails'), 'Project kickoff');
  assert.equal(appHelpers.captureTitleFromBody('- [ ] Buy milk before six'), 'Buy milk before six');
  assert.equal(appHelpers.captureTitleFromBody('See [[Roadmap|the roadmap]] next'), 'See the roadmap next');
});

test('Capture save plans describe append and create behavior without mutation', () => {
  const now = new Date('2026-06-06T10:00:00.000Z');
  const notes = [
    { id: 'today', title: '2026-06-06', body: '# 2026-06-06', date: now.toISOString() },
  ];

  const todayPlan = appHelpers.captureBuildSavePlan({
    destinationId: 'today',
    templateId: 'task',
    text: 'Buy milk',
    notes,
    now,
  });
  assert.equal(todayPlan.action, 'append');
  assert.equal(todayPlan.noteId, 'today');
  assert.equal(todayPlan.destinationTitle, '2026-06-06');
  assert.deepEqual(todayPlan.tags, ['daily', 'task']);
  assert.match(todayPlan.appendText, /- \[ \] Buy milk/);
  assert.equal(todayPlan.createNote, null);

  const inboxPlan = appHelpers.captureBuildSavePlan({
    destinationId: 'inbox',
    templateId: 'research',
    text: 'Investigate local-first sync tradeoffs',
    notes,
    now,
  });
  assert.equal(inboxPlan.action, 'create');
  assert.equal(inboxPlan.destinationTitle, 'Inbox');
  assert.equal(inboxPlan.createNote.title, 'Inbox');
  assert.deepEqual(inboxPlan.createNote.tags, ['inbox', 'research']);
  assert.match(inboxPlan.createNote.body, /Investigate local-first sync tradeoffs/);

  const fallbackPlan = appHelpers.captureBuildSavePlan({
    destinationId: 'current',
    templateId: 'daily-reflection',
    text: 'Good progress',
    notes,
    now,
  });
  assert.equal(fallbackPlan.fellBack, true);
  assert.equal(fallbackPlan.destinationId, 'new');
  assert.equal(fallbackPlan.action, 'create');
  assert.equal(fallbackPlan.createNote.title, 'Reflection - 2026-06-06');
});

test('Phase 5 metric helpers record only allowlisted local counters', () => {
  assert.deepEqual(appHelpers.phase5MetricChoices().map(item => item.id), [
    'capture_saves',
    'zotero_source_notes',
    'theme_installs',
    'onboarding_mode_selections',
  ]);
  assert.equal(appHelpers.phase5NormalizeMetricKey('capture_saves'), 'capture_saves');
  assert.equal(appHelpers.phase5NormalizeMetricKey('constructor'), '');
  assert.throws(
    () => appHelpers.phase5RecordMetric(null, 'unsafe_metric'),
    /Unsupported Phase 5 metric key/
  );

  const first = appHelpers.phase5RecordMetric(null, 'capture_saves', {
    destinationId: 'today',
    templateId: 'daily reflection',
    noteTitle: 'Private title should be ignored',
  }, { now: '2026-06-07T08:00:00.000Z' });
  assert.equal(appHelpers.phase5MetricCount(first, 'capture_saves'), 1);
  assert.equal(first.events[0].key, 'capture_saves');
  assert.equal(first.events[0].at, '2026-06-07T08:00:00.000Z');
  assert.deepEqual(first.events[0].details, {
    destinationId: 'today',
    templateId: 'daily-reflection',
  });

  const second = appHelpers.phase5RecordMetric(first, 'zotero_source_notes', {
    mode: 'create',
    itemKey: 'ABCD1234',
  }, { now: '2026-06-07T09:00:00.000Z' });
  assert.equal(appHelpers.phase5MetricCount(second, 'capture_saves'), 1);
  assert.equal(appHelpers.phase5MetricCount(second, 'zotero_source_notes'), 1);
  assert.equal(second.events.length, 2);
  assert.deepEqual(second.events[1].details, { mode: 'create' });
  assert.doesNotMatch(JSON.stringify(appHelpers), /sendBeacon|XMLHttpRequest|fetch\(/);
});

test('Zotero source-note helpers build deterministic drafts and idempotent plans', () => {
  const readResult = {
    item: {
      key: 'ABCD1234',
      itemType: 'journalArticle',
      title: 'Attention Is All You Need',
      creators: 'Ashish Vaswani, Noam Shazeer',
      date: '2017-06-12',
      publicationTitle: 'NIPS',
      url: 'https://example.test/attention',
      doi: '10.5555/3295222.3295349',
      abstractNote: 'Transformer abstract',
    },
    attachments: [
      { key: 'ATTACH1', title: 'PDF', filename: 'attention.pdf', contentType: 'application/pdf' },
    ],
    fullText: 'Indexed PDF text with enough detail for an excerpt.',
    fullTextItemKey: 'ATTACH1',
    fullTextTruncated: true,
  };

  const draft = appHelpers.zoteroBuildSourceNoteDraft(readResult);
  assert.equal(draft.itemKey, 'ABCD1234');
  assert.equal(draft.title, 'Attention Is All You Need');
  assert.deepEqual(draft.tags, ['research', 'source', 'zotero']);
  assert.match(draft.body, /zoteroKey:: ABCD1234/);
  assert.match(draft.body, /creators:: Ashish Vaswani, Noam Shazeer/);
  assert.match(draft.body, /year:: 2017/);
  assert.match(draft.body, /doi:: 10\.5555\/3295222\.3295349/);
  assert.match(draft.body, /url:: https:\/\/example\.test\/attention/);
  assert.match(draft.body, /## Abstract\nTransformer abstract/);
  assert.match(draft.body, /## Attachments\n- PDF - attention\.pdf - application\/pdf - ATTACH1/);
  assert.match(draft.body, /## Full text excerpt\nIndexed PDF text/);
  assert.match(draft.body, /Excerpt truncated by VispNote/);
  assert.match(draft.body, /- \[ \] Extract key claims/);

  const createPlan = appHelpers.zoteroBuildSourceNotePlan({ readResult, notes: [] });
  assert.equal(createPlan.action, 'create');
  assert.equal(createPlan.createNote.title, 'Attention Is All You Need');
  assert.match(createPlan.createNote.body, /zoteroKey:: ABCD1234/);

  const existingPlan = appHelpers.zoteroBuildSourceNotePlan({
    itemKey: 'ABCD1234',
    readResult,
    notes: [{ id: 'n1', title: 'Existing source', body: '# Existing\n\nzoteroKey:: ABCD1234\n' }],
  });
  assert.equal(existingPlan.action, 'open');
  assert.equal(existingPlan.noteId, 'n1');
  assert.equal(existingPlan.createNote, null);

  const unavailable = appHelpers.zoteroBuildSourceNotePlan({
    readResult: { item: { key: '../bad', title: 'Unsafe' } },
    notes: [],
  });
  assert.equal(unavailable.action, 'unavailable');
  assert.match(unavailable.error, /valid Zotero item key/);
});

test('Contextual AI helpers preserve source, provider, and markdown markers', () => {
  const notes = [
    {
      id: 'n1',
      title: 'Project AI',
      tags: ['work'],
      body: 'status:: DOING\n# Project AI\nSee [[Research AI]]\n- [ ] Follow up #todo',
      modifiedAt: '2026-06-06T10:00:00.000Z',
    },
    {
      id: 'n1',
      title: 'Project AI duplicate',
      body: 'Duplicate should be ignored',
    },
  ];

  const sources = appHelpers.contextualAiSourcesFromNotes(notes);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 'n1');
  assert.equal(sources[0].title, 'Project AI');
  assert.match(sources[0].snippet, /Project AI/);

  const meta = appHelpers.contextualAiProviderMeta({
    config: { provider: 'openai', chatModel: 'gpt-4o-mini', piiReduction: true },
  });
  assert.deepEqual({
    provider: meta.provider,
    model: meta.model,
    providerModelLabel: meta.providerModelLabel,
    hosted: meta.hosted,
    piiReduction: meta.piiReduction,
  }, {
    provider: 'openai',
    model: 'gpt-4o-mini',
    providerModelLabel: 'OpenAI - gpt-4o-mini',
    hosted: true,
    piiReduction: true,
  });

  const result = appHelpers.contextualAiResult({
    status: { config: { provider: 'ollama', chatModel: 'gemma3' } },
    title: 'Today recap',
    outputKind: 'today-recap',
    sources,
    sections: {
      facts: [{ title: 'Changed today', content: 'Project AI changed.', sourceIds: ['n1'] }],
      suggestions: [{ title: 'Tomorrow', content: 'Plan follow-up.', sourceIds: ['n1'] }],
      previews: [{ title: 'Daily note append', content: '## AI recap' }],
    },
    createdAt: '2026-06-06T10:30:00.000Z',
  });
  assert.equal(result.type, 'contextual-ai-result');
  assert.equal(result.providerModelLabel, 'Ollama - gemma3');
  assert.equal(result.sources[0].title, 'Project AI');
  assert.deepEqual(result.sections.map(section => section.kind), ['fact', 'suggestion', 'preview']);

  const preserved = appHelpers.contextualAiCompareMarkdownMarkers(
    'status:: DOING\nSee [[Research AI]]\n- [ ] Follow up #todo',
    'status:: DOING\nSee [[Research AI]]\n- [ ] Follow up #todo\nMore detail'
  );
  assert.equal(preserved.ok, true);

  const missing = appHelpers.contextualAiCompareMarkdownMarkers(
    'status:: DOING\nSee [[Research AI]]\n- [ ] Follow up #todo',
    'See research\nFollow up'
  );
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingWikiLinks, ['Research AI']);
  assert.deepEqual(missing.missingTags, ['todo']);
  assert.deepEqual(missing.missingProperties, ['status']);
  assert.equal(missing.taskCountReduced, true);
});

test('Smart View helpers normalize definitions and query notes without mutation', () => {
  const notes = [
    {
      id: 'project',
      title: 'Project Alpha',
      tags: ['Project', 'AI'],
      date: '2026-06-01T10:00:00.000Z',
      modifiedAt: '2026-06-05T12:00:00.000Z',
      body: 'status:: DOING\npriority:: high\nSee [[Research AI]]\n- [ ] Ship prototype',
    },
    {
      id: 'research',
      title: 'Research AI',
      tags: ['research', 'ai'],
      date: '2026-05-20T09:00:00.000Z',
      modifiedAt: '2026-06-04T12:00:00.000Z',
      body: 'status:: TODO\npriority:: low\nReference notes',
    },
    {
      id: 'daily',
      title: '2026-06-06',
      tags: ['daily'],
      date: '2026-06-06T08:00:00.000Z',
      modifiedAt: '2026-06-06T09:00:00.000Z',
      body: 'Daily note',
    },
  ];
  const before = JSON.stringify(notes);
  const normalized = appHelpers.smartViewNormalizeDefinition({
    id: ' project-ai ',
    title: ' Project AI ',
    filters: {
      tag: ' AI ',
      titleContains: ' project ',
      createdFrom: '2026-06-01T00:00:00.000Z',
      createdTo: '2026-06-06',
      propertyKey: 'priority',
      propertyValue: ' high ',
      workflowStatus: 'doing',
      linkedNote: 'Research AI',
    },
    sort: { field: 'created', direction: 'asc' },
    limit: 2,
  });

  assert.deepEqual(normalized, {
    id: 'project-ai',
    title: 'Project AI',
    type: 'notes',
    filters: {
      titleContains: 'project',
      tags: ['ai'],
      createdFrom: '2026-06-01',
      createdTo: '2026-06-06',
      modifiedFrom: '',
      modifiedTo: '',
      // A definition written before operators existed normalizes to "is",
      // matched all-of, so it keeps meaning exactly what it meant.
      properties: [{ key: 'priority', values: ['high'], op: 'is' }],
      propertiesMatch: 'all',
      // Scope defaults the other way: two tags mean "either", because
      // requiring both silently emptied the very list scope is meant to narrow.
      tagsMatch: 'any',
      linkedNotesMatch: 'any',
      workflowStatuses: ['DOING'],
      linkedNotes: ['Research AI'],
      actionStatuses: [],
      actionTypes: [],
      reminderFrom: '',
      reminderTo: '',
    },
    sort: { field: 'created', direction: 'asc' },
    limit: 2,
    // v2 defaults: a definition that says nothing about presentation is a
    // plain ungrouped list.
    layout: 'list',
    group: null,
    columns: null,
  });

  const combined = appHelpers.smartViewQueryNotes(notes, normalized, { allNotes: notes });
  assert.deepEqual(combined.map(item => item.noteId), ['project']);
  assert.equal(combined[0].createdDate, '2026-06-01');
  assert.deepEqual(combined[0].tags, ['Project', 'AI']);

  assert.equal(appHelpers.smartViewMatchesNote(notes[0], { filters: { workflowStatus: 'doing' } }), true);
  assert.equal(appHelpers.smartViewMatchesNote(notes[1], { filters: { workflowStatus: 'doing' } }), false);
  assert.deepEqual(
    appHelpers.smartViewQueryNotes(notes, { filters: { linkedNote: 'research' }, limit: 10 }, { allNotes: notes }).map(item => item.noteId),
    ['project']
  );
  assert.deepEqual(
    appHelpers.smartViewQueryNotes(notes, { filters: { createdFrom: '2026-06-01', createdTo: '2026-06-06' }, sort: { field: 'created', direction: 'asc' }, limit: 10 }).map(item => item.noteId),
    ['project', 'daily']
  );
  assert.deepEqual(
    appHelpers.smartViewQueryNotes(notes, { filters: { modifiedFrom: '2026-06-05' }, sort: { field: 'title', direction: 'asc' }, limit: 10 }).map(item => item.noteId),
    ['daily', 'project']
  );
  assert.deepEqual(
    appHelpers.smartViewQueryNotes(notes, { filters: { propertyKey: 'priority' }, sort: { field: 'modified', direction: 'desc' }, limit: 10 }).map(item => item.noteId),
    ['project', 'research']
  );
  assert.deepEqual(
    appHelpers.smartViewQueryNotes(notes, { filters: { tags: 'ai' }, sort: { field: 'created', direction: 'asc' }, limit: 1 }).map(item => item.noteId),
    ['research']
  );
  assert.equal(JSON.stringify(notes), before);
});

test('Smart View action filters query tasks and reminders with source details', () => {
  const now = new Date('2026-06-06T12:00:00.000Z');
  const parser = {
    parse(text) {
      const match = String(text || '').match(/@remind\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
      if (!match) return null;
      return { raw: match[0], date: match[1], time: match[2] || '', at: new Date(`${match[1]}T${match[2] || '09:00'}:00.000Z`) };
    },
    strip(text) {
      return String(text || '').replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/, '').trim();
    },
  };
  const notes = [
    {
      id: 'actions',
      title: 'Action note',
      tags: ['project'],
      date: '2026-06-01T10:00:00.000Z',
      modifiedAt: '2026-06-06T10:00:00.000Z',
      body: [
        '- [ ] Open task @remind 2026-06-06',
        '- [x] Completed task @remind 2026-06-05',
        '- [ ] Deferred task @defer 2026-06-10',
        'Reminder only @remind 2026-06-07',
      ].join('\n'),
    },
    {
      id: 'blocks',
      title: 'Block note',
      tags: ['project'],
      date: '2026-06-02T10:00:00.000Z',
      modifiedAt: '2026-06-06T11:00:00.000Z',
      blocks: [
        { id: 'b1', kind: 'todo', checked: false, content: 'Block open @remind 2026-06-06' },
      ],
    },
  ];
  const walk = (blocks, visit) => blocks.forEach(block => {
    visit(block);
    visit(block);
  });

  const open = appHelpers.smartViewQuery(notes, {
    type: 'tasks',
    filters: { tags: 'project', actionStatus: 'open' },
    sort: { field: 'title', direction: 'asc' },
    limit: 10,
  }, { parser, walk, now });
  assert.deepEqual(open.map(item => item.label), ['Block open', 'Open task']);
  assert.equal(open.filter(item => item.source.blockId === 'b1').length, 1);
  assert.equal(open[0].source.noteTitle, 'Block note');
  assert.equal(open[0].source.noteId, 'blocks');
  assert.equal(open[0].status, 'open');

  assert.deepEqual(
    appHelpers.smartViewQuery(notes, { type: 'tasks', filters: { actionStatus: 'completed' }, limit: 10 }, { parser, walk, now }).map(item => item.label),
    ['Completed task']
  );
  const deferred = appHelpers.smartViewQuery(notes, { type: 'tasks', filters: { actionStatus: 'deferred' }, limit: 10 }, { parser, walk, now });
  assert.deepEqual(deferred.map(item => item.label), ['Deferred task']);
  assert.equal(deferred[0].deferUntil, '2026-06-10');
  assert.equal(deferred[0].deferred, true);

  const reminders = appHelpers.smartViewQuery(notes, {
    type: 'reminders',
    filters: { reminderFrom: '2026-06-07', reminderTo: '2026-06-07' },
    sort: { field: 'reminder', direction: 'asc' },
    limit: 10,
  }, { parser, walk, now });
  assert.deepEqual(reminders.map(item => item.label), ['Reminder only']);
  assert.equal(reminders[0].reminderDate, '2026-06-07');
  assert.equal(reminders[0].source.line, 3);
  assert.equal(reminders[0].sourceNoteTitle, 'Action note');
});

test('Smart View saved definitions reject invalid input and round-trip text', () => {
  const existing = [{ id: 'existing_view', title: 'Existing view' }];
  const before = JSON.stringify(existing);
  const raw = {
    format: appHelpers.SMART_VIEW_FORMAT,
    id: 'open_tasks',
    title: 'Open Tasks',
    type: 'tasks',
    filters: {
      tags: ['project'],
      actionStatus: 'open',
      reminderFrom: '2026-06-06',
    },
    sort: { field: 'reminder', direction: 'asc' },
    limit: 25,
  };

  assert.throws(
    () => appHelpers.smartViewUpsertSavedDefinition(existing, { ...raw, id: 'bad id' }),
    /Invalid Smart View id/
  );
  assert.equal(JSON.stringify(existing), before);
  assert.throws(
    () => appHelpers.smartViewValidateSavedDefinition({ ...raw, filters: { actionStatus: 'later' } }),
    /Invalid Smart View action status/
  );
  assert.throws(
    () => appHelpers.smartViewValidateSavedDefinition({ ...raw, unexpected: true }),
    /unsupported key/
  );

  const saved = appHelpers.smartViewValidateSavedDefinition(raw);
  assert.equal(saved.format, appHelpers.SMART_VIEW_FORMAT);
  assert.deepEqual(saved.filters.tags, ['project']);
  assert.deepEqual(saved.filters.actionStatuses, ['open']);

  const json = appHelpers.smartViewSerializeDefinition(saved, 'json');
  const yaml = appHelpers.smartViewSerializeDefinition(saved, { format: 'yaml' });
  assert.deepEqual(appHelpers.smartViewParseDefinitionText(json, 'open-tasks.json'), saved);
  assert.deepEqual(appHelpers.smartViewParseDefinitionText(yaml, 'open-tasks.yaml'), saved);

  const next = appHelpers.smartViewUpsertSavedDefinition(existing, saved);
  assert.equal(next.length, 2);
  assert.equal(next[1].id, 'open_tasks');
  assert.equal(JSON.stringify(existing), before);
});

test('Smart View embed blocks parse saved and inline definitions without mutating raw markdown', () => {
  const saved = appHelpers.smartViewValidateSavedDefinition({
    format: appHelpers.SMART_VIEW_FORMAT,
    id: 'open_tasks',
    title: 'Open Tasks',
    type: 'tasks',
    filters: { actionStatus: 'open' },
    sort: { field: 'reminder', direction: 'asc' },
    limit: 10,
  });

  const fromSaved = appHelpers.smartViewParseEmbedBlock('{{smart-view open_tasks}}', [saved]);
  assert.equal(fromSaved.ok, true);
  assert.equal(fromSaved.mode, 'saved');
  assert.equal(fromSaved.definition.id, 'open_tasks');

  const inlineYaml = `{{smart-view
id: inline_tasks
title: Inline Tasks
type: tasks
filters:
  actionStatus: open
sort:
  field: reminder
  direction: asc
limit: 5
}}`;
  const fromInline = appHelpers.smartViewParseEmbedBlock(inlineYaml, []);
  assert.equal(fromInline.ok, true);
  assert.equal(fromInline.mode, 'inline');
  assert.equal(fromInline.definition.id, 'inline_tasks');
  assert.deepEqual(fromInline.definition.filters.actionStatuses, ['open']);

  const missing = appHelpers.smartViewParseEmbedBlock('{{smart-view missing_view}}', [saved]);
  assert.equal(missing.ok, false);
  assert.equal(missing.raw, '{{smart-view missing_view}}');
  assert.match(missing.error, /Unknown saved Smart View/);

  assert.equal(appHelpers.smartViewParseEmbedBlock('{{embed [[Open Tasks]]}}', [saved]), null);
});

test('Novel import helper creates structure support notes and preserves existing drafts', () => {
  const now = '2026-05-16T00:00:00.000Z';
  const existing = [
    {
      id: 'scene-existing',
      title: 'Arrival',
      tags: ['novel-scene'],
      body: 'status:: DRAFT\n\nDraft already here.',
      modifiedAt: now,
    },
    {
      id: 'character-existing',
      title: 'Mara',
      tags: ['novel-character'],
      body: 'Existing motive.',
      modifiedAt: now,
    },
  ];
  const plan = appHelpers.buildNovelImportPlan([
    { title: 'Act 1', kind: 'act', body: 'Opening movement.', order: '100' },
    { title: 'Chapter 1', kind: 'chapter', actTitle: 'Act 1', body: 'First chapter.', order: '110' },
    { title: 'Arrival', kind: 'scene', actTitle: 'Act 1', chapterTitle: 'Chapter 1', body: 'Do not overwrite this story.', plotPoints: ['Mara reaches the port'] },
    { title: 'Mara', kind: 'character', body: 'Secretly wants to leave the city.', sourceFile: 'cast.md' },
    { title: 'Harbor', kind: 'location', body: 'Fog, bells, and closed warehouses.', sourceFile: 'places.txt' },
  ], existing, { vaultId: 'novel', now });

  assert.equal(plan.created.length, 3);
  assert.equal(plan.updated.length, 2);
  const act = plan.notes.find(note => note.title === 'Act 1');
  const chapter = plan.notes.find(note => note.title === 'Chapter 1');
  const scene = plan.notes.find(note => note.title === 'Arrival');
  const character = plan.notes.find(note => note.title === 'Mara');
  const location = plan.notes.find(note => note.title === 'Harbor');

  assert.match(act.body, /\[\[Chapter 1\]\]/);
  assert.match(chapter.body, /act:: \[\[Act 1\]\]/);
  assert.match(chapter.body, /\[\[Arrival\]\]/);
  assert.match(scene.body, /chapter:: \[\[Chapter 1\]\]/);
  assert.match(scene.body, /Draft already here/);
  assert.doesNotMatch(scene.body, /Do not overwrite this story/);
  assert.match(character.body, /Secretly wants to leave/);
  assert.deepEqual(location.tags, ['novel-location']);
});

test('Ask AI action classifier routes app functions and high-risk prompts safely', () => {
  assert.deepEqual(aiActions.classifyPrompt('create a page called Launch checklist'), {
    type: 'action',
    action: { type: 'create-note', title: 'Launch checklist' },
  });
  assert.deepEqual(aiActions.classifyPrompt('create new not called AI hope'), {
    type: 'action',
    action: { type: 'create-note', title: 'AI hope' },
  });
  assert.deepEqual(aiActions.classifyPrompt('create a page called AI hope and summarise all notes'), {
    type: 'action',
    action: {
      type: 'action-plan',
      title: 'AI hope',
      confidence: 'high',
      source: 'direct-router',
      steps: [
        {
          type: 'notes-answer',
          purpose: 'summary',
          prompt: 'create a page called AI hope and summarise all notes\n\nReturn a concise markdown note body only. Focus on the notes, decisions, tasks, dates, and named references that matter.',
        },
        {
          type: 'create-note',
          title: 'AI hope',
          bodyFrom: 'previous-answer',
          tags: [],
        },
      ],
    },
  });
  assert.deepEqual(aiActions.classifyPrompt('summarize all my notes and create a new one and tag it under reading'), {
    type: 'action',
    action: {
      type: 'action-plan',
      title: 'Notes summary',
      confidence: 'high',
      source: 'direct-router',
      steps: [
        {
          type: 'notes-answer',
          purpose: 'summary',
          prompt: 'summarize all my notes and create a new one and tag it under reading\n\nReturn a concise markdown note body only. Focus on the notes, decisions, tasks, dates, and named references that matter.',
        },
        {
          type: 'create-note',
          title: 'Notes summary',
          bodyFrom: 'previous-answer',
          tags: ['reading'],
        },
        { type: 'tag-created-note', tag: 'reading' },
      ],
    },
  });
  assert.deepEqual(aiActions.classifyPrompt('create a page called Launch checklist and tag it under reading'), {
    type: 'action',
    action: {
      type: 'action-plan',
      title: 'Launch checklist',
      confidence: 'high',
      source: 'direct-router',
      steps: [
        {
          type: 'create-note',
          title: 'Launch checklist',
          bodyFrom: 'generate',
          tags: ['reading'],
        },
        { type: 'tag-created-note', tag: 'reading' },
      ],
    },
  });
  assert.deepEqual(aiActions.classifyPrompt('summarize this page'), {
    type: 'action',
    action: { type: 'edit-current', action: 'summarize' },
  });
  assert.deepEqual(aiActions.classifyPrompt('format all supporting notes'), {
    type: 'action',
    action: { type: 'edit-supporting-notes', action: 'format' },
  });
  assert.deepEqual(aiActions.classifyPrompt('improve all suporting notes'), {
    type: 'action',
    action: { type: 'edit-supporting-notes', action: 'improve' },
  });
  assert.deepEqual(aiActions.classifyPrompt('can you summarise all my notes'), {
    type: 'notes',
  });
  assert.deepEqual(aiActions.classifyPrompt('describe yourself'), {
    type: 'chat',
  });
  assert.deepEqual(aiActions.classifyPrompt('what are you'), {
    type: 'chat',
  });
  assert.deepEqual(aiActions.classifyPrompt('tag this for reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('tag this note with reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('tag current page as reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('tag for reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('add reading tag'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.equal(aiActions.classifyPrompt('which notes are tagged reading?').type, 'notes');
  assert.equal(aiActions.classifyPrompt('find my Python notes').type, 'notes');
  assert.equal(aiActions.classifyPrompt('list notes tagged bash').type, 'notes');
  assert.equal(aiActions.detectAction('tag it under reading'), null);
  assert.deepEqual(aiActions.classifyPrompt('summarise all my notes and create a new one to add that. then tag it under reading'), {
    type: 'action',
    action: {
      type: 'action-plan',
      title: 'Notes summary',
      confidence: 'high',
      source: 'direct-router',
      steps: [
        {
          type: 'notes-answer',
          purpose: 'summary',
          prompt: 'summarise all my notes and create a new one to add that. then tag it under reading\n\nReturn a concise markdown note body only. Focus on the notes, decisions, tasks, dates, and named references that matter.',
        },
        {
          type: 'create-note',
          title: 'Notes summary',
          bodyFrom: 'previous-answer',
          tags: ['reading'],
        },
        { type: 'tag-created-note', tag: 'reading' },
      ],
    },
  });
  assert.equal(aiActions.classifyPrompt('run a shell command to inspect files').action.type, 'high-risk-disabled');
});

test('App helpers collect reminders and workflow notes without renderer state', () => {
  const parser = {
    parse(text) {
      const match = String(text || '').match(/@remind\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
      if (!match) return null;
      return { raw: match[0], date: match[1], time: match[2] || '', at: new Date(`${match[1]}T${match[2] || '09:00'}:00.000Z`) };
    },
    strip(text) {
      return String(text || '').replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/, '').trim();
    },
  };
  const walk = (blocks, visit) => blocks.forEach(visit);
  const reminders = appHelpers.collectReminderItems([
    { id: 'n1', title: 'Body note', body: '- [ ] Call @remind 2026-05-06 10:30\n- [x] Done @remind 2026-05-06 11:00' },
    { id: 'n2', title: 'Block note', blocks: [
      { id: 'b1', kind: 'todo', checked: true, content: 'Ignored @remind 2026-05-06 12:00' },
      { id: 'b2', kind: 'todo', checked: false, content: 'Ship @remind 2026-05-07' },
    ] },
  ], parser, walk);
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].text, '- [ ] Call');
  assert.match(reminders[0].key, /^n1\|0\|2026-05-06\|10:30\|/);
  assert.equal(reminders[1].blockId, 'b2');
  assert.equal(appHelpers.reminderStatusLabel('snoozed'), 'Snoozed');

  const tasks = appHelpers.collectTaskItems([
    { id: 'n1', title: 'Body note', tags: ['todo'], body: '- [ ] Call @remind 2026-05-06 10:30\n- [ ] Inbox task\nRemember @remind 2026-05-08' },
    { id: 'n2', title: 'Block note', tags: [], blocks: [
      { id: 'b1', kind: 'todo', checked: true, content: 'Done task @remind 2026-05-06 12:00' },
      { id: 'b2', kind: 'paragraph', content: 'Ship @remind 2026-05-07' },
    ] },
  ], parser, walk);
  assert.equal(tasks.length, 5);
  assert.equal(tasks.filter(item => item.type === 'todo').length, 3);
  assert.equal(tasks.filter(item => item.isReminderOnly).length, 2);
  assert.equal(tasks.find(item => item.text === 'Inbox task').remindAt, null);
  assert.equal(tasks.find(item => item.blockId === 'b2').label, 'Ship');
  assert.match(tasks[0].key, /^todo\|n1\|0\|2026-05-06\|10:30\|/);

  const now = new Date('2026-06-06T12:00:00.000Z');
  const rollupNotes = [
    { id: 'today', title: 'Today note', date: '2026-06-06T09:00:00.000Z', body: '# Today\n- [ ] Call [[Project]]' },
    { id: 'yesterday', title: 'Yesterday note', date: '2026-06-05T09:00:00.000Z', modifiedAt: '2026-06-06T08:00:00.000Z', body: 'Yesterday body' },
    { id: 'title', title: '2026-06-01 Archive', date: '2026-05-30T09:00:00.000Z', body: 'Archived' },
    { id: 'invalid-title', title: '2026-02-30 Bad date', date: '2026-06-06T10:00:00.000Z', body: 'Fallback' },
  ];
  assert.deepEqual(appHelpers.rollupDateRangeBounds('week', now), {
    start: '2026-06-01',
    end: '2026-06-06',
    today: '2026-06-06',
  });
  assert.equal(appHelpers.rollupDateRangeBounds('yesterday', now).start, '2026-06-05');
  assert.deepEqual(appHelpers.rollupGroupNotes(rollupNotes, { range: 'today', groupBy: 'created', now }).map(group => group.key), ['2026-06-06']);
  assert.deepEqual(appHelpers.rollupGroupNotes(rollupNotes, { range: 'today', groupBy: 'modified', now }).flatMap(group => group.notes.map(note => note.id)).sort(), ['invalid-title', 'today', 'yesterday']);
  assert.equal(appHelpers.rollupNoteDateKey(rollupNotes[2], 'title-date'), '2026-06-01');
  assert.equal(appHelpers.rollupNoteDateKey(rollupNotes[3], 'title-date'), '2026-06-06');
  assert.equal(appHelpers.rollupNotePreview(rollupNotes[0]), 'Today · Call Project');

  const rollupTasks = [
    { type: 'todo', noteId: 'today', noteTitle: 'Today note', label: 'Call', checked: false, noteDate: '2026-06-06T09:00:00.000Z' },
    { type: 'todo', noteId: 'today', noteTitle: 'Today note', label: 'Done', checked: true, noteDate: '2026-06-06T09:00:00.000Z' },
    { type: 'reminder', noteId: 'today', noteTitle: 'Today note', label: 'Reminder only', isReminderOnly: true, noteDate: '2026-06-06T09:00:00.000Z' },
    { type: 'todo', noteId: 'yesterday', noteTitle: 'Yesterday note', label: 'Review', checked: false, noteDate: '2026-06-05T09:00:00.000Z' },
  ];
  assert.deepEqual(appHelpers.rollupFilterTaskItems(rollupTasks, rollupNotes, { range: 'today', groupBy: 'created', now }).map(item => item.label), ['Call']);
  assert.deepEqual(appHelpers.rollupFilterTaskItems(rollupTasks, rollupNotes, { range: 'yesterday', groupBy: 'created', now }).map(item => item.label), ['Review']);

  const rollupReminders = [
    { noteId: 'old', noteTitle: 'Old', text: 'Past', remindAt: { date: '2026-06-04', at: new Date('2026-06-04T09:00:00.000Z') } },
    { noteId: 'today', noteTitle: 'Today', text: 'Today', remindAt: { date: '2026-06-06', at: new Date('2026-06-06T09:00:00.000Z') } },
    { noteId: 'future', noteTitle: 'Future', text: 'Future', remindAt: { date: '2026-06-10', at: new Date('2026-06-10T09:00:00.000Z') } },
  ];
  const todayReminders = appHelpers.rollupFilterReminderItems(rollupReminders, rollupNotes, { range: 'today', now });
  assert.deepEqual(todayReminders.map(item => item.text), ['Past', 'Today']);
  assert.deepEqual(todayReminders.map(item => item.rollupStatus), ['overdue', 'due-today']);
  assert.equal(appHelpers.rollupTaskReasonLabel(rollupTasks[0], rollupNotes[0], now), 'captured today');
  assert.equal(appHelpers.rollupTaskReasonLabel({ ...rollupTasks[0], remindAt: null }, { ...rollupNotes[0], title: '2026-06-06' }, now), 'unscheduled daily task');
  assert.equal(appHelpers.rollupTaskReasonLabel(rollupTasks[3], rollupNotes[1], now), 'modified today');
  assert.equal(appHelpers.rollupTaskReasonLabel({ noteTitle: 'Missing' }, null, now), 'source note');
  assert.equal(appHelpers.rollupReminderReasonLabel(todayReminders[0]), 'overdue');
  assert.equal(appHelpers.rollupReminderReasonLabel(todayReminders[1]), 'due today');
  assert.equal(appHelpers.rollupReminderReasonLabel({ rollupStatus: 'upcoming' }), 'upcoming');
  const agendaItems = [
    { type: 'todo', noteId: 'today', noteTitle: 'Today note', label: 'Call', checked: false, noteDate: '2026-06-06T09:00:00.000Z', noteTags: ['todo'] },
    { type: 'todo', noteId: 'yesterday', noteTitle: 'Yesterday note', label: 'Past', checked: false, remindAt: { date: '2026-06-05', time: '09:00', at: new Date('2026-06-05T09:00:00.000Z') } },
    { type: 'reminder', isReminderOnly: true, noteId: 'today', noteTitle: 'Today note', label: 'Ping', checked: false, remindAt: { date: '2026-06-06', time: '14:00', at: new Date('2026-06-06T14:00:00.000Z') } },
    { type: 'todo', noteId: 'title', noteTitle: '2026-06-01 Archive', label: 'Later', checked: false, remindAt: { date: '2026-06-10', at: new Date('2026-06-10T09:00:00.000Z') } },
  ];
  const detail = appHelpers.agendaActionDetail(agendaItems[0], rollupNotes, { now });
  assert.equal(detail.status, 'unscheduled');
  assert.equal(detail.sourceNoteTitle, 'Today note');
  assert.equal(detail.reason, 'captured today');
  assert.equal(detail.createdDate, '2026-06-06');
  assert.equal(detail.modifiedDate, '');
  assert.deepEqual(detail.inheritedTags, ['todo']);
  assert.deepEqual(appHelpers.agendaFilterActionItems(agendaItems, rollupNotes, { status: 'overdue' }, { now }).map(item => item.label), ['Past']);
  assert.deepEqual(appHelpers.agendaFilterActionItems(agendaItems, rollupNotes, { status: 'today' }, { now }).map(item => item.label), ['Ping']);
  assert.deepEqual(appHelpers.agendaFilterActionItems(agendaItems, rollupNotes, { status: 'upcoming' }, { now }).map(item => item.label), ['Later']);
  assert.deepEqual(appHelpers.agendaFilterActionItems(agendaItems, rollupNotes, { status: 'unscheduled' }, { now }).map(item => item.label), ['Call']);
  assert.deepEqual(appHelpers.agendaFilterActionItems(agendaItems, rollupNotes, { tag: 'todo' }, { now }).map(item => item.label), ['Call']);
  assert.deepEqual(appHelpers.agendaFilterActionItems(agendaItems, rollupNotes, { sourceNoteId: 'title' }, { now }).map(item => item.label), ['Later']);
  const deferredTasks = appHelpers.collectTaskItems([
    {
      id: 'defer',
      title: 'Deferred',
      date: '2026-06-06T09:00:00.000Z',
      body: [
        '- [ ] Hidden @defer 2026-06-10',
        '- [ ] Alias @hide-until 2026-06-10',
        '- [ ] Ready @defer 2026-06-05',
        '- [ ] Scheduled @remind 2026-06-06 @defer 2026-06-10',
      ].join('\n'),
    },
  ], parser, walk);
  assert.equal(deferredTasks.find(item => item.label === 'Hidden').deferUntil, '2026-06-10');
  assert.equal(deferredTasks.find(item => item.label === 'Alias').deferUntil, '2026-06-10');
  assert.equal(appHelpers.agendaIsDeferred(deferredTasks.find(item => item.label === 'Hidden'), now), true);
  assert.equal(appHelpers.agendaIsDeferred(deferredTasks.find(item => item.label === 'Ready'), now), false);
  assert.deepEqual(
    appHelpers.agendaFilterActionItems(deferredTasks, rollupNotes, {}, { now }).map(item => item.label),
    ['Ready']
  );
  assert.deepEqual(
    appHelpers.rollupFilterTaskItems(deferredTasks, [{ id: 'defer', title: 'Deferred', date: '2026-06-06T09:00:00.000Z' }], { range: 'today', now }).map(item => item.label),
    ['Ready']
  );
  assert.deepEqual(
    appHelpers.agendaFilterActionItems(deferredTasks, rollupNotes, {}, { now: new Date('2026-06-11T12:00:00.000Z') }).map(item => item.label),
    ['Hidden', 'Alias', 'Ready', 'Scheduled']
  );
  const duplicateBlockTasks = appHelpers.collectTaskItems([
    { id: 'dup', title: 'Dup', blocks: [{ id: 'same', kind: 'todo', checked: false, content: 'Repeat' }] },
  ], parser, (blocks, visit) => { visit(blocks[0]); visit(blocks[0]); });
  assert.equal(duplicateBlockTasks.length, 1);
  assert.equal(
    appHelpers.agendaBuildTaskContent('Call @remind 2026-06-01 @hide-until 2026-06-02', '2026-06-08', '09:00', '2026-06-10'),
    'Call @remind 2026-06-08 09:00 @defer 2026-06-10'
  );
  assert.equal(appHelpers.agendaBodyHasActionText('- [ ] Call @defer 2026-06-10', 'Call @remind 2026-06-08'), true);
  assert.equal(appHelpers.agendaBodyHasActionText('Call', 'Call'), false);
  assert.equal(appHelpers.agendaReplaceUniqueSourceText('One\nTwo', 'Two', 'Done'), 'One\nDone');
  assert.equal(appHelpers.agendaReplaceUniqueSourceText('Repeat\nRepeat', 'Repeat', 'Done'), 'Repeat\nRepeat');
  const scheduleNow = new Date(2026, 5, 6, 10, 0, 0);
  assert.deepEqual(appHelpers.agendaParseScheduleInput('today', { now: scheduleNow }), {
    ok: true,
    date: '2026-06-06',
    time: '',
    raw: 'today',
  });
  assert.equal(appHelpers.agendaParseScheduleInput('tomorrow', { now: scheduleNow }).date, '2026-06-07');
  assert.equal(appHelpers.agendaParseScheduleInput('next Monday', { now: scheduleNow }).date, '2026-06-08');
  assert.deepEqual(appHelpers.agendaParseScheduleInput('in 2 hours', { now: scheduleNow }), {
    ok: true,
    date: '2026-06-06',
    time: '12:00',
    raw: 'in 2 hours',
  });
  assert.deepEqual(appHelpers.agendaParseScheduleInput('Friday 3pm', { now: scheduleNow }), {
    ok: true,
    date: '2026-06-12',
    time: '15:00',
    raw: 'Friday 3pm',
  });
  assert.equal(appHelpers.agendaParseScheduleInput('someday maybe', { now: scheduleNow }).ok, false);
  assert.equal(appHelpers.agendaParseScheduleInput('Friday 25pm', { now: scheduleNow }).ok, false);

  assert.match(
    appHelpers.rollupAppendQuickTask('# 2026-06-06\n\n## Tasks\n- [ ] \n\n## Notes\n- note\n', 'Buy milk'),
    /## Tasks\n- \[ \] Buy milk\n\n## Notes/
  );
  assert.equal(appHelpers.rollupAppendQuickTask('Body', 'Buy milk'), 'Body\n- [ ] Buy milk\n');
  assert.match(
    appHelpers.rollupAppendReflection('Body', { now }),
    /Body\n\n## Reflection - 2026-06-06\n\n- What stood out:\n- What I learned:\n- What to improve:\n$/
  );
  const recap = appHelpers.rollupBuildEndDayRecap({
    notes: rollupNotes,
    tasks: rollupTasks,
    reminders: rollupReminders,
    now,
  });
  assert.match(recap, /## End-day recap - 2026-06-06/);
  assert.match(recap, /### Highlights\n- \[\[Today note\]\]/);
  assert.match(recap, /### Decisions\n- Review notes from 2026-06-06 for decisions to keep\./);
  assert.match(recap, /### Open loops\n- \[ \] Call \(Today note\)/);
  assert.match(recap, /### Tomorrow candidates/);
  assert.doesNotMatch(recap, /AI/i);
  assert.match(
    appHelpers.rollupAppendEndDayRecap('Body', { notes: rollupNotes, tasks: rollupTasks, reminders: rollupReminders, now }),
    /Body\n\n## End-day recap - 2026-06-06/
  );
  const todayContext = appHelpers.contextualAiBuildTodayRecapContext({
    notes: rollupNotes,
    tasks: rollupTasks,
    reminders: rollupReminders,
    agendaItems: rollupReminders,
    now,
  });
  assert.equal(todayContext.today, '2026-06-06');
  assert.deepEqual(todayContext.notes.map(note => note.id).sort(), ['invalid-title', 'today', 'yesterday']);
  assert.equal(todayContext.tasks.length, 1);
  assert.ok(todayContext.reminders.some(item => item.rollupStatus === 'overdue'));
  assert.ok(todayContext.sources.some(source => source.title === 'Today note'));
  const prompt = appHelpers.contextualAiBuildTodayRecapPrompt(todayContext);
  assert.match(prompt, /Changed today, Open loops, Tomorrow planning suggestions/);
  assert.match(prompt, /Source notes:/);
  const todayAiResult = appHelpers.contextualAiBuildTodayRecapResult({
    aiText: '## Changed today\nToday note moved.\n## Open loops\nCall remains open.\n## Tomorrow planning suggestions\nPlan the call.',
    context: todayContext,
    status: { config: { provider: 'ollama', chatModel: 'gemma3' } },
    createdAt: '2026-06-06T10:00:00.000Z',
  });
  assert.equal(todayAiResult.outputKind, 'today-recap');
  assert.equal(todayAiResult.providerModelLabel, 'Ollama - gemma3');
  assert.deepEqual(todayAiResult.sections.map(section => section.title), ['Changed today', 'Open loops', 'Tomorrow planning suggestions']);
  assert.deepEqual(todayAiResult.sections.map(section => section.kind), ['fact', 'fact', 'suggestion']);
  assert.ok(todayAiResult.sources.some(source => source.title === 'Today note'));

  const workflow = appHelpers.collectWorkflowNotes([
    { id: 'n1', title: 'Draft', tags: ['project'], body: 'status:: DRAFT\nconstructor:: owner\ntoString:: label\nhasOwnProperty:: safe\n# Draft\n- Body', modifiedAt: '2026-05-06T00:00:00.000Z' },
    { id: 'n2', title: 'Archived', tags: [], body: 'status:: DONE\nClosed', workflowArchived: true },
    { id: 'n3', title: 'No status', tags: [], body: 'Body' },
  ], [{ id: 'DRAFT' }, { id: 'DONE' }]);
  assert.equal(workflow.counts.DRAFT, 1);
  assert.equal(workflow.counts.DONE, 0);
  assert.deepEqual([...workflow.noteIdsByState.DRAFT], ['n1']);
  assert.deepEqual(workflow.archivedNotes.map(note => note.id), ['n2']);
  assert.equal(workflow.byState.DRAFT[0].text, 'Body');
  assert.equal(Object.getPrototypeOf(workflow.byState.DRAFT[0].properties), null);
  assert.equal(workflow.byState.DRAFT[0].properties.constructor, 'owner');
  assert.equal(workflow.byState.DRAFT[0].properties.toString, 'label');
  assert.equal(workflow.byState.DRAFT[0].properties.hasOwnProperty, 'safe');
});

test('App helpers normalize novelist notes and body properties', () => {
  let body = '# Scene\n- order:: 200\n- status:: DRAFT\n- chapter:: [[Chapter 1]]\nDraft text';
  assert.equal(appHelpers.bodyPropertyValue(body, 'status'), 'DRAFT');
  body = appHelpers.setBodyProperty(body, 'status', 'REVISE');
  assert.equal(appHelpers.bodyPropertyValue(body, 'status'), 'REVISE');
  body = appHelpers.removeBodyProperty(body, 'status');
  assert.equal(appHelpers.bodyPropertyValue(body, 'status'), '');
  assert.match(appHelpers.setBodyProperty('# Note\nBody', 'order', '100'), /order:: 100\nBody/);
  assert.equal(appHelpers.normalizeNoteBody('# Scene\n- status:: DRAFT\n- order:: 200\nDraft text', 'Scene'), 'status:: DRAFT\norder:: 200\nDraft text');
  assert.deepEqual(appHelpers.normalizeNovelistLegacyTags(['novel-manuscript', 'novel-arc', 'novel-scene']), ['novel-act', 'novel-scene']);
  assert.equal(appHelpers.normalizeNovelistLegacyBody('arc:: [[Arc 1]]\n## Arcs'), 'act:: [[Arc 1]]\n## Acts');
  assert.match(appHelpers.ensureScenePlotPoints('status:: DRAFT\nDraft', ['novel-scene']), /:::\s*plot-points/);
  assert.equal(appHelpers.replaceWikiLinkTitle('See [[Old#A|alias]]', 'Old', 'New'), 'See [[New#A|alias]]');

  const structure = appHelpers.buildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 'c2', title: 'Chapter B', tags: ['novel-chapter'], body: '# Chapter B\n- order:: 120\n- act:: [[Act]]', modifiedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c1', title: 'Chapter A', tags: ['novel-chapter'], body: '# Chapter A\n- order:: 110\n- act:: [[Act]]', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { id: 's', title: 'Scene', tags: ['novel-scene'], body: '# Scene\n- chapter:: [[Chapter A]]' },
  ]);
  assert.deepEqual(Array.from(structure.childrenByActId.a), ['c1', 'c2']);
  assert.equal(structure.parentBySceneId.s, 'c1');

  const disk = appHelpers.noteForDisk({
    id: 'n1',
    title: 'Scene',
    date: '2026-05-06T00:00:00.000Z',
    tags: ['novel-arc', 'novel-scene'],
    pinned: true,
    workflowArchived: true,
    blocks: [{ content: '# Scene\narc:: [[Act]]\nDraft', children: [] }],
  }, blocks => blocks.map(block => block.content).join('\n'));
  assert.equal(disk.pinned, true);
  assert.equal(disk.workflowArchived, true);
  assert.deepEqual(disk.tags, ['novel-act', 'novel-scene']);
  assert.match(disk.body, /act:: \[\[Act\]\]/);
  assert.doesNotMatch(disk.body, /^# Scene/m);
});

test('App mutations build note, tag, rename, and canvas updates without renderer state', () => {
  const mdToBlocks = body => [{ id: 'b1', kind: 'paragraph', content: body, children: [] }];
  const blocksToMd = blocks => (blocks || []).map(block => block.content).join('\n');
  const makeEmptyBlock = () => ({ id: 'empty', kind: 'paragraph', content: '', children: [] });
  const mutationCtx = {
    normalizeTagName: appHelpers.normalizeTagName,
    parseDefaultTags: appHelpers.parseDefaultTags,
    normalizeNoteBody: appHelpers.normalizeNoteBody,
    ensureScenePlotPoints: appHelpers.ensureScenePlotPoints,
    mdToBlocks,
    blocksToMd,
    makeEmptyBlock,
  };

  assert.equal(appMutations.uniqueNoteTitle([{ id: 'n1', title: 'Draft' }], 'Draft'), 'Draft 2');
  const draft = appMutations.createNoteDraft({
    id: 'n2',
    title: ' Scene ',
    body: '# Scene\nDraft',
    tags: ['Novel Scene'],
    defaultTags: 'Daily, novel scene',
    existingTags: [{ name: 'daily', hue: 10 }],
    now: '2026-05-06T00:00:00.000Z',
  }, mutationCtx);
  assert.equal(draft.note.title, 'Scene');
  assert.deepEqual(draft.note.tags, ['novel-scene', 'daily']);
  assert.deepEqual(draft.missingTags, ['novel-scene']);
  assert.doesNotMatch(draft.note.body, /^# Scene/m);
  assert.match(draft.note.body, /plot-points/);

  const addedTags = appMutations.addTagsToList([{ name: 'daily', hue: 10 }], draft.missingTags, () => 40);
  assert.deepEqual(addedTags, [{ name: 'daily', hue: 10 }, { name: 'novel-scene', hue: 40 }]);
  const duplicate = appMutations.duplicateNoteDraft(draft.note, {
    id: 'n3',
    title: 'Scene copy',
    now: '2026-05-07T00:00:00.000Z',
  }, mutationCtx);
  assert.equal(duplicate.id, 'n3');
  assert.equal(duplicate.pinned, false);

  const renamed = appMutations.renameNoteTitleDrafts([
    { id: 'a', title: 'Old', body: 'Body', blocks: mdToBlocks('Body') },
    { id: 'b', title: 'Ref', body: 'See [[Old]]', blocks: mdToBlocks('See [[Old]]') },
  ], 'a', 'New', {
    blocksToMd,
    mdToBlocks,
    replaceWikiLinkTitle: appHelpers.replaceWikiLinkTitle,
    normalizeNoteBody: appHelpers.normalizeNoteBody,
    now: '2026-05-08T00:00:00.000Z',
  });
  assert.deepEqual(renamed.dirtyIds, ['a', 'b']);
  assert.equal(renamed.notes.find(note => note.id === 'b').body, 'See [[New]]');

  const removed = appMutations.removeTagFromNotes([{ id: 'n', tags: ['daily', 'work'] }], 'daily', '2026-05-09T00:00:00.000Z');
  assert.deepEqual(removed.dirtyIds, ['n']);
  assert.deepEqual(removed.notes[0].tags, ['work']);

  const canvases = appMutations.upsertCanvasList([
    { id: 'old', title: 'Old', modifiedAt: '2026-05-01T00:00:00.000Z' },
  ], { id: 'new', title: '', modifiedAt: '2026-05-10T00:00:00.000Z', elements: [{ id: 'e' }] });
  assert.equal(canvases[0].title, 'Untitled canvas');
  assert.equal(canvases[0].elementCount, 1);
});

test('App canvas actions orchestrate canvas state without renderer state', async () => {
  const calls = [];
  const notices = [];
  const logs = [];
  let canvases = [{ id: 'old', title: 'Old', modifiedAt: '2026-05-01T00:00:00.000Z' }];
  let vaults = [{ id: 'v1', canvases }];
  let activeCanvas = { id: 'old' };
  let selectedTag = 'work';
  let selectedWorkflow = 'DRAFT';
  let query = 'canvas';
  const ctx = {
    activeVaultId: 'v1',
    activeCanvas,
    canvases,
    hasDisk: true,
    mn: {
      canvas: {
      async getCanvas(vaultId, canvasId) {
        calls.push(['get', vaultId, canvasId]);
        return { ok: true, value: { id: canvasId, title: 'Loaded', modifiedAt: '2026-05-02T00:00:00.000Z', elements: [] } };
      },
      async saveCanvas(vaultId, canvas) {
        calls.push(['save', vaultId, canvas.id]);
        return { ok: true, value: { ...canvas, title: `${canvas.title} saved`, modifiedAt: '2026-05-03T00:00:00.000Z' } };
      },
      async deleteCanvas(vaultId, canvasId) {
        calls.push(['delete', vaultId, canvasId]);
        return { ok: true };
      },
      },
    },
    newCanvas(title) {
      return { id: 'new', title, modifiedAt: '2026-05-02T00:00:00.000Z', elements: [] };
    },
    upsertCanvasList: appMutations.upsertCanvasList,
    setCanvases(value) {
      canvases = typeof value === 'function' ? value(canvases) : value;
      ctx.canvases = canvases;
    },
    setVaults(value) {
      vaults = typeof value === 'function' ? value(vaults) : value;
    },
    setActiveCanvas(value) {
      activeCanvas = typeof value === 'function' ? value(activeCanvas) : value;
      ctx.activeCanvas = activeCanvas;
    },
    setSelectedTag(value) { selectedTag = value; },
    setSelectedWorkflow(value) { selectedWorkflow = value; },
    setQuery(value) { query = value; },
    navigateView(view) { calls.push(['navigate', view]); },
    showAppNotice(title, message) { notices.push([title, message]); },
    logError(...args) { logs.push(args); },
  };

  appCanvasActions.openCanvasDashboard(ctx);
  assert.equal(activeCanvas, null);
  assert.equal(selectedTag, null);
  assert.equal(selectedWorkflow, null);
  assert.equal(query, '');
  assert.deepEqual(calls.at(-1), ['navigate', 'canvas']);

  const loaded = await appCanvasActions.openCanvas('remote', ctx);
  assert.equal(loaded.title, 'Loaded');
  assert.equal(activeCanvas.id, 'remote');
  assert.deepEqual(calls.find(call => call[0] === 'get'), ['get', 'v1', 'remote']);

  const created = await appCanvasActions.createCanvas('Sketch', {}, ctx);
  assert.equal(created.title, 'Sketch saved');
  assert.equal(activeCanvas.id, 'new');
  assert.equal(canvases[0].id, 'new');
  assert.equal(vaults[0].canvases[0].id, 'new');

  const saved = await appCanvasActions.saveCanvas({ id: 'new', title: 'Updated', elements: [] }, ctx);
  assert.equal(saved.title, 'Updated saved');
  assert.equal(activeCanvas.title, 'Updated saved');

  const deleted = await appCanvasActions.deleteCanvas('new', ctx);
  assert.equal(deleted.ok, true);
  assert.equal(activeCanvas, null);
  assert.equal(canvases.some(canvas => canvas.id === 'new'), false);
  assert.deepEqual(calls.filter(call => call[0] === 'delete')[0], ['delete', 'v1', 'new']);

  const failingCtx = {
    ...ctx,
    canvases,
    mn: { canvas: { async saveCanvas() { return { ok: false, error: 'disk full' }; } } },
  };
  const failed = await appCanvasActions.createCanvas('Broken', {}, failingCtx);
  assert.equal(failed, null);
  assert.deepEqual(notices.at(-1), ['Could not create canvas', 'disk full']);
  assert.equal(logs.at(-1)[0], 'saveCanvas failed');
});

test('Novelist hierarchy is inferred from act properties and explicit structure tags', () => {
  const structure = appNovelist.mnBuildNovelistStructure([
    { id: 'm', title: 'Old Manuscript', tags: [], body: '# Old Manuscript\n- [[Act One]]\n  - [[Chapter 1]]\n    - [[Opening Scene]]' },
    { id: 'a', title: 'Act One', tags: ['novel-act'], body: '# Act One\n- [[Chapter 1]]' },
    { id: 'c', title: 'Chapter 1', tags: ['novel-chapter'], body: '# Chapter 1\n- act:: [[Act One]]\n- [[Opening Scene]]' },
    { id: 's', title: 'Opening Scene', tags: ['novel-scene'], body: '# Opening Scene\n- chapter:: [[Chapter 1]]' },
  ]);
  const ids = (items) => Array.from(items, note => note.id);

  assert.deepEqual(ids(structure.acts), ['a']);
  assert.deepEqual(ids(structure.chapters), ['c']);
  assert.deepEqual(ids(structure.scenes), ['s']);
  assert.equal(structure.parentByChapterId.c, 'a');
  assert.equal(structure.parentBySceneId.s, 'c');
  assert.deepEqual(ids(structure.pathByNoteId.s), ['a', 'c', 's']);
});

test('Novelist order and note-level status properties drive visible workflow', () => {
  let body = '# Scene\n- order:: 200\n- status:: DRAFT\n- chapter:: [[Chapter 1]]\nDraft text';
  assert.equal(appNovelist.mnBodyPropertyValue(body, 'status'), 'DRAFT');
  body = appNovelist.mnSetBodyProperty(body, 'status', 'REVISE');
  assert.equal(appNovelist.mnBodyPropertyValue(body, 'status'), 'REVISE');
  body = appNovelist.mnRemoveBodyProperty(body, 'status');
  assert.equal(appNovelist.mnBodyPropertyValue(body, 'status'), '');
  assert.match(appNovelist.mnSetBodyProperty('# Note\nBody', 'order', '100'), /order:: 100\nBody/);
  assert.doesNotMatch(appNovelist.mnSetBodyProperty('# Note\nBody', 'order', '100'), /- order::/);
  assert.equal(
    appNovelist.mnNormalizeNoteBody('# Scene\n- status:: DRAFT\n- order:: 200\nDraft text', 'Scene'),
    'status:: DRAFT\norder:: 200\nDraft text'
  );

  const structure = appNovelist.mnBuildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 'c2', title: 'Chapter B', tags: ['novel-chapter'], body: '# Chapter B\n- order:: 120\n- act:: [[Act]]', modifiedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c1', title: 'Chapter A', tags: ['novel-chapter'], body: '# Chapter A\n- order:: 110\n- act:: [[Act]]', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c3', title: 'Chapter C', tags: ['novel-chapter'], body: '# Chapter C\n- act:: [[Act]]', modifiedAt: '2026-01-03T00:00:00.000Z' },
  ]);
  assert.deepEqual(Array.from(structure.childrenByActId.a), ['c1', 'c2', 'c3']);

  const workflow = appHelpers.collectWorkflowNotes([
    { id: 'n1', title: 'Note status', tags: [], body: '# Note\n- status:: DRAFT\nBody', blocks: [{ id: 'b1', workflow: 'DONE', content: 'Block marker' }] },
    { id: 'n2', title: 'Block only', tags: [], body: '# Block only\nBody', blocks: [{ id: 'b2', workflow: 'DRAFT', content: 'Should be ignored' }] },
  ], [{ id: 'DRAFT' }, { id: 'DONE' }], { propertyValue: appNovelist.mnBodyPropertyValue });
  assert.equal(workflow.counts.DRAFT, 1);
  assert.equal(workflow.counts.DONE, 0);
  assert.deepEqual([...workflow.noteIdsByState.DRAFT], ['n1']);

  const converted = appNovelist.mnBuildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 's', title: 'Converted', tags: ['novel-scene'], body: '# Converted\n- act:: [[Act]]' },
  ]);
  assert.deepEqual(Array.from(converted.chapters, note => note.id), []);
  assert.deepEqual(Array.from(converted.scenes, note => note.id), ['s']);
  assert.deepEqual(appNovelist.mnNormalizeNovelistLegacyTags(['novel-manuscript', 'novel-arc', 'novel-scene']), ['novel-act', 'novel-scene']);
  assert.equal(
    appNovelist.mnNormalizeNovelistLegacyBody('arc:: [[Arc 1]]\n## Arcs'),
    'act:: [[Arc 1]]\n## Acts'
  );

  const panels = [
    '../src/features/writer/NovelistPanel.jsx',
    '../src/features/writer/NovelistSections.jsx',
  ].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const metadataModel = fs.readFileSync(path.join(__dirname, '../src/features/editor/metadata/model.js'), 'utf8');
  const propertiesPanel = fs.readFileSync(path.join(__dirname, '../src/features/editor/metadata/PropertiesPanel.jsx'), 'utf8');
  const slashCommands = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/slashCommands.js'), 'utf8');
  assert.doesNotMatch(panels, /## Chapters\\n- '\s*}/);
  assert.doesNotMatch(panels, /## Scenes\\n- '\s*}/);
  assert.doesNotMatch(panels, /body: '# (Story Root|Act|Chapter|Scene|Character|Location|Plot Thread|Research|Revision Note)/);
  assert.match(metadataModel, /function splitPropertyBlocks/);
  assert.match(editor, /blocks=\{contentBlocks\}/);
  assert.match(propertiesPanel, /status::/);
  assert.match(metadataModel, /function cleanPropertyKey/);
  assert.match(propertiesPanel, /Add property/);
  assert.match(editor, /removeMetadataProperty/);
  assert.doesNotMatch(editor, /borderTop: `1px solid \$\{T\.lineSub\}`,[\s\S]*borderBottom: `1px solid \$\{T\.lineSub\}`/);
  const outliner = outlinerSource(__dirname);
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/editor/blockFeatures.jsx'), 'utf8');
  assert.match(slashCommands, /id: 'block-label'/);
  assert.match(slashCommands, /blockLabelAction/);
  assert.match(slashCommands, /Marker: \$\{state\.id\}/);
  assert.match(outliner, /setLabelMenu/);
  assert.match(blockFeatures, /label="Add label"/);
});

test('smart view v2 keeps v1 definitions readable and preserves layout, group and columns', () => {
  // Acceptance 01 — a view saved before v2 still validates and opens as a list.
  const v1 = {
    format: 'vispnote.smartView.v1',
    id: 'legacy-view',
    title: 'Legacy view',
    type: 'notes',
    filters: { tag: 'research' },
    sort: { field: 'modified', direction: 'desc' },
    limit: 25,
  };
  const savedV1 = appHelpers.smartViewValidateSavedDefinition(v1);
  assert.equal(savedV1.layout, 'list');
  assert.equal(savedV1.group, null);
  assert.equal(savedV1.columns, null);
  // New writes carry the v2 format, but v1 is still accepted on read.
  assert.equal(savedV1.format, 'vispnote.smartView.v2');
  assert.ok(appHelpers.SMART_VIEW_FORMATS.includes('vispnote.smartView.v1'));

  // Acceptance 02 — the three new keys survive normalize, which used to return
  // a fixed literal and drop anything it did not name.
  const v2 = {
    ...v1,
    format: 'vispnote.smartView.v2',
    layout: 'board',
    group: { by: 'status' },
    columns: ['status', 'pov'],
  };
  const savedV2 = appHelpers.smartViewValidateSavedDefinition(v2);
  assert.equal(savedV2.layout, 'board');
  assert.deepEqual(savedV2.group, { by: 'status', direction: 'asc' });
  assert.deepEqual(savedV2.columns, ['status', 'pov']);

  // And they survive a YAML round-trip, which routes through the same validator.
  const yaml = appHelpers.smartViewSerializeDefinition(v2, 'yaml');
  const parsed = appHelpers.smartViewValidateSavedDefinition(appHelpers.smartViewParseDefinitionText(yaml));
  assert.equal(parsed.layout, 'board');
  assert.deepEqual(parsed.group, { by: 'status', direction: 'asc' });
  assert.deepEqual(parsed.columns, ['status', 'pov']);

  // An unknown layout is rejected rather than silently coerced.
  assert.throws(() => appHelpers.smartViewValidateSavedDefinition({ ...v2, layout: 'sideways' }), /Invalid Smart View layout/);
});

test('smart view grouping is a pure post-pass with a terminal unfiled bucket', () => {
  const results = [
    { noteId: 'a', note: { id: 'a', tags: [], body: 'status:: DOING\n' } },
    { noteId: 'b', note: { id: 'b', tags: [], body: 'status:: TODO\n' } },
    { noteId: 'c', note: { id: 'c', tags: [], body: 'no property here\n' } },
  ];
  const groups = appHelpers.smartViewGroup(results, { by: 'status' });
  assert.deepEqual(groups.map(g => g.label), ['DOING', 'TODO', 'No status']);
  // Unfiled work is always findable — the bucket exists and sits last.
  assert.equal(groups[groups.length - 1].items.length, 1);
  // Grouping never drops or duplicates a result.
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), results.length);
  // No group means one bucket holding everything, not an error.
  assert.equal(appHelpers.smartViewGroup(results, null).length, 1);
});

test('grouping reads the source note of a task, not just a note result', () => {
  // A note result carries its note on `.note`; an action result carries the
  // note it came from on `.sourceNote`. Reading only `.note` meant grouping
  // tasks by any body property saw an empty body and swept every row into
  // the unfiled bucket — silently, with the right total.
  const actions = [
    { type: 'task', noteId: 'a', label: 'ship it', noteTags: ['work'], sourceNote: { id: 'a', tags: ['work'], body: 'status:: DOING\n' } },
    { type: 'task', noteId: 'b', label: 'write up', noteTags: ['admin'], sourceNote: { id: 'b', tags: ['admin'], body: 'status:: TODO\n' } },
    { type: 'reminder', noteId: 'c', label: 'call back', noteTags: [], sourceNote: { id: 'c', tags: [], body: 'no property\n' } },
  ];

  const byStatus = appHelpers.smartViewGroup(actions, { by: 'status' });
  assert.deepEqual(byStatus.map(g => g.label), ['DOING', 'TODO', 'No status']);
  assert.equal(byStatus[0].items.length, 1, 'DOING holds its task, not zero');
  assert.equal(byStatus[byStatus.length - 1].items.length, 1, 'only the propertyless row is unfiled');

  // Tags live on noteTags for an action result, not tags.
  const byTag = appHelpers.smartViewGroup(actions, { by: 'tag' });
  assert.deepEqual(byTag.map(g => g.label), ['admin', 'work', 'No tag']);

  // Note results keep working unchanged.
  const notes = [{ noteId: 'n', note: { id: 'n', tags: ['x'], body: 'status:: DONE\n' } }];
  assert.deepEqual(appHelpers.smartViewGroup(notes, { by: 'status' }).map(g => g.label), ['DONE', 'No status']);
});

test('view table columns read real fields and only save a sort the vault accepts', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const c = loadRendererModule('src/features/views/viewsColumns.js');
  const helpers = { bodyPropertyValue: (body, key) => {
    const found = String(body || '').match(new RegExp('^' + key + ':: *(.*)$', 'm'));
    return found ? found[1].trim() : '';
  } };

  // Notes and actions get different catalogues; pinned property keys are
  // appended, deduped against the built-ins, and marked as property-sourced.
  assert.deepEqual(c.mnViewsColumns({ type: 'notes' }).map(col => col.key),
    ['title', 'tags', 'modified', 'created', 'words']);
  // An explicit list is the whole list, in order, and the row's own column is
  // put back at the front if it was left out.
  const withProps = c.mnViewsColumns({ type: 'notes', columns: ['priority', 'tags', 'owner', '  ', 'tags'] });
  assert.deepEqual(withProps.map(col => col.key), ['title', 'priority', 'tags', 'owner']);
  assert.equal(withProps.find(col => col.key === 'priority').origin, 'property');
  assert.equal(withProps.find(col => col.key === 'tags').origin, 'file');

  // Every column reads a field the query actually puts on the row.
  const noteRow = {
    type: 'note', title: 'Ship it', tags: ['work'], modifiedDate: '2026-07-20',
    createdDate: '2026-07-01', note: { body: 'one two three\npriority:: high\n' },
  };
  // Resolve against everything the row type offers, not just what is showing.
  const cell = (row, key, type = 'notes') =>
    c.mnViewsCellValue(row, c.mnViewsBaseColumns(type).find(col => col.key === key) || c.mnViewsPropertyColumn(key), helpers);
  assert.equal(cell(noteRow, 'title'), 'Ship it');
  assert.deepEqual(cell(noteRow, 'tags'), ['work']);
  assert.equal(cell(noteRow, 'modified'), '2026-07-20');
  assert.equal(cell(noteRow, 'words'), 5);
  assert.equal(cell(noteRow, 'priority'), 'high');
  assert.equal(cell(noteRow, 'owner'), '');

  const taskRow = {
    type: 'task', title: 'call back', status: 'open', noteTitle: 'Inbox',
    reminderDate: '2026-08-02', noteTags: ['calls'],
    sourceNote: { body: 'owner:: sam\n' },
  };
  assert.equal(cell(taskRow, 'note', 'tasks'), 'Inbox');
  assert.equal(cell(taskRow, 'due', 'tasks'), '2026-08-02');
  assert.deepEqual(cell(taskRow, 'tags', 'tasks'), ['calls']);
  assert.equal(cell(taskRow, 'owner', 'tasks'), 'sam');

  // Only title / created / modified / due map to a storable sort field. The
  // preference sanitizer throws on anything else, so the rest must report as
  // not storable rather than being written into a definition.
  assert.equal(c.mnViewsSortIsStorable('title'), true);
  assert.equal(c.mnViewsSortIsStorable('due'), true);
  assert.equal(c.mnViewsSortField('due'), 'reminder');
  assert.equal(c.mnViewsSortIsStorable('tags'), false);
  assert.equal(c.mnViewsSortIsStorable('words'), false);
  assert.equal(c.mnViewsSortIsStorable('priority'), false);
  assert.equal(c.mnViewsSortField('priority'), '');

  // Column keys are discovered from note bodies, so a note carrying
  // `constructor:: x` makes a column named after an Object.prototype member.
  // Those must miss the lookup like any other unknown key — reporting them as
  // storable saved a function where a field name belongs, and the preference
  // sanitizer then rejected the entire patch.
  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(c.mnViewsSortIsStorable(key), false, `${key} must not be storable`);
    assert.equal(c.mnViewsSortField(key), '', `${key} must have no sort field`);
  }

  // A saved definition round-trips into the table's own sort shape.
  assert.deepEqual(c.mnViewsSortFromDefinition({ sort: { field: 'reminder', direction: 'desc' } }), { key: 'due', direction: 'desc' });
  assert.equal(c.mnViewsSortFromDefinition({ sort: { field: 'nonsense' } }), null);

  // Clicking a header cycles asc, desc, then back to the saved order.
  assert.deepEqual(c.mnViewsNextSort(null, 'title'), { key: 'title', direction: 'asc' });
  assert.deepEqual(c.mnViewsNextSort({ key: 'title', direction: 'asc' }, 'title'), { key: 'title', direction: 'desc' });
  assert.equal(c.mnViewsNextSort({ key: 'title', direction: 'desc' }, 'title'), null);
  assert.deepEqual(c.mnViewsNextSort({ key: 'title', direction: 'desc' }, 'tags'), { key: 'tags', direction: 'asc' });

  // Rows with no value sort last either way, so the table never opens on a
  // block of blanks.
  const rows = [
    { id: 'a', __cells: { owner: 'zoe' } },
    { id: 'b', __cells: { owner: '' } },
    { id: 'c', __cells: { owner: 'ana' } },
  ];
  const cols = c.mnViewsColumns({ type: 'notes', columns: ['owner'] });
  assert.deepEqual(c.mnViewsSortResults(rows, cols, { key: 'owner', direction: 'asc' }).map(r => r.id), ['c', 'a', 'b']);
  assert.deepEqual(c.mnViewsSortResults(rows, cols, { key: 'owner', direction: 'desc' }).map(r => r.id), ['a', 'c', 'b']);
});

test('property conditions support operators and keep meaning what they meant', () => {
  const note = (body) => ({ id: 'n', title: 'n', body });
  const match = (body, properties, propertiesMatch) =>
    appHelpers.smartViewMatchesNote(note(body), { filters: { properties, propertiesMatch } });

  // Written before operators existed: a bare key/value still means "is".
  assert.equal(match('priority:: high\n', [{ key: 'priority', value: 'high' }]), true);
  assert.equal(match('priority:: low\n', [{ key: 'priority', value: 'high' }]), false);

  assert.equal(match('priority:: high\n', [{ key: 'priority', op: 'not', value: 'low' }]), true);
  assert.equal(match('priority:: low\n', [{ key: 'priority', op: 'not', value: 'low' }]), false);
  assert.equal(match('owner:: Sam Ray\n', [{ key: 'owner', op: 'has', value: 'sam' }]), true);
  assert.equal(match('owner:: Ana\n', [{ key: 'owner', op: 'has', value: 'sam' }]), false);

  // Dates compare as text, which is what ISO dates want; numbers compare as
  // numbers, so 9 is not "more than" 10.
  assert.equal(match('due:: 2026-08-02\n', [{ key: 'due', op: 'lt', value: '2026-08-10' }]), true);
  assert.equal(match('due:: 2026-08-20\n', [{ key: 'due', op: 'lt', value: '2026-08-10' }]), false);
  assert.equal(match('effort:: 9\n', [{ key: 'effort', op: 'gt', value: '10' }]), false);
  assert.equal(match('effort:: 12\n', [{ key: 'effort', op: 'gt', value: '10' }]), true);

  // Asking whether a key is missing must not first require it to exist —
  // the old matcher rejected any note without the key before reading the op.
  assert.equal(match('title only\n', [{ key: 'owner', op: 'empty' }]), true);
  assert.equal(match('owner:: sam\n', [{ key: 'owner', op: 'empty' }]), false);
  assert.equal(match('owner:: sam\n', [{ key: 'owner', op: 'filled' }]), true);
  assert.equal(match('title only\n', [{ key: 'owner', op: 'filled' }]), false);

  // An unknown operator falls back to "is" rather than matching everything.
  assert.equal(match('priority:: high\n', [{ key: 'priority', op: 'sql-injection', value: 'high' }]), true);
  assert.equal(match('priority:: low\n', [{ key: 'priority', op: 'sql-injection', value: 'high' }]), false);

  // all vs any across several conditions.
  const two = [{ key: 'priority', op: 'is', value: 'high' }, { key: 'owner', op: 'is', value: 'sam' }];
  assert.equal(match('priority:: high\nowner:: sam\n', two), true);
  assert.equal(match('priority:: high\nowner:: ana\n', two), false);
  assert.equal(match('priority:: high\nowner:: ana\n', two, 'any'), true);
  assert.equal(match('priority:: low\nowner:: ana\n', two, 'any'), false);
});

test('the conditions builder writes filters the query engine already understands', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const c = loadRendererModule('src/features/views/viewsConditions.js');

  // The labels the menu shows must cover exactly the operators the engine
  // accepts — a new operator with no label renders a blank dropdown entry.
  assert.deepEqual(
    c.MN_VIEW_CONDITION_OPS.map(item => item.op).sort(),
    [...appHelpers.SMART_VIEW_PROPERTY_OPS].sort()
  );

  const base = { id: 'work_view', title: 'Work view', type: 'notes', filters: { tags: ['work'] } };
  const added = c.mnViewsAddCondition(base, 'priority');
  assert.deepEqual(added.filters.properties, [{ key: 'priority', op: 'is' }]);
  // Scope is not a condition and has to survive one being added.
  assert.deepEqual(added.filters.tags, ['work']);

  // Several values on one condition are comma separated in the UI and a list
  // in the file, which is the shape the engine reads.
  const valued = c.mnViewsUpdateCondition({ filters: added.filters }, 0, { value: 'high, urgent ,' });
  assert.deepEqual(valued.filters.properties, [{ key: 'priority', op: 'is', value: ['high', 'urgent'] }]);

  // An operator that asks whether a value exists stores no value, so a stale
  // one cannot sit in the file looking like it means something.
  const emptied = c.mnViewsUpdateCondition({ filters: valued.filters }, 0, { op: 'empty' });
  assert.deepEqual(emptied.filters.properties, [{ key: 'priority', op: 'empty' }]);

  // Match mode is only written when it can matter, and never as the default.
  const second = c.mnViewsAddCondition({ filters: valued.filters }, 'owner');
  assert.equal('propertiesMatch' in second.filters, false);
  const any = c.mnViewsSetConditionsMatch({ filters: second.filters }, 'any');
  assert.equal(any.filters.propertiesMatch, 'any');
  assert.equal('propertiesMatch' in c.mnViewsSetConditionsMatch({ filters: any.filters }, 'all').filters, false);
  // One condition cannot be "any of them", so the field is dropped again.
  const back = c.mnViewsRemoveCondition({ filters: any.filters }, 1);
  assert.equal('propertiesMatch' in back.filters, false);

  // Clearing removes the key rather than storing an empty list.
  const cleared = c.mnViewsClearConditions({ filters: any.filters });
  assert.equal('properties' in cleared.filters, false);
  assert.equal('propertiesMatch' in cleared.filters, false);
  // Clearing conditions must not clear the scope; they are separate controls.
  assert.deepEqual(cleared.filters.tags, ['work']);

  // Refusals rather than throws, and the caps the sanitizer enforces.
  assert.equal(c.mnViewsAddCondition(base, '   ').reason, 'key');
  assert.equal(c.mnViewsRemoveCondition(base, 3).reason, 'missing');
  assert.equal(c.mnViewsUpdateCondition({ filters: added.filters }, 0, { value: 'x'.repeat(501) }).reason, 'long');
  const full = { filters: { properties: Array.from({ length: 20 }, (_, n) => ({ key: `k${n}`, op: 'is' })) } };
  assert.equal(c.mnViewsAddCondition(full, 'one-more').reason, 'cap');

  // Reading tolerates a definition written before operators existed.
  assert.deepEqual(
    c.mnViewsConditions({ filters: { properties: [{ key: 'priority', value: ['high'] }] } }),
    [{ key: 'priority', op: 'is', value: 'high' }]
  );

  // The chip has to say whether rows are being held back.
  assert.equal(c.mnViewsConditionsSummary(base), 'None');
  assert.equal(c.mnViewsConditionsSummary({ filters: valued.filters }), 'priority is high, urgent');
  assert.equal(c.mnViewsConditionsSummary({ filters: emptied.filters }), 'priority is empty');
  assert.equal(c.mnViewsConditionsSummary({ filters: any.filters }), '2 any');

  // End to end: what the builder writes is what the engine matches on, and it
  // survives the sanitizer that would otherwise reject the whole save.
  const manage = loadRendererModule('src/features/views/viewsManage.js');
  const saved = manage.mnViewsApplyDraft([base], { id: 'work_view', filters: any.filters });
  assert.equal(manage.mnViewsCheckSavable(saved.definitions).ok, true);
  const note = { id: 'n', title: 'n', body: 'priority:: high\nowner:: ana\n', tags: ['work'] };
  assert.equal(appHelpers.smartViewMatchesNote(note, saved.definitions[0]), true);
});

test('normalizing a definition twice does not change what it matches', () => {
  // smartViewQuery normalizes and passes the result to smartViewQueryNotes,
  // which normalizes again. Any field that changes name between the raw and
  // normalized shapes is silently lost on that second pass.
  const definition = {
    id: 'checks', title: 'Checks', type: 'notes',
    filters: {
      properties: [{ key: 'owner', op: 'not', value: ['sam'] }],
      propertiesMatch: 'any',
      tags: ['work'],
      linkedNotes: ['Atlas'],
      actionStatuses: ['open'],
    },
    sort: { field: 'title', direction: 'asc' },
  };
  const once = appHelpers.smartViewNormalizeDefinition(definition);
  const twice = appHelpers.smartViewNormalizeDefinition(once);
  assert.deepEqual(twice, once);

  // And the whole way through the query, which is where it actually bit.
  const notes = [
    { id: 'a', title: 'A', tags: ['work'], body: 'owner:: sam\n' },
    { id: 'b', title: 'B', tags: ['work'], body: 'owner:: ana\n' },
  ];
  const query = { id: 'q', title: 'Q', type: 'notes', filters: { properties: [{ key: 'owner', op: 'is', value: ['sam'] }] } };
  assert.deepEqual(appHelpers.smartViewQuery(notes, query, { allNotes: notes }).map(r => r.noteId), ['a']);
  const negated = { ...query, filters: { properties: [{ key: 'owner', op: 'not', value: ['sam'] }] } };
  assert.deepEqual(appHelpers.smartViewQuery(notes, negated, { allNotes: notes }).map(r => r.noteId), ['b']);
});

test('the renderer and the main process allow exactly the same filter keys', () => {
  // These two lists are mirrored by hand. When they disagree, a view saves in
  // the renderer and is rejected at the IPC boundary, which surfaces as a
  // failed save rather than as anything pointing at the mismatch.
  const fs = require('fs');
  const path = require('path');
  const readList = (file, marker, end) => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = source.indexOf(marker);
    assert.ok(start > 0, `marker not found in ${file}: ${marker}`);
    const block = source.slice(start, source.indexOf(end, start));
    return [...block.matchAll(/'([a-zA-Z]+)'/g)].map(hit => hit[1]).sort();
  };
  const ipc = readList('lib/connectors/ipc/preferenceValidation.js', 'const SMART_VIEW_FILTER_KEYS = new Set([', ']);');
  // The renderer list moved to its own module so the contract is a contract
  // rather than a literal buried in a validator; the parity rule is unchanged.
  const renderer = readList('src/app/helpers/smartViewFilters.js', 'const SMART_VIEW_FILTER_KEYS = [', '];');
  assert.ok(ipc.length > 20, `expected a real filter allowlist, got ${ipc.length}`);
  assert.deepEqual(renderer, ipc);
  assert.ok(ipc.includes('propertiesMatch'));
});

test('two scoped tags match either tag, and can be switched to demand both', () => {
  const helpers = appHelpers;
  const sc = loadRendererModule('src/features/views/viewsScope.js');
  const notes = [
    { id: 'n1', title: 'Only work', tags: ['work'], body: '', date: '2026-01-01', modifiedAt: '2026-01-01' },
    { id: 'n2', title: 'Only home', tags: ['home'], body: '', date: '2026-01-02', modifiedAt: '2026-01-02' },
    { id: 'n3', title: 'Both', tags: ['work', 'home'], body: '', date: '2026-01-03', modifiedAt: '2026-01-03' },
    { id: 'n4', title: 'Neither', tags: ['idle'], body: '', date: '2026-01-04', modifiedAt: '2026-01-04' },
  ];
  const run = (filters) => helpers
    .smartViewQuery(notes, { type: 'notes', filters, sort: { field: 'created', direction: 'asc' }, limit: 50 })
    .map(row => row.title);

  // The reported bug: picking a second tag emptied the view, because a note
  // had to carry every tag picked and almost none carries two.
  assert.deepEqual(run({ tags: ['work', 'home'] }), ['Only work', 'Only home', 'Both'],
    'two tags mean either of them');
  assert.deepEqual(run({ tags: ['work', 'home'], tagsMatch: 'all' }), ['Both'],
    'all is still available for the stricter reading');
  assert.deepEqual(run({ tags: ['work'] }), ['Only work', 'Both'], 'one tag is unaffected either way');

  // Switching mode is a filter edit like any other and leaves the rest alone.
  const base = { filters: { tags: ['work', 'home'], actionStatus: 'open' } };
  const strict = sc.mnViewsSetScopeMatch(base, 'tags', 'all');
  assert.deepEqual(strict.filters, { tags: ['work', 'home'], actionStatus: 'open', tagsMatch: 'all' });
  // 'any' is the default, so it is not written back into the definition.
  assert.deepEqual(sc.mnViewsSetScopeMatch(strict, 'tags', 'any').filters,
    { tags: ['work', 'home'], actionStatus: 'open' });
  assert.equal(sc.mnViewsScopeMatch(strict, 'tags'), 'all');
  assert.equal(sc.mnViewsScopeMatch(base, 'tags'), 'any');
  // Clearing scope takes the match modes with it rather than leaving a rule
  // behind for a list that no longer exists.
  assert.deepEqual(sc.mnViewsClearScope(strict).filters, { actionStatus: 'open' });
});

test('scoped links match any of the notes picked unless all is asked for', () => {
  const helpers = appHelpers;
  const notes = [
    { id: 'a', title: 'Alpha', tags: [], body: '', date: '2026-01-01', modifiedAt: '2026-01-01' },
    { id: 'b', title: 'Beta', tags: [], body: '', date: '2026-01-02', modifiedAt: '2026-01-02' },
    { id: 'one', title: 'Links one', tags: [], body: 'see [[Alpha]]', date: '2026-01-03', modifiedAt: '2026-01-03' },
    { id: 'two', title: 'Links both', tags: [], body: '[[Alpha]] and [[Beta]]', date: '2026-01-04', modifiedAt: '2026-01-04' },
  ];
  const run = (filters) => helpers
    .smartViewQuery(notes, { type: 'notes', filters, sort: { field: 'created', direction: 'asc' }, limit: 50 })
    .map(row => row.title);

  assert.deepEqual(run({ linkedNotes: ['Alpha', 'Beta'] }), ['Links one', 'Links both']);
  assert.deepEqual(run({ linkedNotes: ['Alpha', 'Beta'], linkedNotesMatch: 'all' }), ['Links both']);
});

test('scope narrows a view without losing the filters it already had', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const sc = loadRendererModule('src/features/views/viewsScope.js');
  const manage = loadRendererModule('src/features/views/viewsManage.js');

  // Scope is stored in the filters the query engine already understands, so
  // the filters a view came with have to survive being scoped.
  const base = { id: 'open_tasks', title: 'Open tasks', type: 'tasks', filters: { actionStatus: 'open' } };
  const tagged = sc.mnViewsToggleScope(base, 'tags', 'Work');
  assert.equal(tagged.ok, true);
  assert.deepEqual(tagged.filters, { actionStatus: 'open', tags: ['Work'] });

  // Toggling is case-insensitive, so the same tag cannot be added twice under
  // a different case and then fail to come off.
  const twice = sc.mnViewsToggleScope({ ...base, filters: tagged.filters }, 'tags', 'work');
  assert.deepEqual(twice.filters, { actionStatus: 'open' });

  // An emptied scope removes the key rather than storing an empty array.
  assert.equal('tags' in twice.filters, false);

  // The sanitizer caps a filter array at 40 items and a string at 500 chars.
  const many = { filters: { tags: Array.from({ length: 40 }, (_, n) => `t${n}`) } };
  assert.equal(sc.mnViewsToggleScope(many, 'tags', 'one-more').reason, 'cap');
  assert.equal(sc.mnViewsToggleScope(base, 'tags', 'x'.repeat(501)).reason, 'long');
  assert.equal(sc.mnViewsToggleScope(base, 'tags', '   ').reason, 'empty');

  // Clearing scope leaves everything that was not scope alone.
  const linked = sc.mnViewsToggleScope({ ...base, filters: tagged.filters }, 'linkedNotes', 'Project Atlas');
  assert.deepEqual(linked.filters, { actionStatus: 'open', tags: ['Work'], linkedNotes: ['Project Atlas'] });
  assert.deepEqual(sc.mnViewsClearScope({ ...base, filters: linked.filters }).filters, { actionStatus: 'open' });

  // The chip has to say why you are not seeing everything.
  assert.equal(sc.mnViewsScopeSummary(base), 'Whole vault');
  assert.equal(sc.mnViewsScopeSummary({ filters: tagged.filters }), '#Work');
  // The summary names the rule, not just the count: with two tags the
  // difference between any and all is the difference between a full list and
  // an empty one, so the chip cannot leave it unsaid.
  assert.equal(sc.mnViewsScopeSummary({ filters: { tags: ['a', 'b'] } }), '2 any tags');
  assert.equal(sc.mnViewsScopeSummary({ filters: { tags: ['a', 'b'], tagsMatch: 'all' } }), '2 all tags');
  assert.equal(sc.mnViewsScopeSummary({ filters: linked.filters }), '#Work + links to Project Atlas');
  assert.equal(sc.mnViewsScopeIsSet({ filters: linked.filters }), true);
  assert.equal(sc.mnViewsScopeIsSet(base), false);

  // The pickable tags are what the notes carry, not only what the vault has
  // registered — a tag typed into a note is real to the query, so refusing to
  // offer it would make a view filterable by something the menu cannot show.
  const choices = sc.mnViewsScopeTagChoices(
    [{ name: 'welcome', hue: 20 }],
    [{ tags: ['qe-regression', 'Welcome'] }, { tags: ['work'] }, {}],
    ['gone-from-the-vault']
  );
  assert.deepEqual(choices, ['gone-from-the-vault', 'qe-regression', 'welcome', 'work']);

  // Whatever the menu produces has to survive the preference sanitizer.
  const saved = manage.mnViewsApplyDraft([base], { id: 'open_tasks', filters: linked.filters });
  assert.equal(manage.mnViewsCheckSavable(saved.definitions).ok, true);
  assert.deepEqual(saved.definitions[0].filters, linked.filters);
});

test('columns are discovered from what notes actually carry, and reorder safely', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const c = loadRendererModule('src/features/views/viewsColumns.js');

  const rows = [
    { type: 'note', title: 'A', tags: ['x'], note: { body: 'priority:: high\nowner:: sam\n' } },
    { type: 'note', title: 'B', note: { body: '- owner:: ana\nPRIORITY:: low\n' } },
    { type: 'note', title: 'C', note: { body: 'notakey::\nSome:: thing\n' } },
  ];

  // A key exists because it was written. Coverage counts rows, keys sort by
  // how many rows carry them, and a key with no value on the line is not one.
  const found = c.mnViewsDiscoverProperties(rows, ['title', 'tags', 'modified', 'created', 'words']);
  const byKey = Object.fromEntries(found.map(col => [col.key, col.count]));
  assert.equal(byKey.owner, 2);
  assert.equal(byKey.priority, 1);
  assert.equal(byKey.PRIORITY, 1);
  assert.equal(byKey.Some, 1);
  assert.equal('notakey' in byKey, false);
  assert.deepEqual(found.map(col => col.key)[0], 'owner');
  assert.equal(found[0].origin, 'property');

  // A property key that collides with a built-in column would shadow it, so
  // it is not offered twice.
  const shadowed = c.mnViewsDiscoverProperties(
    [{ type: 'note', note: { body: 'tags:: one\nowner:: sam\n' } }],
    ['title', 'tags']
  );
  assert.deepEqual(shadowed.map(col => col.key), ['owner']);

  // The catalogue is the built-ins with their own coverage, then the found keys.
  const cat = c.mnViewsCatalogue({ type: 'notes' }, rows);
  assert.deepEqual(cat.slice(0, 5).map(col => col.key), ['title', 'tags', 'modified', 'created', 'words']);
  assert.equal(cat.find(col => col.key === 'title').count, 3);
  assert.equal(cat.find(col => col.key === 'tags').count, 1);
  assert.equal(cat.find(col => col.key === 'owner').count, 2);

  // The first toggle starts from what is showing, so turning one key on does
  // not silently drop the columns the row type came with.
  const on = c.mnViewsToggleColumn({ type: 'notes' }, 'owner');
  assert.deepEqual(on.columns, ['title', 'tags', 'modified', 'created', 'words', 'owner']);
  const off = c.mnViewsToggleColumn({ type: 'notes', columns: on.columns }, 'modified');
  assert.deepEqual(off.columns, ['title', 'tags', 'created', 'words', 'owner']);

  // The row's own column cannot be turned off, and the list cannot be emptied.
  assert.equal(c.mnViewsToggleColumn({ type: 'notes' }, 'title').reason, 'fixed');
  assert.equal(c.mnViewsToggleColumn({ type: 'notes', columns: ['title'] }, 'title').reason, 'fixed');

  // Reorder never moves anything into the first slot and never runs off an end.
  const start = { type: 'notes', columns: ['title', 'tags', 'modified', 'owner'] };
  assert.deepEqual(c.mnViewsMoveColumn(start, 'modified', -1).columns, ['title', 'modified', 'tags', 'owner']);
  assert.deepEqual(c.mnViewsMoveColumn(start, 'modified', 1).columns, ['title', 'tags', 'owner', 'modified']);
  assert.equal(c.mnViewsMoveColumn(start, 'tags', -1).reason, 'edge');
  assert.equal(c.mnViewsMoveColumn(start, 'owner', 1).reason, 'edge');
  assert.equal(c.mnViewsMoveColumn(start, 'title', -1).reason, 'edge');
  assert.equal(c.mnViewsMoveColumn(start, 'title', 1).reason, 'edge');

  // Whatever the panel produces has to survive the preference sanitizer.
  const manage = loadRendererModule('src/features/views/viewsManage.js');
  const saved = manage.mnViewsApplyDraft(
    [{ id: 'recent_notes', title: 'Recent notes', type: 'notes' }],
    { id: 'recent_notes', columns: on.columns }
  );
  assert.equal(manage.mnViewsCheckSavable(saved.definitions).ok, true);
  assert.deepEqual(saved.definitions[0].columns, on.columns);
});

test('managing saved views refuses what the preference layer would throw on', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const m = loadRendererModule('src/features/views/viewsManage.js');
  const seed = [
    { format: 'vispnote.smartView.v2', id: 'recent_notes', title: 'Recent notes', type: 'notes', filters: {}, limit: 60 },
    { format: 'vispnote.smartView.v2', id: 'open_tasks', title: 'Open tasks', type: 'tasks', filters: {}, limit: 80 },
  ];

  // Ids are derived from the title, and the id rule the sanitizer enforces
  // (leading letter, then letters/digits/_/-) has to hold for free text.
  const made = m.mnViewsCreate(seed, { title: '  3 things!!  ', format: 'vispnote.smartView.v2' });
  assert.equal(made.ok, true);
  assert.match(made.definitions[2].id, m.MN_VIEW_ID_RE);
  assert.equal(made.definitions[2].title, '3 things!!');
  assert.equal(made.definitions[2].format, 'vispnote.smartView.v2');

  // A title with nothing id-safe in it still has to produce a legal id.
  const symbols = m.mnViewsCreate(seed, { title: '???' });
  assert.equal(symbols.ok, true);
  assert.match(symbols.definitions[2].id, m.MN_VIEW_ID_RE);

  // Never two views with the same id: the sanitizer throws on a duplicate.
  const twice = m.mnViewsCreate(m.mnViewsCreate(seed, { title: 'Notes' }).definitions, { title: 'Notes' });
  assert.equal(twice.ok, true);
  assert.equal(new Set(twice.definitions.map(d => d.id)).size, twice.definitions.length);
  assert.equal(new Set(twice.definitions.map(d => d.title)).size, twice.definitions.length);

  // The cap is 24 and the sanitizer throws above it, so creating the 25th is
  // refused with a reason rather than attempted.
  const full = Array.from({ length: 24 }, (_, n) => ({ id: `view_${n + 1}`, title: `View ${n + 1}` }));
  assert.deepEqual(m.mnViewsCreate(full, { title: 'One more' }), { ok: false, reason: 'cap' });
  assert.equal(m.mnViewsCheckSavable(full).ok, true);
  assert.equal(m.mnViewsCheckSavable([...full, { id: 'view_25', title: 'x' }]).reason, 'cap');

  // A duplicate lands beside its source, carrying the source's shape.
  const copied = m.mnViewsDuplicate(seed, 'recent_notes');
  assert.equal(copied.ok, true);
  assert.equal(copied.definitions[1].title, 'Recent notes copy');
  assert.equal(copied.definitions[1].type, 'notes');
  assert.equal(copied.definitions[1].limit, 60);
  assert.equal(copied.definitions[2].id, 'open_tasks');

  // Renaming refuses a blank or a name already in use.
  assert.equal(m.mnViewsRename(seed, 'open_tasks', '  ').reason, 'empty');
  assert.equal(m.mnViewsRename(seed, 'open_tasks', 'recent notes').reason, 'duplicate');
  assert.equal(m.mnViewsRename(seed, 'open_tasks', ' Doing  now ').definitions[1].title, 'Doing now');

  // Deleting the last view is refused: an empty saved list makes the app fall
  // back to the built-in defaults, so the view would appear to come back.
  assert.equal(m.mnViewsDelete(seed, 'open_tasks').definitions.length, 1);
  assert.equal(m.mnViewsDelete([seed[0]], 'recent_notes').reason, 'last');
  assert.equal(m.mnViewsDelete(seed, 'nope').reason, 'missing');

  // Drafts: a change is dirty, saving folds it in, and unknown keys never
  // reach the saved shape.
  assert.equal(m.mnViewsDraftDiffers(seed[0], { id: 'recent_notes', layout: 'table' }), true);
  assert.equal(m.mnViewsDraftDiffers(seed[0], { id: 'recent_notes', title: 'Recent notes' }), false);
  const saved = m.mnViewsApplyDraft(seed, { id: 'recent_notes', layout: 'table', bogus: 1 });
  assert.equal(saved.definitions[0].layout, 'table');
  assert.equal('bogus' in saved.definitions[0], false);
  assert.equal(m.mnViewsCheckSavable(saved.definitions).ok, true);
});

test('a view row resolves to the exact block it was parsed from', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const write = loadRendererModule('src/features/views/viewsWrite.js');
  const walk = (blocks, fn) => (blocks || []).forEach(b => { fn(b); walk(b.children, fn); });

  // The common case: the row remembers the block it came from, so the edit
  // lands exactly there rather than being matched by text.
  const anchored = write.mnViewsActionItem({
    noteId: 'n1', label: 'ship it', text: '- [ ] ship it', checked: false,
    source: { blockId: 'b_7', line: null, text: '- [ ] ship it' },
  }, { note: { id: 'n1', blocks: [] }, walk });
  assert.equal(anchored.ok, true);
  assert.equal(anchored.item.blockId, 'b_7');
  assert.equal(anchored.item.noteId, 'n1');

  // Anchor gone, but the text occurs once: re-find it.
  const note = { id: 'n1', blocks: [
    { id: 'b_1', content: 'unrelated', children: [] },
    { id: 'b_2', content: 'ship it', children: [] },
  ] };
  const relocated = write.mnViewsActionItem({
    noteId: 'n1', label: 'ship it', text: 'ship it', source: {},
  }, { note, walk });
  assert.equal(relocated.ok, true);
  assert.equal(relocated.item.blockId, 'b_2');

  // Anchor gone and the text appears twice: refuse. Picking either one is a
  // coin flip against the user's note, and the old path silently edited
  // nothing while reporting success.
  const twice = { id: 'n1', blocks: [
    { id: 'b_1', content: 'standup', children: [] },
    { id: 'b_2', content: 'standup', children: [] },
  ] };
  const ambiguous = write.mnViewsActionItem({
    noteId: 'n1', label: 'standup', text: 'standup', source: {},
  }, { note: twice, walk });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'ambiguous');

  // Nothing matches at all.
  const missing = write.mnViewsActionItem({
    noteId: 'n1', label: 'gone', text: 'gone', source: {},
  }, { note, walk });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'unlocatable');

  // A row with no note cannot be written anywhere.
  assert.equal(write.mnViewsActionItem({ label: 'orphan' }, {}).ok, false);
});

test('the calendar places rows by the date the other layouts print', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const cal = loadRendererModule('src/features/views/ViewsCalendar.jsx');

  const results = [
    { key: 'a', type: 'task', reminderDate: '2026-07-29', label: 'due today' },
    { key: 'b', type: 'task', reminderDate: '2026-07-29', label: 'also today' },
    { key: 'c', type: 'note', modifiedDate: '2026-07-28', title: 'edited note' },
    { key: 'd', type: 'task', label: 'no date at all' },
    { key: 'e', type: 'note', title: 'nothing usable', modifiedDate: 'not-a-date' },
  ];
  const { byDate, undated } = cal.mnViewsResultsByDate(results, {});

  // A task lands on its reminder date, a note on when it was modified — the
  // same date each row shows in the table.
  assert.deepEqual([...byDate.get('2026-07-29')].map(r => r.key), ['a', 'b']);
  assert.deepEqual([...byDate.get('2026-07-28')].map(r => r.key), ['c']);

  // Undated rows are kept, not dropped. A calendar that silently discarded
  // them would under-report what the view actually matched.
  assert.deepEqual(undated.map(r => r.key), ['d', 'e']);
  assert.equal(
    [...byDate.values()].reduce((n, list) => n + list.length, 0) + undated.length,
    results.length,
    'every row is placed exactly once'
  );
});

test('a board view always has columns to draw', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const board = loadRendererModule('src/features/views/ViewsBoard.jsx');

  // A board is columns. A definition asking for the board layout without
  // saying how to split it would otherwise render one undifferentiated
  // column, which is just a worse list.
  assert.deepEqual(board.mnViewsBoardGroup({ layout: 'board' }), { by: 'status', direction: 'asc' });
  assert.deepEqual(board.mnViewsBoardGroup({}), { by: 'status', direction: 'asc' });
  // An explicit group always wins.
  assert.deepEqual(
    board.mnViewsBoardGroup({ layout: 'board', group: { by: 'priority', direction: 'desc' } }),
    { by: 'priority', direction: 'desc' }
  );
});

test('a saved view opens in the layout it was saved with', async () => {
  const { loadRendererModule } = require('./helpers/rendererModule.js');
  const panel = loadRendererModule('src/panels/smartViewsPanel.jsx');
  const presentation = panel.mnSmartViewPresentation;

  // layout has been validated and persisted end to end for a while; the panel
  // just never read it, so a view saved as a table always reopened as a list.
  assert.equal(presentation({ layout: 'table' }), 'table');
  assert.equal(presentation({ layout: 'cards' }), 'cards');
  assert.equal(presentation({ layout: 'timeline' }), 'timeline');
  assert.equal(presentation({ layout: 'list' }), 'list');

  // The Views feature draws boards; this panel does not, so a board
  // definition still falls back here.
  assert.equal(presentation({ layout: 'board' }), 'list');
  assert.equal(presentation({ layout: 'calendar' }), 'list');

  assert.equal(presentation({}), 'list');
  assert.equal(presentation(null), 'list');
  assert.equal(presentation({ layout: 'TABLE' }), 'table', 'layout match is case-insensitive');
  assert.equal(presentation({ layout: 'nonsense' }), 'list');
});

test('Smart View text that YAML could reinterpret survives export and import', () => {
  // The reader recognises a structured value by its first character, so a bare
  // [WIP] was handed to JSON.parse: the export threw on import, and [1,2] came
  // back as an array flattened to "1,2".
  for (const title of [
    '[WIP]', '[[Note]]', '[1,2]', '{note}', "'quoted'", '"quoted"',
    'true', 'null', 'yes', '1e3', '.nan', '2026-08-01', '*alias', '@owner', '- item', 'Plain title',
  ]) {
    const saved = appHelpers.smartViewValidateSavedDefinition({
      id: 'bracket_view', title, type: 'notes',
      filters: { titleContains: title }, sort: { field: 'modified', direction: 'desc' }, limit: 50,
    });
    const yaml = appHelpers.smartViewSerializeDefinition(saved, 'yaml');
    const parsed = appHelpers.smartViewParseDefinitionText(yaml, 'bracket-view.yaml');
    assert.equal(parsed.title, title, `${JSON.stringify(title)} must round-trip through YAML`);
    assert.equal(parsed.filters.titleContains, title);
    if (title !== 'Plain title') {
      assert.match(yaml, new RegExp(`title: ${JSON.stringify(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
  }
});

test('legacy Smart View YAML parses structured values only for structured fields', () => {
  for (const title of ['[WIP]', '[1,2]', '{"owner":"sam"}']) {
    const yaml = `format: vispnote.smartView.v2\nid: v_old\ntitle: ${title}\ntype: notes\nfilters:\n  titleContains: ${title}\n`;
    const parsed = appHelpers.smartViewParseDefinitionText(yaml, 'old.yaml');
    assert.equal(parsed.title, title, `${title} remains title text`);
    assert.equal(parsed.filters.titleContains, title, `${title} remains filter text`);
  }

  const withStructuredFields = [
    'format: vispnote.smartView.v2',
    'id: v_a',
    'title: T',
    'type: notes',
    'filters:',
    '  tags: ["work","home"]',
    '  properties: [{"key":"priority","value":"high"}]',
    'columns: ["__proto__","owner"]',
  ].join('\n');
  const parsed = appHelpers.smartViewParseDefinitionText(withStructuredFields, 'structured.yaml');
  assert.deepEqual(parsed.filters.tags, ['work', 'home']);
  assert.deepEqual(parsed.filters.properties, [{ key: 'priority', values: ['high'], op: 'is' }]);
  assert.deepEqual(parsed.columns, ['__proto__', 'owner']);
});

test('a note whose id names an Object.prototype member still builds the outline', () => {
  // A note id is its file name for anything hand-made or synced in, and
  // constructor.md is an ordinary file to find in a vault. Keyed into a plain
  // object those ids already resolved to prototype members, so the outline
  // threw `bucket[parentId].includes is not a function` and took the Novelist
  // panel with it — or, for __proto__, quietly dropped the note.
  for (const actId of ['n_act', 'constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    const structure = appHelpers.buildNovelistStructure([
      { id: actId, title: 'Act One', tags: ['novel-act'], body: '' },
      { id: 'n_ch', title: 'Chapter 1', tags: ['novel-chapter'], body: 'act:: [[Act One]]' },
      { id: 'n_sc', title: 'Scene 1', tags: ['novel-scene'], body: 'chapter:: [[Chapter 1]]' },
    ]);
    assert.equal(structure.acts.length, 1, `${actId} must still be an act`);
    assert.equal(structure.chapters.length, 1, `${actId} must not lose its chapter`);
    assert.equal(structure.scenes.length, 1, `${actId} must not lose its scene`);
    assert.equal(structure.acts[0].id, actId);
    assert.deepEqual(structure.pathByNoteId[actId].map(note => note.id), [actId]);
    assert.equal(Object.getPrototypeOf(structure.pathByNoteId), null);
  }
});
