'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const searchModel = require('../src/features/search/searchModel.js');

const NOTE_COUNT = 10000;
const UI_BUDGET_MS = 100;
const NAVIGATION_SEARCH_BUDGET_MS = 1000;

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] || 0;
}

function timed(fn) {
  const start = performance.now();
  const value = fn();
  return { value, milliseconds: performance.now() - start };
}

function notesFixture() {
  return Array.from({ length: NOTE_COUNT }, (_unused, index) => ({
    id: `note_${String(index).padStart(5, '0')}`,
    title: index % 97 === 0 ? `Quarterly launch decision ${index}` : `Knowledge note ${index}`,
    date: new Date(Date.UTC(2025, 0, 1) + index * 60000).toISOString(),
    modifiedAt: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString(),
    tags: index % 10 === 0 ? ['project', 'review'] : ['reference'],
    pinned: index % 251 === 0,
    body: `Portable local-first note ${index}. ${index % 97 === 0 ? 'Quarterly launch decision and follow-up.' : 'General working context.'}`,
  }));
}

function assertBudget(label, value, budget) {
  if (value > budget) throw new Error(`${label} ${value.toFixed(2)} ms exceeded ${budget} ms budget`);
}

async function main() {
  const previousHome = process.env.VISPNOTE_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-10k-benchmark-'));
  const notes = notesFixture();
  let idx;
  try {
    process.env.VISPNOTE_HOME = tempHome;
    const store = require('../lib/store.js');
    await store.loadConfig();
    idx = require('../lib/index.js');
    idx.init();

    const build = timed(() => idx.rescanVault('benchmark_vault', notes));
    const hitIds = notes.filter((_note, index) => index % 97 === 0).slice(0, 100).map(note => note.id);
    const uiSamples = Array.from({ length: 25 }, () => timed(() => searchModel.filterAndSortNotes({
      notes,
      view: 'notes',
      selectedTag: null,
      selectedWorkflow: null,
      workflowData: { noteIdsByState: {} },
      hitIds,
      details: new Map(),
      tweaks: { pinnedFirst: true, sortBy: 'modified' },
    })).milliseconds);
    const searchSamples = Array.from({ length: 25 }, (_unused, index) => timed(() => (
      idx.searchDetailed('benchmark_vault', index % 2 ? 'quarterly launch' : 'working context', 100)
    )).milliseconds);
    const directUiP95 = percentile(uiSamples, 0.95);
    const searchP95 = percentile(searchSamples, 0.95);
    assertBudget('Direct result feedback p95', directUiP95, UI_BUDGET_MS);
    assertBudget('Search p95', searchP95, NAVIGATION_SEARCH_BUDGET_MS);

    process.stdout.write(`${JSON.stringify({
      notes: NOTE_COUNT,
      budgetsMs: { directUiP95: UI_BUDGET_MS, navigationSearchP95: NAVIGATION_SEARCH_BUDGET_MS },
      measuredMs: {
        indexBuild: Number(build.milliseconds.toFixed(2)),
        directUiP95: Number(directUiP95.toFixed(2)),
        searchP95: Number(searchP95.toFixed(2)),
      },
      result: 'pass',
    }, null, 2)}\n`);
  } finally {
    try { idx?.close?.(); } catch {}
    if (previousHome === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previousHome;
    const resolvedTemp = path.resolve(tempHome);
    if (resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
