const fs = require('fs');
const path = require('path');

// How long after an internal mutation a vanished file is still assumed to be
// ours. A delete leaves nothing to stat, so mtime cannot answer the question
// and this is the one case still decided by a clock. Kept just above the
// debounce, because the cost of being generous is missing somebody else's
// delete that happens to land right after one of our saves.
const DELETE_GRACE_MS = 1200;

// mtimeMs carries sub-millisecond precision while Date.now() truncates to
// whole milliseconds, so a file we just wrote can read as fractionally newer
// than the moment we recorded finishing it. This absorbs that skew and
// nothing more — it is three orders of magnitude tighter than the 1500ms
// window it replaces.
const MTIME_SKEW_MS = 2;

function isRelevantVaultFile(fileName) {
  const name = String(fileName || '');
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\')) return false;
  return path.extname(name).toLowerCase() === '.md';
}

// Watches vault directories and reports changes the app did not make itself.
//
// Telling those apart used to be a blind 1500ms window per vault: anything
// arriving inside it was assumed to be our own write. That failed both ways.
// Our writes are announced before the vault lock, so a save delayed behind a
// boot rescan or a link-rename cascade landed after the window and was
// reported back to the user as an outside edit. And because autosave fires
// every 500ms, continuous typing renewed the window forever — a genuine edit
// from Obsidian or git in the same vault was dropped and never re-checked.
//
// Now the file itself decides. Each internal mutation records when it
// finished, and a changed file is ours only if its mtime predates that. An
// external write lands after it and is always reported, however fast we type.
function createVaultWatcher({ onChange, debounceMs = 450, watch = fs.watch, stat = fs.promises.stat } = {}) {
  const watchers = new Map();
  const timers = new Map();
  const pending = new Map();
  const internalDoneAt = new Map();

  function closeVault(vaultId) {
    const watcher = watchers.get(vaultId);
    if (watcher) {
      try { watcher.close(); } catch {}
      watchers.delete(vaultId);
    }
    const timer = timers.get(vaultId);
    if (timer) clearTimeout(timer);
    timers.delete(vaultId);
    pending.delete(vaultId);
    internalDoneAt.delete(vaultId);
  }

  // Ours if the file has not been touched since our last mutation finished.
  async function isExplainedByOurWrite(vaultId, fileName) {
    const doneAt = internalDoneAt.get(vaultId) || 0;
    if (!doneAt) return false;
    const entry = watchers.get(vaultId);
    if (!entry) return false;
    try {
      const info = await stat(path.join(entry.path, fileName));
      return info.mtimeMs <= doneAt + MTIME_SKEW_MS;
    } catch {
      // Gone. A delete we performed cannot be verified, so trust it only
      // while our mutation is recent enough to plausibly be the cause.
      return Date.now() - doneAt < DELETE_GRACE_MS;
    }
  }

  async function fire(vaultId) {
    timers.delete(vaultId);
    const changed = pending.get(vaultId);
    pending.delete(vaultId);
    if (!changed || !changed.size) return;
    for (const [fileName, eventType] of changed) {
      if (await isExplainedByOurWrite(vaultId, fileName)) continue;
      onChange?.({ vaultId, fileName: String(fileName), eventType: String(eventType || 'change') });
      return;
    }
  }

  function schedule(vaultId, fileName, eventType) {
    if (!isRelevantVaultFile(fileName)) return;
    if (!pending.has(vaultId)) pending.set(vaultId, new Map());
    pending.get(vaultId).set(String(fileName), String(eventType || 'change'));
    const previous = timers.get(vaultId);
    if (previous) clearTimeout(previous);
    timers.set(vaultId, setTimeout(() => {
      fire(vaultId).catch(error => console.error('vault watcher check failed', vaultId, error));
    }, Math.max(50, Number(debounceMs) || 450)));
  }

  function refresh(vaults = []) {
    const next = new Map((vaults || []).filter(vault => vault?.id && vault?.path).map(vault => [vault.id, vault.path]));
    for (const [vaultId, entry] of watchers) {
      if (!next.has(vaultId) || next.get(vaultId) !== entry.path) closeVault(vaultId);
    }
    for (const [vaultId, vaultPath] of next) {
      if (watchers.has(vaultId)) continue;
      try {
        const watcher = watch(vaultPath, { persistent: false }, (eventType, fileName) => schedule(vaultId, fileName, eventType));
        watcher.on?.('error', error => console.error('vault watcher failed', vaultId, error));
        watchers.set(vaultId, { path: vaultPath, close: () => watcher.close() });
      } catch (error) {
        console.error('could not watch vault', vaultId, error);
      }
    }
  }

  function close() {
    [...watchers.keys()].forEach(closeVault);
    pending.clear();
    internalDoneAt.clear();
  }

  // Call after the write lands, not before it. The point in time is what the
  // mtime comparison is against, so announcing an intention is worthless —
  // the file does not exist in its new form yet.
  function markInternal(vaultId) {
    if (!vaultId) return;
    internalDoneAt.set(vaultId, Date.now());
  }

  return { refresh, close, markInternal, isRelevantVaultFile };
}

module.exports = { createVaultWatcher, isRelevantVaultFile };
