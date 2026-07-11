import { MnCanvasContextMenu } from './CanvasControls.jsx';

import MN_CANVAS_MODEL from '../../../canvas/canvasModel.js';
const { MN_CANVAS_TOOLS } = MN_CANVAS_MODEL;

function CanvasOverlays({
  editingElement,
  editingOrigin,
  updateElementById,
  setEditingTextId,
  persistCanvas,
  draftRef,
  viewport,
  T,
  tool,
  contextMenu,
  copyElements,
  currentSelectionIds,
  pasteElements,
  removeElements,
  setContextMenu,
}) {
  return (
    <>
{editingElement && editingOrigin && (
          <textarea
            autoFocus
            value={editingElement.text || ''}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => updateElementById(editingElement.id, { text: e.target.value }, false)}
            onBlur={() => {
              setEditingTextId(null);
              persistCanvas(draftRef.current, { history: false });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditingTextId(null);
                persistCanvas(draftRef.current, { history: false });
              }
              if (editingElement.type === 'text' && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            style={{
              position: 'absolute',
              left: editingOrigin.x,
              top: editingOrigin.y,
              width: Math.max(80, (editingElement.w || 160) * (viewport.scale || 1)),
              height: Math.max(42, (editingElement.h || 60) * (viewport.scale || 1)),
              resize: 'none',
              border: `1px solid ${T.accent}`,
              borderRadius: editingElement.type === 'sticky' ? 7 : 4,
              outline: 'none',
              padding: editingElement.type === 'sticky' ? 9 : 3,
              background: editingElement.type === 'sticky' ? (editingElement.fill || '#fef3c7') : T.bg,
              color: editingElement.stroke || T.ink,
              fontFamily: editingElement.type === 'text' ? 'var(--mn-body)' : 'var(--mn-ui)',
              fontSize: (editingElement.type === 'text' ? 18 : 13) * (viewport.scale || 1),
              lineHeight: 1.35,
              // Above floating notifications (toast zIndex 50) so an active
              // text edit is never painted over.
              zIndex: 60,
              boxShadow: `0 10px 26px color-mix(in oklab, ${T.ink} 14%, transparent)`,
            }}
          />
        )}
        <div style={{
          position: 'absolute',
          left: 16,
          bottom: 14,
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          color: T.inkDim,
          background: `color-mix(in oklab, ${T.bg} 88%, transparent)`,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 999,
          padding: '5px 9px',
          pointerEvents: 'none',
          boxShadow: `0 8px 22px color-mix(in oklab, ${T.ink} 7%, transparent)`,
        }}>{MN_CANVAS_TOOLS.find(item => item.id === tool)?.label || 'Select'} · {Math.round((viewport.scale || 1) * 100)}%</div>
        {contextMenu && (
          <MnCanvasContextMenu
            menu={contextMenu}
            canPaste={true}
            onCopy={() => copyElements(contextMenu.ids || (contextMenu.id ? [contextMenu.id] : currentSelectionIds()))}
            onCut={() => copyElements(contextMenu.ids || (contextMenu.id ? [contextMenu.id] : currentSelectionIds()), true)}
            onPaste={pasteElements}
            onDelete={() => removeElements(contextMenu.ids || (contextMenu.id ? [contextMenu.id] : []))}
            onClose={() => setContextMenu(null)}
            T={T}
          />
        )}
    </>
  );
}

export { CanvasOverlays };
