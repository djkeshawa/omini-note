import { H, SettingsCard, Row, Segmented, Toggle, Select, FontSizeStepper } from '../settingsControls.jsx';
import { platformApi } from '../../platform/index.js';
import { shortcutLabel, useShortcutPlatform } from '../../platform/shortcuts.js';
import { BtnOutline } from '../settingsPrimitives.jsx';

function SectionShortcuts({ T, shortcutStatus, featureState = {} }) {
  const platform = useShortcutPlatform();
  const sc = [
    { k: shortcutLabel('newNote', platform), v: 'New note' },
    { k: shortcutLabel('quickCapture', platform), v: 'Quick capture' },
    ...(featureState.showLabs ? [{ k: shortcutLabel('graph', platform), v: 'Open graph' }] : []),
    { k: shortcutLabel('quickSwitcher', platform), v: 'Quick switcher' },
    { k: shortcutLabel('commandPalette', platform), v: 'Command palette' },
    ...(featureState.showAskAi ? [{ k: shortcutLabel('askAi', platform), v: 'Open Ask AI' }] : []),
    { k: shortcutLabel('toggleSidebar', platform), v: 'Toggle sidebar' },
    { k: shortcutLabel('toggleNoteList', platform), v: 'Toggle note list' },
    { k: shortcutLabel('undo', platform), v: 'Undo editor change' },
    { k: shortcutLabel('redo', platform), v: 'Redo editor change' },
    { k: shortcutLabel('indent', platform), v: 'Indent block' },
    { k: shortcutLabel('outdent', platform), v: 'Outdent block' },
    { k: shortcutLabel('newSibling', platform), v: 'New sibling block' },
    { k: `${shortcutLabel('deleteEmpty', platform)} (empty)`, v: 'Delete block' },
    { k: shortcutLabel('zoomBlock', platform), v: 'Zoom into focused block' },
    { k: `${shortcutLabel('moveBlockUp', platform)} / ${shortcutLabel('moveBlockDown', platform)}`, v: 'Move focused block' },
    { k: shortcutLabel('duplicateBlock', platform), v: 'Duplicate focused block' },
    { k: shortcutLabel('deleteBlock', platform), v: 'Delete focused block' },
    { k: '[[', v: 'Start wiki-link suggestion' },
    { k: '#', v: 'Start tag' },
    { k: '@remind YYYY-MM-DD', v: 'Schedule reminder' },
    { k: 'Esc', v: 'Close overlay' },
  ];
  return (
    <div>
      <H T={T} label="Keyboard shortcuts" sub="All the ways to get around faster." />
      <SettingsCard T={T}>
        {shortcutStatus && shortcutStatus.registered === false && (
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '9px 14px',
            borderBottom: `1px solid ${T.lineSub}`,
            background: `color-mix(in oklab, ${T.warn || '#b7791f'} 10%, ${T.bg})`,
            color: T.ink,
            fontFamily: 'var(--mn-ui)', fontSize: 12.5,
          }}>
            Global Quick Capture shortcut {shortcutLabel('quickCapture', platform, { compact: true })} is unavailable.
          </div>
        )}
        {sc.map((s, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center',
            padding: '9px 14px',
            borderTop: i === 0 ? 'none' : `1px solid ${T.lineSub}`,
            background: i % 2 ? T.bgSub : T.bg,
          }}>
            <div style={{
              fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink, flex: 1,
            }}>{s.v}</div>
            <code style={{
              fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkMed,
              padding: '2px 7px', borderRadius: 4,
              background: T.bg, border: `1px solid ${T.lineSub}`,
            }}>{s.k}</code>
          </div>
        ))}
      </SettingsCard>
    </div>
  );
}

function SectionAbout({ T, stats, updateState, setUpdateState }) {
  const version = updateState?.currentVersion || '0.1.17';
  const checking = updateState?.status === 'checking';
  const statusText = updateState?.status === 'downloaded'
    ? `Update ready: ${updateState?.updateInfo?.version || 'new version'}`
    : updateState?.status === 'available'
      ? `Downloading ${updateState?.updateInfo?.version || 'update'}`
      : updateState?.status === 'manual'
        ? 'Linux deb installs update from GitHub Releases'
        : updateState?.status === 'not-available'
          ? 'VispNote is up to date'
          : updateState?.status === 'error'
            ? updateState.error || 'Update check failed'
            : checking
              ? 'Checking for updates'
              : 'Update checks use GitHub Releases';
  const checkUpdates = async () => {
    if (!platformApi.updates.check) return;
    const res = await platformApi.updates.check();
    if (res?.ok && setUpdateState) setUpdateState(res.value);
  };
  const installUpdate = async () => {
    if (platformApi.updates.install) await platformApi.updates.install();
  };
  const openReleases = () => platformApi.app.openExternal(updateState?.manualUrl || 'https://github.com/djkeshawa/visp-note/releases/latest');
  const openFeedback = () => platformApi.app.openExternal('https://github.com/djkeshawa/visp-note/issues/new');
  return (
    <div>
      <H T={T} label="About VispNote" sub="Local-first, markdown-native notes." />
      <SettingsCard T={T} style={{ padding: 18, background: T.bgSub, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 7, background: T.bgSub, border: `1px solid ${T.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4,
          }}><img src="assets/vispnote-icon.png" alt="" aria-hidden="true" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /></div>
          <div>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>VispNote</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkDim }}>Version {version} · Prototype</div>
          </div>
        </div>
        <div style={{
          fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkMed, lineHeight: 1.55,
        }}><strong>Write · Connect · Act.</strong> Everything is a block, blocks nest, and every file on disk is plain Markdown you own.</div>
      </SettingsCard>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat T={T} label="Notes" value={stats.noteCount} />
        <Stat T={T} label="Tags" value={stats.tagCount} />
        <Stat T={T} label="Links" value={stats.linkCount} />
        <Stat T={T} label="Words" value={stats.wordCount.toLocaleString()} />
      </div>
      <SettingsCard T={T} style={{ marginBottom: 16 }}>
        <Row T={T} label="Updates" sub={statusText} last>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <BtnOutline T={T} disabled={checking} onClick={checkUpdates}>{checking ? 'Checking...' : 'Check for updates'}</BtnOutline>
            {updateState?.downloaded && <BtnOutline T={T} onClick={installUpdate}>Install and restart</BtnOutline>}
            {(updateState?.status === 'manual' || updateState?.status === 'error') && <BtnOutline T={T} onClick={openReleases}>Open releases</BtnOutline>}
          </div>
        </Row>
      </SettingsCard>
      <div style={{ display: 'flex', gap: 8 }}>
        <BtnOutline T={T} onClick={openReleases}>Release notes</BtnOutline>
        <BtnOutline T={T} onClick={openFeedback}>Send feedback</BtnOutline>
      </div>
    </div>
  );
}

function Stat({ T, label, value }) {
  return (
    <div style={{
      padding: '10px 14px', border: `1px solid ${T.lineSub}`, borderRadius: 6,
      minWidth: 90, background: T.bg,
    }}>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: 22, fontWeight: 600,
        color: T.ink, letterSpacing: 0, lineHeight: 1,
      }}>{value}</div>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4,
      }}>{label}</div>
    </div>
  );
}

// ───── icons ─────

export { SectionShortcuts, SectionAbout };
