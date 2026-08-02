const test = require('node:test');
const assert = require('node:assert/strict');

const { createMetadataModels } = require('../lib/storage/metadataModels.js');
const { createNovelistHelpers } = require('../src/features/writer/novelistHelpers.js');

// The renderer holds tags in memory; the main process writes them to disk. If the
// two disagree about a name, a tag stops matching itself across a reload -- and
// stops matching the same #tag written inline in a note body, since the editor
// maps that token to the bare name.
const storage = createMetadataModels({
  cleanString: value => String(value || ''),
  isPlainObject: value => !!value && typeof value === 'object',
  validateNoteId: value => value,
});
const renderer = createNovelistHelpers({});

const CASES = [
  '#urgent', '##deep', '#Deep Work', '  #a b  ', '#', '###',
  'urgent', 'Deep Work', '  spaced  ', '', 'C++', '_private', '日本語', 'a#b',
  // Storage truncates to 64 characters; the renderer must not keep a longer
  // name in memory than the one that reaches disk.
  'x'.repeat(80), `#${'y'.repeat(80)}`, `${'a b '.repeat(30)}`,
];

test('renderer and storage agree on every tag name', () => {
  const disagreements = CASES
    .map(input => ({ input, renderer: renderer.normalizeTagName(input), storage: storage.normalizeTagName(input) }))
    .filter(row => row.renderer !== row.storage);
  assert.deepEqual(disagreements, [],
    `these inputs normalise differently in the renderer than on disk:\n${
      disagreements.map(r => `  ${JSON.stringify(r.input)}: renderer=${JSON.stringify(r.renderer)} storage=${JSON.stringify(r.storage)}`).join('\n')}`);
});

test('a leading hash is a display sigil, not part of the tag name', () => {
  // Tags are stored bare everywhere; '#' only marks them in markdown.
  assert.equal(renderer.normalizeTagName('#urgent'), 'urgent');
  assert.equal(renderer.normalizeTagName('#Deep Work'), 'deep-work');
  // A hash in the middle is part of the name and must survive.
  assert.equal(renderer.normalizeTagName('a#b'), storage.normalizeTagName('a#b'));
});
