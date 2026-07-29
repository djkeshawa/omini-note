const test = require('node:test');
const assert = require('node:assert/strict');
const usage = require('../lib/integrations/telemetry/featureUsage');

test('feature usage records only allowlisted aggregate counters and repeat days', () => {
  let report = usage.recordFeatureUsage(null, 'capture', 'used', { now: '2026-07-01T10:00:00Z' });
  report = usage.recordFeatureUsage(report, 'capture', 'opened', { now: '2026-07-02T10:00:00Z' });
  assert.deepEqual(report.counters.capture, { opened: 1, used: 1 });
  assert.deepEqual(report.activeDays.capture, ['2026-07-01', '2026-07-02']);
  assert.throws(() => usage.recordFeatureUsage(report, 'note-title-secret', 'used'), /Unsupported/);
  assert.throws(() => usage.recordFeatureUsage(report, 'capture', 'query-text'), /Unsupported/);
});

test('core value counters are precise, content-free, and first note is idempotent', () => {
  let report = usage.recordFeatureUsage(null, 'first_note', 'created', { now: '2026-07-01T10:00:00Z' });
  report = usage.recordFeatureUsage(report, 'first_note', 'created', { now: '2026-07-02T10:00:00Z' });
  report = usage.recordFeatureUsage(report, 'capture', 'completed', { now: '2026-07-02T10:01:00Z' });
  report = usage.recordFeatureUsage(report, 'search', 'result_opened', { now: '2026-07-02T10:02:00Z' });
  report = usage.recordFeatureUsage(report, 'today', 'completed', { now: '2026-07-02T10:03:00Z' });
  assert.deepEqual(report.counters, {
    first_note: { created: 1 },
    capture: { completed: 1 },
    today: { completed: 1 },
    search: { result_opened: 1 },
  });
  assert.equal(JSON.stringify(report).includes('noteId'), false);
  assert.equal(JSON.stringify(report).includes('query'), false);
});

test('feature usage sanitization drops arbitrary content and anonymous summary is aggregate-only', () => {
  const raw = {
    counters: { capture: { used: 3, noteText: 99 }, secret: { used: 50 } },
    activeDays: { capture: ['2026-07-01'], secret: ['2026-07-02'] },
    noteTitle: 'private',
  };
  const clean = usage.sanitizeFeatureUsage(raw);
  assert.deepEqual(clean.counters, { capture: { used: 3 } });
  const summary = usage.anonymousSummary(clean, {
    now: '2026-07-04T00:00:00Z', id: 'monthly-test-id', appVersion: '0.2.0', os: 'win32',
  });
  assert.deepEqual(summary.features.capture, { actions: { used: 3 }, repeatDays: 1 });
  assert.equal(JSON.stringify(summary).includes('private'), false);
  assert.equal(summary.monthId, 'monthly-test-id');
});

test('feature usage reports reject every prohibited content class', () => {
  const secrets = [
    'private note text', 'Secret title', '#private-tag', 'search phrase',
    'prompt contents', 'C:\\Users\\private\\vault', 'vault_private_id',
    'sk-secret-key', 'note.md', 'relationship payload',
  ];
  const raw = {
    noteText: secrets[0], title: secrets[1], tags: [secrets[2]], search: secrets[3],
    prompt: secrets[4], path: secrets[5], vaultId: secrets[6], apiKey: secrets[7],
    filename: secrets[8], relationships: secrets[9],
    counters: { capture: { used: 1, noteText: 100 } },
  };
  const reportText = JSON.stringify(usage.publicReport(raw, { appVersion: '0.2.0' }));
  const summaryText = JSON.stringify(usage.anonymousSummary(raw, {
    now: '2026-07-04T00:00:00Z', id: 'monthly-test-id', appVersion: '0.2.0', os: 'win32',
  }));
  for (const secret of secrets) {
    assert.equal(reportText.includes(secret), false);
    assert.equal(summaryText.includes(secret), false);
  }
});

test('every renderer usage call names a feature and action the main process accepts', () => {
  // The renderer reports usage over IPC and swallows the rejection with a
  // console warning, so a wrong key is invisible in the app and only shows up
  // as a silently missing metric. This is the only thing checking the two
  // lists still agree.
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'src');

  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(entry.name)) files.push(full);
    }
  })(root);

  const calls = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/recordFeatureUsage\(\s*'([^']+)'\s*(?:,\s*'([^']+)')?\s*\)/g)) {
      calls.push({ file: path.relative(root, file), feature: match[1], action: match[2] || 'used' });
    }
  }

  assert.ok(calls.length >= 8, `expected renderer usage call sites, found ${calls.length}`);
  const bad = calls.filter(call => !usage.FEATURE_KEYS.has(call.feature) || !usage.ACTION_KEYS.has(call.action));
  assert.deepEqual(bad, [], `unsupported usage events: ${JSON.stringify(bad)}`);
});
