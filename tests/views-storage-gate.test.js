const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('../lib/connectors/ipc/preferenceValidation.js');
const sanitize = gate.sanitizePrefsPatchFromIpc;

// The Views feature's storage gate. Saved view definitions travel from the
// renderer into prefs.json under the legacy `smartViews` key (the query
// engine and stored records kept the original vocabulary when the old Smart
// Views panel was retired) and are parsed at every boot. A definition that
// survives this gate must be one the query engine can run: real ids, known
// filter keys, sane dates and limits. Everything else is rejected at the
// door, not discovered at render.

const view = (over = {}) => ({ id: 'myView', title: 'My View', type: 'notes', ...over });
const save = (over = {}) => sanitize({ smartViews: [view(over)] }).smartViews[0];

test('a complete, valid view definition passes through intact', () => {
  const saved = save({
    filters: { tag: 'work', titleContains: 'plan' },
    sort: { field: 'modified', direction: 'desc' },
    limit: 25, layout: 'table', columns: ['status', 'due'],
    group: { by: 'status', direction: 'asc' },
  });
  assert.equal(saved.id, 'myView');
  assert.equal(saved.title, 'My View');
  assert.equal(saved.filters.tag, 'work');
  assert.deepEqual(saved.sort, { field: 'modified', direction: 'desc' });
  assert.equal(saved.limit, 25);
  assert.equal(saved.layout, 'table');
  assert.deepEqual(saved.columns, ['status', 'due']);
  assert.ok(saved.format, 'a stored view should carry its format version');
});

test('view ids must be usable and unique', () => {
  for (const id of ['', '1leading-digit', 'has space', '../escape']) {
    assert.throws(() => save({ id }), /Smart View id/, `id ${JSON.stringify(id)} was accepted`);
  }
  assert.throws(() => save({ id: 'x'.repeat(70) }), /too long/, 'an oversized id must be refused, not truncated');
  assert.throws(() => sanitize({ smartViews: [view(), view()] }), /Duplicate Smart View id/,
    'two views with the same id would overwrite each other');
});

test('a view without a title is refused rather than saved unnamed', () => {
  assert.throws(() => save({ title: '' }), /title is required/);
  assert.throws(() => save({ title: '   ' }), /title is required/);
});

test('unknown fields, types and layouts are rejected at the door', () => {
  assert.throws(() => save({ notAField: 1 }), /Unsupported Smart View field/);
  assert.throws(() => save({ type: 'spreadsheets' }), /Invalid Smart View type/);
  assert.throws(() => save({ layout: 'hologram' }), /Invalid Smart View layout/);
  assert.throws(() => save({ filters: { notAFilter: 'x' } }), /Unsupported Smart View filter field/);
  assert.throws(() => save({ sort: { field: 'colour' } }), /Invalid Smart View sort field/);
  assert.throws(() => save({ sort: { direction: 'sideways' } }), /Invalid Smart View sort direction/);
});

test('date filters must be real date keys', () => {
  assert.equal(save({ filters: { createdFrom: '2026-01-31' } }).filters.createdFrom, '2026-01-31');
  for (const bad of ['31/01/2026', 'yesterday', '2026-1-5', 'now()']) {
    assert.throws(() => save({ filters: { createdFrom: bad } }), /Invalid Smart View date filter/,
      `${bad} would silently match nothing at render time`);
  }
});

test('limits stay inside a range the query engine can serve', () => {
  assert.equal(save({ limit: 1 }).limit, 1);
  assert.equal(save({ limit: 500 }).limit, 500);
  for (const bad of [0, -5, 501, Infinity, NaN, 'lots']) {
    assert.throws(() => save({ limit: bad }), /Invalid Smart View limit/, `limit ${bad} was accepted`);
  }
  assert.equal(save({}).limit, undefined, 'an absent limit stays absent, not zero');
});

test('prototype pollution cannot ride in on a view or its filters', () => {
  // A literal __proto__ in test code sets the prototype instead of creating a
  // key; JSON.parse is how a hostile payload actually arrives over IPC.
  const attack = extra => sanitize({ smartViews: [JSON.parse(
    `{"id":"vx","title":"T","type":"notes",${extra}}`)] });
  assert.throws(() => attack('"__proto__":{"x":1}'), /Unsupported Smart View field/);
  assert.throws(() => attack('"filters":{"constructor":"x"}'), /Unsupported Smart View filter/);
  assert.throws(() => attack('"sort":{"__proto__":"x"}'), /Unsupported Smart View sort/);
  assert.throws(() => attack('"filters":{"properties":{"__proto__":{"x":1}}}'), /Unsupported/);
  assert.equal(({}).x, undefined, 'Object.prototype was polluted during the test');
});

test('nested filter values are depth- and size-capped', () => {
  // A crafted definition must not be able to make boot parsing expensive.
  let deep = 'leaf';
  for (let i = 0; i < 6; i++) deep = { nested: deep };
  assert.throws(() => save({ filters: { properties: deep } }), /too deeply nested/);
  assert.throws(() => save({ filters: { tags: Array.from({ length: 50 }, (_, i) => `t${i}`) } }),
    /too many items/);
  assert.throws(() => save({ filters: { properties: { value: Infinity } } }), /Invalid/,
    'a non-finite number would serialise to null and change the filter');
});

test('the whole collection is size-capped and must be an array', () => {
  const many = Array.from({ length: 25 }, (_, i) => view({ id: `view${i}` }));
  assert.throws(() => sanitize({ smartViews: many }), /Invalid Smart Views preference/);
  assert.throws(() => sanitize({ smartViews: 'not-an-array' }), /Invalid Smart Views preference/);
  assert.deepEqual(sanitize({ smartViews: [] }).smartViews, [], 'clearing all views must remain possible');
});
