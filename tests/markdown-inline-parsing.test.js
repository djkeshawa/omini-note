const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../src/editor/markdownInputRules.js');

// Inline markdown in the outliner: what becomes a link, what becomes emphasis,
// and above all what must stay plain text. Every "unsafe" verdict here is the
// editor refusing to render something clickable that it cannot vouch for.
// markdown-input-rules.test.js pins the block starters; this pins the inline
// parser and the editable-markdown round trip.

const kinds = text => rules.parseInlineMarkdown(text).map(s => s.kind);
const texts = text => rules.parseInlineMarkdown(text).map(s => s.text);
const roundTrip = text => rules.serializeInlineMarkdown(rules.parseInlineMarkdown(text));

test('emphasis, code and strikethrough parse when they are well formed', () => {
  assert.deepEqual(rules.parseInlineMarkdown('**bold**'), [{ kind: 'bold', text: 'bold', marker: '**' }]);
  assert.deepEqual(rules.parseInlineMarkdown('*italic*'), [{ kind: 'italic', text: 'italic', marker: '*' }]);
  assert.deepEqual(rules.parseInlineMarkdown('`code`'), [{ kind: 'code', text: 'code', marker: '`' }]);
  assert.deepEqual(rules.parseInlineMarkdown('~~gone~~'), [{ kind: 'strike', text: 'gone', marker: '~~' }]);
  assert.deepEqual(kinds('a **b** c *d* e'), ['text', 'bold', 'text', 'italic', 'text']);
  assert.deepEqual(texts('a **b** c'), ['a ', 'b', ' c']);
  assert.deepEqual(rules.parseInlineMarkdown(''), []);
  assert.deepEqual(rules.parseInlineMarkdown(null), []);
});

test('an unclosed or empty marker stays exactly as it was typed', () => {
  for (const text of ['**unclosed', '*unclosed', '`unclosed', '~~unclosed', '****', '``', '~~~~', '** **']) {
    assert.deepEqual(kinds(text), ['text'], `${text} should not become a formatted span`);
    assert.equal(roundTrip(text), text, `${text} must survive a round trip unchanged`);
  }
  assert.deepEqual(kinds('**across\nlines**'), ['text'], 'a marker cannot span a line break');
  assert.deepEqual(kinds('`code\nbreak`'), ['text']);
});

test('markers cannot be nested, so half-typed emphasis is left alone', () => {
  assert.deepEqual(kinds('**bold *and italic***'), ['text'], 'a nested marker makes the whole span plain');
  assert.deepEqual(kinds('**bold `code`**'), ['text']);
  assert.deepEqual(kinds('**bold [link](https://example.org)**'), ['text']);
  assert.deepEqual(kinds('`code with **stars**`'), ['code'], 'code is literal, so markers inside it are text');
  assert.equal(rules.parseInlineMarkdown('`code with **stars**`')[0].text, 'code with **stars**');
  assert.deepEqual(kinds('*italic with **bold** inside*'), ['text']);
});

test('a backslash escapes a marker instead of formatting', () => {
  for (const text of ['\\**not bold**', '\\*not italic*', '\\`not code`', '\\~~not strike~~', '\\[not a link](x)']) {
    assert.deepEqual(kinds(text), ['text'], `${text} should stay plain`);
  }
  assert.equal(rules.parseInlineMarkdown('\\**bold**')[0].text, '\\**bold**',
    'the escape is kept so the text round-trips');
  assert.deepEqual(kinds('a \\\\ b'), ['text']);
  assert.deepEqual(kinds('\\x plain'), ['text'], 'a backslash before an ordinary character is just text');
});

test('a link is only rendered when its target is one the editor can vouch for', () => {
  const link = text => rules.parseInlineMarkdown(text)[0];
  assert.deepEqual(link('[Example](https://example.org)'),
    { kind: 'link', text: 'Example', label: 'Example', url: 'https://example.org', safe: true });
  assert.equal(link('[Example](http://example.org)').kind, 'link');

  for (const text of [
    '[Example](javascript:alert(1))',
    '[Example](data:text/html,<script>)',
    '[Example](file:///etc/passwd)',
    '[Example](//example.org)',
    '[Example]( https://example.org)',
    '[Example](https://exa mple.org)',
    '[Example](not a url)',
    '[](https://example.org)',
    '[Example]()',
  ]) {
    assert.deepEqual(kinds(text), ['text'], `${text} must not become a clickable link`);
  }
  assert.deepEqual(kinds('[[A wiki link]]'), ['text'], 'a wiki link is handled elsewhere, not here');
  assert.deepEqual(kinds('[unclosed](https://example.org'), ['text']);
  assert.deepEqual(kinds('[label] (https://example.org)'), ['text'], 'a space between the parts is not a link');
});

test('the reasons a link is refused are reported, not just the refusal', () => {
  const why = (label, url) => rules.classifyMarkdownLink(label, url).reason;
  assert.equal(rules.classifyMarkdownLink('Example', 'https://example.org').safe, true);
  assert.equal(why('  ', 'https://example.org'), 'empty-label');
  assert.equal(why('Example', ''), 'empty-url');
  assert.equal(why('Example', ' https://example.org'), 'url-whitespace');
  assert.equal(why('Example', 'https://exa mple.org'), 'url-control-or-space');
  assert.equal(why('Example', '//example.org'), 'protocol-relative');
  assert.equal(why('Example', 'https://example.org/a(b)'), 'nested-parentheses');
  assert.equal(why('Example', 'not a url'), 'url-control-or-space');
  assert.equal(why('Example', 'notaurl'), 'malformed-url');
  assert.equal(why('Example', 'javascript:alert(1)'), 'nested-parentheses');
  assert.equal(why('Example', 'ftp://example.org'), 'unsafe-scheme');
  assert.equal(rules.classifyMarkdownLink('Example', 'https://example.org').protocol, 'https:');
  assert.equal(rules.isSafeMarkdownUrl('https://example.org'), true);
  assert.equal(rules.isSafeMarkdownUrl('javascript:alert(1)'), false);
});

test('an image is rendered only from an attachment or a plain http(s) URL', () => {
  const image = text => rules.parseInlineMarkdown(text)[0];
  assert.equal(image('![Alt](https://example.org/pic.png)').kind, 'image');
  assert.equal(image('![Alt](https://example.org/pic.png)').source, 'remote');
  assert.equal(image('![](https://example.org/pic.png)').kind, 'image',
    'an image with no alt text is still an image, unlike a link with no label');

  for (const text of [
    '![Alt](javascript:alert(1))',
    '![Alt](//example.org/pic.png)',
    '![Alt]( https://example.org/pic.png)',
    '![Alt]()',
    '![Alt](notaurl)',
  ]) {
    assert.deepEqual(kinds(text), ['text'], `${text} must not become an image`);
  }
  assert.deepEqual(kinds('![[An embed]]'), ['text'], 'the embed syntax is left for the embed renderer');
  assert.deepEqual(kinds('![Alt](https://example.org/pic.png'), ['text']);

  const why = (alt, url) => rules.classifyMarkdownImage(alt, url).reason;
  assert.equal(why('Alt', ''), 'empty-url');
  assert.equal(why('Alt', ' https://x/p.png'), 'url-whitespace');
  assert.equal(why('Alt', '//x/p.png'), 'protocol-relative');
  assert.equal(why('Alt', 'https://x/p(1).png'), 'nested-parentheses');
  assert.equal(why('Alt', 'ftp://x/p.png'), 'unsafe-scheme');
  assert.equal(why('Alt', 'notaurl'), 'malformed-url');
});

test('inline markdown round-trips through the serializer', () => {
  for (const text of [
    'plain text',
    'a **bold** word',
    'a *italic* word',
    'a `code` word',
    'a ~~struck~~ word',
    'a [link](https://example.org) here',
    'an ![image](https://example.org/p.png) here',
    'mixed **bold** and [link](https://example.org)',
  ]) {
    assert.equal(roundTrip(text), text, `${text} must survive parse and serialize`);
  }
  assert.equal(rules.serializeInlineMarkdown([{ kind: 'unknown', text: 'x' }]), 'x',
    'a segment kind the serializer does not know is written as its text');
  assert.equal(rules.serializeInlineMarkdown([null, undefined]), '');
  assert.equal(rules.serializeInlineMarkdown(), '');
  assert.equal(rules.serializeInlineMarkdown([{ kind: 'link', text: 'fallback', url: 'https://x' }]),
    '[fallback](https://x)', 'a link with no label is written with its text');
});

test('a block is turned into editable markdown and read back the same way', () => {
  const cases = [
    [{ kind: 'heading', level: 3, content: 'A heading' }, '### A heading'],
    [{ kind: 'bullet', content: 'An item' }, '- An item'],
    [{ kind: 'ordered', listNumber: 4, listDelimiter: ')', content: 'An item' }, '4) An item'],
    [{ kind: 'todo', checked: true, content: 'Done' }, '- [x] Done'],
    [{ kind: 'todo', checked: false, content: 'Open' }, '- [ ] Open'],
    [{ kind: 'quote', content: 'Quoted' }, '> Quoted'],
    [{ kind: 'paragraph', content: 'Plain' }, 'Plain'],
    [{ kind: 'divider' }, '---'],
  ];
  for (const [block, markdown] of cases) {
    assert.equal(rules.editableMarkdownForBlock(block), markdown, `${block.kind} should edit as ${markdown}`);
  }
  assert.equal(rules.editableMarkdownForBlock(null), '');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'heading', level: 99, content: 'x' }), '###### x',
    'a heading level beyond six is clamped');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'heading', content: 'x' }), '# x');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'ordered', content: 'x' }), '1. x');

  const parse = text => rules.parseEditableMarkdownBlock({ block: { kind: 'paragraph' }, text })?.patch;
  assert.equal(parse('### A heading').level, 3);
  assert.equal(parse('###  Extra space').content, 'Extra space', 'spaces after the hashes open the heading');
  assert.equal(parse('- [X] Done').checked, true);
  assert.equal(parse('- [ ] Open').checked, false);
  assert.equal(parse('- An item').kind, 'bullet');
  assert.equal(parse('4) An item').listDelimiter, ')');
  assert.equal(parse('4. An item').listNumber, 4);
  assert.equal(parse('> Quoted').kind, 'quote');
  assert.equal(parse('---').kind, 'divider');
  assert.equal(parse('-----').kind, 'divider');
  assert.equal(parse('>no space'), undefined, 'a quote needs its space, or typing ">" converts too early');
  assert.equal(parse('#no space'), undefined);
  assert.equal(parse('plain text'), undefined, 'a paragraph that still looks like a paragraph needs no patch');
  assert.equal(rules.parseEditableMarkdownBlock({ block: { kind: 'heading' }, text: 'plain text' }).patch.kind, 'paragraph',
    'a heading whose markers were deleted becomes a paragraph again');
  assert.equal(rules.parseEditableMarkdownBlock(), null);
});

test('the caret maps between the editable text and the block content', () => {
  const heading = { kind: 'heading', level: 2, content: 'Title' };
  assert.equal(rules.contentOffsetToEditorOffset(heading, 0), 3, 'the prefix is not part of the content');
  assert.equal(rules.editorOffsetToContentOffset(heading, 3), 0);
  assert.equal(rules.editorOffsetToContentOffset(heading, 0), 0, 'a caret inside the prefix clamps to the start');
  assert.equal(rules.contentOffsetToEditorOffset({ kind: 'paragraph' }, 4), 4);
  assert.equal(rules.contentOffsetToEditorOffset(heading, -5), 3);
  assert.equal(rules.editorOffsetToContentOffset({ kind: 'paragraph' }, 'x'), 0);
});

test('a heading typed as plain text is projected as a heading for display', () => {
  const projected = rules.displayProjectionForMarkdownSourceBlock({ kind: 'paragraph', content: '##  Heading' });
  assert.equal(projected.block.kind, 'heading');
  assert.equal(projected.block.level, 2);
  assert.equal(projected.block.content, 'Heading');
  assert.equal(projected.sourcePrefix, '##  ', 'the prefix is exactly what was typed, so the caret lands right');
  assert.equal(projected.sourceOffset, 4);
  assert.equal(rules.displayProjectionForMarkdownSourceBlock({ kind: 'paragraph', content: 'plain' }), null);
  assert.equal(rules.displayProjectionForMarkdownSourceBlock({ kind: 'heading', content: '# x' }), null,
    'a real heading block needs no projection');
  assert.equal(rules.displayProjectionForMarkdownSourceBlock(), null);
});

test('pressing enter continues a list and ends anything else', () => {
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'bullet' }), { kind: 'bullet', checked: null, level: 0 });
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'todo', checked: true }),
    { kind: 'todo', checked: false, level: 0 }, 'the next todo starts unticked');
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'ordered', listNumber: 3, listDelimiter: ')' }),
    { kind: 'ordered', checked: null, level: 0, listNumber: 4, listDelimiter: ')' });
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'ordered' }).listNumber, 2);
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'heading' }), { kind: 'paragraph', checked: null, level: 0 },
    'the line after a heading is a paragraph, not another heading');
  assert.deepEqual(rules.continuationBlockPatch(), { kind: 'paragraph', checked: null, level: 0 });
});

test('input rules stay out of the way in specialised contexts', () => {
  for (const text of [
    '| a | b |',
    '```js',
    '::: plot-points',
    '{{label:done|Done}}',
    'status:: DRAFT',
    '[[A Note]]',
    '#tag',
    '@remind 2026-09-01',
  ]) {
    assert.equal(rules.isSpecializedPlainContext(text), true, `${text} is not ordinary prose`);
  }
  assert.equal(rules.isSpecializedPlainContext('ordinary prose'), false);
  assert.equal(rules.isSpecializedPlainContext(''), false);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'code' }, 'x'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'paragraph' }, 'status:: x'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'paragraph' }, 'prose'), false);
  assert.equal(rules.shouldHandleTextInput('insertText'), true);
  assert.equal(rules.shouldHandleTextInput('deleteContentBackward'), false);

  const convert = (text, block, inputType = 'insertText') =>
    rules.findBlockStarterConversion({ block, text, cursor: text.length, inputType });
  assert.equal(convert('# ', { kind: 'paragraph' }).patch.kind, 'heading');
  assert.equal(convert('# ', { kind: 'paragraph' }, 'insertFromPaste'), null, 'pasting is not typing');
  assert.equal(convert(' # ', { kind: 'paragraph' }), null, 'an indented starter is not a starter');
  assert.equal(convert('\t# ', { kind: 'paragraph' }), null);
  assert.equal(rules.findBlockStarterConversion({ block: { kind: 'paragraph' }, text: '# x', cursor: 1, inputType: 'insertText' }),
    null, 'the rule only fires at the end of the line');
  assert.equal(convert('[ ] ', { kind: 'bullet' }).patch.kind, 'todo',
    'a checkbox typed inside a bullet turns it into a todo');
  assert.equal(convert('[x] ', { kind: 'bullet' }).patch.checked, true);
  assert.equal(convert('[ ] ', { kind: 'paragraph' }), null);
  assert.equal(convert('not a starter', { kind: 'paragraph' }), null);
  assert.equal(rules.findBlockStarterConversion(), null);

  const matrix = rules.supportedCaseMatrix();
  assert.ok(matrix.blockStarters.length > 0);
  assert.ok(matrix.inlineMarkers.length > 0);
  matrix.blockStarters.push({ marker: 'mutated' });
  assert.notEqual(rules.supportedCaseMatrix().blockStarters.length, matrix.blockStarters.length,
    'the matrix is a copy, so a caller cannot edit the real rules');
});
