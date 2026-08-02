const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../src/editor/markdownInputRules.js');
const parse = (rules.MN_MARKDOWN_INPUT_RULES || rules).parseEditableMarkdownBlock;

// Typing "> " should behave like every other block starter. It did not: the
// quote pattern made the space optional, so ">" alone converted the block to a
// quote and the space the user typed next became the block's content -- the
// editable text came back as ">  " with a doubled space, and stayed doubled.

const paragraph = { id: 'b', kind: 'paragraph', content: '' };

test('a lone ">" does not convert the block yet', () => {
  assert.equal(parse({ block: paragraph, text: '>' })?.patch?.kind, undefined);
});

test('"> " converts to an empty quote, not a quote containing a space', () => {
  const patch = parse({ block: paragraph, text: '> ' })?.patch;
  assert.equal(patch.kind, 'quote');
  assert.equal(patch.content, '', `quote content was ${JSON.stringify(patch.content)}`);
});

test('quote text round-trips without gaining a space', () => {
  const patch = parse({ block: paragraph, text: '> quoted line' })?.patch;
  assert.equal(patch.content, 'quoted line');
  // Reparsing the editable projection must be stable.
  const again = parse({ block: { ...paragraph, kind: 'quote' }, text: `> ${patch.content}` })?.patch;
  assert.equal(again.content, 'quoted line', 'content grew or shrank on a second pass');
});

test('every block starter requires its space before converting', () => {
  // The quote pattern was the only one that did not, which is what let the
  // space become content.
  const partial = { '#': 'heading', '-': 'bullet', '>': 'quote', '1.': 'ordered' };
  for (const [prefix, kind] of Object.entries(partial)) {
    const patch = parse({ block: paragraph, text: prefix })?.patch;
    assert.notEqual(patch?.kind, kind, `"${prefix}" converted to ${kind} before the space was typed`);
  }
});
