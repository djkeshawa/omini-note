// The Views chrome, built from the v2 prototype rather than inherited from
// the Smart Views panel.
//
// Two rows. The first is the tab bar: every saved view is a tab carrying its
// own count, the active one grows a caret for rename/duplicate/delete, and a
// dashed plus adds another. The second is the control strip, where what a row
// *is* and how it is drawn live together as chips.
//
// Numbers here are the prototype's: 46px and 48px rows at 20px gutters, 28px
// controls on radius 8, a 176px search box, a 26px state pill on radius 999.
//
// The caret on the active tab opens a 168px menu for rename, duplicate and
// delete. Delete asks inside the menu rather than through a dialog, so the
// question appears where the click did.

import { DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';

function mnViewTabStyle(active, T) {
  return {
    height: 28,
    padding: active ? '0 6px 0 11px' : '0 11px',
    display: 'inline-flex', alignItems: 'center', gap: 7,
    borderRadius: active ? '8px 0 0 8px' : '8px',
    border: `1px solid ${active ? T.selLine : 'transparent'}`,
    borderRight: active ? 'none' : '1px solid transparent',
    background: active ? T.selBg : 'transparent',
    color: active ? T.ink : T.inkMed,
    fontFamily: 'var(--mn-ui)', fontSize: 12.5,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer', whiteSpace: 'nowrap',
  };
}

function mnViewChipStyle(on, T) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    height: 28, padding: '0 10px',
    borderRadius: DS_RADIUS.control,
    background: T.bg,
    border: `1px solid ${on ? T.selLine : T.lineSub}`,
    fontFamily: 'var(--mn-ui)', fontSize: 12,
    color: T.inkMed, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}

function mnViewMenuStyle(width, T) {
  return {
    position: 'absolute', top: 40, left: 0, zIndex: 60, width,
    background: T.bgElevated || T.bg,
    border: `1px solid ${T.line}`,
    borderRadius: DS_RADIUS.row,
    boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
    padding: 5,
  };
}

function mnViewMenuItemStyle(T, tone) {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    height: 30, padding: '0 9px',
    border: 'none', borderRadius: DS_RADIUS.icon,
    background: 'transparent',
    color: tone === 'danger' ? T.danger || T.warn : T.ink,
    cursor: 'pointer', textAlign: 'left',
    fontFamily: 'var(--mn-ui)', fontSize: 12.5,
  };
}

// Delete confirms in place. The name is repeated in the question because a
// menu can be opened on the wrong tab and the count is not visible from here.
function ViewMenu({ definition, canDelete, confirming, onRename, onDuplicate, onDelete, onConfirmDelete, onCancelDelete, T }) {
  if (confirming) {
    return (
      <div style={{ ...mnViewMenuStyle(220, T), padding: 11 }} role="dialog" aria-label="Confirm delete view">
        <div style={{ fontSize: 12.5, color: T.ink, marginBottom: 4, fontWeight: 600 }}>
          Delete “{definition.title || 'Untitled view'}”?
        </div>
        <div style={{ fontSize: 11.5, color: T.inkMed, lineHeight: 1.45, marginBottom: 10 }}>
          The notes and tasks it shows are not touched — only this way of looking at them.
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancelDelete} style={{
            height: 26, padding: '0 10px', borderRadius: DS_RADIUS.control,
            border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
            fontFamily: 'var(--mn-ui)', fontSize: 11.5, cursor: 'pointer',
          }}>Cancel</button>
          <button type="button" onClick={onConfirmDelete} style={{
            height: 26, padding: '0 10px', borderRadius: DS_RADIUS.control,
            border: 'none', background: T.danger || T.warn, color: T.bg,
            fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
          }}>Delete view</button>
        </div>
      </div>
    );
  }
  return (
    <div style={mnViewMenuStyle(168, T)} role="menu" aria-label="View options">
      <button type="button" role="menuitem" onClick={onRename} style={mnViewMenuItemStyle(T)}>Rename</button>
      <button type="button" role="menuitem" onClick={onDuplicate} style={mnViewMenuItemStyle(T)}>Duplicate</button>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? undefined : 'A vault keeps at least one view.'}
        style={{ ...mnViewMenuItemStyle(T, 'danger'), opacity: canDelete ? 1 : 0.45, cursor: canDelete ? 'pointer' : 'not-allowed' }}>
        Delete
      </button>
    </div>
  );
}

function Caret({ T }) {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ViewTabs({
  definitions, activeId, counts, renamingId, renameValue, menu,
  onPick, onRenameInput, onRenameKey, onRenameEnd, onOpenMenu, onNewView, T,
}) {
  return (
    <>
      {definitions.map(definition => {
        const active = definition.id === activeId;
        if (renamingId === definition.id) {
          return (
            <input
              key={definition.id}
              autoFocus
              aria-label="View name"
              value={renameValue}
              onChange={onRenameInput}
              onKeyDown={onRenameKey}
              onBlur={onRenameEnd}
              style={{
                height: 28, width: 148, padding: '0 9px',
                borderRadius: DS_RADIUS.control,
                border: `1px solid ${T.accent}`,
                background: T.bg, color: T.ink,
                fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600,
                outline: 'none',
              }}
            />
          );
        }
        return (
          <React.Fragment key={definition.id}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onPick(definition.id)}
              style={mnViewTabStyle(active, T)}>
              <span>{definition.title || 'Untitled view'}</span>
              <span style={{ ...dsMachineStyle(T, active ? T.inkMed : T.inkDim), fontSize: 10.5 }}>
                {counts[definition.id] ?? ''}
              </span>
            </button>
            {active && (
              <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                type="button"
                title="Rename, duplicate or delete"
                aria-label="View options"
                aria-expanded={Boolean(menu)}
                onClick={onOpenMenu}
                style={{
                  height: 28, width: 22, padding: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '0 8px 8px 0',
                  border: `1px solid ${T.selLine}`, borderLeft: 'none',
                  background: T.selBg, color: T.inkMed, cursor: 'pointer',
                }}>
                <Caret T={T} />
              </button>
              {menu}
              </span>
            )}
          </React.Fragment>
        );
      })}
      <button
        type="button"
        title="New view"
        aria-label="New view"
        onClick={onNewView}
        style={{
          height: 28, width: 28, padding: 0, marginLeft: 4,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: DS_RADIUS.control,
          border: `1px dashed ${T.line}`,
          background: 'transparent', color: T.inkMed, cursor: 'pointer',
        }}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M6 2V10M2 6H10" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}

function ViewsRowSearch({ value, onChange, onClear, T }) {
  return (
    <div style={{
      width: 176, height: 28, flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px',
      borderRadius: DS_RADIUS.control,
      background: T.bg, border: `1px solid ${T.lineSub}`,
    }}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={T.inkDim} strokeWidth="1.4" aria-hidden="true">
        <circle cx="7" cy="7" r="4" /><path d="M10 10L13.5 13.5" strokeLinecap="round" />
      </svg>
      <input
        aria-label="Search these rows"
        placeholder="Search these rows"
        value={value}
        onChange={onChange}
        style={{
          flex: 1, minWidth: 0, border: 'none', background: 'transparent',
          fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.ink, outline: 'none',
        }}
      />
      {!!value && (
        <button type="button" title="Clear" aria-label="Clear row search" onClick={onClear} style={{
          width: 18, height: 18, padding: 0, borderRadius: 5,
          border: 'none', background: 'transparent', color: T.inkDim, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M3 3L9 9M9 3L3 9" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

// The definition is the thing being edited, so its state is stated plainly
// rather than left to be inferred from whether a button is enabled.
function ViewsSaveState({ dirty, onRevert, onSave, T }) {
  if (!dirty) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        height: 26, padding: '0 10px', borderRadius: DS_RADIUS.pill,
        background: T.bgSub, border: `1px solid ${T.lineSub}`,
        fontSize: 11.5, color: T.inkMed, whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.success || T.accent }} />
        Saved
      </span>
    );
  }
  const action = (label, primary, onClick) => (
    <button type="button" onClick={onClick} style={{
      height: 26, padding: '0 10px', borderRadius: DS_RADIUS.control,
      border: primary ? 'none' : `1px solid ${T.lineSub}`,
      background: primary ? T.ink : T.bg,
      color: primary ? T.bg : T.inkMed,
      fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: primary ? 600 : 400,
      cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{label}</button>
  );
  return (
    <>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        height: 26, padding: '0 10px', borderRadius: DS_RADIUS.pill,
        background: `color-mix(in oklab, ${T.warn} 14%, ${T.bg})`,
        border: `1px solid color-mix(in oklab, ${T.warn} 45%, ${T.lineSub})`,
        fontSize: 11.5, color: T.inkMed, whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.warn }} />
        Unsaved changes
      </span>
      {action('Revert', false, onRevert)}
      {action('Save view', true, onSave)}
    </>
  );
}

export { ViewTabs, ViewMenu, ViewsRowSearch, ViewsSaveState, Caret, mnViewTabStyle, mnViewChipStyle };
