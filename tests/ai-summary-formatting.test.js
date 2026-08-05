const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createSummaryDomain } = require('../lib/ai/summaries.js');

// How a vault summary is assembled and cached. ai-summaries.test.js pins that
// no note is dropped; this pins the text the user actually reads -- the prompt
// each note becomes, the heading de-duplication, the source list, and the
// fallbacks when the model returns nothing useful.

function makeDomain({ chatReply = 'batch summary', chatError = null } = {}) {
  const calls = { chat: 0, prompts: [], options: [] };
  const summaryCache = new Map();
  const scope = {
    CONFIG: { provider: 'ollama', chatModel: 'llama3' },
    MAX_RAG_PROMPT_CHARS: 200,
    QUERY_CACHE_MS: 60000,
    SUMMARY_BATCH_MAX_CHARS: 4000,
    SUMMARY_BATCH_MAX_NOTES: 5,
    SUMMARY_MAP_MAX_TOKENS: 200,
    SUMMARY_NOTE_BODY_CHARS: 60,
    SUMMARY_REDUCE_MAX_TOKENS: 200,
    SUMMARY_REQUEST_TIMEOUT_MS: 1000,
    crypto,
    summaryCache,
    chatUnavailableReason: () => 'model unavailable',
    notePreview: (note, n) => String(note.body || '').slice(0, n),
    sortByModified: notes => [...(notes || [])].sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || ''))),
    stripPromptPropertyLines: text => String(text).replace(/^\w+::.*$/gm, '').trim(),
    providerChat: async (messages, options) => {
      calls.chat += 1;
      calls.prompts.push(messages);
      calls.options.push(options);
      if (chatError) throw chatError;
      return { text: typeof chatReply === 'function' ? chatReply(calls.chat) : chatReply };
    },
  };
  return { domain: createSummaryDomain(scope), calls, summaryCache };
}

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? 'A body.',
  tags: over.tags ?? [], modifiedAt: over.modifiedAt ?? '2026-01-01T00:00:00.000Z', ...over,
});

test('each note becomes a labelled block the model cannot confuse', () => {
  const { domain } = makeDomain();
  const formatted = domain.formatSummaryNote(note('n1', {
    title: 'The Meeting', tags: ['work', 'urgent'], body: 'status:: DRAFT\nReal content here.',
  }), 0);
  assert.match(formatted, /^<note index="1">/);
  assert.match(formatted, /<title>The Meeting<\/title>/);
  assert.match(formatted, /<tags>#work #urgent<\/tags>/);
  assert.match(formatted, /<modifiedAt>2026-01-01T00:00:00\.000Z<\/modifiedAt>/);
  assert.match(formatted, /Real content here\./);
  assert.ok(!formatted.includes('status::'), 'property lines are not content the model should summarise');

  const bare = domain.formatSummaryNote({ tags: [] }, 4);
  assert.match(bare, /<note index="5">/, 'the index shown is one-based');
  assert.match(bare, /<title>Untitled<\/title>/);
  assert.match(bare, /<tags>none<\/tags>/);
  assert.match(bare, /<modifiedAt>unknown<\/modifiedAt>/);
  assert.match(bare, /\(empty note\)/, 'an empty note says so rather than leaving a gap');
  assert.match(domain.formatSummaryNote({ date: '2026-02-02', tags: [] }, 0), /<modifiedAt>2026-02-02</,
    'a note never modified is dated by its creation');
  assert.equal(domain.formatSummaryNote(note('n', { body: 'x'.repeat(500) }), 0).includes('x'.repeat(61)), false,
    'the body sent per note is capped');
});

test('a note fingerprint changes when anything the summary depends on changes', () => {
  const { domain } = makeDomain();
  const base = note('n1', { title: 'T', body: 'body' });
  const fingerprint = domain.summaryNoteFingerprint(base);
  assert.equal(domain.summaryNoteFingerprint({ ...base }), fingerprint, 'the same note fingerprints the same');
  for (const change of [{ title: 'Other' }, { body: 'other body' }, { id: 'n2' }, { modifiedAt: '2026-06-01' }]) {
    assert.notEqual(domain.summaryNoteFingerprint({ ...base, ...change }), fingerprint,
      `changing ${Object.keys(change)[0]} must invalidate the cached summary`);
  }
  assert.ok(domain.summaryNoteFingerprint(null), 'a missing note still fingerprints rather than throwing');
  assert.equal(domain.summaryNoteFingerprint({ date: '2026-02-02' }).includes('2026-02-02'), true);
});

test('a batch summary is cached against the notes and the question asked', async () => {
  const { domain, calls } = makeDomain();
  const batch = [note('n1'), note('n2')];
  assert.equal(await domain.summarizeNoteBatch(batch, 'what changed'), 'batch summary');
  assert.equal(calls.chat, 1);
  assert.equal(await domain.summarizeNoteBatch(batch, 'what changed'), 'batch summary');
  assert.equal(calls.chat, 1, 'the same question about the same notes is not asked twice');

  await domain.summarizeNoteBatch(batch, 'a different question');
  assert.equal(calls.chat, 2);
  await domain.summarizeNoteBatch([note('n1'), note('n3')], 'what changed');
  assert.equal(calls.chat, 3, 'a different set of notes is a different summary');

  assert.match(JSON.stringify(calls.prompts[0]), /what changed/);
  assert.equal(calls.options[0].maxTokens, 200);
  assert.equal(calls.options[0].timeoutMs, 1000);
  await domain.summarizeNoteBatch([note('n9')], 'q', { maxTokens: 5, timeoutMs: 7 });
  assert.equal(calls.options.at(-1).maxTokens, 5);
  assert.equal(calls.options.at(-1).timeoutMs, 7);
});

test('a model that answers with nothing falls back to listing the notes', async () => {
  const { domain } = makeDomain({ chatReply: '   ' });
  const summary = await domain.summarizeNoteBatch([note('n1', { title: 'A', body: 'first body' })], 'q');
  assert.match(summary, /AI summary fallback \(empty model response\)/);
  assert.match(summary, /- A: first body/);

  const { domain: plain } = makeDomain();
  assert.match(plain.fallbackBatchSummary([note('n1', { title: 'A', body: '' })]), /^AI summary fallback\.\n- A$/,
    'a note with no preview is listed by title alone');
  assert.equal(plain.fallbackBatchSummary([]), 'AI summary fallback.');
  assert.match(plain.fallbackBatchSummary([{}], 'timed out'), /fallback \(timed out\)\.\n- Untitled/);
});

test('the cache expires and never grows without bound', () => {
  const { domain, summaryCache } = makeDomain();
  domain.setCachedSummary('k1', 'value');
  assert.equal(domain.getCachedSummary('k1'), 'value');
  assert.equal(domain.getCachedSummary('never-set'), null);

  summaryCache.set('stale', { at: Date.now() - 60000 * 4 - 1, value: 'old' });
  assert.equal(domain.getCachedSummary('stale'), null, 'a summary older than the window is not reused');

  for (let i = 0; i < 130; i++) domain.setCachedSummary(`key${i}`, `value${i}`);
  assert.ok(summaryCache.size <= 121, 'the oldest entry is evicted rather than letting the cache grow');
  assert.equal(domain.getCachedSummary('key129'), 'value129');

  const key = domain.summaryCacheKey('batch', ['a', 'b']);
  assert.match(key, /^ollama:llama3:batch:/, 'the cache key names the provider and model that produced it');
  assert.notEqual(key, domain.summaryCacheKey('reduce', ['a', 'b']));
  assert.notEqual(key, domain.summaryCacheKey('batch', ['a', 'c']));
});

test('a generic heading the model adds is stripped from each batch summary', () => {
  const { domain } = makeDomain();
  for (const heading of ['# Notes summary', '## Summary', '### Vault summary', '# Summary of all notes', '## All notes summary']) {
    assert.equal(domain.normalizeFinalSummaryBody(`${heading}\n\nReal content.`), 'Real content.',
      `${heading} is the wrapper's own heading, not the model's contribution`);
  }
  assert.equal(domain.normalizeFinalSummaryBody('# Notes summary\n\n## Summary\n\nReal content.'), 'Real content.',
    'a stack of generic headings is removed entirely');
  assert.equal(domain.normalizeFinalSummaryBody('# Key decisions\n\nReal content.'), '# Key decisions\n\nReal content.',
    'a heading that says something is kept');
  assert.equal(domain.normalizeFinalSummaryBody('\r\n\r\n# Summary\r\nContent.'), 'Content.');
  assert.equal(domain.normalizeFinalSummaryBody(''), '');
  assert.equal(domain.normalizeFinalSummaryBody('#### Summary\nContent.'), '#### Summary\nContent.',
    'only headings the note itself would use are stripped');

  assert.equal(domain.isGenericSummaryHeadingLine('# Summary'), true);
  assert.equal(domain.isGenericSummaryHeadingLine('not a heading'), false);
  assert.equal(domain.isGenericSummaryHeadingLine('# **Summary**'), true, 'decoration does not disguise it');
  assert.equal(domain.summaryHeadingKey('  ## Notes  Summary!! '), 'notes summary');
  assert.equal(domain.summaryHeadingKey(null), '');
});

test('the final note carries the summary, its sources and the request', () => {
  const { domain } = makeDomain();
  const notes = [note('n1', { title: 'Alpha' }), note('n2', { title: 'Beta' })];
  const final = domain.formatFinalSummary({ query: 'what changed', summaries: ['# Summary\n\nThe content.'], notes });
  assert.match(final, /^# Notes summary/);
  assert.match(final, /The content\./);
  assert.ok(!final.includes('# Summary\n'), 'the duplicated heading is gone');
  assert.match(final, /## Source notes\n- \[\[Alpha\]\]\n- \[\[Beta\]\]/);
  assert.match(final, /Request: what changed$/);
  assert.ok(!final.includes('\n\n\n'), 'blank lines never stack up');
  assert.ok(!final.includes('Partial AI summary'));

  const partial = domain.formatFinalSummary({ query: 'q', summaries: ['x'], notes, failures: [{ index: 1 }] });
  assert.match(partial, /> Partial AI summary: 1 batch used a fallback/);
  const plural = domain.formatFinalSummary({ query: 'q', summaries: ['x'], notes, failures: [{}, {}] });
  assert.match(plural, /2 batches used a fallback/);

  const empty = domain.formatFinalSummary({});
  assert.match(empty, /^# Notes summary/);
  assert.match(empty, /Request: undefined$/);
  assert.equal(domain.formatFinalSummary({ query: 'q', summaries: ['', '  '], notes }).includes('## Source notes'), true,
    'empty batch summaries are dropped without breaking the note');
  assert.equal(domain.formatFinalSummary({ query: 'q', summaries: [], notes: Array.from({ length: 100 }, (_, i) => note(`n${i}`)) })
    .match(/- \[\[/g).length, 80, 'the source list is capped');
});

test('the reduce step is skipped, cached, or falls back to the assembled note', async () => {
  const single = makeDomain();
  assert.equal(await single.domain.reduceBatchSummaries(['only one'], 'q', []), 'only one');
  assert.equal(single.calls.chat, 0, 'one batch needs no reducing');
  assert.equal(await single.domain.reduceBatchSummaries([], 'q', []), '');

  const many = makeDomain({ chatReply: 'the reduced note' });
  assert.equal(await many.domain.reduceBatchSummaries(['a', 'b'], 'q', []), 'the reduced note');
  assert.equal(await many.domain.reduceBatchSummaries(['a', 'b'], 'q', []), 'the reduced note');
  assert.equal(many.calls.chat, 1, 'the reduced note is cached too');
  assert.match(JSON.stringify(many.calls.prompts[0]), /--- Batch 1 ---/);

  const blank = makeDomain({ chatReply: '  ' });
  const fallback = await blank.domain.reduceBatchSummaries(['a', 'b'], 'q', [note('n1', { title: 'Alpha' })]);
  assert.match(fallback, /# Notes summary/, 'an empty reduction falls back to assembling the batches directly');
  assert.match(fallback, /\[\[Alpha\]\]/);

  const failed = makeDomain({ chatError: new Error('model exploded') });
  const afterError = await failed.domain.reduceBatchSummaries(['a', 'b'], 'q', [note('n1')]);
  assert.match(afterError, /# Notes summary/, 'a failed reduction is not a failed summary');

  // A cancellation is not a failure to paper over -- it has to reach the caller.
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  await assert.rejects(makeDomain({ chatError: abort }).domain.reduceBatchSummaries(['a', 'b'], 'q', []), /cancelled/);
  const abortCode = Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' });
  await assert.rejects(makeDomain({ chatError: abortCode }).domain.reduceBatchSummaries(['a', 'b'], 'q', []), /cancelled/);
});

test('the source list shown to the user is trimmed and previewed', () => {
  const { domain } = makeDomain();
  const sources = domain.collectSummarySources([
    note('n1', { title: 'Old', modifiedAt: '2026-01-01T00:00:00.000Z', body: 'x'.repeat(500) }),
    note('n2', { title: '', modifiedAt: '2026-06-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(sources.map(s => s.id), ['n2', 'n1'], 'most recently changed first');
  assert.equal(sources[0].title, 'Untitled');
  assert.equal(sources[1].snippet.length, 220, 'each source carries a capped preview');
  assert.equal(domain.collectSummarySources([note('a'), note('b')], 1).length, 1);
  assert.deepEqual(domain.collectSummarySources([]), []);
});
