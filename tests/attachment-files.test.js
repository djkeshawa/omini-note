const test = require('node:test');
const assert = require('node:assert/strict');
const attachmentFiles = require('../src/editor/attachmentFiles.js');

function fakeFile(name, type, bytes = [1, 2, 3]) {
  return {
    name,
    type,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

test('attachment drop selection keeps supported images, documents, and audio only', () => {
  const files = [
    fakeFile('shot.png', 'image/png'),
    fakeFile('brief.pdf', 'application/pdf'),
    fakeFile('recording.mp3', 'audio/mpeg'),
    fakeFile('installer.exe', 'application/octet-stream'),
    fakeFile('spoofed.pdf', 'image/png'),
  ];
  const picked = attachmentFiles.mnAttachmentFilesFromDataTransfer({ files });
  assert.deepEqual(picked.map(file => file.name), ['shot.png', 'brief.pdf', 'recording.mp3']);
  assert.deepEqual(attachmentFiles.mnAttachmentFilesFromDataTransfer(null), []);
});

test('attachment labels strip Markdown-breaking characters', () => {
  assert.equal(attachmentFiles.imageAltText('My Shot (final).png'), 'My Shot final');
  assert.equal(attachmentFiles.markdownSafeLabel('a[b]c*d`e.pdf'), 'a b c d e.pdf');
  assert.equal(attachmentFiles.imageAltText(''), 'image');
  assert.equal(attachmentFiles.markdownSafeLabel('C:\\docs\\brief.pdf'), 'brief.pdf');
});

test('saving attachments emits image Markdown and general attachment links', async () => {
  const calls = [];
  const bridge = {
    saveAttachment: async (vaultId, payload) => {
      calls.push({ vaultId, payload });
      const isImage = payload.name.endsWith('.png');
      const baseName = payload.name.replace(/\.[A-Za-z0-9]+$/, '').replace(/\s+/g, '-');
      const extension = isImage ? 'png' : 'pdf';
      const fileName = `${baseName}-20260713000000.${extension}`;
      return { ok: true, value: {
        fileName,
        relPath: `attachments/${fileName}`,
        mimeType: isImage ? 'image/png' : 'application/pdf',
        size: payload.bytes.byteLength,
        kind: isImage ? 'image' : 'document',
        typeLabel: isImage ? 'PNG image' : 'PDF',
        isImage,
      } };
    },
  };
  const { markdowns, descriptors, errors } = await attachmentFiles.mnSaveAttachments([
    fakeFile('shot.png', 'image/png'),
    fakeFile('Project brief.pdf', 'application/pdf'),
  ], { bridge, vaultId: 'v_test' });
  assert.deepEqual(errors, []);
  assert.deepEqual(markdowns, [
    '![shot](attachments/shot-20260713000000.png)',
    '[Project brief.pdf](attachments/Project-brief-20260713000000.pdf)',
  ]);
  assert.equal(descriptors.length, 2);
  assert.equal(calls[0].vaultId, 'v_test');
  assert.ok(calls[0].payload.bytes instanceof Uint8Array);
});

test('saving attachments surfaces bridge errors and missing setup', async () => {
  const failingBridge = {
    saveAttachment: async () => ({ ok: false, error: 'Attachment is too large' }),
  };
  const failed = await attachmentFiles.mnSaveAttachments(
    [fakeFile('big.pdf', 'application/pdf')],
    { bridge: failingBridge, vaultId: 'v_test' }
  );
  assert.deepEqual(failed.markdowns, []);
  assert.deepEqual(failed.errors, ['Attachment is too large']);

  const noVault = await attachmentFiles.mnSaveAttachments(
    [fakeFile('shot.png', 'image/png')],
    { bridge: failingBridge, vaultId: '' }
  );
  assert.deepEqual(noVault.errors, ['Attachments are unavailable']);

  const empty = await attachmentFiles.mnSaveAttachments([], { bridge: failingBridge, vaultId: 'v' });
  assert.deepEqual(empty, { markdowns: [], descriptors: [], errors: [] });

  const unsupported = await attachmentFiles.mnSaveAttachments(
    [fakeFile('installer.exe', 'application/octet-stream')],
    { bridge: { saveAttachment: async () => { throw new Error('must not call'); } }, vaultId: 'v' }
  );
  assert.deepEqual(unsupported.markdowns, []);
  assert.deepEqual(unsupported.errors, ['Unsupported file type: installer.exe']);

  const oversizedFile = { ...fakeFile('archive.pdf', 'application/pdf'), size: 51 * 1024 * 1024 };
  const oversized = await attachmentFiles.mnSaveAttachments(
    [oversizedFile],
    { bridge: { saveAttachment: async () => { throw new Error('must not call'); } }, vaultId: 'v' }
  );
  assert.deepEqual(oversized.errors, ['archive.pdf is larger than 50 MB.']);
});
