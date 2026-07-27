// Zoom, pinned to the bottom-right of the board.
//
// The level is a machine value, so it is set in mono and given a fixed width —
// the buttons either side must not shift as it changes.

function ZoomButton({ label, onClick, disabled, children, T }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 26, height: 26, borderRadius: 7, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', background: 'transparent', color: T.inkMed,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={event => { if (!disabled) event.currentTarget.style.background = T.bgHover; }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
      {children}
    </button>
  );
}

function CanvasZoomCluster({ scale = 1, onZoomIn, onZoomOut, onFit, fitDisabled = false, T }) {
  return (
    <div
      data-mn-canvas-zoom="true"
      style={{
        position: 'absolute', right: 18, bottom: 18, zIndex: 4,
        height: 34, display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px',
        borderRadius: DS_RADIUS.row,
        background: T.bgElevated || T.bg,
        border: `1px solid ${T.lineSub}`,
        boxShadow: `0 8px 22px color-mix(in oklab, ${T.ink} 9%, transparent)`,
      }}>
      <ZoomButton label="Zoom out" onClick={onZoomOut} T={T}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M4 8h8" strokeLinecap="round" />
        </svg>
      </ZoomButton>
      <span style={{
        minWidth: 44, textAlign: 'center',
        fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkMed,
      }}>{Math.round((scale || 1) * 100)}%</span>
      <ZoomButton label="Zoom in" onClick={onZoomIn} T={T}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M8 4v8M4 8h8" strokeLinecap="round" />
        </svg>
      </ZoomButton>
      <span aria-hidden="true" style={{ width: 1, height: 18, background: T.lineSub, margin: '0 4px' }} />
      <ZoomButton label="Fit to screen (Shift+1)" onClick={onFit} disabled={fitDisabled} T={T}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M6 2.5H2.5V6M10 2.5H13.5V6M6 13.5H2.5V10M10 13.5H13.5V10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ZoomButton>
    </div>
  );
}

export { CanvasZoomCluster };
import { DS_RADIUS } from '../../../shared/designSystem.js';
