// The renderer's single access point for the Electron preload bridge.
// Keeping bridge discovery here makes feature modules injectable and testable.

const EMPTY_BRIDGE = Object.freeze({});

function currentBridge() {
  if (typeof window === 'undefined') return EMPTY_BRIDGE;
  return window.mn || EMPTY_BRIDGE;
}

function callBridge(namespace, method, ...args) {
  const fn = currentBridge()[namespace]?.[method];
  if (typeof fn !== 'function') throw new Error(`Desktop bridge method is unavailable: ${namespace}.${method}`);
  return fn(...args);
}

function methodGroup(namespace, methods) {
  return Object.freeze(Object.fromEntries(methods.map(method => [
    method,
    (...args) => callBridge(namespace, method, ...args),
  ])));
}

const platformApi = Object.freeze({
  get available() {
    return currentBridge() !== EMPTY_BRIDGE;
  },
  notes: methodGroup('notes', [
    'listNotes', 'openNote', 'loadVault', 'saveNote', 'deleteNote', 'listDeletedNotes',
    'restoreDeletedNote', 'purgeDeletedNote', 'listNoteVersions',
    'getNoteVersion', 'restoreNoteVersion', 'exportNote', 'saveAttachment',
  ]),
  vaults: methodGroup('vaults', [
    'listVaults', 'createVault', 'renameVault', 'deleteVault',
    'setActiveVault', 'saveVaultMeta',
  ]),
  search: methodGroup('search', [
    'search', 'searchDetailed', 'searchDetailedStatus', 'backlinks',
    'unlinkedMentions', 'notesByTag', 'tagCounts', 'rebuildIndex', 'vaultHealth',
  ]),
  canvas: methodGroup('canvas', [
    'listCanvases', 'getCanvas', 'saveCanvas', 'deleteCanvas',
    'listDeletedCanvases', 'restoreDeletedCanvas', 'purgeDeletedCanvas',
  ]),
  preferences: methodGroup('preferences', ['getPrefs', 'setPrefs', 'importThemeFile', 'spellcheck']),
  maintenance: methodGroup('maintenance', ['exportBackup', 'importBackup', 'importNovelFiles']),
  app: methodGroup('app', ['openExternal', 'setTitle', 'shortcutStatus']),
  get ai() {
    return currentBridge().ai || EMPTY_BRIDGE;
  },
  get updates() {
    return currentBridge().updates || EMPTY_BRIDGE;
  },
  get integrations() {
    return currentBridge().integrations || EMPTY_BRIDGE;
  },
  get events() {
    return currentBridge().events || EMPTY_BRIDGE;
  },
});

function hasDesktopBridge() {
  return currentBridge() !== EMPTY_BRIDGE;
}

async function optionalPlatformCall(call) {
  if (typeof call !== 'function') return null;
  try {
    return await call();
  } catch {
    return null;
  }
}

export { hasDesktopBridge, optionalPlatformCall, platformApi };
