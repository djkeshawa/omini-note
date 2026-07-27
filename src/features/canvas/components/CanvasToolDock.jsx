// The floating tool dock, from the prototype's thinking board: a 44px column
// pinned to the left edge of the board and centred vertically, rather than a
// row of buttons in a shelf above it.
//
// It sits on the board because the board is what it acts on — reaching for a
// tool should not mean leaving the drawing.

function CanvasToolDock({ tools = [], tool, onSelect, extra = null, T }) {
  return (
    <div
      data-mn-canvas-tool-dock="true"
      role="toolbar"
      aria-label="Canvas tools"
      style={{
        position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)',
        width: 44, padding: 6, zIndex: 4,
        borderRadius: 14,
        background: T.bgElevated || T.bg,
        border: `1px solid ${T.lineSub}`,
        boxShadow: `0 12px 32px color-mix(in oklab, ${T.ink} 12%, transparent)`,
        display: 'flex', flexDirection: 'column', gap: 3,
      }}>
      {tools.map(item => (
        <React.Fragment key={item.id}>
          {item.divider && (
            <span aria-hidden="true" style={{
              height: 1, background: T.lineSub, margin: '3px 5px',
            }} />
          )}
          <button
            type="button"
            title={item.key ? `${item.label} (${item.key})` : item.label}
            aria-label={item.label}
            aria-pressed={tool === item.id}
            onClick={() => onSelect?.(item.id)}
            style={{
              width: 32, height: 32, borderRadius: 9, padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${tool === item.id ? T.accent : T.lineSub}`,
              background: tool === item.id ? T.selBg : 'transparent',
              color: tool === item.id ? T.accent : T.inkMed,
            }}
            onMouseEnter={event => {
              if (tool !== item.id) event.currentTarget.style.background = T.bgHover;
            }}
            onMouseLeave={event => {
              if (tool !== item.id) event.currentTarget.style.background = 'transparent';
            }}>
            <MnCanvasToolIcon id={item.id} />
          </button>
        </React.Fragment>
      ))}
      {extra}
    </div>
  );
}

export { CanvasToolDock };
import { MnCanvasToolIcon } from './CanvasControls.jsx';
