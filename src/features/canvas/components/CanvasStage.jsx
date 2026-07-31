import { MnCanvasResizeHandles } from './CanvasControls.jsx';
import { MnCanvasElement } from './CanvasElements.jsx';
import { mnCanvasStageBackground } from './CanvasStyles.js';
import MN_CANVAS_MODEL from '../../../canvas/canvasModel.js';

const { mnCanvasBounds, mnCanvasIsConnector, mnCanvasResolveConnector } = MN_CANVAS_MODEL;

function CanvasStage({
  svgRef,
  onStageDown,
  onPointerMove,
  finishPointerAction,
  onWheel,
  spaceDown,
  tool,
  viewport,
  elements,
  elementById,
  noteById,
  showSelectionUi,
  selectedIds,
  onElementDown,
  onOpenNote,
  editText,
  selectionBounds,
  selectedElement,
  onResizeDown,
  marquee,
  T,
}) {
  return (
    <svg
      ref={svgRef}
      data-mn-canvas-stage="true"
      onPointerDown={onStageDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointerAction}
      onPointerCancel={finishPointerAction}
      onPointerLeave={finishPointerAction}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={onWheel}
      width="100%"
      height="100%"
      style={{
        display: 'block',
        cursor: spaceDown ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'not-allowed' : 'crosshair',
        background: mnCanvasStageBackground(T, 28),
      }}>
      <g transform={`translate(${viewport.x || 0} ${viewport.y || 0}) scale(${viewport.scale || 1})`}>
        {(elements || []).map(el => {
          const anchored = mnCanvasIsConnector?.(el) && (el.startAnchorId || el.endAnchorId) && mnCanvasResolveConnector;
          const display = anchored ? { ...el, ...mnCanvasResolveConnector(el, elementById) } : el;
          return (
            <MnCanvasElement
              key={el.id}
              element={display}
              note={el.type === 'note' ? noteById.get(el.noteId) : null}
              selected={showSelectionUi && selectedIds.includes(el.id)}
              onPointerDown={(e) => onElementDown(e, el)}
              onDoubleClick={() => (el.type === 'note' ? (onOpenNote && onOpenNote(el.noteId)) : editText(el))}
              T={T}
            />
          );
        })}
        {showSelectionUi && selectedIds.length > 1 && selectionBounds && (
          <rect
            x={selectionBounds.x - 6}
            y={selectionBounds.y - 6}
            width={selectionBounds.w + 12}
            height={selectionBounds.h + 12}
            fill="none"
            stroke={T.accent}
            strokeDasharray="5 4"
            strokeWidth="1.2"
            pointerEvents="none"
          />
        )}
        {showSelectionUi && selectedIds.length === 1 && selectedElement && !['line', 'arrow', 'pen'].includes(selectedElement.type) && (
          <MnCanvasResizeHandles bounds={mnCanvasBounds(selectedElement)} onPointerDown={onResizeDown} T={T} />
        )}
        {marquee && (
          <rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
            fill={`color-mix(in oklab, ${T.accent} 10%, transparent)`}
            stroke={T.accent}
            strokeDasharray="4 3"
            strokeWidth="1"
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}

export { CanvasStage };
