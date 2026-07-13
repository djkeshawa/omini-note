const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const assistance = require('../src/features/assistance/contextualAssistanceModel.js');

test('contextual assistance offers the focused source-linked actions', () => {
  assert.deepEqual(assistance.ACTIONS.map(action => action.id), [
    'brief', 'outline', 'decisions', 'next-actions',
  ]);
  assert.ok(assistance.ACTIONS.every(action => action.instruction.includes('Return Markdown only')));
});

test('contextual assistance creates ordinary Markdown with one deterministic source link', () => {
  const output = assistance.buildOutput({
    actionId: 'brief',
    sourceNote: { id: 'note_1', title: 'Launch [decision]' },
    text: '```markdown\n## Overview\nShip locally.\n\n## Sources\n- hallucinated\n```',
  });
  assert.equal(output.title, 'Launch decision - Brief');
  assert.equal(output.source.id, 'note_1');
  assert.match(output.body, /^## Overview\nShip locally\./);
  assert.match(output.body, /## Source\n- \[\[Launch decision\]\]\n$/);
  assert.doesNotMatch(output.body, /hallucinated/);
});

test('all note-writing assistance is preview-before-apply', () => {
  const renderers = fs.readFileSync(path.join(__dirname, '../src/editor/outlinerRenderers.jsx'), 'utf8');
  const actionsBlock = renderers.slice(renderers.indexOf('const MN_AI_ACTIONS'), renderers.indexOf('function mnAiAction'));
  assert.equal((actionsBlock.match(/preview: true/g) || []).length, 6);
  const component = fs.readFileSync(path.join(__dirname, '../src/features/assistance/ContextualAssistance.jsx'), 'utf8');
  assert.match(component, /aria-labelledby="mn-assistance-preview-title"/);
  assert.match(component, /Create linked note/);
  assert.match(component, /actionFocusRef\.current\?\.focus/);
  assert.match(component, /event\.key !== 'Tab'/);
  assert.match(component, /!String\(sourceMarkdown \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(component, /onBlocksChange|updateNoteBody/);
});

test('assistance settings initialize from app state and reject stale async state', () => {
  const section = fs.readFileSync(path.join(__dirname, '../src/settings/sections/AssistanceSection.jsx'), 'utf8');
  assert.match(section, /useStateS\(\(\) => \(\{ enabled: assistanceEnabled \}\)\)/);
  assert.match(section, /const assistanceEnabledRef = useRefS\(assistanceEnabled\)/);
  assert.match(section, /enabled: assistanceEnabledRef\.current/);
  assert.match(section, /disabled=\{configLoading\}/);
  assert.match(section, /Could not save AI settings/);
});
