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

test('exported code blocks are not cut short by a fence inside them', async () => {
  const html = await exportHtml.renderNoteHtml({
    title: 'Fences',
    body: '````js\nHere is a fence:\n```\ndone\n````\n\nAfter.',
  });
  assert.match(html, /<pre><code data-language="js">Here is a fence:\n```\ndone<\/code><\/pre>/);
  assert.match(html, /After\./);
});

test('an indented fence inside exported code remains code like it does in the editor', async () => {
  const html = await exportHtml.renderNoteHtml({
    title: 'Indented fence',
    body: '````\nbefore\n  ````\nafter\n````\n\nDone.',
  });
  assert.match(html, /<pre><code>before\n  ````\nafter<\/code><\/pre>/);
  assert.match(html, /Done\./);
});

// A scene note as the Writer pack actually writes one: properties, a
// plot-points block, then prose with no blank line after the closing fence.
const SCENE_BODY = [
  'act:: 1',
  'chapter:: 2',
  'order:: 3',
  '',
  '::: plot-points',
  '- She finds the letter',
  '- The train is late',
  '  - context:: raining, near dusk',
  ':::',
  'The letter was still warm.',
  '',
  'She read it twice.',
].join('\n');

test('a plot-points block exports as a block instead of leaking ::: markers', async () => {
  const html = await exportHtml.renderNoteHtml({ title: 'Scene 3', body: SCENE_BODY });

  // The fence markers must not survive as body text.
  assert.ok(!/:::/.test(html), 'export still contains ::: markers');
  assert.ok(!/<p>[^<]*plot-points/i.test(html), 'plot-points header leaked into a paragraph');

  // Beats and contexts render, and stay inside the block.
  assert.match(html, /<div class="plot-points">/);
  assert.match(html, /<li>She finds the letter<\/li>/);
  assert.match(html, /<li>The train is late<\/li>/);
  assert.match(html, /<div class="plot-context">raining, near dusk<\/div>/);
  assert.ok(!/<li>context::/.test(html), 'context leaked in as a beat');
});

test('prose after a plot-points block is its own paragraph, not glued to the fence', async () => {
  const html = await exportHtml.renderNoteHtml({ title: 'Scene 3', body: SCENE_BODY });
  assert.match(html, /<p>The letter was still warm\.<\/p>/);
  assert.match(html, /<p>She read it twice\.<\/p>/);
});

test('a paragraph after a list closes the list instead of nesting inside it', async () => {
  const html = await exportHtml.renderNoteHtml({
    title: 'List then prose',
    body: '- first\n- second\nProse right after the list.',
  });
  // The </ul> must come before the paragraph, not after it.
  const listEnd = html.indexOf('</ul>');
  const paragraph = html.indexOf('<p>Prose right after the list.</p>');
  assert.ok(listEnd !== -1 && paragraph !== -1, 'expected both a closed list and the paragraph');
  assert.ok(listEnd < paragraph, '<p> was emitted inside the open <ul>');
});

test('an unterminated plot-points block never swallows the prose after it', async () => {
  const html = await exportHtml.renderNoteHtml({
    title: 'Unclosed',
    body: '::: plot-points\n- a beat\n\nTrailing prose that must survive.',
  });
  // Losing a writer's words is worse than showing a stray marker, so an
  // unclosed fence degrades to plain text rather than eating the note.
  assert.match(html, /Trailing prose that must survive\./);
  assert.match(html, /a beat/);
});

test('a plot-points block still closes correctly when it is the last thing in a note', async () => {
  const html = await exportHtml.renderNoteHtml({
    title: 'Ends on a block',
    body: 'Prose first.\n\n::: plot-points\n- final beat\n:::',
  });
  assert.match(html, /<p>Prose first\.<\/p>/);
  assert.match(html, /<li>final beat<\/li>/);
  assert.ok(!/:::/.test(html), 'export still contains ::: markers');
});
