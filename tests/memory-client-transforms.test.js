const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../lib/integrations/memory/client.js');
const t = client.__test;

// The pure transforms of the llm-memory client: the config guard that keeps
// the bridge on localhost, and the memory<->note mapping that imports memories
// as editable notes and recognises them on re-import. No network here; the
// request paths are covered by the IPC handler tests.

test('the server URL is normalised and locked to localhost', () => {
  const cfg = client.normalizeMemoryConfig({ serverUrl: 'http://127.0.0.1:8080/api/' });
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:8080/api', 'a trailing slash must be trimmed');
  assert.equal(client.normalizeMemoryConfig({}).baseUrl.length > 0, true, 'a default URL is provided');
  for (const url of ['http://evil.example.com:8080', 'http://192.168.1.5:8080', 'https://memory.cloud/api']) {
    assert.throws(() => client.normalizeMemoryConfig({ serverUrl: url }), /must run on localhost/,
      `${url} was accepted as a memory server`);
  }
  assert.throws(() => client.normalizeMemoryConfig({ serverUrl: 'ftp://127.0.0.1' }), /http\(s\)/);
  assert.throws(() => client.normalizeMemoryConfig({ serverUrl: 'not a url' }), /Invalid llm-memory server URL/);
});

test('secrets and repo ids are cleaned and length-capped', () => {
  const cfg = client.normalizeMemoryConfig({
    serverUrl: 'http://localhost:9000',
    repoId: '  my-repo\x00  ',
    apiKey: `${'k'.repeat(400)}`,
  });
  assert.equal(cfg.repoId, 'my-repo', 'control chars and surrounding space stripped');
  assert.equal(cfg.apiKey.length, 300, 'an over-long key is capped, not stored whole');
});

test('a memory maps to a note id that survives a round trip', () => {
  assert.equal(t.memoryNoteId('abc123'), 'mem_abc123');
  assert.equal(t.memoryNoteId('has spaces & symbols!'), 'mem_has_spaces_symbols_',
    'a run of unsafe characters collapses to a single underscore');
  assert.throws(() => t.memoryNoteId(''), /Invalid memory id/, 'an empty id is refused');
  assert.throws(() => t.memoryNoteId(null), /Invalid memory id/);
  // '!!!' cleans to '_', which is a legal note id -- ugly but not dangerous.
  assert.equal(t.memoryNoteId('!!!'), 'mem__');
});

test('the note title is the first meaningful line, with a fallback', () => {
  assert.equal(t.memoryNoteTitle({ content: '# A Heading\n\nbody' }), 'A Heading',
    'markdown decoration is stripped from the title');
  assert.equal(t.memoryNoteTitle({ content: '\n\n> quoted first line' }), 'quoted first line');
  assert.match(t.memoryNoteTitle({ id: 'abcdef123456', content: '' }), /^Memory abcdef12$/,
    'a contentless memory still gets a stable title');
  assert.equal(t.memoryNoteTitle({ content: 'x'.repeat(200) }).length, 80, 'the title is capped');
});

test('an imported memory becomes an editable note carrying its provenance', () => {
  const note = t.memoryToNote({
    id: 'm1', content: 'The actual memory text.', layer: 'semantic',
    category: 'note', createdAt: '2026-05-01T12:00:00.000Z', tags: ['Work', 'AI Stuff'],
  });
  assert.equal(note.id, 'mem_m1');
  assert.match(note.body, /source:: llm-memory/);
  assert.match(note.body, /memoryId:: m1/, 'the note must remember which memory it came from');
  assert.match(note.body, /memoryCreated:: 2026-05-01/, 'only the date, not the full timestamp');
  assert.match(note.body, /The actual memory text\./, 'the memory content is the editable body');
  assert.ok(note.tags.includes('memory'), 'imported notes are tagged memory');
  assert.ok(note.tags.includes('work') && note.tags.includes('ai-stuff'),
    'tags are lowercased and slugified so they behave like every other tag');
  assert.equal(new Set(note.tags).size, note.tags.length, 'tags are deduped');
});

test('a memory with no content or no id is not importable', () => {
  // importMemoriesToVault skips these; memoryToNote must not manufacture a note.
  assert.throws(() => t.memoryToNote({ id: '', content: 'x', tags: [] }), /Invalid memory id/);
});

test('publicMemory keeps only the known fields and a safe metadata object', () => {
  const pub = t.publicMemory({
    id: 5, content: 'hi', importance: '3', tags: ['a', 2], similarity: '0.7',
    metadata: { vispnote_note_id: 'n1' }, secret_internal: 'should not appear',
  });
  assert.equal(pub.id, '5', 'ids are stringified');
  assert.equal(pub.importance, 3, 'importance is a number');
  assert.deepEqual(pub.tags, ['a', '2'], 'tag entries are stringified');
  assert.equal(pub.similarity, 0.7);
  assert.equal(pub.metadata.vispnote_note_id, 'n1', 'provenance survives');
  assert.equal(pub.secret_internal, undefined, 'unknown fields are dropped');
  // A non-object metadata must not crash downstream provenance reads.
  assert.deepEqual(t.publicMemory({ metadata: 'nope' }).metadata, {});
  assert.deepEqual(t.publicMemory({ metadata: ['array'] }).metadata, {});
});

test('graph limits are clamped to what the server accepts', () => {
  assert.equal(t.clampInt(9999, 1, 50, 12), 50, 'above the ceiling clamps down');
  assert.equal(t.clampInt(0, 1, 50, 12), 1, 'below the floor clamps up');
  assert.equal(t.clampInt('lots', 1, 50, 12), 12, 'garbage takes the fallback');
  assert.equal(t.clampInt(3.9, 1, 50, 12), 3, 'fractions truncate');
});

test('relationship types normalise to a safe default', () => {
  assert.equal(t.normalizeRelationshipType('mentions'), 'MENTIONS', 'known types uppercase');
  assert.equal(t.normalizeRelationshipType(''), 'RELATED_TO', 'a blank type takes the default');
  // Sanitised, not rejected: whatever arrives can only leave as [A-Z0-9_],
  // so it can never reach the server as an injection.
  assert.match(t.normalizeRelationshipType('../etc'), /^[A-Z0-9_]+$/);
  assert.equal(t.normalizeRelationshipType('!!!', 'RELATED_TO'), 'RELATED_TO',
    'a value that sanitises to nothing takes the fallback');
});

test('a repo id is derived from a name safely', () => {
  assert.match(t.repoIdFromName('My Project!'), /^[a-z0-9_-]+$/, 'the id is slug-safe');
  assert.equal(t.repoIdFromName(''), '', 'an empty name yields an empty id, letting the caller fall back');
});
