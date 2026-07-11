import { MnCanvasToolButton, MnCanvasActionButton, MnCanvasColorControl, MnCanvasDivider, MnCanvasStatusPill } from './CanvasControls.jsx';
import { mnCanvasIconButton, mnCanvasToolbarGroup, mnCanvasToolbarShelf, mnCanvasToolbarRow, mnCanvasToolbarMoreSlot, mnCanvasMoreMenu, mnCanvasMoreMenuSection, mnCanvasMoreMenuLabel, mnCanvasMoreMenuGrid } from './CanvasStyles.js';
const { MN_CANVAS_TOOLS } = window.MN_CANVAS_MODEL || {};

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
  tool,
  setTool,
  notes,
  notePickerOpen,
  setNotePickerOpen,
  activeStroke,
  applyColor,
  activeFill,
  activeStrokeWidth,
  applyStrokeWidth,
  undoCanvas,
  historyIndex,
  history,
  redoCanvas,
  fitToScreen,
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
  return (
<div style={{
        borderBottom: `1px solid ${T.line}`,
        background: `color-mix(in oklab, ${T.bg} 94%, ${T.bgSub})`,
        boxShadow: `0 1px 0 color-mix(in oklab, ${T.bg} 84%, white) inset`,
      }}>
        <div style={{
          minHeight: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          // Right inset keeps the "Delete canvas" button clear of the floating
          // reminder bell (fixed at top:14, right:18) in the top-right corner.
          padding: '9px 60px 7px 18px',
        }}>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { saveTitle(); onBack && onBack(); }}
            title="Back to canvases"
            aria-label="Back to canvases"
            style={mnCanvasIconButton(T)}>
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
              width: 330,
              maxWidth: '38vw',
              border: '1px solid transparent',
              borderRadius: 6,
              outline: 'none',
              background: 'transparent',
              color: T.ink,
              fontFamily: 'var(--mn-ui)',
              fontSize: 16,
              fontWeight: 700,
              padding: '5px 7px',
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
          <MnCanvasStatusPill T={T}>{(draft.elements || []).length} object{(draft.elements || []).length === 1 ? '' : 's'}</MnCanvasStatusPill>
          <MnCanvasStatusPill T={T}>{selectedIds.length ? `${selectedIds.length} selected` : 'No selection'}</MnCanvasStatusPill>
          <div style={{ flex: 1 }} />
          <MnCanvasActionButton icon="canvas-trash" label="Delete canvas" onClick={() => setDeleteDialogOpen(true)} T={T} tone="danger" />
        </div>
        <div style={mnCanvasToolbarShelf()}>
          <div style={mnCanvasToolbarRow()}>
            <div style={mnCanvasToolbarGroup(T)}>
              {MN_CANVAS_TOOLS.map(item => (
                <MnCanvasToolButton
                  key={item.id}
                  tool={item}
                  active={tool === item.id}
                  onClick={() => setTool(item.id)}
                  T={T}
                />
              ))}
              {(notes || []).length > 0 && (
                <MnCanvasToolButton
                  tool={{ id: 'note', label: 'Note card' }}
                  active={notePickerOpen}
                  onClick={() => setNotePickerOpen(v => !v)}
                  T={T}
                />
              )}
            </div>
            <div style={mnCanvasToolbarGroup(T)}>
              <MnCanvasColorControl label="Stroke" value={activeStroke} onChange={(v) => applyColor('stroke', v)} T={T} />
              <MnCanvasColorControl label="Fill" value={activeFill === 'transparent' ? '#ffffff' : activeFill} onChange={(v) => applyColor('fill', v)} T={T} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
                Width
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={activeStrokeWidth}
                  onChange={(e) => applyStrokeWidth(e.target.value)}
                  style={{ width: 74, accentColor: T.accent }}
                />
              </label>
            </div>
            <div style={mnCanvasToolbarGroup(T)}>
              <MnCanvasActionButton icon="undo" label="Undo" onClick={undoCanvas} disabled={!canUndo} T={T} />
              <MnCanvasActionButton icon="redo" label="Redo" onClick={redoCanvas} disabled={!canRedo} T={T} />
              <MnCanvasDivider T={T} />
              <MnCanvasActionButton icon="zoom-out" label="Zoom out" onClick={() => setZoom((viewport.scale || 1) - 0.15)} T={T} />
              <span style={{ minWidth: 42, textAlign: 'center', fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                {Math.round((viewport.scale || 1) * 100)}%
              </span>
              <MnCanvasActionButton icon="zoom-in" label="Zoom in" onClick={() => setZoom((viewport.scale || 1) + 0.15)} T={T} />
              <MnCanvasActionButton icon="fit" label="Fit to screen (Shift+1)" onClick={fitToScreen} disabled={!(draft.elements || []).length} T={T} />
            </div>
          </div>
          <div ref={toolbarMenuRef} style={mnCanvasToolbarMoreSlot()}>
            <MnCanvasActionButton
              icon="more"
              label="More canvas tools"
              onClick={() => setToolbarMenuOpen(value => !value)}
              expanded={toolbarMenuOpen}
              hasPopup
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
                <div style={{ ...mnCanvasMoreMenuSection(T), paddingBottom: 0, borderBottom: 'none' }}>
                  <div style={mnCanvasMoreMenuLabel(T)}>Clipboard</div>
                  <div style={mnCanvasMoreMenuGrid()}>
                    <MnCanvasActionButton icon="cut" label="Cut" onClick={() => runToolbarMenuCommand(() => selectedIds.length && copyElements(currentSelectionIds(), true))} disabled={!selectedIds.length} T={T} />
                    <MnCanvasActionButton icon="copy" label="Copy" onClick={() => runToolbarMenuCommand(() => copyElements())} disabled={!selectedIds.length} T={T} />
                    <MnCanvasActionButton icon="paste" label="Paste" onClick={() => runToolbarMenuCommand(() => pasteElements())} T={T} />
                    <MnCanvasActionButton icon="trash" label="Delete" onClick={() => runToolbarMenuCommand(() => removeElements(currentSelectionIds()))} disabled={!selectedIds.length} T={T} tone="danger" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}

export { CanvasToolbar };
