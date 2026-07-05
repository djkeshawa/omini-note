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

async function sweepRegressionRepo() {
  const leftovers = await llmMemory.listMemories(config, {});
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

  const swept = await sweepRegressionRepo();
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

  // Import into a scratch vault: provenance note created once, edits preserved.
  const cfg = await store.loadConfig();
  const vaultId = cfg.vaults[0].id;

  const firstImport = await llmMemory.importMemoriesToVault({ store }, config, vaultId, {});
  assert(firstImport.imported === 1, 'import materializes the memory as a note', firstImport);

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

  // Cleanup: the regression repo goes back to empty.
  for (const id of [created.id, remembered.id]) {
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
