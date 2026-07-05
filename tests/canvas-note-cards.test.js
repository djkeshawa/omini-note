const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/canvas/canvasModel.js');

test('mnCanvasNoteElement stores only the note reference plus card geometry', () => {
  const el = model.mnCanvasNoteElement({ x: 40, y: 60 }, { id: 'n1', title: 'Plot Ideas', body: 'secret content' });
  assert.equal(el.type, 'note');
  assert.equal(el.noteId, 'n1');
  assert.equal(el.text, 'Plot Ideas');
  assert.equal(el.x, 40);
  assert.equal(el.y, 60);
  assert.ok(el.w > 0 && el.h > 0);
  assert.ok(!JSON.stringify(el).includes('secret content'), 'body is not embedded in the element');

  const fallback = model.mnCanvasNoteElement({ x: 0, y: 0 }, {});
  assert.equal(fallback.text, 'Untitled');
});

test('mnCanvasNotePreview strips markdown structure into readable prose', () => {
  const preview = model.mnCanvasNotePreview({
    body: [
      'status:: DRAFT',
      '# Heading',
      '- [ ] open task about [[Budget Review|the budget]]',
      '```js',
      'code here',
      '```',
      '![shot](attachments/shot.png)',
      'Plain **bold** prose with [link](https://example.com).',
    ].join('\n'),
  });
  assert.ok(!preview.includes('status::'));
  assert.ok(!preview.includes('code here'));
  assert.ok(!preview.includes('attachments/'));
  assert.ok(!preview.includes('[['));
  assert.match(preview, /the budget/);
  assert.match(preview, /Heading/);
  assert.match(preview, /Plain bold prose with link/);

  const capped = model.mnCanvasNotePreview({ body: 'x'.repeat(500) }, 100);
  assert.equal(capped.length, 100);
  assert.equal(model.mnCanvasNotePreview(null), '');
});

test('note elements work with the shared geometry helpers', () => {
  const el = model.mnCanvasNoteElement({ x: 10, y: 20 }, { id: 'n1', title: 'T' });
  const bounds = model.mnCanvasBounds(el);
  assert.deepEqual(bounds, { x: 10, y: 20, w: el.w, h: el.h });

  const moved = model.mnCanvasMoveElement(el, 5, -5);
  assert.equal(moved.x, 15);
  assert.equal(moved.y, 15);
  assert.equal(moved.noteId, 'n1');

  const clone = model.mnCanvasCloneElement(el);
  assert.notEqual(clone.id, el.id);
  assert.equal(clone.noteId, 'n1');
  assert.equal(clone.x, el.x + 24);
});
