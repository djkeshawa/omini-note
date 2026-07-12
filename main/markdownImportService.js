const {
  MARKDOWN_EXTENSION_RE,
  allocateUniqueTitle,
  collectAttachmentReferences,
  isWithinRoot,
  parseImportDocument,
  pathKey,
  rewriteAttachmentLinks,
  rewriteImportedLinks,
} = require('../lib/import/markdownImportModel');
const { normalizeImportPreview } = require('../src/shared/importPreviewModel');

const DEFAULT_LIMITS = Object.freeze({
  fileCount: 1000,
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  attachmentBytes: 250 * 1024 * 1024,
  attachmentReferences: 2000,
  warningCount: 200,
  sessionMs: 15 * 60 * 1000,
});

function createMarkdownImportService(deps) {
  const { fs, path, crypto, dialog, store, attachments, getMainWindow } = deps;
  const fsp = fs.promises;
  const limits = { ...DEFAULT_LIMITS, ...(deps.limits || {}) };
  const sessions = new Map();

  function hashBuffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  function pruneSessions() {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
    while (sessions.size > 10) sessions.delete(sessions.keys().next().value);
  }

  function addWarning(warnings, warning) {
    if (warnings.length < limits.warningCount) warnings.push(warning);
    else if (!warnings.some(item => item.omitted)) {
      warnings.push({ omitted: true, message: 'Additional import warnings were omitted.' });
    }
  }

  async function validateRegularFile(filePath, rootPath, options = {}) {
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(options.label || 'Source must be a regular file.');
    const [realFile, realRoot] = await Promise.all([fsp.realpath(filePath), fsp.realpath(rootPath)]);
    if (!isWithinRoot(realFile, realRoot)) throw new Error(options.escapeMessage || 'Source resolves outside the selected folder.');
    if (options.maxBytes && stat.size > options.maxBytes) throw new Error(options.tooLargeMessage || 'Source file is too large.');
    return stat;
  }

  async function readRegularFile(filePath, rootPath, options = {}) {
    await validateRegularFile(filePath, rootPath, options);
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    let handle = null;
    try {
      handle = await fsp.open(filePath, fs.constants.O_RDONLY | noFollow);
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(options.label || 'Source must be a regular file.');
      if (options.maxBytes && stat.size > options.maxBytes) throw new Error(options.tooLargeMessage || 'Source file is too large.');
      const bytes = await handle.readFile();
      if (bytes.length !== stat.size) throw new Error(options.changedMessage || 'Source changed while it was being read.');
      const [realFile, realRoot] = await Promise.all([fsp.realpath(filePath), fsp.realpath(rootPath)]);
      if (!isWithinRoot(realFile, realRoot)) throw new Error(options.escapeMessage || 'Source resolves outside the selected folder.');
      return { bytes, stat };
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function walkDirectory(rootPath, warnings) {
    const files = [];
    const queue = [rootPath];
    while (queue.length) {
      const directory = queue.shift();
      const entries = await fsp.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          addWarning(warnings, { source: path.relative(rootPath, entryPath), message: 'Skipped symbolic link.' });
          continue;
        }
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.trash') continue;
          queue.push(entryPath);
          continue;
        }
        if (entry.isFile() && MARKDOWN_EXTENSION_RE.test(entry.name)) files.push({ filePath: entryPath, rootPath });
        if (files.length > limits.fileCount) throw new Error(`Import contains more than ${limits.fileCount} Markdown files.`);
      }
    }
    return files;
  }

  async function selectedSources(sourceType) {
    const folderMode = sourceType === 'folder';
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: folderMode ? 'Import Markdown folder' : 'Import Markdown files',
      properties: folderMode ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: folderMode ? undefined : [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (result.canceled || !result.filePaths?.length) return { canceled: true, files: [], warnings: [] };
    const warnings = [];
    const files = [];
    for (const selectedPath of [...result.filePaths].sort((a, b) => a.localeCompare(b))) {
      const stat = await fsp.lstat(selectedPath);
      if (stat.isSymbolicLink()) throw new Error('Selected import sources cannot be symbolic links.');
      if (stat.isDirectory()) files.push(...await walkDirectory(selectedPath, warnings));
      else if (stat.isFile() && MARKDOWN_EXTENSION_RE.test(selectedPath)) {
        files.push({ filePath: selectedPath, rootPath: path.dirname(selectedPath) });
      }
    }
    const unique = new Map(files.map(item => [pathKey(item.filePath), item]));
    if (unique.size > limits.fileCount) throw new Error(`Import contains more than ${limits.fileCount} Markdown files.`);
    return {
      canceled: false,
      files: [...unique.values()].sort((a, b) => pathKey(a.filePath).localeCompare(pathKey(b.filePath))),
      warnings,
    };
  }

  function importedNoteId(filePath, contentHash, usedIds) {
    const base = `import_${hashBuffer(`${pathKey(filePath)}\n${contentHash}`).slice(0, 20)}`;
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) candidate = `${base}_${suffix++}`;
    usedIds.add(candidate);
    return candidate;
  }

  async function inspectAttachment(reference, item, warnings) {
    const source = path.relative(item.rootPath, item.filePath) || path.basename(item.filePath);
    if (reference.error) {
      addWarning(warnings, { source, message: `${reference.rawTarget}: ${reference.error}` });
      return null;
    }
    if (!reference.supported) {
      addWarning(warnings, { source, message: `${reference.rawTarget}: unsupported attachment type.` });
      return null;
    }
    try {
      const { stat, bytes } = await readRegularFile(reference.targetPath, item.rootPath, {
        label: 'Attachment must be a regular file.',
        escapeMessage: 'Attachment resolves outside the selected folder.',
        maxBytes: attachments.MAX_ATTACHMENT_BYTES,
        tooLargeMessage: 'Attachment is too large.',
      });
      return {
        rawTarget: reference.rawTarget,
        filePath: reference.targetPath,
        fileName: path.basename(reference.targetPath),
        mimeType: reference.mimeType,
        size: stat.size,
        hash: hashBuffer(bytes),
      };
    } catch (error) {
      addWarning(warnings, { source, message: `${reference.rawTarget}: ${error.message || String(error)}` });
      return null;
    }
  }

  async function preview(options = {}) {
    const vaultId = String(options.vaultId || '');
    if (!vaultId) throw new Error('Choose a vault before importing Markdown.');
    pruneSessions();
    const selection = await selectedSources(options.sourceType);
    if (selection.canceled) return { canceled: true };
    if (!selection.files.length) throw new Error('No Markdown files were found in the selection.');
    const vault = await store.loadVault(vaultId);
    const usedTitles = new Set((vault.notes || []).map(note => String(note.title || '').toLocaleLowerCase()));
    const usedIds = new Set((vault.notes || []).map(note => String(note.id || '')));
    const warnings = [...selection.warnings];
    const items = [];
    let totalBytes = 0;
    for (const source of selection.files) {
      const { stat, bytes } = await readRegularFile(source.filePath, source.rootPath, {
        maxBytes: limits.fileBytes,
        tooLargeMessage: `${path.basename(source.filePath)} is too large to import.`,
      });
      totalBytes += bytes.length;
      if (totalBytes > limits.totalBytes) throw new Error('Selected Markdown files exceed the import size limit.');
      const text = bytes.toString('utf8');
      if (text.includes('\uFFFD')) {
        addWarning(warnings, { source: path.basename(source.filePath), message: 'Skipped file because it is not valid UTF-8.' });
        continue;
      }
      const document = parseImportDocument(text, source.filePath);
      const title = allocateUniqueTitle(document.sourceTitle, usedTitles);
      items.push({
        ...source,
        ...document,
        title,
        collision: title !== document.sourceTitle,
        id: importedNoteId(source.filePath, hashBuffer(bytes), usedIds),
        size: stat.size,
        hash: hashBuffer(bytes),
        attachments: [],
      });
    }
    if (!items.length) throw new Error('No readable UTF-8 Markdown files were found.');

    const titleByPath = new Map(items.map(item => [pathKey(item.filePath), item.title]));
    const sourceTitleCounts = new Map();
    for (const item of items) {
      const key = item.sourceTitle.toLocaleLowerCase();
      sourceTitleCounts.set(key, (sourceTitleCounts.get(key) || 0) + 1);
    }
    const renamedTitles = new Map(items
      .filter(item => item.title !== item.sourceTitle && sourceTitleCounts.get(item.sourceTitle.toLocaleLowerCase()) === 1)
      .map(item => [item.sourceTitle.toLocaleLowerCase(), item.title]));

    const inspectedAttachments = new Map();
    let attachmentBytes = 0;
    let attachmentReferences = 0;
    for (const item of items) {
      const references = collectAttachmentReferences(item.body, item.filePath, item.rootPath);
      const uniqueReferences = new Map(references.map(reference => [reference.rawTarget, reference]));
      for (const reference of uniqueReferences.values()) {
        attachmentReferences++;
        if (attachmentReferences > limits.attachmentReferences) {
          throw new Error(`Import references more than ${limits.attachmentReferences} attachments.`);
        }
        const key = reference.targetPath ? pathKey(reference.targetPath) : '';
        let attachment = key ? inspectedAttachments.get(key) : null;
        if (attachment) attachment = { ...attachment, rawTarget: reference.rawTarget };
        else {
          attachment = await inspectAttachment(reference, item, warnings);
          if (attachment && key) {
            inspectedAttachments.set(key, attachment);
            attachmentBytes += attachment.size;
            if (attachmentBytes > limits.attachmentBytes) throw new Error('Referenced attachments exceed the import size limit.');
          }
        }
        if (attachment) item.attachments.push(attachment);
      }
    }

    const token = `markdown-import-${crypto.randomUUID()}`;
    const session = {
      token,
      vaultId,
      items,
      titleByPath,
      renamedTitles,
      warnings,
      expiresAt: Date.now() + limits.sessionMs,
    };
    sessions.set(token, session);
    return {
      canceled: false,
      preview: normalizeImportPreview({
        token,
        noteCount: items.length,
        attachmentCount: inspectedAttachments.size,
        items: items.map(item => ({
          source: path.relative(item.rootPath, item.filePath) || path.basename(item.filePath),
          sourceTitle: item.sourceTitle,
          title: item.title,
          collision: item.collision,
          attachmentCount: item.attachments.length,
        })),
        warnings,
      }),
    };
  }

  async function verifyFrozenFile(filePath, rootPath, expected, label) {
    const { stat, bytes } = await readRegularFile(filePath, rootPath, {
      maxBytes: expected.size,
      tooLargeMessage: `${label} changed after preview.`,
      changedMessage: `${label} changed after preview.`,
    });
    if (stat.size !== expected.size || hashBuffer(bytes) !== expected.hash) throw new Error(`${label} changed after preview. Preview the import again.`);
    return bytes;
  }

  async function rollbackCreatedFiles(vaultId, noteIds, attachmentPaths) {
    const config = await store.loadConfig();
    const vault = (config.vaults || []).find(item => item.id === vaultId);
    if (!vault) return;
    const vaultPath = path.resolve(store.ROOT, vault.slug);
    const candidates = [
      ...noteIds.map(id => path.resolve(vaultPath, `${id}.md`)),
      ...attachmentPaths.map(relPath => path.resolve(vaultPath, relPath)),
    ];
    for (const candidate of candidates) {
      if (!isWithinRoot(candidate, vaultPath)) continue;
      await fsp.unlink(candidate).catch(error => { if (error.code !== 'ENOENT') console.error('Markdown import rollback failed', candidate, error); });
    }
  }

  async function apply(options = {}) {
    pruneSessions();
    const token = String(options.token || '');
    const vaultId = String(options.vaultId || '');
    const session = sessions.get(token);
    if (!session || session.vaultId !== vaultId) throw new Error('Import preview expired. Preview the files again.');
    const currentVault = await store.loadVault(vaultId);
    const currentIds = new Set((currentVault.notes || []).map(note => String(note.id || '')));
    const currentTitles = new Set((currentVault.notes || []).map(note => String(note.title || '').toLocaleLowerCase()));
    if (session.items.some(item => currentIds.has(item.id) || currentTitles.has(item.title.toLocaleLowerCase()))) {
      throw new Error('The vault changed after preview. Preview the import again to resolve collisions safely.');
    }
    const attachmentBytesByPath = new Map();
    for (const item of session.items) {
      await verifyFrozenFile(item.filePath, item.rootPath, item, path.basename(item.filePath));
      for (const attachment of item.attachments) {
        const key = pathKey(attachment.filePath);
        if (!attachmentBytesByPath.has(key)) {
          attachmentBytesByPath.set(key, await verifyFrozenFile(attachment.filePath, item.rootPath, attachment, attachment.fileName));
        }
      }
    }

    const createdNoteIds = [];
    const createdAttachmentPaths = [];
    const savedAttachmentBySource = new Map();
    const savedNotes = [];
    try {
      for (const item of session.items) {
        const replacements = new Map();
        for (const attachment of item.attachments) {
          const key = pathKey(attachment.filePath);
          let saved = savedAttachmentBySource.get(key);
          if (!saved) {
            saved = await attachments.saveAttachment(vaultId, {
              name: attachment.fileName,
              mimeType: attachment.mimeType,
              bytes: attachmentBytesByPath.get(key),
            });
            savedAttachmentBySource.set(key, saved);
            createdAttachmentPaths.push(saved.relPath);
          }
          replacements.set(attachment.rawTarget, saved.relPath);
        }
        let body = rewriteAttachmentLinks(item.body, replacements);
        body = rewriteImportedLinks(body, item.filePath, item.rootPath, session.titleByPath, session.renamedTitles);
        const saved = await store.saveNote(vaultId, {
          id: item.id,
          title: item.title,
          date: typeof item.meta.date === 'string' ? item.meta.date : new Date().toISOString(),
          tags: Array.isArray(item.meta.tags) ? item.meta.tags : [],
          pinned: item.meta.pinned === true,
          workflowArchived: item.meta.workflowArchived === true,
          frontMatter: item.frontMatter,
          body,
        });
        createdNoteIds.push(item.id);
        savedNotes.push(saved);
      }
    } catch (error) {
      await rollbackCreatedFiles(vaultId, createdNoteIds, createdAttachmentPaths);
      throw error;
    }
    sessions.delete(token);
    return {
      imported: savedNotes.length,
      attachments: createdAttachmentPaths.length,
      noteIds: savedNotes.map(note => note.id),
      warnings: session.warnings,
    };
  }

  function cancel(options = {}) {
    const token = String(options.token || '');
    const session = sessions.get(token);
    if (session && (!options.vaultId || session.vaultId === String(options.vaultId))) sessions.delete(token);
    return { canceled: true };
  }

  return { apply, cancel, preview, __test: { sessions } };
}

module.exports = { createMarkdownImportService };
