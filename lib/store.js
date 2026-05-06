// Filesystem-backed store for VispNote vaults.
// Layout:
//   <root>/.config.json                  global config (vaults list, active vault, tweaks)
//   <root>/<slug>/.meta.json             per-vault metadata (name, tags w/ hues, lastSelectedId)
//   <root>/<slug>/<noteId>.md            one markdown file per note, with YAML front-matter

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const APP_DIR_NAME = 'VispNote';
const LEGACY_APP_DIR_NAMES = ['OminiNote', 'MyNote'];
const PRIMARY_ROOT = path.join(os.homedir(), APP_DIR_NAME);
const LEGACY_ROOT = LEGACY_APP_DIR_NAMES.map(name => path.join(os.homedir(), name)).find(dir => fs.existsSync(dir));
const ROOT = !fs.existsSync(PRIMARY_ROOT) && LEGACY_ROOT ? LEGACY_ROOT : PRIMARY_ROOT;
const CONFIG_FILE = path.join(ROOT, '.config.json');
const CONFIG_FILE_MODE = 0o600;
const ENTITY_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_TITLE_LENGTH = 240;
const MAX_TAG_NAME_LENGTH = 64;
const MAX_WORKFLOW_ID_LENGTH = 18;
const SAFETY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NOTE_VERSIONS = 50;
const BACKUP_FORMAT = 'vispnote.backup.v1';
let configCache = null;
const noteSaveLocks = new Map();

// ── Front-matter ────────────────────────────────────────────────────────────

function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: text };
  const head = text.slice(4, end);
  let body = text.slice(end + 4).replace(/^\n+/, '');
  const meta = {};
  for (const raw of head.split('\n')) {
    const m = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (/^\[.*\]$/.test(val)) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) {
      try { val = JSON.parse(val); } catch {}
    }
    meta[m[1]] = val;
  }
  return { meta, body };
}

function serializeFrontMatter(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map(s => /[,\[\]"]/.test(String(s)) ? JSON.stringify(s) : s).join(', ')}]`);
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      lines.push(`${k}: ${v}`);
    } else {
      const s = String(v);
      lines.push(`${k}: ${/[:#"'\[\]\n]/.test(s) ? JSON.stringify(s) : s}`);
    }
  }
  lines.push('---', '', body || '');
  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vault';
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function readJsonSafe(file, fallback) {
  try {
    const t = await fsp.readFile(file, 'utf8');
    return JSON.parse(t);
  } catch (e) {
    return fallback;
  }
}

async function writeJson(file, obj, options = {}) {
  await ensureDir(path.dirname(file));
  await atomicWriteFile(file, JSON.stringify(obj, null, 2), 'utf8', options);
}

async function atomicWriteFile(file, data, encoding = 'utf8', options = {}) {
  await ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  let handle = null;
  try {
    handle = await fsp.open(tmp, 'w', options.mode);
    if (options.mode !== undefined) await handle.chmod(options.mode);
    await handle.writeFile(data, encoding);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(tmp, file);
    if (options.mode !== undefined) await fsp.chmod(file, options.mode);
    await syncDirectory(path.dirname(file));
  } catch (e) {
    try { if (handle) await handle.close(); } catch {}
    try { await fsp.unlink(tmp); } catch {}
    throw e;
  }
}

async function syncDirectory(dir) {
  let handle = null;
  try {
    handle = await fsp.open(dir, 'r');
    await handle.sync();
  } catch (e) {
    // Some platforms/filesystems do not allow fsync on directories.
  } finally {
    try { if (handle) await handle.close(); } catch {}
  }
}

function vaultDir(slug) { return path.join(ROOT, slug); }
function vaultMetaFile(slug) { return path.join(vaultDir(slug), '.meta.json'); }
function canvasDir(slug) { return path.join(vaultDir(slug), '.canvases'); }
function trashNoteDir(slug) { return path.join(vaultDir(slug), '.trash', 'notes'); }
function trashCanvasDir(slug) { return path.join(vaultDir(slug), '.trash', 'canvases'); }
function noteVersionsDir(slug, noteId) { return path.join(vaultDir(slug), '.versions', 'notes', validateNoteId(noteId)); }
async function vaultDirectoryExists(slug) {
  try {
    const stat = await fsp.stat(vaultDir(slug));
    return stat.isDirectory();
  } catch (e) {
    return false;
  }
}
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validateEntityId(value, label) {
  const id = String(value || '');
  if (!ENTITY_ID_RE.test(id)) {
    throw new Error(`Invalid ${label} id`);
  }
  return id;
}
function validateNoteId(noteId) {
  return validateEntityId(noteId, 'note');
}
function validateTrashId(trashId) {
  return validateEntityId(trashId, 'trash');
}
function validateVersionId(versionId) {
  return validateEntityId(versionId, 'version');
}
function noteFile(slug, noteId) {
  const dir = vaultDir(slug);
  const file = path.resolve(dir, `${validateNoteId(noteId)}.md`);
  const rel = path.relative(dir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid note path');
  }
  return file;
}
function trashNoteFile(slug, trashId) {
  return path.join(trashNoteDir(slug), `${validateTrashId(trashId)}.md`);
}
function validateCanvasId(canvasId) {
  return validateEntityId(canvasId, 'canvas');
}
function canvasFile(slug, canvasId) {
  const dir = canvasDir(slug);
  const file = path.resolve(dir, `${validateCanvasId(canvasId)}.json`);
  const rel = path.relative(dir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid canvas path');
  }
  return file;
}
function trashCanvasFile(slug, trashId) {
  return path.join(trashCanvasDir(slug), `${validateTrashId(trashId)}.json`);
}
function versionNoteFile(slug, noteId, versionId) {
  return path.join(noteVersionsDir(slug, noteId), `${validateVersionId(versionId)}.md`);
}
function cleanString(value, fallback = '', maxLength = MAX_TITLE_LENGTH) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  return (text || fallback).slice(0, maxLength);
}
function normalizeTagName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_NAME_LENGTH);
}
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags.map((tag) => {
    const name = normalizeTagName(typeof tag === 'string' ? tag : tag?.name);
    if (!name || seen.has(name)) return null;
    seen.add(name);
    const hue = Number(tag?.hue);
    return {
      name,
      hue: Number.isFinite(hue) ? Math.max(0, Math.min(360, hue)) : 240,
    };
  }).filter(Boolean);
}
function normalizeWorkflowId(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_WORKFLOW_ID_LENGTH);
}
function normalizeWorkflowStates(states) {
  if (states === null || states === undefined) return null;
  if (!Array.isArray(states)) throw new Error('Invalid workflow states');
  const seen = new Set();
  const next = states.map((state) => {
    const id = normalizeWorkflowId(typeof state === 'string' ? state : state?.id);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const normalized = { id };
    if (typeof state?.color === 'string') normalized.color = state.color.slice(0, 80);
    if (typeof state?.bg === 'string') normalized.bg = state.bg.slice(0, 80);
    if (Object.prototype.hasOwnProperty.call(state || {}, 'next')) {
      normalized.next = state.next ? normalizeWorkflowId(state.next) || null : null;
    }
    return normalized;
  }).filter(Boolean);
  const validIds = new Set(next.map(state => state.id));
  return next.map(state => ({
    ...state,
    next: state.next && validIds.has(state.next) ? state.next : (state.next === undefined ? undefined : null),
  }));
}
function extractWikiTargets(body = '') {
  const targets = [];
  const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;
  let match;
  while ((match = re.exec(String(body || '')))) {
    const title = cleanString(match[1], '', MAX_TITLE_LENGTH);
    if (title) targets.push(title);
  }
  return targets;
}
function sanitizeVaultMetaPatch(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid vault metadata patch');
  const allowed = new Set(['tags', 'lastSelectedId', 'novelistMode', 'workflowStates', 'novelistAiConfig']);
  const unknown = Object.keys(patch).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error('Unsupported vault metadata field: ' + unknown[0]);
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) next.tags = normalizeTags(patch.tags);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastSelectedId')) {
    next.lastSelectedId = patch.lastSelectedId ? validateNoteId(patch.lastSelectedId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'novelistMode')) next.novelistMode = !!patch.novelistMode;
  if (Object.prototype.hasOwnProperty.call(patch, 'workflowStates')) next.workflowStates = normalizeWorkflowStates(patch.workflowStates);
  if (Object.prototype.hasOwnProperty.call(patch, 'novelistAiConfig')) {
    if (patch.novelistAiConfig == null) next.novelistAiConfig = null;
    else if (isPlainObject(patch.novelistAiConfig)) next.novelistAiConfig = patch.novelistAiConfig;
    else throw new Error('Invalid novelist AI config patch');
  }
  return next;
}

function normalizeCanvas(canvas = {}) {
  const now = new Date().toISOString();
  const id = validateCanvasId(canvas.id || `c_${Date.now().toString(36)}`);
  return {
    id,
    title: String(canvas.title || 'Untitled canvas').trim() || 'Untitled canvas',
    createdAt: canvas.createdAt || now,
    modifiedAt: canvas.modifiedAt || now,
    viewport: canvas.viewport && typeof canvas.viewport === 'object'
      ? canvas.viewport
      : { x: 0, y: 0, scale: 1 },
    elements: Array.isArray(canvas.elements) ? canvas.elements : [],
  };
}

function safetyStamp() {
  return new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-+$/g, '');
}

function uniqueSafetyId(prefix, id) {
  const safeId = String(id || 'item').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'item';
  return `${prefix}_${safeId}_${safetyStamp()}_${Math.random().toString(36).slice(2, 7)}`;
}

function fileAgeMs(stat) {
  return Date.now() - new Date(stat.mtime).getTime();
}

async function readNoteFile(file, fallbackId = '') {
  const [text, stat] = await Promise.all([
    fsp.readFile(file, 'utf8'),
    fsp.stat(file),
  ]);
  const { meta: fm, body } = parseFrontMatter(text);
  const noteId = fm.id || fallbackId || path.basename(file, '.md');
  const modifiedAt = stat.mtime.toISOString();
  return {
    id: noteId,
    title: fm.title || 'Untitled',
    date: fm.date || new Date().toISOString(),
    modifiedAt,
    diskModifiedAt: modifiedAt,
    tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
    pinned: !!fm.pinned,
    workflowArchived: !!fm.workflowArchived,
    body,
  };
}

async function cleanupFlatDir(dir, retentionMs = SAFETY_RETENTION_MS) {
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return; }
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const stat = await fsp.stat(full);
      if (stat.isFile() && fileAgeMs(stat) > retentionMs) await fsp.unlink(full);
    } catch {}
  }
}

async function cleanupNoteVersions(slug, noteId) {
  const dir = noteVersionsDir(slug, noteId);
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return; }
  const rows = [];
  for (const file of files.filter(f => f.endsWith('.md'))) {
    const full = path.join(dir, file);
    try {
      const stat = await fsp.stat(full);
      rows.push({ file, full, mtime: stat.mtimeMs, old: fileAgeMs(stat) > SAFETY_RETENTION_MS });
    } catch {}
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  for (const [index, row] of rows.entries()) {
    if (row.old || index >= MAX_NOTE_VERSIONS) {
      try { await fsp.unlink(row.full); } catch {}
    }
  }
}

async function cleanupVaultSafety(slug) {
  await Promise.all([
    cleanupFlatDir(trashNoteDir(slug)),
    cleanupFlatDir(trashCanvasDir(slug)),
  ]);
  const notesRoot = path.join(vaultDir(slug), '.versions', 'notes');
  let noteDirs = [];
  try { noteDirs = await fsp.readdir(notesRoot); } catch { return; }
  for (const noteId of noteDirs) {
    try { await cleanupNoteVersions(slug, noteId); } catch {}
  }
}

function conflictError(currentModifiedAt, expectedModifiedAt) {
  const e = new Error('Note changed on disk after it was loaded.');
  e.code = 'NOTE_CONFLICT';
  e.currentModifiedAt = currentModifiedAt;
  e.expectedModifiedAt = expectedModifiedAt;
  return e;
}

function shouldRejectStaleWrite(stat, expectedModifiedAt) {
  if (!expectedModifiedAt) return false;
  const expected = new Date(expectedModifiedAt).getTime();
  if (!Number.isFinite(expected)) return false;
  return stat.mtimeMs > expected + 5;
}

async function snapshotNoteVersion(slug, noteId, text) {
  if (!text) return null;
  const versionId = `ver_${safetyStamp()}_${Math.random().toString(36).slice(2, 7)}`;
  const file = versionNoteFile(slug, noteId, versionId);
  await atomicWriteFile(file, text, 'utf8');
  await cleanupNoteVersions(slug, noteId);
  return versionId;
}

async function readExistingFile(file) {
  try {
    const [text, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
    return { text, stat };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// ── Vault CRUD ──────────────────────────────────────────────────────────────

async function loadConfig() {
  if (configCache) {
    configCache = await repairConfigVaults(configCache);
    return configCache;
  }
  await secureConfigFile();
  const cfg = await readJsonSafe(CONFIG_FILE, null);
  if (cfg && cfg.vaults && cfg.vaults.length) {
    configCache = await repairConfigVaults(cfg);
    return configCache;
  }
  // First run: seed
  configCache = await firstRunSeed();
  return configCache;
}

async function saveConfig(cfg) {
  await writeJson(CONFIG_FILE, cfg, { mode: CONFIG_FILE_MODE });
  configCache = cfg;
  return cfg;
}

async function firstRunSeed() {
  const { SEED_VAULTS } = require('./seed');
  const cfg = {
    vaults: [],
    activeVaultId: null,
    tweaks: null, // renderer fills with defaults
    aiConfig: null,
  };
  for (const v of SEED_VAULTS) {
    const slug = slugify(v.name);
    const id = `v_${slug}`;
    await ensureDir(vaultDir(slug));
    await writeJson(vaultMetaFile(slug), {
      id, name: v.name, slug,
      tags: v.tags || [],
      lastSelectedId: v.notes[0]?.id || null,
      novelistMode: !!v.novelistMode,
      createdAt: new Date().toISOString(),
    });
    for (const n of v.notes) {
      await atomicWriteFile(
        noteFile(slug, n.id),
        serializeFrontMatter(
          { id: n.id, title: n.title, date: n.date, tags: n.tags || [], pinned: !!n.pinned },
          n.body || ''
        ),
        'utf8'
      );
    }
    cfg.vaults.push({ id, name: v.name, slug, path: vaultDir(slug) });
  }
  cfg.activeVaultId = cfg.vaults[0]?.id || null;
  await saveConfig(cfg);
  return cfg;
}

async function createVaultRecord(cfg, name, options = {}) {
  const cleanName = cleanString(name, 'Untitled vault');
  const slug = slugify(cleanName);
  // De-dupe against both configured vaults and existing folders. A stale folder
  // from a removed/reset config must never be reused for a new vault.
  let finalSlug = slug, i = 2;
  while (cfg.vaults.some(v => v.slug === finalSlug) || fs.existsSync(vaultDir(finalSlug))) {
    finalSlug = `${slug}-${i++}`;
  }
  const id = `v_${finalSlug}_${Date.now().toString(36)}`;
  await ensureDir(vaultDir(finalSlug));
  const isNovelist = isPlainObject(options) && (options.type === 'novelist' || options.novelistMode === true);
  const firstNoteId = `n_${Date.now().toString(36)}`;
  const starterNotes = isNovelist
    ? [
      {
        id: `${firstNoteId}_act`,
        title: 'Act 1',
        tags: ['novel-act'],
        pinned: true,
        body: 'status:: OUTLINE\norder:: 100\npurpose:: \n## Chapters\n- [[Chapter 1]]\n',
      },
      {
        id: `${firstNoteId}_chapter`,
        title: 'Chapter 1',
        tags: ['novel-chapter'],
        pinned: false,
        body: 'status:: OUTLINE\norder:: 110\nact:: [[Act 1]]\n## Scenes\n- [[Scene 1]]\n',
      },
      {
        id: `${firstNoteId}_scene`,
        title: 'Scene 1',
        tags: ['novel-scene'],
        pinned: false,
        body: 'status:: DRAFT\norder:: 111\nact:: [[Act 1]]\nchapter:: [[Chapter 1]]\npov:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.\n',
      },
    ]
    : [
      {
        id: firstNoteId,
        title: `Welcome to ${cleanName}`,
        tags: [],
        pinned: false,
        body: `- This is your new vault\n- Create notes with ⌘N\n- Switch vaults from the sidebar header\n`,
      },
    ];
  await writeJson(vaultMetaFile(finalSlug), {
    id, name: cleanName, slug: finalSlug, tags: [],
    lastSelectedId: starterNotes[0]?.id || firstNoteId,
    novelistMode: isNovelist,
    workflowStates: isPlainObject(options) && Array.isArray(options.workflowStates) ? normalizeWorkflowStates(options.workflowStates) : null,
    createdAt: new Date().toISOString(),
  });
  for (const note of starterNotes) {
    await atomicWriteFile(
      noteFile(finalSlug, note.id),
      serializeFrontMatter(
        { id: note.id, title: note.title, date: new Date().toISOString(), tags: note.tags, pinned: !!note.pinned },
        note.body
      ),
      'utf8'
    );
  }
  const v = { id, name: cleanName, slug: finalSlug, path: vaultDir(finalSlug) };
  cfg.vaults.push(v);
  return v;
}

async function repairConfigVaults(cfg) {
  const originalVaults = Array.isArray(cfg.vaults) ? cfg.vaults : [];
  const validVaults = [];
  for (const v of originalVaults) {
    if (v?.slug && await vaultDirectoryExists(v.slug)) validVaults.push(v);
  }
  let changed = validVaults.length !== originalVaults.length;
  cfg.vaults = validVaults;
  if (!cfg.vaults.length) {
    await createVaultRecord(cfg, 'Personal');
    changed = true;
  }
  if (!cfg.vaults.some(v => v.id === cfg.activeVaultId)) {
    cfg.activeVaultId = cfg.vaults[0]?.id || null;
    changed = true;
  }
  if (changed) await saveConfig(cfg);
  return cfg;
}

async function secureConfigFile() {
  try {
    await fsp.chmod(CONFIG_FILE, CONFIG_FILE_MODE);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

async function listVaults() {
  const cfg = await loadConfig();
  return await vaultsWithMeta(cfg);
}

async function vaultsWithMeta(cfg) {
  return Promise.all(cfg.vaults.map(async v => {
    const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
    return {
      ...v,
      novelistMode: !!meta.novelistMode,
      workflowStates: Array.isArray(meta.workflowStates) ? normalizeWorkflowStates(meta.workflowStates) : null,
      novelistAiConfig: isPlainObject(meta.novelistAiConfig) ? meta.novelistAiConfig : null,
    };
  }));
}

async function createVault(name, options = {}) {
  const cfg = await loadConfig();
  const v = await createVaultRecord(cfg, name, options);
  await saveConfig(cfg);
  return v;
}

async function renameVault(id, name) {
  const cfg = await loadConfig();
  const vaultId = validateEntityId(id, 'vault');
  const v = cfg.vaults.find(v => v.id === vaultId);
  if (!v) throw new Error('Vault not found: ' + vaultId);
  v.name = cleanString(name, 'Untitled vault');
  // keep slug stable on rename — don't move files
  await saveConfig(cfg);
  const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
  meta.name = v.name;
  await writeJson(vaultMetaFile(v.slug), meta);
  return v;
}

async function deleteVault(id) {
  const cfg = await loadConfig();
  const vaultId = validateEntityId(id, 'vault');
  const index = cfg.vaults.findIndex(v => v.id === vaultId);
  if (index < 0) throw new Error('Vault not found: ' + vaultId);
  if (cfg.vaults.length <= 1) {
    throw new Error('Create another vault before deleting this one.');
  }
  const [v] = cfg.vaults.splice(index, 1);
  if (cfg.activeVaultId === vaultId) {
    cfg.activeVaultId = cfg.vaults[Math.min(index, cfg.vaults.length - 1)]?.id || cfg.vaults[0]?.id || null;
  }
  await fsp.rm(vaultDir(v.slug), { recursive: true, force: true });
  await saveConfig(cfg);
  return {
    deletedVaultId: vaultId,
    activeVaultId: cfg.activeVaultId,
    vaults: await vaultsWithMeta(cfg),
  };
}

async function setActiveVault(id) {
  const cfg = await loadConfig();
  const vaultId = validateEntityId(id, 'vault');
  if (!cfg.vaults.some(v => v.id === vaultId)) throw new Error('Vault not found: ' + vaultId);
  cfg.activeVaultId = vaultId;
  await saveConfig(cfg);
}

// ── Note CRUD ───────────────────────────────────────────────────────────────

async function withNoteSaveLock(vaultId, noteId, fn) {
  const key = `${String(vaultId || '')}:${String(noteId || '')}`;
  const previous = noteSaveLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const chain = previous.then(() => current, () => current);
  noteSaveLocks.set(key, chain);
  try {
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
    if (noteSaveLocks.get(key) === chain) noteSaveLocks.delete(key);
  }
}

async function loadVault(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const dir = vaultDir(v.slug);
  if (!await vaultDirectoryExists(v.slug)) throw new Error('Vault folder missing: ' + v.name);
  await cleanupVaultSafety(v.slug);
  const meta = await readJsonSafe(vaultMetaFile(v.slug), { tags: [], lastSelectedId: null });
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.md'));
  const notes = [];
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      notes.push(await readNoteFile(file, path.basename(f, '.md')));
    } catch (e) {
      console.error('Failed to read note', f, e);
    }
  }
  return {
    vaultId: safeVaultId,
    notes,
    tags: normalizeTags(meta.tags || []),
    novelistMode: !!meta.novelistMode,
    workflowStates: Array.isArray(meta.workflowStates) ? normalizeWorkflowStates(meta.workflowStates) : null,
    novelistAiConfig: isPlainObject(meta.novelistAiConfig) ? meta.novelistAiConfig : null,
    lastSelectedId: meta.lastSelectedId || notes[0]?.id || null,
  };
}

async function saveNote(vaultId, note, options = {}) {
  return await withNoteSaveLock(vaultId, note?.id, async () => {
    const cfg = await loadConfig();
    const safeVaultId = validateEntityId(vaultId, 'vault');
    const v = cfg.vaults.find(x => x.id === safeVaultId);
    if (!v) throw new Error('Vault not found: ' + safeVaultId);
    if (!isPlainObject(note)) throw new Error('Invalid note');
    await ensureDir(vaultDir(v.slug));
    const text = serializeFrontMatter(
      {
        id: validateNoteId(note.id),
        title: cleanString(note.title, 'Untitled'),
        date: note.date || new Date().toISOString(),
        tags: Array.isArray(note.tags) ? note.tags.map(normalizeTagName).filter(Boolean) : [],
        pinned: !!note.pinned,
        workflowArchived: !!note.workflowArchived,
      },
      note.body || ''
    );
    const file = noteFile(v.slug, note.id);
    const existing = await readExistingFile(file);
    if (existing?.stat && shouldRejectStaleWrite(existing.stat, options.expectedModifiedAt)) {
      throw conflictError(existing.stat.mtime.toISOString(), options.expectedModifiedAt);
    }
    if (existing?.text && existing.text !== text) {
      await snapshotNoteVersion(v.slug, note.id, existing.text);
    }
    await atomicWriteFile(file, text, 'utf8');
    const stat = await fsp.stat(file);
    const modifiedAt = stat.mtime.toISOString();
    return { ...note, modifiedAt, diskModifiedAt: modifiedAt };
  });
}

async function deleteNote(vaultId, noteId, noteSnapshot = null) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateNoteId(noteId);
  const file = noteFile(v.slug, id);
  const existing = await readExistingFile(file);
  if (!existing && !isPlainObject(noteSnapshot)) return null;
  const snapshotText = isPlainObject(noteSnapshot)
    ? serializeFrontMatter({
      id,
      title: cleanString(noteSnapshot.title, 'Untitled'),
      date: noteSnapshot.date || new Date().toISOString(),
      tags: Array.isArray(noteSnapshot.tags) ? noteSnapshot.tags.map(normalizeTagName).filter(Boolean) : [],
      pinned: !!noteSnapshot.pinned,
      workflowArchived: !!noteSnapshot.workflowArchived,
    }, noteSnapshot.body || '')
    : existing.text;
  const { meta: fm, body } = parseFrontMatter(snapshotText);
  const trashId = uniqueSafetyId('trash', id);
  const deletedAt = new Date().toISOString();
  const trashText = serializeFrontMatter({
    ...fm,
    id,
    originalId: id,
    trashId,
    deletedAt,
    originalTitle: fm.title || 'Untitled',
  }, body);
  await atomicWriteFile(trashNoteFile(v.slug, trashId), trashText, 'utf8');
  if (existing) await fsp.unlink(file);
  await cleanupFlatDir(trashNoteDir(v.slug));
  return { trashId, originalId: id, title: fm.title || 'Untitled', deletedAt };
}

async function listDeletedNotes(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  await cleanupFlatDir(trashNoteDir(v.slug));
  let files = [];
  try { files = (await fsp.readdir(trashNoteDir(v.slug))).filter(f => f.endsWith('.md')); } catch { return []; }
  const items = [];
  for (const f of files) {
    try {
      const file = path.join(trashNoteDir(v.slug), f);
      const [text, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
      const { meta: fm, body } = parseFrontMatter(text);
      const trashId = fm.trashId || path.basename(f, '.md');
      items.push({
        sourceType: 'note',
        trashId,
        originalId: fm.originalId || fm.id || '',
        title: fm.originalTitle || fm.title || 'Untitled',
        deletedAt: fm.deletedAt || stat.mtime.toISOString(),
        date: fm.date || null,
        tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
        size: Buffer.byteLength(body || '', 'utf8'),
      });
    } catch (e) {
      console.error('Failed to read deleted note', f, e);
    }
  }
  return items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
}

async function restoreDeletedNote(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const safeTrashId = validateTrashId(trashId);
  const source = trashNoteFile(v.slug, safeTrashId);
  const text = await fsp.readFile(source, 'utf8');
  const { meta: fm, body } = parseFrontMatter(text);
  let noteId = validateNoteId(fm.originalId || fm.id || `n_${Date.now().toString(36)}`);
  if (await readExistingFile(noteFile(v.slug, noteId))) {
    noteId = validateNoteId(`${noteId}_restored_${Date.now().toString(36)}`);
  }
  const restoredText = serializeFrontMatter({
    id: noteId,
    title: fm.originalTitle || fm.title || 'Untitled',
    date: fm.date || new Date().toISOString(),
    tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
    pinned: !!fm.pinned,
    workflowArchived: !!fm.workflowArchived,
  }, body);
  const target = noteFile(v.slug, noteId);
  await atomicWriteFile(target, restoredText, 'utf8');
  await fsp.unlink(source);
  return await readNoteFile(target, noteId);
}

async function purgeDeletedNote(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  try { await fsp.unlink(trashNoteFile(v.slug, trashId)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { purged: true, trashId };
}

async function listNoteVersions(vaultId, noteId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateNoteId(noteId);
  await cleanupNoteVersions(v.slug, id);
  let files = [];
  try { files = (await fsp.readdir(noteVersionsDir(v.slug, id))).filter(f => f.endsWith('.md')); } catch { return []; }
  const items = [];
  for (const f of files) {
    try {
      const file = path.join(noteVersionsDir(v.slug, id), f);
      const [text, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
      const { meta: fm, body } = parseFrontMatter(text);
      items.push({
        versionId: path.basename(f, '.md'),
        noteId: id,
        title: fm.title || 'Untitled',
        createdAt: stat.mtime.toISOString(),
        date: fm.date || null,
        tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
        size: Buffer.byteLength(body || '', 'utf8'),
      });
    } catch (e) {
      console.error('Failed to read note version', f, e);
    }
  }
  return items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function restoreNoteVersion(vaultId, noteId, versionId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateNoteId(noteId);
  const source = versionNoteFile(v.slug, id, versionId);
  const text = await fsp.readFile(source, 'utf8');
  const current = await readExistingFile(noteFile(v.slug, id));
  if (current?.text && current.text !== text) await snapshotNoteVersion(v.slug, id, current.text);
  const { meta: fm, body } = parseFrontMatter(text);
  const restoredText = serializeFrontMatter({
    id,
    title: fm.title || 'Untitled',
    date: fm.date || new Date().toISOString(),
    tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
    pinned: !!fm.pinned,
    workflowArchived: !!fm.workflowArchived,
  }, body);
  const target = noteFile(v.slug, id);
  await atomicWriteFile(target, restoredText, 'utf8');
  return await readNoteFile(target, id);
}

async function listCanvases(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const dir = canvasDir(v.slug);
  await ensureDir(dir);
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.json'));
  const canvases = [];
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      const [raw, stat] = await Promise.all([
        fsp.readFile(file, 'utf8'),
        fsp.stat(file),
      ]);
      const canvas = normalizeCanvas(JSON.parse(raw));
      canvases.push({
        id: canvas.id,
        title: canvas.title,
        createdAt: canvas.createdAt,
        modifiedAt: canvas.modifiedAt || stat.mtime.toISOString(),
        elementCount: canvas.elements.length,
      });
    } catch (e) {
      console.error('Failed to read canvas', f, e);
    }
  }
  canvases.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
  return canvases;
}

async function getCanvas(vaultId, canvasId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const raw = await fsp.readFile(canvasFile(v.slug, canvasId), 'utf8');
  return normalizeCanvas(JSON.parse(raw));
}

async function saveCanvas(vaultId, canvas) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const next = normalizeCanvas({
    ...canvas,
    modifiedAt: new Date().toISOString(),
  });
  await ensureDir(canvasDir(v.slug));
  await atomicWriteFile(canvasFile(v.slug, next.id), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function deleteCanvas(vaultId, canvasId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const id = validateCanvasId(canvasId);
  const file = canvasFile(v.slug, id);
  let raw = null;
  try { raw = await fsp.readFile(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const trashId = uniqueSafetyId('canvas', id);
  let canvas = {};
  try { canvas = JSON.parse(raw); } catch {}
  const deletedAt = new Date().toISOString();
  await atomicWriteFile(trashCanvasFile(v.slug, trashId), JSON.stringify({
    ...canvas,
    id,
    originalId: id,
    trashId,
    deletedAt,
  }, null, 2), 'utf8');
  await fsp.unlink(file);
  await cleanupFlatDir(trashCanvasDir(v.slug));
  return { trashId, originalId: id, title: canvas.title || 'Untitled canvas', deletedAt };
}

async function listDeletedCanvases(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  await cleanupFlatDir(trashCanvasDir(v.slug));
  let files = [];
  try { files = (await fsp.readdir(trashCanvasDir(v.slug))).filter(f => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const f of files) {
    try {
      const file = path.join(trashCanvasDir(v.slug), f);
      const [raw, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
      const canvas = JSON.parse(raw);
      items.push({
        sourceType: 'canvas',
        trashId: canvas.trashId || path.basename(f, '.json'),
        originalId: canvas.originalId || canvas.id || '',
        title: canvas.title || 'Untitled canvas',
        deletedAt: canvas.deletedAt || stat.mtime.toISOString(),
        size: Buffer.byteLength(raw || '', 'utf8'),
        elementCount: Array.isArray(canvas.elements) ? canvas.elements.length : 0,
      });
    } catch (e) {
      console.error('Failed to read deleted canvas', f, e);
    }
  }
  return items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
}

async function restoreDeletedCanvas(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const safeTrashId = validateTrashId(trashId);
  const source = trashCanvasFile(v.slug, safeTrashId);
  const raw = await fsp.readFile(source, 'utf8');
  const rawCanvas = JSON.parse(raw);
  let canvasId = validateCanvasId(rawCanvas.originalId || rawCanvas.id);
  if (await readExistingFile(canvasFile(v.slug, canvasId))) {
    canvasId = validateCanvasId(`${canvasId}_restored_${Date.now().toString(36)}`);
  }
  const restored = normalizeCanvas({
    ...rawCanvas,
    id: canvasId,
    modifiedAt: new Date().toISOString(),
  });
  delete restored.originalId;
  delete restored.trashId;
  delete restored.deletedAt;
  await ensureDir(canvasDir(v.slug));
  await atomicWriteFile(canvasFile(v.slug, restored.id), JSON.stringify(restored, null, 2), 'utf8');
  await fsp.unlink(source);
  return restored;
}

async function purgeDeletedCanvas(vaultId, trashId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  try { await fsp.unlink(trashCanvasFile(v.slug, trashId)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { purged: true, trashId };
}

async function saveVaultMeta(vaultId, patch) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const cur = await readJsonSafe(vaultMetaFile(v.slug), {});
  const next = { ...cur, ...sanitizeVaultMetaPatch(patch) };
  await writeJson(vaultMetaFile(v.slug), next);
  return next;
}

async function exportBackup(options = {}) {
  const cfg = await loadConfig();
  const selected = options?.vaultId
    ? cfg.vaults.filter(v => v.id === validateEntityId(options.vaultId, 'vault'))
    : cfg.vaults;
  const vaults = [];
  for (const v of selected) {
    const loaded = await loadVault(v.id);
    const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
    const canvasSummaries = await listCanvases(v.id);
    const canvases = [];
    for (const canvas of canvasSummaries) {
      try { canvases.push(await getCanvas(v.id, canvas.id)); } catch (e) {}
    }
    vaults.push({
      id: v.id,
      name: v.name,
      slug: v.slug,
      meta: {
        tags: loaded.tags || [],
        lastSelectedId: loaded.lastSelectedId || null,
        novelistMode: !!loaded.novelistMode,
        workflowStates: loaded.workflowStates || null,
        novelistAiConfig: loaded.novelistAiConfig || null,
        createdAt: meta.createdAt || null,
      },
      notes: loaded.notes || [],
      canvases,
    });
  }
  return {
    format: BACKUP_FORMAT,
    app: APP_DIR_NAME,
    exportedAt: new Date().toISOString(),
    activeVaultId: cfg.activeVaultId || null,
    vaults,
  };
}

async function importBackup(payload, options = {}) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!isPlainObject(data) || data.format !== BACKUP_FORMAT || !Array.isArray(data.vaults)) {
    throw new Error('Unsupported backup file');
  }
  const cfg = await loadConfig();
  const imported = [];
  for (const source of data.vaults) {
    if (!isPlainObject(source)) continue;
    const sourceName = cleanString(source.name, 'Restored vault');
    const name = options.keepNames === false ? `${sourceName} Restored` : sourceName;
    const v = await createVaultRecord(cfg, name, {
      novelistMode: !!source.meta?.novelistMode,
      workflowStates: source.meta?.workflowStates || null,
    });
    await saveConfig(cfg);
    const dir = vaultDir(v.slug);
    let files = [];
    try { files = (await fsp.readdir(dir)).filter(f => f.endsWith('.md')); } catch {}
    await Promise.all(files.map(file => fsp.unlink(path.join(dir, file)).catch(() => {})));
    await writeJson(vaultMetaFile(v.slug), {
      id: v.id,
      name: v.name,
      slug: v.slug,
      tags: normalizeTags(source.meta?.tags || []),
      lastSelectedId: source.meta?.lastSelectedId || source.notes?.[0]?.id || null,
      novelistMode: !!source.meta?.novelistMode,
      workflowStates: Array.isArray(source.meta?.workflowStates) ? normalizeWorkflowStates(source.meta.workflowStates) : null,
      novelistAiConfig: isPlainObject(source.meta?.novelistAiConfig) ? source.meta.novelistAiConfig : null,
      createdAt: source.meta?.createdAt || new Date().toISOString(),
      restoredAt: new Date().toISOString(),
    });
    for (const note of Array.isArray(source.notes) ? source.notes : []) {
      if (!isPlainObject(note)) continue;
      await saveNote(v.id, {
        id: validateNoteId(note.id || `n_${Date.now().toString(36)}`),
        title: cleanString(note.title, 'Untitled'),
        date: note.date || new Date().toISOString(),
        tags: Array.isArray(note.tags) ? note.tags : [],
        pinned: !!note.pinned,
        workflowArchived: !!note.workflowArchived,
        body: note.body || '',
      });
    }
    for (const canvas of Array.isArray(source.canvases) ? source.canvases : []) {
      if (!isPlainObject(canvas)) continue;
      await saveCanvas(v.id, canvas);
    }
    imported.push(v);
  }
  if (imported.length && options.activate !== false) cfg.activeVaultId = imported[0].id;
  await saveConfig(cfg);
  return { importedVaults: imported, activeVaultId: cfg.activeVaultId, vaults: await vaultsWithMeta(cfg) };
}

async function vaultHealth(vaultId) {
  const loaded = await loadVault(vaultId);
  const notes = loaded.notes || [];
  const canvases = await listCanvases(vaultId);
  const titleToIds = new Map();
  for (const note of notes) {
    const key = String(note.title || '').trim().toLowerCase();
    if (!key) continue;
    if (!titleToIds.has(key)) titleToIds.set(key, []);
    titleToIds.get(key).push(note.id);
  }
  const outgoing = new Map();
  const incoming = new Map(notes.map(note => [note.id, 0]));
  const brokenLinks = [];
  for (const note of notes) {
    const targets = extractWikiTargets(note.body || '');
    outgoing.set(note.id, targets.length);
    for (const target of targets) {
      const ids = titleToIds.get(target.toLowerCase());
      if (!ids?.length) {
        brokenLinks.push({ noteId: note.id, noteTitle: note.title, target });
      } else {
        ids.forEach(id => incoming.set(id, (incoming.get(id) || 0) + 1));
      }
    }
  }
  const orphanNotes = notes
    .filter(note => !(outgoing.get(note.id) || 0) && !(incoming.get(note.id) || 0))
    .map(note => ({ id: note.id, title: note.title }));
  const wordCount = notes.reduce((sum, note) => sum + `${note.title || ''} ${note.body || ''}`.trim().split(/\s+/).filter(Boolean).length, 0);
  return {
    noteCount: notes.length,
    tagCount: loaded.tags?.length || 0,
    canvasCount: canvases.length,
    wordCount,
    brokenLinks,
    orphanNotes,
    indexStatus: 'ready',
    checkedAt: new Date().toISOString(),
  };
}

// ── Prefs ───────────────────────────────────────────────────────────────────

async function getPrefs() {
  const cfg = await loadConfig();
  return {
    activeVaultId: cfg.activeVaultId,
    tweaks: cfg.tweaks || null,
    aiConfig: cfg.aiConfig || null,
  };
}

async function setPrefs(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid preferences patch');
  const allowed = new Set(['activeVaultId', 'tweaks', 'aiConfig']);
  const unknown = Object.keys(patch).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error('Unsupported preferences field: ' + unknown[0]);
  const cfg = await loadConfig();
  if (patch.tweaks) {
    if (!isPlainObject(patch.tweaks)) throw new Error('Invalid tweaks patch');
    cfg.tweaks = { ...(cfg.tweaks || {}), ...patch.tweaks };
  }
  if (patch.aiConfig) {
    if (!isPlainObject(patch.aiConfig)) throw new Error('Invalid AI config patch');
    cfg.aiConfig = { ...(cfg.aiConfig || {}), ...patch.aiConfig };
  }
  if (patch.activeVaultId) {
    const activeVaultId = validateEntityId(patch.activeVaultId, 'vault');
    if (!cfg.vaults.some(v => v.id === activeVaultId)) throw new Error('Vault not found: ' + activeVaultId);
    cfg.activeVaultId = activeVaultId;
  }
  await saveConfig(cfg);
}

module.exports = {
  ROOT,
  loadConfig, listVaults, createVault, renameVault, deleteVault, setActiveVault,
  loadVault, saveNote, deleteNote, listDeletedNotes, restoreDeletedNote, purgeDeletedNote,
  listNoteVersions, restoreNoteVersion, saveVaultMeta,
  listCanvases, getCanvas, saveCanvas, deleteCanvas,
  listDeletedCanvases, restoreDeletedCanvas, purgeDeletedCanvas,
  exportBackup, importBackup, vaultHealth,
  getPrefs, setPrefs,
  __test: {
    validateNoteId,
    validateCanvasId,
    validateTrashId,
    validateVersionId,
    normalizeTags,
    normalizeWorkflowStates,
    sanitizeVaultMetaPatch,
    atomicWriteFile,
    cleanupVaultSafety,
    secureConfigFile,
    CONFIG_FILE,
    CONFIG_FILE_MODE,
    clearConfigCache() { configCache = null; },
  },
};
