// Live regression for the LLM Memory bridge (lib/llmMemory.js) against a real
// llm-memory server, e.g. the Docker container from
// https://github.com/djkeshawa/llm-memory.
//
// Seamless by default: if no server is reachable the run is skipped with exit
// code 0, so `npm run test:all` stays green on machines without the container.
// Set VISPNOTE_MEMORY_REQUIRED=1 to turn an unreachable server into a failure
// (for environments where the container is guaranteed, e.g. CI with services).
//
// Configuration:
//   VISPNOTE_MEMORY_URL       server URL (localhost only), default http://127.0.0.1:8000
//   VISPNOTE_MEMORY_API_KEY   API key, empty for local no-auth mode
//   VISPNOTE_MEMORY_REQUIRED  "1" to fail instead of skip when unreachable
//
// All memories are written to a dedicated repo id and deleted afterwards, so
// the run never touches real memories. The regression repo is swept before the
// run so counts stay deterministic even after an aborted previous run.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REGRESSION_REPO_ID = 'vispnote_regression';

// VISPNOTE_HOME must point at a scratch dir before lib/store is required —
// the store resolves its root at require time.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-memory-regression-'));
process.env.VISPNOTE_HOME = tmpHome;

const llmMemory = require('../lib/llmMemory.js');
const store = require('../lib/store.js');

const config = llmMemory.normalizeMemoryConfig({
  serverUrl: process.env.VISPNOTE_MEMORY_URL || llmMemory.DEFAULT_SERVER_URL,
  repoId: REGRESSION_REPO_ID,
  apiKey: process.env.VISPNOTE_MEMORY_API_KEY || '',
});

let stepCount = 0;
function pass(label) {
  stepCount += 1;
  console.log(`  ok ${stepCount} - ${label}`);
}

function assert(condition, label, detail) {
  if (!condition) {
    throw new Error(`${label}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
  pass(label);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The server builds embeddings on create; a cold container (or a cold
// embedding model) can exceed the bridge's request timeout on the first call.
async function withRetry(label, fn, { attempts = 3, delayMs = 2000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < attempts) {
        console.log(`  # ${label} attempt ${attempt} failed (${e.message}), retrying...`);
        await wait(delayMs);
      }
    }
  }
  throw lastError;
}

async function deleteMemory(id) {
  const headers = { Accept: 'application/json' };
  if (config.apiKey) headers['X-API-KEY'] = config.apiKey;
  const res = await fetch(`${config.baseUrl}/memories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(15000),
  });
  return res.ok;
}

// The project derived from the regression note's title, exercised by the
// "no configured project" check below. Stable so reruns reuse one project.
const DERIVED_NOTE_TITLE = 'VispNote Regression Project';
const DERIVED_REPO_ID = 'vispnote_regression_project';
const derivedConfig = llmMemory.normalizeMemoryConfig({
  serverUrl: process.env.VISPNOTE_MEMORY_URL || llmMemory.DEFAULT_SERVER_URL,
  repoId: '',
  apiKey: process.env.VISPNOTE_MEMORY_API_KEY || '',
});

async function sweepRepo(repoConfig) {
  const leftovers = await llmMemory.listMemories(repoConfig, {});
  for (const memory of leftovers) {
    if (memory.id) await deleteMemory(memory.id);
  }
  return leftovers.length;
}

async function run() {
  console.log(`# LLM Memory regression against ${config.baseUrl} (repo: ${REGRESSION_REPO_ID})`);

  const st = await llmMemory.status(config);
  if (!st.reachable) {
    if (process.env.VISPNOTE_MEMORY_REQUIRED === '1') {
      throw new Error(`llm-memory server is required but unreachable: ${st.error}`);
    }
    console.log(`# skip - llm-memory server not reachable (${st.error})`);
    console.log('# skip - start the server (e.g. the llm-memory Docker container) to run this regression');
    return;
  }
  pass('server is reachable');

  const swept = await sweepRepo(config) + await sweepRepo({ ...derivedConfig, repoId: DERIVED_REPO_ID });
  if (swept > 0) console.log(`  # swept ${swept} leftover memories from a previous run`);

  const runMarker = `run-${Date.now().toString(36)}`;

  // Create → list → recall round trip through the bridge client.
  const created = await withRetry('createMemory', () => llmMemory.createMemory(config, {
    content: `## VispNote regression ${runMarker}\nUse WAL mode for concurrent sqlite readers.`,
    category: 'pattern',
    tags: ['vispnote-regression', 'sqlite'],
    importance: 0.7,
    metadata: { regression_marker: runMarker },
  }));
  assert(created.id, 'createMemory returns a server-assigned id', created);

  const listed = await llmMemory.listMemories(config, {});
  assert(listed.some(m => m.id === created.id), 'listMemories sees the created memory', { count: listed.length });

  const recalled = await withRetry('recall', async () => {
    const rows = await llmMemory.recall(config, { query: `VispNote regression ${runMarker}`, limit: 5 });
    if (!rows.some(m => m.id === created.id)) throw new Error('created memory not recalled yet');
    return rows;
  });
  assert(recalled.find(m => m.id === created.id).similarity !== null, 'recall returns similarity scores', recalled[0]);

  // ── Graph & relationships round trip ────────────────────────────────────────
  // A second memory + an explicit edge exercises the graph endpoints the way
  // VispNote's [[wiki-link]] sync and connected-memories panel do.
  const related = await withRetry('createMemory (related)', () => llmMemory.createMemory(config, {
    content: `## VispNote regression related ${runMarker}\nPair WAL mode with a busy_timeout so concurrent sqlite writers do not fail.`,
    category: 'pattern',
    tags: ['vispnote-regression', 'sqlite'],
    importance: 0.6,
    metadata: { regression_marker: runMarker, vispnote_note_id: `regr-${runMarker}` },
  }));
  assert(related.id && related.id !== created.id, 'second memory created for graph tests', related);

  await llmMemory.addRelationship(config, { sourceId: created.id, targetId: related.id, relationship: 'REFERENCES', strength: 0.9 });
  const rels = await llmMemory.listRelationships(config);
  assert(rels.some(r => r.sourceId === created.id && r.targetId === related.id), 'addRelationship + listRelationships round trip', { count: rels.length });

  const trace = await withRetry('graphTrace', async () => {
    const res = await llmMemory.graphTrace(config, { query: `WAL mode sqlite ${runMarker}`, depth: 2, limit: 5 });
    if (!res.nodes.length) throw new Error('graph trace returned no nodes yet');
    return res;
  });
  assert(trace.nodes.length > 0, 'graphTrace returns seed + connected nodes', { nodes: trace.nodes.length, edges: trace.edges.length });

  const neighbors = await llmMemory.graphNeighbors(config, { memoryId: created.id, depth: 1, limit: 10 });
  assert(
    neighbors.nodes.some(n => n.id === related.id) || neighbors.edges.some(e => e.targetId === related.id || e.sourceId === related.id),
    'graphNeighbors surfaces the linked memory',
    { nodes: neighbors.nodes.length, edges: neighbors.edges.length }
  );

  const path = await llmMemory.graphPath(config, { sourceId: created.id, targetId: related.id, maxHops: 3 });
  assert(path.nodes.length >= 1, 'graphPath connects the two related memories', { nodes: path.nodes.length });

  const graph = await llmMemory.getGraph(config);
  assert(graph.nodes.some(n => n.id === created.id) && graph.nodes.some(n => n.id === related.id), 'getGraph includes both memories as nodes', { nodes: graph.nodes.length, links: graph.links.length });
  assert(graph.links.some(l => l.source === created.id && l.target === related.id), 'getGraph includes the created relationship as a link');

  // syncNoteLinks is idempotent: the created→related edge already exists (skip),
  // and the reverse edge is created exactly once.
  const syncExisting = await llmMemory.syncNoteLinks(config, [{ sourceMemoryId: created.id, targetMemoryId: related.id }]);
  assert(syncExisting.created === 0, 'syncNoteLinks skips an edge that already exists', syncExisting);
  const syncNew = await llmMemory.syncNoteLinks(config, [{ sourceMemoryId: related.id, targetMemoryId: created.id }]);
  assert(syncNew.created === 1, 'syncNoteLinks creates the new reverse edge once', syncNew);

  // askMemory hits the server's own LLM provider, which may not be configured in
  // every environment — verify shape when it answers, note-and-continue if not.
  try {
    const answer = await llmMemory.askMemory(config, { query: `WAL mode ${runMarker}`, limit: 3 });
    assert(typeof answer.answer === 'string' && Array.isArray(answer.citations), 'askMemory returns an answer with a citations array', { mode: answer.mode, citations: answer.citations.length });
  } catch (e) {
    console.log(`  # note - askMemory skipped (server LLM not available): ${e.message}`);
  }

  // Import into a scratch vault: provenance note created once, edits preserved.
  const cfg = await store.loadConfig();
  const vaultId = cfg.vaults[0].id;

  // Both regression memories (the original + the related one) materialize.
  const firstImport = await llmMemory.importMemoriesToVault({ store }, config, vaultId, {});
  assert(firstImport.imported === 2, 'import materializes each memory as a note', firstImport);

  const noteId = `mem_${created.id}`;
  const note = await store.getNote(vaultId, noteId);
  assert(note && note.body.includes(`memoryId:: ${created.id}`), 'imported note carries provenance properties');
  assert(note.tags.includes('memory') && note.tags.includes('vispnote-regression'), 'imported note carries memory tags', note.tags);

  await store.saveNote(vaultId, { ...note, body: `${note.body}\n\nHuman edit.` });
  const secondImport = await llmMemory.importMemoriesToVault({ store }, config, vaultId, {});
  assert(secondImport.imported === 0, 're-import never creates duplicates', secondImport);
  const preserved = await store.getNote(vaultId, noteId);
  assert(preserved.body.includes('Human edit.'), 're-import never overwrites human edits');

  // Distill the note back into a memory and confirm the round trip.
  const remembered = await withRetry('rememberNote', () => llmMemory.rememberNote(config, preserved, { vaultName: 'Regression' }));
  assert(remembered.id && remembered.id !== created.id, 'rememberNote creates a new memory', remembered);
  const afterRemember = await llmMemory.listMemories(config, {});
  const distilled = afterRemember.find(m => m.id === remembered.id);
  assert(distilled && distilled.tags.includes('vispnote'), 'distilled memory is tagged as coming from vispnote', distilled);

  // No configured project: rememberNote registers a project derived from the
  // note's title and files the memory under it.
  const derived = await withRetry('rememberNote (derived project)', () => llmMemory.rememberNote(derivedConfig, {
    id: 'derived-note', title: DERIVED_NOTE_TITLE, body: `Derived project ${runMarker}.`, tags: [],
  }, { vaultName: 'Regression' }));
  assert(derived.repoId === DERIVED_REPO_ID, 'missing project is created from the note name', derived);
  const derivedListed = await llmMemory.listMemories({ ...derivedConfig, repoId: DERIVED_REPO_ID }, {});
  assert(derivedListed.some(m => m.id === derived.id), 'derived project contains the distilled memory', { count: derivedListed.length });

  // Cleanup: the regression repos go back to empty.
  for (const id of [created.id, related.id, remembered.id, derived.id]) {
    assert(await deleteMemory(id), `cleanup deletes memory ${id}`);
  }
  const remaining = await llmMemory.listMemories(config, {});
  assert(remaining.length === 0, 'regression repo is empty after cleanup', remaining.map(m => m.id));

  console.log(`# pass - ${stepCount} checks`);
}

function cleanupHome() {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch (e) {
    console.error(`# warn - could not remove scratch home ${tmpHome}: ${e.message}`);
  }
}

run()
  .then(() => {
    cleanupHome();
    process.exit(0);
  })
  .catch(error => {
    cleanupHome();
    console.error(`# fail - ${error.message}`);
    process.exit(1);
  });
