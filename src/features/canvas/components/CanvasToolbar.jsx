// The thinking board header: one 52px row, as the prototype draws it
// (prototype.html:749) — back, title, one machine value, then the actions.
//
// It used to be this row plus a second shelf band. The tools, style controls
// and zoom all moved onto the board itself, which left the shelf carrying two
// buttons and an empty bordered group that rendered as a stray circle. The
// band is gone; what is left of it lives here.

import { DS_HEIGHT, DS_RADIUS, dsMachineStyle } from '../../../shared/designSystem.js';
import { MnCanvasActionButton } from './CanvasControls.jsx';
import { mnCanvasHeaderButton, mnCanvasToolbarMoreSlot, mnCanvasMoreMenu, mnCanvasMoreMenuSection, mnCanvasMoreMenuLabel, mnCanvasMoreMenuGrid } from './CanvasStyles.js';

function CanvasToolbar({
  T,
  saveTitle,
  onBack,
  draft,
  updateDraft,
  setTitleFocused,
  canvas,
  selectedIds,
  setDeleteDialogOpen,
  undoCanvas,
  canUndo,
  canRedo,
  redoCanvas,
  toolbarMenuRef,
  setToolbarMenuOpen,
  toolbarMenuOpen,
  runToolbarMenuCommand,
  alignSelected,
  distributeSelected,
  currentSelectionIds,
  copyElements,
  pasteElements,
  removeElements,
}) {
  const objectCount = (draft.elements || []).length;
  return (
    <div style={{
      height: DS_HEIGHT.panelHeader,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '0 20px',
      borderBottom: `1px solid ${T.line}`,
    }}>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { saveTitle(); onBack && onBack(); }}
        title="Back to canvases"
        aria-label="Back to canvases"
        style={{ ...mnCanvasHeaderButton(T), border: `1px solid ${T.lineSub}`, background: T.bg }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M10 3L5 8L10 13" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <input
        value={draft.title || ''}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => updateDraft(prev => ({ ...prev, title: e.target.value }), false)}
        onBlur={() => { setTitleFocused(false); saveTitle(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            updateDraft(prev => ({ ...prev, title: canvas.title || 'Untitled canvas' }), false);
            e.currentTarget.blur();
          }
        }}
        style={{
          width: 260,
          maxWidth: '32vw',
          border: '1px solid transparent',
          borderRadius: DS_RADIUS.icon,
          outline: 'none',
          background: 'transparent',
          color: T.ink,
          fontFamily: 'var(--mn-ui)',
          fontSize: 15,
          fontWeight: 600,
          padding: '4px 7px',
        }}
        onFocus={e => {
          setTitleFocused(true);
          e.currentTarget.style.background = T.bg;
          e.currentTarget.style.borderColor = T.lineSub;
        }}
        onBlurCapture={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = 'transparent';
        }}
      />
      {/* One machine value, as the frame has it: what is here and what is
          picked, rather than two pills saying half each. */}
      <span style={{ ...dsMachineStyle(T), fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>
        {objectCount} object{objectCount === 1 ? '' : 's'}
        {selectedIds.length ? ` · ${selectedIds.length} selected` : ''}
      </span>
      <span style={{ flex: 1 }} />
      <MnCanvasActionButton icon="undo" label="Undo" onClick={undoCanvas} disabled={!canUndo} T={T} size={DS_HEIGHT.toolbar} />
      <MnCanvasActionButton icon="redo" label="Redo" onClick={redoCanvas} disabled={!canRedo} T={T} size={DS_HEIGHT.toolbar} />
      <div ref={toolbarMenuRef} style={mnCanvasToolbarMoreSlot()}>
        <MnCanvasActionButton
          icon="more"
          label="More canvas tools"
          onClick={() => setToolbarMenuOpen(value => !value)}
          expanded={toolbarMenuOpen}
          hasPopup
          size={DS_HEIGHT.toolbar}
          T={T}
        />
        {toolbarMenuOpen && (
          <div role="menu" aria-label="More canvas tools" style={mnCanvasMoreMenu(T)}>
            <div style={mnCanvasMoreMenuSection(T)}>
              <div style={mnCanvasMoreMenuLabel(T)}>Arrange</div>
              <div style={mnCanvasMoreMenuGrid()}>
                <MnCanvasActionButton icon="align-left" label="Align left" onClick={() => runToolbarMenuCommand(() => alignSelected('left'))} disabled={selectedIds.length < 2} T={T} />
                <MnCanvasActionButton icon="align-center" label="Align center" onClick={() => runToolbarMenuCommand(() => alignSelected('center-x'))} disabled={selectedIds.length < 2} T={T} />
                <MnCanvasActionButton icon="align-right" label="Align right" onClick={() => runToolbarMenuCommand(() => alignSelected('right'))} disabled={selectedIds.length < 2} T={T} />
                <MnCanvasActionButton icon="align-top" label="Align top" onClick={() => runToolbarMenuCommand(() => alignSelected('top'))} disabled={selectedIds.length < 2} T={T} />
                <MnCanvasActionButton icon="align-middle" label="Align middle" onClick={() => runToolbarMenuCommand(() => alignSelected('center-y'))} disabled={selectedIds.length < 2} T={T} />
                <MnCanvasActionButton icon="align-bottom" label="Align bottom" onClick={() => runToolbarMenuCommand(() => alignSelected('bottom'))} disabled={selectedIds.length < 2} T={T} />
                <MnCanvasActionButton icon="distribute-x" label="Distribute horizontally" onClick={() => runToolbarMenuCommand(() => distributeSelected('x'))} disabled={selectedIds.length < 3} T={T} />
                <MnCanvasActionButton icon="distribute-y" label="Distribute vertically" onClick={() => runToolbarMenuCommand(() => distributeSelected('y'))} disabled={selectedIds.length < 3} T={T} />
              </div>
            </div>
            <div style={mnCanvasMoreMenuSection(T)}>
              <div style={mnCanvasMoreMenuLabel(T)}>Clipboard</div>
              <div style={mnCanvasMoreMenuGrid()}>
                <MnCanvasActionButton icon="cut" label="Cut" onClick={() => runToolbarMenuCommand(() => selectedIds.length && copyElements(currentSelectionIds(), true))} disabled={!selectedIds.length} T={T} />
                <MnCanvasActionButton icon="copy" label="Copy" onClick={() => runToolbarMenuCommand(() => copyElements())} disabled={!selectedIds.length} T={T} />
                <MnCanvasActionButton icon="paste" label="Paste" onClick={() => runToolbarMenuCommand(() => pasteElements())} T={T} />
                <MnCanvasActionButton icon="trash" label="Delete" onClick={() => runToolbarMenuCommand(() => removeElements(currentSelectionIds()))} disabled={!selectedIds.length} T={T} tone="danger" />
              </div>
            </div>
            {/* Deleting the whole board is destructive, so it sits behind this
                menu rather than as a red button on the header row. */}
            <div style={{ ...mnCanvasMoreMenuSection(T), paddingBottom: 0, borderBottom: 'none' }}>
              <div style={mnCanvasMoreMenuLabel(T)}>Canvas</div>
              <button
                type="button"
                onClick={() => runToolbarMenuCommand(() => setDeleteDialogOpen(true))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  height: DS_HEIGHT.primary, padding: '0 8px',
                  border: '1px solid transparent', borderRadius: DS_RADIUS.control,
                  background: 'transparent', color: T.danger, cursor: 'pointer',
                  fontFamily: 'var(--mn-ui)', fontSize: 12.5, textAlign: 'left',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = T.bgHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
                  <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round" />
                </svg>
                Delete canvas
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { CanvasToolbar };
