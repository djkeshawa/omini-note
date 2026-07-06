// Bridge to a local llm-memory server (https://github.com/djkeshawa/llm-memory).
// Memories become editable markdown notes with provenance properties, and
// notes can be distilled back into memories. The server URL is pinned to
// localhost so AI tools and synced settings cannot redirect it, matching the
// Zotero connector's trust posture.

const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8000';
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAX_QUERY_CHARS = 300;
const MAX_CONTENT_CHARS = 16000;
const MAX_IMPORT_LIMIT = 200;
const MAX_RECALL_LIMIT = 25;
const MEMORY_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

function normalizeMemoryConfig(raw = {}) {
  const serverUrl = String(raw.serverUrl || DEFAULT_SERVER_URL).trim() || DEFAULT_SERVER_URL;
  let parsed;
  try {
    parsed = new URL(serverUrl);
  } catch (e) {
    throw new Error('Invalid llm-memory server URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('llm-memory server URL must be http(s)');
  }
  if (!LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    throw new Error('llm-memory server must run on localhost');
  }
  return {
    baseUrl: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`,
    repoId: String(raw.repoId || '').replace(/\0/g, '').trim().slice(0, 120),
    apiKey: String(raw.apiKey || '').replace(/\0/g, '').trim().slice(0, 300),
  };
}

function timeoutSignal(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function request(config, method, path, { params = {}, body = null, timeoutMs } = {}) {
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const timeout = timeoutSignal(timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (config.apiKey) headers['X-API-KEY'] = config.apiKey;
    if (body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(url.href, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const error = new Error(text.trim().slice(0, 300) || `llm-memory server returned ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return text.trim() ? JSON.parse(text) : null;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('llm-memory server timed out');
    if (e?.status) throw e;
    throw new Error(`llm-memory server is not reachable at ${config.baseUrl}`);
  } finally {
    timeout.clear();
  }
}

async function status(config) {
  try {
    await request(config, 'GET', '/healthz', { timeoutMs: 4000 });
    return { reachable: true };
  } catch (e) {
    return { reachable: false, error: e.message || String(e) };
  }
}

async function recall(config, { query, limit } = {}) {
  const cleanQuery = String(query || '').replace(/\0/g, '').trim().slice(0, MAX_QUERY_CHARS);
  if (!cleanQuery) throw new Error('Memory recall query is empty');
  const rows = await request(config, 'POST', '/recall', {
    body: {
      query: cleanQuery,
      limit: Math.max(1, Math.min(MAX_RECALL_LIMIT, Math.trunc(Number(limit) || 8))),
      ...(config.repoId ? { repo_id: config.repoId } : {}),
    },
  });
  return Array.isArray(rows) ? rows.map(publicMemory) : [];
}

async function listMemories(config, { limit, layer } = {}) {
  const rows = await request(config, 'GET', '/memories', {
    params: {
      repo_id: config.repoId || undefined,
      layer: layer || undefined,
      limit: Math.max(1, Math.min(MAX_IMPORT_LIMIT, Math.trunc(Number(limit) || MAX_IMPORT_LIMIT))),
    },
  });
  return Array.isArray(rows) ? rows.map(publicMemory) : [];
}

async function createMemory(config, { content, category, tags, metadata, importance, source } = {}) {
  const cleanContent = String(content || '').replace(/\0/g, '').trim().slice(0, MAX_CONTENT_CHARS);
  if (!cleanContent) throw new Error('Memory content is empty');
  const created = await request(config, 'POST', '/memories', {
    body: {
      content: cleanContent,
      layer: 'episodic',
      category: String(category || 'note').slice(0, 60),
      importance: Math.max(0, Math.min(1, Number(importance) || 0.5)),
      ...(config.repoId ? { repo_id: config.repoId } : {}),
      tags: Array.isArray(tags) ? tags.map(t => String(t).slice(0, 60)).filter(Boolean).slice(0, 12) : [],
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      source: String(source || 'vispnote').slice(0, 60),
    },
  });
  return publicMemory(created || {});
}

// Registers a project on the server if it is not already there. The server
// answers 409 for an existing project, which counts as success here.
// (GET /repos/{id} is avoided: some server versions 500 on existing repos.)
async function ensureRepo(config, { repoId, name } = {}) {
  const id = String(repoId || '').replace(/\0/g, '').trim().slice(0, 120);
  if (!id) throw new Error('Project id is empty');
  try {
    await request(config, 'POST', '/repos', { body: { id, name: String(name || id).replace(/\0/g, '').trim().slice(0, 200) || id } });
    return { repoId: id, created: true };
  } catch (e) {
    if (e.status === 409) return { repoId: id, created: false };
    throw e;
  }
}

function repoIdFromName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function publicMemory(memory = {}) {
  return {
    id: String(memory.id || ''),
    repoId: memory.repo_id ? String(memory.repo_id) : '',
    content: String(memory.content || ''),
    layer: String(memory.layer || ''),
    category: String(memory.category || ''),
    importance: Number(memory.importance) || 0,
    tags: Array.isArray(memory.tags) ? memory.tags.map(t => String(t)) : [],
    createdAt: memory.created_at ? String(memory.created_at) : '',
    similarity: memory.similarity != null ? Number(memory.similarity) : null,
  };
}

// ── Memories ⇄ notes ─────────────────────────────────────────────────────────

function memoryNoteId(memoryId) {
  const clean = String(memoryId || '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 100);
  if (!clean || !MEMORY_ID_RE.test(clean)) throw new Error('Invalid memory id');
  return `mem_${clean}`;
}

function memoryNoteTitle(memory) {
  const firstLine = String(memory.content || '')
    .split('\n')
    .map(line => line.replace(/^[#>\-*\s]+/, '').trim())
    .find(Boolean) || '';
  const base = firstLine.slice(0, 80);
  return base || `Memory ${String(memory.id || '').slice(0, 8)}`;
}

// The note is the human-owned copy: provenance lives in property lines so a
// re-import can recognize it, and the memory text stays editable markdown.
function memoryToNote(memory) {
  const created = memory.createdAt ? memory.createdAt.slice(0, 10) : '';
  const body = [
    'source:: llm-memory',
    `memoryId:: ${memory.id}`,
    memory.layer ? `memoryLayer:: ${memory.layer}` : '',
    memory.category ? `memoryCategory:: ${memory.category}` : '',
    created ? `memoryCreated:: ${created}` : '',
    '',
    String(memory.content || '').trim(),
  ].filter(line => line !== '').join('\n');
  const tags = ['memory', ...memory.tags.map(t => String(t).toLowerCase().replace(/[^a-z0-9_-]+/g, '-')).filter(Boolean)]
    .filter((tag, index, arr) => arr.indexOf(tag) === index)
    .slice(0, 10);
  return {
    id: memoryNoteId(memory.id),
    title: memoryNoteTitle(memory),
    body,
    tags,
    date: memory.createdAt || new Date().toISOString(),
  };
}

// Imports memories as notes. Existing memory notes are never overwritten —
// the note is the human-curated copy once it lands in the vault.
async function importMemoriesToVault({ store, onNoteSaved } = {}, config, vaultId, { limit } = {}) {
  const memories = await listMemories(config, { limit });
  const result = { total: memories.length, imported: 0, skipped: 0, notes: [] };
  for (const memory of memories) {
    if (!memory.id || !String(memory.content || '').trim()) { result.skipped++; continue; }
    let noteId;
    try {
      noteId = memoryNoteId(memory.id);
    } catch (e) {
      result.skipped++;
      continue;
    }
    const existing = await store.getNote(vaultId, noteId);
    if (existing) { result.skipped++; continue; }
    const saved = await store.saveNote(vaultId, memoryToNote(memory));
    if (typeof onNoteSaved === 'function') await onNoteSaved(saved);
    result.imported++;
    result.notes.push(saved);
  }
  return result;
}

// Distills a note into a memory. The note itself is not modified. The target
// project is registered on the server if missing; when the plugin has no
// project id configured, the note's title becomes the project.
async function rememberNote(config, note, { vaultName } = {}) {
  const title = String(note?.title || 'Untitled').trim() || 'Untitled';
  const body = String(note?.body || '').trim();
  const content = `# ${title}\n\n${body}`.slice(0, MAX_CONTENT_CHARS);
  const repoName = config.repoId ? config.repoId : title;
  const repoId = config.repoId || repoIdFromName(title) || 'vispnote';
  await ensureRepo(config, { repoId, name: repoName });
  return createMemory({ ...config, repoId }, {
    content,
    category: 'note',
    tags: [...(Array.isArray(note?.tags) ? note.tags : []), 'vispnote'],
    metadata: {
      vispnote_note_id: String(note?.id || ''),
      ...(vaultName ? { vispnote_vault: String(vaultName).slice(0, 120) } : {}),
    },
    source: 'vispnote',
  });
}

module.exports = {
  DEFAULT_SERVER_URL,
  normalizeMemoryConfig,
  status,
  recall,
  listMemories,
  createMemory,
  ensureRepo,
  importMemoriesToVault,
  rememberNote,
  __test: { memoryNoteId, memoryNoteTitle, memoryToNote, publicMemory, repoIdFromName },
};
