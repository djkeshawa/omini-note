// The contextual style bar, from the prototype's thinking board.
//
// It is contextual in the strict sense: it appears when something is selected
// and describes that selection. Nothing is selected, nothing to style, so the
// board stays clear.
//
// Colours come from the canvas model's own palette — the first six are strokes
// and the last four fills, which is how the prototype splits them too.

function Swatch({ color, active, onClick, label, T }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      style={{
        width: 22, height: 22, borderRadius: 7, padding: 0, cursor: 'pointer',
        background: color,
        border: `1px solid ${T.lineSub}`,
        boxShadow: active
          ? `0 0 0 1.5px ${T.accent}, 0 0 0 3px ${T.bgElevated || T.bg}`
          : 'none',
      }}
    />
  );
}

// The prototype shows a fixed palette. The app had a full colour picker, so
// each row keeps one custom swatch rather than losing arbitrary colour.
function CustomSwatch({ value, onChange, label, T }) {
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 7, overflow: 'hidden', position: 'relative',
      border: `1px dashed ${T.line}`, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <input
        type="color"
        aria-label={label}
        title={label}
        value={value}
        onChange={event => onChange?.(event.target.value)}
        style={{
          position: 'absolute', inset: -4, width: 30, height: 30,
          border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
        }}
      />
    </span>
  );
}

function BarDivider({ T }) {
  return <span aria-hidden="true" style={{ width: 1, height: 22, background: T.lineSub, margin: '0 6px' }} />;
}

function BarLabel({ children, T, style }) {
  return (
    <span style={{ fontSize: 11.5, color: T.inkDim, whiteSpace: 'nowrap', ...style }}>{children}</span>
  );
}

function BarButton({ label, onClick, disabled, tone = 'default', children, T }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 28, height: 28, borderRadius: DS_RADIUS.control, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${T.lineSub}`,
        background: T.bgElevated || T.bg,
        color: tone === 'danger' ? T.danger : T.inkMed,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}>
      {children}
    </button>
  );
}

function CanvasStyleBar({
  strokeColors = [], fillColors = [],
  activeStroke, activeFill, activeStrokeWidth,
  applyColor, applyStrokeWidth,
  selectedIds = [], alignSelected, removeElements, T,
}) {
  if (!selectedIds.length) return null;
  const canAlign = selectedIds.length > 1;

  return (
    <div
      data-mn-canvas-style-bar="true"
      role="toolbar"
      aria-label="Selection style"
      style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 18,
        minHeight: 44, zIndex: 4,
        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px',
        borderRadius: DS_RADIUS.panel,
        background: T.bgElevated || T.bg,
        border: `1px solid ${T.lineSub}`,
        boxShadow: `0 12px 32px color-mix(in oklab, ${T.ink} 12%, transparent)`,
        // 44px on a board with room. On a narrow one it wraps to a second row
        // rather than scrolling — a hidden control is a lost control.
        maxWidth: 'calc(100% - 120px)', flexWrap: 'wrap', rowGap: 6,
      }}>
      <BarLabel T={T} style={{ padding: '0 6px 0 4px' }}>Stroke</BarLabel>
      {strokeColors.map(color => (
        <Swatch
          key={color}
          color={color}
          label={`Stroke ${color}`}
          active={activeStroke === color}
          onClick={() => applyColor?.('stroke', color)}
          T={T}
        />
      ))}

      <CustomSwatch
        value={activeStroke}
        label="Custom stroke colour"
        onChange={value => applyColor?.('stroke', value)}
        T={T}
      />

      <BarDivider T={T} />
      <BarLabel T={T} style={{ paddingRight: 4 }}>Fill</BarLabel>
      {fillColors.map(color => (
        <Swatch
          key={color}
          color={color}
          label={`Fill ${color}`}
          active={activeFill === color}
          onClick={() => applyColor?.('fill', color)}
          T={T}
        />
      ))}

      <CustomSwatch
        value={activeFill === 'transparent' ? '#ffffff' : activeFill}
        label="Custom fill colour"
        onChange={value => applyColor?.('fill', value)}
        T={T}
      />

      <BarDivider T={T} />
      <BarLabel T={T} style={{ paddingRight: 6 }}>Width</BarLabel>
      <input
        type="range"
        min="1"
        max="10"
        aria-label="Stroke width"
        value={activeStrokeWidth}
        onChange={event => applyStrokeWidth?.(event.target.value)}
        style={{ width: 64, height: 4, accentColor: T.accent }}
      />

      <BarDivider T={T} />
      {/* Align was buried in the ⋯ menu. It only means anything with a
          selection, which is exactly when this bar is on screen. */}
      <BarButton label="Align left" disabled={!canAlign} onClick={() => alignSelected?.('left')} T={T}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M3 2.5v11" strokeLinecap="round" /><rect x="5.5" y="4" width="7.5" height="3" rx="1" /><rect x="5.5" y="9" width="5" height="3" rx="1" />
        </svg>
      </BarButton>
      <BarButton label="Align centre" disabled={!canAlign} onClick={() => alignSelected?.('center-x')} T={T}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M8 2.5v11" strokeLinecap="round" /><rect x="3" y="4" width="10" height="3" rx="1" /><rect x="4.5" y="9" width="7" height="3" rx="1" />
        </svg>
      </BarButton>
      <BarButton label="Align right" disabled={!canAlign} onClick={() => alignSelected?.('right')} T={T}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M13 2.5v11" strokeLinecap="round" /><rect x="3" y="4" width="7.5" height="3" rx="1" /><rect x="5.5" y="9" width="5" height="3" rx="1" />
        </svg>
      </BarButton>
      <BarButton label={`Delete ${selectedIds.length === 1 ? 'object' : `${selectedIds.length} objects`}`} tone="danger" onClick={() => removeElements?.(selectedIds)} T={T}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round" />
        </svg>
      </BarButton>
    </div>
  );
}

export { CanvasStyleBar };
import { DS_RADIUS } from '../../../shared/designSystem.js';
