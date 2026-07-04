const test = require('node:test');
const assert = require('node:assert/strict');

const exportHtml = require('../lib/exportHtml.js');

test('exportMarkdown emits a title heading plus the body', () => {
  const out = exportHtml.exportMarkdown({ title: 'My Note', body: 'Line one.' });
  assert.equal(out, '# My Note\n\nLine one.\n');
});

test('renderNoteHtml renders block structures and escapes content', async () => {
  const html = await exportHtml.renderNoteHtml({
    title: 'Test <Note>',
    tags: ['work', 'q3'],
    date: '2026-07-04T10:00:00Z',
    body: [
      '# Heading One',
      'A paragraph with **bold**, *italic*, `code`, and ~~gone~~.',
      '',
      '- bullet one',
      '  - nested bullet',
      '- [x] done item',
      '- [ ] open item',
      '> a quote',
      '---',
      'status:: DRAFT',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '```js',
      'const x = "<script>alert(1)</script>";',
      '```',
      'Link to [[Other Note]] and #tagged text.',
    ].join('\n'),
  });
  assert.match(html, /<title>Test &lt;Note&gt;<\/title>/);
  assert.match(html, /<h1 class="note-title">Test &lt;Note&gt;<\/h1>/);
  assert.match(html, /<span class="tag">#work<\/span>/);
  assert.match(html, /<h1>Heading One<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<li style="margin-left:0px">bullet one<\/li>/);
  assert.match(html, /<li style="margin-left:20px">nested bullet<\/li>/);
  assert.match(html, /<li class="done"[^>]*><span class="check">☑<\/span> done item<\/li>/);
  assert.match(html, /<span class="check">☐<\/span> open item/);
  assert.match(html, /<blockquote>a quote<\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<span class="prop-key">status<\/span> DRAFT/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>2<\/td>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>'), 'no raw script tags survive');
  assert.match(html, /<span class="wiki">Other Note<\/span>/);
  assert.match(html, /<span class="tag">#tagged<\/span>/);
});

test('renderNoteHtml embeds attachment images as data URIs and guards bad sources', async () => {
  const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const html = await exportHtml.renderNoteHtml({
    title: 'Images',
    body: [
      'Local ![shot](attachments/shot.png) image.',
      'Missing ![gone](attachments/gone.png) image.',
      'Remote ![ext](https://example.com/pic.png) image.',
      'Bad ![evil](javascript:alert(1)) image.',
    ].join('\n\n'),
  }, {
    resolveAttachment: async (fileName) => fileName === 'shot.png'
      ? { buffer: pngBytes, mimeType: 'image/png' }
      : null,
  });
  assert.match(html, new RegExp(`src="data:image/png;base64,${pngBytes.toString('base64')}"`));
  assert.match(html, /\[image: gone\.png\]/);
  assert.match(html, /<img alt="ext" src="https:\/\/example\.com\/pic\.png">/);
  assert.ok(!html.includes('src="javascript:'), 'unsafe source never reaches an img tag');
  assert.ok(!/<img[^>]*evil/.test(html), 'the unsafe image renders as escaped text, not an img');
});

test('renderNoteHtml keeps unsafe link schemes out of anchors', async () => {
  const html = await exportHtml.renderNoteHtml({
    title: 'Links',
    body: 'Good [site](https://example.com) and bad [x](javascript:alert(1)).',
  });
  assert.match(html, /<a href="https:\/\/example\.com">site<\/a>/);
  assert.ok(!html.includes('href="javascript:'), 'unsafe scheme never becomes a link');
});
