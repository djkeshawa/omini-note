// Filesystem-backed store for OminiNote vaults.
// Layout:
//   <root>/.config.json                  global config (vaults list, active vault, tweaks)
//   <root>/<slug>/.meta.json             per-vault metadata (name, tags w/ hues, lastSelectedId)
//   <root>/<slug>/<noteId>.md            one markdown file per note, with YAML front-matter

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const APP_DIR_NAME = 'OminiNote';
const LEGACY_APP_DIR_NAME = 'MyNote';
const PRIMARY_ROOT = path.join(os.homedir(), APP_DIR_NAME);
const LEGACY_ROOT = path.join(os.homedir(), LEGACY_APP_DIR_NAME);
const ROOT = fs.existsSync(LEGACY_ROOT) && !fs.existsSync(PRIMARY_ROOT) ? LEGACY_ROOT : PRIMARY_ROOT;
const CONFIG_FILE = path.join(ROOT, '.config.json');

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
function noteFile(slug, noteId) { return path.join(vaultDir(slug), `${noteId}.md`); }

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
  return cfg.vaults;
}

async function createVault(name) {
  const cfg = await loadConfig();
  const slug = slugify(name);
  // de-dupe slug
  let finalSlug = slug, i = 2;
  while (cfg.vaults.some(v => v.slug === finalSlug)) {
    finalSlug = `${slug}-${i++}`;
  }
  const id = `v_${finalSlug}_${Date.now().toString(36)}`;
  await ensureDir(vaultDir(finalSlug));
  const firstNoteId = `n_${Date.now().toString(36)}`;
  await writeJson(vaultMetaFile(finalSlug), {
    id, name, slug: finalSlug, tags: [],
    lastSelectedId: firstNoteId,
    createdAt: new Date().toISOString(),
  });
  await fsp.writeFile(
    noteFile(finalSlug, firstNoteId),
    serializeFrontMatter(
      { id: firstNoteId, title: `Welcome to ${name}`, date: new Date().toISOString(), tags: [], pinned: false },
      `- This is your new vault\n- Create notes with ⌘N\n- Switch vaults from the sidebar header\n`
    ),
    'utf8'
  );
  const v = { id, name, slug: finalSlug, path: vaultDir(finalSlug) };
  cfg.vaults.push(v);
  await saveConfig(cfg);
  return v;
}

async function renameVault(id, name) {
  const cfg = await loadConfig();
  const v = cfg.vaults.find(v => v.id === id);
  if (!v) throw new Error('Vault not found: ' + id);
  v.name = name;
  // keep slug stable on rename — don't move files
  await saveConfig(cfg);
  const meta = await readJsonSafe(vaultMetaFile(v.slug), {});
  meta.name = name;
  await writeJson(vaultMetaFile(v.slug), meta);
  return v;
}

async function setActiveVault(id) {
  const cfg = await loadConfig();
  if (!cfg.vaults.some(v => v.id === id)) throw new Error('Vault not found: ' + id);
  cfg.activeVaultId = id;
  await saveConfig(cfg);
}

// ── Note CRUD ───────────────────────────────────────────────────────────────

async function loadVault(vaultId) {
  const cfg = await loadConfig();
  const v = cfg.vaults.find(x => x.id === vaultId);
  if (!v) throw new Error('Vault not found: ' + vaultId);
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
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        pinned: !!fm.pinned,
        body,
      });
    } catch (e) {
      console.error('Failed to read note', f, e);
    }
  }
  return {
    vaultId,
    notes,
    tags: meta.tags || [],
    lastSelectedId: meta.lastSelectedId || notes[0]?.id || null,
  };
}

async function saveNote(vaultId, note) {
  const cfg = await loadConfig();
  const v = cfg.vaults.find(x => x.id === vaultId);
  if (!v) throw new Error('Vault not found: ' + vaultId);
  await ensureDir(vaultDir(v.slug));
  const text = serializeFrontMatter(
    {
      id: note.id,
      title: note.title || 'Untitled',
      date: note.date || new Date().toISOString(),
      tags: Array.isArray(note.tags) ? note.tags : [],
      pinned: !!note.pinned,
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
  const v = cfg.vaults.find(x => x.id === vaultId);
  if (!v) throw new Error('Vault not found: ' + vaultId);
  try { await fsp.unlink(noteFile(v.slug, noteId)); } catch (e) { /* ignore */ }
}

async function saveVaultMeta(vaultId, patch) {
  const cfg = await loadConfig();
  const v = cfg.vaults.find(x => x.id === vaultId);
  if (!v) throw new Error('Vault not found: ' + vaultId);
  const cur = await readJsonSafe(vaultMetaFile(v.slug), {});
  const next = { ...cur, ...patch };
  await writeJson(vaultMetaFile(v.slug), next);
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
  const cfg = await loadConfig();
  if (patch.tweaks) cfg.tweaks = { ...(cfg.tweaks || {}), ...patch.tweaks };
  if (patch.aiConfig) cfg.aiConfig = { ...(cfg.aiConfig || {}), ...patch.aiConfig };
  if (patch.activeVaultId) cfg.activeVaultId = patch.activeVaultId;
  await saveConfig(cfg);
}

module.exports = {
  ROOT,
  loadConfig, listVaults, createVault, renameVault, setActiveVault,
  loadVault, saveNote, deleteNote, saveVaultMeta,
  getPrefs, setPrefs,
};
