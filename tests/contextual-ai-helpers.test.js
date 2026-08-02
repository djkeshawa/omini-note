const test = require('node:test');
const assert = require('node:assert/strict');

const { createContextualAiHelpers } = require('../src/app/helpers/contextualAiHelpers.js');

// src/app/helpers/contextualAiHelpers.js was at 99.51% line but 55.19% branch --
// every conditional executed, none of them varied. The important part is
// contextualAiCompareMarkdownMarkers: it is the guard that checks an AI edit did
// not silently drop the user's wiki links, tags, properties or tasks.

const h = createContextualAiHelpers({
  CONTEXTUAL_AI_PROVIDER_LABELS: { ollama: 'Ollama' },
  CONTEXTUAL_AI_SECTION_KINDS: ['fact', 'suggestion', 'preview'],
});

test('markers find every kind of thing an edit could lose', () => {
  const body = [
    'Intro with [[Alpha]] and [[Beta|alias]].',
    '#work and (#urgent) tags.',
    'status:: active',
    '- key:: value',
    '- [ ] open task',
    '- [x] done task',
  ].join('\n');
  const m = h.contextualAiMarkdownMarkers(body);
  assert.deepEqual(m.wikiLinks, ['Alpha', 'Beta|alias']);
  assert.deepEqual(m.tags, ['work', 'urgent']);
  assert.deepEqual(m.properties, ['status', 'key']);
  assert.equal(m.taskCount, 2);
});

test('markers are stable when computed twice', () => {
  // The collector drives re.exec in a while loop. A regex shared between calls
  // would carry lastIndex over and quietly return fewer markers the second
  // time -- which would make the edit guard pass an edit that lost content.
  const body = 'see [[One]] and [[Two]] #alpha #beta\n- [ ] task\nkey:: v';
  const first = h.contextualAiMarkdownMarkers(body);
  const second = h.contextualAiMarkdownMarkers(body);
  assert.deepEqual(second, first, 'a second call returned different markers');
});

test('duplicate markers are collapsed case-insensitively', () => {
  const m = h.contextualAiMarkdownMarkers('[[Note]] [[note]] [[NOTE]] #Tag #tag');
  assert.equal(m.wikiLinks.length, 1);
  assert.equal(m.tags.length, 1);
});

test('an edit that keeps everything passes the guard', () => {
  const before = 'text [[Alpha]] #work\n- [ ] task\nstatus:: active';
  const after = 'rewritten text [[Alpha]] #work\n- [ ] task\nstatus:: active';
  const result = h.contextualAiCompareMarkdownMarkers(before, after);
  assert.equal(result.ok, true, `guard rejected a lossless edit: ${JSON.stringify(result)}`);
});

test('the guard catches each kind of loss', () => {
  const before = 'text [[Alpha]] [[Beta]] #work #urgent\n- [ ] one\n- [ ] two\nstatus:: active';
  const dropped = h.contextualAiCompareMarkdownMarkers(before, 'text [[Alpha]] #work\n- [ ] one');
  assert.equal(dropped.ok, false);
  assert.deepEqual(dropped.missingWikiLinks, ['Beta']);
  assert.deepEqual(dropped.missingTags, ['urgent']);
  assert.deepEqual(dropped.missingProperties, ['status']);
  assert.equal(dropped.taskCountReduced, true);
});

test('the guard ignores reordering and case changes', () => {
  const before = 'a [[Alpha]] b #work';
  const after = '#WORK first, then [[alpha]]';
  assert.equal(h.contextualAiCompareMarkdownMarkers(before, after).ok, true,
    'reordering or recasing a link should not read as losing it');
});

test('adding content is never treated as loss', () => {
  const before = 'text [[Alpha]]';
  const after = 'text [[Alpha]] [[Gamma]] #new\n- [ ] added task';
  assert.equal(h.contextualAiCompareMarkdownMarkers(before, after).ok, true);
});

test('completing a task is not counted as deleting it', () => {
  // "- [ ] x" becoming "- [x] x" must not trip the guard.
  const result = h.contextualAiCompareMarkdownMarkers('- [ ] thing', '- [x] thing');
  assert.equal(result.taskCountReduced, false);
  assert.equal(result.ok, true);
});

test('the guard copes with empty and missing input', () => {
  for (const [a, b] of [['', ''], [null, null], [undefined, 'text'], ['text', undefined]]) {
    const result = h.contextualAiCompareMarkdownMarkers(a, b);
    assert.equal(typeof result.ok, 'boolean', `no verdict for ${JSON.stringify([a, b])}`);
  }
  // Nothing before means nothing can be lost.
  assert.equal(h.contextualAiCompareMarkdownMarkers(null, null).ok, true);
});

test('a markdown section is extracted and stops at the next section', () => {
  const text = '## Summary\nthe summary body\n\n## Details\nother content';
  assert.equal(h.contextualAiExtractMarkdownSection(text, ['Summary']), 'the summary body');
});

test('a section stops at the next plain-text heading too, not just a hashed one', () => {
  // The start condition accepts a plain-text label (models often write
  // "Summary:" with no #), but the stop condition only recognised '#'
  // headings. That asymmetry lets one section swallow every section after it.
  const text = 'Summary:\nthe summary body\n\nDetails:\neverything after should not be here';
  const extracted = h.contextualAiExtractMarkdownSection(text, ['Summary', 'Details']);
  assert.doesNotMatch(extracted, /should not be here/,
    `the Summary section swallowed the Details section: ${JSON.stringify(extracted)}`);
});

test('an absent section yields nothing rather than the whole document', () => {
  const text = '## Summary\nbody';
  assert.equal(h.contextualAiExtractMarkdownSection(text, ['Nowhere']), '');
  assert.equal(h.contextualAiExtractMarkdownSection(text, []), '');
  assert.equal(h.contextualAiExtractMarkdownSection('', ['Summary']), '');
});

test('action items dedupe on note, label and time', () => {
  const items = [
    { noteId: 'n1', label: 'Call Sam', rollupDateKey: '2026-01-01' },
    { noteId: 'n1', label: 'call  sam', rollupDateKey: '2026-01-01' },
    { noteId: 'n2', label: 'Call Sam', rollupDateKey: '2026-01-01' },
  ];
  const unique = h.digestUniqueActionItems(items);
  assert.equal(unique.length, 2, 'the same task on the same note and day appeared twice');
});

test('action items respect the limit and the exclusion list', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ noteId: `n${i}`, label: `task ${i}` }));
  assert.equal(h.digestUniqueActionItems(items, { limit: 5 }).length, 5);
  // A nonsensical limit must never silently yield nothing when items exist.
  // (0 is falsy, so it takes the default rather than the Math.max(1, ...) floor.)
  assert.ok(h.digestUniqueActionItems(items, { limit: 0 }).length > 0);
  assert.equal(h.digestUniqueActionItems(items, { limit: -5 }).length, 1);
  assert.ok(h.digestUniqueActionItems(items, { limit: NaN }).length > 0);
  const excluded = h.digestActionItemKey(items[0]);
  const kept = h.digestUniqueActionItems(items, { excludeKeys: [excluded] });
  assert.ok(!kept.some(i => h.digestActionItemKey(i) === excluded), 'an excluded item was returned');
});

test('action item helpers tolerate junk', () => {
  for (const input of [null, undefined, [], [null], [undefined], 'string']) {
    assert.ok(Array.isArray(h.digestUniqueActionItems(input)), `not an array for ${JSON.stringify(input)}`);
  }
  assert.deepEqual(h.digestUniqueActionItems([null, undefined]), [], 'junk entries should be skipped');
  assert.equal(typeof h.digestActionItemKey(null), 'string');
  assert.equal(typeof h.digestActionItemKey({}), 'string');
});
