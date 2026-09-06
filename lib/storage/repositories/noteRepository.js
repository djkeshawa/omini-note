function createNoteRepository(deps) {
  const {
    fsp, path, loadConfig, validateEntityId, vaultDir, vaultDirectoryExists,
    cleanupVaultSafetyDebounced, readJsonSafe, vaultMetaFile, mapLimit, readNoteFile,
    normalizeTags, normalizeWorkflowStates, isPlainObject, validateNoteId, ensureDir,
    assertByteLength, maxNoteBodyBytes, noteFile, readExistingFile,
    resolveExpectedRevision, assertExpectedRevision, calculateDiskRevision,
    normalizeTagName, serializeFrontMatter, withNoteLock,
    cleanString, maxJsonWriteBytes, snapshotNoteVersion, atomicWriteFile,
    parseFrontMatter, noteReadOptions,
  } = deps;
  // Autosave fires every half second while typing; snapshotting every save
  // filled the version history with near-identical copies of the same minute
  // and paid a full write + versions-dir sweep each time. One snapshot per
  // note per minute keeps recovery useful and cuts the churn.
  const lastSnapshotAt = new Map();
  const SNAPSHOT_MIN_INTERVAL_MS = 60_000;

  async function vault(vaultId) {
    const cfg = await loadConfig();
    const safeVaultId = validateEntityId(vaultId, 'vault');
    const found = cfg.vaults.find(item => item.id === safeVaultId);
    if (!found) throw new Error('Vault not found: ' + safeVaultId);
    return { cfg, vault: found, vaultId: safeVaultId };
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
    if (!isPlainObject(note)) throw new Error('Invalid note');
    const id = validateNoteId(note.id);
    return withNoteLock(vaultId, id, async () => {
      const resolved = await vault(vaultId);
      await ensureDir(vaultDir(resolved.vault.slug));
      assertByteLength(note.body || '', maxNoteBodyBytes, 'Note body is too large');
      const file = noteFile(resolved.vault.slug, id);
      const existing = await readExistingFile(file, noteReadOptions('Existing note file'));
      const expectedRevision = resolveExpectedRevision(options, note);
      assertExpectedRevision(existing, expectedRevision, {
        entity: 'Note',
        expectedModifiedAt: options.expectedModifiedAt,
      });
      const tags = Array.isArray(note.tags) ? note.tags.map(normalizeTagName).filter(Boolean) : [];
      const text = serializeFrontMatter({
        id, title: cleanString(note.title, 'Untitled'), date: note.date || new Date().toISOString(),
        tags, pinned: !!note.pinned, workflowArchived: !!note.workflowArchived,
      }, note.body || '', note.frontMatter || '');
      assertByteLength(text, maxNoteBodyBytes + maxJsonWriteBytes, 'Note file is too large');
      if (existing?.text && existing.text !== text) {
        const snapshotKey = `${resolved.vault.slug}/${id}`;
        const last = lastSnapshotAt.get(snapshotKey) || 0;
        if (Date.now() - last >= SNAPSHOT_MIN_INTERVAL_MS) {
          await snapshotNoteVersion(resolved.vault.slug, id, existing.text);
          lastSnapshotAt.set(snapshotKey, Date.now());
        }
      }
      await atomicWriteFile(file, text, 'utf8');
      const modifiedAt = (await fsp.stat(file)).mtime.toISOString();
      // The save handler needs the pre-save title to know whether links must
      // be renamed. It used to read and parse the whole file a second time to
      // learn it; the text was already in hand right here.
      const previousTitle = existing?.text && parseFrontMatter
        ? cleanString(parseFrontMatter(existing.text)?.meta?.title, '')
        : '';
      return {
        ...note,
        id,
        tags,
        modifiedAt,
        diskModifiedAt: modifiedAt,
        diskRevision: calculateDiskRevision(text),
        previousTitle,
      };
    });
  }

  // Stat-only, but include every filename and revision marker. A count and
  // maximum mtime miss edits to older files when sync tools preserve mtimes.
  async function vaultStamp(vaultId) {
    const resolved = await vault(vaultId);
    const dir = vaultDir(resolved.vault.slug);
    if (!await vaultDirectoryExists(resolved.vault.slug)) return { count: 0, maxMtimeMs: 0 };
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    let maxMtimeMs = 0;
    const markers = await mapLimit(files, 16, async (entry) => {
      // An incomplete scan must fail so the renderer falls back to reloading.
      const info = await fsp.stat(path.join(dir, entry.name));
      if (info.mtimeMs > maxMtimeMs) maxMtimeMs = info.mtimeMs;
      return [entry.name, info.size, info.mtimeMs, info.ctimeMs, info.ino];
    });
    return { count: files.length, maxMtimeMs, fingerprint: calculateDiskRevision(JSON.stringify(markers)) };
  }

  return { loadVault, getNote, saveNote, vaultStamp };
}

module.exports = { createNoteRepository };
