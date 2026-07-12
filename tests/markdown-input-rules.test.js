const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../src/editor/markdownInputRules.js');

function conversion(text, block = { kind: 'paragraph' }, inputType = 'insertText') {
  return rules.findBlockStarterConversion({
    block,
    text,
    cursor: text.length,
    inputType,
  })?.patch || null;
}

test('Block starter input rules cover supported starters in eligible plain blocks', () => {
  assert.deepEqual(conversion('# '), { kind: 'heading', level: 1, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('## '), { kind: 'heading', level: 2, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('### '), { kind: 'heading', level: 3, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('#### '), { kind: 'heading', level: 4, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('##### '), { kind: 'heading', level: 5, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('###### '), { kind: 'heading', level: 6, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('- '), { kind: 'bullet', level: 0, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('1. '), { kind: 'ordered', level: 0, checked: null, content: '', language: '', listNumber: 1, listDelimiter: '.' });
  assert.deepEqual(conversion('- [ ] '), { kind: 'todo', level: 0, checked: false, content: '', language: '' });
  assert.deepEqual(conversion('- [x] '), { kind: 'todo', level: 0, checked: true, content: '', language: '' });
  assert.deepEqual(conversion('- [X] '), { kind: 'todo', level: 0, checked: true, content: '', language: '' });
  assert.deepEqual(conversion('> '), { kind: 'quote', level: 0, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('```'), { kind: 'code', level: 0, checked: null, content: '', language: '' });
  assert.deepEqual(conversion('---'), { kind: 'divider', level: 0, checked: null, content: '', language: '' });
});

test('Block starter input rules keep unsupported contexts and partial starters literal', () => {
  assert.equal(conversion('#'), null);
  assert.equal(conversion('##'), null);
  assert.equal(conversion('- ['), null);
  assert.equal(conversion('- [ ]'), null);
  assert.equal(conversion(' --'), null);
  assert.equal(conversion(' ---'), null);
  assert.equal(conversion('---x'), null);
  assert.equal(conversion('# ', { kind: 'heading' }), null);
  assert.equal(conversion('- ', { kind: 'bullet' }), null);
  assert.equal(conversion('- [ ] ', { kind: 'todo' }), null);
  assert.equal(conversion('> ', { kind: 'quote' }), null);
  assert.equal(conversion('```', { kind: 'code' }), null);
  assert.equal(conversion('---', { kind: 'table' }), null);
  assert.equal(conversion('# ', { kind: 'plot-points' }), null);
  assert.equal(conversion('# ', { kind: 'paragraph' }, 'insertFromPaste'), null);
  assert.equal(conversion('# ', { kind: 'paragraph' }, null), null);
});

test('Nested plain blocks remain eligible without typed leading-space indentation', () => {
  const nestedPlain = { kind: 'paragraph', children: [] };
  assert.deepEqual(conversion('- ', nestedPlain), { kind: 'bullet', level: 0, checked: null, content: '', language: '' });
  assert.equal(conversion('  - ', nestedPlain), null);
});

test('Todo continuation converts after immediate bullet starter conversion', () => {
  assert.deepEqual(conversion('[ ] ', { kind: 'bullet' }), { kind: 'todo', level: 0, checked: false, content: '', language: '' });
  assert.deepEqual(conversion('[x] ', { kind: 'bullet' }), { kind: 'todo', level: 0, checked: true, content: '', language: '' });
  assert.deepEqual(conversion('[X] ', { kind: 'bullet' }), { kind: 'todo', level: 0, checked: true, content: '', language: '' });
  assert.equal(conversion('[ ] ', { kind: 'paragraph' }), null);
});

test('List continuation retains list kind and advances ordered markers', () => {
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'bullet' }), { kind: 'bullet', checked: null, level: 0 });
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'todo', checked: true }), { kind: 'todo', checked: false, level: 0 });
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'ordered', listNumber: 7, listDelimiter: ')' }), {
    kind: 'ordered', checked: null, level: 0, listNumber: 8, listDelimiter: ')',
  });
  assert.deepEqual(rules.continuationBlockPatch({ kind: 'heading' }), { kind: 'paragraph', checked: null, level: 0 });
});

test('Structural blocks expose editable markdown source prefixes', () => {
  assert.equal(rules.editableMarkdownForBlock({ kind: 'heading', level: 5, content: 'Origins' }), '##### Origins');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'bullet', content: 'Item' }), '- Item');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'ordered', listNumber: 3, listDelimiter: ')', content: 'Item' }), '3) Item');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'todo', checked: false, content: 'Task' }), '- [ ] Task');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'todo', checked: true, content: 'Task' }), '- [x] Task');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'quote', content: 'Quote' }), '> Quote');
  assert.equal(rules.editableMarkdownForBlock({ kind: 'divider', content: '' }), '---');

  assert.deepEqual(rules.parseEditableMarkdownBlock({ block: { kind: 'heading' }, text: '##### Origins' }).patch, {
    kind: 'heading',
    level: 5,
    checked: null,
    content: 'Origins',
    language: '',
  });
  assert.deepEqual(rules.parseEditableMarkdownBlock({ block: { kind: 'heading', level: 3 }, text: 'Plain text' }).patch, {
    kind: 'paragraph',
    level: 0,
    checked: null,
    content: 'Plain text',
    language: '',
  });
  assert.equal(rules.editorOffsetToContentOffset({ kind: 'heading', level: 5 }, 8), 2);
  assert.equal(rules.contentOffsetToEditorOffset({ kind: 'heading', level: 5 }, 2), 8);

  const projection = rules.displayProjectionForMarkdownSourceBlock({
    kind: 'paragraph',
    content: '### Role of Zeon',
  });
  assert.equal(projection.sourceOffset, 4);
  assert.equal(projection.block.kind, 'heading');
  assert.equal(projection.block.level, 3);
  assert.equal(projection.block.content, 'Role of Zeon');
  assert.equal(rules.displayProjectionForMarkdownSourceBlock({ kind: 'heading', level: 3, content: 'Role' }), null);
});

test('Inline parser recognizes supported markers and preserves markdown delimiter serialization', () => {
  const source = 'Plain **bold** *italic* `code` ~~gone~~ [site](https://example.com/a?b=1).';
  const segments = rules.parseInlineMarkdown(source);
  assert.deepEqual(segments.map(segment => segment.kind), [
    'text', 'bold', 'text', 'italic', 'text', 'code', 'text', 'strike', 'text', 'link', 'text',
  ]);
  assert.equal(segments.find(segment => segment.kind === 'bold').text, 'bold');
  assert.equal(segments.find(segment => segment.kind === 'italic').text, 'italic');
  assert.equal(segments.find(segment => segment.kind === 'code').text, 'code');
  assert.equal(segments.find(segment => segment.kind === 'strike').text, 'gone');
  assert.equal(segments.find(segment => segment.kind === 'link').url, 'https://example.com/a?b=1');
  assert.equal(rules.serializeInlineMarkdown(segments), source);
});

test('Inline parser keeps escaped, empty, multiline, nested, and overlapping markers literal', () => {
  for (const source of [
    '\\**bold**',
    '\\*italic*',
    '****',
    '**line\nbreak**',
    '**bold *italic***',
    '*italic **bold***',
    '[label](javascript:alert(1))',
  ]) {
    const segments = rules.parseInlineMarkdown(source);
    assert.deepEqual(segments, [{ kind: 'text', text: source }]);
    assert.equal(rules.serializeInlineMarkdown(segments), source);
  }
});

test('Inline code takes precedence over markdown-looking content inside the code span', () => {
  const segments = rules.parseInlineMarkdown('Use `**literal** [x](javascript:bad)` here');
  assert.deepEqual(segments.map(segment => segment.kind), ['text', 'code', 'text']);
  assert.equal(segments[1].text, '**literal** [x](javascript:bad)');
});

test('Markdown link safety accepts only parseable absolute http and https targets', () => {
  for (const url of [
    'https://example.com',
    'HTTP://example.com/path?q=1',
    'https://sub.example.com/a-b_c~d',
  ]) {
    assert.equal(rules.classifyMarkdownLink('label', url).safe, true, url);
    assert.equal(rules.isSafeMarkdownUrl(url), true, url);
  }

  for (const url of [
    '',
    'javascript:alert(1)',
    'mailto:test@example.com',
    '/relative/path',
    '//example.com/path',
    'https://example.com/a b',
    'https://example.com/a\nb',
    'https://example.com/a(b)',
    'not a url',
  ]) {
    assert.equal(rules.classifyMarkdownLink('label', url).safe, false, url);
    assert.equal(rules.isSafeMarkdownUrl(url), false, url);
  }

  assert.equal(rules.classifyMarkdownLink('', 'https://example.com').safe, false);
  assert.deepEqual(rules.parseInlineMarkdown('[label](https://example.com)')[0], {
    kind: 'link',
    text: 'label',
    label: 'label',
    url: 'https://example.com',
    safe: true,
  });
  assert.deepEqual(rules.parseInlineMarkdown('[label](//example.com)'), [
    { kind: 'text', text: '[label](//example.com)' },
  ]);
});

test('Specialized syntax contexts are not treated as markdown input-rule targets', () => {
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'code' }, '# '), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'table' }, '| A | B |'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'plot-points' }, 'Plot Points'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'paragraph' }, 'status:: open'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'paragraph' }, '{{label:blue|Needs+work}}Text'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'paragraph' }, '[[Existing Note]]'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'paragraph' }, '#tag'), true);
  assert.equal(rules.shouldSkipMarkdownInputRules({ kind: 'paragraph' }, '@remind 2026-06-01 09:00'), true);
});

test('Supported case matrix stays explicit for success-criteria accounting', () => {
  const matrix = rules.supportedCaseMatrix();
  assert.equal(matrix.blockStarters.length, 14);
  assert.deepEqual(matrix.inlineMarkers.map(item => item.kind), ['bold', 'italic', 'code', 'strike', 'link', 'image']);
});

test('Inline images parse for vault attachments and remote https sources', () => {
  const segments = rules.parseInlineMarkdown('before ![Shot](attachments/shot-20260704.png) after');
  assert.deepEqual(segments.map(s => s.kind), ['text', 'image', 'text']);
  assert.equal(segments[1].label, 'Shot');
  assert.equal(segments[1].url, 'attachments/shot-20260704.png');
  assert.equal(segments[1].source, 'attachment');

  const remote = rules.parseInlineMarkdown('![diagram](https://example.com/d.png)');
  assert.equal(remote.length, 1);
  assert.equal(remote[0].kind, 'image');
  assert.equal(remote[0].source, 'remote');

  const emptyAlt = rules.parseInlineMarkdown('![](attachments/pic.png)');
  assert.equal(emptyAlt[0].kind, 'image');
  assert.equal(emptyAlt[0].label, '');
});

test('Inline images reject unsafe or traversal-shaped sources', () => {
  const unsafe = [
    '![x](javascript:alert(1))',
    '![x](file:///etc/passwd)',
    '![x](attachments/../secret.png)',
    '![x](attachments/sub/dir.png)',
    '![x](../outside.png)',
    '![x](//evil.example/x.png)',
  ];
  for (const text of unsafe) {
    const segments = rules.parseInlineMarkdown(text);
    assert.deepEqual(segments.map(s => s.kind), ['text'], text);
    assert.equal(segments[0].text, text);
  }
  assert.equal(rules.isVaultAttachmentPath('attachments/pic.png'), true);
  assert.equal(rules.isVaultAttachmentPath('attachments/../pic.png'), false);
  assert.equal(rules.isVaultAttachmentPath('elsewhere/pic.png'), false);
});

test('Inline images round-trip through serialize and respect escapes', () => {
  const source = 'a ![Shot](attachments/shot.png) b [site](https://example.com) c';
  assert.equal(rules.serializeInlineMarkdown(rules.parseInlineMarkdown(source)), source);

  const escaped = rules.parseInlineMarkdown('\\![not](attachments/pic.png)');
  assert.notEqual(escaped[0].kind, 'image');

  const embed = rules.parseInlineMarkdown('![[Page Embed]]');
  assert.deepEqual(embed.map(s => s.kind), ['text']);
});
