const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function withIsolatedAttachments(fn) {
  const previousVispnoteHome = process.env.VISPNOTE_HOME;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-attach-'));
  const storePath = require.resolve('../lib/store');
  const attachmentsPath = require.resolve('../lib/attachments');
  delete require.cache[storePath];
  delete require.cache[attachmentsPath];
  process.env.VISPNOTE_HOME = tmpHome;
  try {
    const store = require('../lib/store');
    const attachments = require('../lib/attachments');
    const cfg = await store.loadConfig();
    return await fn(attachments, { store, cfg, tmpHome });
  } finally {
    delete require.cache[storePath];
    delete require.cache[attachmentsPath];
    if (previousVispnoteHome === undefined) delete process.env.VISPNOTE_HOME;
    else process.env.VISPNOTE_HOME = previousVispnoteHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

test('saveAttachment writes image bytes under the vault attachments folder', async () => {
  await withIsolatedAttachments(async (attachments, { cfg, tmpHome }) => {
    const vault = cfg.vaults[0];
    const saved = await attachments.saveAttachment(vault.id, {
      name: 'My Screen Shot.png',
      mimeType: 'image/png',
      bytes: new Uint8Array(PNG_BYTES),
    });
    assert.match(saved.fileName, /^My-Screen-Shot-\d{14}\.png$/);
    assert.equal(saved.relPath, `attachments/${saved.fileName}`);
    assert.equal(saved.mimeType, 'image/png');
    const onDisk = fs.readFileSync(path.join(tmpHome, vault.slug, 'attachments', saved.fileName));
    assert.deepEqual(onDisk, PNG_BYTES);
    assert.equal(attachments.isValidAttachmentFileName(saved.fileName), true);
    assert.equal(attachments.isVaultAttachmentRelPath(saved.relPath), true);
  });
});

test('saveAttachment derives extension from mime type and de-dupes names', async () => {
  await withIsolatedAttachments(async (attachments, { cfg }) => {
    const vault = cfg.vaults[0];
    const payload = { name: '', mimeType: 'image/png', bytes: new Uint8Array(PNG_BYTES) };
    const first = await attachments.saveAttachment(vault.id, payload);
    const second = await attachments.saveAttachment(vault.id, payload);
    assert.match(first.fileName, /^pasted-image-\d{14}\.png$/);
    assert.notEqual(first.fileName, second.fileName);
  });
});

test('saveAttachment rejects invalid payloads', async () => {
  await withIsolatedAttachments(async (attachments, { cfg }) => {
    const vault = cfg.vaults[0];
    await assert.rejects(
      attachments.saveAttachment('nope', { name: 'a.png', mimeType: 'image/png', bytes: new Uint8Array(PNG_BYTES) }),
      /Vault not found/
    );
    await assert.rejects(
      attachments.saveAttachment(vault.id, { name: 'a.png', mimeType: 'image/png', bytes: new Uint8Array(0) }),
      /empty/
    );
    await assert.rejects(
      attachments.saveAttachment(vault.id, { name: 'notes.txt', mimeType: 'text/plain', bytes: new Uint8Array(PNG_BYTES) }),
      /images only/
    );
    await assert.rejects(
      attachments.saveAttachment(vault.id, { name: 'a.png', mimeType: 'image/png', bytes: 'not-binary' }),
      /binary/
    );
    await assert.rejects(
      attachments.saveAttachment(vault.id, {
        name: 'big.png',
        mimeType: 'image/png',
        bytes: new Uint8Array(attachments.MAX_ATTACHMENT_BYTES + 1),
      }),
      /too large/
    );
  });
});

test('readAttachment returns saved bytes and blocks unsafe names', async () => {
  await withIsolatedAttachments(async (attachments, { cfg, tmpHome }) => {
    const vault = cfg.vaults[0];
    const saved = await attachments.saveAttachment(vault.id, {
      name: 'shot.png', mimeType: 'image/png', bytes: new Uint8Array(PNG_BYTES),
    });
    const read = await attachments.readAttachment(vault.id, saved.fileName);
    assert.deepEqual(read.buffer, PNG_BYTES);
    assert.equal(read.mimeType, 'image/png');

    for (const name of ['../secret.png', 'a/b.png', '.hidden.png', 'notes.txt', 'a..b.png', '']) {
      await assert.rejects(attachments.readAttachment(vault.id, name), /Invalid attachment name/, name);
    }

    // A symlinked attachment must not be readable.
    const linkName = 'sneaky-link.png';
    const outside = path.join(tmpHome, 'outside.png');
    fs.writeFileSync(outside, PNG_BYTES);
    fs.symlinkSync(outside, path.join(tmpHome, vault.slug, 'attachments', linkName));
    await assert.rejects(attachments.readAttachment(vault.id, linkName));
  });
});

test('attachment name helpers sanitize hostile inputs', async () => {
  await withIsolatedAttachments(async (attachments) => {
    const { sanitizeAttachmentBaseName, attachmentExtension } = attachments.__test;
    assert.equal(sanitizeAttachmentBaseName('../../../etc/passwd'), 'passwd');
    assert.equal(sanitizeAttachmentBaseName('..\\..\\win\\shot.png'), 'shot');
    assert.equal(sanitizeAttachmentBaseName(''), 'pasted-image');
    assert.equal(sanitizeAttachmentBaseName('###'), 'pasted-image');
    assert.equal(attachmentExtension('a.PNG', ''), 'png');
    assert.equal(attachmentExtension('', 'image/jpeg'), 'jpg');
    assert.equal(attachmentExtension('a.exe', 'application/octet-stream'), '');
  });
});
