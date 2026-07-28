// Schema, migrations and the `meta` key/value accessors for the search index.
//
// Split out of index.js so the query surface there stays readable: this file
// answers "what shape is the database and how does an older one catch up",
// index.js answers "how do we read and write it".

const INDEX_SCHEMA_VERSION = 2;

// Embedding dimension. nomic-embed-text outputs 768. If you switch model
// (e.g. mxbai-embed-large = 1024), bump this and drop the embeddings table —
// vec0 columns are typed by dimension and can't be widened in place.
const EMBED_DIM = 768;
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const EMBED_VECTOR_VERSION = 'normalized-v1';

function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value ?? fallback; }
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
  updated_at TEXT NOT NULL,
  -- Fingerprint of everything the index derives from a note. Lets a rescan
  -- tell "same note" from "edited note" without reading every body back out
  -- of the database, which is what makes an incremental rescan worth doing.
  content_hash TEXT
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

-- notes_fts declares note_id UNINDEXED, so deleting by it forces a full scan
-- of the FTS table on every save. This maps a note to its fts rowid, which
-- turns that scan into a lookup (measured 4.1ms -> 0.05ms at 5k notes).
CREATE TABLE IF NOT EXISTS fts_map (
  note_id   TEXT PRIMARY KEY,
  vault_id  TEXT NOT NULL,
  fts_rowid INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fts_map_vault ON fts_map(vault_id);

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

function runMigrations(db) {
  const current = Number(getMeta(db, 'schemaVersion', 0)) || 0;
  if (current > INDEX_SCHEMA_VERSION) {
    throw new Error(`Index schema ${current} is newer than this app supports (${INDEX_SCHEMA_VERSION})`);
  }
  if (current < 1) {
    setMeta(db, 'schemaVersion', 1);
    setMeta(db, 'migratedAt', new Date().toISOString());
  }
  if (current < 2) {
    // CREATE TABLE above is IF NOT EXISTS, so an index built before this
    // version still has the old shape and needs the column added by hand.
    const columns = db.prepare('PRAGMA table_info(notes)').all();
    if (!columns.some(column => column.name === 'content_hash')) {
      db.exec('ALTER TABLE notes ADD COLUMN content_hash TEXT');
    }
    // Backfill the fts rowid map for an index built before it existed. One
    // scan here replaces a scan on every future save.
    db.exec('INSERT OR REPLACE INTO fts_map (note_id, vault_id, fts_rowid) SELECT note_id, vault_id, rowid FROM notes_fts');
    setMeta(db, 'schemaVersion', INDEX_SCHEMA_VERSION);
    setMeta(db, 'migratedAt', new Date().toISOString());
  }
  setMeta(db, 'embedDim', EMBED_DIM);
  if (!getMeta(db, 'embedModel')) setMeta(db, 'embedModel', DEFAULT_EMBED_MODEL);
}

// vec0 is created separately because the dimension is parameterized. If an
// existing table has the wrong shape, build the replacement first and only
// clear chunk metadata after the new table exists.
function ensureVecTable(db) {
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
        setMeta(db, 'embedDim', EMBED_DIM);
        setMeta(db, 'reindexNeeded', true);
        setMeta(db, 'reindexReason', 'embedding dimension changed');
        setMeta(db, 'vecMigratedAt', new Date().toISOString());
      } catch (e) {
        try { db.exec('DROP TABLE IF EXISTS note_embeddings_next'); } catch {}
        setMeta(db, 'reindexNeeded', true);
        setMeta(db, 'reindexReason', `embedding migration failed: ${e.message || String(e)}`);
      }
    }
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS note_embeddings USING vec0(embedding float[${EMBED_DIM}])`);
  })();
}

function ensureEmbeddingNormalizationMeta(db) {
  if (getMeta(db, 'embeddingNormalized') === true) return;
  setMeta(db, 'reindexNeeded', true);
  setMeta(db, 'reindexReason', 'embedding normalization changed');
}

function embeddingModelKey(model = DEFAULT_EMBED_MODEL) {
  return `${model || DEFAULT_EMBED_MODEL}:${EMBED_VECTOR_VERSION}`;
}

module.exports = {
  INDEX_SCHEMA_VERSION, EMBED_DIM, DEFAULT_EMBED_MODEL, EMBED_VECTOR_VERSION,
  SCHEMA, setMeta, getMeta, runMigrations, ensureVecTable,
  ensureEmbeddingNormalizationMeta, embeddingModelKey,
};
