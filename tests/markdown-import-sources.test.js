const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createMarkdownImportService } = require('../main/markdownImportService');

// Choosing what to import. The folder walk decides which files are even
// offered, and it walks a directory the user did not write: symlinks, build
// folders, nested trees and duplicate selections all have to be handled before
// a single byte is read. markdown-import-edges.test.js pins the reading limits.

async function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-mdsources-'));
  try { return await fn(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function makeService(root, { limits, dialogFiles, canceled = false, sessionMs } = {}) {
  const saved = { notes: [], attachments: [] };
  const store = {
    async loadVault() { return { notes: [] }; },
    async saveNote(_v, note) { const n = { ...note }; saved.notes.push(n); return { ...n, modifiedAt: 'T0' }; },
    async loadConfig() { return { vaults: [{ id: 'v1', slug: 'personal' }] }; },
  };
  const attachments = {
    MAX_ATTACHMENT_BYTES: 1024,
    async saveAttachment(_v, payload) { saved.attachments.push(payload); return { relPath: `attachments/${payload.name}` }; },
  };
  const dialog = {
    async showOpenDialog() { return canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: dialogFiles || [root] }; },
  };
  const service = createMarkdownImportService({
    fs, path, crypto, store, attachments, dialog, getMainWindow: () => null,
    limits: { ...(sessionMs ? { sessionMs } : {}), ...limits },
  });
  return { service, saved };
}

const write = (root, rel, contents = null) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const name = path.basename(rel).replace(/\.(md|markdown)$/i, '');
  fs.writeFileSync(file, contents == null ? `# ${name}\n\nbody\n` : contents);
  return file;
};

test('only markdown files are offered, and nested folders are walked', async () => {
  await withRoot(async (root) => {
    write(root, 'Top.md');
    write(root, 'Also.markdown');
    write(root, 'notes/Deep.md');
    write(root, 'notes/deeper/Deeper.md');
    write(root, 'README.txt', 'not markdown');
    write(root, 'image.png', 'binary-ish');
    const { service } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.deepEqual(preview.items.map(i => i.title).sort(), ['Also', 'Deep', 'Deeper', 'Top'],
      'every markdown file in the tree is offered, and nothing else is');
  });
});

test('build and history folders are never walked into', async () => {
  await withRoot(async (root) => {
    write(root, 'Kept.md');
    write(root, 'node_modules/pkg/Readme.md');
    write(root, '.git/Notes.md');
    write(root, '.trash/Deleted.md');
    const { service } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.deepEqual(preview.items.map(i => i.title), ['Kept'],
      'a dependency tree or a trash folder is not the user\'s notes');
  });
});

test('a symbolic link inside the folder is skipped with a warning, not followed', async () => {
  await withRoot(async (root) => {
    write(root, 'Real.md');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'Secret.md'), '# Secret');
      fs.symlinkSync(path.join(outside, 'Secret.md'), path.join(root, 'Link.md'));
      fs.symlinkSync(outside, path.join(root, 'linked-folder'));

      const { service } = makeService(root);
      const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
      assert.deepEqual(preview.items.map(i => i.title), ['Real'],
        'nothing reached through a link is imported');
      const messages = preview.warnings.map(w => w.message);
      assert.equal(messages.filter(m => /Skipped symbolic link/.test(m)).length, 2,
        'both the linked file and the linked folder are reported');
      assert.ok(preview.warnings.every(w => !String(w.source || '').includes(outside)),
        'a warning never leaks the path the link pointed at');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('a selection that is itself a symlink is refused outright', async () => {
  await withRoot(async (root) => {
    const real = write(root, 'Real.md');
    const link = path.join(root, 'Link.md');
    fs.symlinkSync(real, link);
    const { service } = makeService(root, { dialogFiles: [link] });
    await assert.rejects(() => service.preview({ vaultId: 'v1' }), /cannot be symbolic links/);
  });
});

test('choosing files directly imports exactly those, deduplicated and ordered', async () => {
  await withRoot(async (root) => {
    const b = write(root, 'B.md', '# B');
    const a = write(root, 'A.md', '# A');
    write(root, 'Unchosen.md', '# Unchosen');
    write(root, 'notes/C.md', '# C');
    const { service } = makeService(root, { dialogFiles: [b, a, b, path.join(root, 'notes', 'C.md')] });
    const { preview } = await service.preview({ vaultId: 'v1' });
    assert.deepEqual(preview.items.map(i => i.title), ['A', 'B', 'C'],
      'the same file chosen twice is imported once, and the order is stable');
    assert.ok(!preview.items.some(i => i.title === 'Unchosen'));
  });
});

test('a chosen folder is walked even in file mode', async () => {
  await withRoot(async (root) => {
    write(root, 'notes/Inner.md');
    const { service } = makeService(root, { dialogFiles: [path.join(root, 'notes')] });
    const { preview } = await service.preview({ vaultId: 'v1' });
    assert.deepEqual(preview.items.map(i => i.title), ['Inner']);
  });
});

test('a chosen file that is not markdown contributes nothing', async () => {
  await withRoot(async (root) => {
    write(root, 'Real.md');
    write(root, 'notes.txt', 'not markdown');
    const { service } = makeService(root, { dialogFiles: [path.join(root, 'notes.txt')] });
    await assert.rejects(() => service.preview({ vaultId: 'v1' }), /No Markdown files were found/);
  });
});

test('too many markdown files is refused before any of them is read', async () => {
  await withRoot(async (root) => {
    for (let i = 0; i < 6; i++) write(root, `Note${i}.md`);
    const { service } = makeService(root, { limits: { fileCount: 3 } });
    await assert.rejects(() => service.preview({ vaultId: 'v1', sourceType: 'folder' }),
      /more than 3 Markdown files/);

    const chosen = makeService(root, {
      limits: { fileCount: 3 },
      dialogFiles: Array.from({ length: 6 }, (_, i) => path.join(root, `Note${i}.md`)),
    });
    await assert.rejects(() => chosen.service.preview({ vaultId: 'v1' }), /more than 3 Markdown files/);
  });
});

test('the warning list is capped and says that it was', async () => {
  await withRoot(async (root) => {
    write(root, 'Real.md');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'target'), 'x');
      for (let i = 0; i < 8; i++) fs.symlinkSync(path.join(outside, 'target'), path.join(root, `link${i}.md`));
      const { service } = makeService(root, { limits: { warningCount: 3 } });
      const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
      assert.equal(preview.warnings.length, 4, 'three warnings plus the note that more were dropped');
      assert.equal(preview.warnings.filter(w => w.omitted).length, 1);
      assert.match(preview.warnings.at(-1).message, /Additional import warnings were omitted\./);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('an import token cannot be applied twice or after it expires', async () => {
  await withRoot(async (root) => {
    write(root, 'A.md', '# A\n\nbody\n');
    const { service, saved } = makeService(root);
    const { preview } = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    assert.ok(preview.token, 'a preview hands back the token that applies it');

    const applied = await service.apply({ vaultId: 'v1', token: preview.token });
    assert.equal(applied.imported, 1);
    assert.equal(saved.notes.length, 1);
    await assert.rejects(() => service.apply({ vaultId: 'v1', token: preview.token }), /expired|unknown|not found/i,
      'a token is spent once, so a double click cannot import twice');
    assert.equal(saved.notes.length, 1);

    await assert.rejects(() => service.apply({ vaultId: 'v1', token: 'never-issued' }), /expired|unknown|not found/i);
    await assert.rejects(() => service.apply({}), /expired|unknown|not found/i);
  });
});
