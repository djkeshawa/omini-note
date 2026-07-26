// The workspace app bar: vault on the left, one search field in the middle,
// the single primary action on the right. Measured from the prototype — 44px
// tall on a 248 | 1fr | auto grid, so the vault name sits over the sidebar and
// the search field centres on the panes it searches.
//
// Creating and deleting vaults stay in Settings, where they already live and
// where a destructive action belongs. Renaming rides along here because the
// switcher is the only place it has ever been reachable.

function AppBarIconButton({ label, onClick, children, T }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 28, height: 28, borderRadius: DS_RADIUS.control,
        border: '1px solid transparent', background: 'transparent',
        color: T.inkMed, cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={event => { event.currentTarget.style.background = T.bgHover; }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
      {children}
    </button>
  );
}

function MnAppBar({
  vaults = [], activeVaultId, activeVault, onSelectVault, onRefreshVaults, onRenameVault,
  onOpenSearch, onNewNote, onOpenQuickCapture, onOpenSettings,
  searchShortcut = '⌘K', newNoteShortcut = 'Ctrl+N', T,
}) {
  const [vaultOpen, setVaultOpen] = useStateB(false);
  const [renameId, setRenameId] = useStateB(null);
  const [renameVal, setRenameVal] = useStateB('');
  const rootRef = useRefB(null);

  useEffectB(() => {
    if (!vaultOpen) { setRenameId(null); return undefined; }
    onRefreshVaults?.({ reloadActive: false, reason: 'vault-dropdown' });
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setVaultOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setVaultOpen(false); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [vaultOpen, onRefreshVaults]);

  const vaultKindLabel = (v) => (v?.novelistMode ? 'Novelist' : 'Notes');
  const vaultNoteLabel = (v) => `${v?.noteCount ?? 0} note${(v?.noteCount ?? 0) === 1 ? '' : 's'}`;

  const submitRename = () => {
    const name = renameVal.trim();
    if (name && renameId) onRenameVault?.(renameId, name);
    setRenameId(null);
    setRenameVal('');
  };

  return (
    <div
      ref={rootRef}
      data-mn-app-bar="true"
      style={{
        height: DS_HEIGHT.appBar, flexShrink: 0,
        display: 'grid', gridTemplateColumns: `${DS_PANE.sidebar}px minmax(0,1fr) auto`,
        alignItems: 'center', gap: 12, padding: '0 12px 0 0',
        background: T.bgSub, borderBottom: `1px solid ${T.line}`,
        position: 'relative', zIndex: 30, boxSizing: 'border-box',
      }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 14, minWidth: 0 }}>
        <VaultIcon T={T} size={22} active />
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={vaultOpen}
          aria-label="Switch vault"
          title={activeVault?.path || 'Switch vault'}
          onClick={() => setVaultOpen(open => !open)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            height: 28, padding: '0 7px', borderRadius: DS_RADIUS.control,
            border: `1px solid ${vaultOpen ? T.lineSub : 'transparent'}`,
            background: vaultOpen ? T.bg : 'transparent',
            cursor: 'pointer', minWidth: 0,
          }}>
          <span style={{
            fontSize: 13, fontWeight: 600, color: T.ink,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{activeVault?.name || 'Workspace'}</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={T.inkDim} strokeWidth="1.4"
            aria-hidden="true" style={{ flexShrink: 0, transform: vaultOpen ? 'rotate(180deg)' : 'none' }}>
            <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search notes and actions"
          style={{
            width: 460, maxWidth: '100%', height: 28,
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
            borderRadius: DS_RADIUS.control, background: T.bg,
            border: `1px solid ${T.lineSub}`, cursor: 'pointer',
          }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={T.inkDim} strokeWidth="1.4" aria-hidden="true">
            <circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L13.5 13.5" strokeLinecap="round" />
          </svg>
          <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5, color: T.inkDim }}>
            Search notes and actions
          </span>
          <span style={{
            ...dsMachineStyle(T), fontSize: 10,
            border: `1px solid ${T.lineSub}`, borderRadius: 4, padding: '1px 5px',
          }}>{searchShortcut}</span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          data-mn-primary-create="true"
          title={`New note (${newNoteShortcut})`}
          onClick={onNewNote}
          style={{
            height: 28, padding: '0 10px',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            borderRadius: DS_RADIUS.control, border: `1px solid ${T.selLine}`,
            background: T.accentSoft, color: T.accent,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M6 2.5v7M2.5 6h7" strokeLinecap="round" />
          </svg>
          New note
        </button>
        <AppBarIconButton label="Quick capture" onClick={onOpenQuickCapture} T={T}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <path d="M3 3.5H13V12.5H3V3.5Z" strokeLinejoin="round" />
            <path d="M5.5 6H10.5M5.5 8.5H9M11.5 10.5V14M9.75 12.25H13.25" strokeLinecap="round" />
          </svg>
        </AppBarIconButton>
        <AppBarIconButton label="Open settings" onClick={onOpenSettings} T={T}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" strokeLinecap="round" />
          </svg>
        </AppBarIconButton>
      </div>

      {vaultOpen && (
        <div
          role="menu"
          aria-label="Vaults"
          style={{
            position: 'absolute', top: 40, left: 12, width: 250, zIndex: 40,
            maxHeight: 260, overflowY: 'auto',
            background: T.bgElevated || T.bg, border: `1px solid ${T.line}`,
            borderRadius: DS_RADIUS.panel, padding: 6,
            boxShadow: `0 16px 40px color-mix(in oklab, ${T.ink} 18%, transparent)`,
          }}>
          {vaults.map(vault => {
            const active = vault.id === activeVaultId;
            if (renameId === vault.id) {
              return (
                <input
                  key={vault.id}
                  autoFocus
                  value={renameVal}
                  aria-label={`Rename ${vault.name}`}
                  onChange={event => setRenameVal(event.target.value)}
                  onBlur={submitRename}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); submitRename(); }
                    if (event.key === 'Escape') { event.preventDefault(); setRenameId(null); }
                  }}
                  style={{
                    width: '100%', height: 32, padding: '0 8px', boxSizing: 'border-box',
                    border: `1px solid ${T.accent}`, borderRadius: DS_RADIUS.control,
                    background: T.bg, color: T.ink, outline: 'none',
                    fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                  }}
                />
              );
            }
            return (
              <div
                key={vault.id}
                style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center',
                  borderRadius: DS_RADIUS.control,
                  border: `1px solid ${active ? T.selLine : 'transparent'}`,
                  background: active ? T.selBg : 'transparent',
                }}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setVaultOpen(false); if (!active) onSelectVault?.(vault.id); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                    padding: '7px 8px', border: 'none', background: 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: active ? T.success : (T.lineStrong || T.line),
                  }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontSize: 12.5, fontWeight: 600, color: T.ink,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{vault.name}</span>
                    <span style={{
                      display: 'block', marginTop: 2, ...dsMachineStyle(T), fontSize: 10,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{vaultKindLabel(vault)} · {vaultNoteLabel(vault)}</span>
                  </span>
                </button>
                {onRenameVault && (
                  <button
                    type="button"
                    aria-label={`Rename vault ${vault.name}`}
                    title="Rename vault"
                    onClick={() => { setRenameId(vault.id); setRenameVal(vault.name || ''); }}
                    style={{
                      width: 26, height: 26, marginRight: 4, borderRadius: DS_RADIUS.icon,
                      border: 'none', background: 'transparent', color: T.inkDim,
                      cursor: 'pointer', padding: 0, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
                      <path d="M3 12L12 3L13.5 4.5L4.5 13.5L2.5 14L3 12Z" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
          <div style={{ height: 1, background: T.lineSub, margin: '5px 8px' }} />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setVaultOpen(false); onOpenSettings?.(); }}
            style={{
              width: '100%', height: 32, padding: '0 10px',
              display: 'flex', alignItems: 'center', gap: 9,
              borderRadius: DS_RADIUS.control, border: 'none', background: 'transparent',
              cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkMed,
            }}
            onMouseEnter={event => { event.currentTarget.style.background = T.bgHover; }}
            onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
            Manage vaults…
          </button>
        </div>
      )}
    </div>
  );
}

export { MnAppBar };
import { DS_HEIGHT, DS_PANE, DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';
import { VaultIcon } from '../../shared/components/VaultIcon.jsx';
const { useEffect: useEffectB, useRef: useRefB, useState: useStateB } = React;
