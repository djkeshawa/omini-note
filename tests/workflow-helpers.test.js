const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../src/app/appHelpers.js');

// The workflow layer: the command palette filter, the workflow-board grouping,
// Zotero source notes, and the parsers that turn note bodies into tasks and
// reminders. app-helpers.test.js pins the happy path of each; this pins the
// edges -- the alternate spellings, the empty inputs and the guards.

const note = (id, over = {}) => ({
  id, title: over.title ?? `Note ${id}`, body: over.body ?? '', tags: over.tags ?? [],
  date: '2026-08-05T09:00:00.000Z', modifiedAt: '2026-08-05T09:00:00.000Z', ...over,
});

// A depth-first walker of the block tree, the shape the renderer passes in.
const walk = (blocks, visit) => (blocks || []).forEach(block => {
  visit(block);
  if (block.children?.length) walk(block.children, visit);
});

test('the command palette ranks by where the query matches, then by title', () => {
  const commands = [
    { id: 'a', title: 'Open settings', section: 'App' },
    { id: 'b', title: 'Settings backup', section: 'Data' },
    { id: 'c', title: 'New note', keywords: 'settings create' },
    { id: 'd', title: 'Disabled thing', section: 'settings', enabled: false },
    null,
  ];
  assert.deepEqual(helpers.filterCommands(commands, 'settings').map(c => c.id), ['b', 'a', 'c'],
    'an earlier match ranks higher, and a disabled command never appears');
  assert.deepEqual(helpers.filterCommands(commands, 'nothing here'), [],
    'no match means no results rather than everything');
  assert.deepEqual(helpers.filterCommands(commands, '  ').map(c => c.id), ['c', 'a', 'b'],
    'an empty query lists every enabled command alphabetically');
  assert.equal(helpers.filterCommands(commands, 'settings', 1).length, 1);
  assert.deepEqual(helpers.filterCommands(null, 'x'), []);
  assert.deepEqual(helpers.filterCommands(), []);
});

test('search snippets decorate matching notes and leave the rest untouched', () => {
  const notes = [note('a'), note('b')];
  const fromMap = helpers.decorateNotesWithSearchDetails(notes, new Map([['a', { snippet: 'hit', matchedFields: ['body'] }]]));
  assert.equal(fromMap[0].__searchSnippet, 'hit');
  assert.deepEqual(fromMap[0].__matchedFields, ['body']);
  assert.equal('__searchSnippet' in fromMap[1], false, 'a note with no match is returned unchanged');
  assert.equal(fromMap[1], notes[1], 'and is the same object, so nothing re-renders needlessly');

  const fromObject = helpers.decorateNotesWithSearchDetails(notes, { a: { snippet: 'plain object' } });
  assert.equal(fromObject[0].__searchSnippet, 'plain object', 'a plain object of details works like a Map');
  assert.deepEqual(helpers.decorateNotesWithSearchDetails(notes, null).length, 2);
  assert.deepEqual(helpers.decorateNotesWithSearchDetails(null), []);
  assert.deepEqual(helpers.decorateNotesWithSearchDetails(notes).length, 2);
});

test('a workflow status only counts when the board declares it', () => {
  const states = [{ id: 'DOING' }, { id: 'DONE' }];
  assert.equal(helpers.normalizeWorkflowStatus('doing', states), 'DOING');
  assert.equal(helpers.normalizeWorkflowStatus('  in progress  ', states), '', 'an unknown status is no status');
  assert.equal(helpers.normalizeWorkflowStatus('done', [{ id: 'DONE' }]), 'DONE');
  assert.equal(helpers.normalizeWorkflowStatus('', states), '');
  assert.equal(helpers.normalizeWorkflowStatus('doing'), '', 'with no declared states nothing is a status');
  assert.equal(helpers.normalizeWorkflowStatus('anything', states, () => 'DONE'), 'DONE',
    'a caller can supply its own normaliser');
  assert.equal(helpers.normalizeWorkflowStatus('x'.repeat(40), [{ id: 'X'.repeat(18) }]), 'X'.repeat(18),
    'a status id is cut to eighteen characters');
});

test('the board groups notes by status and keeps archived ones aside', () => {
  const states = [{ id: 'DOING' }, { id: 'DONE' }];
  const notes = [
    note('a', { body: 'status:: DOING\nSome text', tags: ['work'] }),
    note('b', { body: '- status:: doing\nAnother', tags: null }),
    note('c', { body: 'status:: DONE' }),
    note('d', { body: 'status:: SHIPPED' }),
    note('e', { body: 'no status here' }),
    note('f', { body: 'status:: DOING', workflowArchived: true }),
  ];
  const board = helpers.collectWorkflowNotes(notes, states);
  assert.deepEqual(board.counts, { DOING: 2, DONE: 1 }, 'a status the board does not declare is not counted');
  assert.equal(board.total, 3);
  assert.deepEqual(board.byState.DOING.map(i => i.id), ['a', 'b']);
  assert.deepEqual([...board.noteIdsByState.DOING], ['a', 'b']);
  assert.deepEqual(board.byState.DOING[1].noteTags, [], 'a note with no tags contributes an empty list');
  assert.deepEqual(board.archivedNotes.map(n => n.id), ['f'], 'an archived note is set aside, not counted');
  assert.equal(board.archivedNotes[0].workflow, 'DOING');

  const empty = helpers.collectWorkflowNotes(null, null);
  assert.deepEqual(empty.counts, {});
  assert.equal(empty.total, 0);

  // A caller that already has a property reader can supply it.
  const supplied = helpers.collectWorkflowNotes([note('x')], states, { propertyValue: () => 'DONE' });
  assert.equal(supplied.counts.DONE, 1);
});

test('board rows expose every property line the note carries, once each', () => {
  const notes = [note('a', { body: [
    'status:: DOING',
    '- owner:: Sam',
    'due date:: 2026-09-01',
    'owner:: Someone else',
    'not a property',
    '9bad:: nope',
  ].join('\n') })];
  const [row] = helpers.collectWorkflowNotes(notes, [{ id: 'DOING' }]).byState.DOING;
  assert.deepEqual({ ...row.properties }, { status: 'DOING', owner: 'Sam', 'due date': '2026-09-01' },
    'the first value of a repeated key wins, and a key that cannot start a property is ignored');
  assert.equal(Object.getPrototypeOf(row.properties), null,
    'discovered keys go on a bare object, so a note cannot name one Object.prototype already owns');
  assert.equal(row.kind, 'note');
  assert.equal(row.text, 'not a property 9bad:: nope',
    'the preview strips exactly the lines the table read as properties, two-word keys included');
});

test('the workflow preview is prose, not markup', () => {
  const preview = helpers.workflowNotePreview({ body: [
    '# A heading',
    'status:: DOING',
    '- [ ] a task',
    '- a bullet with [[A Link]] and `code`',
    '> quoted',
  ].join('\n') });
  assert.equal(preview, 'a task a bullet with A Link and code quoted');
  assert.equal(helpers.workflowNotePreview({ body: 'x'.repeat(300) }).length, 180, 'the preview is capped');
  assert.equal(helpers.workflowNotePreview(null), '');
  assert.equal(helpers.workflowNotePreview({}), '');
});

test('reminders are collected from lines or from blocks, skipping finished ones', () => {
  const parser = {
    parse: text => {
      const match = String(text).match(/@remind\s+(\d{4}-\d{2}-\d{2})/);
      return match ? { date: match[1], time: '', at: new Date(`${match[1]}T00:00:00`), raw: match[0] } : null;
    },
  };
  const byLine = helpers.collectReminderItems([note('a', { body: [
    'Call the plumber @remind 2026-09-01',
    '- [x] Already done @remind 2026-09-02',
    '- [ ] Still open @remind 2026-09-03',
    'plain prose',
  ].join('\n') })], parser);
  assert.deepEqual(byLine.map(r => r.text), ['Call the plumber', '- [ ] Still open'],
    'a ticked line is not a pending reminder; an open one keeps the line as written');
  assert.equal(byLine[0].noteId, 'a');
  assert.equal(byLine[0].noteTitle, 'Note a');
  assert.ok(byLine[0].key.includes('2026-09-01'), 'each reminder carries a key naming where it came from');

  const byBlock = helpers.collectReminderItems([{
    ...note('b'),
    blocks: [
      { id: 'b1', kind: 'todo', checked: true, content: 'Done @remind 2026-09-01' },
      { id: 'b2', kind: 'todo', checked: false, content: 'Open @remind 2026-09-02', children: [
        { id: 'b3', kind: 'text', content: 'Nested @remind 2026-09-03' },
      ] },
    ],
  }], parser, walk);
  assert.deepEqual(byBlock.map(r => r.blockId), ['b2', 'b3'], 'blocks are walked, including children');

  // A defer marker rides along and is stripped from the visible text.
  const deferred = helpers.collectReminderItems([note('c', { body: 'Wait @remind 2026-09-01 @defer 2026-08-30' })], parser);
  assert.equal(deferred[0].deferUntil, '2026-08-30');
  assert.equal(deferred[0].text, 'Wait');

  assert.deepEqual(helpers.collectReminderItems([note('a')], null), [],
    'without a parser there are no reminders, rather than a crash');
  assert.deepEqual(helpers.collectReminderItems(null, parser), []);
});

test('an item key names the exact line or block an action came from', () => {
  const base = { noteId: 'n1', text: 'Do it' };
  assert.notEqual(helpers.taskItemKey({ ...base, line: 3 }), helpers.taskItemKey({ ...base, line: 4 }),
    'the same text on two lines is two different actions');
  assert.equal(helpers.taskItemKey({ ...base, blockId: 'b1', line: 3 }),
    helpers.taskItemKey({ ...base, blockId: 'b1', line: 9 }),
    'a block id identifies the action wherever the block moves to');
  assert.match(helpers.taskItemKey({ ...base, isReminderOnly: true }), /^reminder\|/);
  assert.match(helpers.taskItemKey(base), /^todo\|/);
  assert.match(helpers.taskItemKey({ ...base, type: 'custom' }), /^custom\|/);
  assert.match(helpers.taskItemKey({ ...base, remindAt: { date: '2026-09-01', time: '10:00' }, deferUntil: '2026-08-30' }),
    /2026-09-01\|10:00\|2026-08-30/);
});

test('defer markers are parsed, stripped and honoured', () => {
  assert.deepEqual(helpers.agendaParseDeferMarker('Task @defer 2026-09-01'),
    { raw: '@defer 2026-09-01', date: '2026-09-01', marker: 'defer' });
  assert.equal(helpers.agendaParseDeferMarker('Task @hide-until 2026-09-01').marker, 'hide-until',
    'hide-until is the same thing said differently');
  assert.equal(helpers.agendaParseDeferMarker('Task @defer 2026-13-45'), null, 'an impossible date is not a defer');
  assert.equal(helpers.agendaParseDeferMarker('Task @defer 2026-13-45 @defer 2026-09-01').date, '2026-09-01',
    'a bad marker does not stop a good one later in the line being found');
  assert.equal(helpers.agendaParseDeferMarker('no marker'), null);
  assert.equal(helpers.agendaParseDeferMarker(), null);
  assert.equal(helpers.agendaParseDeferMarker('email@defer 2026-09-01'), null,
    'a marker has to stand on its own, not sit inside a word');

  assert.equal(helpers.agendaStripDeferMarkers('Task @defer 2026-09-01 more'), 'Task more');
  assert.equal(helpers.agendaStripDeferMarkers(''), '');
  assert.equal(helpers.agendaCleanActionText('- [x] Do it @remind 2026-09-01 @defer 2026-09-02'), 'Do it');
  assert.equal(helpers.agendaCleanActionText(), '');

  const now = new Date('2026-08-05T12:00:00');
  assert.equal(helpers.agendaIsDeferred({ deferUntil: '2030-01-01' }, now), true);
  assert.equal(helpers.agendaIsDeferred({ deferUntil: '2020-01-01' }, now), false, 'a past defer date has expired');
  assert.equal(helpers.agendaIsDeferred({ deferUntil: '2030-01-01', checked: true }, now), false,
    'a finished action is not waiting for anything');
  assert.equal(helpers.agendaIsDeferred({ text: 'x @defer 2030-01-01' }, now), true,
    'the marker is read from the text when no date was extracted');
  assert.equal(helpers.agendaIsDeferred({ label: 'x @defer 2030-01-01' }, now), true);
  assert.equal(helpers.agendaIsDeferred({}, now), false);
});

test('a task line is rebuilt with only the markers it deserves', () => {
  assert.equal(helpers.agendaBuildTaskContent('Pay rent', '2026-09-01', '10:00'), 'Pay rent @remind 2026-09-01 10:00');
  assert.equal(helpers.agendaBuildTaskContent('Pay rent', '2026-09-01'), 'Pay rent @remind 2026-09-01');
  assert.equal(helpers.agendaBuildTaskContent('Pay rent', '', '', '2026-08-30'), 'Pay rent @defer 2026-08-30');
  assert.equal(helpers.agendaBuildTaskContent('Pay rent', 'not a date'), 'Pay rent', 'an unusable date is dropped');
  assert.equal(helpers.agendaBuildTaskContent('  '), '', 'an empty task has no line');
  assert.equal(helpers.agendaBuildTaskContent('- [ ] Pay rent @remind 2026-01-01', '2026-09-01'),
    'Pay rent @remind 2026-09-01', 'the old markers are replaced, not stacked');
});

test('an action is located in a body by its text, and replaced only when unique', () => {
  const body = ['- [ ] Buy milk', '- [x] Ship it', 'plain prose', 'Call back @remind 2026-09-01'].join('\n');
  assert.equal(helpers.agendaBodyHasActionText(body, 'Buy milk'), true);
  assert.equal(helpers.agendaBodyHasActionText(body, '  buy   MILK '), true, 'matching ignores case and spacing');
  assert.equal(helpers.agendaBodyHasActionText(body, 'Ship it'), true);
  assert.equal(helpers.agendaBodyHasActionText(body, 'plain prose'), false, 'prose is not an action');
  assert.equal(helpers.agendaBodyHasActionText(body, 'Call back'), true, 'a reminder line is an action too');
  assert.equal(helpers.agendaBodyHasActionText(body, ''), false);
  assert.equal(helpers.agendaBodyHasActionText('', 'Buy milk'), false);

  assert.equal(helpers.agendaReplaceUniqueSourceText(body, '- [ ] Buy milk', '- [x] Buy milk'),
    body.replace('- [ ] Buy milk', '- [x] Buy milk'));
  const twice = '- [ ] Buy milk\n- [ ] Buy milk';
  assert.equal(helpers.agendaReplaceUniqueSourceText(twice, '- [ ] Buy milk', '- [x] Buy milk'), twice,
    'an ambiguous line is left alone rather than the wrong one being changed');
  assert.equal(helpers.agendaReplaceUniqueSourceText(body, 'not present', 'x'), body);
  assert.equal(helpers.agendaReplaceUniqueSourceText(body, '   ', 'x'), body);
});

test('tasks are collected from blocks when the note has them, lines when it does not', () => {
  const parser = {
    parse: text => {
      const match = String(text).match(/@remind\s+(\d{4}-\d{2}-\d{2})/);
      return match ? { date: match[1], time: '', at: new Date(`${match[1]}T00:00:00`), raw: match[0] } : null;
    },
    strip: text => String(text).replace(/@remind\s+\d{4}-\d{2}-\d{2}/g, '').trim(),
  };
  const blocks = helpers.collectTaskItems([{
    ...note('a'),
    blocks: [
      { id: 'b1', kind: 'todo', checked: false, content: 'Open task' },
      { id: 'b2', kind: 'todo', checked: true, content: 'Closed task' },
      { id: 'b3', kind: 'text', content: 'Just prose' },
      { id: 'b4', kind: 'text', content: 'A reminder @remind 2026-09-01' },
    ],
  }], parser, walk);
  assert.deepEqual(blocks.map(i => i.label), ['Open task', 'Closed task', 'A reminder'],
    'prose with no date is not an action; a checked todo still is one');
  assert.equal(blocks[1].checked, true);
  assert.equal(blocks[2].isReminderOnly, true);
  assert.equal(blocks[0].blockId, 'b1');

  const lines = helpers.collectTaskItems([note('b', { body: '- [ ] From a line\n- [X] Ticked\nprose' })], parser);
  assert.deepEqual(lines.map(i => i.label), ['From a line', 'Ticked']);
  assert.equal(lines[1].checked, true, 'an uppercase X ticks the box too');
  assert.equal(lines[0].line, 0);
  assert.deepEqual(helpers.collectTaskItems(null, parser), []);
  assert.deepEqual(helpers.collectTaskItems([note('c', { body: 'nothing here' })], parser), []);
  // Without a parser nothing can be recognised as a reminder, so a bare
  // @remind line contributes no action at all.
  assert.deepEqual(helpers.collectTaskItems([note('d', { body: 'Late @remind 2026-09-01' })]), []);
  assert.equal(helpers.collectTaskItems([note('e', { body: '- [ ] Still a task' })]).length, 1,
    'a checkbox is an action with or without a reminder parser');
});

test('a Zotero item builds a source note, or explains why it cannot', () => {
  const readResult = {
    item: {
      key: 'ABCD1234', title: 'On Something', itemType: 'journalArticle',
      creators: [{ firstName: 'Ada', lastName: 'Lovelace' }, { name: 'Institute' }],
      date: 'March 2021', publicationTitle: 'A Journal', DOI: '10.1/xyz', url: 'https://example.org',
      abstractNote: 'An abstract.',
    },
    attachments: [
      { key: 'ATT1', title: 'Paper', filename: 'paper.pdf', contentType: 'application/pdf' },
      { key: '', title: '' },
    ],
    fullText: 'The opening words.',
    fullTextTruncated: true,
  };
  const draft = helpers.zoteroBuildSourceNoteDraft(readResult);
  assert.equal(draft.itemKey, 'ABCD1234');
  assert.equal(draft.title, 'On Something');
  assert.equal(draft.source.creators, 'Ada Lovelace, Institute',
    'a creator with only a name is listed alongside first/last ones');
  assert.equal(draft.source.year, '2021', 'the year is picked out of a free-text date');
  assert.equal(draft.source.doi, '10.1/xyz', 'DOI is read whichever way it is spelled');
  assert.deepEqual(draft.source.attachments.map(a => a.title), ['Paper', 'Attachment'],
    'an attachment with no name of its own is still listed, as "Attachment"');
  assert.match(draft.body, /zoteroKey:: ABCD1234/);
  assert.match(draft.body, /## Abstract\nAn abstract\./);
  assert.match(draft.body, /- Paper - paper\.pdf - application\/pdf - ATT1/);
  assert.match(draft.body, /Excerpt truncated by VispNote\./);
  assert.match(draft.body, /## Reading tasks/);
  for (const tag of ['research', 'source', 'zotero']) assert.ok(draft.tags.includes(tag));

  // Nothing at all still produces a usable draft skeleton.
  const bare = helpers.zoteroBuildSourceNoteDraft({});
  assert.equal(bare.itemKey, '');
  assert.equal(bare.title, 'Zotero source');
  assert.ok(!bare.body.includes('## Abstract'));
  assert.ok(!bare.body.includes('## Attachments'));
  assert.ok(!bare.body.includes('## Full text excerpt'));

  const untruncated = helpers.zoteroBuildSourceNoteDraft({ item: { key: 'K1' }, fullText: 'Words.' });
  assert.match(untruncated.body, /## Full text excerpt\nWords\./);
  assert.ok(!untruncated.body.includes('truncated'));
  assert.equal(helpers.zoteroBuildSourceNoteDraft({ item: { key: 'K2' } }).title, 'Zotero source K2',
    'an item with no title is named by its key');
  assert.equal(helpers.zoteroBuildSourceNoteDraft({ item: { key: 'K3' } }, { title: '  Chosen  ' }).title, 'Chosen',
    'a caller can name the note itself');
});

test('an existing source note is opened rather than created twice', () => {
  const existing = note('src', { title: 'On Something', body: 'zoteroKey:: ABCD1234' });
  const readResult = { item: { key: 'ABCD1234', title: 'On Something' } };

  const create = helpers.zoteroBuildSourceNotePlan({ notes: [], readResult });
  assert.equal(create.action, 'create');
  assert.equal(create.createNote.title, 'On Something');
  assert.equal(create.existingNote, null);

  const open = helpers.zoteroBuildSourceNotePlan({ notes: [existing], readResult, itemKey: 'ABCD1234' });
  assert.equal(open.action, 'open');
  assert.equal(open.noteId, 'src');
  assert.equal(open.draft, null);

  // The key can arrive only inside the read result, and is matched case-blind.
  const found = helpers.zoteroBuildSourceNotePlan({ notes: [note('s2', { body: 'zoteroKey:: abcd1234' })], readResult });
  assert.equal(found.action, 'open');
  assert.equal(found.noteTitle, 'Note s2');

  const unavailable = helpers.zoteroBuildSourceNotePlan({ notes: [], readResult: {} });
  assert.equal(unavailable.action, 'unavailable');
  assert.equal(unavailable.error, 'A valid Zotero item key is required.');
  assert.equal(helpers.zoteroBuildSourceNotePlan({}).action, 'unavailable');

  assert.equal(helpers.zoteroFindSourceNote([existing], 'ABCD1234').id, 'src');
  assert.equal(helpers.zoteroFindSourceNote([existing], 'bad key!'), null, 'an unusable key finds nothing');
  assert.equal(helpers.zoteroFindSourceNote(null, 'ABCD1234'), null);
  assert.equal(helpers.zoteroCleanItemKey('  ABCD1234 '), 'ABCD1234');
  assert.equal(helpers.zoteroCleanItemKey('has space'), '');
});
