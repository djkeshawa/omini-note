// Sidebar pane: tags, daily rollup, todos count, settings.
const { useMemo: useMemoS } = React;
const VAULT_ICON_SRC = 'assets/vispnote-icon.png';

function MnVaultIcon({ T, size = 22, active = false }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.24)),
      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: active ? T.bg : T.bgSub,
      border: `1px solid ${active ? T.line : T.lineSub}`,
      padding: Math.max(1, Math.round(size * 0.12)),
    }}>
      <img src={VAULT_ICON_SRC} alt="" aria-hidden="true" style={{
        width: '100%', height: '100%', display: 'block', objectFit: 'contain',
      }} />
    </span>
  );
}

function MnSidebar({
  tags, notes, selectedTag, onSelectTag, onOpenTodos, onOpenGraph,
  onOpenToday, todayActive, todosActive, graphActive,
  selectedWorkflow, workflowStates, workflowCounts, workflowTotal,
  onSelectWorkflow, onOpenWorkflowPanel, workflowActive,
  onOpenNovelist, novelistActive, novelistEnabled, novelistCount = 0,
  onOpenCanvas, canvasActive, canvasCount = 0,
  onOpenAskAI,
  onNewTag, onNew, onOpenSettings, onCollapse,
  vaults, activeVaultId, onSelectVault, onCreateVault, onRenameVault, onDeleteVault,
  T, density, theme
}) {
  const [vaultOpen, setVaultOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newVaultType, setNewVaultType] = React.useState('notes');
  const [creatingTag, setCreatingTag] = React.useState(false);
  const [newTagName, setNewTagName] = React.useState('');
  const tagCreatorRef = React.useRef(null);
  const [renameId, setRenameId] = React.useState(null);
  const [renameVal, setRenameVal] = React.useState('');
  // Collapsible sections — persisted in localStorage
  const [openSections, setOpenSections] = React.useState(() => {
    try {
      const raw = localStorage.getItem('mn:sidebarSections');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { allnotes: true, vaults: true, workflow: true, tags: true };
  });
  const toggleSection = (key) => {
    setOpenSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('mn:sidebarSections', JSON.stringify(next)); } catch (e) {}
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

  const openTodos = notes.reduce((acc, n) => {
    const m = [...n.body.matchAll(/^\s*-\s+\[ \]/gm)];
    return acc + m.length;
  }, 0);

  const rollupCount = notes.length;

  const submitTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    onNewTag && onNewTag(name);
    setNewTagName('');
    setCreatingTag(false);
  };

  const submitVault = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateVault(name, { type: newVaultType });
    setNewName('');
    setNewVaultType('notes');
    setCreating(false);
    setVaultOpen(false);
  };

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

  const SectionHeader = ({ label, sectionKey, count, action }) => {
    const open = !!openSections[sectionKey];
    return (
      <div style={{
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

  const Row = ({ icon, label, count, active, onClick, accent }) => (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: `${pad.py}px 10px`, margin: '0 6px', borderRadius: 6,
      cursor: 'pointer', userSelect: 'none',
      background: active ? T.selBg : 'transparent',
      color: active ? T.ink : T.inkMed,
      fontFamily: 'var(--mn-ui)', fontSize: 13,
      fontWeight: active ? 500 : 400,
      transition: 'background 80ms',
    }}
    onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
    onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
      <span style={{ width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: accent || T.inkDim }}>{icon}</span>
      <span style={{ flex: 1, color: 'inherit' }}>{label}</span>
      {count != null && (
        <span style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          padding: '1px 5px', borderRadius: 3,
          background: active ? 'transparent' : T.bgSub,
        }}>{count}</span>
      )}
    </div>
  );

  const iconInbox = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 9L3 3H13L14 9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2 9V13H14V9H10.5L9.5 11H6.5L5.5 9H2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>);
  const iconToday = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 2V4M11 2V4M2 7H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="8" cy="10.5" r="1.3" fill="currentColor"/></svg>);
  const iconTodos = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.3"/><path d="M3 4.5L3.7 5.2L5 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><rect x="2" y="9.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.3"/><path d="M8 4.5H14M8 11.5H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconWorkflow = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4H8.5M3 8H11M3 12H7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="13" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>);
  const iconNovelist = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2.5H10.5L12 4V13.5H4V2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M10.5 2.5V4H12M6 7H10M6 9.5H10M6 12H8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconGraph = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 5L10.5 5M5.3 5.8L6.8 10.4M10.7 5.8L9.2 10.4" stroke="currentColor" strokeWidth="1.3"/></svg>);
  const iconCanvas = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3" width="11" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.3"/><path d="M5 6H8.5M5 8.5H11M5 11H7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10.6 5.4L12 4M11.1 7.1L13 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);
  const iconAI = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>);

  return (
    <div style={{
      width: density === 'compact' ? 220 : 260, height: '100%',
      background: T.bgSub, borderRight: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      paddingTop: 12,
    }}>
      {/* Vault switcher header */}
      <div style={{
        padding: '4px 10px 14px', position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setVaultOpen(v => !v)} style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
            background: vaultOpen ? T.bg : 'transparent',
            border: `1px solid ${vaultOpen ? T.line : 'transparent'}`,
            color: T.ink, textAlign: 'left',
          }}
          onMouseEnter={e => !vaultOpen && (e.currentTarget.style.background = T.bgHover)}
          onMouseLeave={e => !vaultOpen && (e.currentTarget.style.background = 'transparent')}>
            <MnVaultIcon T={T} size={22} active />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 600,
                color: T.ink, letterSpacing: '-0.01em',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{activeVault?.name || 'VispNote'}</div>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
                marginTop: 1, letterSpacing: '0.04em',
              }}>{activeVault?.path || '~/vault'}</div>
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
              position: 'absolute', top: 42, left: 10, right: 10,
              background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8,
              padding: 5, zIndex: 50,
              boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
              animation: 'mnSlideDown 140ms ease',
            }}>
              <div style={{
                padding: '6px 9px 4px', fontFamily: 'var(--mn-mono)', fontSize: 9.5,
                letterSpacing: '0.12em', textTransform: 'uppercase', color: T.inkDim,
              }}>Vaults</div>
              {vaults.map(v => {
                const active = v.id === activeVaultId;
                const isRenaming = renameId === v.id;
                return (
                  <div key={v.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 9px', borderRadius: 5, cursor: 'pointer',
                    background: active ? T.selBg : 'transparent',
                  }}
                  onMouseEnter={e => !active && !isRenaming && (e.currentTarget.style.background = T.bgHover)}
                  onMouseLeave={e => !active && !isRenaming && (e.currentTarget.style.background = 'transparent')}
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
                          flex: 1, border: `1px solid ${T.accent}`, borderRadius: 4,
                          padding: '2px 5px', background: T.bg, color: T.ink,
                          outline: 'none', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                        }} />
                    ) : (
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink,
                          fontWeight: active ? 500 : 400,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{v.name}</div>
                        <div style={{
                          fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
                        }}>{v.noteCount} note{v.noteCount === 1 ? '' : 's'}</div>
                      </div>
                    )}
                    {active && !isRenaming && (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={T.accent} strokeWidth="1.6" style={{ flexShrink: 0 }}>
                        <path d="M3.5 8.5L6.5 11.5L12.5 5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {!isRenaming && (
                      <button onClick={(e) => { e.stopPropagation(); setRenameId(v.id); setRenameVal(v.name); }}
                        title="Rename" style={{
                          width: 20, height: 20, border: 'none', background: 'transparent',
                          color: T.inkDim, cursor: 'pointer', padding: 0, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6,
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = 0.6}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                          <path d="M3 12L12 3L13.5 4.5L4.5 13.5L2.5 14L3 12Z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}

              {creating ? (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 9px', borderRadius: 5,
                    border: `1px solid ${T.accent}`, marginTop: 4,
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
                        if (e.key === 'Escape') { setCreating(false); setNewName(''); setNewVaultType('notes'); }
                      }}
                      style={{
                        flex: 1, border: 'none', outline: 'none', background: 'transparent',
                        color: T.ink, fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                      }} />
                    <button onClick={() => {
                      submitVault();
                    }} disabled={!newName.trim()}
                      style={{
                        padding: '3px 10px', borderRadius: 4, border: 'none',
                        background: newName.trim() ? T.ink : T.bgSub,
                        color: newName.trim() ? T.bg : T.inkDim,
                        cursor: newName.trim() ? 'pointer' : 'default',
                        fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 500,
                      }}>Create</button>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 5,
                    margin: '5px 0 0 29px',
                  }}>
                    {[
                      { id: 'notes', label: 'Notes vault' },
                      { id: 'novelist', label: 'Novelist vault' },
                    ].map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setNewVaultType(type.id)}
                        style={{
                          padding: '5px 7px',
                          borderRadius: 5,
                          border: `1px solid ${newVaultType === type.id ? T.selLine : T.lineSub}`,
                          background: newVaultType === type.id ? T.accentSoft : T.bgSub,
                          color: newVaultType === type.id ? T.accent : T.inkMed,
                          fontFamily: 'var(--mn-ui)',
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}>{type.label}</button>
                    ))}
                  </div>
                </>
              ) : (
                <div onClick={() => setCreating(true)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 9px', borderRadius: 5, cursor: 'pointer',
                  color: T.inkMed, marginTop: 4,
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

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={onNew} title="New note (⌘N)" style={{
            flex: 1, padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
            background: T.bg, border: `1px solid ${T.line}`,
            color: T.inkMed, fontFamily: 'var(--mn-ui)', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span>New note</span>
          </button>
        </div>
      </div>

      {/* Main nav (collapsible: All Notes section) */}
      <SectionHeader label="All Notes" sectionKey="allnotes" />
      {openSections.allnotes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: pad.gap, marginTop: 4 }}>
          <Row icon={iconInbox} label="All notes" count={notes.length}
               active={!selectedTag && !selectedWorkflow && !todayActive && !todosActive && !graphActive && !workflowActive && !novelistActive && !canvasActive}
               onClick={() => onSelectTag(null)} />
          <Row icon={iconToday} label="Daily rollup" count={rollupCount}
               active={todayActive} onClick={onOpenToday} />
          <Row icon={iconTodos} label="Todos" count={openTodos}
               active={todosActive}
               onClick={onOpenTodos} accent={T.warn} />
          <Row icon={iconWorkflow} label="Workflow" count={workflowTotal || 0}
               active={workflowActive}
               onClick={onOpenWorkflowPanel} accent={T.accent} />
          {novelistEnabled && (
            <Row icon={iconNovelist} label="Novelist" count={novelistCount}
                 active={novelistActive}
                 onClick={onOpenNovelist} accent={T.accent} />
          )}
          <Row icon={iconGraph} label="Graph" active={graphActive} onClick={onOpenGraph} />
          <Row icon={iconCanvas} label="Canvas" count={canvasCount}
               active={canvasActive}
               onClick={onOpenCanvas} accent={T.accent} />
          {onOpenAskAI && (
            <Row icon={iconAI} label="Ask AI" onClick={onOpenAskAI} />
          )}
        </div>
      )}

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${T.lineSub}`, margin: '14px 14px 0' }} />

      {/* Workflow (collapsible) */}
      <div style={{ marginTop: pad.header }}>
        <SectionHeader
          label="Workflow"
          sectionKey="workflow"
          count={workflowTotal || 0}
        />
      </div>

      {openSections.workflow && (
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

      {/* Tags (collapsible) */}
      <div style={{ marginTop: pad.header }}>
        <SectionHeader
          label="Tags"
          sectionKey="tags"
          count={tags.length}
          action={
            <button onClick={() => {
              setOpenSections(s => ({ ...s, tags: true }));
              setCreatingTag(v => !v);
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
            <div key={tag.name} onClick={() => onSelectTag(tag.name)} style={{
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
              <span style={{ flex: 1 }}>{tag.name}</span>
              <span style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
              }}>{noteCounts[tag.name] || 0}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 12px', borderTop: `1px solid ${T.lineSub}`,
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: 'var(--mn-mono)', fontSize: 10.5,
        color: T.inkDim, letterSpacing: '0.04em',
        flexShrink: 0, minWidth: 0,
      }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M3 4H13V13H3V4Z" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M3 4L5.5 2H10.5L13 4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        </svg>
        <span title={activeVault?.path || '~/vault'} style={{
          minWidth: 0, flex: '1 1 auto',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{activeVault?.path || '~/vault'}</span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: T.success, flexShrink: 0,
        }} />
        <span style={{ flexShrink: 0 }}>synced</span>
        <button onClick={onOpenSettings} title="Settings" style={{
          marginLeft: 2, width: 26, height: 26, borderRadius: 6,
          background: 'transparent', border: 'none', color: T.inkMed, cursor: 'pointer',
          padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.2"/>
            <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

window.MnSidebar = MnSidebar;
