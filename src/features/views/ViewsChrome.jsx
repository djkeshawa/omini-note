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
// Rename, duplicate and delete are the next step; the caret says so rather
// than pretending. Nothing here is drawn that cannot yet be used.

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

function Caret({ T }) {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ViewTabs({ definitions, activeId, counts, onPick, onOpenMenu, onNewView, T }) {
  return (
    <>
      {definitions.map(definition => {
        const active = definition.id === activeId;
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
              <button
                type="button"
                title="Rename, duplicate or delete"
                aria-label="View options"
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

export { ViewTabs, ViewsRowSearch, ViewsSaveState, Caret, mnViewTabStyle, mnViewChipStyle };
