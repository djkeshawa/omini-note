const fs = require('fs');
const path = require('path');

// How long after an internal mutation a vanished file is still assumed to be
// ours. A delete leaves nothing to stat, so mtime cannot answer the question
// and this is the one case still decided by a clock. Kept just above the
// debounce, because the cost of being generous is missing somebody else's
// delete that happens to land right after one of our saves.
const DELETE_GRACE_MS = 1200;

// Tolerance for the vault-wide fallback only, which has no file to measure and
// so must compare a file's mtime against a Date.now() reading.
//
// Those are two different clocks. Windows ticks its system clock at ~15.6ms
// while NTFS records file times from a finer source, so a file we just wrote
// reads tens of milliseconds newer than the moment we recorded finishing it;
// on POSIX they agree to well under a millisecond. No single number is right,
// which is exactly why the named path below measures instead of guessing.
//
// Every caller in this app names the notes it wrote, so nothing in production
// reaches this. It exists for a caller that cannot.
const DEFAULT_MTIME_SKEW_MS = process.platform === 'win32' ? 50 : 2;
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
// Now the file itself decides, and it decides in its own units. A mutation that
// names the notes it wrote stats each one and keeps the mtime it observed, so a
// later change is ours only if the file has not moved past that exact value.
// Both sides of that comparison come from the filesystem, so no tolerance is
// needed and no clock can disagree with another. An external write lands after
// it and is always reported, however fast we type.
function createVaultWatcher({
  onChange,
  debounceMs = 450,
  watch = fs.watch,
  stat = fs.promises.stat,
  statSync = fs.statSync,
  mtimeSkewMs = DEFAULT_MTIME_SKEW_MS,
} = {}) {
  const skewMs = Number.isFinite(Number(mtimeSkewMs))
    ? Math.max(0, Number(mtimeSkewMs))
    : DEFAULT_MTIME_SKEW_MS;
  const watchers = new Map();
  const timers = new Map();
  const pending = new Map();
  // Two stamps in two different units, deliberately never mixed.
  //
  // internalFileMtime holds the mtime a named file actually had once our write
  // to it finished — a filesystem reading, compared against a later filesystem
  // reading, exact on every platform.
  //
  // internalDoneAt holds a Date.now() for the fallback that has no file to
  // measure, and is the only value needing a skew tolerance.
  //
  // internalMarkedAt is wall clock for every mark, because a deleted file
  // cannot be stat'd and its grace period has to be judged on a clock.
  const internalFileMtime = new Map();
  const internalDoneAt = new Map();
  const internalMarkedAt = new Map();

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
    internalFileMtime.delete(vaultId);
    internalMarkedAt.delete(vaultId);
  }

  // Ours if the file has not been touched since our last mutation to it
  // finished. The stamp is per file wherever the caller could name what it
  // wrote: against a single vault-wide stamp, somebody else's edit to note B
  // disappeared as soon as our own save to note A landed after it, because
  // every file older than our newest write looked like ours. Autosave runs
  // every 500ms, so that was most of the time you were typing.
  async function isExplainedByOurWrite(vaultId, fileName) {
    const ourMtime = internalFileMtime.get(vaultId)?.get(fileName);
    const vaultDoneAt = internalDoneAt.get(vaultId);
    const markedAt = internalMarkedAt.get(vaultId);
    if (ourMtime == null && vaultDoneAt == null) return false;
    const entry = watchers.get(vaultId);
    if (!entry) return false;
    try {
      const info = await stat(path.join(entry.path, fileName));
      // Either stamp may be the newer one — a named mutation and a later
      // vault-wide mutation can both apply to the same file — so ask both
      // rather than picking a winner. Taking the maximum of the two would also
      // mean ranking an mtime against a Date.now(), which are not the same
      // clock and on Windows disagree by more than the interval being measured.
      if (ourMtime != null && info.mtimeMs <= ourMtime) return true;
      if (vaultDoneAt != null && info.mtimeMs <= vaultDoneAt + skewMs) return true;
      return false;
    } catch {
      // Gone. A delete we performed cannot be verified against an mtime that no
      // longer exists, so this one case is still judged on a clock: trust it
      // only while our mutation is recent enough to plausibly be the cause.
      return markedAt != null && Date.now() - markedAt < DELETE_GRACE_MS;
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
    internalFileMtime.clear();
    internalMarkedAt.clear();
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
    internalMarkedAt.set(vaultId, Date.now());
    const names = (Array.isArray(noteIds) ? noteIds : [noteIds])
      .map(id => String(id || '').trim())
      .filter(Boolean)
      .map(id => (id.toLowerCase().endsWith('.md') ? id : `${id}.md`));
    if (!names.length) {
      internalDoneAt.set(vaultId, Date.now());
      return;
    }
    const entry = watchers.get(vaultId);
    if (!internalFileMtime.has(vaultId)) internalFileMtime.set(vaultId, new Map());
    const stamps = internalFileMtime.get(vaultId);
    for (const name of names) {
      // Read back the mtime our write just produced. Comparing that against the
      // mtime a later change reports keeps both sides on the filesystem's own
      // clock, so the answer is exact and identical on every platform. Reading
      // Date.now() here instead is what made a Windows save intermittently look
      // like somebody else's edit.
      //
      // Synchronous on purpose: this runs immediately after the write, on a
      // handful of just-touched files whose metadata is still hot, and every
      // caller is a synchronous post-save hook.
      let observed = null;
      if (entry) {
        try {
          observed = statSync(path.join(entry.path, name)).mtimeMs;
        } catch {
          // Vanished already, or the vault moved. A delete is judged by
          // internalMarkedAt instead, and a stamp we cannot measure is better
          // left unset than guessed at.
        }
      }
      if (observed == null) stamps.delete(name);
      else stamps.set(name, observed);
    }
  }

  return { refresh, close, markInternal, isRelevantVaultFile };
}

module.exports = { createVaultWatcher, isRelevantVaultFile, DEFAULT_MTIME_SKEW_MS };
