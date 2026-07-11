const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const appActions = require('../src/app/appActions.js');
const { aiActions } = loadRendererModule('src/ai/aiActions.js');
const { aiRuntime } = loadRendererModule('src/ai/aiRuntime.js');

test('App Action Registry validates schemas and blocks unknown actions', async () => {
  let created = null;
  const registry = appActions.createRegistry([
    {
      id: 'create-note',
      label: 'Create note',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', maxLength: 12 } },
        required: ['title'],
        additionalProperties: false,
      },
      run: (args) => {
        created = args.title;
        return { message: `Created ${args.title}`, affected: [{ type: 'note', id: 'n1', title: args.title }] };
      },
    },
  ]);

  assert.equal(registry.list()[0].risk, 'safe');
  assert.throws(() => registry.validate('missing', {}), /Unknown app action/);
  assert.throws(() => registry.validate('create-note', { title: 'Draft', extra: true }), /Unsupported action argument/);
  assert.throws(() => registry.validate('create-note', { title: '   ' }), /Missing action argument: title/);
  const result = await registry.run('create-note', { title: 'Long title value' });
  assert.equal(result.ok, true);
  assert.equal(created, 'Long title v');
  assert.equal(result.affected[0].id, 'n1');
});

test('Confirm-risk App Actions preview without mutation until confirmed', async () => {
  let deleted = false;
  const registry = appActions.createRegistry([
    {
      id: 'delete-note',
      label: 'Delete note',
      risk: 'destructive',
      inputSchema: {
        type: 'object',
        properties: { noteId: { type: 'string' } },
        required: ['noteId'],
        additionalProperties: false,
      },
      preview: (args) => ({ title: 'Delete note', message: `Delete ${args.noteId}`, affected: [{ type: 'note', id: args.noteId }] }),
      run: () => {
        deleted = true;
        return { message: 'Deleted' };
      },
    },
  ]);

  const preview = await registry.run('delete-note', { noteId: 'n1' });
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(deleted, false);
  assert.equal(preview.preview.affected[0].id, 'n1');

  const confirmed = await registry.run('delete-note', { noteId: 'n1' }, { confirmed: true });
  assert.equal(confirmed.ok, true);
  assert.equal(deleted, true);
});

test('App Action natural plans include confidence and avoid summary-create interception', () => {
  const registry = appActions.createRegistry([
    {
      id: 'tag-note',
      label: 'Tag note',
      inputSchema: {
        type: 'object',
        properties: { tag: { type: 'string' } },
        required: ['tag'],
        additionalProperties: false,
      },
      run: () => ({}),
    },
    {
      id: 'settings',
      label: 'Open settings',
      inputSchema: { type: 'object', additionalProperties: false },
      run: () => ({}),
    },
  ]);

  const tagPlan = registry.findForText('tag this note under reading');
  assert.equal(tagPlan.confidence, 'high');
  assert.equal(tagPlan.source, 'direct-router');
  assert.equal(tagPlan.steps[0].actionId, 'tag-note');
  assert.equal(tagPlan.steps[0].args.tag, 'reading');
  assert.equal(appActions.extractTagName('tag it under reading'), 'reading');
  assert.equal(registry.findForText('summarise all my notes and create a new one then tag it under reading'), null);
});

test('App Action natural plans compound named-note status and tag updates', () => {
  const schema = {
    type: 'object',
    properties: {
      noteId: { type: 'string' },
      noteTitle: { type: 'string' },
      targetTitle: { type: 'string' },
      status: { type: 'string' },
      tag: { type: 'string' },
    },
    additionalProperties: false,
  };
  const registry = appActions.createRegistry([
    { id: 'todos', label: 'Open todos', inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
    { id: 'calendar', label: 'Open calendar', inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
    { id: 'settings', label: 'Open settings', inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
    { id: 'set-workflow-status', label: 'Set workflow status', inputSchema: { ...schema, required: ['status'] }, run: () => ({}) },
    { id: 'tag-note', label: 'Tag note', inputSchema: { ...schema, required: ['tag'] }, run: () => ({}) },
  ]);

  const plan = registry.findForText('can you move the daily update check list to inprogress, and tag it under todo');
  assert.equal(plan.intent, 'update-note');
  assert.deepEqual(plan.steps.map(step => step.actionId), ['set-workflow-status', 'tag-note']);
  assert.equal(plan.steps[0].args.noteTitle, 'daily update check list');
  assert.equal(plan.steps[0].args.status, 'inprogress');
  assert.equal(plan.steps[1].args.noteTitle, 'daily update check list');
  assert.equal(plan.steps[1].args.tag, 'todo');

  const tagOnlyPlan = registry.findForText('can you tag daily updates note to todos');
  assert.equal(tagOnlyPlan.confidence, 'high');
  assert.equal(tagOnlyPlan.steps[0].actionId, 'tag-note');
  assert.equal(tagOnlyPlan.steps[0].args.noteTitle, 'daily updates');
  assert.equal(tagOnlyPlan.steps[0].args.tag, 'todos');

  const tagOnlyRoute = aiRuntime.routeRequest({ query: 'can you tag daily updates note to todos', appRegistry: registry });
  assert.equal(tagOnlyRoute.type, 'app_action');
  assert.equal(tagOnlyRoute.plan.steps[0].actionId, 'tag-note');

  const route = aiRuntime.routeRequest({ query: 'move daily update check list to inprogress and tag it under todo', appRegistry: registry });
  assert.equal(route.type, 'app_action');
  assert.equal(route.plan.steps[0].actionId, 'set-workflow-status');
  assert.notEqual(route.plan.steps[0].actionId, 'todos');

  const settingsPlan = registry.findForText('change settings to dark mode');
  assert.equal(settingsPlan.steps[0].actionId, 'settings');

  assert.equal(registry.findForText('open todos').steps[0].actionId, 'todos');
  assert.equal(registry.findForText('todo').steps[0].actionId, 'todos');
  assert.equal(registry.findForText('open calendar').steps[0].actionId, 'calendar');
  assert.equal(registry.findForText('show my agenda').steps[0].actionId, 'calendar');
});

test('App Action natural plans cover fast AI note operations', () => {
  const schema = { type: 'object', additionalProperties: true };
  const registry = appActions.createRegistry([
    { id: 'new-note', label: 'New note', inputSchema: schema, run: () => ({}) },
    { id: 'search-notes', label: 'Search notes', inputSchema: schema, run: () => ({}) },
    { id: 'add-todo-to-note', label: 'Add todo to note', inputSchema: schema, run: () => ({}) },
    { id: 'add-reminder-to-note', label: 'Add reminder to note', inputSchema: schema, run: () => ({}) },
    { id: 'link-note', label: 'Link note', inputSchema: schema, run: () => ({}) },
    { id: 'append-to-note', label: 'Append to note', inputSchema: schema, run: () => ({}) },
  ]);

  const searchPlan = registry.findForText('search notes for reading list');
  assert.equal(searchPlan.steps[0].actionId, 'search-notes');
  assert.equal(searchPlan.steps[0].args.query, 'reading list');

  const quotedCreatePlan = registry.findForText('create new note called "AI hope"');
  assert.equal(quotedCreatePlan.steps[0].actionId, 'new-note');
  assert.equal(quotedCreatePlan.steps[0].args.title, 'AI hope');

  const typoCreatePlan = registry.findForText('create new not called AI hope');
  assert.equal(typoCreatePlan.steps[0].actionId, 'new-note');
  assert.equal(typoCreatePlan.steps[0].args.title, 'AI hope');

  const ampersandTitlePlan = registry.findForText('create a note called Research and Development');
  assert.equal(ampersandTitlePlan.steps[0].actionId, 'new-note');
  assert.equal(ampersandTitlePlan.steps[0].args.title, 'Research and Development');

  const todoPlan = registry.findForText('add todo to this note call the publisher');
  assert.equal(todoPlan.steps[0].actionId, 'add-todo-to-note');
  assert.equal(todoPlan.steps[0].args.text, 'call the publisher');

  const reminderPlan = registry.findForText('remind me to renew the license tomorrow');
  assert.equal(reminderPlan.steps[0].actionId, 'add-reminder-to-note');
  assert.equal(reminderPlan.steps[0].args.text, 'renew the license tomorrow');

  const linkPlan = registry.findForText('link this note to Reading List');
  assert.equal(linkPlan.steps[0].actionId, 'link-note');
  assert.equal(linkPlan.steps[0].args.targetTitle, 'Reading List');

  const quotedLinkPlan = registry.findForText('link this note to "AI hope"');
  assert.equal(quotedLinkPlan.steps[0].actionId, 'link-note');
  assert.equal(quotedLinkPlan.steps[0].args.targetTitle, 'AI hope');

  const appendPlan = registry.findForText('append reviewed by AI to this note');
  assert.equal(appendPlan.steps[0].actionId, 'append-to-note');
  assert.equal(appendPlan.steps[0].args.content, 'reviewed by AI');
});

test('App Action AI descriptions omit dynamic note, vault, and canvas commands', () => {
  const registry = appActions.createRegistry([
    { id: 'settings', label: 'Open settings', inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
    { id: 'ask-ai', label: 'Ask AI', aiHidden: true, inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
    { id: 'note-n1', label: 'Welcome', inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
    { id: 'vault-v1', label: 'Switch vault', inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
    { id: 'canvas-c1', label: 'Canvas', inputSchema: { type: 'object', additionalProperties: false }, run: () => ({}) },
  ]);
  const names = registry.describeForAi().map(item => item.name);
  assert.deepEqual(names, ['settings']);
});

test('AI execution runtime routes safely and validates planner tool calls', () => {
  const registry = appActions.createRegistry([
    {
      id: 'settings',
      label: 'Open settings',
      inputSchema: { type: 'object', additionalProperties: false },
      run: () => ({}),
      examples: ['open settings'],
    },
    {
      id: 'tag-note',
      label: 'Tag note',
      inputSchema: {
        type: 'object',
        properties: { tag: { type: 'string' } },
        required: ['tag'],
        additionalProperties: false,
      },
      run: () => ({}),
    },
  ]);

  assert.equal(aiRuntime.routeRequest({ query: 'fix it', appRegistry: registry }).type, 'clarify');
  assert.equal(aiRuntime.routeRequest({ query: 'can you summarize all my notes', appRegistry: registry }).type, 'notes');
  assert.equal(aiRuntime.routeRequest({ query: 'describe yourself', aiActions, appRegistry: registry }).type, 'chat');
  assert.equal(aiRuntime.routeRequest({ query: 'what are you', aiActions, appRegistry: registry }).type, 'chat');
  assert.equal(aiRuntime.routeRequest({ query: 'what changed most recently in this vault?', aiActions, appRegistry: registry }).type, 'notes');
  assert.equal(aiRuntime.routeRequest({ query: 'open settings', appRegistry: registry }).type, 'app_action');
  assert.equal(aiRuntime.routeRequest({ query: 'find notes about reading', appRegistry: registry }).type, 'app_action');
  const formatCurrentRoute = aiRuntime.routeRequest({ query: 'format this page', aiActions, appRegistry: registry });
  assert.equal(formatCurrentRoute.type, 'legacy_action');
  assert.equal(formatCurrentRoute.action.type, 'edit-current');
  assert.equal(formatCurrentRoute.action.action, 'format');
  const supportRoute = aiRuntime.routeRequest({ query: 'update all supporting notes', aiActions, appRegistry: registry });
  assert.equal(supportRoute.type, 'legacy_action');
  assert.equal(supportRoute.action.type, 'edit-supporting-notes');
  const unavailablePaperRoute = aiRuntime.routeRequest({ query: 'get summary in the Recursive Language Model paper', appRegistry: registry });
  assert.equal(unavailablePaperRoute.type, 'clarify');
  assert.match(unavailablePaperRoute.message, /Zotero reader plugin is not enabled/);

  const zoteroRegistry = appActions.createRegistry([
    {
      id: 'zotero-list',
      label: 'List Zotero papers',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', default: 20 } },
        additionalProperties: false,
      },
      run: () => ({}),
    },
    {
      id: 'zotero-search',
      label: 'Search Zotero',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer', default: 8 } },
        required: ['query'],
        additionalProperties: false,
      },
      run: () => ({}),
    },
  ]);
  const paperRoute = aiRuntime.routeRequest({ query: 'get summary in the Recursive Language Model paper', appRegistry: zoteroRegistry });
  assert.equal(paperRoute.type, 'app_action');
  assert.equal(paperRoute.plan.steps[0].actionId, 'zotero-search');
  assert.equal(paperRoute.plan.steps[0].args.query, 'Recursive Language Model');
  const followupPaperRoute = aiRuntime.routeRequest({ query: 'ok. now Recursive Language models paper', appRegistry: zoteroRegistry });
  assert.equal(followupPaperRoute.type, 'app_action');
  assert.equal(followupPaperRoute.plan.steps[0].actionId, 'zotero-search');
  assert.equal(followupPaperRoute.plan.steps[0].args.query, 'Recursive Language models');
  const zoteroMentionRoute = aiRuntime.routeRequest({ query: 'summarize Recursive Language Models from Zotero', appRegistry: zoteroRegistry });
  assert.equal(zoteroMentionRoute.type, 'app_action');
  assert.equal(zoteroMentionRoute.plan.steps[0].actionId, 'zotero-search');
  assert.equal(zoteroMentionRoute.plan.steps[0].args.query, 'Recursive Language Models');
  const zoteroCreateRoute = aiRuntime.routeRequest({ query: 'check zotero and create new note summarizing the RLM paper', appRegistry: zoteroRegistry });
  assert.equal(zoteroCreateRoute.type, 'app_action');
  assert.equal(zoteroCreateRoute.plan.steps[0].actionId, 'zotero-search');
  assert.equal(zoteroCreateRoute.plan.steps[0].args.query, 'RLM');
  const typoPaperRoute = aiRuntime.routeRequest({ query: 'give me summary on zotero RLM papper', appRegistry: zoteroRegistry });
  assert.equal(typoPaperRoute.type, 'app_action');
  assert.equal(typoPaperRoute.plan.steps[0].actionId, 'zotero-search');
  assert.equal(typoPaperRoute.plan.steps[0].args.query, 'RLM');
  const zoteroListRoute = aiRuntime.routeRequest({ query: 'list down the papers in zotero', appRegistry: zoteroRegistry });
  assert.equal(zoteroListRoute.type, 'app_action');
  assert.equal(zoteroListRoute.plan.intent, 'zotero-document-list');
  assert.equal(zoteroListRoute.plan.steps[0].actionId, 'zotero-list');
  assert.equal(aiRuntime.isZoteroListRequest('list down the papers in zotero'), true);
  assert.equal(aiRuntime.isZoteroListRequest('summarize the RLM paper in zotero'), false);
  assert.equal(aiRuntime.documentSearchQuery('ok. now Recursive Language models'), 'Recursive Language models');
  assert.equal(aiRuntime.documentSearchQuery('tell me about Recursive Language Models paper from Zotero'), 'Recursive Language Models');
  assert.equal(aiRuntime.documentSearchQuery('check zotero and create new note summarizing the RLM paper'), 'RLM');
  assert.equal(aiRuntime.documentSearchQuery('give me summary on zotero RLM papper'), 'RLM');

  const traceItem = aiRuntime.recordTrace(aiRuntime.makeRun({ runId: 'r1' }), 'tool.run', { actionId: 'tag-note' });
  assert.match(traceItem.label, /Running tag-note/);

  const toolShape = registry.describeForAi().find(item => item.name === 'tag-note');
  assert.equal(toolShape.title, 'Tag note');
  assert.equal(toolShape.inputSchema.properties.tag.type, 'string');
  assert.equal(toolShape.input_schema.properties.tag.type, 'string');

  const planned = aiRuntime.plannerOutputToPlan({
    registry,
    answer: JSON.stringify({
      intent: 'tag-current-note',
      mode: 'app_action',
      confidence: 'high',
      plan: [{ tool: 'tag-note', args: { tag: 'reading' }, reason: 'Apply requested tag' }],
    }),
  });
  assert.equal(planned.kind, 'plan');
  assert.equal(planned.plan.steps[0].actionId, 'tag-note');
  assert.equal(planned.plan.steps[0].args.tag, 'reading');

  const toolPlanned = aiRuntime.toolPlanResultToPlan({
    registry,
    result: {
      ok: true,
      native: true,
      toolCalls: [{ name: 'tag-note', args: { tag: 'todos' }, reason: 'Apply the requested tag' }],
    },
  });
  assert.equal(toolPlanned.kind, 'plan');
  assert.equal(toolPlanned.plan.source, 'provider-tools');
  assert.equal(toolPlanned.plan.steps[0].actionId, 'tag-note');
  assert.equal(toolPlanned.plan.steps[0].args.tag, 'todos');

  const rejected = aiRuntime.plannerOutputToPlan({
    registry,
    answer: JSON.stringify({
      intent: 'bad',
      mode: 'app_action',
      confidence: 'high',
      plan: [{ tool: 'shell', args: { cmd: 'rm -rf .' } }],
    }),
  });
  assert.equal(rejected.kind, 'invalid');
  assert.match(rejected.message, /Unknown app action/);
});

test('AI runtime builds local vault summaries without model calls', () => {
  const result = aiRuntime.buildFastVaultSummary([
    {
      id: 'n1',
      title: 'Project plan',
      tags: ['work', 'reading'],
      body: '# Goals\n- [ ] Finish the app AI runtime\nDecision: keep actions validated.',
      modifiedAt: '2026-05-12T01:00:00.000Z',
    },
    {
      id: 'n2',
      title: 'Book notes',
      tags: ['reading'],
      body: 'Useful note about retrieval and summaries.',
      modifiedAt: '2026-05-11T01:00:00.000Z',
    },
  ]);
  assert.equal(result.mode, 'local-vault-summary');
  assert.match(result.answer, /Notes reviewed: 2/);
  assert.match(result.answer, /\[\[Project plan\]\]/);
  assert.match(result.answer, /#reading \(2\)/);
  assert.match(result.answer, /Finish the app AI runtime/);
  assert.equal(result.sources.length, 2);
});

test('AI runtime builds contextual results with provider, sections, and sources', () => {
  const result = aiRuntime.makeContextualAiResult({
    config: { provider: 'openrouter', chatModel: 'openai/gpt-4o-mini', piiReduction: true },
    title: 'Current note suggestions',
    outputKind: 'note-suggestions',
    sources: [
      {
        id: 'n1',
        title: 'Project AI',
        body: '# Project AI\n- [ ] Follow up',
        modifiedAt: '2026-06-06T10:00:00.000Z',
      },
      {
        id: 'n1',
        title: 'Duplicate',
        body: 'Duplicate should not produce another source.',
      },
    ],
    sections: [
      { kind: 'fact', title: 'Summary', content: 'This note is about Project AI.', sourceIds: ['n1'] },
      { kind: 'suggestion', title: 'Tasks', content: 'Follow up on the open task.', sourceIds: ['n1'] },
      { kind: 'preview', title: 'Preview', content: '- [ ] Follow up on Project AI' },
    ],
    createdAt: '2026-06-06T10:30:00.000Z',
  });

  assert.equal(result.type, 'contextual-ai-result');
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'openai/gpt-4o-mini');
  assert.equal(result.providerModelLabel, 'OpenRouter - openai/gpt-4o-mini');
  assert.equal(result.hosted, true);
  assert.equal(result.piiReduction, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, 'n1');
  assert.equal(result.sources[0].title, 'Project AI');
  assert.deepEqual(result.sections.map(section => section.kind), ['fact', 'suggestion', 'preview']);
  assert.deepEqual(result.sections[0].sourceIds, ['n1']);
});

test('AI runtime builds current note suggestion prompts and sourced results', () => {
  const currentNote = {
    id: 'n1',
    title: 'Project AI',
    tags: ['work'],
    body: '# Project AI\n[[Launch Plan]]\n- [ ] Follow up with reviewers\nCheck whether the model contradicts the roadmap.',
    modifiedAt: '2026-06-06T10:00:00.000Z',
  };
  const linkedNote = {
    id: 'n2',
    title: 'Launch Plan',
    body: 'Launch Plan references rollout milestones.',
    modifiedAt: '2026-06-05T10:00:00.000Z',
  };
  const prompt = aiRuntime.buildCurrentNoteSuggestionPrompt({
    note: currentNote,
    allNotes: [currentNote, linkedNote],
  });

  assert.match(prompt, /Current note: Project AI/);
  assert.match(prompt, /Source ref: n1/);
  assert.match(prompt, /Summary, Tasks, Tags, Links, Gaps or contradictions/);
  assert.match(prompt, /Launch Plan \[n2\]/);
  assert.match(prompt, /Do not return an edited note body/);

  const result = aiRuntime.makeCurrentNoteSuggestionResult({
    note: currentNote,
    allNotes: [currentNote, linkedNote],
    status: { config: { provider: 'openai', chatModel: 'gpt-4o-mini', piiReduction: true } },
    aiText: [
      '## Summary',
      'Project AI needs reviewer follow-up. [n1]',
      '',
      '## Tasks',
      '- Follow up with reviewers. [n1]',
      '',
      '## Tags',
      '- #ai #roadmap [n1]',
      '',
      '## Links',
      '- Link the rollout milestone to [[Launch Plan]]. [n2]',
      '',
      '## Gaps or contradictions',
      '- Check the roadmap contradiction note. [n1]',
    ].join('\n'),
    createdAt: '2026-06-06T10:30:00.000Z',
  });

  assert.equal(result.outputKind, 'note-suggestions');
  assert.equal(result.title, 'Current note suggestions');
  assert.equal(result.providerModelLabel, 'OpenAI - gpt-4o-mini');
  assert.equal(result.hosted, true);
  assert.deepEqual(result.sources.map(source => source.id), ['n1', 'n2']);
  assert.deepEqual(result.sections.map(section => section.title), ['Summary', 'Tasks', 'Tags', 'Links', 'Gaps or contradictions']);
  assert.equal(result.sections[0].kind, 'fact');
  assert.equal(result.sections[1].kind, 'suggestion');
  assert.deepEqual(result.sections[0].sourceIds, ['n1', 'n2']);
  assert.match(result.sections[3].content, /Launch Plan/);
});
