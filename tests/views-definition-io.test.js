const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// Reading and writing a saved view. views-storage-gate.test.js pins the IPC
// gate that guards prefs.json; this pins the renderer-side validator, the
// YAML/JSON round trip and the {{smart-view}} embed parser -- the path a view
// takes when it is typed into a note rather than saved from the panel.

const valid = (over = {}) => ({ id: 'myView', title: 'My View', type: 'notes', ...over });
const validate = over => helpers.smartViewValidateSavedDefinition(valid(over));

test('a validated definition comes back normalised and stamped with its format', () => {
  const saved = validate({
    filters: { tag: 'Work', titleContains: '  plan  ' },
    sort: { field: 'title', direction: 'asc' },
    limit: 25,
    layout: 'table',
    group: { by: 'status', direction: 'desc' },
    columns: ['due', 'due', 'status'],
  });
  assert.equal(saved.format, helpers.SMART_VIEW_FORMAT);
  assert.equal(saved.filters.titleContains, 'plan', 'a filter value is trimmed on the way in');
  assert.deepEqual(saved.filters.tags, ['work'], 'the singular `tag` folds into the plural list');
  assert.deepEqual(saved.sort, { field: 'title', direction: 'asc' });
  assert.equal(saved.limit, 25);
  assert.deepEqual(saved.group, { by: 'status', direction: 'desc' });
  assert.deepEqual(saved.columns, ['due', 'status'], 'a repeated column is listed once');
});

test('a definition that is not an object is refused outright', () => {
  for (const bad of [null, 'a string', 42, ['array']]) {
    assert.throws(() => helpers.smartViewValidateSavedDefinition(bad),
      /must be an object/, `${JSON.stringify(bad)} was accepted as a definition`);
  }
  assert.throws(() => helpers.smartViewValidateSavedDefinition(), /Invalid Smart View id/,
    'nothing at all reads as an empty view, which then fails for having no id');
});

test('only known top-level keys are accepted', () => {
  assert.throws(() => validate({ colour: 'red' }), /unsupported key: colour/);
  assert.throws(() => validate({ format: 'vispnote.smartView.v99' }), /Unsupported Smart View format/);
  // Every format we have ever written still opens.
  for (const format of helpers.SMART_VIEW_FORMATS) {
    assert.equal(validate({ format }).format, helpers.SMART_VIEW_FORMAT,
      'an older format is accepted on read and rewritten as the current one');
  }
});

test('ids and titles must be usable', () => {
  for (const id of ['', 'x', '1abc', 'has space', '../escape', 'x'.repeat(65)]) {
    assert.throws(() => validate({ id }), /Invalid Smart View id/, `id ${JSON.stringify(id)} was accepted`);
  }
  assert.equal(validate({ id: 'a-b_C9' }).id, 'a-b_C9');
  assert.throws(() => validate({ title: '   ' }), /title is required/);
});

test('type, layout, group and columns are each checked', () => {
  assert.throws(() => validate({ type: 'spreadsheets' }), /Invalid Smart View type/);
  assert.equal(validate({ type: undefined }).type, 'notes', 'no type means a notes view');
  for (const layout of helpers.SMART_VIEW_LAYOUTS) {
    assert.equal(validate({ layout }).layout, layout);
  }
  assert.throws(() => validate({ layout: 'hologram' }), /Invalid Smart View layout/);
  assert.equal(validate({ layout: null }).layout, 'list', 'an absent layout means list');

  assert.throws(() => validate({ group: 'status' }), /group must be an object/);
  assert.throws(() => validate({ group: { by: 'status', order: 'asc' } }), /Smart View group contains unsupported key: order/);
  assert.throws(() => validate({ group: { direction: 'asc' } }), /group needs a by key/);
  assert.equal(validate({ group: null }).group, null);

  assert.throws(() => validate({ columns: 'status' }), /columns must be an array/);
  assert.equal(validate({ columns: [] }).columns, null, 'an empty column list means "no pinned columns"');
  assert.equal(validate({ columns: null }).columns, null);
});

test('filters must be an object of known keys with real values', () => {
  assert.throws(() => validate({ filters: 'tag:work' }), /filters must be an object/);
  assert.throws(() => validate({ filters: ['work'] }), /filters must be an object/);
  assert.throws(() => validate({ filters: { notAFilter: 1 } }), /filters contains unsupported key: notAFilter/);
  assert.deepEqual(validate({ filters: null }).filters.tags, [], 'no filters is the same as empty filters');

  for (const key of ['createdFrom', 'modifiedBefore', 'reminderTo', 'dueFrom', 'remindFrom']) {
    assert.throws(() => validate({ filters: { [key]: 'last tuesday' } }),
      new RegExp(`Invalid Smart View date filter: ${key}`));
    assert.doesNotThrow(() => validate({ filters: { [key]: '2026-02-28' } }));
    assert.doesNotThrow(() => validate({ filters: { [key]: '' } }), 'an empty date filter is simply unset');
    assert.doesNotThrow(() => validate({ filters: { [key]: null } }));
  }
  assert.throws(() => validate({ filters: { createdFrom: '2026-02-30' } }), /Invalid Smart View date filter/,
    'a date that does not exist is not a date');

  assert.throws(() => validate({ filters: { actionStatuses: ['open', 'exploded'] } }), /Invalid Smart View action status/);
  assert.throws(() => validate({ filters: { taskStatus: 'pending' } }), /Invalid Smart View action status/);
  assert.throws(() => validate({ filters: { actionType: 'errand' } }), /Invalid Smart View action type/);
  assert.doesNotThrow(() => validate({ filters: { actionStatuses: 'open, done', actionTypes: 'tasks' } }),
    'a comma-separated list is a legal way to write a list');
});

test('sort and limit are checked before a view can be saved', () => {
  assert.throws(() => validate({ sort: 'title' }), /sort must be an object/);
  assert.throws(() => validate({ sort: { field: 'title', asc: true } }), /Smart View sort contains unsupported key: asc/);
  assert.throws(() => validate({ sort: { field: 'colour' } }), /Invalid Smart View sort field/);
  assert.throws(() => validate({ sort: { direction: 'sideways' } }), /Invalid Smart View sort direction/);
  assert.deepEqual(validate({ sort: null }).sort, { field: 'modified', direction: 'desc' });

  for (const bad of [0, -1, 501, 'lots', Infinity, NaN]) {
    assert.throws(() => validate({ limit: bad }), /Invalid Smart View limit/, `limit ${bad} was accepted`);
  }
  assert.equal(validate({ limit: null }).limit, 100, 'no limit means the default of 100');
  assert.equal(validate({ limit: '25' }).limit, 25, 'a numeric string is a number');
  assert.equal(validate({ limit: 25.7 }).limit, 25, 'a fractional limit is floored, not rejected');
});

test('a definition round-trips through JSON and through YAML', () => {
  const definition = valid({
    filters: { tags: ['work', 'urgent'], titleContains: 'plan', createdFrom: '2026-01-01' },
    sort: { field: 'created', direction: 'asc' },
    limit: 12, layout: 'cards', columns: ['status'], group: { by: 'status', direction: 'desc' },
  });
  const json = helpers.smartViewSerializeDefinition(definition);
  assert.deepEqual(helpers.smartViewParseDefinitionText(json, 'view.json'),
    helpers.smartViewValidateSavedDefinition(definition), 'JSON is the default format');

  const yaml = helpers.smartViewSerializeDefinition(definition, 'yaml');
  assert.match(yaml, /^format: /m);
  assert.match(yaml, /^ {2}tags: \["work","urgent"\]$/m, 'a list is written as inline JSON, which YAML also reads');
  assert.deepEqual(helpers.smartViewParseDefinitionText(yaml, 'view.yaml'),
    helpers.smartViewValidateSavedDefinition(definition));
  assert.deepEqual(helpers.smartViewParseDefinitionText(yaml, 'view.yml'),
    helpers.smartViewValidateSavedDefinition(definition));
  // The option can be given as an object too.
  assert.equal(helpers.smartViewSerializeDefinition(definition, { format: 'yaml' }), yaml);
  // A view with no group and no columns simply omits those lines.
  const plain = helpers.smartViewSerializeDefinition(valid(), 'yaml');
  assert.ok(!plain.includes('group:'), 'an ungrouped view writes no group block');
  assert.ok(!plain.includes('columns:'));
});

test('text with no braces is read as YAML whatever the file is called', () => {
  const text = 'id: fromYaml\ntitle: From YAML\ntype: notes\n';
  assert.equal(helpers.smartViewParseDefinitionText(text, 'view.json').id, 'fromYaml',
    'the content decides, so a mislabelled file still opens');
  assert.equal(helpers.smartViewParseDefinitionText('{"id":"fromJson","title":"J"}', 'view.txt').id, 'fromJson');
});

test('malformed view text fails with a message, not a wrong view', () => {
  assert.throws(() => helpers.smartViewParseDefinitionText('{"id":', 'view.json'), SyntaxError);
  assert.throws(() => helpers.smartViewParseDefinitionText('filters:\n\ttag: work', 'view.yaml'), /cannot use tabs/);
  assert.throws(() => helpers.smartViewParseDefinitionText('id = x', 'view.yaml'), /Unsupported Smart View YAML line/);
  assert.throws(() => helpers.smartViewParseDefinitionText('id: myView\n  by: status', 'view.yaml'),
    /Unsupported Smart View YAML indentation/, 'an indented key under a scalar has no parent to belong to');
  assert.throws(() => helpers.smartViewParseDefinitionText('filters:\n tag: work', 'view.yaml'),
    /indentation/, 'a single space is not enough to nest under a key');
});

test('YAML comments, blank lines and quoted values are handled', () => {
  const text = [
    '# a saved view',
    '',
    'id: quoted',
    "title: 'It''s mine'",
    'type: notes',
    'filters:',
    '  titleContains: "plan: phase 2"',
    '  tags: ["work"]',
  ].join('\n');
  const parsed = helpers.smartViewParseDefinitionText(text, 'view.yaml');
  assert.equal(parsed.title, "It's mine", 'a doubled quote inside single quotes is one quote');
  assert.equal(parsed.filters.titleContains, 'plan: phase 2', 'a colon inside a quoted value is not a key');
  assert.deepEqual(parsed.filters.tags, ['work']);
});

test('an embed block is only recognised when it is one', () => {
  assert.equal(helpers.smartViewParseEmbedBlock(''), null);
  assert.equal(helpers.smartViewParseEmbedBlock('just text'), null);
  assert.equal(helpers.smartViewParseEmbedBlock('{{ other-marker }}'), null);
  const empty = helpers.smartViewParseEmbedBlock('{{ smart-view }}');
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'Missing Smart View definition.');
  assert.equal(empty.marker, 'smart-view');
});

test('an embed can name a saved view by id or by title', () => {
  const saved = [valid({ id: 'weekly', title: 'Weekly Review' })];
  const byId = helpers.smartViewParseEmbedBlock('{{ smart-view weekly }}', saved);
  assert.equal(byId.ok, true);
  assert.equal(byId.mode, 'saved');
  assert.equal(byId.definition.title, 'Weekly Review');
  const byTitle = helpers.smartViewParseEmbedBlock('{{ smart-view weekly review }}', saved);
  assert.equal(byTitle.ok, true, 'the title is matched case-insensitively');
  assert.equal(byTitle.id, 'weekly');

  const unknown = helpers.smartViewParseEmbedBlock('{{ smart-view nowhere }}', saved);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.mode, 'saved');
  assert.equal(unknown.error, 'Unknown saved Smart View: nowhere');

  assert.equal(helpers.smartViewParseEmbedBlock('{{ smart-view weekly }}', 'not an array').ok, false,
    'a broken saved-view list must not crash the note that embeds one');
  assert.equal(helpers.smartViewParseEmbedBlock('{{ smart-view weekly }}',
    [{ id: 'broken' }, valid({ id: 'weekly' })]).ok, true,
    'one unreadable saved view must not hide the readable ones');
});

test('an embed can carry its own definition inline', () => {
  const yaml = helpers.smartViewParseEmbedBlock('{{ smart-view id: inline\ntitle: Inline View\ntype: notes }}');
  assert.equal(yaml.ok, true);
  assert.equal(yaml.mode, 'inline');
  assert.equal(yaml.id, 'inline');

  const json = helpers.smartViewParseEmbedBlock('{{ smart-view {"id":"inlineJson","title":"J","type":"notes"} }}');
  assert.equal(json.ok, true);
  assert.equal(json.id, 'inlineJson');

  const broken = helpers.smartViewParseEmbedBlock('{{ smart-view {"id": }}');
  assert.equal(broken.ok, false);
  assert.equal(broken.mode, 'inline');
  assert.ok(broken.error, 'a broken inline view explains itself instead of rendering nothing');
});

test('saving a view replaces the one with the same id', () => {
  const first = helpers.smartViewUpsertSavedDefinition([], valid({ id: 'aa', title: 'First' }));
  assert.equal(first.length, 1);
  const second = helpers.smartViewUpsertSavedDefinition(first, valid({ id: 'bb', title: 'Second' }));
  assert.deepEqual(second.map(v => v.id), ['aa', 'bb'], 'a new id is appended');
  const edited = helpers.smartViewUpsertSavedDefinition(second, valid({ id: 'aa', title: 'Renamed' }));
  assert.deepEqual(edited.map(v => v.id), ['bb', 'aa'], 'an edited view replaces itself');
  assert.equal(edited.find(v => v.id === 'aa').title, 'Renamed');
  assert.deepEqual(helpers.smartViewUpsertSavedDefinition('not a list', valid({ id: 'aa' })).map(v => v.id), ['aa']);
  assert.throws(() => helpers.smartViewUpsertSavedDefinition([], { id: '' }), /Invalid Smart View id/,
    'an invalid view is refused before it can join the list');
});

test('normalising a definition tolerates whatever it is handed', () => {
  const empty = helpers.smartViewNormalizeDefinition();
  assert.equal(empty.title, 'Smart view', 'an untitled view still has a name to show');
  assert.equal(empty.type, 'notes');
  assert.equal(empty.limit, 100);
  assert.equal(empty.layout, 'list');
  assert.equal(empty.group, null);
  assert.equal(empty.columns, null);
  assert.deepEqual(helpers.smartViewNormalizeDefinition('nonsense'), empty);
  assert.deepEqual(helpers.smartViewNormalizeDefinition(null), empty);

  // `query` is the older name for `filters`.
  assert.deepEqual(helpers.smartViewNormalizeDefinition({ query: { tag: 'work' } }).filters.tags, ['work']);
  assert.equal(helpers.smartViewNormalizeDefinition({ limit: 9999 }).limit, 500, 'the limit is clamped, not rejected');
  assert.equal(helpers.smartViewNormalizeDefinition({ limit: 0 }).limit, 1);
  assert.equal(helpers.smartViewNormalizeDefinition({ limit: 'lots' }).limit, 100);
  assert.equal(helpers.smartViewNormalizeDefinition({ limit: '' }).limit, 100);
  assert.equal(helpers.smartViewNormalizeDefinition({ layout: '  TABLE  ' }).layout, 'table');
  assert.deepEqual(helpers.smartViewNormalizeDefinition({ group: { by: '  status  ' } }).group,
    { by: 'status', direction: 'asc' });
  assert.equal(helpers.smartViewNormalizeDefinition({ group: 'status' }).group, null);
  assert.equal(helpers.smartViewNormalizeDefinition({ columns: ['', '  '] }).columns, null);
});

test('property conditions can be written five different ways', () => {
  const props = source => helpers.smartViewNormalizeDefinition({ filters: source }).filters.properties;
  assert.deepEqual(props({ property: { key: 'status', value: 'draft' } }),
    [{ key: 'status', values: ['draft'], op: 'is' }]);
  assert.deepEqual(props({ property: { key: 'status', value: 'draft', op: 'NOT' } })[0].op, 'not',
    'an operator is matched case-insensitively');
  assert.deepEqual(props({ property: { key: 'status', value: 'draft', op: 'sideways' } })[0].op, 'is',
    'an unknown operator falls back to `is` rather than matching nothing');
  assert.deepEqual(props({ properties: [{ key: 'status', values: ['a', 'b'] }] })[0].values, ['a', 'b'],
    'a normalised condition carries `values`');
  assert.deepEqual(props({ properties: [{ key: 'status', value: 'a,b' }] })[0].values, ['a', 'b'],
    'a saved condition carries `value`, possibly comma-separated');
  assert.deepEqual(props({ properties: { status: 'draft' } }),
    [{ key: 'status', values: ['draft'], op: 'is' }], 'a plain map of key to value works too');
  assert.deepEqual(props({ propertyKey: 'status', propertyValue: 'draft' }),
    [{ key: 'status', values: ['draft'], op: 'is' }], 'the oldest single-property spelling still works');
  assert.deepEqual(props({ property: 'status' }), [], 'a property that is not an object is ignored');
  assert.deepEqual(props({ properties: [null, 'x', { key: '   ' }] }), [],
    'junk entries are dropped rather than becoming empty conditions');
  assert.deepEqual(props({ property: { key: 'status' } })[0].values, [],
    'a key with no value means "has this property at all"');
});
