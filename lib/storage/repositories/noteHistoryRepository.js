function createNoteHistoryRepository(d) {
  function readExistingNote(file, label = 'Existing note file') {
    return d.readExistingFile(file, d.noteReadOptions(label));
  }

  function assertNoteText(text, label = 'Note file is too large') {
    d.assertByteLength(text, d.maxNoteFileBytes, label);
  }

  async function vault(vaultId) {
    const cfg = await d.loadConfig();
    const id = d.validateEntityId(vaultId, 'vault');
    const found = cfg.vaults.find(item => item.id === id);
    if (!found) throw new Error('Vault not found: ' + id);
    return found;
  }

  async function deleteNote(vaultId, noteId, snapshot = null, options = {}) {
    const id = d.validateNoteId(noteId);
    return d.withNoteLock(vaultId, id, async () => {
      const v = await vault(vaultId);
      const file = d.noteFile(v.slug, id);
      const existing = await readExistingNote(file);
      const expectedRevision = d.resolveExpectedRevision(options, snapshot);
      d.assertExpectedRevision(existing, expectedRevision, {
        entity: 'Note',
        expectedModifiedAt: options.expectedModifiedAt,
      });
      if (!existing && !d.isPlainObject(snapshot)) return null;

      // Existing files always win over renderer snapshots. Copying their exact
      // bytes into trash avoids replacing external edits with stale UI state.
      const trashText = existing?.text || d.serializeFrontMatter({
        id,
        title: d.cleanString(snapshot.title, 'Untitled'),
        date: snapshot.date || new Date().toISOString(),
        tags: Array.isArray(snapshot.tags) ? snapshot.tags.map(d.normalizeTagName).filter(Boolean) : [],
        pinned: !!snapshot.pinned,
        workflowArchived: !!snapshot.workflowArchived,
      }, snapshot.body || '', snapshot.frontMatter || '');
      assertNoteText(trashText, 'Deleted note is too large');
      const { meta } = d.parseFrontMatter(trashText);
      const trashId = d.uniqueSafetyId('trash', id);
      const deletedAt = new Date().toISOString();
      await d.atomicWriteFile(d.trashNoteFile(v.slug, trashId), trashText, 'utf8');
      if (existing) await d.fsp.unlink(file);
      await d.cleanupFlatDir(d.trashNoteDir(v.slug));
      return {
        trashId,
        originalId: id,
        title: meta.title || snapshot?.title || 'Untitled',
        deletedAt,
        diskRevision: d.calculateDiskRevision(trashText),
      };
    });
  }

  async function listDeletedNotes(vaultId) {
    const v = await vault(vaultId);
    const dir = d.trashNoteDir(v.slug);
    await d.cleanupFlatDir(dir);
    let files = [];
    try { files = (await d.fsp.readdir(dir)).filter(file => file.endsWith('.md')); } catch { return []; }
    const items = [];
    for (const fileName of files) {
      try {
        const { text, stat } = await d.readRegularUtf8File(d.path.join(dir, fileName), d.noteReadOptions('Deleted note file'));
        const { meta, body } = d.parseFrontMatter(text);
        items.push({
          sourceType: 'note', trashId: meta.trashId || d.path.basename(fileName, '.md'),
          originalId: meta.originalId || meta.id || '', title: meta.originalTitle || meta.title || 'Untitled',
          deletedAt: meta.deletedAt || stat.mtime.toISOString(), date: meta.date || null,
          tags: Array.isArray(meta.tags) ? meta.tags.map(d.normalizeTagName).filter(Boolean) : [],
          size: Buffer.byteLength(body || '', 'utf8'),
        });
      } catch (error) {
        if (error.code === 'UNSAFE_FILE') console.warn('Skipped unsafe deleted note file', fileName, error.message || String(error));
        else console.error('Failed to read deleted note', fileName, error);
      }
    }
    return items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
  }

  async function restoreDeletedNote(vaultId, trashId) {
    const v = await vault(vaultId);
    const safeTrashId = d.validateTrashId(trashId);
    const sourceFile = d.trashNoteFile(v.slug, safeTrashId);
    const { text } = await d.readRegularUtf8File(sourceFile, d.noteReadOptions('Deleted note file'));
    const { meta, body, source: frontMatterSource } = d.parseFrontMatter(text);
    const legacyTrash = meta.trashId === safeTrashId && !!meta.originalId;
    let noteId = d.validateNoteId(
      (legacyTrash ? meta.originalId : meta.id) || `n_${Date.now().toString(36)}`
    );
    if (await readExistingNote(d.noteFile(v.slug, noteId), 'Restore target note')) {
      const baseId = noteId;
      for (let i = 0; i < 8; i++) {
        const candidate = d.validateNoteId(`${baseId}_restored_${d.randomUUID().replace(/-/g, '').slice(0, 12)}`);
        if (!(await readExistingNote(d.noteFile(v.slug, candidate), 'Restore target note'))) { noteId = candidate; break; }
      }
      if (await readExistingNote(d.noteFile(v.slug, noteId), 'Restore target note')) {
        throw new Error('Could not allocate restored note id');
      }
    }
    return d.withNoteLock(vaultId, noteId, async () => {
      const target = d.noteFile(v.slug, noteId);
      if (await readExistingNote(target, 'Restore target note')) {
        throw new Error('Restore target changed while the note was being restored');
      }
      const sourceNoteId = d.validateNoteId(meta.id || noteId);
      if (!legacyTrash && sourceNoteId === noteId) {
        await d.retryRename(sourceFile, target);
      } else {
        const restoredText = d.serializeFrontMatter({
          id: noteId, title: meta.originalTitle || meta.title || 'Untitled', date: meta.date || new Date().toISOString(),
          tags: Array.isArray(meta.tags) ? meta.tags.map(d.normalizeTagName).filter(Boolean) : [],
          pinned: !!meta.pinned, workflowArchived: !!meta.workflowArchived,
          originalId: null, trashId: null, deletedAt: null, originalTitle: null,
        }, body, frontMatterSource);
        assertNoteText(restoredText, 'Restored note is too large');
        await d.atomicWriteFile(target, restoredText, 'utf8');
        await d.fsp.unlink(sourceFile);
      }
      return d.readNoteFile(target, noteId);
    });
  }

  async function purgeDeletedNote(vaultId, trashId) {
    const v = await vault(vaultId);
    const id = d.validateTrashId(trashId);
    try { await d.fsp.unlink(d.trashNoteFile(v.slug, id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { purged: true, trashId: id };
  }

  async function listNoteVersions(vaultId, noteId) {
    const v = await vault(vaultId);
    const id = d.validateNoteId(noteId);
    await d.cleanupNoteVersions(v.slug, id);
    const dir = d.noteVersionsDir(v.slug, id);
    let files = [];
    try { files = (await d.fsp.readdir(dir)).filter(file => file.endsWith('.md')); } catch { return []; }
    const items = [];
    for (const fileName of files) {
      try {
        const { text, stat } = await d.readRegularUtf8File(d.path.join(dir, fileName), d.noteReadOptions('Note version file'));
        const { meta, body } = d.parseFrontMatter(text);
        items.push({ versionId: d.path.basename(fileName, '.md'), noteId: id, title: meta.title || 'Untitled',
          createdAt: stat.mtime.toISOString(), date: meta.date || null,
          tags: Array.isArray(meta.tags) ? meta.tags.map(d.normalizeTagName).filter(Boolean) : [], size: Buffer.byteLength(body || '', 'utf8') });
      } catch (error) {
        if (error.code === 'UNSAFE_FILE') console.warn('Skipped unsafe note version file', fileName, error.message || String(error));
        else console.error('Failed to read note version', fileName, error);
      }
    }
    return items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  async function getNoteVersion(vaultId, noteId, versionId) {
    const v = await vault(vaultId);
    const id = d.validateNoteId(noteId);
    const safeVersionId = d.validateVersionId(versionId);
    const { text, stat } = await d.readRegularUtf8File(d.versionNoteFile(v.slug, id, safeVersionId), d.noteReadOptions('Note version file'));
    const { meta, body } = d.parseFrontMatter(text);
    return { versionId: safeVersionId, noteId: id, title: meta.title || 'Untitled', createdAt: stat.mtime.toISOString(), body: body || '' };
  }

  async function restoreNoteVersion(vaultId, noteId, versionId) {
    const id = d.validateNoteId(noteId);
    return d.withNoteLock(vaultId, id, async () => {
      const v = await vault(vaultId);
      const { text } = await d.readRegularUtf8File(d.versionNoteFile(v.slug, id, d.validateVersionId(versionId)), d.noteReadOptions('Note version file'));
      const current = await readExistingNote(d.noteFile(v.slug, id));
      if (current?.text && current.text !== text) await d.snapshotNoteVersion(v.slug, id, current.text);
      const { meta, body, source: frontMatterSource } = d.parseFrontMatter(text);
      const target = d.noteFile(v.slug, id);
      const restoredText = d.serializeFrontMatter({
        id, title: meta.title || 'Untitled', date: meta.date || new Date().toISOString(),
        tags: Array.isArray(meta.tags) ? meta.tags.map(d.normalizeTagName).filter(Boolean) : [],
        pinned: !!meta.pinned, workflowArchived: !!meta.workflowArchived,
      }, body, frontMatterSource);
      assertNoteText(restoredText, 'Restored note is too large');
      await d.atomicWriteFile(target, restoredText, 'utf8');
      return d.readNoteFile(target, id);
    });
  }

  return { deleteNote, listDeletedNotes, restoreDeletedNote, purgeDeletedNote, listNoteVersions, getNoteVersion, restoreNoteVersion };
}

module.exports = { createNoteHistoryRepository };
