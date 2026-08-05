const test = require('node:test');
const assert = require('node:assert/strict');

const appActions = require('../src/app/appActions.js');

// The App Action registry and the natural-language router in front of it.
// app-actions.test.js pins the schema gate and a handful of plans; this pins
// the rest: what a declared action defaults to, how arguments are coerced, and
// which phrasing maps to which command -- including the phrasings that must map
// to nothing at all rather than to the wrong action.

const ACTION_IDS = [
  'new-note', 'quick-capture', 'daily-note', 'ask-ai', 'settings', 'graph', 'calendar', 'today',
  'todos', 'canvas', 'vault-health', 'rebuild-index', 'ai-backfill', 'export-backup', 'import-backup',
  'duplicate-note', 'delete-note', 'archive-workflow-note', 'restore-trash-item', 'rename-note',
  'tag-note', 'untag-note', 'set-workflow-status', 'search-notes', 'add-todo-to-note',
  'add-reminder-to-note', 'link-note', 'append-to-note',
];

const label = id => id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const registry = (over = []) => appActions.createRegistry([
  ...ACTION_IDS.map(id => ({ id, label: label(id), run: () => ({}), inputSchema: { type: 'object', additionalProperties: true } })),
  ...over,
]);

const plan = (query, reg = registry()) => reg.findForText(query);

test('a declared action is filled out with defaults, and refuses to be nameless', () => {
  assert.throws(() => appActions.createRegistry([{ label: 'No id', run: () => ({}) }]), /missing an id/);
  assert.throws(() => appActions.createRegistry([{ id: '  ' , run: () => ({}) }]), /missing an id/);
  assert.throws(() => appActions.createRegistry([{ id: 'x' }]), /App action x is missing run\(\)/);

  const [action] = appActions.createRegistry([{ id: 'bare', run: () => ({}) }]).__actions;
  assert.equal(action.label, 'bare', 'an action with no label is named by its id');
  assert.equal(action.title, 'bare');
  assert.equal(action.section, 'Command');
  assert.equal(action.kind, 'write');
  assert.equal(action.risk, 'safe');
  assert.deepEqual(action.examples, []);
  assert.deepEqual(action.requires, []);
  assert.equal(action.resolveArgs, null);
  assert.equal(action.aiHidden, false);
  assert.deepEqual(action.inputSchema, { type: 'object', additionalProperties: false });
  assert.deepEqual(action.outputSchema, { type: 'object', additionalProperties: true });

  const [described] = appActions.createRegistry([{
    id: 'described', title: 'A Title', keywords: 'some keywords', risk: 'destructive', run: () => ({}),
    examples: ['a', '', 'b', ...Array.from({ length: 10 }, (_, i) => `x${i}`)],
    requires: ['note', ''],
  }]).__actions;
  assert.equal(described.label, 'A Title', 'a title stands in for a missing label');
  assert.equal(described.description, 'some keywords', 'keywords stand in for a missing description');
  assert.equal(described.kind, 'destructive', 'the kind follows from the risk when it is not stated');
  assert.equal(described.examples.length, 8, 'examples are capped and blanks dropped');
  assert.deepEqual(described.requires, ['note']);
  assert.equal(appActions.createRegistry([{ id: 'e', risk: 'external', run: () => ({}) }]).__actions[0].kind, 'external');

  assert.equal(appActions.normalizeRisk('confirm'), 'confirm');
  assert.equal(appActions.normalizeRisk('nonsense'), 'safe', 'an unknown risk is treated as the least dangerous');
  assert.equal(appActions.normalizeRisk(undefined), 'safe');
  assert.deepEqual(appActions.CONFIRM_RISKS, ['confirm', 'destructive', 'external']);
});

test('arguments are coerced to their declared type or rejected', () => {
  const check = (schema, args) => appActions.validateArgs(schema, args);
  const props = properties => ({ type: 'object', properties, additionalProperties: false });

  assert.deepEqual(check(props({ title: { type: 'string' } }), { title: '  padded  ' }), { title: 'padded' });
  assert.deepEqual(check(props({ title: { type: 'string', maxLength: 4 } }), { title: 'abcdefg' }), { title: 'abcd' });
  assert.deepEqual(check(props({ title: { type: 'string' } }), { title: null }), { title: '' });
  assert.deepEqual(check(props({ title: { type: 'string', default: 'D' } }), { title: undefined }), { title: 'D' });
  assert.throws(() => check(props({ title: { type: 'string' } }), { title: 42 }), /title must be a string/);
  assert.throws(() => check(props({ mode: { type: 'string', enum: ['a', 'b'] } }), { mode: 'c' }),
    /mode must be one of: a, b/);

  assert.deepEqual(check(props({ on: { type: 'boolean' } }), { on: 'yes' }), { on: true });
  assert.deepEqual(check(props({ on: { type: 'boolean' } }), { on: 0 }), { on: false });
  assert.deepEqual(check(props({ n: { type: 'number' } }), { n: '2.5' }), { n: 2.5 });
  assert.deepEqual(check(props({ n: { type: 'integer' } }), { n: '2.9' }), { n: 2 });
  assert.throws(() => check(props({ n: { type: 'number' } }), { n: 'lots' }), /n must be a number/);

  assert.deepEqual(check(props({ tags: { type: 'array', items: { type: 'string' } } }), { tags: [' a ', 'b'] }),
    { tags: ['a', 'b'] });
  assert.deepEqual(check(props({ tags: { type: 'array' } }), { tags: null }), { tags: [] });
  assert.throws(() => check(props({ tags: { type: 'array' } }), { tags: 'a,b' }), /tags must be an array/);

  assert.deepEqual(check(props({ opts: { type: 'object', properties: { a: { type: 'string' } } } }), { opts: { a: ' x ' } }),
    { opts: { a: 'x' } });
  assert.deepEqual(check(props({ opts: { type: 'object' } }), { opts: undefined }), { opts: {} });
  assert.deepEqual(check(props({ anything: {} }), { anything: { deep: 1 } }), { anything: { deep: 1 } },
    'a property with no declared type is passed through untouched');

  // Unknown keys are kept or refused depending on the schema.
  assert.deepEqual(check({ type: 'object', properties: {} }, { extra: 1 }), { extra: 1 });
  assert.throws(() => check(props({}), { extra: 1 }), /Unsupported action argument: extra/);

  // Required means present and non-empty, before and after coercion.
  const required = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
  assert.deepEqual(check(required, { title: 'x' }), { title: 'x' });
  assert.throws(() => check(required, {}), /Missing action argument: title/);
  assert.throws(() => check(required, { title: null }), /Missing action argument: title/);
  assert.throws(() => check(required, { title: '   ' }), /Missing action argument: title/,
    'a required argument that trims to nothing is missing');
  assert.throws(() => check(required, 'not an object'), /Action arguments must be an object/);
  assert.throws(() => check(required, ['array']), /Action arguments must be an object/);
  assert.deepEqual(check({}, { anything: 1 }), { anything: 1 }, 'an action with no schema takes what it is given');
});

test('an action result always names what it touched and how it went', async () => {
  const reg = appActions.createRegistry([
    { id: 'plain', label: 'Plain', run: () => ({}) },
    { id: 'rich', label: 'Rich', section: 'Notes', run: () => ({ id: 'n1', title: 'A note' }) },
    { id: 'listed', label: 'Listed', run: () => ({ affected: [{ type: 'note', id: 'n1' }, { type: 'note', id: 'n2' }] }) },
    { id: 'failing', label: 'Failing', run: () => ({ ok: false }) },
    { id: 'nothing', label: 'Nothing', run: () => null },
    { id: 'off', label: 'Off', enabled: false, run: () => ({}) },
    { id: 'dynamic', label: 'Dynamic', enabled: () => false, run: () => ({}) },
  ]);
  assert.deepEqual(await reg.run('plain'), {
    ok: true, actionId: 'plain', title: 'Plain', message: 'Plain completed.',
    affected: [], requiresConfirmation: false, risk: 'safe', preview: null,
  });
  assert.deepEqual((await reg.run('rich')).affected, [{ type: 'Notes', id: 'n1', title: 'A note' }],
    'a result naming one thing becomes a one-item source list');
  assert.equal((await reg.run('listed')).affected.length, 2, 'an explicit list is used as given');
  assert.equal((await reg.run('failing')).message, 'Failing failed.');
  assert.equal((await reg.run('nothing')).ok, true, 'an action that returns nothing still succeeded');
  assert.equal((await reg.run('off')).message, 'Off is currently unavailable.');
  assert.equal((await reg.run('off')).ok, false);
  assert.equal((await reg.run('dynamic')).ok, false, 'an action can decide at call time that it is unavailable');
  await assert.rejects(reg.run('missing'), /Unknown app action: missing/);
  await assert.rejects(reg.preview('missing'), /Unknown app action: missing/);
  assert.throws(() => reg.validate('missing'), /Unknown app action: missing/);
});

test('a risky action previews first and only runs once confirmed', async () => {
  const OPEN = { type: 'object', additionalProperties: true };
  let ran = 0;
  const reg = appActions.createRegistry([
    { id: 'wipe', label: 'Wipe', risk: 'destructive', description: 'Removes it all.', inputSchema: OPEN, run: () => { ran++; return {}; } },
    { id: 'custom', label: 'Custom', risk: 'confirm', inputSchema: OPEN, preview: args => ({ title: 'Custom preview', steps: [args.noteId] }), run: () => ({}) },
    { id: 'empty-preview', label: 'Empty', risk: 'confirm', preview: () => null, run: () => ({}) },
  ]);
  const first = await reg.run('wipe', { noteId: 'n1', title: 'A note' });
  assert.equal(first.requiresConfirmation, true);
  assert.equal(ran, 0, 'nothing happens until the user says so');
  assert.equal(first.message, 'Wipe needs confirmation before it runs.');
  assert.equal(first.preview.title, 'Wipe');
  assert.equal(first.preview.message, 'Removes it all.');
  assert.deepEqual(first.preview.affected, [{ type: 'note', id: 'n1', title: 'A note' }]);

  const confirmed = await reg.run('wipe', { noteId: 'n1' }, { confirmed: true });
  assert.equal(confirmed.requiresConfirmation, false);
  assert.equal(ran, 1);

  assert.equal((await reg.preview('custom', { noteId: 'n1' })).title, 'Custom preview');
  assert.equal((await reg.preview('empty-preview')).title, 'Empty',
    'a preview that returns nothing falls back to the default one');

  const defaults = await reg.preview('wipe', { canvasId: 'c1', vaultId: 'v1' });
  assert.deepEqual(defaults.affected.map(a => a.type), ['canvas', 'vault']);
  assert.deepEqual((await reg.preview('wipe', {})).affected, []);
  assert.equal((await reg.preview('empty-preview')).message, 'Empty is ready to run.',
    'an action with no description explains itself from its label');
});

test('an action can resolve its own arguments before it runs', async () => {
  const seen = [];
  const reg = appActions.createRegistry([{
    id: 'resolving',
    label: 'Resolving',
    inputSchema: { type: 'object', properties: { noteTitle: { type: 'string' }, noteId: { type: 'string' } }, additionalProperties: false },
    resolveArgs: (args, context) => { seen.push(context); return { ...args, noteId: `id-for-${args.noteTitle}` }; },
    run: args => ({ message: args.noteId }),
  }]);
  assert.equal((await reg.run('resolving', { noteTitle: 'Plan' })).message, 'id-for-Plan');
  assert.equal(seen[0].preview, undefined, 'running is not previewing');
  await reg.preview('resolving', { noteTitle: 'Plan' });
  assert.equal(seen.at(-1).preview, true, 'the resolver is told when it is only being previewed');

  const nullResolver = appActions.createRegistry([{
    id: 'null-resolve', label: 'N', resolveArgs: () => null, run: args => ({ message: JSON.stringify(args) }),
  }]);
  assert.equal((await nullResolver.run('null-resolve')).message, '{}',
    'a resolver that returns nothing leaves the arguments alone');
});

test('the action list hides what it should and describes the rest to the AI', () => {
  const reg = appActions.createRegistry([
    { id: 'visible', label: 'Visible', description: 'Does a thing.', run: () => ({}) },
    { id: 'hidden', label: 'Hidden', hidden: true, run: () => ({}) },
    { id: 'ai-hidden', label: 'Not for AI', aiHidden: true, run: () => ({}) },
    { id: 'note-n1', label: 'Open a note', run: () => ({}) },
    { id: 'vault-v1', label: 'Open a vault', run: () => ({}) },
    { id: 'canvas-c1', label: 'Open a canvas', run: () => ({}) },
    { id: 'disabled', label: 'Disabled', enabled: false, run: () => ({}) },
    { id: 'risky', label: 'Risky', risk: 'destructive', idempotent: true, readOnly: false, run: () => ({}) },
  ]);
  assert.deepEqual(reg.list().map(a => a.id).sort(),
    ['ai-hidden', 'canvas-c1', 'disabled', 'note-n1', 'risky', 'vault-v1', 'visible'],
    'a hidden action is not offered in the palette');
  assert.equal(reg.list({ includeHidden: true }).length, 8);
  assert.equal(reg.list().find(a => a.id === 'disabled').enabled, false);
  assert.equal(reg.list().find(a => a.id === 'visible').shortcut, '');

  const described = reg.describeForAi();
  assert.deepEqual(described.map(a => a.name).sort(), ['hidden', 'risky', 'visible'],
    'dynamic per-note commands and anything marked aiHidden or disabled are never described to a model');
  const risky = described.find(a => a.name === 'risky');
  assert.equal(risky.destructive, true);
  assert.equal(risky.confirm, false);
  assert.equal(risky.external, false);
  assert.equal(risky.idempotent, true, 'an action that says it is safe to repeat is described that way');
  assert.equal(risky.readOnly, false);
  assert.equal(described.find(a => a.name === 'visible').idempotent, false,
    'and one that says nothing is described as neither');
  assert.equal(described.find(a => a.name === 'visible').description, 'Visible. Does a thing.');
  assert.ok(described[0].input_schema && described[0].inputSchema, 'both spellings are provided for the model');
});

test('creating a note is recognised however it is phrased, and titled from the phrase', () => {
  const titleOf = query => plan(query)?.steps[0]?.args?.title;
  assert.equal(plan('create a note')?.intent, 'new-note');
  assert.equal(plan('make a new page')?.intent, 'new-note');
  assert.equal(plan('new note')?.intent, 'new-note');
  assert.equal(plan('create a new one')?.intent, 'new-note');

  assert.equal(titleOf('create a note called Weekly Review'), 'Weekly Review');
  assert.equal(titleOf('make a note named Weekly Review'), 'Weekly Review');
  assert.equal(titleOf('new note titled Weekly Review'), 'Weekly Review');
  assert.equal(titleOf('create a note about the budget'), 'the budget');
  assert.equal(titleOf('create a note "Weekly Review"'), 'Weekly Review', 'a quoted title wins');
  assert.equal(plan('create a note called Weekly Review and tag it work'), null,
    'creating and tagging in one breath is a script the router will not guess at');
  assert.equal(titleOf('create a note'), undefined, 'with no title given, none is invented');

  assert.equal(plan('summarise all my notes and create a note'), null,
    'a summary request that mentions creating a note is not a create-note command');
});

test('search, todo, reminder, link and append phrasings each route to their action', () => {
  const args = query => plan(query)?.steps[0]?.args;
  assert.equal(plan('search my notes for budget')?.intent, 'search-notes');
  assert.deepEqual(args('search my notes for budget'), { query: 'budget', limit: 8 });
  assert.deepEqual(args('find notes about the roadmap'), { query: 'the roadmap', limit: 8 });
  assert.deepEqual(args('find budget in my notes'), { query: 'budget', limit: 8 });

  assert.equal(plan('add a todo to this note to call the plumber')?.intent, 'add-todo-to-note');
  assert.equal(args('add a todo to this note to call the plumber').text, 'call the plumber');
  assert.equal(args('put call the plumber as a task in this note').text, 'call the plumber');

  assert.equal(plan('remind me to call the plumber')?.intent, 'add-reminder-to-note');
  assert.equal(args('remind me to call the plumber').text, 'call the plumber');
  assert.equal(args('add a reminder to this note to call back').text, 'call back');

  assert.equal(plan('link this note to Alpha Spec')?.intent, 'link-note');
  assert.equal(args('link this note to Alpha Spec').targetTitle, 'Alpha Spec');
  assert.equal(args('connect this page with Alpha Spec').targetTitle, 'Alpha Spec');
  assert.equal(args('add a wiki link to Alpha Spec').targetTitle, 'Alpha Spec');
  assert.equal(args('link to "Alpha Spec"').targetTitle, 'Alpha Spec');
  assert.notEqual(plan('a note that mentions Alpha Spec')?.intent, 'link-note',
    'a sentence that merely names a note is not a request to link to it');

  assert.equal(plan('append some text to this note')?.intent, 'append-to-note');
  assert.equal(args('append some text to this note').content, 'some text');
  assert.equal(args('append to this note some text').content, 'some text');
});

test('tagging and status changes name the note when the phrase does', () => {
  const step = query => plan(query)?.steps[0];
  assert.equal(step('tag this note as work')?.actionId, 'tag-note');
  assert.deepEqual(step('tag this note as work').args, { tag: 'work' });
  assert.deepEqual(step('tag the Weekly Review as work').args, { noteTitle: 'Weekly Review', tag: 'work' });
  assert.deepEqual(step('add the work tag').args, { tag: 'work' });
  assert.deepEqual(step('tag it #work').args, { tag: 'work' }, 'a hash tag is read directly');
  // "untag" is only recognised when the tag itself is written as a #hash --
  // the prose patterns match "tag", and \btag\b does not fire inside "untag".
  assert.equal(step('untag it #work')?.actionId, 'untag-note');
  assert.deepEqual(step('untag it #work').args, { tag: 'work' });

  assert.equal(step('set the status to doing')?.actionId, 'set-workflow-status');
  assert.deepEqual(step('set the status to doing').args, { status: 'doing' });
  assert.deepEqual(step('set the status of Weekly Review to doing').args, { noteTitle: 'Weekly Review', status: 'doing' });
  assert.deepEqual(step('move Weekly Review to done').args, { noteTitle: 'Weekly Review', status: 'done' });
  assert.deepEqual(step('mark this as done').args, { status: 'done' });
  assert.deepEqual(step('mark the Weekly Review as done').args, { noteTitle: 'Weekly Review', status: 'done' });

  // A named note with two instructions becomes one compound plan.
  const compound = plan('set the status of Weekly Review to doing and tag it #work');
  assert.equal(compound.intent, 'update-note');
  assert.equal(compound.title, 'Update note');
  assert.deepEqual(compound.steps.map(s => s.actionId), ['set-workflow-status', 'tag-note']);
  assert.deepEqual(compound.steps[1].args, { noteTitle: 'Weekly Review', tag: 'work' });
});

test('the router refuses to guess at a chain of unrelated commands', () => {
  assert.equal(plan('create a note and then export a backup'), null,
    'two different app verbs joined by "and then" is a script, not a command');
  assert.equal(plan('create a note then rebuild the index'), null);
  assert.equal(plan(''), null);
  assert.equal(plan('   '), null);
  assert.equal(plan(null), null);
});

test('single-word commands open the surface they name', () => {
  const cases = {
    'quick capture': 'quick-capture',
    "open today's note": 'daily-note',
    'ask ai': 'ask-ai',
    'open settings': 'settings',
    'show the graph': 'graph',
    'open the calendar': 'calendar',
    'todos': 'todos',
    'open the canvas': 'canvas',
    'vault health': 'vault-health',
    'rebuild the index': 'rebuild-index',
    'backfill the ai index': 'ai-backfill',
    'export a backup': 'export-backup',
    'import a backup': 'import-backup',
    'duplicate this note': 'duplicate-note',
    'delete this note': 'delete-note',
    'archive this workflow note': 'archive-workflow-note',
    'restore from trash': 'restore-trash-item',
  };
  for (const [query, intent] of Object.entries(cases)) {
    assert.equal(plan(query)?.intent, intent, `"${query}" should open ${intent}`);
  }
  assert.deepEqual(plan('archive this workflow note').steps[0].args, { archived: true });

  // An action that is not registered simply does not match.
  const partial = appActions.createRegistry([{ id: 'settings', label: 'Settings', run: () => ({}) }]);
  assert.equal(partial.findForText('rebuild the index'), null);
  const disabled = appActions.createRegistry([
    { id: 'graph', label: 'Graph', enabled: false, run: () => ({}) },
  ]);
  assert.equal(disabled.findForText('show the graph'), null, 'a disabled action is never planned');
});

test('renaming needs a new name, and opening a note matches the note commands', () => {
  assert.notEqual(plan('rename this note')?.confidence, 'high',
    'a rename with no new name is at best a guess, never a confident plan');
  assert.deepEqual(plan('rename this note').steps[0].args, {}, 'and it carries no title to rename to');
  assert.deepEqual(plan('rename this note to Weekly Review').steps[0].args, { title: 'Weekly Review' });
  assert.deepEqual(plan('rename it as "Weekly Review"').steps[0].args, { title: 'Weekly Review' });

  const withNotes = registry([
    { id: 'note-n1', label: 'Weekly Review', section: 'Notes', run: () => ({}) },
    { id: 'note-n2', label: 'Budget', section: 'Notes', run: () => ({}) },
  ]);
  const opened = withNotes.findForText('open the note Weekly Review');
  assert.equal(opened.intent, 'open-note');
  assert.equal(opened.steps[0].actionId, 'note-n1');
  assert.equal(withNotes.findForText('open the note Nothing Like This')?.intent !== 'open-note', true,
    'a name that matches no note does not open one at random');
});

test('anything left over falls back to the best-scoring command, with low confidence', () => {
  const reg = appActions.createRegistry([
    { id: 'export-backup', label: 'Export backup', description: 'Write a zip', keywords: 'archive zip', run: () => ({}) },
    { id: 'hidden-one', label: 'Export backup too', hidden: true, run: () => ({}) },
  ]);
  const fallback = reg.findForText('zip');
  assert.equal(fallback.intent, 'export-backup');
  assert.equal(fallback.confidence, 'low', 'a keyword guess is marked as a guess');
  assert.equal(fallback.source, 'direct-router');
  assert.equal(fallback.type, 'app-action-plan');
  assert.equal(fallback.requiresConfirmation, false);
  assert.equal(reg.findForText('completely unrelated words'), null);
  assert.equal(reg.findForText('!!!'), null, 'a query with no usable terms matches nothing');
});

test('a tag name is normalised out of whatever the user typed', () => {
  assert.equal(appActions.extractTagName('tag this as Work Item'), 'work-item');
  assert.equal(appActions.extractTagName('tag it #work'), 'work');
  assert.equal(appActions.extractTagName('tag this as work and then open settings'), 'work',
    'the tag stops where the next instruction begins');
  assert.equal(appActions.extractTagName('tag this as work.'), 'work');
  assert.equal(appActions.extractTagName('put it under the work tag'), 'work-tag');
  assert.equal(appActions.extractTagName('nothing to tag here'), '');
  assert.equal(appActions.extractTagName(''), '');
  assert.equal(appActions.extractTagName('tag it as ' + 'x'.repeat(60)).length, 48, 'a tag is length-capped');
});

test('a plan is a plain, complete object whatever it is built from', () => {
  const built = appActions.makePlan({ steps: [{ actionId: 'a', label: 'A step' }] });
  assert.equal(built.type, 'app-action-plan');
  assert.equal(built.intent, 'app-action');
  assert.equal(built.confidence, 'high');
  assert.equal(built.title, 'A step', 'a plan with no title is named by its first step');
  assert.equal(built.message, '');
  assert.equal(appActions.makePlan().title, 'App action');
  assert.deepEqual(appActions.makePlan().steps, []);
});
