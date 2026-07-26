import { DS_PANE, DS_RADIUS, dsMachineStyle } from '../shared/designSystem.js';
// Ask AI chat history and shared UI helpers.

const { useState: useStateAI, useEffect: useEffectAI } = React;

function MnAiChatHistory({ sessions = [], activeId = '', onSelect, onNew, onDelete, onArchive, onRename, T }) {
  const [showArchived, setShowArchived] = useStateAI(false);
  const [contextMenu, setContextMenu] = useStateAI(null);
  const [renameId, setRenameId] = useStateAI(null);
  const [renameValue, setRenameValue] = useStateAI('');
  const visibleSessions = sessions
    .filter(session => !!session.archived === showArchived)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const activeCount = sessions.filter(session => !session.archived).length;
  const archivedCount = sessions.filter(session => session.archived).length;

  useEffectAI(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEsc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEsc);
    };
  }, [contextMenu]);

  const openContextMenu = (e, session) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      sessionId: session.id,
      archived: !!session.archived,
      pending: !!session.pending,
    });
  };
  const startRename = (id, currentTitle) => {
    setRenameId(id);
    setRenameValue(currentTitle || '');
    setContextMenu(null);
  };
  const submitRename = () => {
    if (renameId && onRename) onRename(renameId, renameValue.trim() || 'New chat');
    setRenameId(null);
    setRenameValue('');
  };
  const cancelRename = () => {
    setRenameId(null);
    setRenameValue('');
  };

  return (
    <aside style={{
      width: DS_PANE.aiChatList,
      height: '100%',
      borderRight: `1px solid ${T.line}`,
      background: T.bgSub,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      minWidth: 0,
      position: 'relative',
    }}>
      {/* Title and filter are one block: what you are looking at, and which
          slice of it. */}
      <div style={{
        padding: '14px 12px 12px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: T.ink }}>AI chats</span>
          <button
            onClick={onNew}
            title="New AI chat"
            style={{
              height: 26, padding: '0 9px', borderRadius: DS_RADIUS.control,
              border: `1px solid ${T.selLine}`, background: T.accentSoft, color: T.accent,
              fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M6 2.5v7M2.5 6h7" strokeLinecap="round"/>
            </svg>
            New
          </button>
        </div>
        <div style={{
          display: 'flex', padding: 2, borderRadius: DS_RADIUS.control,
          background: T.bgElevated || T.bg, border: `1px solid ${T.lineSub}`,
        }}>
          <MnAiTabPill active={!showArchived} onClick={() => setShowArchived(false)} T={T} title="Show active chats">
            Active <span style={dsMachineStyle(T)}>{activeCount}</span>
          </MnAiTabPill>
          <MnAiTabPill active={showArchived} onClick={() => setShowArchived(true)} T={T} title="Show archived chats">
            Archived <span style={dsMachineStyle(T)}>{archivedCount}</span>
          </MnAiTabPill>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleSessions.map(session => {
          const active = session.id === activeId;
          const renaming = session.id === renameId;
          const messages = session.messages || [];
          const last = [...messages].reverse().find(m => m.text)?.text || 'No messages yet';
          return (
            <div
              key={session.id}
              onClick={() => { if (!renaming) onSelect?.(session.id); }}
              onContextMenu={(e) => openContextMenu(e, session)}
              onDoubleClick={(e) => {
                if (renaming) return;
                e.preventDefault();
                startRename(session.id, session.title);
              }}
              style={{
                padding: '8px 10px',
                marginBottom: 4,
                borderRadius: 7,
                border: `1px solid ${active ? T.selLine : 'transparent'}`,
                background: active ? T.accentSoft : 'transparent',
                cursor: renaming ? 'default' : 'pointer',
              }}
              onMouseEnter={(e) => { if (!active && !renaming) e.currentTarget.style.background = T.bgHover; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
              {renaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={submitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  style={{
                    width: '100%',
                    padding: '3px 6px',
                    border: `1px solid ${T.selLine}`,
                    borderRadius: 5,
                    background: T.bg,
                    color: T.ink,
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    outline: 'none',
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    minWidth: 0,
                    flex: 1,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: active ? T.accent : T.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{session.title || 'New chat'}</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (session.pending) return;
                      onArchive?.(session.id, !session.archived);
                    }}
                    disabled={!!session.pending}
                    title={session.pending ? 'Wait for this chat to finish before archiving' : (session.archived ? 'Restore chat' : 'Archive chat')}
                    style={mnAiRowActionButton(T, false, !!session.pending)}>
                    {session.archived ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.55">
                        <path d="M4 7L8 3L12 7" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M8 3V12" strokeLinecap="round"/>
                        <path d="M3 12.5H13" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.55">
                        <path d="M3.25 6.25H12.75V12.5H3.25V6.25Z" strokeLinejoin="round"/>
                        <path d="M5 3.5H11L12.75 6.25H3.25L5 3.5Z" strokeLinejoin="round"/>
                        <path d="M6.25 8.25H9.75" strokeLinecap="round"/>
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (session.pending) return;
                      onDelete?.(session.id);
                    }}
                    disabled={!!session.pending}
                    title={session.pending ? 'Wait for this chat to finish before deleting' : 'Delete chat'}
                    style={mnAiRowActionButton(T, true, !!session.pending)}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.55">
                      <path d="M3.5 4.5H12.5" strokeLinecap="round"/>
                      <path d="M6 4.5V3.2H10V4.5" strokeLinejoin="round"/>
                      <path d="M5 6.5L5.5 13H10.5L11 6.5" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              )}
              <div style={{
                marginTop: 3,
                fontSize: 11.25,
                color: T.inkDim,
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>{last}</div>
            </div>
          );
        })}
        {!visibleSessions.length && (
          <div style={{
            padding: 16,
            color: T.inkDim,
            fontSize: 12,
            lineHeight: 1.5,
            textAlign: 'center',
          }}>
            {showArchived ? 'No archived chats' : 'No chats yet — start one with “New”.'}
          </div>
        )}
      </div>
      {!showArchived && (
        <div style={{
          padding: '8px 12px 10px',
          borderTop: `1px solid ${T.lineSub}`,
          fontFamily: 'var(--mn-mono)',
          fontSize: 9.5,
          color: T.inkDim,
          textAlign: 'center',
        }}>
          Use the row buttons or right-click for chat actions
        </div>
      )}
      {contextMenu && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 60,
            background: T.bg,
            border: `1px solid ${T.line}`,
            borderRadius: 6,
            padding: 4,
            minWidth: 160,
            boxShadow: `0 12px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
          }}>
          <MnAiContextMenuItem
            T={T}
            onClick={() => {
              const sess = sessions.find(s => s.id === contextMenu.sessionId);
              startRename(contextMenu.sessionId, sess?.title || '');
            }}>
            Rename
          </MnAiContextMenuItem>
          <MnAiContextMenuItem
            T={T}
            disabled={!!contextMenu.pending}
            onClick={() => {
              if (contextMenu.pending) return;
              onArchive?.(contextMenu.sessionId, !contextMenu.archived);
              setContextMenu(null);
            }}>
            {contextMenu.archived ? 'Restore chat' : 'Archive chat'}
          </MnAiContextMenuItem>
          <MnAiContextMenuItem
            T={T}
            danger
            disabled={!!contextMenu.pending}
            onClick={() => {
              if (contextMenu.pending) return;
              onDelete?.(contextMenu.sessionId);
              setContextMenu(null);
            }}>
            Delete chat
          </MnAiContextMenuItem>
        </div>
      )}
    </aside>
  );
}

function MnAiTabPill({ active, onClick, children, T, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        // A segment inside the filter, not a pill of its own: the container
        // already draws the border.
        flex: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        minHeight: 24,
        padding: '0 9px',
        border: 'none',
        background: active ? (T.bgSub) : 'transparent',
        color: active ? T.ink : T.inkMed,
        borderRadius: DS_RADIUS.icon,
        boxShadow: active ? `0 1px 2px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
        fontFamily: 'var(--mn-ui)',
        fontSize: 11.5,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

function mnAiRowActionButton(T, danger = false, disabled = false) {
  return {
    width: 24,
    height: 24,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 5,
    background: T.bg,
    color: disabled ? T.inkDim : (danger ? (T.danger || T.warn || T.inkDim) : T.inkDim),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    flexShrink: 0,
  };
}

function MnAiContextMenuItem({ onClick, disabled, danger, children, T }) {
  const color = disabled
    ? T.inkDim
    : danger
      ? (T.danger || T.warn || T.ink)
      : T.ink;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 10px',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        color,
        fontFamily: 'var(--mn-ui)',
        fontSize: 12.5,
        borderRadius: 4,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = T.bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      {children}
    </button>
  );
}

function StatusPill({ status, T }) {
  if (!status) return (
    <Pill T={T} color={T.inkDim}>checking…</Pill>
  );
  const provider = String(status?.config?.provider || 'ollama').toLowerCase();
  if (provider !== 'ollama') {
    if (status.chatModelOk) return (
      <Pill T={T} color="#070">ready</Pill>
    );
    return (
      <Pill T={T} color="#a60">setup needed</Pill>
    );
  }
  if (!status.reachable) return (
    <Pill T={T} color="#a60">setup needed</Pill>
  );
  if (!status.chatModelOk) return (
    <Pill T={T} color="#a60">setup needed</Pill>
  );
  if (!status.embedModelOk) return (
    <Pill T={T} color="#a60">keyword mode</Pill>
  );
  return <Pill T={T} color="#070">ready</Pill>;
}
function Pill({ T, color, children }) {
  return (
    <span style={{
      fontSize: 11, fontFamily: 'var(--mn-ui)', fontWeight: 600,
      padding: '2px 7px', borderRadius: 99,
      border: `1px solid ${T.lineSub}`, color,
      background: T.bgSub,
    }}>{children}</span>
  );
}
function mnAskPrimaryButton(T) {
  return {
    padding: '7px 14px',
    borderRadius: 6,
    border: `1px solid ${T.line}`,
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 650,
  };
}
function mnAskSecondaryButton(T) {
  return {
    padding: '7px 12px',
    borderRadius: 6,
    border: `1px solid ${T.line}`,
    background: T.bg,
    color: T.inkMed,
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 550,
    cursor: 'pointer',
  };
}
function mnAskReportButton(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkDim,
    borderRadius: 6,
    padding: '4px 8px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11.5,
    cursor: 'pointer',
  };
}
function iconBtn(T) {
  return {
    width: 24, height: 24, borderRadius: 5,
    border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
    cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

export { MnAiChatHistory, StatusPill, iconBtn, mnAskPrimaryButton, mnAskReportButton, mnAskSecondaryButton };
