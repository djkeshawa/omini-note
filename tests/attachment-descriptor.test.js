const test = require('node:test');
const assert = require('node:assert/strict');
const attachmentDescriptor = require('../src/shared/attachmentDescriptor.js');

test('AttachmentDescriptor covers the portable allowlist and rejects MIME mismatches', () => {
  for (const spec of attachmentDescriptor.TYPE_SPECS) {
    for (const extension of spec.extensions) {
      const classified = attachmentDescriptor.classifyAttachment(`file.${extension}`, '');
      assert.equal(classified.kind, spec.kind, extension);
      assert.equal(classified.typeLabel, spec.typeLabel, extension);
    }
  }
  assert.equal(attachmentDescriptor.classifyAttachment('report.pdf', 'image/png'), null);
  assert.equal(attachmentDescriptor.classifyAttachment('program.exe', 'application/octet-stream'), null);
  assert.equal(attachmentDescriptor.classifyAttachment('', 'image/png').extension, 'png');
});

test('AttachmentDescriptor normalization remains bounded and vault-relative', () => {
  const normalized = attachmentDescriptor.normalizeAttachmentDescriptor({
    fileName: 'Project-brief-20260713000000.pdf',
    relPath: 'attachments/Project-brief-20260713000000.pdf',
    mimeType: 'application/pdf',
    size: 1536,
  });
  assert.equal(normalized.kind, 'document');
  assert.equal(normalized.typeLabel, 'PDF');
  assert.equal(attachmentDescriptor.formatAttachmentSize(normalized.size), '1.5 KB');
  assert.equal(attachmentDescriptor.normalizeAttachmentDescriptor({
    ...normalized,
    relPath: '../Project-brief-20260713000000.pdf',
  }), null);
  assert.equal(attachmentDescriptor.normalizeAttachmentDescriptor({
    ...normalized,
    size: Number.MAX_SAFE_INTEGER,
  }).size, attachmentDescriptor.MAX_ATTACHMENT_BYTES);
});
