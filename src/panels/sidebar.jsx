import { VaultIcon as MnVaultIcon } from '../shared/components/VaultIcon.jsx'; import { storage } from '../shared/storageUtils.js'; import { mnGetTagColor } from '../shared/theme.jsx'; import { shortcutLabel } from '../platform/shortcuts.js';
import { MnContextualTip } from '../features/onboarding/index.js';
import { SidebarNavRow } from './SidebarNavRow.jsx';
import { LocalStatusPopover } from './LocalStatusPopover.jsx';
const { useMemo: useMemoS } = React;
function MnSidebar({
  tags, notes, selectedTag, onSelectTag, onOpenAgenda, onOpenGraph,
  onOpenToday, onOpenPinned, todayActive, pinnedActive = false, agendaActive, graphActive,
  onOpenSmartViews, smartViewsActive = false, smartViewCount = 0,
  selectedWorkflow, workflowStates, workflowCounts, workflowTotal,
  onSelectWorkflow, onOpenWorkflowPanel, workflowActive,
  onOpenNovelist, novelistActive, novelistEnabled, novelistCount = 0,
  onOpenCanvas, canvasActive, canvasCount = 0,
  onOpenTrash, trashActive, trashCount = 0,
  calendarActive = false,
  aiActive = false,
  onOpenAskAI,
  onNewTag, onDeleteTag, onNew, onOpenSettings, onCollapse,
  vaults, activeVaultId, onSelectVault, onCreateVault, onRefreshVaults, onRenameVault, onDeleteVault,
  featureState = {}, contextualTip = null, onDismissContextualTip, todayCount,
  saveStatus = 'Saved', lastBackupAt = null, onOpenVaultHealth, onExportBackup,
  newNoteShortcut = shortcutLabel('newNote', undefined, { compact: true }), T, density, theme
}) {
  const [vaultOpen, setVaultOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [creatingTag, setCreatingTag] = React.useState(false);
  const [newTagName, setNewTagName] = React.useState('');
  const [tagMenu, setTagMenu] = React.useState(null);
  const tagCreatorRef = React.useRef(null);
  const [renameId, setRenameId] = React.useState(null);
  const [renameVal, setRenameVal] = React.useState('');
  const sidebarSectionsKey = activeVaultId ? `mn:sidebarSections:${activeVaultId}` : 'mn:sidebarSections';
  const [openSections, setOpenSections] = React.useState(() => {
    return storage.getJson(sidebarSectionsKey, null) ||
      storage.getJson('mn:sidebarSections', null) ||
      { allnotes: true, vaults: true, workflow: false, tags: true, more: false };
  });
  React.useEffect(() => {
    setOpenSections(
      storage.getJson(sidebarSectionsKey, null) ||
      storage.getJson('mn:sidebarSections', null) ||
      { allnotes: true, vaults: true, workflow: false, tags: true, more: false }
    );
  }, [sidebarSectionsKey]);
  const toggleSection = (key) => {
    setOpenSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      storage.setJson(sidebarSectionsKey, next);
      return next;
    });
  };
  const activeVault = vaults?.find(v => v.id === activeVaultId);
  const pad = density === 'compact' ? { py: 4, gap: 0, header: 10 } : { py: 6, gap: 2, header: 14 };
  const noteCounts = useMemoS(() => {
    const c = {};
    tags.forEach(t => { c[t.name] = 0; });
    notes.forEach(n => n.tags.forEach(t => { if (c[t] != null) c[t]++; }));
    return c;
  }, [tags, notes]);

  const agendaCount = useMemoS(() => notes.reduce((acc, n) => {
    const lines = String(n.body || '').split('\n');
    return acc + lines.filter(line => {
      if (/^\s*-\s+\[[xX]\]/.test(line)) return false;
      return /^\s*-\s+\[ \]/.test(line) || /@remind\s+\d{4}-\d{2}-\d{2}/.test(line);
    }).length;
  }, 0), [notes]);

  const rollupCount = Number.isFinite(todayCount) ? Math.max(0, todayCount) : 0;
  const pinnedCount = notes.filter(note => note.pinned).length;
  const vaultKindLabel = (v) => v?.novelistMode ? 'Novelist' : 'Notes';
  const vaultNoteLabel = (v) => `${v?.noteCount ?? 0} note${(v?.noteCount ?? 0) === 1 ? '' : 's'}`;
  const vaultCanvasLabel = (v) => `${v?.canvasCount ?? 0} canvas${(v?.canvasCount ?? 0) === 1 ? '' : 'es'}`;

  const submitTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    onNewTag && onNewTag(name);
    setNewTagName('');
    setCreatingTag(false);
    setTagMenu(null);
  };

  const startTagCreate = () => {
    setOpenSections(s => ({ ...s, tags: true }));
    setCreatingTag(true);
    setTagMenu(null);
  };

  const openTagMenu = (e, tagName = null) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenSections(s => ({ ...s, tags: true }));
    setTagMenu({ x: e.clientX, y: e.clientY, tagName });
  };

  const deleteTag = (tagName) => {
    if (!tagName) return;
    onDeleteTag && onDeleteTag(tagName);
    setTagMenu(null);
  };

  const submitVault = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateVault(name, { type: 'notes' });
    setNewName('');
    setCreating(false);
    setVaultOpen(false);
  };

  React.useEffect(() => {
    if (!vaultOpen || !onRefreshVaults) return;
    onRefreshVaults({ reloadActive: false, reason: 'vault-dropdown' });
  }, [vaultOpen, onRefreshVaults]);

  React.useEffect(() => {
    if (!creatingTag) return;
    const onDown = (e) => {
      if (newTagName.trim()) return;
      if (tagCreatorRef.current?.contains(e.target)) return;
      setCreatingTag(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [creatingTag, newTagName]);

  React.useEffect(() => {
    if (!tagMenu) return;
    const close = () => setTagMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [tagMenu]);

  const SectionHeader = ({ label, sectionKey, count, action, onContextMenu }) => {
    const open = !!openSections[sectionKey];
    return (
      <div onContextMenu={onContextMenu} style={{
        padding: '0 10px',
        margin: '0 6px',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <button onClick={() => toggleSection(sectionKey)} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          flex: 1, padding: '4px 4px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.inkDim, textAlign: 'left',
          fontFamily: 'var(--mn-mono)', fontSize: 10,
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 120ms cubic-bezier(.4,0,.2,1)',
            flexShrink: 0,
          }}>
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ flex: 1 }}>{label}</span>
          {count != null && (
            <span style={{ fontSize: 10, color: T.inkDim, opacity: 0.7 }}>{count}</span>
          )}
        </button>
        {action}
      </div>
    );
  };

  const Row = props => <SidebarNavRow {...props} T={T} pad={pad} />;

  const iconInbox = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 9L3 3H13L14 9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2 9V13H14V9H10.5L9.5 11H6.5L5.5 9H2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>);
  const iconToday = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 2V4M11 2V4M2 7H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="8" cy="10.5" r="1.3" fill="currentColor"/></svg>);
  const iconAgenda = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.2" y="3" width="11.6" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 2V4.8M11 2V4.8M2.2 6.7H13.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M5 9.3H8.7M5 11.4H10.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconSmartViews = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.8" width="4.4" height="4.4" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="9.1" y="2.8" width="4.4" height="4.4" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="2.5" y="9.2" width="4.4" height="4.4" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M9.3 10H13.3M9.3 12.2H12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconWorkflow = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4H8.5M3 8H11M3 12H7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="13" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>);
  const iconNovelist = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2.5H10.5L12 4V13.5H4V2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M10.5 2.5V4H12M6 7H10M6 9.5H10M6 12H8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconGraph = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 5L10.5 5M5.3 5.8L6.8 10.4M10.7 5.8L9.2 10.4" stroke="currentColor" strokeWidth="1.3"/></svg>);
  const iconCanvas = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3" width="11" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.3"/><path d="M5 6H8.5M5 8.5H11M5 11H7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10.6 5.4L12 4M11.1 7.1L13 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconTrash = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconAI = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>);

  return (
    <div style={{
      width: density === 'compact' ? 220 : 260, height: '100%',
      background: `linear-gradient(180deg, ${T.bgElevated || T.bg} 0%, ${T.bgSub} 44%, color-mix(in oklab, ${T.bgSub} 92%, ${T.accent} 8%) 100%)`,
      borderRight: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      paddingTop: 10,
    }}>
      <div style={{
        padding: '4px 10px 14px', position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setVaultOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={vaultOpen}
            title={activeVault?.path || '~/vault'}
            style={{
            flex: 1, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: 9,
            padding: '8px 9px', borderRadius: 8, cursor: 'pointer',
            background: vaultOpen ? T.bg : 'transparent',
            border: `1px solid ${vaultOpen ? T.line : 'transparent'}`,
            color: T.ink, textAlign: 'left',
            boxShadow: vaultOpen ? `0 8px 24px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
          }}
          onMouseEnter={e => !vaultOpen && (e.currentTarget.style.background = T.bgHover)}
          onMouseLeave={e => !vaultOpen && (e.currentTarget.style.background = 'transparent')}>
            <MnVaultIcon T={T} size={22} active />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 600,
                color: T.ink, letterSpacing: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{activeVault?.name || 'VispNote'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, minWidth: 0 }}>
                <span style={{
                  fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: activeVault?.novelistMode ? T.accent : T.inkDim,
                  background: activeVault?.novelistMode ? T.accentSoft : T.bg,
                  border: `1px solid ${activeVault?.novelistMode ? T.selLine : T.lineSub}`,
                  borderRadius: 999, padding: '1px 5px', lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}>{activeVault ? vaultKindLabel(activeVault) : 'Notes'}</span>
                <span style={{
                  fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{activeVault ? vaultNoteLabel(activeVault) : `${notes.length} notes`}</span>
              </div>
            </div>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ color: T.inkDim, flexShrink: 0, transform: vaultOpen ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }}>
              <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {vaultOpen && (
          <>
            <div onClick={() => { setVaultOpen(false); setCreating(false); setRenameId(null); }}
              style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={{
              position: 'absolute', top: 50, left: 10,
              width: 'min(336px, calc(100vw - 24px))',
              background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8,
              padding: 6, zIndex: 50,
              boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
              animation: 'mnSlideDown 140ms ease',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 9px 6px',
                borderBottom: `1px solid ${T.lineSub}`,
                marginBottom: 5,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 9.5,
                    letterSpacing: '0.12em', textTransform: 'uppercase', color: T.inkDim,
                  }}>Switch vault</div>
                  <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink, marginTop: 2 }}>
                    {vaults.length} workspace{vaults.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button type="button" onClick={() => setCreating(v => !v)} title="New vault" style={{
                  width: 28, height: 28, borderRadius: 6,
                  border: `1px solid ${T.lineSub}`,
                  background: creating ? T.accentSoft : T.bgSub,
                  color: creating ? T.accent : T.inkMed,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, flexShrink: 0,
                }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 1 }}>
                {vaults.map(v => {
                  const active = v.id === activeVaultId;
                  const isRenaming = renameId === v.id;
                  return (
                    <div key={v.id} style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 8px',
                      borderRadius: 7,
                      cursor: isRenaming ? 'default' : 'pointer',
                      background: active ? T.selBg : 'transparent',
                      border: `1px solid ${active ? T.selLine : 'transparent'}`,
                    }}
                    role={isRenaming ? undefined : 'button'}
                    tabIndex={isRenaming ? undefined : 0}
                    aria-label={`Switch to vault ${v.name}`}
                    onMouseEnter={e => !active && !isRenaming && (e.currentTarget.style.background = T.bgHover)}
                    onMouseLeave={e => !active && !isRenaming && (e.currentTarget.style.background = 'transparent')}
                    onKeyDown={(e) => {
                      if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onSelectVault(v.id);
                        setVaultOpen(false);
                      }
                    }}
                    onClick={() => { if (!isRenaming) { onSelectVault(v.id); setVaultOpen(false); } }}>
                      <MnVaultIcon T={T} size={20} active={active} />
                      {isRenaming ? (
                        <input autoFocus value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onBlur={() => { if (renameVal.trim()) onRenameVault(v.id, renameVal.trim()); setRenameId(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { if (renameVal.trim()) onRenameVault(v.id, renameVal.trim()); setRenameId(null); }
                            if (e.key === 'Escape') setRenameId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            minWidth: 0, border: `1px solid ${T.accent}`, borderRadius: 5,
                            padding: '5px 7px', background: T.bg, color: T.ink,
                            outline: 'none', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                          }} />
                      ) : (
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontFamily: 'var(--mn-ui)', fontSize: 12.8, color: T.ink,
                            fontWeight: active ? 650 : 500,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>{v.name}</div>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 5, marginTop: 3,
                            minWidth: 0,
                          }}>
                            <span style={{
                              fontFamily: 'var(--mn-mono)', fontSize: 9.5,
                              color: v.novelistMode ? T.accent : T.inkDim,
                              background: v.novelistMode ? T.accentSoft : T.bgSub,
                              border: `1px solid ${v.novelistMode ? T.selLine : T.lineSub}`,
                              borderRadius: 999, padding: '1px 5px',
                              whiteSpace: 'nowrap',
                            }}>{vaultKindLabel(v)}</span>
                            <span style={{
                              fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
                              whiteSpace: 'nowrap',
                            }}>{vaultNoteLabel(v)}</span>
                            {!!v.canvasCount && (
                              <span style={{
                                fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
                                whiteSpace: 'nowrap',
                              }}>{vaultCanvasLabel(v)}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {active && !isRenaming && (
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={T.accent} strokeWidth="1.7" style={{ flexShrink: 0 }}>
                          <path d="M3.5 8.5L6.5 11.5L12.5 5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                      {!active && !isRenaming && <span />}
                      {!isRenaming && (
                        <button onClick={(e) => { e.stopPropagation(); setRenameId(v.id); setRenameVal(v.name); }}
                          title="Rename vault" aria-label={`Rename ${v.name}`} style={{
                            width: 24, height: 24, borderRadius: 5,
                            border: `1px solid transparent`, background: 'transparent',
                            color: T.inkDim, cursor: 'pointer', padding: 0, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.72,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = T.bgSub; e.currentTarget.style.borderColor = T.lineSub; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = 0.72; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                            <path d="M3 12L12 3L13.5 4.5L4.5 13.5L2.5 14L3 12Z"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {creating ? (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 9px', borderRadius: 7,
                    border: `1px solid ${T.accent}`, marginTop: 7,
                    background: T.bgSub,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={T.accent} strokeWidth="1.3" style={{ flexShrink: 0 }}>
                      <path d="M3 4H13V13H3V4Z"/>
                      <path d="M3 4L5.5 2H10.5L13 4" strokeLinejoin="round"/>
                    </svg>
                    <input autoFocus value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Vault name"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newName.trim()) {
                          submitVault();
                        }
                        if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                      }}
                      style={{
                        flex: 1, border: 'none', outline: 'none', background: 'transparent',
                        color: T.ink, fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                      }} />
                    <button onClick={() => {
                      submitVault();
                    }} disabled={!newName.trim()} title="Create vault"
                      style={{
                        width: 24, height: 24, borderRadius: 4, border: 'none',
                        background: newName.trim() ? T.ink : T.bgSub,
                        color: newName.trim() ? T.bg : T.inkDim,
                        cursor: newName.trim() ? 'pointer' : 'default',
                        padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M3.5 8.5L6.5 11.5L12.5 5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </>
              ) : (
                <div onClick={() => setCreating(true)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 9px', borderRadius: 7, cursor: 'pointer',
                  color: T.inkMed, marginTop: 7,
                  borderTop: `1px solid ${T.lineSub}`,
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                    border: `1px dashed ${T.line}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: T.inkDim,
                  }}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5 }}>New vault</span>
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button type="button" onClick={onNew} title={`New note (${newNoteShortcut})`} style={{
            flex: 1, padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
            background: T.ink, border: `1px solid ${T.ink}`,
            color: T.bg, fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 650,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            boxShadow: `0 8px 20px color-mix(in oklab, ${T.ink} 16%, transparent)`,
          }}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span>New note</span>
          </button>
        </div>
        <MnContextualTip tip={contextualTip} onDismiss={onDismissContextualTip} T={T} compact />
      </div>

      <SectionHeader label="All Notes" sectionKey="allnotes" />
      {openSections.allnotes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: pad.gap, marginTop: 4 }}>
          <Row icon={iconInbox} label="All notes" count={notes.length}
               active={!selectedTag && !selectedWorkflow && !todayActive && !pinnedActive && !agendaActive && !graphActive && !smartViewsActive && !workflowActive && !novelistActive && !canvasActive && !trashActive && !calendarActive && !aiActive}
               onClick={() => onSelectTag(null)} />
          <Row icon={iconToday} label="Today" count={rollupCount}
               active={todayActive} onClick={onOpenToday} />
          <Row icon={iconInbox} label="Pinned" count={pinnedCount}
               active={pinnedActive} onClick={onOpenPinned} />
          {featureState.showAgenda && (
            <Row icon={iconAgenda} label="Agenda" count={agendaCount}
                 active={agendaActive || calendarActive}
                 onClick={onOpenAgenda} accent={T.warn} />
          )}
          {featureState.showWorkflow && (
            <Row icon={iconWorkflow} label="Workflow" count={workflowTotal || 0}
                 active={workflowActive}
                 onClick={onOpenWorkflowPanel} accent={T.accent} />
          )}
          {featureState.showWriter && novelistEnabled && (
            <Row icon={iconNovelist} label="Novelist" count={novelistCount}
                 active={novelistActive}
                 onClick={onOpenNovelist} accent={T.accent} />
          )}
          {featureState.showCanvas && (
            <Row icon={iconCanvas} label="Thinking Board" count={canvasCount}
                 active={canvasActive}
                 onClick={onOpenCanvas} accent={T.accent} />
          )}
          {featureState.showAskAi && onOpenAskAI && (
            <Row icon={iconAI} label="Ask AI" active={aiActive} onClick={onOpenAskAI} />
          )}
        </div>
      )}

      <div style={{ marginTop: pad.header }}>
        <SectionHeader label="More" sectionKey="more" />
      </div>
      {openSections.more && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: pad.gap, marginTop: 4 }}>
          {featureState.showLabs && <>
            <Row icon={iconSmartViews} label="Smart Views" count={smartViewCount}
                 active={smartViewsActive} onClick={onOpenSmartViews} accent={T.focus || T.accent} />
            <Row icon={iconGraph} label="Graph" active={graphActive} onClick={onOpenGraph} />
          </>}
          {onOpenTrash && (
            <Row icon={iconTrash} label="Recently deleted" count={trashCount}
                 active={trashActive} onClick={onOpenTrash} accent={T.warn || T.danger} />
          )}
        </div>
      )}
      <div style={{ borderTop: `1px solid ${T.lineSub}`, margin: '14px 14px 0' }} />

      {featureState.showWorkflow && (
        <div style={{ marginTop: pad.header }}>
          <SectionHeader label="Workflow" sectionKey="workflow" count={workflowTotal || 0} />
        </div>
      )}

      {featureState.showWorkflow && openSections.workflow && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: pad.gap,
          marginTop: 4, marginBottom: 12,
        }}>
          {(workflowStates || []).map(state => {
            const active = selectedWorkflow === state.id;
            const count = workflowCounts?.[state.id] || 0;
            return (
              <div key={state.id} onClick={() => onSelectWorkflow(state.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: `${pad.py}px 10px`, margin: '0 6px', borderRadius: 6,
                cursor: 'pointer', userSelect: 'none',
                background: active ? T.selBg : 'transparent',
                border: `1px solid ${active ? T.selLine : 'transparent'}`,
                color: active ? T.ink : T.inkMed,
                fontFamily: 'var(--mn-ui)', fontSize: 13,
                transition: 'background 80ms',
              }}
              onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
              onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
                <span style={{
                  fontFamily: 'var(--mn-mono)', fontSize: 9.5, fontWeight: 700,
                  color: state.color, background: state.bg,
                  padding: '1px 5px', borderRadius: 3,
                  minWidth: 42, textAlign: 'center',
                }}>{state.id}</span>
                <span style={{ flex: 1, minWidth: 0, color: 'inherit' }}>{state.id.toLowerCase()}</span>
                <span style={{
                  fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
                  padding: '1px 5px', borderRadius: 3,
                  background: active ? 'transparent' : T.bgSub,
                }}>{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: pad.header }}>
        <SectionHeader
          label="Tags"
          sectionKey="tags"
          count={tags.length}
          onContextMenu={(e) => openTagMenu(e)}
          action={
            <button onClick={() => {
              if (creatingTag) {
                setCreatingTag(false);
                setNewTagName('');
              } else {
                startTagCreate();
              }
            }} title="New tag" style={{
              width: 18, height: 18, borderRadius: 4,
              border: 'none', background: 'transparent',
              color: T.inkDim, cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          }
        />
      </div>

      <div style={{
        flex: 1, overflow: 'auto',
        display: openSections.tags ? 'flex' : 'none',
        flexDirection: 'column', gap: pad.gap,
        marginTop: 4,
      }}>
        {creatingTag && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 6px', margin: '0 6px 4px',
          }}
          ref={tagCreatorRef}>
            <input
              autoFocus
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitTag(); }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setNewTagName('');
                  setCreatingTag(false);
                }
              }}
              placeholder="new tag"
              style={{
                flex: 1, minWidth: 0,
                border: `1px solid ${T.lineSub}`,
                borderRadius: 5,
                padding: '5px 7px',
                background: T.bgSub,
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              onMouseDown={(e) => { e.preventDefault(); submitTag(); }}
              disabled={!newTagName.trim()}
              title="Create tag"
              style={{
                width: 28, height: 27, borderRadius: 5,
                border: `1px solid ${T.lineSub}`,
                background: newTagName.trim() ? T.ink : T.bg,
                color: newTagName.trim() ? T.bg : T.inkDim,
                cursor: newTagName.trim() ? 'pointer' : 'default',
                padding: 0,
              }}>+</button>
          </div>
        )}
        {tags.map(tag => {
          const active = selectedTag === tag.name;
          const color = mnGetTagColor(tag.hue, theme);
          return (
            <div key={tag.name}
            onClick={() => { setTagMenu(null); onSelectTag(tag.name); }}
            onContextMenu={(e) => openTagMenu(e, tag.name)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: `${pad.py}px 10px`, margin: '0 6px', borderRadius: 6,
              cursor: 'pointer', userSelect: 'none',
              background: active ? T.selBg : 'transparent',
              fontFamily: 'var(--mn-ui)', fontSize: 13,
              color: active ? T.ink : T.inkMed,
              transition: 'background 80ms',
            }}
            onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
            onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
              }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag.name}</span>
              <span style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
              }}>{noteCounts[tag.name] || 0}</span>
              <button
                type="button"
                title="Remove tag"
                onClick={(e) => { e.stopPropagation(); deleteTag(tag.name); }}
                style={{
                  width: 18, height: 18, borderRadius: 4,
                  border: 'none', background: 'transparent',
                  color: T.inkDim, cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0.72, flexShrink: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                onMouseLeave={e => e.currentTarget.style.opacity = 0.72}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {tagMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: tagMenu.x,
            top: tagMenu.y,
            zIndex: 90,
            minWidth: 148,
            padding: 5,
            background: T.bg,
            border: `1px solid ${T.line}`,
            borderRadius: 7,
            boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
          }}>
          <button
            type="button"
            onClick={startTagCreate}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 8px', border: 'none', borderRadius: 5,
              background: 'transparent', color: T.inkMed, cursor: 'pointer',
              fontFamily: 'var(--mn-ui)', fontSize: 12.5, textAlign: 'left',
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span style={{ width: 14, textAlign: 'center', color: T.inkDim }}>+</span>
            <span>New tag</span>
          </button>
          {tagMenu.tagName && (
            <button
              type="button"
              onClick={() => deleteTag(tagMenu.tagName)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 8px', border: 'none', borderRadius: 5,
                background: 'transparent', color: T.danger || T.warn || T.inkMed, cursor: 'pointer',
                fontFamily: 'var(--mn-ui)', fontSize: 12.5, textAlign: 'left',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ width: 14, textAlign: 'center' }}>x</span>
              <span>Remove tag</span>
            </button>
          )}
        </div>
      )}

      <LocalStatusPopover
        activeVault={activeVault}
        saveStatus={saveStatus}
        lastBackupAt={lastBackupAt}
        onOpenVaultHealth={onOpenVaultHealth}
        onExportBackup={onExportBackup}
        onOpenSettings={onOpenSettings}
        T={T}
      />
    </div>
  );
}
export { MnSidebar };
