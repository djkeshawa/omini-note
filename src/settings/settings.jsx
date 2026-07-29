import { optionalPlatformCall, platformApi } from '../platform/index.js';
import { DS_HEIGHT, DS_RADIUS, dsGroupLabelStyle } from '../shared/designSystem.js';
import { iconAppearance, iconEditor, iconAI, iconPlugin, iconData, iconInfo } from './settingsControls.jsx';
import { SectionAppearance, SectionEditor, SectionNotes, SectionAdvanced } from './sections/GeneralSections.jsx';
import { SectionAI } from './sections/AssistanceSection.jsx';
import { SectionData } from './sections/DataSection.jsx';
import { SectionShortcuts, SectionAbout } from './sections/AboutSections.jsx';
import { useDialogFocus } from '../shared/useDialogFocus.js';
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

function MnSettingsModal({
  tweaks, setTweak, T, onClose, stats, vaults, activeVaultId, activeVault,
  themeOptions = [],
  onCreateVault, onDeleteVault, onSetVaultNovelistMode,
  onListDeletedNotes, onRestoreDeletedNote, onPurgeDeletedNote,
  onExportBackup, onImportBackup, onImportMarkdown, onImportNovelFiles, onOpenVaultHealth, onRebuildIndex,
  enabledPacks = [], featureState = {}, onSetPack, assistanceEnabled = false, onAssistanceChange,
}) {
  const [section, setSection] = useStateS('general');
  const [updateState, setUpdateState] = useStateS(null);
  const [shortcutStatus, setShortcutStatus] = useStateS(null);
  const closeRef = useRefS(null);
  const dialogRef = useDialogFocus({ initialFocusRef: closeRef, onEscape: onClose });

  useEffectS(() => {
    let alive = true;
    optionalPlatformCall(() => platformApi.updates.status?.()).then(res => {
      if (alive && res?.ok) setUpdateState(res.value);
    });
    optionalPlatformCall(() => platformApi.app.shortcutStatus()).then(res => {
      if (alive && res?.ok) setShortcutStatus(res.value);
    });
    const off = platformApi.updates.onState?.(state => {
      if (alive) setUpdateState(state);
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
    };
  }, []);

  const sections = [
    { k: 'general', label: 'General', group: 'VispNote', sub: 'A calm default experience', icon: iconAppearance },
    { k: 'writing', label: 'Writing', group: 'VispNote', sub: 'Editor and note behavior', icon: iconEditor },
    { k: 'data', label: 'Data & Privacy', group: 'VispNote', sub: 'Vaults, backups, and privacy', icon: iconData },
    { k: 'assistance', label: 'Assistance', group: 'VispNote', sub: 'Optional local or hosted AI', icon: iconAI },
    { k: 'advanced', label: 'Advanced', group: 'VispNote', sub: 'Packs and specialist tools', icon: iconPlugin },
    { k: 'about', label: 'About', group: 'VispNote', sub: 'Version, shortcuts, and stats', icon: iconInfo },
  ];
  const groups = [...new Set(sections.map(s => s.group))];

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 60,
      background: T.overlay || `color-mix(in oklab, ${T.ink} 32%, transparent)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'mnFadeIn 140ms ease', backdropFilter: 'blur(2px)',
    }}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-settings-title"
        onClick={(e) => e.stopPropagation()} style={{
        width: 'min(980px, calc(100vw - 48px))',
        height: 'min(720px, calc(100vh - 48px))',
        minHeight: 'min(560px, calc(100vh - 48px))',
        background: T.bgElevated || T.bg,
        borderRadius: 12,
        border: `1px solid ${T.line}`, overflow: 'hidden',
        boxShadow: typeof mnShadow === 'function'
          ? mnShadow(T, 'elevated')
          : `0 24px 60px color-mix(in oklab, ${T.ink} 28%, transparent)`,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          height: 56, padding: '0 16px', borderBottom: `1px solid ${T.lineSub}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          boxSizing: 'border-box',
        }}>
          <div id="mn-settings-title" style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 600, color: T.ink }}>Settings</div>
          <span style={{ flex: 1 }} />
          <button ref={closeRef} onClick={onClose} style={{
            width: 28,
            height: 28,
            borderRadius: DS_RADIUS.control,
            border: `1px solid ${T.lineSub}`,
            background: T.bg,
            cursor: 'pointer',
            color: T.inkDim,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }} title="Close settings" aria-label="Close settings">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{
            width: 214,
            background: T.bgSub,
            borderRight: `1px solid ${T.lineSub}`,
            padding: '12px 10px',
            overflow: 'auto',
            flexShrink: 0,
          }}>
            {groups.map(group => (
              <div key={group} style={{ marginBottom: 12 }}>
                <div style={{ ...dsGroupLabelStyle(T), height: 22, padding: '0 8px', display: 'flex', alignItems: 'center' }}>{group}</div>
                {sections.filter(s => s.group === group).map(s => {
                  const active = section === s.k;
                  return (
                    <button key={s.k} onClick={() => setSection(s.k)} style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      height: DS_HEIGHT.navRow,
                      padding: '0 10px',
                      boxSizing: 'border-box',
                      borderRadius: DS_RADIUS.control,
                      cursor: 'pointer',
                      fontFamily: 'var(--mn-ui)',
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 400,
                      textAlign: 'left',
                      background: active ? (T.bgElevated || T.bg) : 'transparent',
                      color: active ? T.ink : T.inkMed,
                      border: `1px solid ${active ? T.lineSub : 'transparent'}`,
                      marginBottom: 2,
                    }}>
                      <span style={{
                        width: 16,
                        height: 16,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: active ? T.accent : T.inkDim,
                        flexShrink: 0,
                      }}>{s.icon}</span>
                      <span style={{
                        flex: 1, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{s.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            padding: '26px 32px',
            background: T.bg,
          }}>
            {section === 'general' && <SectionAppearance tweaks={tweaks} setTweak={setTweak} T={T} themeOptions={themeOptions} />}
            {section === 'writing' && (
              <div style={{ display: 'grid', gap: 36 }}>
                <SectionEditor tweaks={tweaks} setTweak={setTweak} T={T} />
                <SectionNotes tweaks={tweaks} setTweak={setTweak} T={T} stats={stats} />
              </div>
            )}
            {section === 'assistance' && <SectionAI T={T} assistanceEnabled={assistanceEnabled} onAssistanceChange={onAssistanceChange} />}
            {section === 'advanced' && <SectionAdvanced tweaks={tweaks} setTweak={setTweak} T={T} enabledPacks={enabledPacks} featureState={featureState} onSetPack={onSetPack} shortcutStatus={shortcutStatus} />}
            {section === 'data' && (
              <SectionData
                tweaks={tweaks}
                setTweak={setTweak}
                T={T}
                stats={stats}
                vaults={vaults || []}
                activeVaultId={activeVaultId}
                activeVault={activeVault}
                onCreateVault={onCreateVault}
                onDeleteVault={onDeleteVault}
                onSetVaultNovelistMode={onSetVaultNovelistMode}
                onListDeletedNotes={onListDeletedNotes}
                onRestoreDeletedNote={onRestoreDeletedNote}
                onPurgeDeletedNote={onPurgeDeletedNote}
                onExportBackup={onExportBackup}
                onImportBackup={onImportBackup}
                onImportMarkdown={onImportMarkdown}
                onImportNovelFiles={onImportNovelFiles}
                onOpenVaultHealth={onOpenVaultHealth}
                onRebuildIndex={onRebuildIndex}
                writerEnabled={featureState.writerAvailable || enabledPacks.includes('writer')}
              />
            )}
            {section === 'about' && (
              <div style={{ display: 'grid', gap: 40 }}>
                <SectionAbout T={T} stats={stats} updateState={updateState} setUpdateState={setUpdateState} />
                <SectionShortcuts T={T} shortcutStatus={shortcutStatus} featureState={featureState} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───── building blocks ─────

export { MnSettingsModal };
import { mnShadow } from '../shared/theme.jsx';
