import { optionalPlatformCall, platformApi } from './desktopBridge.js';

/**
 * @typedef {Object} ShortcutSpec
 * @property {string} id
 * @property {string} label
 * @property {Array<{ key: string, modifiers?: string[] }>} chords
 */

const SHORTCUT_SPECS = Object.freeze({
  newNote: shortcut('newNote', 'New note', 'n', ['mod']),
  quickCapture: shortcut('quickCapture', 'Quick capture', 'n', ['mod', 'shift']),
  graph: shortcut('graph', 'Open graph', 'g', ['mod']),
  commandPalette: shortcut('commandPalette', 'Notes and actions palette', 'k', ['mod']),
  askAi: shortcut('askAi', 'Ask AI', 'k', ['mod', 'shift']),
  quickSwitcher: shortcut('quickSwitcher', 'Notes-first palette', 'p', ['mod']),
  referencePane: shortcut('referencePane', 'Toggle reference pane', 'r', ['mod', 'shift']),
  toggleSidebar: shortcut('toggleSidebar', 'Toggle sidebar', '\\', ['mod']),
  toggleNoteList: shortcut('toggleNoteList', 'Toggle note list', '\\', ['mod', 'shift']),
  undo: shortcut('undo', 'Undo editor change', 'z', ['mod']),
  redo: Object.freeze({
    id: 'redo',
    label: 'Redo editor change',
    chords: Object.freeze([
      Object.freeze({ key: 'z', modifiers: Object.freeze(['mod', 'shift']) }),
      Object.freeze({ key: 'y', modifiers: Object.freeze(['mod']) }),
    ]),
  }),
  indent: shortcut('indent', 'Indent block', 'Tab'),
  outdent: shortcut('outdent', 'Outdent block', 'Tab', ['shift']),
  newSibling: shortcut('newSibling', 'New sibling block', 'Enter'),
  deleteEmpty: shortcut('deleteEmpty', 'Delete empty block', 'Backspace'),
  zoomBlock: shortcut('zoomBlock', 'Zoom into focused block', 'Enter', ['mod']),
  moveBlockUp: shortcut('moveBlockUp', 'Move focused block up', 'ArrowUp', ['alt']),
  moveBlockDown: shortcut('moveBlockDown', 'Move focused block down', 'ArrowDown', ['alt']),
  duplicateBlock: shortcut('duplicateBlock', 'Duplicate focused block', 'd', ['mod']),
  deleteBlock: shortcut('deleteBlock', 'Delete focused block', 'Backspace', ['mod']),
  copyBlock: shortcut('copyBlock', 'Copy block', 'c', ['mod']),
  cutBlock: shortcut('cutBlock', 'Cut block', 'x', ['mod']),
  pasteBlock: shortcut('pasteBlock', 'Paste after', 'v', ['mod']),
});

let appInfoPromise = null;

function shortcut(id, label, key, modifiers = []) {
  return Object.freeze({
    id,
    label,
    chords: Object.freeze([Object.freeze({ key, modifiers: Object.freeze([...modifiers]) })]),
  });
}

function normalizePlatform(value = '') {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'darwin' || clean === 'mac' || clean === 'macos' || clean.includes('mac')) return 'darwin';
  if (clean === 'win32' || clean === 'windows' || clean.includes('win')) return 'win32';
  if (clean === 'linux' || clean.includes('linux')) return 'linux';
  return 'linux';
}

function detectRendererPlatform() {
  if (typeof navigator === 'undefined') return 'linux';
  return normalizePlatform(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '');
}

function unwrapAppInfo(response) {
  const value = response?.value && typeof response.value === 'object' ? response.value : response;
  return Object.freeze({ platform: normalizePlatform(value?.platform || detectRendererPlatform()) });
}

function loadAppInfo() {
  if (!appInfoPromise) {
    appInfoPromise = optionalPlatformCall(() => platformApi.app.info())
      .then(response => unwrapAppInfo(response || { platform: detectRendererPlatform() }));
  }
  return appInfoPromise;
}

function useShortcutPlatform() {
  const [platform, setPlatform] = React.useState(detectRendererPlatform);
  React.useEffect(() => {
    let active = true;
    loadAppInfo().then(info => {
      if (active) setPlatform(info.platform);
    });
    return () => { active = false; };
  }, []);
  return platform;
}

function displayKey(key, platform) {
  const mac = platform === 'darwin';
  const names = {
    Backspace: mac ? '⌫' : 'Backspace',
    Enter: mac ? '↵' : 'Enter',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    '\\': '\\',
  };
  if (names[key]) return names[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

function displayModifier(modifier, platform) {
  if (platform === 'darwin') {
    return { mod: '⌘', shift: '⇧', alt: '⌥' }[modifier] || modifier;
  }
  return { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' }[modifier] || modifier;
}

function formatChord(chord, platform, compact) {
  const normalizedPlatform = normalizePlatform(platform || detectRendererPlatform());
  const parts = [
    ...(chord.modifiers || []).map(modifier => displayModifier(modifier, normalizedPlatform)),
    displayKey(chord.key, normalizedPlatform),
  ];
  if (normalizedPlatform === 'darwin') return parts.join(compact ? '' : ' ');
  return parts.join(compact ? '+' : ' + ');
}

function shortcutLabel(id, platform = detectRendererPlatform(), options = {}) {
  const spec = SHORTCUT_SPECS[id];
  if (!spec) return '';
  return spec.chords
    .map(chord => formatChord(chord, platform, options.compact === true))
    .join(options.compact === true ? '/' : ' / ');
}

function normalizedEventKey(event) {
  const key = String(event?.key || '');
  if (key === '|' || event?.code === 'Backslash') return '\\';
  return key.length === 1 ? key.toLowerCase() : key;
}

function chordMatches(event, chord) {
  const modifiers = new Set(chord.modifiers || []);
  const modPressed = event?.metaKey === true || event?.ctrlKey === true;
  if (modPressed !== modifiers.has('mod')) return false;
  if ((event?.shiftKey === true) !== modifiers.has('shift')) return false;
  if ((event?.altKey === true) !== modifiers.has('alt')) return false;
  return normalizedEventKey(event) === (chord.key.length === 1 ? chord.key.toLowerCase() : chord.key);
}

function matchesShortcut(event, id) {
  const spec = SHORTCUT_SPECS[id];
  return !!spec?.chords?.some(chord => chordMatches(event, chord));
}

export {
  SHORTCUT_SPECS,
  detectRendererPlatform,
  loadAppInfo,
  matchesShortcut,
  normalizePlatform,
  shortcutLabel,
  useShortcutPlatform,
};
