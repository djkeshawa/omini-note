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
const UNKNOWN_FILE = '';

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
  // When a mutation can name the notes it wrote, each gets its own stamp. The
  // vault-wide stamp below is only the fallback for mutations that cannot.
  const internalFileDoneAt = new Map();
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
    internalFileDoneAt.delete(vaultId);
  }

  // Ours if the file has not been touched since our last mutation to it
  // finished. The stamp is per file wherever the caller could name what it
  // wrote: against a single vault-wide stamp, somebody else's edit to note B
  // disappeared as soon as our own save to note A landed after it, because
  // every file older than our newest write looked like ours. Autosave runs
  // every 500ms, so that was most of the time you were typing.
  async function isExplainedByOurWrite(vaultId, fileName) {
    // A named mutation and a later vault-wide mutation may both apply to the
    // same file. The newest completed mutation is the only meaningful cutoff;
    // preferring the per-file value merely because it exists resurrects an
    // older timestamp and reports the later vault-wide write as external.
    const doneAt = Math.max(
      internalFileDoneAt.get(vaultId)?.get(fileName) || 0,
      internalDoneAt.get(vaultId) || 0
    );
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
    const changes = [];
    let fullVault = false;
    for (const [fileName, eventType] of changed) {
      if (fileName === UNKNOWN_FILE) {
        fullVault = true;
        changes.push({ fileName: null, eventType: String(eventType || 'change') });
        continue;
      }
      if (await isExplainedByOurWrite(vaultId, fileName)) continue;
      changes.push({
        fileName: String(fileName),
        eventType: String(eventType || 'change'),
      });
    }
    if (!changes.length) return;
    const namedChanges = changes.filter(change => change.fileName);
    const first = namedChanges[0] || changes[0];
    onChange?.({
      vaultId,
      // Keep the original single-file fields for existing renderer consumers
      // while giving backend work the complete debounced batch.
      fileName: first.fileName || '',
      eventType: first.eventType,
      fileNames: namedChanges.map(change => change.fileName),
      changes,
      fullVault,
    });
  }

  function schedule(vaultId, fileName, eventType) {
    const name = fileName == null || String(fileName) === '' ? UNKNOWN_FILE : String(fileName);
    if (name !== UNKNOWN_FILE && !isRelevantVaultFile(name)) return;
    if (!pending.has(vaultId)) pending.set(vaultId, new Map());
    pending.get(vaultId).set(name, String(eventType || 'change'));
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
    internalFileDoneAt.clear();
  }

  // Call after the write lands, not before it. The point in time is what the
  // mtime comparison is against, so announcing an intention is worthless —
  // the file does not exist in its new form yet.
  //
  // Pass every note the mutation wrote, including a link-rename cascade, and
  // only those notes are treated as ours. Omitting them falls back to a
  // vault-wide stamp, which suppresses this mutation across the whole vault —
  // correct but blunt, so name the notes whenever the caller knows them.
  function markInternal(vaultId, noteIds) {
    if (!vaultId) return;
    const names = (Array.isArray(noteIds) ? noteIds : [noteIds])
      .map(id => String(id || '').trim())
      .filter(Boolean)
      .map(id => (id.toLowerCase().endsWith('.md') ? id : `${id}.md`));
    if (!names.length) {
      internalDoneAt.set(vaultId, Date.now());
      return;
    }
    if (!internalFileDoneAt.has(vaultId)) internalFileDoneAt.set(vaultId, new Map());
    const stamps = internalFileDoneAt.get(vaultId);
    const at = Date.now();
    for (const name of names) stamps.set(name, at);
  }

  return { refresh, close, markInternal, isRelevantVaultFile };
}

module.exports = { createVaultWatcher, isRelevantVaultFile };
