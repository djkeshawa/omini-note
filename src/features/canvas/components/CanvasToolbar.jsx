import { DS_HEIGHT, dsMachineStyle } from '../../../shared/designSystem.js';
import { MnCanvasToolButton, MnCanvasActionButton, MnCanvasDivider, MnCanvasStatusPill } from './CanvasControls.jsx';
import { mnCanvasIconButton, mnCanvasToolbarGroup, mnCanvasToolbarShelf, mnCanvasToolbarRow, mnCanvasToolbarMoreSlot, mnCanvasMoreMenu, mnCanvasMoreMenuSection, mnCanvasMoreMenuLabel, mnCanvasMoreMenuGrid } from './CanvasStyles.js';
import MN_CANVAS_MODEL from '../../../canvas/canvasModel.js';
const { MN_CANVAS_TOOLS } = MN_CANVAS_MODEL;

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
  canUndo,
  canRedo,
  redoCanvas,
  setZoom,
  viewport,
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
          height: DS_HEIGHT.panelHeader,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 20px',
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
            {(draft.elements || []).length} object{(draft.elements || []).length === 1 ? '' : 's'}
            {selectedIds.length ? ` · ${selectedIds.length} selected` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <MnCanvasActionButton icon="canvas-trash" label="Delete canvas" onClick={() => setDeleteDialogOpen(true)} T={T} tone="danger" />
        </div>
        <div style={mnCanvasToolbarShelf()}>
          <div style={mnCanvasToolbarRow()}>
            {/* Tools moved to the floating dock on the board itself; the
                shelf keeps the style controls that act on a selection. */}
            <div style={mnCanvasToolbarGroup(T)}>
            </div>
            {/* Stroke, fill and width moved to the contextual style bar on
                the board, where they appear against the selection they act on. */}
            <div style={mnCanvasToolbarGroup(T)}>
              <MnCanvasActionButton icon="undo" label="Undo" onClick={undoCanvas} disabled={!canUndo} T={T} />
              <MnCanvasActionButton icon="redo" label="Redo" onClick={redoCanvas} disabled={!canRedo} T={T} />
              {/* Zoom moved to its own cluster at the bottom-right of the
                  board, next to the thing it scales. */}
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
