const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// Quick capture: where a captured note lands, what it is called, and the local
// counters that record that it happened. app-helpers.test.js pins the ordinary
// save; this pins the titling rules and every fallback that keeps a capture
// from being lost when the chosen destination is not available.

const NOW = new Date('2026-08-05T12:00:00');
const TODAY = helpers.todayIsoDate(NOW);
const note = (id, title, over = {}) => ({ id, title, body: '', tags: [], date: '2026-08-05T09:00:00.000Z', ...over });

test('a note title is the first line that actually says something', () => {
  const title = (body, ...rest) => helpers.captureTitleFromBody(body, ...rest);
  assert.equal(title('# A heading\nmore'), 'A heading');
  assert.equal(title('> quoted first\nmore'), 'quoted first');
  assert.equal(title('- [ ] a task'), 'a task');
  assert.equal(title('* a bullet'), 'a bullet');
  assert.equal(title('1. numbered'), 'numbered');
  assert.equal(title('2) also numbered'), 'also numbered');
  assert.equal(title('**bold** and _italic_'), 'bold and italic');
  assert.equal(title('[A link](https://example.org)'), 'A link');
  assert.equal(title('![An image](pic.png)'), 'An image');
  assert.equal(title('[[A Note]]'), 'A Note');
  assert.equal(title('[[A Note|the alias]]'), 'the alias', 'an aliased link reads as its alias');
  assert.equal(title('[[A Note#a heading]]'), 'A Note', 'a link to a heading is titled by the note');

  assert.equal(title('\n\n   \nreal content'), 'real content', 'blank lines are skipped');
  assert.equal(title('```\ncode\n```'), 'code', 'a fence is not a title but its contents can be');
  assert.equal(title('---\ntitle after a rule'), 'title after a rule');
  assert.equal(title('type:: meeting\nThe real first line'), 'The real first line',
    'a property line is metadata, not a title');
  assert.equal(title('***\n# Heading'), 'Heading');
  assert.equal(title('#\n'), '#', 'a bare hash is not a heading marker, so it is the line itself');
  assert.equal(title('#no space'), '#no space', 'a heading needs a space after the hashes');

  assert.equal(title(''), 'Untitled');
  assert.equal(title('', 'A fallback'), 'A fallback');
  assert.equal(title('', '   '), 'Untitled', 'an empty fallback is still Untitled');
  assert.equal(title('x'.repeat(200)).length, 80, 'a long title is cut and marked');
  assert.ok(title('x'.repeat(200)).endsWith('…'));
  assert.equal(title('x'.repeat(200), 'f', 20).length, 20);
  assert.equal(title('x'.repeat(200), 'f', 5).length, 16, 'the maximum has a floor');
  assert.equal(title('x'.repeat(400), 'f', 999).length, 160, 'and a ceiling');
  assert.equal(title('x'.repeat(200), 'f', 'lots').length, 80, 'an unreadable maximum falls back to 80');
});

test('a capture destination reports whether the note it needs exists', () => {
  const notes = [note('t1', TODAY), note('i1', '  Inbox  ')];
  const byId = id => helpers.captureDestinationChoices({ notes, now: NOW }).find(d => d.id === id);
  assert.equal(byId('today').noteId, 't1');
  assert.equal(byId('today').exists, true);
  assert.equal(byId('inbox').noteId, 'i1', 'the Inbox note is found however it is spaced or cased');
  assert.equal(byId('current').disabled, true, 'with nothing selected, "current note" cannot be chosen');
  assert.equal(byId('current').reason, 'No current note selected.');
  assert.equal(byId('new').exists, false);

  const empty = helpers.captureDestinationChoices({ now: NOW });
  assert.equal(empty.find(d => d.id === 'today').exists, false);
  assert.equal(empty.find(d => d.id === 'today').noteTitle, TODAY,
    'with no daily note yet, the destination is still named by the date');
  assert.equal(empty.find(d => d.id === 'inbox').noteTitle, 'Inbox');

  const selected = helpers.captureDestinationChoices({ notes, now: NOW, selectedNote: note('c1', 'Some note') });
  assert.equal(selected.find(d => d.id === 'current').disabled, false);
  assert.equal(selected.find(d => d.id === 'current').noteId, 'c1');

  assert.equal(helpers.captureDestinationById('inbox', { notes, now: NOW }).id, 'inbox');
  assert.equal(helpers.captureDestinationById('nonsense', { notes, now: NOW }).id, 'new',
    'an unknown destination is a new note rather than nothing');
  assert.equal(helpers.captureDestinationById(null, { notes, now: NOW }).id, 'new');
});

test('a capture template expands its tokens, and an unknown one falls back', () => {
  const expanded = helpers.expandCaptureTemplate('research', { text: 'What is it?', now: NOW });
  assert.equal(expanded.id, 'research');
  assert.equal(expanded.noteTitle, `Research - ${TODAY}`);
  assert.match(expanded.body, /## Question\nWhat is it\?/);
  assert.deepEqual(expanded.tags, ['research']);

  assert.equal(helpers.expandCaptureTemplate('nonsense', { now: NOW }).id, 'meeting',
    'an unknown template id gives the default rather than nothing');
  assert.equal(helpers.expandCaptureTemplate(undefined, { now: NOW }).id, 'meeting');
  assert.equal(helpers.expandCaptureTemplate('task', { capture: 'Do it', now: NOW }).body.includes('- [ ] Do it'), true,
    '`capture` is the other name for the captured text');
  assert.equal(helpers.expandCaptureTemplate('task', { noteTitle: '  My own title  ', now: NOW }).noteTitle,
    'My own title', 'a caller can name the note itself');

  // A template object can be passed directly instead of an id.
  const custom = helpers.expandCaptureTemplate(
    { id: 'custom', title: 'Custom', body: '{templateTitle} on {date}: {text}' },
    { text: 'stuff', now: NOW });
  assert.equal(custom.id, 'custom');
  assert.equal(custom.body, `Custom on ${TODAY}: stuff`);
  assert.equal(custom.noteTitle, 'Custom', 'a template with no note title is named by its title');
  assert.deepEqual(custom.tags, []);
  assert.equal(helpers.expandCaptureTemplate({ id: 'bare' }, { now: NOW }).title, 'Capture');
  assert.equal(helpers.expandCaptureTemplate({ id: 'bare' }, { now: NOW }).noteTitle, 'Captured note');

  assert.deepEqual(helpers.captureTemplateChoices().map(t => t.id),
    ['meeting', 'research', 'book-paper', 'daily-reflection', 'task']);
  assert.equal(helpers.captureTemplateById('BOOK PAPER').id, 'book-paper', 'a template id is slugged before lookup');
});

test('a note template expands its date and is safe to mutate', () => {
  const daily = helpers.expandTemplate(helpers.templateById('daily'), { now: NOW });
  assert.equal(daily.noteTitle, TODAY);
  assert.match(daily.body, new RegExp(`# ${TODAY}`));
  daily.tags.push('mutated');
  assert.deepEqual(helpers.expandTemplate(helpers.templateById('daily'), { now: NOW }).tags, ['daily'],
    'expanding a template never hands back the shared array');

  assert.equal(helpers.templateById('nonsense').id, 'daily', 'an unknown template id gives the first one');
  assert.equal(helpers.expandTemplate(null, { now: NOW }).id, 'daily');
  assert.equal(helpers.expandTemplate({ id: 'x' }, { now: NOW }).title, 'Untitled');
  assert.equal(helpers.expandTemplate({ id: 'x' }, { now: NOW }).body, '');
  assert.equal(helpers.expandTemplate({ id: 'x', title: 'T' }, { now: NOW }).noteTitle, 'T',
    'a template with no note title is named by its title');
  assert.equal(helpers.expandTemplate({ id: 'x', tags: 'not a list' }, { now: NOW }).tags.length, 0);
  assert.equal(helpers.expandTemplate(helpers.templateById('daily'), { date: '2020-01-01' }).noteTitle, '2020-01-01',
    'an explicit date beats the clock');
});

test('a capture saves by appending when the note exists and creating when it does not', () => {
  const notes = [note('t1', TODAY)];
  const append = helpers.captureBuildSavePlan({ notes, now: NOW, destinationId: 'today', templateId: 'task', text: 'Do it' });
  assert.equal(append.action, 'append');
  assert.equal(append.mode, 'append');
  assert.equal(append.noteId, 't1');
  assert.equal(append.destinationTitle, TODAY);
  assert.deepEqual(append.tags, ['daily', 'task'], 'the destination tag comes first, then the template tags');
  assert.match(append.appendText, /- \[ \] Do it/);
  assert.equal(append.createNote, null);
  assert.equal(append.fellBack, false);

  const create = helpers.captureBuildSavePlan({ notes: [], now: NOW, destinationId: 'inbox', templateId: 'task', text: 'Do it' });
  assert.equal(create.action, 'create');
  assert.equal(create.noteId, null);
  assert.equal(create.destinationTitle, 'Inbox');
  assert.deepEqual(create.tags, ['inbox', 'task']);
  assert.equal(create.appendText, '');
  assert.equal(create.createNote.title, 'Inbox');

  const newNote = helpers.captureBuildSavePlan({ notes, now: NOW, destinationId: 'new', templateId: 'research', text: 'Why?' });
  assert.equal(newNote.action, 'create');
  assert.equal(newNote.createNote.title, `Research - ${TODAY}`,
    'a brand new note is named by its template, not by the destination');
  assert.deepEqual(newNote.tags, ['research'], 'the new-note destination adds no tag of its own');
});

test('a capture aimed at a note that is not there falls back and says so', () => {
  const fell = helpers.captureBuildSavePlan({ notes: [], now: NOW, destinationId: 'current', templateId: 'task', text: 'x' });
  assert.equal(fell.requestedDestinationId, 'current');
  assert.equal(fell.destinationId, 'new', 'the capture is not lost -- it becomes a new note');
  assert.equal(fell.fellBack, true);
  assert.equal(fell.fallbackReason, 'Requested destination was unavailable.',
    'the reason describes the fallback, since the destination it landed on has none of its own');

  const kept = helpers.captureBuildSavePlan({
    notes: [], now: NOW, destinationId: 'current', templateId: 'task', text: 'x',
    currentNote: note('c1', 'The open note'),
  });
  assert.equal(kept.fellBack, false);
  assert.equal(kept.action, 'append');
  assert.equal(kept.noteId, 'c1');
  assert.equal(kept.destinationTitle, 'The open note');

  const defaults = helpers.captureBuildSavePlan({ now: NOW });
  assert.equal(defaults.requestedDestinationId, 'new');
  assert.equal(defaults.template.id, 'meeting', 'with nothing chosen a capture is still a valid plan');
  assert.equal(defaults.type, 'capture-save-plan');
  assert.match(helpers.captureBuildSavePlan({ now: NOW, templateId: 'task', text: '   ' }).body, /- \[ \]\n$/,
    'an empty capture still writes the template, leaving the checkbox to fill in');
  assert.equal(helpers.captureBuildAppendMarkdown({ body: '   ' }), '', 'a blank body appends nothing at all');
  assert.equal(helpers.captureBuildAppendMarkdown({}), '');
});

test('local usage counters only record the events they are allowed to', () => {
  assert.deepEqual(helpers.phase5MetricChoices().map(c => c.id), helpers.PHASE5_METRIC_KEYS);
  assert.equal(helpers.phase5NormalizeMetricKey('  CAPTURE_SAVES '), 'capture_saves');
  assert.equal(helpers.phase5NormalizeMetricKey('anything_else'), '');
  assert.throws(() => helpers.phase5RecordMetric({}, 'anything_else'), /Unsupported Phase 5 metric key/);

  const first = helpers.phase5RecordMetric({}, 'capture_saves', { destinationId: 'today', secret: 'nope' },
    { now: '2026-08-05T10:00:00.000Z' });
  assert.equal(first.format, helpers.PHASE5_METRICS_FORMAT);
  assert.equal(first.counters.capture_saves, 1);
  assert.equal(first.events.length, 1);
  assert.deepEqual(first.events[0].details, { destinationId: 'today' },
    'a detail key that is not on the allowlist is dropped, not stored');
  assert.equal(first.updatedAt, '2026-08-05T10:00:00.000Z');

  const second = helpers.phase5RecordMetric(first, 'capture_saves', {}, { now: '2026-08-05T11:00:00.000Z' });
  assert.equal(second.counters.capture_saves, 2);
  assert.equal(helpers.phase5MetricCount(second, 'capture_saves'), 2);
  assert.equal(helpers.phase5MetricCount(second, 'not_a_metric'), 0);
  assert.equal(helpers.phase5MetricCount({}, 'capture_saves'), 0);

  const now = helpers.phase5RecordMetric({}, 'theme_installs', {}, { now: 'not a date' });
  assert.ok(Date.parse(now.updatedAt), 'an unreadable timestamp falls back to the clock');
});

test('stored counters are sanitised on the way back in', () => {
  const clean = helpers.phase5SanitizeMetrics({
    counters: { capture_saves: 3, not_a_metric: 9, theme_installs: -1, zotero_source_notes: 'lots', onboarding_mode_selections: 1e9 },
    events: [
      { key: 'capture_saves', at: '2026-08-05T10:00:00.000Z', details: { mode: 'append' } },
      { key: 'not_a_metric', at: '2026-08-05T10:00:00.000Z' },
      { key: 'capture_saves', at: 'not a date' },
      null,
    ],
    updatedAt: '2026-08-05T10:00:00.000Z',
  });
  assert.deepEqual(clean.counters, { capture_saves: 3, onboarding_mode_selections: 999999 },
    'unknown, negative, unreadable counters are dropped and a huge one is capped');
  assert.equal(clean.events.length, 1, 'an event with no usable key or time is not an event');
  assert.deepEqual(clean.events[0].details, { mode: 'append' });
  assert.equal(clean.updatedAt, '2026-08-05T10:00:00.000Z');

  const empty = helpers.phase5SanitizeMetrics();
  assert.deepEqual(empty.counters, {});
  assert.deepEqual(empty.events, []);
  assert.equal(empty.updatedAt, null);
  assert.deepEqual(helpers.phase5SanitizeMetrics('nonsense').counters, {});
  assert.deepEqual(helpers.phase5SanitizeMetrics({ counters: ['bad'], events: 'bad' }).events, []);
  assert.equal(helpers.phase5SanitizeMetrics({ updatedAt: 'not a date' }).updatedAt, null);

  // Only the last hundred events are kept.
  const many = helpers.phase5SanitizeMetrics({
    events: Array.from({ length: 150 }, (_, i) => ({ key: 'capture_saves', at: '2026-08-05T10:00:00.000Z', details: { mode: `m${i}` } })),
  });
  assert.equal(many.events.length, 100);
  assert.equal(many.events[99].details.mode, 'm149', 'the newest events are the ones kept');
});

test('a detail value is reduced to something safe to store', () => {
  const clean = details => helpers.phase5SanitizeMetricDetails(details);
  assert.deepEqual(clean({ mode: true }), { mode: true }, 'a boolean is kept as one');
  assert.deepEqual(clean({ mode: false }), { mode: false }, 'and false is a value, not a missing one');
  assert.deepEqual(clean({ mode: 7 }), { mode: 7 });
  assert.deepEqual(clean({ mode: Infinity }), {}, 'a number that is not finite is not a value');
  assert.deepEqual(clean({ mode: 'append to today' }), { mode: 'append-to-today' },
    'spaces and punctuation are flattened so a detail cannot carry free text');
  assert.deepEqual(clean({ mode: '!!!' }), {});
  assert.deepEqual(clean({ mode: 'x'.repeat(200) }).mode.length, 120);
  assert.deepEqual(clean({}), {});
  assert.deepEqual(clean(null), {});
  assert.deepEqual(clean(['bad']), {});
  assert.deepEqual(clean('bad'), {});
});
