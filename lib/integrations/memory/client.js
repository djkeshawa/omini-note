// Client for a local llm-memory server (https://github.com/djkeshawa/llm-memory).
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
// Internal callers (the note→memory index that backs link sync and the
// connected panel) need to see every remembered memory, not just the first
// import page. The server accepts large limits and has no cursor, so we request
// a high ceiling in one shot and flag truncation above it.
const MAX_LIST_LIMIT = 5000;
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

async function listMemories(config, { limit, layer, maxLimit } = {}) {
  const cap = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(Number(maxLimit)) || MAX_IMPORT_LIMIT));
  const rows = await request(config, 'GET', '/memories', {
    params: {
      repo_id: config.repoId || undefined,
      layer: layer || undefined,
      limit: Math.max(1, Math.min(cap, Math.trunc(Number(limit)) || cap)),
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
    // Provenance metadata is what lets VispNote map a memory back to the note
    // it came from (metadata.vispnote_note_id), which powers link-graph sync.
    metadata: memory.metadata && typeof memory.metadata === 'object' && !Array.isArray(memory.metadata) ? memory.metadata : {},
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
async function rememberNote(config, note, { vaultId, vaultName } = {}) {
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
      ...(vaultId ? { vispnote_vault_id: String(vaultId).slice(0, 120) } : {}),
      ...(vaultName ? { vispnote_vault: String(vaultName).slice(0, 120) } : {}),
    },
    source: 'vispnote',
  });
}

// ── Graph & server-side intelligence ─────────────────────────────────────────
// The llm-memory server is more than a vector store: it keeps a Neo4j graph of
// typed relationships between memories and can answer questions server-side.
// These helpers expose that surface so VispNote can ground Ask AI in connected
// context (graph traversal, not just top-k) and mirror its own [[wiki-link]]
// structure into the memory graph.

const MAX_GRAPH_DEPTH = 4;
const MAX_GRAPH_HOPS = 6;
const MAX_GRAPH_LIMIT = 50;
const MAX_TOKEN_BUDGET = 8000;
const MAX_RELATIONSHIP_BATCH = 500;
// Server-side /ai/ask runs an LLM, so it needs a much longer ceiling than the
// plain data calls that share REQUEST_TIMEOUT_MS.
const ASK_TIMEOUT_MS = 45000;
const MEMORY_ID_REF_RE = /^[A-Za-z0-9_-]{1,120}$/;

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanMemoryId(value) {
  const id = String(value || '').replace(/\0/g, '').trim().slice(0, 120);
  if (!id) throw new Error('Memory id is empty');
  if (!MEMORY_ID_REF_RE.test(id)) throw new Error('Invalid memory id');
  return id;
}

// The server types relationship_filter as a single string (anyOf string|null),
// not a list — an array payload is a hard 422. Accept a string or a legacy
// array (first element) and normalize to one relationship type.
function cleanRelationshipFilter(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === '') return undefined;
  return normalizeRelationshipType(raw, '') || undefined;
}

function normalizeRelationshipType(value, fallback = 'RELATED_TO') {
  const rel = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return rel || fallback;
}

function publicCitation(citation = {}) {
  return {
    memoryId: String(citation.memory_id || citation.id || ''),
    snippet: String(citation.snippet || citation.content || ''),
    layer: String(citation.layer || ''),
    category: String(citation.category || ''),
    repoId: citation.repo_id ? String(citation.repo_id) : '',
    relevanceScore: citation.relevance_score != null
      ? Number(citation.relevance_score)
      : (citation.score != null ? Number(citation.score) : null),
  };
}

function publicGraphNode(node = {}) {
  return {
    id: String(node.id || ''),
    content: String(node.content || ''),
    layer: String(node.layer || ''),
    category: String(node.category || ''),
    importance: Number(node.importance) || 0,
    repoId: node.repo_id ? String(node.repo_id) : '',
    relevanceScore: node.relevance_score != null ? Number(node.relevance_score) : null,
    relevanceFactors: node.relevance_factors && typeof node.relevance_factors === 'object'
      ? node.relevance_factors : null,
  };
}

function publicGraphEdge(edge = {}) {
  return {
    sourceId: String(edge.source_id || edge.source || ''),
    targetId: String(edge.target_id || edge.target || ''),
    relationship: String(edge.relationship || edge.label || ''),
    strength: edge.strength != null
      ? Number(edge.strength)
      : (edge.value != null ? Number(edge.value) : null),
  };
}

// Shared shape for every /graph-recall/* response: seed + traversed memories,
// the edges between them, and the server's plain-language explanation.
function publicGraphRecall(res = {}) {
  return {
    mode: String(res.mode || ''),
    query: String(res.query || ''),
    nodes: Array.isArray(res.nodes) ? res.nodes.map(publicGraphNode) : [],
    edges: Array.isArray(res.edges) ? res.edges.map(publicGraphEdge) : [],
    explanation: String(res.explanation || ''),
    omitted: res.omitted != null ? res.omitted : null,
    limits: res.limits && typeof res.limits === 'object' ? res.limits : null,
  };
}

function publicRelationship(rel = {}) {
  const rawEvidence = rel.evidence && typeof rel.evidence === 'object' && !Array.isArray(rel.evidence) ? rel.evidence : {};
  return {
    id: String(rel.id || ''),
    sourceId: String(rel.source_id || ''),
    targetId: String(rel.target_id || ''),
    relationship: String(rel.relationship || ''),
    strength: rel.strength != null ? Number(rel.strength) : null,
    evidence: {
      source: String(rawEvidence.source || ''),
      reason: String(rawEvidence.reason || ''),
      createdBy: String(rawEvidence.created_by || rawEvidence.createdBy || ''),
    },
  };
}

// Answer a question purely from remembered context (server-side RAG with
// citations). Distinct from Ask AI over notes — this reaches cross-project and
// agent memory the vault never held.
async function askMemory(config, { query, limit, layers, category, requireCitations } = {}) {
  const cleanQuery = String(query || '').replace(/\0/g, '').trim().slice(0, MAX_QUERY_CHARS);
  if (!cleanQuery) throw new Error('Ask memory query is empty');
  const res = await request(config, 'POST', '/ai/ask', {
    timeoutMs: ASK_TIMEOUT_MS,
    body: {
      query: cleanQuery,
      limit: clampInt(limit, 1, MAX_RECALL_LIMIT, 5),
      require_citations: requireCitations !== false,
      ...(config.repoId ? { repo_id: config.repoId } : {}),
      ...(Array.isArray(layers) && layers.length
        ? { layers: layers.map(l => String(l).slice(0, 40)).filter(Boolean).slice(0, 6) } : {}),
      ...(category ? { category: String(category).slice(0, 60) } : {}),
    },
  });
  return {
    answer: String(res?.answer || ''),
    mode: String(res?.mode || ''),
    citations: Array.isArray(res?.citations) ? res.citations.map(publicCitation) : [],
    // provider_status is a string enum: 'not_configured' | 'available' | 'failed'.
    providerStatus: typeof res?.provider_status === 'string' ? res.provider_status : null,
  };
}

// Graph-aware recall: seeds on the query, then walks typed relationships up to
// `depth`, returning connected context ordered by a blended relevance score.
async function graphTrace(config, { query, depth, limit, tokenBudget, relationshipFilter } = {}) {
  const cleanQuery = String(query || '').replace(/\0/g, '').trim().slice(0, MAX_QUERY_CHARS);
  if (!cleanQuery) throw new Error('Graph trace query is empty');
  const res = await request(config, 'POST', '/graph-recall/trace', {
    body: {
      query: cleanQuery,
      depth: clampInt(depth, 1, MAX_GRAPH_DEPTH, 2),
      limit: clampInt(limit, 1, MAX_GRAPH_LIMIT, 5),
      token_budget: clampInt(tokenBudget, 256, MAX_TOKEN_BUDGET, 2000),
      ...(config.repoId ? { repo_id: config.repoId } : {}),
      ...(cleanRelationshipFilter(relationshipFilter) ? { relationship_filter: cleanRelationshipFilter(relationshipFilter) } : {}),
    },
  });
  return publicGraphRecall(res);
}

// Neighbors of a specific memory in the graph — the "connected memories" panel.
async function graphNeighbors(config, { memoryId, depth, limit, tokenBudget, relationshipFilter } = {}) {
  const res = await request(config, 'POST', '/graph-recall/neighbors', {
    body: {
      memory_id: cleanMemoryId(memoryId),
      depth: clampInt(depth, 1, MAX_GRAPH_DEPTH, 1),
      limit: clampInt(limit, 1, MAX_GRAPH_LIMIT, 25),
      token_budget: clampInt(tokenBudget, 256, MAX_TOKEN_BUDGET, 2000),
      ...(config.repoId ? { repo_id: config.repoId } : {}),
      ...(cleanRelationshipFilter(relationshipFilter) ? { relationship_filter: cleanRelationshipFilter(relationshipFilter) } : {}),
    },
  });
  return publicGraphRecall(res);
}

// The chain of relationships connecting two memories — "how are these related?"
async function graphPath(config, { sourceId, targetId, maxHops, tokenBudget } = {}) {
  const res = await request(config, 'POST', '/graph-recall/path', {
    body: {
      source_id: cleanMemoryId(sourceId),
      target_id: cleanMemoryId(targetId),
      max_hops: clampInt(maxHops, 1, MAX_GRAPH_HOPS, 4),
      token_budget: clampInt(tokenBudget, 256, MAX_TOKEN_BUDGET, 2000),
      ...(config.repoId ? { repo_id: config.repoId } : {}),
    },
  });
  return publicGraphRecall(res);
}

// Explains, via the graph, why a memory is relevant to a query.
async function whyRelevant(config, { query, memoryId, depth, limit, tokenBudget } = {}) {
  const cleanQuery = String(query || '').replace(/\0/g, '').trim().slice(0, MAX_QUERY_CHARS);
  if (!cleanQuery) throw new Error('Why-relevant query is empty');
  const res = await request(config, 'POST', '/graph-recall/why-relevant', {
    body: {
      query: cleanQuery,
      memory_id: cleanMemoryId(memoryId),
      depth: clampInt(depth, 1, MAX_GRAPH_DEPTH, 2),
      limit: clampInt(limit, 1, MAX_GRAPH_LIMIT, 5),
      token_budget: clampInt(tokenBudget, 256, MAX_TOKEN_BUDGET, 2000),
      ...(config.repoId ? { repo_id: config.repoId } : {}),
    },
  });
  return publicGraphRecall(res);
}

// The full persisted graph (nodes + links) for visualization.
async function getGraph(config) {
  const res = await request(config, 'GET', '/graph', { params: { repo_id: config.repoId || undefined } });
  const rawNodes = Array.isArray(res?.nodes) ? res.nodes : [];
  const rawLinks = Array.isArray(res?.links) ? res.links : (Array.isArray(res?.edges) ? res.edges : []);
  return {
    nodes: rawNodes.map(node => ({
      id: String(node.id || ''),
      group: String(node.group || node.layer || ''),
      label: String(node.label || ''),
      fullLabel: String(node.full_label || node.fullLabel || node.content || ''),
      category: node.category ? String(node.category) : '',
      importance: node.importance != null ? Number(node.importance) : null,
    })).filter(node => node.id),
    links: rawLinks.map(link => ({
      source: String(link.source || link.source_id || ''),
      target: String(link.target || link.target_id || ''),
      relationship: String(link.label || link.relationship || ''),
      strength: link.value != null ? Number(link.value) : (link.strength != null ? Number(link.strength) : null),
    })).filter(link => link.source && link.target),
  };
}

async function listRelationships(config) {
  const rows = await request(config, 'GET', '/relationships', { params: { repo_id: config.repoId || undefined } });
  return Array.isArray(rows) ? rows.map(publicRelationship) : [];
}

async function addRelationship(config, { sourceId, targetId, relationship, strength, evidence } = {}) {
  const source = cleanMemoryId(sourceId);
  const target = cleanMemoryId(targetId);
  if (source === target) throw new Error('Cannot relate a memory to itself');
  const strengthNum = Number(strength);
  const body = {
    source_id: source,
    target_id: target,
    relationship: normalizeRelationshipType(relationship, 'RELATED_TO'),
    strength: Number.isFinite(strengthNum) ? Math.max(0, Math.min(1, strengthNum)) : 0.9,
  };
  if (evidence && typeof evidence === 'object') body.evidence = evidence;
  return request(config, 'POST', '/relationships', { body });
}

// Mirrors VispNote's note-link structure into the memory graph as typed edges.
// `edges` is a resolved list of { sourceMemoryId, targetMemoryId, relationship?,
// strength?, evidence? }; the caller (main.js) does the note→memory mapping.
// Existing VispNote-managed edges are re-posted so deterministic relationship
// ids update their weights. Unmanaged edges are never overwritten.
async function syncNoteLinks(config, edges, options = {}) {
  const relationship = normalizeRelationshipType(options.relationship, 'REFERENCES');
  const existing = new Map();
  let relationshipListUnavailable = false;
  try {
    for (const rel of await listRelationships(config)) {
      existing.set(`${rel.sourceId}|${rel.targetId}|${rel.relationship}`, rel);
    }
  } catch { relationshipListUnavailable = true; }

  const seen = new Set();
  const desired = [];
  for (const edge of Array.isArray(edges) ? edges : []) {
    let source;
    let target;
    try { source = cleanMemoryId(edge.sourceMemoryId); target = cleanMemoryId(edge.targetMemoryId); }
    catch { continue; }
    if (source === target) continue;
    const rel = normalizeRelationshipType(edge.relationship, relationship);
    const key = `${source}|${target}|${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    desired.push({ key, source, target, rel, strength: edge.strength, evidence: edge.evidence });
  }

  const desiredKeys = new Set(desired.map(edge => edge.key));
  const staleManaged = [...existing.entries()].filter(([key, rel]) => (
    rel.relationship === relationship && rel.evidence?.source === 'vispnote' && !desiredKeys.has(key)
  )).length;
  let unmanagedConflicts = 0;
  const eligible = [];
  for (const edge of desired) {
    const current = existing.get(edge.key);
    if (current && current.evidence?.source !== 'vispnote') {
      unmanagedConflicts++;
      continue;
    }
    eligible.push({ ...edge, action: current ? 'update' : 'create' });
  }
  const planned = eligible.slice(0, MAX_RELATIONSHIP_BATCH);
  const result = {
    total: planned.length,
    eligible: eligible.length,
    created: 0,
    updated: 0,
    failed: 0,
    skipped: Math.max(0, (Array.isArray(edges) ? edges.length : 0) - desired.length) + unmanagedConflicts,
    remaining: Math.max(0, eligible.length - planned.length),
    batchLimited: eligible.length > planned.length,
    staleManaged,
    unmanagedConflicts,
    relationshipListUnavailable,
    errors: [],
  };
  let nextEdge = 0;
  const workerCount = Math.min(6, planned.length || 1);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextEdge < planned.length) {
      const edge = planned[nextEdge++];
      try {
        await addRelationship(config, {
          sourceId: edge.source,
          targetId: edge.target,
          relationship: edge.rel,
          strength: edge.strength,
          evidence: {
            ...(edge.evidence || {}),
            source: 'vispnote',
            reason: edge.evidence?.reason || 'Mirrors a VispNote [[wiki-link]] between notes.',
          },
        });
        if (edge.action === 'update') result.updated++;
        else result.created++;
      } catch (err) {
        result.failed++;
        if (result.errors.length < 10) result.errors.push({ sourceId: edge.source, targetId: edge.target, error: err.message || String(err) });
      }
    }
  }));
  return result;
}

async function memoryIntelligence(config, { limit } = {}) {
  return request(config, 'GET', '/reports/memory-intelligence', {
    params: {
      repo_id: config.repoId || undefined,
      limit: limit != null ? clampInt(limit, 1, 100, 20) : undefined,
    },
  });
}

async function duplicates(config, { layer, category, limit } = {}) {
  return request(config, 'GET', '/quality/duplicates', {
    params: {
      repo_id: config.repoId || undefined,
      layer: layer || undefined,
      category: category || undefined,
      limit: limit != null ? clampInt(limit, 1, 100, 20) : undefined,
    },
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
  askMemory,
  graphTrace,
  graphNeighbors,
  graphPath,
  whyRelevant,
  getGraph,
  listRelationships,
  addRelationship,
  syncNoteLinks,
  memoryIntelligence,
  duplicates,
  __test: {
    memoryNoteId, memoryNoteTitle, memoryToNote, publicMemory, repoIdFromName,
    publicGraphRecall, publicCitation, publicRelationship, normalizeRelationshipType, clampInt,
  },
};
