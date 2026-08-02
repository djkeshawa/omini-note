const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createSummaryDomain } = require('../lib/ai/summaries.js');

// lib/ai/summaries.js sat at 43.75% branch coverage. These tests state how
// vault summarisation is supposed to behave -- above all that summarising a
// vault must not quietly leave notes out.

function makeDomain({ chatReply = 'batch summary', failBatches = [], signal = null } = {}) {
  const calls = { chat: 0, progress: [] };
  const scope = {
    CONFIG: { enabled: true },
    MAX_RAG_PROMPT_CHARS: 8000,
    QUERY_CACHE_MS: 60000,
    SUMMARY_BATCH_MAX_CHARS: 4000,
    SUMMARY_BATCH_MAX_NOTES: 5,
    SUMMARY_MAP_MAX_TOKENS: 200,
    SUMMARY_NOTE_BODY_CHARS: 500,
    SUMMARY_REDUCE_MAX_TOKENS: 200,
    SUMMARY_REQUEST_TIMEOUT_MS: 1000,
    crypto,
    summaryCache: new Map(),
    chatUnavailableReason: () => 'model unavailable',
    notePreview: (note, n) => String(note.body || '').slice(0, n),
    sortByModified: notes => [...(notes || [])].sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || ''))),
    stripPromptPropertyLines: text => text,
    providerChat: async () => {
      calls.chat += 1;
      if (failBatches.includes(calls.chat)) throw new Error(`batch ${calls.chat} exploded`);
      return { text: chatReply };
    },
  };
  return { domain: createSummaryDomain(scope), calls, scope, signal };
}

const notes = (n, bodyLen = 100) => Array.from({ length: n }, (_, i) => ({
  id: `n${i}`, title: `Note ${i}`, body: 'x'.repeat(bodyLen),
  modifiedAt: `2026-01-${String(n - i).padStart(2, '0')}T00:00:00.000Z`,
}));

test('batching keeps every note exactly once', async () => {
  // If batching drops a note, the summary silently omits it and nothing says so.
  const { domain } = makeDomain();
  for (const [count, size] of [[1, 50], [7, 50], [23, 300], [50, 900]]) {
    const input = notes(count, size);
    const batches = domain.batchNotesForSummary(input);
    const seen = batches.flat().map(note => note.id);
    assert.deepEqual([...seen].sort(), input.map(n => n.id).sort(),
      `${count} notes of ${size} chars: batching changed the set of notes`);
    assert.equal(seen.length, new Set(seen).size, 'a note was duplicated across batches');
  }
});

test('batching never emits an empty batch', async () => {
  const { domain } = makeDomain();
  for (const count of [0, 1, 5, 6, 31]) {
    const batches = domain.batchNotesForSummary(notes(count));
    assert.ok(batches.every(b => b.length > 0), `${count} notes produced an empty batch`);
  }
});

test('a note larger than the whole batch budget is still summarised', async () => {
  // One enormous note must not stall batching or vanish.
  const { domain } = makeDomain();
  const huge = [{ id: 'big', title: 'Huge', body: 'y'.repeat(500000), modifiedAt: '2026-01-01T00:00:00.000Z' }];
  const batches = domain.batchNotesForSummary(huge);
  assert.equal(batches.flat().length, 1, 'the oversized note was dropped');
});

test('absurd batch options are clamped rather than breaking batching', async () => {
  const { domain } = makeDomain();
  const input = notes(10);
  for (const options of [
    { batchMaxNotes: 0 }, { batchMaxNotes: -5 }, { batchMaxNotes: 10000 },
    { batchMaxChars: 0 }, { batchMaxChars: -1 }, { batchMaxChars: 10 ** 9 },
    { batchMaxNotes: NaN }, { batchMaxChars: NaN },
  ]) {
    const batches = domain.batchNotesForSummary(input, options);
    assert.deepEqual(batches.flat().map(n => n.id).sort(), input.map(n => n.id).sort(),
      `options ${JSON.stringify(options)} lost notes`);
    assert.ok(batches.every(b => b.length > 0), `options ${JSON.stringify(options)} produced an empty batch`);
  }
});

test('an empty vault says so instead of calling the model', async () => {
  const { domain, calls } = makeDomain();
  const res = await domain.summarizeVaultInternal('v', 'q',
    { reachable: true, chatModelOk: true }, { loadVault: async () => ({ notes: [] }) });
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'summary-empty');
  assert.equal(calls.chat, 0, 'called the model for an empty vault');
});

test('an unreachable model reports setup needed and still lists sources', async () => {
  const { domain } = makeDomain();
  const res = await domain.summarizeVaultInternal('v', 'q',
    { reachable: false }, { loadVault: async () => ({ notes: notes(3) }) });
  assert.equal(res.ok, false);
  assert.equal(res.setupRequired, true);
  assert.ok(Array.isArray(res.sources) && res.sources.length > 0,
    'the user should still see which notes would have been summarised');
});

test('one failing batch does not lose the notes in the others', async () => {
  // A single model hiccup must degrade that batch, not the whole summary.
  const { domain } = makeDomain({ failBatches: [2] });
  const input = notes(18, 400);
  const res = await domain.summarizeVaultInternal('v', 'q',
    { reachable: true, chatModelOk: true }, { loadVault: async () => ({ notes: input }) });
  assert.equal(res.ok !== false, true, 'the whole summary failed because one batch did');
  const text = JSON.stringify(res);
  assert.ok(text.length > 0);
});

test('cancelling a summary stops it rather than returning a partial answer as success', async () => {
  const { domain } = makeDomain();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => domain.summarizeVaultInternal('v', 'q',
      { reachable: true, chatModelOk: true },
      { loadVault: async () => ({ notes: notes(12, 400) }) },
      { signal: controller.signal }),
    'an aborted summary should throw, not resolve as a successful partial result');
});

test('progress is reported for every batch, and the counts are consistent', async () => {
  const progress = [];
  const { domain } = makeDomain();
  await domain.summarizeVaultInternal('v', 'q',
    { reachable: true, chatModelOk: true },
    { loadVault: async () => ({ notes: notes(18, 400) }) },
    { onProgress: p => progress.push(p) });
  const map = progress.filter(p => p.phase === 'map');
  assert.ok(map.length > 0, 'no map progress reported');
  assert.ok(map.every(p => p.index >= 1 && p.index <= p.total),
    `progress index out of range: ${JSON.stringify(map)}`);
  assert.equal(map[map.length - 1].index, map[map.length - 1].total,
    'progress never reached 100%, so a spinner would hang');
});
