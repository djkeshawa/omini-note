// The renderer's single access point for the Electron preload bridge.
// Keeping bridge discovery here makes feature modules injectable and testable.

const EMPTY_BRIDGE = Object.freeze({});

function currentBridge() {
  if (typeof window === 'undefined') return EMPTY_BRIDGE;
  return window.mn || EMPTY_BRIDGE;
}

function callBridge(method, ...args) {
  const fn = currentBridge()[method];
  if (typeof fn !== 'function') throw new Error(`Desktop bridge method is unavailable: ${method}`);
  return fn(...args);
}

function methodGroup(methods) {
  return Object.freeze(Object.fromEntries(methods.map(method => [
    method,
    (...args) => callBridge(method, ...args),
  ])));
}

// Compatibility proxy for modules that are being migrated incrementally.
// New feature code should prefer the namespaced platformApi below.
const desktopBridge = new Proxy({}, {
  get(_target, property) {
    return currentBridge()[property];
  },
  has(_target, property) {
    return property in currentBridge();
  },
  ownKeys() {
    return Reflect.ownKeys(currentBridge());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(currentBridge(), property);
    return descriptor || { configurable: true, enumerable: true };
  },
});

const platformApi = Object.freeze({
  get available() {
    return currentBridge() !== EMPTY_BRIDGE;
  },
  notes: methodGroup([
    'loadVault', 'saveNote', 'deleteNote', 'listDeletedNotes',
    'restoreDeletedNote', 'purgeDeletedNote', 'listNoteVersions',
    'getNoteVersion', 'restoreNoteVersion', 'exportNote', 'saveAttachment',
  ]),
  vaults: methodGroup([
    'listVaults', 'createVault', 'renameVault', 'deleteVault',
    'setActiveVault', 'saveVaultMeta', 'exportBackup', 'importBackup',
  ]),
  search: methodGroup([
    'search', 'searchDetailed', 'searchDetailedStatus', 'backlinks',
    'unlinkedMentions', 'notesByTag', 'tagCounts', 'rebuildIndex', 'vaultHealth',
  ]),
  canvas: methodGroup([
    'listCanvases', 'getCanvas', 'saveCanvas', 'deleteCanvas',
    'listDeletedCanvases', 'restoreDeletedCanvas', 'purgeDeletedCanvas',
  ]),
  preferences: methodGroup(['getPrefs', 'setPrefs', 'importThemeFile']),
  app: methodGroup(['openExternal', 'setTitle', 'spellcheck', 'shortcutStatus']),
  get ai() {
    return currentBridge().ai || EMPTY_BRIDGE;
  },
  get updates() {
    return currentBridge().updates || EMPTY_BRIDGE;
  },
  get integrations() {
    return Object.freeze({
      featureUsage: currentBridge().featureUsage || EMPTY_BRIDGE,
      memory: currentBridge().memory || EMPTY_BRIDGE,
      zotero: currentBridge().zotero || EMPTY_BRIDGE,
    });
  },
});

function hasDesktopBridge() {
  return currentBridge() !== EMPTY_BRIDGE;
}

export { desktopBridge, hasDesktopBridge, platformApi };
