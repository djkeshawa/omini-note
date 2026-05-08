const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ops = require('../src/editorOps.js');
const tableOps = require('../src/tableOps.js');
const appHelpers = require('../src/appHelpers.js');
const appNovelist = require('../src/appNovelist.js');
const appMutations = require('../src/appMutations.js');
const appCanvasActions = require('../src/appCanvasActions.js');
const panelHelpers = require('../src/panelHelpers.js');
const aiActions = require('../src/aiActions.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');

test('App helpers expand templates, rank commands, and decorate search results', () => {
  const expanded = appHelpers.expandTemplate(appHelpers.templateById('daily'), { date: '2026-05-06' });
  assert.equal(expanded.noteTitle, '2026-05-06');
  assert.match(expanded.body, /# 2026-05-06/);
  assert.deepEqual(expanded.tags, ['daily']);

  const commands = [
    { id: 'settings', title: 'Open settings', section: 'System' },
    { id: 'daily', title: 'Open daily note', section: 'Create', keywords: 'journal today' },
    { id: 'disabled', title: 'Daily disabled', enabled: false },
  ];
  assert.deepEqual(appHelpers.filterCommands(commands, 'daily').map(cmd => cmd.id), ['daily']);

  const notes = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }];
  const decorated = appHelpers.decorateNotesWithSearchDetails(notes, new Map([
    ['b', { snippet: 'matched body', matchedFields: ['body'] }],
  ]));
  assert.equal(decorated[0].__searchSnippet, undefined);
  assert.equal(decorated[1].__searchSnippet, 'matched body');
  assert.deepEqual(decorated[1].__matchedFields, ['body']);
});

test('Ask AI action classifier routes app functions and high-risk prompts safely', () => {
  assert.deepEqual(aiActions.classifyPrompt('create a page called Launch checklist'), {
    type: 'action',
    action: { type: 'create-note', title: 'Launch checklist' },
  });
  assert.deepEqual(aiActions.classifyPrompt('summarize all my notes and create a new one and tag it under reading'), {
    type: 'action',
    action: {
      type: 'action-plan',
      title: 'Notes summary',
      steps: [
        {
          type: 'notes-answer',
          purpose: 'summary',
          prompt: 'summarize all my notes and create a new one and tag it under reading\n\nReturn a concise markdown note body only. Focus on the notes, decisions, tasks, dates, and named references that matter.',
        },
        {
          type: 'create-note',
          title: 'Notes summary',
          bodyFrom: 'previous-answer',
          tags: ['reading'],
        },
        { type: 'tag-created-note', tag: 'reading' },
      ],
    },
  });
  assert.deepEqual(aiActions.classifyPrompt('create a page called Launch checklist and tag it under reading'), {
    type: 'action',
    action: {
      type: 'action-plan',
      title: 'Launch checklist',
      steps: [
        {
          type: 'create-note',
          title: 'Launch checklist',
          bodyFrom: 'generate',
          tags: ['reading'],
        },
        { type: 'tag-created-note', tag: 'reading' },
      ],
    },
  });
  assert.deepEqual(aiActions.classifyPrompt('summarize this page'), {
    type: 'action',
    action: { type: 'edit-current', action: 'summarize' },
  });
  assert.deepEqual(aiActions.classifyPrompt('tag this for reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('tag this note with reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('tag current page as reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('tag for reading'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.deepEqual(aiActions.classifyPrompt('add reading tag'), {
    type: 'action',
    action: { type: 'tag-current-note', tag: 'reading' },
  });
  assert.equal(aiActions.classifyPrompt('which notes are tagged reading?').type, 'notes');
  assert.equal(aiActions.classifyPrompt('find my Python notes').type, 'notes');
  assert.equal(aiActions.classifyPrompt('list notes tagged bash').type, 'notes');
  assert.equal(aiActions.detectAction('tag it under reading'), null);
  assert.equal(aiActions.classifyPrompt('run a shell command to inspect files').action.type, 'high-risk-disabled');
});

test('App helpers collect reminders and workflow notes without renderer state', () => {
  const parser = {
    parse(text) {
      const match = String(text || '').match(/@remind\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
      if (!match) return null;
      return { raw: match[0], date: match[1], time: match[2] || '', at: new Date(`${match[1]}T${match[2] || '09:00'}:00.000Z`) };
    },
    strip(text) {
      return String(text || '').replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/, '').trim();
    },
  };
  const walk = (blocks, visit) => blocks.forEach(visit);
  const reminders = appHelpers.collectReminderItems([
    { id: 'n1', title: 'Body note', body: '- [ ] Call @remind 2026-05-06 10:30\n- [x] Done @remind 2026-05-06 11:00' },
    { id: 'n2', title: 'Block note', blocks: [
      { id: 'b1', kind: 'todo', checked: true, content: 'Ignored @remind 2026-05-06 12:00' },
      { id: 'b2', kind: 'todo', checked: false, content: 'Ship @remind 2026-05-07' },
    ] },
  ], parser, walk);
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].text, '- [ ] Call');
  assert.match(reminders[0].key, /^n1\|0\|2026-05-06\|10:30\|/);
  assert.equal(reminders[1].blockId, 'b2');
  assert.equal(appHelpers.reminderStatusLabel('snoozed'), 'Snoozed');

  const workflow = appHelpers.collectWorkflowNotes([
    { id: 'n1', title: 'Draft', tags: ['project'], body: 'status:: DRAFT\n# Draft\n- Body', modifiedAt: '2026-05-06T00:00:00.000Z' },
    { id: 'n2', title: 'Archived', tags: [], body: 'status:: DONE\nClosed', workflowArchived: true },
    { id: 'n3', title: 'No status', tags: [], body: 'Body' },
  ], [{ id: 'DRAFT' }, { id: 'DONE' }]);
  assert.equal(workflow.counts.DRAFT, 1);
  assert.equal(workflow.counts.DONE, 0);
  assert.deepEqual([...workflow.noteIdsByState.DRAFT], ['n1']);
  assert.deepEqual(workflow.archivedNotes.map(note => note.id), ['n2']);
  assert.equal(workflow.byState.DRAFT[0].text, 'Body');
});

test('App helpers normalize novelist notes and body properties', () => {
  let body = '# Scene\n- order:: 200\n- status:: DRAFT\n- chapter:: [[Chapter 1]]\nDraft text';
  assert.equal(appHelpers.bodyPropertyValue(body, 'status'), 'DRAFT');
  body = appHelpers.setBodyProperty(body, 'status', 'REVISE');
  assert.equal(appHelpers.bodyPropertyValue(body, 'status'), 'REVISE');
  body = appHelpers.removeBodyProperty(body, 'status');
  assert.equal(appHelpers.bodyPropertyValue(body, 'status'), '');
  assert.match(appHelpers.setBodyProperty('# Note\nBody', 'order', '100'), /order:: 100\nBody/);
  assert.equal(appHelpers.normalizeNoteBody('# Scene\n- status:: DRAFT\n- order:: 200\nDraft text', 'Scene'), 'status:: DRAFT\norder:: 200\nDraft text');
  assert.deepEqual(appHelpers.normalizeNovelistLegacyTags(['novel-manuscript', 'novel-arc', 'novel-scene']), ['novel-act', 'novel-scene']);
  assert.equal(appHelpers.normalizeNovelistLegacyBody('arc:: [[Arc 1]]\n## Arcs'), 'act:: [[Arc 1]]\n## Acts');
  assert.match(appHelpers.ensureScenePlotPoints('status:: DRAFT\nDraft', ['novel-scene']), /:::\s*plot-points/);
  assert.equal(appHelpers.replaceWikiLinkTitle('See [[Old#A|alias]]', 'Old', 'New'), 'See [[New#A|alias]]');

  const structure = appHelpers.buildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 'c2', title: 'Chapter B', tags: ['novel-chapter'], body: '# Chapter B\n- order:: 120\n- act:: [[Act]]', modifiedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c1', title: 'Chapter A', tags: ['novel-chapter'], body: '# Chapter A\n- order:: 110\n- act:: [[Act]]', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { id: 's', title: 'Scene', tags: ['novel-scene'], body: '# Scene\n- chapter:: [[Chapter A]]' },
  ]);
  assert.deepEqual(Array.from(structure.childrenByActId.a), ['c1', 'c2']);
  assert.equal(structure.parentBySceneId.s, 'c1');

  const disk = appHelpers.noteForDisk({
    id: 'n1',
    title: 'Scene',
    date: '2026-05-06T00:00:00.000Z',
    tags: ['novel-arc', 'novel-scene'],
    pinned: true,
    workflowArchived: true,
    blocks: [{ content: '# Scene\narc:: [[Act]]\nDraft', children: [] }],
  }, blocks => blocks.map(block => block.content).join('\n'));
  assert.equal(disk.pinned, true);
  assert.equal(disk.workflowArchived, true);
  assert.deepEqual(disk.tags, ['novel-act', 'novel-scene']);
  assert.match(disk.body, /act:: \[\[Act\]\]/);
  assert.doesNotMatch(disk.body, /^# Scene/m);
});

test('App mutations build note, tag, rename, and canvas updates without renderer state', () => {
  const mdToBlocks = body => [{ id: 'b1', kind: 'paragraph', content: body, children: [] }];
  const blocksToMd = blocks => (blocks || []).map(block => block.content).join('\n');
  const makeEmptyBlock = () => ({ id: 'empty', kind: 'paragraph', content: '', children: [] });
  const mutationCtx = {
    normalizeTagName: appHelpers.normalizeTagName,
    parseDefaultTags: appHelpers.parseDefaultTags,
    normalizeNoteBody: appHelpers.normalizeNoteBody,
    ensureScenePlotPoints: appHelpers.ensureScenePlotPoints,
    mdToBlocks,
    blocksToMd,
    makeEmptyBlock,
  };

  assert.equal(appMutations.uniqueNoteTitle([{ id: 'n1', title: 'Draft' }], 'Draft'), 'Draft 2');
  const draft = appMutations.createNoteDraft({
    id: 'n2',
    title: ' Scene ',
    body: '# Scene\nDraft',
    tags: ['Novel Scene'],
    defaultTags: 'Daily, novel scene',
    existingTags: [{ name: 'daily', hue: 10 }],
    now: '2026-05-06T00:00:00.000Z',
  }, mutationCtx);
  assert.equal(draft.note.title, 'Scene');
  assert.deepEqual(draft.note.tags, ['novel-scene', 'daily']);
  assert.deepEqual(draft.missingTags, ['novel-scene']);
  assert.doesNotMatch(draft.note.body, /^# Scene/m);
  assert.match(draft.note.body, /plot-points/);

  const addedTags = appMutations.addTagsToList([{ name: 'daily', hue: 10 }], draft.missingTags, () => 40);
  assert.deepEqual(addedTags, [{ name: 'daily', hue: 10 }, { name: 'novel-scene', hue: 40 }]);
  const duplicate = appMutations.duplicateNoteDraft(draft.note, {
    id: 'n3',
    title: 'Scene copy',
    now: '2026-05-07T00:00:00.000Z',
  }, mutationCtx);
  assert.equal(duplicate.id, 'n3');
  assert.equal(duplicate.pinned, false);

  const renamed = appMutations.renameNoteTitleDrafts([
    { id: 'a', title: 'Old', body: 'Body', blocks: mdToBlocks('Body') },
    { id: 'b', title: 'Ref', body: 'See [[Old]]', blocks: mdToBlocks('See [[Old]]') },
  ], 'a', 'New', {
    blocksToMd,
    mdToBlocks,
    replaceWikiLinkTitle: appHelpers.replaceWikiLinkTitle,
    normalizeNoteBody: appHelpers.normalizeNoteBody,
    now: '2026-05-08T00:00:00.000Z',
  });
  assert.deepEqual(renamed.dirtyIds, ['a', 'b']);
  assert.equal(renamed.notes.find(note => note.id === 'b').body, 'See [[New]]');

  const removed = appMutations.removeTagFromNotes([{ id: 'n', tags: ['daily', 'work'] }], 'daily', '2026-05-09T00:00:00.000Z');
  assert.deepEqual(removed.dirtyIds, ['n']);
  assert.deepEqual(removed.notes[0].tags, ['work']);

  const canvases = appMutations.upsertCanvasList([
    { id: 'old', title: 'Old', modifiedAt: '2026-05-01T00:00:00.000Z' },
  ], { id: 'new', title: '', modifiedAt: '2026-05-10T00:00:00.000Z', elements: [{ id: 'e' }] });
  assert.equal(canvases[0].title, 'Untitled canvas');
  assert.equal(canvases[0].elementCount, 1);
});

test('App canvas actions orchestrate canvas state without renderer state', async () => {
  const calls = [];
  const notices = [];
  const logs = [];
  let canvases = [{ id: 'old', title: 'Old', modifiedAt: '2026-05-01T00:00:00.000Z' }];
  let vaults = [{ id: 'v1', canvases }];
  let activeCanvas = { id: 'old' };
  let selectedTag = 'work';
  let selectedWorkflow = 'DRAFT';
  let query = 'canvas';
  const ctx = {
    activeVaultId: 'v1',
    activeCanvas,
    canvases,
    hasDisk: true,
    mn: {
      async getCanvas(vaultId, canvasId) {
        calls.push(['get', vaultId, canvasId]);
        return { ok: true, value: { id: canvasId, title: 'Loaded', modifiedAt: '2026-05-02T00:00:00.000Z', elements: [] } };
      },
      async saveCanvas(vaultId, canvas) {
        calls.push(['save', vaultId, canvas.id]);
        return { ok: true, value: { ...canvas, title: `${canvas.title} saved`, modifiedAt: '2026-05-03T00:00:00.000Z' } };
      },
      async deleteCanvas(vaultId, canvasId) {
        calls.push(['delete', vaultId, canvasId]);
        return { ok: true };
      },
    },
    newCanvas(title) {
      return { id: 'new', title, modifiedAt: '2026-05-02T00:00:00.000Z', elements: [] };
    },
    upsertCanvasList: appMutations.upsertCanvasList,
    setCanvases(value) {
      canvases = typeof value === 'function' ? value(canvases) : value;
      ctx.canvases = canvases;
    },
    setVaults(value) {
      vaults = typeof value === 'function' ? value(vaults) : value;
    },
    setActiveCanvas(value) {
      activeCanvas = typeof value === 'function' ? value(activeCanvas) : value;
      ctx.activeCanvas = activeCanvas;
    },
    setSelectedTag(value) { selectedTag = value; },
    setSelectedWorkflow(value) { selectedWorkflow = value; },
    setQuery(value) { query = value; },
    navigateView(view) { calls.push(['navigate', view]); },
    showAppNotice(title, message) { notices.push([title, message]); },
    logError(...args) { logs.push(args); },
  };

  appCanvasActions.openCanvasDashboard(ctx);
  assert.equal(activeCanvas, null);
  assert.equal(selectedTag, null);
  assert.equal(selectedWorkflow, null);
  assert.equal(query, '');
  assert.deepEqual(calls.at(-1), ['navigate', 'canvas']);

  const loaded = await appCanvasActions.openCanvas('remote', ctx);
  assert.equal(loaded.title, 'Loaded');
  assert.equal(activeCanvas.id, 'remote');
  assert.deepEqual(calls.find(call => call[0] === 'get'), ['get', 'v1', 'remote']);

  const created = await appCanvasActions.createCanvas('Sketch', {}, ctx);
  assert.equal(created.title, 'Sketch saved');
  assert.equal(activeCanvas.id, 'new');
  assert.equal(canvases[0].id, 'new');
  assert.equal(vaults[0].canvases[0].id, 'new');

  const saved = await appCanvasActions.saveCanvas({ id: 'new', title: 'Updated', elements: [] }, ctx);
  assert.equal(saved.title, 'Updated saved');
  assert.equal(activeCanvas.title, 'Updated saved');

  const deleted = await appCanvasActions.deleteCanvas('new', ctx);
  assert.equal(deleted.ok, true);
  assert.equal(activeCanvas, null);
  assert.equal(canvases.some(canvas => canvas.id === 'new'), false);
  assert.deepEqual(calls.filter(call => call[0] === 'delete')[0], ['delete', 'v1', 'new']);

  const failingCtx = {
    ...ctx,
    canvases,
    mn: { async saveCanvas() { return { ok: false, error: 'disk full' }; } },
  };
  const failed = await appCanvasActions.createCanvas('Broken', {}, failingCtx);
  assert.equal(failed, null);
  assert.deepEqual(notices.at(-1), ['Could not create canvas', 'disk full']);
  assert.equal(logs.at(-1)[0], 'saveCanvas failed');
});

test('Novelist hierarchy is inferred from act properties and explicit structure tags', () => {
  const structure = appNovelist.mnBuildNovelistStructure([
    { id: 'm', title: 'Old Manuscript', tags: [], body: '# Old Manuscript\n- [[Act One]]\n  - [[Chapter 1]]\n    - [[Opening Scene]]' },
    { id: 'a', title: 'Act One', tags: ['novel-act'], body: '# Act One\n- [[Chapter 1]]' },
    { id: 'c', title: 'Chapter 1', tags: ['novel-chapter'], body: '# Chapter 1\n- act:: [[Act One]]\n- [[Opening Scene]]' },
    { id: 's', title: 'Opening Scene', tags: ['novel-scene'], body: '# Opening Scene\n- chapter:: [[Chapter 1]]' },
  ]);
  const ids = (items) => Array.from(items, note => note.id);

  assert.deepEqual(ids(structure.acts), ['a']);
  assert.deepEqual(ids(structure.chapters), ['c']);
  assert.deepEqual(ids(structure.scenes), ['s']);
  assert.equal(structure.parentByChapterId.c, 'a');
  assert.equal(structure.parentBySceneId.s, 'c');
  assert.deepEqual(ids(structure.pathByNoteId.s), ['a', 'c', 's']);
});

test('Novelist order and note-level status properties drive visible workflow', () => {
  let body = '# Scene\n- order:: 200\n- status:: DRAFT\n- chapter:: [[Chapter 1]]\nDraft text';
  assert.equal(appNovelist.mnBodyPropertyValue(body, 'status'), 'DRAFT');
  body = appNovelist.mnSetBodyProperty(body, 'status', 'REVISE');
  assert.equal(appNovelist.mnBodyPropertyValue(body, 'status'), 'REVISE');
  body = appNovelist.mnRemoveBodyProperty(body, 'status');
  assert.equal(appNovelist.mnBodyPropertyValue(body, 'status'), '');
  assert.match(appNovelist.mnSetBodyProperty('# Note\nBody', 'order', '100'), /order:: 100\nBody/);
  assert.doesNotMatch(appNovelist.mnSetBodyProperty('# Note\nBody', 'order', '100'), /- order::/);
  assert.equal(
    appNovelist.mnNormalizeNoteBody('# Scene\n- status:: DRAFT\n- order:: 200\nDraft text', 'Scene'),
    'status:: DRAFT\norder:: 200\nDraft text'
  );

  const structure = appNovelist.mnBuildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 'c2', title: 'Chapter B', tags: ['novel-chapter'], body: '# Chapter B\n- order:: 120\n- act:: [[Act]]', modifiedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c1', title: 'Chapter A', tags: ['novel-chapter'], body: '# Chapter A\n- order:: 110\n- act:: [[Act]]', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c3', title: 'Chapter C', tags: ['novel-chapter'], body: '# Chapter C\n- act:: [[Act]]', modifiedAt: '2026-01-03T00:00:00.000Z' },
  ]);
  assert.deepEqual(Array.from(structure.childrenByActId.a), ['c1', 'c2', 'c3']);

  const workflow = appHelpers.collectWorkflowNotes([
    { id: 'n1', title: 'Note status', tags: [], body: '# Note\n- status:: DRAFT\nBody', blocks: [{ id: 'b1', workflow: 'DONE', content: 'Block marker' }] },
    { id: 'n2', title: 'Block only', tags: [], body: '# Block only\nBody', blocks: [{ id: 'b2', workflow: 'DRAFT', content: 'Should be ignored' }] },
  ], [{ id: 'DRAFT' }, { id: 'DONE' }], { propertyValue: appNovelist.mnBodyPropertyValue });
  assert.equal(workflow.counts.DRAFT, 1);
  assert.equal(workflow.counts.DONE, 0);
  assert.deepEqual([...workflow.noteIdsByState.DRAFT], ['n1']);

  const converted = appNovelist.mnBuildNovelistStructure([
    { id: 'a', title: 'Act', tags: ['novel-act'], body: '# Act\n- order:: 100' },
    { id: 's', title: 'Converted', tags: ['novel-scene'], body: '# Converted\n- act:: [[Act]]' },
  ]);
  assert.deepEqual(Array.from(converted.chapters, note => note.id), []);
  assert.deepEqual(Array.from(converted.scenes, note => note.id), ['s']);
  assert.deepEqual(appNovelist.mnNormalizeNovelistLegacyTags(['novel-manuscript', 'novel-arc', 'novel-scene']), ['novel-act', 'novel-scene']);
  assert.equal(
    appNovelist.mnNormalizeNovelistLegacyBody('arc:: [[Arc 1]]\n## Arcs'),
    'act:: [[Arc 1]]\n## Acts'
  );

  const panels = fs.readFileSync(path.join(__dirname, '../src/panels.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');
  assert.doesNotMatch(panels, /## Chapters\\n- '\s*}/);
  assert.doesNotMatch(panels, /## Scenes\\n- '\s*}/);
  assert.doesNotMatch(panels, /body: '# (Story Root|Act|Chapter|Scene|Character|Location|Plot Thread|Research|Revision Note)/);
  assert.match(editor, /function mnEditorSplitPropertyBlocks/);
  assert.match(editor, /blocks=\{contentBlocks\}/);
  assert.match(editor, /status::/);
  assert.match(editor, /function mnEditorCleanPropertyKey/);
  assert.match(editor, /\+ property/);
  assert.match(editor, /removeMetadataProperty/);
  assert.doesNotMatch(editor, /borderTop: `1px solid \$\{T\.lineSub\}`,[\s\S]*borderBottom: `1px solid \$\{T\.lineSub\}`/);
  const outliner = fs.readFileSync(path.join(__dirname, '../src/outliner.jsx'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/blockFeatures.jsx'), 'utf8');
  assert.match(outliner, /id: 'block-label'/);
  assert.match(outliner, /blockLabelAction/);
  assert.match(outliner, /Marker: \$\{state\.id\}/);
  assert.match(outliner, /setLabelMenu/);
  assert.match(blockFeatures, /label="Add label"/);
});
