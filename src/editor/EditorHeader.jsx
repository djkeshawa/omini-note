import { shortcutLabel, useShortcutPlatform } from '../platform/shortcuts.js';

const { useEffect, useRef, useState } = React;

function HeaderButton({ active = false, children, label, onClick, T, iconOnly = false, popup = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={popup ? active : undefined}
      aria-haspopup={popup ? 'menu' : undefined}
      title={label}
      onClick={onClick}
      style={{
        minWidth: iconOnly ? 36 : 'auto',
        minHeight: 36,
        padding: iconOnly ? 0 : '0 11px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        border: `1px solid ${active ? T.selLine || T.accent : T.lineSub}`,
        borderRadius: 8,
        background: active ? T.accentSoft : (T.bgElevated || T.bg),
        color: active ? T.accent : T.inkMed,
        cursor: 'pointer',
        fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 650,
        whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

function MenuItem({ children, danger = false, hint = '', onClick, T }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={typeof children === 'string' ? children : undefined}
      onClick={onClick}
      style={{
        width: '100%', minHeight: 38, padding: '7px 10px',
        display: 'flex', alignItems: 'center', gap: 12,
        border: 0, borderRadius: 6, background: 'transparent',
        color: danger ? (T.danger || T.warn) : T.inkMed,
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'var(--mn-ui)', fontSize: 12.5,
      }}
      onMouseEnter={event => { event.currentTarget.style.background = T.bgHover; }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
      <span style={{ flex: 1 }}>{children}</span>
      {hint && <span aria-hidden="true" style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{hint}</span>}
    </button>
  );
}

function EditorHeader({
  T, note, saveStatus, wordCount, connectionCount,
  novelistPath, onOpen, onBack,
  sidebarHidden, noteListHidden, onToggleSidebar, onToggleNoteList,
  onPinToggle, onScrollToConnections, onDuplicate, onOpenVersions,
  onExport, referencePaneOpen, onToggleReferencePane, onOpenGraph, onOpenCalendar, onDelete,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const platform = useShortcutPlatform();

  useEffect(() => {
    if (!moreOpen) return undefined;
    const focusHandle = requestAnimationFrame(() => {
      moreRef.current?.querySelector('[role="menuitem"]')?.focus?.();
    });
    const closeOutside = event => {
      if (!moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMoreOpen(false);
        moreRef.current?.querySelector('button[aria-label="More note actions"]')?.focus?.();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      cancelAnimationFrame(focusHandle);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [moreOpen]);

  const runMenuAction = action => {
    setMoreOpen(false);
    action?.();
  };
  const handleMenuKeyDown = event => {
    const key = event.key === 'Down' ? 'ArrowDown' : event.key === 'Up' ? 'ArrowUp' : event.key;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? items.length - 1
        : key === 'ArrowUp'
          ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus?.();
  };

  return (
    <div data-mn-editor-header="true" style={{
      padding: '9px clamp(58px, 6vw, 68px) 9px clamp(14px, 3vw, 28px)',
      display: 'flex', alignItems: 'center', gap: 8,
      minHeight: 56,
      borderBottom: `1px solid ${T.lineSub}`,
      background: `color-mix(in oklab, ${T.bgElevated || T.bg} 90%, transparent)`,
      backdropFilter: 'blur(12px)',
    }}>
      {onBack && (
        <HeaderButton label="Back to previous view" onClick={onBack} T={T} iconOnly>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M10 3L5 8L10 13" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </HeaderButton>
      )}
      {sidebarHidden && onToggleSidebar && (
        <HeaderButton label="Show navigation" onClick={onToggleSidebar} T={T} iconOnly>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v11" />
          </svg>
        </HeaderButton>
      )}
      {noteListHidden && onToggleNoteList && (
        <HeaderButton label="Show note list" onClick={onToggleNoteList} T={T} iconOnly>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M8.5 2.5v11M4 5h2.2M4 8h2.2M4 11h2.2" strokeLinecap="round" />
          </svg>
        </HeaderButton>
      )}
      {Array.isArray(novelistPath) && novelistPath.length > 1 && (
        <div aria-label="Note path" style={{
          display: 'flex', alignItems: 'center', gap: 5,
          minWidth: 0, overflow: 'hidden',
          fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim,
        }}>
          {novelistPath.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 && <span aria-hidden="true" style={{ color: T.line }}>›</span>}
              <button
                type="button"
                onClick={() => onOpen?.(item.id)}
                disabled={item.id === note.id}
                style={{
                  minHeight: 28, maxWidth: 150, padding: '2px 4px',
                  border: 0, borderRadius: 5, background: 'transparent',
                  color: item.id === note.id ? T.inkDim : T.inkMed,
                  cursor: item.id === note.id ? 'default' : 'pointer',
                  fontFamily: 'var(--mn-ui)', fontSize: 11.5,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                {item.title || 'Untitled'}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 4 }} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
        whiteSpace: 'nowrap',
      }}>
        <span aria-live="polite" aria-atomic="true" style={{ color: saveStatus === 'Conflict' ? (T.danger || T.warn) : T.inkDim }}>{saveStatus}</span>
        <span aria-hidden="true" style={{ color: T.line }}>·</span>
        <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
      </div>
      <HeaderButton label={note.pinned ? 'Unpin note' : 'Pin note'} onClick={onPinToggle} active={note.pinned} T={T}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill={note.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <path d="M10 1.5L14.5 6L11 7L8 10L6 8L9 5L10 1.5Z"/><path d="M6 8L2.5 11.5" strokeLinecap="round"/>
        </svg>
        <span>{note.pinned ? 'Pinned' : 'Pin'}</span>
      </HeaderButton>
      {connectionCount > 0 && (
        <HeaderButton label={`Show ${connectionCount} connections`} onClick={onScrollToConnections} T={T}>
          <span>Connections</span>
          <span aria-hidden="true" style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{connectionCount}</span>
        </HeaderButton>
      )}
      <div ref={moreRef} style={{ position: 'relative' }}>
        <HeaderButton label="More note actions" onClick={() => setMoreOpen(open => !open)} active={moreOpen} popup T={T}>
          <span>More</span><span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>···</span>
        </HeaderButton>
        {moreOpen && (
          <div
            role="menu"
            aria-label="More note actions"
            onKeyDown={handleMenuKeyDown}
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMoreOpen(false);
            }}
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              zIndex: 70, width: 224, padding: 5,
              border: `1px solid ${T.line}`, borderRadius: 9,
              background: T.bg, boxShadow: `0 14px 36px color-mix(in oklab, ${T.ink} 20%, transparent)`,
            }}>
            <MenuItem onClick={() => runMenuAction(onDuplicate)} T={T}>Duplicate note</MenuItem>
            {onOpenVersions && <MenuItem onClick={() => runMenuAction(onOpenVersions)} T={T}>Version history</MenuItem>}
            {onToggleReferencePane && (
              <MenuItem onClick={() => runMenuAction(onToggleReferencePane)} hint={shortcutLabel('referencePane', platform, { compact: true })} T={T}>
                {referencePaneOpen ? 'Close reference pane' : 'Open reference pane'}
              </MenuItem>
            )}
            {onOpenGraph && <MenuItem onClick={() => runMenuAction(onOpenGraph)} hint={shortcutLabel('graph', platform, { compact: true })} T={T}>Open Graph</MenuItem>}
            {onOpenCalendar && <MenuItem onClick={() => runMenuAction(onOpenCalendar)} T={T}>Open Agenda</MenuItem>}
            {onExport && <div role="separator" style={{ height: 1, background: T.lineSub, margin: '4px 6px' }} />}
            {onExport && <MenuItem onClick={() => runMenuAction(() => onExport('md'))} T={T}>Export as Markdown</MenuItem>}
            {onExport && <MenuItem onClick={() => runMenuAction(() => onExport('html'))} T={T}>Export as HTML</MenuItem>}
            {onExport && <MenuItem onClick={() => runMenuAction(() => onExport('pdf'))} T={T}>Export as PDF</MenuItem>}
            <div role="separator" style={{ height: 1, background: T.lineSub, margin: '4px 6px' }} />
            <MenuItem danger onClick={() => runMenuAction(onDelete)} T={T}>Delete note</MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}

export { EditorHeader };
