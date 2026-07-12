import { optionalPlatformCall, platformApi } from '../platform/index.js';
import { iconAppearance, iconEditor, iconAI, iconPlugin, iconData, iconInfo } from './settingsControls.jsx';
import { SectionAppearance, SectionEditor, SectionNotes, SectionAdvanced } from './sections/GeneralSections.jsx';
import { SectionAI } from './sections/AssistanceSection.jsx';
import { SectionData } from './sections/DataSection.jsx';
import { SectionShortcuts, SectionAbout } from './sections/AboutSections.jsx';
const { useState: useStateS, useEffect: useEffectS } = React;

function MnSettingsModal({
  tweaks, setTweak, T, onClose, stats, vaults, activeVaultId, activeVault,
  themeOptions = [],
  onCreateVault, onDeleteVault, onSetVaultNovelistMode,
  onListDeletedNotes, onRestoreDeletedNote, onPurgeDeletedNote,
  onExportBackup, onImportBackup, onImportNovelFiles, onOpenVaultHealth, onRebuildIndex,
  enabledPacks = [], featureState = {}, onSetPack, assistanceEnabled = false, onAssistanceChange,
}) {
  const [section, setSection] = useStateS('general');
  const [updateState, setUpdateState] = useStateS(null);
  const [shortcutStatus, setShortcutStatus] = useStateS(null);

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
  const activeSection = sections.find(s => s.k === section) || sections[0];
  const groups = [...new Set(sections.map(s => s.group))];

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 60,
      background: T.overlay || `color-mix(in oklab, ${T.ink} 32%, transparent)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'mnFadeIn 140ms ease', backdropFilter: 'blur(2px)',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
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
          padding: '14px 16px', borderBottom: `1px solid ${T.lineSub}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: `linear-gradient(180deg, ${T.bgSub}, ${T.bg})`,
        }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            border: `1px solid ${T.lineSub}`,
            background: T.bg,
            color: T.inkMed,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="2.2"/>
              <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink }}>Settings</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, marginTop: 2 }}>
              {activeSection.label} · {activeSection.sub}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            width: 28,
            height: 28,
            borderRadius: 6,
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
            width: 230,
            background: T.bgSub,
            borderRight: `1px solid ${T.lineSub}`,
            padding: '12px 10px',
            overflow: 'auto',
            flexShrink: 0,
          }}>
            {groups.map(group => (
              <div key={group} style={{ marginBottom: 12 }}>
                <div style={{
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 9.5,
                  color: T.inkDim,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '0 9px 6px',
                }}>{group}</div>
                {sections.filter(s => s.group === group).map(s => {
                  const active = section === s.k;
                  return (
                    <button key={s.k} onClick={() => setSection(s.k)} style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '8px 9px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      fontFamily: 'var(--mn-ui)',
                      textAlign: 'left',
                      background: active ? T.bg : 'transparent',
                      color: active ? T.ink : T.inkMed,
                      border: active ? `1px solid ${T.lineSub}` : '1px solid transparent',
                      boxShadow: active ? `0 7px 18px color-mix(in oklab, ${T.ink} 5%, transparent)` : 'none',
                      marginBottom: 2,
                    }}>
                      <span style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: active ? T.accent : T.inkDim,
                        background: active ? T.accentSoft : T.bg,
                        border: `1px solid ${active ? T.selLine : T.lineSub}`,
                        flexShrink: 0,
                      }}>{s.icon}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: active ? 650 : 500 }}>{s.label}</span>
                        <span style={{
                          display: 'block',
                          marginTop: 2,
                          fontFamily: 'var(--mn-body)',
                          fontSize: 11.5,
                          lineHeight: 1.25,
                          color: T.inkDim,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>{s.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px 32px',
            background: `linear-gradient(180deg, ${T.bg}, color-mix(in oklab, ${T.bgSub} 38%, ${T.bg}))`,
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
