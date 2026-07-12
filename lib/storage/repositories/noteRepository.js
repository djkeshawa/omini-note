function createNoteRepository(deps) {
  const {
    fsp, path, loadConfig, validateEntityId, vaultDir, vaultDirectoryExists,
    cleanupVaultSafetyDebounced, readJsonSafe, vaultMetaFile, mapLimit, readNoteFile,
    normalizeTags, normalizeWorkflowStates, isPlainObject, validateNoteId, ensureDir,
    assertByteLength, maxNoteBodyBytes, noteFile, readExistingFile,
    shouldRejectStaleWrite, conflictError, normalizeTagName, serializeFrontMatter,
    cleanString, maxJsonWriteBytes, snapshotNoteVersion, atomicWriteFile,
  } = deps;
  const saveLocks = new Map();

  async function vault(vaultId) {
    const cfg = await loadConfig();
    const safeVaultId = validateEntityId(vaultId, 'vault');
    const found = cfg.vaults.find(item => item.id === safeVaultId);
    if (!found) throw new Error('Vault not found: ' + safeVaultId);
    return { cfg, vault: found, vaultId: safeVaultId };
  }

  async function withSaveLock(vaultId, noteId, fn) {
    const key = `${String(vaultId || '')}:${String(noteId || '')}`;
    const previous = saveLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const chain = previous.then(() => current, () => current);
    saveLocks.set(key, chain);
    try { await previous.catch(() => {}); return await fn(); }
    finally { release(); if (saveLocks.get(key) === chain) saveLocks.delete(key); }
  }

  async function loadVault(vaultId) {
    const resolved = await vault(vaultId);
    const dir = vaultDir(resolved.vault.slug);
    if (!await vaultDirectoryExists(resolved.vault.slug)) throw new Error('Vault folder missing: ' + resolved.vault.name);
    await cleanupVaultSafetyDebounced(resolved.vault.slug);
    const meta = await readJsonSafe(vaultMetaFile(resolved.vault.slug), { tags: [], lastSelectedId: null });
    const files = (await fsp.readdir(dir)).filter(file => file.endsWith('.md'));
    const warnings = [];
    const rows = await mapLimit(files, 32, async fileName => {
      try { return await readNoteFile(path.join(dir, fileName), path.basename(fileName, '.md')); }
      catch (error) {
        if (error.code === 'UNSAFE_FILE') console.warn('Skipped unsafe note file', fileName, error.message || String(error));
        else console.error('Failed to read note', fileName, error);
        warnings.push({ type: 'note-read', file: fileName, message: error.message || String(error) });
        return null;
      }
    });
    const notes = rows.filter(Boolean);
    return {
      vaultId: resolved.vaultId, notes, tags: normalizeTags(meta.tags || []),
      novelistMode: !!meta.novelistMode,
      workflowStates: Array.isArray(meta.workflowStates) ? normalizeWorkflowStates(meta.workflowStates) : null,
      novelistAiConfig: isPlainObject(meta.novelistAiConfig) ? meta.novelistAiConfig : null,
      lastSelectedId: meta.lastSelectedId || notes[0]?.id || null, warnings,
    };
  }

  async function getNote(vaultId, noteId) {
    const resolved = await vault(vaultId);
    try { return await readNoteFile(noteFile(resolved.vault.slug, noteId), validateNoteId(noteId)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async function saveNote(vaultId, note, options = {}) {
    return withSaveLock(vaultId, note?.id, async () => {
      const resolved = await vault(vaultId);
      if (!isPlainObject(note)) throw new Error('Invalid note');
      await ensureDir(vaultDir(resolved.vault.slug));
      assertByteLength(note.body || '', maxNoteBodyBytes, 'Note body is too large');
      const id = validateNoteId(note.id);
      const file = noteFile(resolved.vault.slug, id);
      const existing = await readExistingFile(file);
      if (existing?.stat && shouldRejectStaleWrite(existing.stat, options.expectedModifiedAt)) {
        throw conflictError(existing.stat.mtime.toISOString(), options.expectedModifiedAt);
      }
      const tags = Array.isArray(note.tags) ? note.tags.map(normalizeTagName).filter(Boolean) : [];
      const text = serializeFrontMatter({
        id, title: cleanString(note.title, 'Untitled'), date: note.date || new Date().toISOString(),
        tags, pinned: !!note.pinned, workflowArchived: !!note.workflowArchived,
      }, note.body || '', note.frontMatter || '');
      assertByteLength(text, maxNoteBodyBytes + maxJsonWriteBytes, 'Note file is too large');
      if (existing?.text && existing.text !== text) await snapshotNoteVersion(resolved.vault.slug, id, existing.text);
      await atomicWriteFile(file, text, 'utf8');
      const modifiedAt = (await fsp.stat(file)).mtime.toISOString();
      return { ...note, tags, modifiedAt, diskModifiedAt: modifiedAt };
    });
  }

  return { loadVault, getNote, saveNote };
}

module.exports = { createNoteRepository };
