const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ops = require('../src/editor/editorOps.js');
const tableOps = require('../src/editor/tableOps.js');
const appHelpers = require('../src/app/appHelpers.js');
const appNovelist = require('../src/app/appNovelist.js');
const appMutations = require('../src/app/appMutations.js');
const appCanvasActions = require('../src/app/appCanvasActions.js');
const panelHelpers = require('../src/panels/panelHelpers.js');
const aiActions = require('../src/ai/aiActions.js');
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
      properties: [{ key: 'priority', values: ['high'] }],
      workflowStatuses: ['DOING'],
      linkedNotes: ['Research AI'],
      actionStatuses: [],
      actionTypes: [],
      reminderFrom: '',
      reminderTo: '',
    },
    sort: { field: 'created', direction: 'asc' },
    limit: 2,
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
    { id: 'n1', title: 'Draft', tags: ['project'], body: 'status:: DRAFT\n# Draft\n- Body', modifiedAt: '2026-05-06T00:00:00.000Z' },
    { id: 'n2', title: 'Archived', tags: [], body: 'status:: DONE\nClosed', workflowArchived: true },
    { id: 'n3', title: 'No status', tags: [], body: 'Body' },
  ], [{ id: 'DRAFT' }, { id: 'DONE' }]);
  assert.equal(workflow.counts.DRAFT, 1);
  assert.equal(workflow.counts.DONE, 0);
  assert.deepEqual([...workflow.noteIdsByState.DRAFT], ['n1']);
  assert.deepEqual(workflow.archivedNotes.map(note => note.id), ['n2']);
  assert.equal(workflow.byState.DRAFT[0].text, 'Body');
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
    mn: { async saveCanvas() { return { ok: false, error: 'disk full' }; } },
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

  const panels = fs.readFileSync(path.join(__dirname, '../src/panels/panels.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  assert.doesNotMatch(panels, /## Chapters\\n- '\s*}/);
  assert.doesNotMatch(panels, /## Scenes\\n- '\s*}/);
  assert.doesNotMatch(panels, /body: '# (Story Root|Act|Chapter|Scene|Character|Location|Plot Thread|Research|Revision Note)/);
  assert.match(editor, /function mnEditorSplitPropertyBlocks/);
  assert.match(editor, /blocks=\{contentBlocks\}/);
  assert.match(editor, /status::/);
  assert.match(editor, /function mnEditorCleanPropertyKey/);
  assert.match(editor, /\+ property/);
  assert.match(editor, /removeMetadataProperty/);
  assert.doesNotMatch(editor, /borderTop: `1px solid \$\{T\.lineSub\}`,[\s\S]*borderBottom: `1px solid \$\{T\.lineSub\}`/);
  const outliner = fs.readFileSync(path.join(__dirname, '../src/editor/outliner.jsx'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/editor/blockFeatures.jsx'), 'utf8');
  assert.match(outliner, /id: 'block-label'/);
  assert.match(outliner, /blockLabelAction/);
  assert.match(outliner, /Marker: \$\{state\.id\}/);
  assert.match(outliner, /setLabelMenu/);
  assert.match(blockFeatures, /label="Add label"/);
});
