// SQLite index over the markdown vault: notes, tags, links, and full-text
// search via FTS5. The DB lives at <root>/.index.db; the markdown files on
// disk remain the source of truth.

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const store = require('./store');
const schema = require('./indexSchema');

const {
  INDEX_SCHEMA_VERSION, EMBED_DIM, DEFAULT_EMBED_MODEL,
  SCHEMA, runMigrations, ensureVecTable, ensureEmbeddingNormalizationMeta,
  embeddingModelKey,
} = schema;

// The meta accessors take the handle explicitly now that they live next to the
// schema; bind them to this module's connection so call sites stay unchanged.
const setMeta = (key, value) => schema.setMeta(db, key, value);
const getMeta = (key, fallback = null) => schema.getMeta(db, key, fallback);

const DB_PATH = path.join(store.ROOT, '.index.db');

const MAX_SEARCH_LIMIT = 200;
const MAX_FTS_QUERY_CHARS = 1000;
const MAX_FTS_TERMS = 32;
const MAX_VECTOR_SEARCH_LIMIT = 32;

let db = null;
let statements = null;
let initInProgress = false;

function noteKey(vaultId, noteId) {
  return `${vaultId}:${noteId}`;
}

function noteIdFromKey(vaultId, key) {
  const prefix = `${vaultId}:`;
  return String(key || '').startsWith(prefix) ? String(key).slice(prefix.length) : key;
}

function clampLimit(value, fallback, max) {
  const n = Number(value);
  const clean = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(1, Math.min(clean, max));
}

function init() {
  if (db) return db;
  if (initInProgress) throw new Error('Search index initialization is already in progress');
  initInProgress = true;
  let nextDb = null;
  try {
    nextDb = new Database(DB_PATH);
    sqliteVec.load(nextDb);
    db = nextDb;
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.exec(SCHEMA);
    runMigrations(db);
    ensureVecTable(db);
    ensureEmbeddingNormalizationMeta(db);
    statements = prepareStatements();
    return db;
  } catch (e) {
    try { nextDb?.close?.(); } catch {}
    db = null;
    statements = null;
    throw e;
  } finally {
    initInProgress = false;
  }
}

function close() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    db.close();
    db = null;
    statements = null;
  }
  initInProgress = false;
}

function prepareStatements() {
  return {
    embeddingRowsForNote: db.prepare('SELECT rowid FROM embedding_chunks WHERE note_id = ?'),
    deleteEmbedding: db.prepare('DELETE FROM note_embeddings WHERE rowid = ?'),
    deleteNote: db.prepare('DELETE FROM notes WHERE id = ?'),
    deleteFtsByRowid: db.prepare('DELETE FROM notes_fts WHERE rowid = ?'),
    ftsRowidForNote: db.prepare('SELECT fts_rowid AS ftsRowid FROM fts_map WHERE note_id = ?'),
    deleteFtsMapRow: db.prepare('DELETE FROM fts_map WHERE note_id = ?'),
    insertFtsMapRow: db.prepare('INSERT OR REPLACE INTO fts_map (note_id, vault_id, fts_rowid) VALUES (?, ?, ?)'),
    ftsRowidsForVault: db.prepare('SELECT fts_rowid AS ftsRowid FROM fts_map WHERE vault_id = ?'),
    deleteFtsMapForVault: db.prepare('DELETE FROM fts_map WHERE vault_id = ?'),
    deleteVaultEmbeddings: db.prepare('DELETE FROM note_embeddings WHERE rowid IN (SELECT rowid FROM embedding_chunks WHERE note_id IN (SELECT id FROM notes WHERE vault_id = ?))'),
    deleteVaultEmbeddingChunks: db.prepare('DELETE FROM embedding_chunks WHERE vault_id = ?'),
    deleteVaultNotes: db.prepare('DELETE FROM notes WHERE vault_id = ?'),
    insertNote: db.prepare(`
      INSERT INTO notes (id, vault_id, title, date, pinned, body, updated_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertTag: db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)'),
    insertLink: db.prepare('INSERT INTO links (src_id, dst_title, context) VALUES (?, ?, ?)'),
    insertFts: db.prepare(`
      INSERT INTO notes_fts (note_id, vault_id, title, body, tags)
      VALUES (?, ?, ?, ?, ?)
    `),
    noteIdsByVault: db.prepare('SELECT id FROM notes WHERE vault_id = ?'),
    noteHashesByVault: db.prepare('SELECT id, content_hash AS contentHash FROM notes WHERE vault_id = ?'),
    vectorChunkByRowid: db.prepare(`
      SELECT c.note_id AS noteId, c.chunk_idx AS chunkIdx, c.text AS chunkText,
             c.vault_id AS vaultId, n.title AS title
      FROM embedding_chunks c
      JOIN notes n ON n.id = c.note_id
      WHERE c.rowid = ?
    `),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Pull wiki-links out of a note's body and capture the surrounding line.
function extractLinks(body) {
  const out = [];
  const lines = (body || '').split('\n');
  for (const line of lines) {
    const matches = line.matchAll(/\[\[([^\]|#\n]+)(?:#[^\]\n|]+)?(?:\|[^\]\n]+)?\]\]/g);
    for (const m of matches) {
      out.push({ dst_title: m[1].trim(), context: line });
    }
  }
  return out;
}

// FTS5 query escaper: turn user input into a safe MATCH expression. Quotes
// each term, joins with AND, and adds prefix-search to the last term so
// search-as-you-type feels live.
function buildFtsQuery(q) {
  const trimmed = String(q ?? '').replace(/\0/g, ' ').trim().slice(0, MAX_FTS_QUERY_CHARS);
  if (!trimmed) return null;
  const terms = trimmed.split(/\s+/).filter(Boolean).slice(0, MAX_FTS_TERMS);
  if (!terms.length) return null;
  const quoted = terms.map((t, i) => {
    const safe = t.replace(/"/g, '');
    if (!safe) return null;
    // last term gets prefix match
    return i === terms.length - 1 ? `"${safe}"*` : `"${safe}"`;
  }).filter(Boolean);
  return quoted.join(' AND ');
}

// ── Indexing ────────────────────────────────────────────────────────────────

function _removeNoteRow(noteKey) {
  if (!db) init();
  // Find vec0 rowids before the cascade clears embedding_chunks
  const vecRows = statements.embeddingRowsForNote.all(noteKey);
  for (const r of vecRows) {
    statements.deleteEmbedding.run(BigInt(r.rowid));
  }
  // notes → cascade-deletes note_tags, links, embedding_chunks
  statements.deleteNote.run(noteKey);
  _removeFtsRow(noteKey);
}

// notes_fts is not FK'd to notes, so it is cleaned by hand — via the rowid
// map, because the note_id column is UNINDEXED and cannot be searched.
function _removeFtsRow(noteKey) {
  const row = statements.ftsRowidForNote.get(noteKey);
  if (!row) return;
  statements.deleteFtsByRowid.run(row.ftsRowid);
  statements.deleteFtsMapRow.run(noteKey);
}

// Everything the index derives from a note. Anything not in here can change
// without the rescan needing to touch a row.
function noteContentHash(note) {
  return crypto.createHash('sha1').update(JSON.stringify([
    note.title || '', note.date || '', note.pinned ? 1 : 0,
    note.body || '', (note.tags || []).join('\u0000'),
  ])).digest('hex');
}

function insertIndexedNote(vaultId, note) {
  const key = noteKey(vaultId, note.id);
  const tagsJoined = (note.tags || []).join(' ');
  statements.insertNote.run(
    key, vaultId, note.title || 'Untitled', note.date || new Date().toISOString(),
    note.pinned ? 1 : 0, note.body || '', new Date().toISOString(), noteContentHash(note)
  );
  for (const t of (note.tags || [])) statements.insertTag.run(key, t);
  for (const l of extractLinks(note.body)) statements.insertLink.run(key, l.dst_title, l.context);
  const fts = statements.insertFts.run(key, vaultId, note.title || '', note.body || '', tagsJoined);
  statements.insertFtsMapRow.run(key, vaultId, fts.lastInsertRowid);
}

function indexNote(vaultId, note) {
  if (!db) init();
  const key = noteKey(vaultId, note.id);
  const tx = db.transaction(() => {
    _removeNoteRow(key);
    insertIndexedNote(vaultId, note);
  });
  tx();
}

function removeNote(vaultId, noteId) {
  if (!db) init();
  _removeNoteRow(noteKey(vaultId, noteId));
}

function removeVault(vaultId) {
  if (!db) init();
  // notes cascades clear note_tags, links, and embedding_chunks. notes_fts
  // and the vec0 backing table are not FK'd, so clear them explicitly.
  const tx = db.transaction(() => {
    statements.deleteVaultEmbeddings.run(vaultId);
    statements.deleteVaultEmbeddingChunks.run(vaultId);
    statements.deleteVaultNotes.run(vaultId);
    for (const row of statements.ftsRowidsForVault.all(vaultId)) {
      statements.deleteFtsByRowid.run(row.ftsRowid);
    }
    statements.deleteFtsMapForVault.run(vaultId);
  });
  tx();
}

// Bring the index in line with what is on disk, touching only what moved.
//
// This used to delete the vault wholesale and reinsert it, which threw away
// every embedding on every boot — nothing re-embeds automatically, so semantic
// search silently degraded to keyword until the user ran Backfill by hand.
//
// A note whose content hash still matches is left completely alone, embeddings
// included. A note whose hash moved is rebuilt, and its embeddings are dropped
// on purpose: they describe text that no longer exists, and dropping them is
// what puts the note back into notesNeedingEmbeddings.
function rescanVault(vaultId, notes) {
  if (!db) init();
  const incoming = Array.isArray(notes) ? notes : [];
  const tx = db.transaction(() => {
    const existing = new Map(
      statements.noteHashesByVault.all(vaultId).map(row => [row.id, row.contentHash])
    );
    const seen = new Set();
    for (const note of incoming) {
      const key = noteKey(vaultId, note.id);
      seen.add(key);
      const hash = noteContentHash(note);
      if (existing.get(key) === hash) continue;
      // Present but changed, or absent entirely. _removeNoteRow is a no-op on
      // a key that is not there, so one path covers both.
      _removeNoteRow(key);
      insertIndexedNote(vaultId, note);
    }
    for (const key of existing.keys()) {
      if (!seen.has(key)) _removeNoteRow(key);
    }
  });
  tx();
}

// ── Queries ─────────────────────────────────────────────────────────────────

// FTS search within a vault. Returns up to `limit` matches ordered by rank.
// Each row: { id, title, snippet, rank }
function search(vaultId, query, limit = 50) {
  if (!db) init();
  const fts = buildFtsQuery(query);
  if (!fts) return [];
  const rowLimit = clampLimit(limit, 50, MAX_SEARCH_LIMIT);
  try {
    return db.prepare(`
      SELECT
        f.note_id AS id,
        f.title   AS title,
        snippet(notes_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet,
        rank
      FROM notes_fts f
      WHERE f.vault_id = ? AND notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(vaultId, fts, rowLimit).map(r => ({ ...r, id: noteIdFromKey(vaultId, r.id) }));
  } catch (e) {
    // Malformed FTS query (rare with our escaping) → no results, not crash
    console.warn('search query failed:', e.message);
    return [];
  }
}

function searchDetailedRows(vaultId, query, limit = 50) {
  if (!db) init();
  const fts = buildFtsQuery(query);
  if (!fts) return [];
  const rowLimit = clampLimit(limit, 50, MAX_SEARCH_LIMIT);
  const q = String(query || '').trim().toLowerCase();
  return db.prepare(`
    SELECT
      f.note_id AS id,
      f.title AS title,
      snippet(notes_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet,
      f.body AS body,
      f.tags AS tagsText,
      n.date AS date,
      n.updated_at AS modifiedAt,
      n.pinned AS pinned,
      rank
    FROM notes_fts f
    JOIN notes n ON n.id = f.note_id
    WHERE f.vault_id = ? AND notes_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(vaultId, fts, rowLimit).map(row => {
    const tags = String(row.tagsText || '').split(/\s+/).filter(Boolean);
    const matchedFields = [];
    if (q && String(row.title || '').toLowerCase().includes(q)) matchedFields.push('title');
    if (q && tags.some(tag => tag.toLowerCase().includes(q))) matchedFields.push('tags');
    if (q && String(row.body || '').toLowerCase().includes(q)) matchedFields.push('body');
    return {
      id: noteIdFromKey(vaultId, row.id),
      title: row.title,
      snippet: row.snippet || String(row.body || '').slice(0, 180),
      matchedFields: matchedFields.length ? matchedFields : ['body'],
      tags,
      modifiedAt: row.modifiedAt || null,
      date: row.date || null,
      pinned: !!row.pinned,
      rank: row.rank,
    };
  });
}

function searchDetailed(vaultId, query, limit = 50) {
  try {
    return searchDetailedRows(vaultId, query, limit);
  } catch (e) {
    console.warn('detailed search query failed:', e.message);
    return [];
  }
}

function searchDetailedStatus(vaultId, query, limit = 50) {
  try {
    return { ok: true, results: searchDetailedRows(vaultId, query, limit) };
  } catch (e) {
    return { ok: false, results: [], error: e.message || String(e) };
  }
}

// FTS-backed context snippets for Ask AI when semantic embeddings are not
// available. This keeps local chat useful with only a chat model installed.
function lexicalContextSearch(vaultId, query, limit = 8) {
  if (!db) init();
  const fts = buildFtsQuery(query);
  if (!fts) return [];
  const rowLimit = clampLimit(limit, 8, MAX_SEARCH_LIMIT);
  try {
    return db.prepare(`
      SELECT
        f.note_id AS noteId,
        f.title   AS title,
        snippet(notes_fts, 3, '', '', '...', 64) AS chunkText,
        rank
      FROM notes_fts f
      WHERE f.vault_id = ? AND notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(vaultId, fts, rowLimit).map(r => ({
      noteId: noteIdFromKey(vaultId, r.noteId),
      title: r.title,
      chunkText: r.chunkText || r.title,
      chunkIdx: 0,
      distance: r.rank,
      mode: 'keyword',
    }));
  } catch (e) {
    console.warn('lexical context search failed:', e.message);
    return [];
  }
}

// Resolved backlinks for a note title within a vault.
// Returns [{ id, title, context }] for source notes that reference this title.
function backlinks(vaultId, title, limit = 100) {
  if (!db) init();
  const rowLimit = clampLimit(limit, 100, 500);
  return db.prepare(`
    SELECT DISTINCT n.id AS id, n.title AS title, l.context AS context
    FROM links l
    JOIN notes n ON n.id = l.src_id
    WHERE n.vault_id = ?
      AND l.dst_title = ? COLLATE NOCASE
      AND n.title <> ? COLLATE NOCASE
    ORDER BY n.date DESC
    LIMIT ?
  `).all(vaultId, title, title, rowLimit).map(r => ({ ...r, id: noteIdFromKey(vaultId, r.id) }));
}

// Body text with wiki-link spans removed, so "[[Old Title|alias]]" does not
// count as a plain-text mention of "Old Title".
function stripWikiLinkSpans(body) {
  return String(body || '').replace(/\[\[[^\]\n]+\]\]/g, ' ');
}

function hasPlainMention(body, title) {
  const haystack = stripWikiLinkSpans(body).toLowerCase();
  const needle = String(title || '').trim().toLowerCase();
  if (!needle) return false;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = haystack[at + needle.length] || '';
    const boundary = (ch) => !ch || !/[a-z0-9]/.test(ch);
    if (boundary(before) && boundary(after)) return true;
    from = at + 1;
  }
  return false;
}

// Notes whose body mentions `title` as plain text without linking to it.
// The FTS phrase query narrows candidates cheaply; the literal post-filter
// drops stemming artifacts (porter would let "plan" match "planning") and
// mentions that only appear inside wiki links.
function unlinkedMentions(vaultId, title, limit = 20) {
  if (!db) init();
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return [];
  const rowLimit = clampLimit(limit, 20, 100);
  const phrase = `body: "${cleanTitle.replace(/"/g, '""')}"`;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT
        f.note_id AS id,
        f.title AS title,
        f.body AS body,
        snippet(notes_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet
      FROM notes_fts f
      JOIN notes n ON n.id = f.note_id
      WHERE f.vault_id = ?
        AND notes_fts MATCH ?
        AND n.title <> ? COLLATE NOCASE
        AND n.id NOT IN (SELECT src_id FROM links WHERE dst_title = ? COLLATE NOCASE)
      ORDER BY rank
      LIMIT ?
    `).all(vaultId, phrase, cleanTitle, cleanTitle, rowLimit * 3);
  } catch (e) {
    console.warn('unlinked mentions query failed:', e.message);
    return [];
  }
  return rows
    .filter(row => hasPlainMention(row.body, cleanTitle))
    .slice(0, rowLimit)
    .map(row => ({
      id: noteIdFromKey(vaultId, row.id),
      title: row.title,
      snippet: row.snippet,
    }));
}

// All note IDs in a vault that carry a tag.
function notesByTag(vaultId, tag) {
  if (!db) init();
  return db.prepare(`
    SELECT n.id FROM notes n
    JOIN note_tags t ON t.note_id = n.id
    WHERE n.vault_id = ? AND t.tag = ?
    ORDER BY n.date DESC
  `).all(vaultId, tag).map(r => noteIdFromKey(vaultId, r.id));
}

// Per-tag note counts for the sidebar.
function tagCounts(vaultId) {
  if (!db) init();
  return db.prepare(`
    SELECT t.tag AS tag, COUNT(DISTINCT t.note_id) AS count
    FROM note_tags t
    JOIN notes n ON n.id = t.note_id
    WHERE n.vault_id = ?
    GROUP BY t.tag
    ORDER BY count DESC
  `).all(vaultId);
}

// ── Embeddings ──────────────────────────────────────────────────────────────

// Split a note's body into ~paragraph-sized chunks suitable for embedding.
// Strips front-matter property lines and normalizes whitespace.
function chunkNote(note) {
  const body = (note.body || '').replace(/^[a-zA-Z_][a-zA-Z0-9_-]*::\s*.*$/gm, '').trim();
  // Split on blank lines; drop empties; cap each chunk at ~600 chars
  const paras = body.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  const pushCapped = (text) => {
    const clean = String(text || '').trim();
    for (let i = 0; i < clean.length; i += 600) {
      const part = clean.slice(i, i + 600).trim();
      if (part) chunks.push(part);
    }
  };
  // Always include the title as the first chunk so titles are searchable
  if (note.title && note.title.trim()) chunks.push(note.title.trim());
  for (const p of paras) {
    if (p.length <= 600) { chunks.push(p); continue; }
    // Soft-wrap long paragraphs by sentence
    const sents = p.split(/(?<=[.!?])\s+/);
    let buf = '';
    for (const s of sents) {
      if ((buf + ' ' + s).trim().length > 600 && buf) { pushCapped(buf); buf = s; }
      else { buf = (buf + ' ' + s).trim(); }
    }
    if (buf) pushCapped(buf);
  }
  return chunks;
}

// Float32Array → Buffer for sqlite-vec
function vecToBuffer(arr) {
  const source = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  if (source.length !== EMBED_DIM) {
    throw new Error(`Embedding dim mismatch: got ${source.length}, expected ${EMBED_DIM}`);
  }
  let sumSquares = 0;
  for (let i = 0; i < source.length; i++) sumSquares += source[i] * source[i];
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) throw new Error('Embedding vector is empty');
  const f = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) f[i] = source[i] / norm;
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

// Drop all embeddings for a note (the vec0 rows + the chunk metadata).
function removeEmbeddings(vaultId, noteId) {
  if (!db) init();
  const key = noteKey(vaultId, noteId);
  const rows = db.prepare('SELECT rowid FROM embedding_chunks WHERE note_id = ?').all(key);
  const tx = db.transaction(() => {
    for (const r of rows) {
      db.prepare('DELETE FROM note_embeddings WHERE rowid = ?').run(BigInt(r.rowid));
    }
    db.prepare('DELETE FROM embedding_chunks WHERE note_id = ?').run(key);
  });
  tx();
}

// Replace all embeddings for a note.
// `embeddings` is parallel to chunkNote(note): Array<Float32Array | number[]>.
// `model` is a label (e.g. 'nomic-embed-text') stored for migration purposes.
function setNoteEmbeddings(vaultId, note, embeddings, model) {
  if (!db) init();
  const chunks = chunkNote(note);
  const key = noteKey(vaultId, note.id);
  if (embeddings.length !== chunks.length) {
    throw new Error(`Chunk/embedding count mismatch: ${chunks.length} vs ${embeddings.length}`);
  }
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    removeEmbeddings(vaultId, note.id);
    const insChunk = db.prepare(`
      INSERT INTO embedding_chunks (note_id, vault_id, chunk_idx, text, model, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insVec = db.prepare('INSERT INTO note_embeddings (rowid, embedding) VALUES (?, ?)');
    for (let i = 0; i < chunks.length; i++) {
      const r = insChunk.run(key, vaultId, i, chunks[i], embeddingModelKey(model), now);
      // vec0 rejects float-bound numbers; rowid must be bound as BigInt.
      insVec.run(BigInt(r.lastInsertRowid), vecToBuffer(embeddings[i]));
    }
    setMeta('embedModel', model || DEFAULT_EMBED_MODEL);
    setMeta('embedDim', EMBED_DIM);
  });
  tx();
}

// k-nearest neighbour search against a query embedding, scoped to a vault.
// Returns [{ noteId, title, chunkText, chunkIdx, distance }] in distance order.
// Caller is responsible for converting their query string into an embedding.
function vectorSearch(vaultId, queryEmbedding, k = 8) {
  if (!db) init();
  const buf = vecToBuffer(queryEmbedding);
  const limit = clampLimit(k, 8, MAX_VECTOR_SEARCH_LIMIT);
  // KNN over the vector table, then resolve to chunk metadata + note title.
  // We over-fetch then filter by vault to keep the vec query simple.
  const overK = Math.min(limit * 4, 64);
  const hits = db.prepare(`
    SELECT rowid, distance
    FROM note_embeddings
    WHERE embedding MATCH ? AND k = ?
    ORDER BY distance
  `).all(buf, overK);
  const out = [];
  for (const h of hits) {
    const meta = statements.vectorChunkByRowid.get(h.rowid);
    if (!meta) continue;
    if (meta.vaultId !== vaultId) continue;
    out.push({
      noteId: noteIdFromKey(vaultId, meta.noteId),
      title: meta.title,
      chunkText: meta.chunkText,
      chunkIdx: meta.chunkIdx,
      distance: h.distance,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Note IDs in a vault that have NO embeddings yet (or whose stored model/vector
// format differs from `model`). Useful for incremental backfill in Phase 4.
function notesNeedingEmbeddings(vaultId, model) {
  if (!db) init();
  const modelKey = embeddingModelKey(model);
  return db.prepare(`
    SELECT n.id FROM notes n
    WHERE n.vault_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM embedding_chunks c
      WHERE c.note_id = n.id AND c.model = ?
    )
  `).all(vaultId, modelKey).map(r => noteIdFromKey(vaultId, r.id));
}

// Stats — useful for the AI panel and debugging.
function embeddingStats() {
  if (!db) init();
  return db.prepare(`
    SELECT vault_id AS vaultId, model, COUNT(*) AS chunks, COUNT(DISTINCT note_id) AS notes
    FROM embedding_chunks
    GROUP BY vault_id, model
  `).all();
}

function indexHealth(vaultId, model = DEFAULT_EMBED_MODEL) {
  if (!db) init();
  const modelKey = embeddingModelKey(model);
  const ftsIndexedNoteCount = db.prepare('SELECT COUNT(DISTINCT note_id) AS count FROM notes_fts WHERE vault_id = ?').get(vaultId)?.count || 0;
  const indexedNoteCount = db.prepare('SELECT COUNT(*) AS count FROM notes WHERE vault_id = ?').get(vaultId)?.count || 0;
  const embed = db.prepare(`
    SELECT COUNT(*) AS chunks, COUNT(DISTINCT note_id) AS notes
    FROM embedding_chunks
    WHERE vault_id = ? AND model = ?
  `).get(vaultId, modelKey) || {};
  const mismatched = db.prepare(`
    SELECT COUNT(DISTINCT note_id) AS notes
    FROM embedding_chunks
    WHERE vault_id = ? AND model <> ?
  `).get(vaultId, modelKey)?.notes || 0;
  const missing = notesNeedingEmbeddings(vaultId, model);
  return {
    vaultId,
    model,
    modelKey,
    indexedNoteCount,
    ftsIndexedNoteCount,
    embeddingNoteCount: embed.notes || 0,
    embeddingChunkCount: embed.chunks || 0,
    missingEmbeddingCount: missing.length,
    missingEmbeddingNoteIds: missing.slice(0, 100),
    modelMismatchNoteCount: mismatched,
    reindexNeeded: !!getMeta('reindexNeeded', false),
    failureReason: getMeta('reindexReason', ''),
    checkedAt: new Date().toISOString(),
  };
}

function markEmbeddingsNormalized() {
  if (!db) init();
  setMeta('embeddingNormalized', true);
  setMeta('reindexNeeded', false);
}

module.exports = {
  init, close,
  indexNote, removeNote, removeVault, rescanVault,
  search, searchDetailed, searchDetailedStatus, lexicalContextSearch, backlinks, unlinkedMentions, notesByTag, tagCounts,
  // Embeddings
  chunkNote, setNoteEmbeddings, removeEmbeddings,
  vectorSearch, notesNeedingEmbeddings, embeddingStats, markEmbeddingsNormalized,
  indexHealth,
  EMBED_DIM, DB_PATH,
  INDEX_SCHEMA_VERSION,
};
