// A corrupt .config.json used to be silently quarantined and replaced by a
// first-run seed, so a user with notes in `personal/` booted into an empty
// `personal-2/` and their vaults looked gone. They were never gone: every
// vault folder carries its own .meta.json. This rebuilds the vault list from
// the folders on disk and only falls back to the seed when there is nothing
// there to adopt.
function createConfigRecovery(deps) {
  const { fsp, path, root, maxMetaBytes, writeConfigSnapshot, firstRunSeed } = deps;

  let quarantinedFile = null;
  let recoveryMarker = null;

  // Passed to the shared JSON reader as `onQuarantine`, for the config file only.
  function noteQuarantine(file) {
    quarantinedFile = file || null;
  }

  function titleCaseSlug(slug) {
    return String(slug || '')
      .split(/[-_]+/)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || String(slug || '');
  }

  function isAdoptableDirName(name) {
    // Dot-prefixed folders are ours (.trash, .versions) and `.import-*` staging
    // dirs are half-written imports. Neither is a vault the user made.
    return !!name && !name.startsWith('.') && /^[A-Za-z0-9_-]+$/.test(name);
  }

  function vaultFromMeta(meta, slug, usedIds) {
    const rawId = typeof meta.id === 'string' && /^[A-Za-z0-9_-]+$/.test(meta.id) ? meta.id : '';
    let id = rawId || `v_${slug}`;
    for (let i = 2; usedIds.has(id); i++) id = `v_${slug}_${i}`;
    usedIds.add(id);
    const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : titleCaseSlug(slug);
    return { id, name, slug, path: path.join(root, slug) };
  }

  // Read-only on purpose. The shared JSON reader renames an unreadable file to
  // `<file>.broken.<stamp>`, which is right for our own config but wrong here:
  // this pass only looks, and quarantining a vault's own .meta.json would
  // damage the user's data while trying to rescue it. A file we cannot parse
  // is simply not adopted, and it is left exactly as it was found.
  async function readMetaForScan(file) {
    try {
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.size > maxMetaBytes) return null;
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch { return null; }
  }

  // Every directory under ROOT that holds a readable .meta.json is a vault the
  // user owns, whatever the config says about it.
  async function scanRootForVaults(scanRoot = root) {
    let entries = [];
    try { entries = await fsp.readdir(scanRoot, { withFileTypes: true }); }
    catch { return []; }
    const slugs = entries
      .filter(entry => entry.isDirectory() && isAdoptableDirName(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
    const usedIds = new Set();
    const vaults = [];
    for (const slug of slugs) {
      const meta = await readMetaForScan(path.join(scanRoot, slug, '.meta.json'));
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
      vaults.push(vaultFromMeta(meta, slug, usedIds));
    }
    return vaults;
  }

  function buildConfig(vaults) {
    return {
      vaults,
      activeVaultId: vaults[0]?.id || null,
      tweaks: null,
      aiConfig: null,
      phase5Metrics: null,
      enabledPacks: ['views'],
      localUsageMetrics: true,
      anonymousUsageSharing: false,
      featureUsage: null,
      lastBackupAt: null,
    };
  }

  // Called by initializeConfig when the config is missing, unreadable, or has
  // no vaults in it. `reason` is what the caller knows; a quarantined file is
  // proof it was unreadable and outranks it. The notice tells the user which
  // of the three actually happened, so it never claims damage that did not
  // occur. brokenFile stays absolute for callers that must find the file;
  // brokenFileName is the basename the notice puts in prose.
  async function recoverOrSeedConfig(reason = 'unreadable') {
    const vaults = await scanRootForVaults(root);
    if (!vaults.length) return firstRunSeed();
    const saved = await writeConfigSnapshot(buildConfig(vaults));
    recoveryMarker = {
      vaultCount: vaults.length,
      brokenFile: quarantinedFile,
      brokenFileName: quarantinedFile ? path.basename(quarantinedFile) : null,
      reason: quarantinedFile ? 'unreadable' : reason,
    };
    return saved;
  }

  // Main-process memory only: the next boot reads a valid config, never
  // recovers, and this is null again.
  function getConfigRecovery() {
    return recoveryMarker;
  }

  return { noteQuarantine, scanRootForVaults, recoverOrSeedConfig, getConfigRecovery };
}

module.exports = { createConfigRecovery };
