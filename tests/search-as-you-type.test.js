const test = require('node:test');
const assert = require('node:assert/strict');

const { withIsolatedIndex } = require('./helpers/common.js');

const NOTES = [
  { id: 'n1', title: 'Quarterly negotiation', date: '2026-01-01', tags: ['work'],
    body: 'Vendor negotiation notes for the quarterly review.' },
  { id: 'n2', title: 'Organising the offsite', date: '2026-01-02', tags: ['work'],
    body: 'Organisation and planning for the team offsite.' },
  { id: 'n3', title: 'Running log', date: '2026-01-03', tags: ['personal'],
    body: 'Running and stretching every morning.' },
];

// The index tokenises with the porter stemmer, so "negotiation" is stored under
// the stem "negoti". Queries prefix-match, and a prefix longer than the stem can
// never match it -- so the note you are typing toward disappears mid-word and
// then reappears when you finish the word.
test('a note stays findable through every keystroke of the word you are typing', async () => {
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('v', NOTES);

    const missing = [];
    for (const word of ['negotiation', 'organising', 'running']) {
      const expected = word === 'negotiation' ? 'n1' : word === 'organising' ? 'n2' : 'n3';
      for (let len = 3; len <= word.length; len++) {
        const typed = word.slice(0, len);
        const hits = idx.search('v', typed, 10).map(r => r.id);
        if (!hits.includes(expected)) missing.push(`${typed} (expected ${expected}, got ${JSON.stringify(hits)})`);
      }
    }
    assert.deepEqual(missing, [],
      `the target note vanished while typing:\n  ${missing.join('\n  ')}`);
  });
});

test('finishing the word still finds it, and unrelated notes stay out', async () => {
  // Guard against "fix" by making everything match everything.
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('v', NOTES);
    assert.deepEqual(idx.search('v', 'negotiation', 10).map(r => r.id), ['n1']);
    const runningHits = idx.search('v', 'running', 10).map(r => r.id);
    assert.ok(runningHits.includes('n3'), 'running should find n3');
    assert.ok(!runningHits.includes('n1'), 'running must not drag in unrelated notes');
  });
});

test('one misremembered word does not empty the whole result set', async () => {
  // Terms are AND-joined, so a single wrong word returns nothing even when the
  // other words identify the note strongly.
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('v', NOTES);
    const hits = idx.search('v', 'quarterly negotiation summary', 10).map(r => r.id);
    assert.ok(hits.includes('n1'),
      `expected n1 despite "summary" not appearing anywhere, got ${JSON.stringify(hits)}`);
  });
});

test('a query where every word is wrong still returns nothing', async () => {
  // The relaxation above must not turn search into a firehose.
  await withIsolatedIndex(async (idx) => {
    idx.init();
    idx.rescanVault('v', NOTES);
    assert.deepEqual(idx.search('v', 'zzzz yyyy', 10).map(r => r.id), []);
  });
});
