import { optionalPlatformCall, platformApi } from './desktopBridge.js';

// The specs and their label formatting are pure, so they live in a CommonJS
// module the main process can require too (lib/seed.js prints the platform's
// real accelerators into the welcome note). This file keeps everything that
// needs the bridge, React, or a DOM event.
import {
  SHORTCUT_SPECS,
  detectRendererPlatform,
  normalizePlatform,
  shortcutLabel,
} from './shortcutFormat.js';

let appInfoPromise = null;

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
