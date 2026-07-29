function createSafetyMaintenance(d) {
  const cleanupRuns = new Map();
  const cleanupInFlight = new Map();

  function fileAgeMs(stat) {
    return Date.now() - new Date(stat.mtime).getTime();
  }

  async function cleanupFlatDir(dir, retentionMs = d.safetyRetentionMs) {
    let files = [];
    try { files = await d.fsp.readdir(dir); } catch { return; }
    await d.mapLimit(files, 16, async file => {
      const full = d.path.join(dir, file);
      try { const stat = await d.fsp.stat(full); if (stat.isFile() && fileAgeMs(stat) > retentionMs) await d.fsp.unlink(full); } catch {}
    });
  }

  async function cleanupTempFiles(dir, retentionMs = d.tempRetentionMs) {
    let files = [];
    try { files = await d.fsp.readdir(dir); } catch { return; }
    await d.mapLimit(files, 16, async file => {
      if (!file.startsWith('.') || !file.endsWith('.tmp')) return;
      const full = d.path.join(dir, file);
      try { const stat = await d.fsp.stat(full); if (stat.isFile() && fileAgeMs(stat) > retentionMs) await d.fsp.unlink(full); } catch {}
    });
  }

  async function cleanupDirChildren(dir, prefix, retentionMs) {
    let entries = [];
    try { entries = await d.fsp.readdir(dir); } catch { return; }
    await d.mapLimit(entries, 8, async entry => {
      if (prefix && !entry.startsWith(prefix)) return;
      const full = d.path.join(dir, entry);
      try { const stat = await d.fsp.stat(full); if (stat.isDirectory() && fileAgeMs(stat) > retentionMs) await d.fsp.rm(full, { recursive: true, force: true }); } catch {}
    });
  }

  async function cleanupNoteVersions(slug, noteId) {
    const dir = d.noteVersionsDir(slug, noteId);
    let files = [];
    try { files = (await d.fsp.readdir(dir)).filter(file => file.endsWith('.md')); } catch { return; }
    const rows = [];
    for (const file of files) {
      const full = d.path.join(dir, file);
      try { const stat = await d.fsp.stat(full); rows.push({ full, mtime: stat.mtimeMs, old: fileAgeMs(stat) > d.safetyRetentionMs }); } catch {}
    }
    rows.sort((a, b) => b.mtime - a.mtime);
    await d.mapLimit(rows, 16, async (row, index) => { if (row.old || index >= d.maxNoteVersions) await d.fsp.unlink(row.full).catch(() => {}); });
  }

  async function cleanupVaultSafety(slug) {
    const dir = d.vaultDir(slug);
    await Promise.all([
      cleanupFlatDir(d.trashNoteDir(slug)), cleanupFlatDir(d.trashCanvasDir(slug)), cleanupTempFiles(dir),
      cleanupTempFiles(d.canvasDir(slug)), cleanupTempFiles(d.trashNoteDir(slug)), cleanupTempFiles(d.trashCanvasDir(slug)),
    ]);
    let noteIds = [];
    try { noteIds = await d.fsp.readdir(d.path.join(dir, '.versions', 'notes')); } catch { return; }
    await d.mapLimit(noteIds, 8, async id => { try { await cleanupNoteVersions(slug, id); } catch {} });
  }

  async function cleanupRootSafety() {
    await cleanupTempFiles(d.root);
    await cleanupDirChildren(d.root, '.import-', d.importRetentionMs);
    await cleanupDirChildren(d.path.join(d.root, '.trash', 'vaults'), '', d.safetyRetentionMs);
  }

  async function cleanupVaultSafetyDebounced(slug) {
    const lastRun = cleanupRuns.get(slug) || 0;
    if (Date.now() - lastRun < d.cleanupDebounceMs) return;
    if (cleanupInFlight.has(slug)) return cleanupInFlight.get(slug);
    const promise = cleanupVaultSafety(slug).finally(() => { cleanupRuns.set(slug, Date.now()); cleanupInFlight.delete(slug); });
    cleanupInFlight.set(slug, promise);
    return promise;
  }

  async function moveVaultToTrash(slug) {
    const source = d.vaultDir(slug);
    const trashRoot = d.path.join(d.root, '.trash', 'vaults');
    await d.ensureDir(trashRoot);
    const target = d.path.join(trashRoot, d.uniqueSafetyId('vault', slug));
    try { await d.retryRename(source, target); return target; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  function conflictError({
    entity = 'Note',
    currentRevision = null,
    expectedRevision = null,
    currentModifiedAt = null,
    expectedModifiedAt = null,
  } = {}) {
    const error = new Error(`${entity} changed on disk after it was loaded.`);
    error.code = 'NOTE_CONFLICT';
    error.currentRevision = currentRevision;
    error.expectedRevision = expectedRevision;
    error.currentModifiedAt = currentModifiedAt;
    error.expectedModifiedAt = expectedModifiedAt;
    return error;
  }

  function shouldRejectStaleWrite(stat, expectedModifiedAt) {
    if (!expectedModifiedAt) return false;
    const expected = new Date(expectedModifiedAt).getTime();
    return Number.isFinite(expected) && stat.mtime.getTime() > expected;
  }

  async function snapshotNoteVersion(slug, noteId, text) {
    if (!text) return null;
    const versionId = `ver_${d.safetyStamp()}_${Math.random().toString(36).slice(2, 7)}`;
    await d.atomicWriteFile(d.versionNoteFile(slug, noteId, versionId), text, 'utf8');
    await cleanupNoteVersions(slug, noteId);
    return versionId;
  }

  async function readExistingFile(file, options = {}) {
    try { return await d.readRegularUtf8File(file, { label: 'Existing file', ...options }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  return {
    cleanupFlatDir, cleanupNoteVersions, cleanupVaultSafety, cleanupRootSafety,
    cleanupVaultSafetyDebounced, moveVaultToTrash, conflictError,
    shouldRejectStaleWrite, snapshotNoteVersion, readExistingFile,
  };
}

module.exports = { createSafetyMaintenance };
