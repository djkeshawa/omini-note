const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const model = require('../lib/import/markdownImportModel');
const { createMarkdownImportService } = require('../main/markdownImportService');
const previewModel = require('../src/shared/importPreviewModel');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-markdown-import-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'pixel.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(root, 'Project.md'), [
    '---',
    'title: Project',
    'aliases: [Launch]',
    '# keep this comment',
    '---',
    '',
    '# Project',
    '',
    '[Child page](Child.md#details)',
    '![Pixel](assets/pixel.png "Preview image")',
    '![Unsafe](../outside.png)',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'Child.md'), '# Child\n\nSee [[Project]].\n');
  return root;
}

function serviceFor(root, overrides = {}) {
  const savedNotes = [];
  const savedAttachments = [];
  const store = {
    ROOT: path.join(root, 'vault-root'),
    async loadVault() { return { notes: [{ id: 'existing', title: 'Project' }] }; },
    async saveNote(_vaultId, note) {
      const persisted = { ...note, title: String(note.title || 'Untitled').trim().slice(0, 240) };
      savedNotes.push(persisted);
      return { ...persisted, modifiedAt: '2026-07-13T00:00:00.000Z' };
    },
    async loadConfig() { return { vaults: [{ id: 'v1', slug: 'personal' }] }; },
    ...overrides.store,
  };
  const attachments = {
    MAX_ATTACHMENT_BYTES: 25 * 1024 * 1024,
    async saveAttachment(_vaultId, payload) {
      const saved = { relPath: `attachments/${savedAttachments.length + 1}-${payload.name}` };
      savedAttachments.push({ ...payload, ...saved });
      return saved;
    },
    ...overrides.attachments,
  };
  const dialog = {
    async showOpenDialog() { return { canceled: false, filePaths: [root] }; },
  };
  const service = createMarkdownImportService({
    fs, path, crypto, store, attachments, dialog, getMainWindow: () => null,
    onNoteSaved: overrides.onNoteSaved,
  });
  return { service, savedNotes, savedAttachments };
}

test('Markdown import model resolves titles and rejects hostile relative paths', () => {
  assert.equal(model.parseImportDocument('---\ntitle: Front matter\n---\n# Heading', 'file.md').sourceTitle, 'Front matter');
  assert.equal(model.parseImportDocument('---\ntitle: 2026\n---\n# Heading', 'file.md').sourceTitle, '2026');
  assert.equal(model.parseImportDocument('# First heading', 'file.md').sourceTitle, 'First heading');
  assert.equal(model.parseImportDocument('No heading', 'Fallback name.md').sourceTitle, 'Fallback name');
  assert.equal(model.resolveRelativeTarget('C:\\notes\\a.md', '../outside.png', 'C:\\notes'), null);
});

test('ImportPreview normalizes the cross-process contract without content overflow', () => {
  const preview = previewModel.normalizeImportPreview({
    token: 'markdown-import-12345678',
    attachmentCount: 3,
    items: [{ source: 'a.md', sourceTitle: 'A', title: 'A', collision: false, attachmentCount: 1 }],
    warnings: [{ source: 'a.md', message: 'Missing file' }],
  });
  assert.equal(preview.token, 'markdown-import-12345678');
  assert.equal(preview.noteCount, 1);
  assert.equal(preview.attachmentCount, 3);
  assert.deepEqual(preview.warnings, [{ source: 'a.md', message: 'Missing file', omitted: false }]);
  assert.equal(previewModel.normalizeImportPreview({ token: '../bad', items: [] }).token, '');
});

test('Markdown folder import previews collisions and safely applies links and attachments', async () => {
  const root = makeFixture();
  try {
    const before = new Map(['Project.md', 'Child.md'].map(name => [name, fs.readFileSync(path.join(root, name))]));
    const { service, savedNotes, savedAttachments } = serviceFor(root);
    const result = await service.preview({ vaultId: 'v1', sourceType: 'folder' });

    assert.equal(result.canceled, false);
    assert.equal(result.preview.noteCount, 2);
    assert.equal(result.preview.attachmentCount, 1);
    assert.equal(result.preview.items.find(item => item.source === 'Project.md').title, 'Project (2)');
    assert.equal(result.preview.warnings.some(warning => /safe relative path/.test(warning.message)), true);
    assert.equal(savedNotes.length, 0, 'preview does not write notes');

    const applied = await service.apply({ vaultId: 'v1', token: result.preview.token });
    assert.equal(applied.imported, 2);
    assert.equal(savedAttachments.length, 1);
    const project = savedNotes.find(note => note.title === 'Project (2)');
    const child = savedNotes.find(note => note.title === 'Child');
    assert.match(project.body, /\[\[Child#details\|Child page\]\]/);
    assert.match(project.body, /!\[Pixel\]\(attachments\/1-pixel\.png "Preview image"\)/);
    assert.match(project.body, /!\[Unsafe\]\(\.\.\/outside\.png\)/);
    assert.match(child.body, /\[\[Project \(2\)\]\]/);
    assert.match(project.frontMatter, /aliases: \[Launch\]/);

    for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(root, name)), bytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Markdown import refuses apply when a previewed source changes', async () => {
  const root = makeFixture();
  try {
    const { service, savedNotes } = serviceFor(root);
    const result = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    fs.appendFileSync(path.join(root, 'Child.md'), '\nChanged after preview.\n');
    await assert.rejects(
      service.apply({ vaultId: 'v1', token: result.preview.token }),
      /changed after preview/
    );
    assert.equal(savedNotes.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('long collision titles stay unique on disk and links use that canonical title', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-markdown-long-title-'));
  const longTitle = 'L'.repeat(240);
  fs.writeFileSync(path.join(root, 'Target.md'), `# ${longTitle}\n`);
  fs.writeFileSync(path.join(root, 'Reference.md'), '[Long target](Target.md)\n');
  const hooked = [];
  try {
    const { service, savedNotes } = serviceFor(root, {
      store: {
        async loadVault() { return { notes: [{ id: 'existing', title: longTitle }] }; },
      },
      onNoteSaved: (vaultId, note) => hooked.push([vaultId, note.id]),
    });
    const previewed = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    const targetPreview = previewed.preview.items.find(item => item.source === 'Target.md');
    assert.equal(targetPreview.title.length, 240);
    assert.match(targetPreview.title, / \(2\)$/);
    assert.notEqual(targetPreview.title, longTitle);

    await service.apply({ vaultId: 'v1', token: previewed.preview.token });
    const target = savedNotes.find(note => note.title === targetPreview.title);
    const reference = savedNotes.find(note => note.title === 'Reference');
    assert.equal(target.title, targetPreview.title, 'the allocated title survives persistence unchanged');
    assert.match(reference.body, new RegExp(`\\[\\[${target.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|Long target\\]\\]`));
    assert.deepEqual(hooked.map(([, noteId]) => noteId).sort(), savedNotes.map(note => note.id).sort());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Obsidian filename links follow an imported note whose heading is sanitized', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-markdown-wiki-title-'));
  fs.writeFileSync(path.join(root, 'Target.md'), '# Setup | Windows\n');
  fs.writeFileSync(path.join(root, 'Reference.md'), 'See [[Target]] and keep [[Setup | Windows]] as an alias link.\n');
  try {
    const { service, savedNotes } = serviceFor(root);
    const previewed = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    await service.apply({ vaultId: 'v1', token: previewed.preview.token });

    const target = savedNotes.find(note => note.title === 'Setup Windows');
    const reference = savedNotes.find(note => note.title === 'Reference');
    assert.ok(target);
    assert.match(reference.body, /\[\[Setup Windows\]\]/);
    assert.match(reference.body, /\[\[Setup \| Windows\]\]/, 'ambiguous alias syntax is left untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Markdown import refuses apply when vault collisions change after preview', async () => {
  const root = makeFixture();
  let loads = 0;
  try {
    const { service, savedNotes } = serviceFor(root, {
      store: {
        async loadVault() {
          loads++;
          return { notes: loads === 1
            ? [{ id: 'existing', title: 'Project' }]
            : [{ id: 'existing', title: 'Project' }, { id: 'new', title: 'Child' }] };
        },
      },
    });
    const result = await service.preview({ vaultId: 'v1', sourceType: 'folder' });
    await assert.rejects(
      service.apply({ vaultId: 'v1', token: result.preview.token }),
      /vault changed after preview/i
    );
    assert.equal(savedNotes.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Markdown import is wired through preload, settings, and an accessible preview dialog', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src', 'platform', 'desktopBridge.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings', 'sections', 'DataSection.jsx'), 'utf8');
  const dialog = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'shell', 'MarkdownImportPreviewDialog.jsx'), 'utf8');

  for (const method of ['previewMarkdownImport', 'applyMarkdownImport', 'cancelMarkdownImport']) {
    assert.match(preload, new RegExp(`${method}:`));
    assert.match(bridge, new RegExp(`'${method}'`));
  }
  assert.match(settings, /Choose files/);
  assert.match(settings, /Choose folder/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /Source files stay untouched/);
});

test('an imported title stays addressable by the wiki links pointing at it', () => {
  // Wiki-link syntax in a title makes the note unreachable: the reader stops at
  // the first `[`, `]`, `|` or `#`, so `# Setup | Windows` produced
  // `[[Setup | Windows|the guide]]` which resolves to "Setup " — a note that
  // does not exist. Every link to it was dead the moment it was written.
  const WIKI_LINK_RE = /\[\[([^\]|#\n]+)((?:#[^\]\n|]+)?(?:\|[^\]\n]+)?)\]\]/;
  for (const heading of ['Setup | Windows', 'Q1 #goals', 'Plan [draft]', 'Normal Title']) {
    const title = model.cleanTitle(heading, 'Imported note');
    const titleByPath = new Map([[model.pathKey('/vault/b.md'), title]]);
    const body = model.rewriteImportedLinks(
      'See [the guide](b.md).',
      '/vault/a.md',
      '/vault',
      titleByPath,
      new Map()
    );
    const match = body.match(WIKI_LINK_RE);
    assert.ok(match, `${heading} must still produce a wiki link`);
    assert.equal(match[1], title, `${heading} must be reachable by the link written for it`);
  }

  // A title made only of syntax has nothing left, so it takes the fallback.
  assert.equal(model.cleanTitle('#|[]', 'Imported note'), 'Imported note');
});
