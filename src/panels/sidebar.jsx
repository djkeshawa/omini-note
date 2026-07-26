import { storage } from '../shared/storageUtils.js'; import { mnGetTagColor } from '../shared/theme.jsx'; import { shortcutLabel } from '../platform/shortcuts.js';
import { MnContextualTip } from '../features/onboarding/index.js';
import { SidebarNavRow } from './SidebarNavRow.jsx';
import { LocalStatusPopover } from './LocalStatusPopover.jsx';
import { DS_HEIGHT, dsGroupLabelStyle, dsMachineStyle, dsPaneWidth, dsSelectedBarStyle, dsSelectedRow, mnSentenceCase } from '../shared/designSystem.js';
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
  onNewTag, onDeleteTag, onNew, onOpenQuickCapture, onOpenSettings, onCollapse,
  vaults, activeVaultId, onSelectVault, onCreateVault, onRefreshVaults, onRenameVault, onDeleteVault,
  featureState = {}, contextualTip = null, onDismissContextualTip, todayCount,
  saveStatus = 'Saved', lastBackupAt = null, onOpenVaultHealth, onExportBackup,
  newNoteShortcut = shortcutLabel('newNote', undefined, { compact: true }),
  quickCaptureShortcut = shortcutLabel('quickCapture', undefined, { compact: true }), T, density, theme
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
        height: 22, padding: '0 8px',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <button onClick={() => toggleSection(sectionKey)} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          flex: 1, minWidth: 0, padding: 0,
          background: 'transparent', border: 'none', cursor: 'pointer',
          textAlign: 'left', ...dsGroupLabelStyle(T),
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
            <span style={dsMachineStyle(T)}>{count}</span>
          )}
        </button>
        {action}
      </div>
    );
  };

  // Nav rows are 34px at comfortable density; compact trims them to 30 so the
  // density setting still shortens the sidebar.
  const navRowHeight = density === 'compact' ? 30 : DS_HEIGHT.navRow;
  // Tag and workflow rows sit one step below the primary destinations.
  const subRowHeight = density === 'compact' ? 28 : 31;
  const Row = props => <SidebarNavRow {...props} T={T} height={navRowHeight} />;

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
  const iconCapture = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3.5H13V12.5H3V3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M5.5 6H10.5M5.5 8.5H9M11.5 10.5V14M9.75 12.25H13.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>);

  return (
    <div style={{
      width: dsPaneWidth('sidebar', density), height: '100%',
      background: `color-mix(in oklab, ${T.bgSub} 94%, ${T.bgElevated || T.bg})`,
      borderRight: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* The vault switcher and the primary create action live in the app
          bar now, so the sidebar opens straight into its destinations. */}
      <div style={{ padding: '0 10px 6px', position: 'relative' }}>
        <MnContextualTip tip={contextualTip} onDismiss={onDismissContextualTip} T={T} compact />
      </div>
      {/* One scrolling column for every destination, with the prototype's
          14/10 inset and an 18px gap between groups. The groups no longer
          space themselves, so they cannot drift apart. */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '14px 10px 0',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
      {/* The primary destinations carry no group label — the design keeps the
          top of the sidebar quiet, and labels start at "More". */}
      {(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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

      <div>
        <SectionHeader label="More" sectionKey="more" />
      </div>
      {openSections.more && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {onOpenQuickCapture && (
            <Row icon={iconCapture} label="Quick capture" hint={quickCaptureShortcut} onClick={onOpenQuickCapture} />
          )}
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
        <div>
          <SectionHeader label="Workflow" sectionKey="workflow" count={workflowTotal || 0} />
        </div>
      )}

      {featureState.showWorkflow && openSections.workflow && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 1,
          marginTop: 4, marginBottom: 12,
        }}>
          {(workflowStates || []).map(state => {
            const active = selectedWorkflow === state.id;
            const count = workflowCounts?.[state.id] || 0;
            return (
              <div key={state.id} onClick={() => onSelectWorkflow(state.id)} style={{
                ...dsSelectedRow(T, active, { height: subRowHeight }), fontSize: 13,
              }}
              onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
              onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
                {active && <span style={dsSelectedBarStyle(T, 6)} />}
                <span style={{ width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', background: state.color,
                  }} />
                </span>
                <span style={{
                  flex: 1, minWidth: 0, color: 'inherit',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{mnSentenceCase(state.id)}</span>
                <span style={dsMachineStyle(T, active ? T.inkMed : T.inkDim)}>{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <div>
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
        display: openSections.tags ? 'flex' : 'none',
        flexDirection: 'column', gap: 1,
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
            style={{ ...dsSelectedRow(T, active, { height: subRowHeight }), fontSize: 13 }}
            onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
            onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
              {active && <span style={dsSelectedBarStyle(T, 6)} />}
              <span style={{ width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
              </span>
              <span style={{
                flex: 1, minWidth: 0, color: 'inherit',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{tag.name}</span>
              <span style={dsMachineStyle(T, active ? T.inkMed : T.inkDim)}>
                {noteCounts[tag.name] || 0}
              </span>
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
      </div>

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
