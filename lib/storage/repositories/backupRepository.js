function createBackupRepository(deps) {
  const {
    fsp, processRef, loadConfig, updateConfig, loadVault, listCanvases, getCanvas,
    readJsonSafe, vaultMetaFile, validateEntityId, backupFormat, appName,
    maxImportBytes, isPlainObject, assertArrayLimit, limits, cleanString,
    allocateVaultSlug, vaultDir, ensureDir, sanitizeVaultMetaPatch, writeJson,
    uniqueImportedEntityId, validateNoteId, assertByteLength, maxNoteBodyBytes,
    maxNoteFileBytes,
    serializeFrontMatter, normalizeTagName, atomicWriteFile, noteFile,
    normalizeCanvas, validateCanvasId, maxCanvasBytes, canvasDir, canvasFile,
    retryRename, vaultsWithMeta,
  } = deps;

  // A backup that quietly dropped an unreadable note, or that no importer will
  // ever accept, is worse than no backup: the user believes they are covered.
  // Every problem found while building the payload travels with it.
  //
  // The payload is serialized here, once, and the caller writes that exact
  // string: on a 10k-note vault a second stringify means a second
  // multi-megabyte string alive at the same time. The oversize warning also
  // travels inside the file it describes, so once one is appended the payload
  // is re-measured until the number stops moving — only the digit count of the
  // size can shift it, so this settles on the first correction. The megabytes
  // the user reads are then the megabytes on disk.
  function checkRestoreLimits(payload, warnings) {
    const noteCount = payload.vaults.reduce((total, vault) => total + (vault.notes?.length || 0), 0);
    let text = JSON.stringify(payload);
    let sizeBytes = Buffer.byteLength(text, 'utf8');
    const appended = [];
    const oversize = (vaultId, breached) => {
      const warning = {
        type: 'backup-too-large', vaultId, breached,
        noteCount, sizeBytes,
        sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 10) / 10,
        sizeLimitMb: Math.round(maxImportBytes / (1024 * 1024)),
        limit: limits.notes, canvasLimit: limits.canvases,
      };
      warnings.push(warning);
      appended.push(warning);
    };
    if (sizeBytes > maxImportBytes) oversize(null, 'size');
    for (const vault of payload.vaults) {
      if ((vault.notes?.length || 0) > limits.notes) oversize(vault.id, 'notes');
      if ((vault.canvases?.length || 0) > limits.canvases) oversize(vault.id, 'canvases');
    }
    for (let pass = 0; appended.length && pass < 3; pass++) {
      text = JSON.stringify(payload);
      const measured = Buffer.byteLength(text, 'utf8');
      if (measured === sizeBytes) break;
      sizeBytes = measured;
      for (const warning of appended) {
        warning.sizeBytes = sizeBytes;
        warning.sizeMb = Math.round((sizeBytes / (1024 * 1024)) * 10) / 10;
      }
    }
    return { text, sizeBytes, noteCount };
  }

  async function exportBackup(options = {}) {
    const cfg = await loadConfig();
    const selected = options?.vaultId
      ? cfg.vaults.filter(vault => vault.id === validateEntityId(options.vaultId, 'vault'))
      : cfg.vaults;
    // The one breach importBackup refuses outright, so it is a failure rather
    // than a warning, and it is checked before a single vault is read: telling
    // the user up front beats failing hours later at restore.
    assertArrayLimit(selected, limits.vaults, `Backup has too many vaults; maximum is ${limits.vaults}`);
    const vaults = [];
    const warnings = [];
    for (const vault of selected) {
      const loaded = await loadVault(vault.id);
      // loadVault already knows which note files it could not read. Dropping
      // those on the floor is what let an incomplete backup look complete.
      for (const warning of loaded.warnings || []) {
        warnings.push(isPlainObject(warning)
          ? { ...warning, vaultId: vault.id }
          : { type: 'note-read', vaultId: vault.id, message: String(warning) });
      }
      const meta = await readJsonSafe(vaultMetaFile(vault.slug), {});
      const canvases = [];
      for (const summary of await listCanvases(vault.id)) {
        try { canvases.push(await getCanvas(vault.id, summary.id)); }
        catch (error) { warnings.push({ type: 'canvas-read', vaultId: vault.id, canvasId: summary.id, message: error.message || String(error) }); }
      }
      vaults.push({
        id: vault.id, name: vault.name, slug: vault.slug,
        meta: {
          tags: loaded.tags || [], lastSelectedId: loaded.lastSelectedId || null,
          novelistMode: !!loaded.novelistMode, workflowStates: loaded.workflowStates || null,
          novelistAiConfig: loaded.novelistAiConfig || null, createdAt: meta.createdAt || null,
        },
        notes: loaded.notes || [], canvases,
      });
    }
    const payload = {
      format: backupFormat, app: appName, exportedAt: new Date().toISOString(),
      activeVaultId: cfg.activeVaultId || null, vaults, warnings,
    };
    // Same constants importBackup enforces, checked before the user trusts the
    // file. The backup is still returned and still written either way.
    const { text, sizeBytes, noteCount } = checkRestoreLimits(payload, warnings);
    // noteCount and canvasCount are counted here and travel with the payload so
    // the caller never recounts them against a different denominator.
    const canvasCount = vaults.reduce((total, vault) => total + (vault.canvases?.length || 0), 0);
    return { payload, text, sizeBytes, noteCount, canvasCount };
  }

  async function importBackup(payload, options = {}) {
    if (typeof payload === 'string' && Buffer.byteLength(payload, 'utf8') > maxImportBytes) throw new Error('Backup file is too large');
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!isPlainObject(data) || data.format !== backupFormat || !Array.isArray(data.vaults)) throw new Error('Unsupported backup file');
    assertArrayLimit(data.vaults, limits.vaults, `Backup has too many vaults; maximum is ${limits.vaults}`);
    const staged = [];
    const createdDirs = [];
    let configCommitted = false;
    try {
      for (const source of data.vaults) {
        if (!isPlainObject(source)) continue;
        const sourceNotes = Array.isArray(source.notes) ? source.notes : [];
        const sourceCanvases = Array.isArray(source.canvases) ? source.canvases : [];
        assertArrayLimit(sourceNotes, limits.notes, `Backup vault has too many notes; maximum is ${limits.notes}`);
        assertArrayLimit(sourceCanvases, limits.canvases, `Backup vault has too many canvases; maximum is ${limits.canvases}`);
        const sourceName = cleanString(source.name, 'Restored vault');
        const name = options.keepNames === false ? `${sourceName} Restored` : sourceName;
        const stagingSlug = `.import-${processRef.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const stagingDir = vaultDir(stagingSlug);
        await ensureDir(stagingDir);
        const rawNovelistAiConfig = source.meta?.novelistAiConfig;
        const cleanMeta = sanitizeVaultMetaPatch({
          tags: source.meta?.tags || [], lastSelectedId: source.meta?.lastSelectedId || source.notes?.[0]?.id || null,
          novelistMode: !!source.meta?.novelistMode, workflowStates: source.meta?.workflowStates || null,
          novelistAiConfig: isPlainObject(rawNovelistAiConfig) ? rawNovelistAiConfig : null,
        });
        staged.push({
          stagingSlug,
          stagingDir,
          name,
          cleanMeta,
          createdAt: source.meta?.createdAt || null,
        });
        const usedNoteIds = new Set();
        for (const note of sourceNotes) {
          if (!isPlainObject(note)) continue;
          const noteId = uniqueImportedEntityId(note.id, usedNoteIds, validateNoteId, 'n_imported');
          assertByteLength(note.body || '', maxNoteBodyBytes, 'Note body is too large');
          const text = serializeFrontMatter({
            id: noteId, title: cleanString(note.title, 'Untitled'), date: note.date || new Date().toISOString(),
            tags: Array.isArray(note.tags) ? note.tags.map(normalizeTagName).filter(Boolean) : [],
            pinned: !!note.pinned, workflowArchived: !!note.workflowArchived,
          }, note.body || '', note.frontMatter || '');
          assertByteLength(text, maxNoteFileBytes, 'Note file is too large');
          await atomicWriteFile(noteFile(stagingSlug, noteId), text, 'utf8');
        }
        const usedCanvasIds = new Set();
        for (const canvas of sourceCanvases) {
          if (!isPlainObject(canvas)) continue;
          const next = normalizeCanvas({ ...canvas, id: uniqueImportedEntityId(canvas.id, usedCanvasIds, validateCanvasId, 'c_imported') });
          const text = JSON.stringify(next, null, 2);
          assertByteLength(text, maxCanvasBytes, 'Canvas is too large');
          await ensureDir(canvasDir(stagingSlug));
          await atomicWriteFile(canvasFile(stagingSlug, next.id), text, 'utf8');
        }
      }

      // Staging intentionally happens before the config lock. Once all input
      // is validated and durable, allocate names from the latest registry and
      // commit every imported vault as one serialized config mutation.
      const { config, result } = await updateConfig(async cfg => {
        const imported = [];
        for (const item of staged) {
          const finalSlug = allocateVaultSlug(cfg, item.name);
          const id = `v_${finalSlug}_${Date.now().toString(36)}`;
          const vault = { id, name: item.name, slug: finalSlug, path: vaultDir(finalSlug) };
          const finalDir = vaultDir(finalSlug);
          await writeJson(vaultMetaFile(item.stagingSlug), {
            id: vault.id, name: vault.name, slug: vault.slug, tags: item.cleanMeta.tags || [],
            lastSelectedId: item.cleanMeta.lastSelectedId || null,
            novelistMode: !!item.cleanMeta.novelistMode,
            workflowStates: item.cleanMeta.workflowStates || null,
            novelistAiConfig: item.cleanMeta.novelistAiConfig || null,
            createdAt: item.createdAt || new Date().toISOString(),
            restoredAt: new Date().toISOString(),
          });
          try {
            await retryRename(item.stagingDir, finalDir);
          } catch (error) {
            if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
              throw new Error('Vault import target already exists: ' + vault.slug);
            }
            throw error;
          }
          createdDirs.push(finalDir);
          cfg.vaults.push(vault);
          imported.push(vault);
        }
        if (imported.length && options.activate !== false) cfg.activeVaultId = imported[0].id;
        return { importedVaults: imported, activeVaultId: cfg.activeVaultId };
      });
      configCommitted = true;
      return {
        ...result,
        vaults: await vaultsWithMeta(config),
      };
    } catch (error) {
      await Promise.all(staged.map(item => fsp.rm(item.stagingDir, { recursive: true, force: true }).catch(() => {})));
      if (!configCommitted) {
        await Promise.all(createdDirs.map(dir => fsp.rm(dir, { recursive: true, force: true }).catch(() => {})));
      }
      throw error;
    }
  }

  return { exportBackup, importBackup };
}

module.exports = { createBackupRepository };
