function createBackupRepository(deps) {
  const {
    fsp, processRef, loadConfig, saveConfig, loadVault, listCanvases, getCanvas,
    readJsonSafe, vaultMetaFile, validateEntityId, backupFormat, appName,
    maxImportBytes, isPlainObject, assertArrayLimit, limits, cleanString,
    allocateVaultSlug, vaultDir, ensureDir, sanitizeVaultMetaPatch, writeJson,
    uniqueImportedEntityId, validateNoteId, assertByteLength, maxNoteBodyBytes,
    serializeFrontMatter, normalizeTagName, atomicWriteFile, noteFile,
    normalizeCanvas, validateCanvasId, maxCanvasBytes, canvasDir, canvasFile,
    retryRename, vaultsWithMeta,
  } = deps;

  async function exportBackup(options = {}) {
    const cfg = await loadConfig();
    const selected = options?.vaultId
      ? cfg.vaults.filter(vault => vault.id === validateEntityId(options.vaultId, 'vault'))
      : cfg.vaults;
    const vaults = [];
    const warnings = [];
    for (const vault of selected) {
      const loaded = await loadVault(vault.id);
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
    return {
      format: backupFormat, app: appName, exportedAt: new Date().toISOString(),
      activeVaultId: cfg.activeVaultId || null, vaults, warnings,
    };
  }

  async function importBackup(payload, options = {}) {
    if (typeof payload === 'string' && Buffer.byteLength(payload, 'utf8') > maxImportBytes) throw new Error('Backup file is too large');
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!isPlainObject(data) || data.format !== backupFormat || !Array.isArray(data.vaults)) throw new Error('Unsupported backup file');
    assertArrayLimit(data.vaults, limits.vaults, `Backup has too many vaults; maximum is ${limits.vaults}`);
    const cfg = await loadConfig();
    const nextCfg = { ...cfg, vaults: [...cfg.vaults] };
    const imported = [];
    const staged = [];
    const createdDirs = [];
    try {
      for (const source of data.vaults) {
        if (!isPlainObject(source)) continue;
        const sourceNotes = Array.isArray(source.notes) ? source.notes : [];
        const sourceCanvases = Array.isArray(source.canvases) ? source.canvases : [];
        assertArrayLimit(sourceNotes, limits.notes, `Backup vault has too many notes; maximum is ${limits.notes}`);
        assertArrayLimit(sourceCanvases, limits.canvases, `Backup vault has too many canvases; maximum is ${limits.canvases}`);
        const sourceName = cleanString(source.name, 'Restored vault');
        const name = options.keepNames === false ? `${sourceName} Restored` : sourceName;
        const finalSlug = allocateVaultSlug({ ...nextCfg, vaults: [...nextCfg.vaults, ...imported] }, name);
        const id = `v_${finalSlug}_${Date.now().toString(36)}`;
        const vault = { id, name, slug: finalSlug, path: vaultDir(finalSlug) };
        const stagingSlug = `.import-${processRef.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const stagingDir = vaultDir(stagingSlug);
        await ensureDir(stagingDir);
        staged.push({ stagingDir, finalDir: vaultDir(finalSlug), vault });
        const rawNovelistAiConfig = source.meta?.novelistAiConfig;
        const cleanMeta = sanitizeVaultMetaPatch({
          tags: source.meta?.tags || [], lastSelectedId: source.meta?.lastSelectedId || source.notes?.[0]?.id || null,
          novelistMode: !!source.meta?.novelistMode, workflowStates: source.meta?.workflowStates || null,
          novelistAiConfig: isPlainObject(rawNovelistAiConfig) ? rawNovelistAiConfig : null,
        });
        await writeJson(vaultMetaFile(stagingSlug), {
          id: vault.id, name: vault.name, slug: vault.slug, tags: cleanMeta.tags || [],
          lastSelectedId: cleanMeta.lastSelectedId || null, novelistMode: !!cleanMeta.novelistMode,
          workflowStates: cleanMeta.workflowStates || null, novelistAiConfig: cleanMeta.novelistAiConfig || null,
          createdAt: source.meta?.createdAt || new Date().toISOString(), restoredAt: new Date().toISOString(),
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
        imported.push(vault);
      }
      for (const item of staged) {
        try { await retryRename(item.stagingDir, item.finalDir); }
        catch (error) {
          if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') throw new Error('Vault import target already exists: ' + item.vault.slug);
          throw error;
        }
        createdDirs.push(item.finalDir);
      }
      nextCfg.vaults.push(...imported);
      if (imported.length && options.activate !== false) nextCfg.activeVaultId = imported[0].id;
      await saveConfig(nextCfg);
      return { importedVaults: imported, activeVaultId: nextCfg.activeVaultId, vaults: await vaultsWithMeta(nextCfg) };
    } catch (error) {
      await Promise.all(staged.map(item => fsp.rm(item.stagingDir, { recursive: true, force: true }).catch(() => {})));
      await Promise.all(createdDirs.map(dir => fsp.rm(dir, { recursive: true, force: true }).catch(() => {})));
      throw error;
    }
  }

  return { exportBackup, importBackup };
}

module.exports = { createBackupRepository };
