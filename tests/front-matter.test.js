const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFrontMatter, serializeFrontMatter } = require('../lib/storage/frontMatter.js');

function roundTripTags(tags) {
  const text = serializeFrontMatter({ id: 'n1', title: 'Note', tags, pinned: false }, 'body');
  return parseFrontMatter(text).meta.tags;
}

test('an apostrophe inside a tag does not swallow the rest of the list', () => {
  // A bare `'` used to open a quoted item, so every comma after it was read as
  // part of the same value and the remaining tags disappeared into one entry.
  assert.deepEqual(roundTripTags(["mom's", 'recipes']), ["mom's", 'recipes']);
  assert.deepEqual(roundTripTags(['a', "don't", 'b', "won't", 'c']), ['a', "don't", 'b', "won't", 'c']);
});

test('front matter lists survive a save and reload unchanged', () => {
  for (const tags of [
    ['plain', 'two words'],
    ["it's a, test", 'x'],
    ["'quoted'", 'x'],
    ['a"b', 'x'],
    ['a: b', 'c'],
    [' padded ', 'x'],
    ['#hash', 'x'],
    ['true', '12'],
    ['- item', '*alias', '@user', '{brace}'],
    ['1e3', '.nan', '.inf', '2026-08-01'],
    ['[weird]', 'x'],
    [],
  ]) {
    assert.deepEqual(roundTripTags(tags), tags, `tags ${JSON.stringify(tags)} must round-trip`);
  }
});

test('quoted list items still parse as one value', () => {
  assert.deepEqual(parseFrontMatter('---\ntags: ["a, b", c]\n---\nbody\n').meta.tags, ['a, b', 'c']);
  assert.deepEqual(parseFrontMatter("---\ntags: ['a, b', c]\n---\nbody\n").meta.tags, ['a, b', 'c']);
  assert.deepEqual(
    parseFrontMatter("---\ntags: ['mom''s, recipes', c]\n---\nbody\n").meta.tags,
    ["mom's, recipes", 'c']
  );
  assert.deepEqual(
    parseFrontMatter('---\ntags: ["a,b\\\\", c]\n---\nbody\n').meta.tags,
    ['a,b\\', 'c']
  );
});

test('inline comments stay outside bare apostrophes and saved flow lists', () => {
  assert.equal(
    parseFrontMatter("---\ntitle: mom's note # visible comment\n---\nbody\n").meta.title,
    "mom's note"
  );
  assert.deepEqual(
    parseFrontMatter("---\ntags: [mom's, recipes] # family\n---\nbody\n").meta.tags,
    ["mom's", 'recipes']
  );

  const saved = serializeFrontMatter(
    { id: 'n1', title: "Mom's note", tags: ["mom's", 'recipes'], pinned: false },
    'body',
    'id: n1\ntitle: Before # title comment\ntags: [old] # family\npinned: false'
  );
  assert.match(saved, /title: "Mom's note" # title comment/);
  assert.match(saved, /tags: \["mom's", recipes\] # family/);
  assert.deepEqual(parseFrontMatter(saved).meta.tags, ["mom's", 'recipes']);
});

test('serialized strings stay unambiguous to standard YAML readers', () => {
  const unsafe = ['a: b', '- item', '*alias', '@user', '{brace}', '1e3', '.nan', '.inf', '2026-08-01'];
  const text = serializeFrontMatter({ id: 'n1', title: unsafe[0], tags: unsafe, pinned: false }, 'body');
  for (const value of unsafe) {
    assert.ok(text.includes(JSON.stringify(value)), `${JSON.stringify(value)} must be emitted as a string`);
  }
  assert.deepEqual(parseFrontMatter(text).meta.tags, unsafe);
});

test('front matter keys cannot mutate the metadata object prototype', () => {
  const meta = parseFrontMatter('---\n__proto__: [x, y]\ntitle: Safe\n---\nbody\n').meta;
  assert.equal(Object.getPrototypeOf(meta), null);
  assert.deepEqual(meta.__proto__, ['x', 'y']);
  assert.equal(meta.title, 'Safe');
});

test('Unicode line separators remain inside their metadata value', () => {
  for (const separator of ['\u0085', '\u2028', '\u2029']) {
    const value = `before${separator}after`;
    const text = serializeFrontMatter({ id: 'n1', title: value, tags: [value] }, 'body');
    assert.ok(text.includes(`before\\u${separator.codePointAt(0).toString(16).padStart(4, '0')}after`));
    const parsed = parseFrontMatter(text);
    assert.equal(parsed.meta.title, value);
    assert.deepEqual(parsed.meta.tags, [value]);
  }
});
