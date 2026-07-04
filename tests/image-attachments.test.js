const test = require('node:test');
const assert = require('node:assert/strict');

const imageAttachments = require('../src/editor/imageAttachments.js');

function fakeImageFile(name, type, bytes = [1, 2, 3]) {
  return {
    name,
    type,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

test('mnImageFilesFromDataTransfer keeps only image files', () => {
  const files = [
    fakeImageFile('shot.png', 'image/png'),
    fakeImageFile('doc.pdf', 'application/pdf'),
    fakeImageFile('photo.jpg', 'image/jpeg'),
  ];
  const picked = imageAttachments.mnImageFilesFromDataTransfer({ files });
  assert.deepEqual(picked.map(f => f.name), ['shot.png', 'photo.jpg']);
  assert.deepEqual(imageAttachments.mnImageFilesFromDataTransfer(null), []);
});

test('mnImageAltText strips markdown-breaking characters', () => {
  assert.equal(imageAttachments.mnImageAltText('My Shot (final).png'), 'My Shot final');
  assert.equal(imageAttachments.mnImageAltText('a[b]c*d`e.png'), 'a b c d e');
  assert.equal(imageAttachments.mnImageAltText(''), 'image');
  assert.equal(imageAttachments.mnImageAltText('C:\\shots\\pic.png'), 'pic');
});

test('mnSaveImageAttachments builds markdown from the bridge response', async () => {
  const calls = [];
  const bridge = {
    saveAttachment: async (vaultId, payload) => {
      calls.push({ vaultId, payload });
      return { ok: true, value: { relPath: `attachments/${payload.name || 'pasted-image'}-x.png` } };
    },
  };
  const { markdowns, errors } = await imageAttachments.mnSaveImageAttachments(
    [fakeImageFile('shot.png', 'image/png')],
    { bridge, vaultId: 'v_test' }
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(markdowns, ['![shot](attachments/shot.png-x.png)']);
  assert.equal(calls[0].vaultId, 'v_test');
  assert.equal(calls[0].payload.name, 'shot.png');
  assert.ok(calls[0].payload.bytes instanceof Uint8Array);
});

test('mnSaveImageAttachments surfaces bridge errors and missing setup', async () => {
  const failingBridge = {
    saveAttachment: async () => ({ ok: false, error: 'Attachment is too large' }),
  };
  const failed = await imageAttachments.mnSaveImageAttachments(
    [fakeImageFile('big.png', 'image/png')],
    { bridge: failingBridge, vaultId: 'v_test' }
  );
  assert.deepEqual(failed.markdowns, []);
  assert.deepEqual(failed.errors, ['Attachment is too large']);

  const noVault = await imageAttachments.mnSaveImageAttachments(
    [fakeImageFile('shot.png', 'image/png')],
    { bridge: failingBridge, vaultId: '' }
  );
  assert.deepEqual(noVault.errors, ['Attachments are unavailable']);

  const empty = await imageAttachments.mnSaveImageAttachments([], { bridge: failingBridge, vaultId: 'v' });
  assert.deepEqual(empty, { markdowns: [], errors: [] });
});
