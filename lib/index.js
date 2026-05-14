// SQLite index over the markdown vault: notes, tags, links, and full-text
// search via FTS5. The DB lives at <root>/.index.db; the markdown files on
// disk remain the source of truth.

const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const store = require('./store');

const DB_PATH = path.join(store.ROOT, '.index.db');
const INDEX_SCHEMA_VERSION = 1;

// Embedding dimension. nomic-embed-text outputs 768. If you switch model
// (e.g. mxbai-embed-large = 1024), bump this and drop the embeddings table —
// vec0 columns are typed by dimension and can't be widened in place.
const EMBED_DIM = 768;
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const EMBED_VECTOR_VERSION = 'normalized-v1';
const MAX_SEARCH_LIMIT = 200;
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

function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function getMeta(key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value ?? fallback; }
}

function clampLimit(value, fallback, max) {
  const n = Number(value);
  const clean = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(1, Math.min(clean, max));
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_vault ON notes(vault_id);
CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (note_id, tag),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);

CREATE TABLE IF NOT EXISTS links (
  src_id    TEXT NOT NULL,
  dst_title TEXT NOT NULL,
  context   TEXT,
  FOREIGN KEY (src_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_id);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  vault_id UNINDEXED,
  title,
  body,
  tags,
  tokenize = 'porter unicode61 remove_diacritics 1'
);

-- Maps embedding rowids ↔ (note_id, chunk_idx). vec0 only stores the vector
-- by integer rowid, so this table holds the human-meaningful identifiers.
CREATE TABLE IF NOT EXISTS embedding_chunks (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     TEXT NOT NULL,
  vault_id    TEXT NOT NULL,
  chunk_idx   INTEGER NOT NULL,
  text        TEXT NOT NULL,
  model       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_embed_chunks_note ON embedding_chunks(note_id);
CREATE INDEX IF NOT EXISTS idx_embed_chunks_vault ON embedding_chunks(vault_id);
`;

function runMigrations() {
  const current = Number(getMeta('schemaVersion', 0)) || 0;
  if (current > INDEX_SCHEMA_VERSION) {
    throw new Error(`Index schema ${current} is newer than this app supports (${INDEX_SCHEMA_VERSION})`);
  }
  if (current < 1) {
    setMeta('schemaVersion', 1);
    setMeta('migratedAt', new Date().toISOString());
  }
  setMeta('embedDim', EMBED_DIM);
  if (!getMeta('embedModel')) setMeta('embedModel', DEFAULT_EMBED_MODEL);
}

// vec0 is created separately because the dimension is parameterized. If an
// existing table has the wrong shape, build the replacement first and only
// clear chunk metadata after the new table exists.
function ensureVecTable() {
  db.transaction(() => {
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='note_embeddings'").get();
    const expected = `embedding float[${EMBED_DIM}]`;
    if (existing && !existing.sql.includes(expected)) {
      try {
        db.exec('DROP TABLE IF EXISTS note_embeddings_next');
        db.exec(`CREATE VIRTUAL TABLE note_embeddings_next USING vec0(embedding float[${EMBED_DIM}])`);
        db.exec('DROP TABLE note_embeddings');
        db.exec('ALTER TABLE note_embeddings_next RENAME TO note_embeddings');
        db.exec('DELETE FROM embedding_chunks');
        setMeta('embedDim', EMBED_DIM);
        setMeta('reindexNeeded', true);
        setMeta('reindexReason', 'embedding dimension changed');
        setMeta('vecMigratedAt', new Date().toISOString());
      } catch (e) {
        try { db.exec('DROP TABLE IF EXISTS note_embeddings_next'); } catch {}
        setMeta('reindexNeeded', true);
        setMeta('reindexReason', `embedding migration failed: ${e.message || String(e)}`);
      }
    }
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS note_embeddings USING vec0(embedding float[${EMBED_DIM}])`);
  })();
}

function ensureEmbeddingNormalizationMeta() {
  if (getMeta('embeddingNormalized') === true) return;
  setMeta('reindexNeeded', true);
  setMeta('reindexReason', 'embedding normalization changed');
}

function embeddingModelKey(model = DEFAULT_EMBED_MODEL) {
  return `${model || DEFAULT_EMBED_MODEL}:${EMBED_VECTOR_VERSION}`;
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
    runMigrations();
    ensureVecTable();
    ensureEmbeddingNormalizationMeta();
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
    deleteFts: db.prepare('DELETE FROM notes_fts WHERE note_id = ?'),
    deleteVaultEmbeddings: db.prepare('DELETE FROM note_embeddings WHERE rowid IN (SELECT rowid FROM embedding_chunks WHERE note_id IN (SELECT id FROM notes WHERE vault_id = ?))'),
    deleteVaultEmbeddingChunks: db.prepare('DELETE FROM embedding_chunks WHERE vault_id = ?'),
    deleteVaultNotes: db.prepare('DELETE FROM notes WHERE vault_id = ?'),
    deleteVaultFts: db.prepare('DELETE FROM notes_fts WHERE vault_id = ?'),
    insertNote: db.prepare(`
      INSERT INTO notes (id, vault_id, title, date, pinned, body, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertTag: db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)'),
    insertLink: db.prepare('INSERT INTO links (src_id, dst_title, context) VALUES (?, ?, ?)'),
    insertFts: db.prepare(`
      INSERT INTO notes_fts (note_id, vault_id, title, body, tags)
      VALUES (?, ?, ?, ?, ?)
    `),
    noteIdsByVault: db.prepare('SELECT id FROM notes WHERE vault_id = ?'),
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
  const trimmed = (q || '').trim();
  if (!trimmed) return null;
  const terms = trimmed.split(/\s+/).filter(Boolean);
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
  statements.deleteFts.run(noteKey);
}

function insertIndexedNote(vaultId, note) {
  const key = noteKey(vaultId, note.id);
  const tagsJoined = (note.tags || []).join(' ');
  statements.insertNote.run(
    key, vaultId, note.title || 'Untitled', note.date || new Date().toISOString(),
    note.pinned ? 1 : 0, note.body || '', new Date().toISOString()
  );
  for (const t of (note.tags || [])) statements.insertTag.run(key, t);
  for (const l of extractLinks(note.body)) statements.insertLink.run(key, l.dst_title, l.context);
  statements.insertFts.run(key, vaultId, note.title || '', note.body || '', tagsJoined);
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
    statements.deleteVaultFts.run(vaultId);
  });
  tx();
}

function rescanVault(vaultId, notes) {
  if (!db) init();
  const tx = db.transaction(() => {
    statements.deleteVaultEmbeddings.run(vaultId);
    statements.deleteVaultEmbeddingChunks.run(vaultId);
    statements.deleteVaultNotes.run(vaultId);
    statements.deleteVaultFts.run(vaultId);
    for (const n of notes) {
      insertIndexedNote(vaultId, n);
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
      AND lower(l.dst_title) = lower(?)
      AND lower(n.title) <> lower(?)
    ORDER BY n.date DESC
    LIMIT ?
  `).all(vaultId, title, title, rowLimit).map(r => ({ ...r, id: noteIdFromKey(vaultId, r.id) }));
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
  search, searchDetailed, searchDetailedStatus, lexicalContextSearch, backlinks, notesByTag, tagCounts,
  // Embeddings
  chunkNote, setNoteEmbeddings, removeEmbeddings,
  vectorSearch, notesNeedingEmbeddings, embeddingStats, markEmbeddingsNormalized,
  indexHealth,
  EMBED_DIM, DB_PATH,
  INDEX_SCHEMA_VERSION,
};
