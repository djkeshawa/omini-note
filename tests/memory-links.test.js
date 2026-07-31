const test = require('node:test');
const assert = require('node:assert/strict');

const { extractWikiLinkTitles, noteMemoryIndex, buildNoteLinkEdges, HUB_THRESHOLD } = require('../lib/memoryLinks');

function memMap(pairs) {
  return new Map(pairs.map(([noteId, memoryId]) => [noteId, { memoryId, createdAt: '' }]));
}

test('extractWikiLinkTitles parses links (alias/heading) and ignores non-links', () => {
  assert.deepEqual(
    extractWikiLinkTitles('See [[Alpha]] and [[Beta|the beta]] and [[Gamma#head]].'),
    ['Alpha', 'Beta', 'Gamma']
  );
  assert.deepEqual(extractWikiLinkTitles('no links here'), []);
  assert.deepEqual(extractWikiLinkTitles(''), []);
});

test('noteMemoryIndex maps by vispnote_note_id and keeps the newest memory', () => {
  const index = noteMemoryIndex([
    { id: 'm-old', createdAt: '2026-07-01T00:00:00Z', metadata: { vispnote_note_id: 'n1' } },
    { id: 'm-new', createdAt: '2026-07-05T00:00:00Z', metadata: { vispnote_note_id: 'n1' } },
    { id: 'm-nometa', createdAt: '2026-07-02T00:00:00Z', metadata: {} },             // no note id → skipped
    { id: '', createdAt: '2026-07-09T00:00:00Z', metadata: { vispnote_note_id: 'n2' } }, // no memory id → skipped
    { id: 'm-2', createdAt: '2026-07-03T00:00:00Z', metadata: { vispnote_note_id: 'n2' } },
  ]);
  assert.equal(index.get('n1').memoryId, 'm-new', 'latest createdAt wins (ISO-8601 sorts as string)');
  assert.equal(index.get('n2').memoryId, 'm-2');
  assert.equal(index.size, 2);
  assert.equal(noteMemoryIndex(null).size, 0);
});

test('noteMemoryIndex scopes duplicate note ids by vault and uses only unambiguous legacy mappings', () => {
  const index = noteMemoryIndex([
    { id: 'm-v1', createdAt: '2026-07-01T00:00:00Z', metadata: { vispnote_note_id: 'same', vispnote_vault_id: 'v1' } },
    { id: 'm-v2', createdAt: '2026-07-02T00:00:00Z', metadata: { vispnote_note_id: 'same', vispnote_vault_id: 'v2' } },
    { id: 'm-legacy', createdAt: '2026-07-03T00:00:00Z', metadata: { vispnote_note_id: 'legacy-only' } },
    { id: 'm-ambiguous-old', createdAt: '2026-07-03T00:00:00Z', metadata: { vispnote_note_id: 'ambiguous' } },
    { id: 'm-ambiguous-new', createdAt: '2026-07-04T00:00:00Z', metadata: { vispnote_note_id: 'ambiguous' } },
  ], { vaultId: 'v1' });
  assert.equal(index.get('same').memoryId, 'm-v1');
  assert.equal(index.get('legacy-only').memoryId, 'm-legacy');
  assert.equal(index.has('ambiguous'), false);
  assert.equal(index.stats.mappedScoped, 1);
  assert.equal(index.stats.mappedLegacy, 1);
  assert.equal(index.stats.ambiguousLegacy, 1);
  assert.equal(index.stats.skippedOtherVault, 1);
});

test('buildNoteLinkEdges: base strength 0.75 for a plain remembered link', () => {
  const notes = [
    { id: 'n1', title: 'Alpha', body: 'links [[Beta]]' },
    { id: 'n2', title: 'Beta', body: 'no links' },
  ];
  const { edges, stats } = buildNoteLinkEdges(notes, memMap([['n1', 'm1'], ['n2', 'm2']]));
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0], { sourceMemoryId: 'm1', targetMemoryId: 'm2', relationship: 'REFERENCES', strength: 0.75 });
  assert.equal(stats.wikiLinks, 1);
  assert.equal(stats.linkedNotesMissingMemory, 0);
});

test('buildNoteLinkEdges: reciprocal links are strengthened to 0.95', () => {
  const notes = [
    { id: 'n1', title: 'Alpha', body: 'links [[Beta]]' },
    { id: 'n2', title: 'Beta', body: 'links [[Alpha]]' },
  ];
  const { edges } = buildNoteLinkEdges(notes, memMap([['n1', 'm1'], ['n2', 'm2']]));
  assert.equal(edges.length, 2);
  assert.ok(edges.every(e => e.strength === 0.95), 'both directions of a mutual link are strong');
});

test('buildNoteLinkEdges: hub targets (inDegree >= threshold) are down-weighted to 0.4', () => {
  const notes = [];
  const pairs = [['hub', 'm-hub']];
  for (let i = 0; i < HUB_THRESHOLD; i++) {
    notes.push({ id: `s${i}`, title: `S${i}`, body: 'links [[Hub]]' });
    pairs.push([`s${i}`, `m${i}`]);
  }
  notes.push({ id: 'hub', title: 'Hub', body: '' });
  const { edges } = buildNoteLinkEdges(notes, memMap(pairs));
  assert.equal(edges.length, HUB_THRESHOLD);
  assert.ok(edges.every(e => e.strength === 0.4), 'every edge into a hub node is capped');
});

test('buildNoteLinkEdges: one link below the hub threshold stays 0.75', () => {
  const notes = [];
  const pairs = [['hub', 'm-hub']];
  for (let i = 0; i < HUB_THRESHOLD - 1; i++) {
    notes.push({ id: `s${i}`, title: `S${i}`, body: 'links [[Hub]]' });
    pairs.push([`s${i}`, `m${i}`]);
  }
  notes.push({ id: 'hub', title: 'Hub', body: '' });
  const { edges } = buildNoteLinkEdges(notes, memMap(pairs));
  assert.ok(edges.every(e => e.strength === 0.75), 'inDegree just below threshold is not a hub');
});

test('buildNoteLinkEdges: a reciprocal link into a hub is still hub-capped (0.4)', () => {
  const notes = [{ id: 'hub', title: 'Hub', body: 'links [[S0]]' }];
  const pairs = [['hub', 'm-hub']];
  for (let i = 0; i < HUB_THRESHOLD; i++) {
    notes.push({ id: `s${i}`, title: `S${i}`, body: 'links [[Hub]]' });
    pairs.push([`s${i}`, `m${i}`]);
  }
  const { edges } = buildNoteLinkEdges(notes, memMap(pairs));
  const intoHub = edges.find(e => e.targetMemoryId === 'm-hub' && e.sourceMemoryId === 'm0');
  assert.ok(intoHub, 'the S0→Hub edge exists');
  assert.equal(intoHub.strength, 0.4, 'hub down-weight dominates reciprocity');
});

test('buildNoteLinkEdges: self-links are dropped', () => {
  const notes = [{ id: 'n1', title: 'Alpha', body: 'links [[Alpha]]' }];
  const { edges, stats } = buildNoteLinkEdges(notes, memMap([['n1', 'm1']]));
  assert.equal(edges.length, 0);
  assert.equal(stats.wikiLinks, 0);
});

test('buildNoteLinkEdges: a link whose endpoints are not both remembered yields no edge', () => {
  const notes = [
    { id: 'n1', title: 'Alpha', body: 'links [[Beta]]' },
    { id: 'n2', title: 'Beta', body: '' },
  ];
  const { edges, stats } = buildNoteLinkEdges(notes, memMap([['n1', 'm1']])); // only n1 remembered
  assert.equal(edges.length, 0);
  assert.equal(stats.wikiLinks, 1);
  assert.equal(stats.linkedNotesMissingMemory, 1);
});

test('buildNoteLinkEdges: duplicate titles resolve first-writer-wins and are counted ambiguous', () => {
  const notes = [
    { id: 'n1', title: 'Design', body: '' },
    { id: 'n2', title: 'design', body: '' },       // same lowercased title
    { id: 'n3', title: 'Source', body: 'links [[design]]' },
  ];
  const { edges, stats } = buildNoteLinkEdges(notes, memMap([['n1', 'm1'], ['n2', 'm2'], ['n3', 'm3']]));
  assert.equal(stats.ambiguousTitles, 1);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].targetMemoryId, 'm1', 'first note with the title wins — mirrors how VispNote resolves the visible [[link]]');
});

test('buildNoteLinkEdges: links to a non-existent note are silently skipped', () => {
  const notes = [{ id: 'n1', title: 'Alpha', body: 'links [[Ghost]]' }];
  const { edges, stats } = buildNoteLinkEdges(notes, memMap([['n1', 'm1']]));
  assert.equal(edges.length, 0);
  assert.equal(stats.wikiLinks, 0, 'a link to a title with no note is not a graph edge');
  assert.equal(stats.linkedNotesMissingMemory, 0);
});

test('buildNoteLinkEdges: repeated mentions from one note are a single relationship', () => {
  // A note that names the same target on every line still links to it once.
  // Counting each mention let that one note reach the hub threshold by itself,
  // capping a genuinely weak-signal target at 0.4 and writing the same edge
  // into the knowledge graph once per mention.
  const notes = [
    { id: 'n1', title: 'Alpha', body: Array(HUB_THRESHOLD + 2).fill('see [[Beta]]').join('\n') },
    { id: 'n2', title: 'Beta', body: 'no links' },
  ];
  const { edges, stats } = buildNoteLinkEdges(notes, memMap([['n1', 'm1'], ['n2', 'm2']]));
  assert.equal(edges.length, 1, 'one relationship, however many times it is named');
  assert.equal(edges[0].strength, 0.75, 'one source is never a hub');
  assert.equal(stats.wikiLinks, 1);
});

test('buildNoteLinkEdges: repeats do not mask a reciprocal link', () => {
  const notes = [
    { id: 'n1', title: 'Alpha', body: 'links [[Beta]] and again [[Beta]]' },
    { id: 'n2', title: 'Beta', body: 'links [[Alpha]]' },
  ];
  const { edges } = buildNoteLinkEdges(notes, memMap([['n1', 'm1'], ['n2', 'm2']]));
  assert.equal(edges.length, 2);
  assert.ok(edges.every(e => e.strength === 0.95));
});
