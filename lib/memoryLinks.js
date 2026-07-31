// Pure helpers for mirroring VispNote's [[wiki-link]] structure into the
// llm-memory knowledge graph. Kept free of I/O (no store, no server calls) so
// the note→memory resolution and hub/reciprocity edge weighting are
// unit-testable in isolation; main.js does the fetching and calls these.

const HUB_THRESHOLD = 8;

function extractWikiLinkTitles(body) {
  const titles = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = re.exec(String(body || '')))) {
    const title = String(match[1] || '').trim();
    if (title) titles.push(title);
  }
  return titles;
}

// Maps each note id to its most recent memory using metadata.vispnote_note_id
// (stamped by rememberNote). ISO-8601 timestamps sort correctly as strings, so
// a lexicographic max picks the newest memory when a note was remembered more
// than once.
function noteMemoryIndex(memories, { vaultId } = {}) {
  const byNoteId = new Map();
  const allByNoteId = new Map();
  const list = Array.isArray(memories) ? memories : [];
  for (const memory of list) {
    const noteId = memory?.metadata?.vispnote_note_id;
    if (!noteId || !memory.id) continue;
    const rows = allByNoteId.get(noteId) || [];
    rows.push(memory);
    allByNoteId.set(noteId, rows);
  }

  const stats = { mappedScoped: 0, mappedLegacy: 0, ambiguousLegacy: 0, skippedOtherVault: 0 };
  for (const [noteId, candidates] of allByNoteId) {
    if (!vaultId) {
      const memory = candidates.reduce((latest, item) => !latest || String(item.createdAt || '') > String(latest.createdAt || '') ? item : latest, null);
      if (memory) byNoteId.set(noteId, { memoryId: memory.id, createdAt: memory.createdAt || '' });
      continue;
    }
    const scoped = candidates.filter(memory => String(memory?.metadata?.vispnote_vault_id || '') === String(vaultId));
    if (scoped.length) {
      const memory = scoped.reduce((latest, item) => !latest || String(item.createdAt || '') > String(latest.createdAt || '') ? item : latest, null);
      byNoteId.set(noteId, { memoryId: memory.id, createdAt: memory.createdAt || '' });
      stats.mappedScoped++;
      stats.skippedOtherVault += candidates.filter(item => item?.metadata?.vispnote_vault_id && String(item.metadata.vispnote_vault_id) !== String(vaultId)).length;
      continue;
    }
    const legacy = candidates.filter(memory => !memory?.metadata?.vispnote_vault_id);
    if (legacy.length === 1 && candidates.length === 1) {
      const memory = legacy[0];
      byNoteId.set(noteId, { memoryId: memory.id, createdAt: memory.createdAt || '' });
      stats.mappedLegacy++;
    } else if (legacy.length) {
      stats.ambiguousLegacy++;
    } else {
      stats.skippedOtherVault += candidates.length;
    }
  }
  Object.defineProperty(byNoteId, 'stats', { value: stats, enumerable: false });
  return byNoteId;
}

// Builds directed, weighted REFERENCES edges mirroring wiki-links between
// remembered notes. Title resolution is first-writer-wins on the lowercased
// title — the same rule VispNote uses to resolve a [[link]] to a note — so an
// edge faithfully mirrors where the visible link actually points (duplicate
// titles are counted so the caller can report the ambiguity). Hub targets (many
// inbound links: MOCs, daily notes, indexes) are down-weighted because they
// carry low signal; reciprocal (A↔B) links are strengthened because mutual
// links are the reliable ones.
function buildNoteLinkEdges(notes, noteMemoryMap, options = {}) {
  const hubThreshold = Number(options.hubThreshold) || HUB_THRESHOLD;
  const list = Array.isArray(notes) ? notes : [];
  const memoryMap = noteMemoryMap instanceof Map ? noteMemoryMap : new Map();

  const byTitle = new Map();
  const ambiguousTitles = new Set();
  for (const note of list) {
    const key = String(note.title || '').trim().toLowerCase();
    if (!key) continue;
    if (byTitle.has(key)) ambiguousTitles.add(key);
    else byTitle.set(key, note.id);
  }

  const directed = new Set();
  const inDegree = new Map();
  const rawEdges = [];
  for (const note of list) {
    for (const title of extractWikiLinkTitles(note.body)) {
      const targetId = byTitle.get(title.trim().toLowerCase());
      if (!targetId || targetId === note.id) continue;
      const pair = `${note.id}>${targetId}`;
      // One note naming the same target twice is still one relationship.
      // Counting the repeats let a single note reach the hub threshold on its
      // own — down-weighting a target nothing else pointed at — and pushed the
      // identical edge into the graph once per mention.
      if (directed.has(pair)) continue;
      directed.add(pair);
      inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
      rawEdges.push({ sourceNoteId: note.id, targetNoteId: targetId });
    }
  }

  const edges = [];
  let linkedNotesMissingMemory = 0;
  for (const edge of rawEdges) {
    const source = memoryMap.get(edge.sourceNoteId);
    const target = memoryMap.get(edge.targetNoteId);
    if (!source || !target) { linkedNotesMissingMemory++; continue; }
    const reciprocal = directed.has(`${edge.targetNoteId}>${edge.sourceNoteId}`);
    const hub = (inDegree.get(edge.targetNoteId) || 0) >= hubThreshold;
    let strength = 0.75;
    if (reciprocal) strength = 0.95;
    if (hub) strength = Math.min(strength, 0.4);
    edges.push({ sourceMemoryId: source.memoryId, targetMemoryId: target.memoryId, relationship: 'REFERENCES', strength });
  }

  return {
    edges,
    stats: {
      wikiLinks: rawEdges.length,
      linkedNotesMissingMemory,
      ambiguousTitles: ambiguousTitles.size,
    },
  };
}

module.exports = { HUB_THRESHOLD, extractWikiLinkTitles, noteMemoryIndex, buildNoteLinkEdges };
