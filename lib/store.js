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
const ENTITY_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_TITLE_LENGTH = 240;
const MAX_TAG_NAME_LENGTH = 64;
const MAX_WORKFLOW_ID_LENGTH = 18;

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

async function writeJson(file, obj) {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
}

function vaultDir(slug) { return path.join(ROOT, slug); }
function vaultMetaFile(slug) { return path.join(vaultDir(slug), '.meta.json'); }
function canvasDir(slug) { return path.join(vaultDir(slug), '.canvases'); }
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
function noteFile(slug, noteId) {
  const dir = vaultDir(slug);
  const file = path.resolve(dir, `${validateNoteId(noteId)}.md`);
  const rel = path.relative(dir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid note path');
  }
  return file;
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
function sanitizeVaultMetaPatch(patch) {
  if (!isPlainObject(patch)) throw new Error('Invalid vault metadata patch');
  const allowed = new Set(['tags', 'lastSelectedId', 'novelistMode', 'workflowStates']);
  const unknown = Object.keys(patch).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error('Unsupported vault metadata field: ' + unknown[0]);
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) next.tags = normalizeTags(patch.tags);
  if (Object.prototype.hasOwnProperty.call(patch, 'lastSelectedId')) {
    next.lastSelectedId = patch.lastSelectedId ? validateNoteId(patch.lastSelectedId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'novelistMode')) next.novelistMode = !!patch.novelistMode;
  if (Object.prototype.hasOwnProperty.call(patch, 'workflowStates')) next.workflowStates = normalizeWorkflowStates(patch.workflowStates);
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

// ── Vault CRUD ──────────────────────────────────────────────────────────────

async function loadConfig() {
  const cfg = await readJsonSafe(CONFIG_FILE, null);
  if (cfg && cfg.vaults && cfg.vaults.length) return cfg;
  // First run: seed
  return await firstRunSeed();
}

async function saveConfig(cfg) {
  await writeJson(CONFIG_FILE, cfg);
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
      await fsp.writeFile(
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

async function listVaults() {
  const cfg = await loadConfig();
  return Promise.all(cfg.vaults.map(async v => {
    const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
    return { ...v, novelistMode: !!meta.novelistMode, workflowStates: Array.isArray(meta.workflowStates) ? normalizeWorkflowStates(meta.workflowStates) : null };
  }));
}

async function createVault(name, options = {}) {
  const cfg = await loadConfig();
  const cleanName = cleanString(name, 'Untitled vault');
  const slug = slugify(cleanName);
  // de-dupe slug
  let finalSlug = slug, i = 2;
  while (cfg.vaults.some(v => v.slug === finalSlug)) {
    finalSlug = `${slug}-${i++}`;
  }
  const id = `v_${finalSlug}_${Date.now().toString(36)}`;
  await ensureDir(vaultDir(finalSlug));
  const firstNoteId = `n_${Date.now().toString(36)}`;
  await writeJson(vaultMetaFile(finalSlug), {
    id, name: cleanName, slug: finalSlug, tags: [],
    lastSelectedId: firstNoteId,
    novelistMode: isPlainObject(options) && (options.type === 'novelist' || options.novelistMode === true),
    workflowStates: isPlainObject(options) && Array.isArray(options.workflowStates) ? normalizeWorkflowStates(options.workflowStates) : null,
    createdAt: new Date().toISOString(),
  });
  await fsp.writeFile(
    noteFile(finalSlug, firstNoteId),
    serializeFrontMatter(
      { id: firstNoteId, title: `Welcome to ${cleanName}`, date: new Date().toISOString(), tags: [], pinned: false },
      `- This is your new vault\n- Create notes with ⌘N\n- Switch vaults from the sidebar header\n`
    ),
    'utf8'
  );
  const v = { id, name: cleanName, slug: finalSlug, path: vaultDir(finalSlug) };
  cfg.vaults.push(v);
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
    vaults: cfg.vaults,
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

async function loadVault(vaultId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  const meta = await readJsonSafe(vaultMetaFile(v.slug), { tags: [], lastSelectedId: null });
  const dir = vaultDir(v.slug);
  await ensureDir(dir);
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.md'));
  const notes = [];
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      const [text, stat] = await Promise.all([
        fsp.readFile(file, 'utf8'),
        fsp.stat(file),
      ]);
      const { meta: fm, body } = parseFrontMatter(text);
      const noteId = fm.id || path.basename(f, '.md');
      notes.push({
        id: noteId,
        title: fm.title || 'Untitled',
        date: fm.date || new Date().toISOString(),
        modifiedAt: stat.mtime.toISOString(),
        tags: Array.isArray(fm.tags) ? fm.tags.map(normalizeTagName).filter(Boolean) : [],
        pinned: !!fm.pinned,
        workflowArchived: !!fm.workflowArchived,
        body,
      });
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
    lastSelectedId: meta.lastSelectedId || notes[0]?.id || null,
  };
}

async function saveNote(vaultId, note) {
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
  await fsp.writeFile(file, text, 'utf8');
  const stat = await fsp.stat(file);
  return { ...note, modifiedAt: stat.mtime.toISOString() };
}

async function deleteNote(vaultId, noteId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  try { await fsp.unlink(noteFile(v.slug, noteId)); } catch (e) { /* ignore */ }
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
  await fsp.writeFile(canvasFile(v.slug, next.id), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function deleteCanvas(vaultId, canvasId) {
  const cfg = await loadConfig();
  const safeVaultId = validateEntityId(vaultId, 'vault');
  const v = cfg.vaults.find(x => x.id === safeVaultId);
  if (!v) throw new Error('Vault not found: ' + safeVaultId);
  try { await fsp.unlink(canvasFile(v.slug, canvasId)); } catch (e) { /* ignore */ }
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
  loadVault, saveNote, deleteNote, saveVaultMeta,
  listCanvases, getCanvas, saveCanvas, deleteCanvas,
  getPrefs, setPrefs,
  __test: {
    validateNoteId,
    validateCanvasId,
    normalizeTags,
    normalizeWorkflowStates,
    sanitizeVaultMetaPatch,
  },
};
