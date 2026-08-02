const test = require('node:test');
const assert = require('node:assert/strict');

const { createResearchDomain } = require('../lib/ai/research.js');

// lib/ai/research.js sat at 60.96% branch coverage. It decides which notes the
// model is allowed to see, so its edges decide what the AI can and cannot know.

function makeDomain(overrides = {}) {
  return createResearchDomain({
    CONFIG: { enabled: true },
    MAX_CONTEXT_CHARS: 6000,
    MAX_NOTE_BODY_CHARS: 2000,
    MAX_RAG_PROMPT_CHARS: 8000,
    NOTE_RESEARCH_ARG_CHARS: 120,
    NOTE_RESEARCH_MAX_NOTES: 10,
    NOTE_RESEARCH_MAX_ROUNDS: 3,
    NOTE_RESEARCH_MAX_SUMMARIES: 5,
    NOTE_RESEARCH_MAX_TOOL_CALLS: 8,
    NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND: 3,
    NOTE_RESEARCH_TOOL_RESULT_CHARS: 1000,
    QUERY_CACHE_MS: 1000,
    SELECTED_NOTE_LIMIT: 12,
    TRAVERSAL_MAX_NOTES: 20,
    TRAVERSAL_SEED_LIMIT: 5,
    TRAVERSAL_SHARED_TAG_LIMIT: 5,
    WHOLE_VAULT_MAX_CHARS: 20000,
    WHOLE_VAULT_MAX_NOTES: 50,
    idx: {},
    retrievalCache: new Map(),
    vaultStore: {},
    ...overrides,
  });
}

const note = (id, body, extra = {}) => ({ id, title: `Note ${id}`, body, modifiedAt: '2026-01-01T00:00:00.000Z', ...extra });

test('fitNotes reports capping honestly', () => {
  // `capped` tells the caller notes were left out; if it lies, the UI claims
  // the answer saw the whole vault when it did not.
  const d = makeDomain();
  const many = Array.from({ length: 40 }, (_, i) => note(`n${i}`, 'x'.repeat(900)));
  const tight = d.fitNotes(many, 2000);
  assert.equal(tight.capped, true, 'dropped notes but reported capped=false');
  const roomy = d.fitNotes([note('a', 'small')], 60000);
  assert.equal(roomy.capped, false, 'kept every note but reported capped=true');
});

test('fitNotes never exceeds the context budget it was given', () => {
  const d = makeDomain();
  for (const maxChars of [2000, 6000, 20000]) {
    const notes = Array.from({ length: 40 }, (_, i) => note(`n${i}`, 'x'.repeat(900)));
    const { notes: fitted, usedChars: used } = d.fitNotes(notes, maxChars);
    // One note is always admitted even if it alone blows the budget, so only
    // check the cap once more than one note was selected.
    if (fitted.length > 1) {
      assert.ok(used <= maxChars, `budget ${maxChars}: selected notes cost ${used}`);
    }
  }
});

test('fitNotes always returns at least one note when given any', () => {
  // Returning nothing would mean the model answers with no context at all
  // while the caller believes it had some.
  const d = makeDomain();
  const huge = [note('big', 'y'.repeat(500000))];
  assert.equal(d.fitNotes(huge, 100).notes.length, 1);
  assert.equal(d.fitNotes([note('a', 'small')], 6000).notes.length, 1);
});

test('fitNotes truncates a long body rather than dropping the note', () => {
  const d = makeDomain();
  const [fitted] = d.fitNotes([note('big', 'z'.repeat(50000))], 6000).notes;
  assert.ok(fitted.body.length < 50000, 'body was not clipped');
  assert.ok(fitted.body.includes('[truncated]'), 'clipping should be visible to the model');
});

test('fitNotes does not mutate the notes it was handed', () => {
  // These are live vault notes; clipping the original would shorten the note
  // the user sees.
  const d = makeDomain();
  const original = note('a', 'q'.repeat(50000));
  d.fitNotes([original], 3000);
  assert.equal(original.body.length, 50000, 'fitNotes mutated the caller\'s note');
});

test('fitNotes copes with empty and missing bodies', () => {
  const d = makeDomain();
  assert.doesNotThrow(() => d.fitNotes([
    { id: 'a', title: 'A' }, { id: 'b', title: 'B', body: null }, { id: 'c', title: 'C', body: '' },
  ], 6000));
  assert.deepEqual(d.fitNotes([], 6000).notes, []);
});

test('wiki link titles are extracted from every link form, deduped', () => {
  const d = makeDomain();
  assert.deepEqual(d.extractWikiLinkTitles('see [[Alpha]] and [[Beta|the beta]]'), ['Alpha', 'Beta']);
  assert.deepEqual(d.extractWikiLinkTitles('[[Gamma#section]]'), ['Gamma']);
  assert.deepEqual(d.extractWikiLinkTitles('[[Delta#s|alias]]'), ['Delta']);
  assert.deepEqual(d.extractWikiLinkTitles('[[Same]] then [[Same]] again'), ['Same']);
  assert.deepEqual(d.extractWikiLinkTitles('[[  Padded  ]]'), ['Padded']);
});

test('wiki link extraction returns an empty list rather than throwing', () => {
  const d = makeDomain();
  for (const input of ['', null, undefined, '[[]]', '[[', ']]', 'no links here', 42]) {
    assert.doesNotThrow(() => d.extractWikiLinkTitles(input), `threw on ${JSON.stringify(input)}`);
    assert.ok(Array.isArray(d.extractWikiLinkTitles(input)));
  }
});

test('recency and broad-summary queries are told apart', () => {
  const d = makeDomain();
  assert.equal(d.isRecencyQuery('what are my most recent notes'), true);
  assert.equal(d.isRecencyQuery('what did I change last week in my notes'), true);
  assert.equal(d.isRecencyQuery('how do I make bread'), false);
  // A recency question must not also be treated as a whole-vault summary --
  // that would pull the entire vault into the prompt for a "what changed" ask.
  assert.equal(d.isBroadVaultSummaryQuery('summarise my most recent notes'), false);
  assert.equal(d.isBroadVaultSummaryQuery('summarise all my notes'), true);
  assert.equal(d.isBroadVaultSummaryQuery('what is a good bread recipe'), false);
});

test('queryMentionsCurrentNote spots references to the open note', () => {
  const d = makeDomain();
  for (const q of ['summarise this note', 'what is on this page', 'expand on this']) {
    assert.equal(d.queryMentionsCurrentNote(q), true, `missed: ${q}`);
  }
  assert.equal(d.queryMentionsCurrentNote('summarise my vault'), false);
});

test('research tool arguments are capped so one call cannot flood the prompt', () => {
  const d = makeDomain();
  assert.equal(d.capResearchArg('x'.repeat(10000)).length, 120);
  assert.equal(d.capResearchArg(null), '');
  assert.equal(d.capResearchArg(undefined), '');
  assert.equal(d.capResearchArg({}), '[object Object]'.slice(0, 120));
});

test('titleKey folds case and whitespace so link titles match', () => {
  const d = makeDomain();
  assert.equal(d.titleKey('  Meeting Notes  '), d.titleKey('meeting notes'));
  assert.equal(d.titleKey(null), '');
});

test('sortByModified puts the newest first and tolerates missing dates', () => {
  const d = makeDomain();
  const sorted = d.sortByModified([
    note('old', 'a', { modifiedAt: '2026-01-01T00:00:00.000Z' }),
    note('none', 'b', { modifiedAt: undefined }),
    note('new', 'c', { modifiedAt: '2026-06-01T00:00:00.000Z' }),
  ]);
  assert.equal(sorted[0].id, 'new');
  assert.equal(sorted.length, 3, 'a note with no date was dropped');
});
