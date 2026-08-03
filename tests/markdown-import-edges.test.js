const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createMarkdownImportService } = require('../main/markdownImportService');

// Importing a folder of markdown is a file-system operation driven by an
// untrusted folder's contents. These are the guard rails: nothing outside the
// chosen folder is read, oversized or binary files are refused, the warning
// list cannot grow without bound, and a cancelled dialog changes nothing.

async function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-mdimport-'));
  try { return await fn(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function makeService(root, { limits, dialogFiles, canceled = false } = {}) {
  const saved = { notes: [], attachments: [] };
  const store = {
    async loadVault() { return { notes: [] }; },
    async saveNote(_v, note) { const n = { ...note }; saved.notes.push(n); return { ...n, modifiedAt: 'T0' }; },
    async loadConfig() { return { vaults: [{ id: 'v1', slug: 'personal' }] }; },
  };
  const attachments = {
    MAX_ATTACHMENT_BYTES: 1024,
    async saveAttachment(_v, payload) { const s = { relPath: `attachments/${payload.name}` }; saved.attachments.push(payload); return s; },
  };
  const dialog = {
    async showOpenDialog() { return canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: dialogFiles || [root] }; },
  };
  const service = createMarkdownImportService({
    fs, path, crypto, store, attachments, dialog, getMainWindow: () => null, limits,
  });
  return { service, saved };
}

test('a cancelled folder dialog imports nothing', async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, 'A.md'), '# A');
    const { service, saved } = makeService(root, { canceled: true });
    const result = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.equal(result.canceled, true);
    assert.equal(saved.notes.length, 0);
  });
});

test('preview refuses to run without a vault', async () => {
  await withRoot(async (root) => {
    const { service } = makeService(root);
    await assert.rejects(() => service.preview({ vaultId: '' }), /Choose a vault/);
  });
});

test('an empty folder is reported rather than producing an empty import', async () => {
  await withRoot(async (root) => {
    const { service } = makeService(root);
    await assert.rejects(() => service.preview({ vaultId: 'v1', sourceType: 'folder' }), /No Markdown files|No readable/);
  });
});

test('a file larger than the per-file limit is refused', async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, 'Big.md'), '# Big\n' + 'x'.repeat(5000));
    const { service } = makeService(root, { limits: { fileBytes: 100 } });
    await assert.rejects(() => service.preview({ vaultId: 'v1', sourceType: 'folder' }), /too large/i);
  });
});

test('the combined selection cannot exceed the total size limit', async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, 'A.md'), '# A\n' + 'a'.repeat(400));
    fs.writeFileSync(path.join(root, 'B.md'), '# B\n' + 'b'.repeat(400));
    const { service } = makeService(root, { limits: { fileBytes: 10000, totalBytes: 500 } });
    await assert.rejects(() => service.preview({ vaultId: 'v1', sourceType: 'folder' }), /exceed the import size limit/);
  });
});

test('a non-UTF-8 file is skipped with a warning, not imported as mojibake', async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, 'Good.md'), '# Good note');
    fs.writeFileSync(path.join(root, 'Bad.md'), Buffer.from([0xff, 0xfe, 0x00, 0x9c, 0x41]));
    const { service } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.equal(preview.noteCount, 1, 'only the readable file should be imported');
    assert.ok(preview.warnings.some(w => /not valid UTF-8/.test(w.message)), 'the skipped file must be explained');
  });
});

test('an attachment that resolves outside the folder is refused, not read', async () => {
  await withRoot(async (root) => {
    // A secret living beside the import folder, referenced via ../
    fs.writeFileSync(path.join(path.dirname(root), 'secret.png'), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(root, 'Note.md'), '# Note\n\n![x](../secret.png)');
    const { service } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.equal(preview.attachmentCount, 0, 'a path-traversal attachment must not be collected');
    assert.ok(preview.warnings.some(w => /not a safe relative path|outside the selected folder|unsupported/i.test(w.message)),
      `the escape should be surfaced: ${JSON.stringify(preview.warnings)}`);
    fs.rmSync(path.join(path.dirname(root), 'secret.png'), { force: true });
  });
});

test('an oversized attachment is refused while the note still imports', async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, 'big.png'), Buffer.concat([Buffer.from([137, 80, 78, 71]), Buffer.alloc(4096)]));
    fs.writeFileSync(path.join(root, 'Note.md'), '# Note\n\n![big](big.png)');
    const { service } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.equal(preview.noteCount, 1, 'the note itself should still import');
    assert.equal(preview.attachmentCount, 0, 'the oversized attachment is dropped');
    assert.ok(preview.warnings.some(w => /too large/i.test(w.message)));
  });
});

test('two notes that would collide on title get distinct titles', async () => {
  await withRoot(async (root) => {
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'Report.md'), '# Report\n\nfirst');
    fs.writeFileSync(path.join(root, 'sub', 'Report.md'), '# Report\n\nsecond');
    const { service } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.equal(preview.noteCount, 2);
    const titles = preview.items.map(n => n.title);
    assert.equal(new Set(titles).size, 2, `two notes reused a title: ${titles}`);
    assert.ok(preview.items.some(n => n.collision), 'the collision should be flagged for the user');
  });
});

test('apply persists the previewed notes and reports how many', async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, 'One.md'), '# One\n\nbody one');
    fs.writeFileSync(path.join(root, 'Two.md'), '# Two\n\nbody two');
    const { service, saved } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    const applied = await service.apply({ vaultId: 'v1', token: preview.token });
    assert.equal(saved.notes.length, 2, 'both notes should be written');
    assert.equal(applied.imported, 2, 'apply must report how many notes it imported');
    assert.equal(applied.noteIds.length, 2);
  });
});

test('applying an unknown or expired token fails rather than importing nothing silently', async () => {
  await withRoot(async (root) => {
    const { service } = makeService(root);
    await assert.rejects(() => service.apply({ vaultId: 'v1', token: 'markdown-import-deadbeef' }),
      /session|token|expired|not found/i);
  });
});
