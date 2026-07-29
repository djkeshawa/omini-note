function createCanvasRepository(deps) {
  const {
    fsp, path, randomUUID, loadConfig, validateEntityId, canvasDir, canvasFile,
    trashCanvasDir, trashCanvasFile, readRegularUtf8File, maxCanvasBytes,
    normalizeCanvas, ensureDir, atomicWriteFile, assertByteLength, validateCanvasId,
    validateTrashId, uniqueSafetyId, cleanupFlatDir, readExistingFile,
    resolveExpectedRevision, assertExpectedRevision, calculateDiskRevision,
    withCanvasLock, retryRename,
  } = deps;

  function readExistingCanvas(file, label = 'Existing canvas file') {
    return readExistingFile(file, {
      label,
      maxBytes: maxCanvasBytes,
      tooLargeMessage: `${label} is too large`,
    });
  }

  async function vault(vaultId) {
    const cfg = await loadConfig();
    const safeVaultId = validateEntityId(vaultId, 'vault');
    const found = cfg.vaults.find(item => item.id === safeVaultId);
    if (!found) throw new Error('Vault not found: ' + safeVaultId);
    return found;
  }

  async function listCanvases(vaultId) {
    const currentVault = await vault(vaultId);
    const dir = canvasDir(currentVault.slug);
    await ensureDir(dir);
    const files = (await fsp.readdir(dir)).filter(file => file.endsWith('.json'));
    const canvases = [];
    for (const fileName of files) {
      try {
        const { text, stat } = await readRegularUtf8File(path.join(dir, fileName), {
          label: 'Canvas file', maxBytes: maxCanvasBytes, tooLargeMessage: 'Canvas file is too large',
        });
        const canvas = normalizeCanvas(JSON.parse(text));
        canvases.push({
          id: canvas.id, title: canvas.title, createdAt: canvas.createdAt,
          modifiedAt: canvas.modifiedAt || stat.mtime.toISOString(), elementCount: canvas.elements.length,
          diskModifiedAt: stat.mtime.toISOString(),
          diskRevision: calculateDiskRevision(text),
        });
      } catch (error) {
        if (error.code === 'UNSAFE_FILE') console.warn('Skipped unsafe canvas file', fileName, error.message || String(error));
        else console.error('Failed to read canvas', fileName, error);
      }
    }
    return canvases.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
  }

  async function getCanvas(vaultId, canvasId) {
    const currentVault = await vault(vaultId);
    const { text, stat } = await readRegularUtf8File(canvasFile(currentVault.slug, canvasId), {
      label: 'Canvas file', maxBytes: maxCanvasBytes, tooLargeMessage: 'Canvas file is too large',
    });
    return {
      ...normalizeCanvas(JSON.parse(text)),
      diskModifiedAt: stat.mtime.toISOString(),
      diskRevision: calculateDiskRevision(text),
    };
  }

  async function saveCanvas(vaultId, canvas, options = {}) {
    const id = validateCanvasId(canvas?.id || `c_${Date.now().toString(36)}`);
    return withCanvasLock(vaultId, id, async () => {
      const currentVault = await vault(vaultId);
      const file = canvasFile(currentVault.slug, id);
      const existing = await readExistingCanvas(file);
      const expectedRevision = resolveExpectedRevision(options, canvas);
      assertExpectedRevision(existing, expectedRevision, { entity: 'Canvas' });
      const next = normalizeCanvas({ ...canvas, id, modifiedAt: new Date().toISOString() });
      const text = JSON.stringify(next, null, 2);
      assertByteLength(text, maxCanvasBytes, 'Canvas is too large');
      await ensureDir(canvasDir(currentVault.slug));
      await atomicWriteFile(file, text, 'utf8');
      const stat = await fsp.stat(file);
      return {
        ...next,
        diskModifiedAt: stat.mtime.toISOString(),
        diskRevision: calculateDiskRevision(text),
      };
    });
  }

  async function deleteCanvas(vaultId, canvasId, options = {}) {
    const id = validateCanvasId(canvasId);
    return withCanvasLock(vaultId, id, async () => {
      const currentVault = await vault(vaultId);
      const file = canvasFile(currentVault.slug, id);
      const existing = await readExistingCanvas(file);
      const expectedRevision = resolveExpectedRevision(options);
      assertExpectedRevision(existing, expectedRevision, { entity: 'Canvas' });
      if (!existing) return null;
      const raw = existing.text;
      const trashId = uniqueSafetyId('canvas', id);
      let canvas;
      try { canvas = JSON.parse(raw); } catch { canvas = { title: 'Unreadable canvas', elements: [] }; }
      const deletedAt = new Date().toISOString();
      await atomicWriteFile(trashCanvasFile(currentVault.slug, trashId), raw, 'utf8');
      await fsp.unlink(file);
      await cleanupFlatDir(trashCanvasDir(currentVault.slug));
      return {
        trashId,
        originalId: id,
        title: canvas.title || 'Untitled canvas',
        deletedAt,
        diskRevision: calculateDiskRevision(raw),
      };
    });
  }

  async function listDeletedCanvases(vaultId) {
    const currentVault = await vault(vaultId);
    const dir = trashCanvasDir(currentVault.slug);
    await cleanupFlatDir(dir);
    let files = [];
    try { files = (await fsp.readdir(dir)).filter(file => file.endsWith('.json')); } catch { return []; }
    const items = [];
    for (const fileName of files) {
      try {
        const { text, stat } = await readRegularUtf8File(path.join(dir, fileName), {
          label: 'Deleted canvas file', maxBytes: maxCanvasBytes, tooLargeMessage: 'Deleted canvas file is too large',
        });
        const canvas = JSON.parse(text);
        items.push({
          sourceType: 'canvas', trashId: canvas.trashId || path.basename(fileName, '.json'),
          originalId: canvas.originalId || canvas.id || '', title: canvas.title || 'Untitled canvas',
          deletedAt: canvas.deletedAt || stat.mtime.toISOString(), size: Buffer.byteLength(text || '', 'utf8'),
          elementCount: Array.isArray(canvas.elements) ? canvas.elements.length : 0,
        });
      } catch (error) {
        if (error.code === 'UNSAFE_FILE') console.warn('Skipped unsafe deleted canvas file', fileName, error.message || String(error));
        else console.error('Failed to read deleted canvas', fileName, error);
      }
    }
    return items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
  }

  async function restoreDeletedCanvas(vaultId, trashId) {
    const currentVault = await vault(vaultId);
    const safeTrashId = validateTrashId(trashId);
    const source = trashCanvasFile(currentVault.slug, safeTrashId);
    const { text } = await readRegularUtf8File(source, {
      label: 'Deleted canvas file', maxBytes: maxCanvasBytes, tooLargeMessage: 'Deleted canvas file is too large',
    });
    const rawCanvas = JSON.parse(text);
    const legacyTrash = rawCanvas.trashId === safeTrashId && !!rawCanvas.originalId;
    let canvasId = validateCanvasId(legacyTrash ? rawCanvas.originalId : rawCanvas.id);
    if (await readExistingCanvas(canvasFile(currentVault.slug, canvasId), 'Restore target canvas')) {
      const baseId = canvasId;
      for (let i = 0; i < 8; i++) {
        const candidate = validateCanvasId(`${baseId}_restored_${randomUUID().replace(/-/g, '').slice(0, 12)}`);
        if (!(await readExistingCanvas(canvasFile(currentVault.slug, candidate), 'Restore target canvas'))) {
          canvasId = candidate;
          break;
        }
      }
      if (await readExistingCanvas(canvasFile(currentVault.slug, canvasId), 'Restore target canvas')) {
        throw new Error('Could not allocate restored canvas id');
      }
    }
    return withCanvasLock(vaultId, canvasId, async () => {
      const target = canvasFile(currentVault.slug, canvasId);
      if (await readExistingCanvas(target, 'Restore target canvas')) {
        throw new Error('Restore target changed while the canvas was being restored');
      }
      if (!legacyTrash && validateCanvasId(rawCanvas.id) === canvasId) {
        await ensureDir(canvasDir(currentVault.slug));
        await retryRename(source, target);
        return getCanvas(vaultId, canvasId);
      }
      const restored = normalizeCanvas({ ...rawCanvas, id: canvasId, modifiedAt: new Date().toISOString() });
      delete restored.originalId;
      delete restored.trashId;
      delete restored.deletedAt;
      await ensureDir(canvasDir(currentVault.slug));
      const restoredText = JSON.stringify(restored, null, 2);
      assertByteLength(restoredText, maxCanvasBytes, 'Canvas is too large');
      await atomicWriteFile(target, restoredText, 'utf8');
      await fsp.unlink(source);
      const stat = await fsp.stat(target);
      return {
        ...restored,
        diskModifiedAt: stat.mtime.toISOString(),
        diskRevision: calculateDiskRevision(restoredText),
      };
    });
  }

  async function purgeDeletedCanvas(vaultId, trashId) {
    const currentVault = await vault(vaultId);
    try { await fsp.unlink(trashCanvasFile(currentVault.slug, validateTrashId(trashId))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { purged: true, trashId };
  }

  return {
    listCanvases, getCanvas, saveCanvas, deleteCanvas,
    listDeletedCanvases, restoreDeletedCanvas, purgeDeletedCanvas,
  };
}

module.exports = { createCanvasRepository };
