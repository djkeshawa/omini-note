const fs = require('fs');
const path = require('path');

function isRelevantVaultFile(fileName) {
  const name = String(fileName || '');
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\')) return false;
  return path.extname(name).toLowerCase() === '.md';
}

function createVaultWatcher({ onChange, debounceMs = 450, watch = fs.watch } = {}) {
  const watchers = new Map();
  const timers = new Map();
  const internalUntil = new Map();

  function closeVault(vaultId) {
    const watcher = watchers.get(vaultId);
    if (watcher) {
      try { watcher.close(); } catch {}
      watchers.delete(vaultId);
    }
    const timer = timers.get(vaultId);
    if (timer) clearTimeout(timer);
    timers.delete(vaultId);
  }

  function schedule(vaultId, fileName, eventType) {
    if (!isRelevantVaultFile(fileName)) return;
    if ((internalUntil.get(vaultId) || 0) > Date.now()) return;
    const previous = timers.get(vaultId);
    if (previous) clearTimeout(previous);
    timers.set(vaultId, setTimeout(() => {
      timers.delete(vaultId);
      onChange?.({ vaultId, fileName: String(fileName), eventType: String(eventType || 'change') });
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
    internalUntil.clear();
  }

  function markInternal(vaultId, durationMs = 1500) {
    if (!vaultId) return;
    internalUntil.set(vaultId, Date.now() + Math.max(250, Number(durationMs) || 1500));
  }

  return { refresh, close, markInternal, isRelevantVaultFile };
}

module.exports = { createVaultWatcher, isRelevantVaultFile };
