function createNoteHistoryRepository(d) {
  async function vault(vaultId) {
    const cfg = await d.loadConfig();
    const id = d.validateEntityId(vaultId, 'vault');
    const found = cfg.vaults.find(item => item.id === id);
    if (!found) throw new Error('Vault not found: ' + id);
    return found;
  }

  async function deleteNote(vaultId, noteId, snapshot = null) {
    const v = await vault(vaultId);
    const id = d.validateNoteId(noteId);
    const file = d.noteFile(v.slug, id);
    const existing = await d.readExistingFile(file);
    if (!existing && !d.isPlainObject(snapshot)) return null;
    const snapshotText = d.isPlainObject(snapshot) ? d.serializeFrontMatter({
      id, title: d.cleanString(snapshot.title, 'Untitled'), date: snapshot.date || new Date().toISOString(),
      tags: Array.isArray(snapshot.tags) ? snapshot.tags.map(d.normalizeTagName).filter(Boolean) : [],
      pinned: !!snapshot.pinned, workflowArchived: !!snapshot.workflowArchived,
    }, snapshot.body || '') : existing.text;
    const { meta, body } = d.parseFrontMatter(snapshotText);
    const trashId = d.uniqueSafetyId('trash', id);
    const deletedAt = new Date().toISOString();
    await d.atomicWriteFile(d.trashNoteFile(v.slug, trashId), d.serializeFrontMatter({
      ...meta, id, originalId: id, trashId, deletedAt, originalTitle: meta.title || 'Untitled',
    }, body), 'utf8');
    if (existing) await d.fsp.unlink(file);
    await d.cleanupFlatDir(d.trashNoteDir(v.slug));
    return { trashId, originalId: id, title: meta.title || 'Untitled', deletedAt };
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
    const source = d.trashNoteFile(v.slug, d.validateTrashId(trashId));
    const { text } = await d.readRegularUtf8File(source, d.noteReadOptions('Deleted note file'));
    const { meta, body } = d.parseFrontMatter(text);
    let noteId = d.validateNoteId(meta.originalId || meta.id || `n_${Date.now().toString(36)}`);
    if (await d.readExistingFile(d.noteFile(v.slug, noteId))) {
      const baseId = noteId;
      for (let i = 0; i < 8; i++) {
        const candidate = d.validateNoteId(`${baseId}_restored_${d.randomUUID().replace(/-/g, '').slice(0, 12)}`);
        if (!(await d.readExistingFile(d.noteFile(v.slug, candidate)))) { noteId = candidate; break; }
      }
      if (await d.readExistingFile(d.noteFile(v.slug, noteId))) throw new Error('Could not allocate restored note id');
    }
    const target = d.noteFile(v.slug, noteId);
    await d.atomicWriteFile(target, d.serializeFrontMatter({
      id: noteId, title: meta.originalTitle || meta.title || 'Untitled', date: meta.date || new Date().toISOString(),
      tags: Array.isArray(meta.tags) ? meta.tags.map(d.normalizeTagName).filter(Boolean) : [],
      pinned: !!meta.pinned, workflowArchived: !!meta.workflowArchived,
    }, body), 'utf8');
    await d.fsp.unlink(source);
    return d.readNoteFile(target, noteId);
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
    const v = await vault(vaultId);
    const id = d.validateNoteId(noteId);
    const { text } = await d.readRegularUtf8File(d.versionNoteFile(v.slug, id, d.validateVersionId(versionId)), d.noteReadOptions('Note version file'));
    const current = await d.readExistingFile(d.noteFile(v.slug, id));
    if (current?.text && current.text !== text) await d.snapshotNoteVersion(v.slug, id, current.text);
    const { meta, body } = d.parseFrontMatter(text);
    const target = d.noteFile(v.slug, id);
    await d.atomicWriteFile(target, d.serializeFrontMatter({
      id, title: meta.title || 'Untitled', date: meta.date || new Date().toISOString(),
      tags: Array.isArray(meta.tags) ? meta.tags.map(d.normalizeTagName).filter(Boolean) : [],
      pinned: !!meta.pinned, workflowArchived: !!meta.workflowArchived,
    }, body), 'utf8');
    return d.readNoteFile(target, id);
  }

  return { deleteNote, listDeletedNotes, restoreDeletedNote, purgeDeletedNote, listNoteVersions, getNoteVersion, restoreNoteVersion };
}

module.exports = { createNoteHistoryRepository };
