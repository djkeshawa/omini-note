// The graph's floating control panel.
//
// Lifted out of graph.jsx so the panel file stays a graph rather than a graph
// plus a settings pane, and so the panel keeps room to grow under its
// no-growth line budget.
//
// Row, Toggle and Range are module scope on purpose. Declared inside
// MnGraphControls they were a new component type on every render, so React
// tore down and rebuilt the inputs — dragging a slider was dropped after the
// first step, and a checkbox lost focus on click. The simulation re-renders
// this panel constantly, so it hit every frame.

import { mnShadow } from '../shared/theme.jsx';

function Row({ id, title, children, open, toggle, T }) {
  return (
    <div>
      <button onClick={() => toggle(id)} style={{
        width: '100%', height: 38,
        border: 'none', background: 'transparent',
        display: 'flex', alignItems: 'center',
        padding: '0 12px',
        fontFamily: 'var(--mn-ui)', fontSize: 13.5,
        fontWeight: 600,
        color: T.ink, cursor: 'pointer',
        textAlign: 'left',
      }}>
        <span style={{ flex: 1 }}>{title}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{
          transform: open[id] ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 120ms ease',
          color: T.ink,
        }}>
          <path d="M3 1.5L7 5L3 8.5Z" fill="currentColor" />
        </svg>
      </button>
      {open[id] && (
        <div style={{
          padding: '0 12px 12px',
          fontFamily: 'var(--mn-ui)', fontSize: 12,
          color: T.inkMed,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 0', cursor: 'pointer',
    }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Range({ label, min, max, step, value, onChange, T }) {
  return (
    <label style={{ display: 'block', padding: '7px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'var(--mn-mono)', color: T.inkDim }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </label>
  );
}

function MnGraphControls({
  pinnedCount = 0, onUnpinAll, onFit,
  T, open, setOpen, opts, setOpt,
  notesCount, edgesCount, onReset, onExportSvg,
}) {
  const toggle = (key) => setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  return (
    <div style={{
      position: 'absolute',
      top: 22,
      right: 64,
      width: 190,
      zIndex: 3,
      background: `color-mix(in oklab, ${T.bgElevated || T.bg} 90%, transparent)`,
      border: `1px solid ${T.lineSub}`,
      borderRadius: 6,
      boxShadow: typeof mnShadow === 'function'
        ? mnShadow(T, 'soft')
        : `0 18px 42px color-mix(in oklab, ${T.ink} 12%, transparent)`,
      overflow: 'hidden',
    }}>
      <Row id="nodes" title="Nodes" open={open} toggle={toggle} T={T}>
        <div style={{ marginBottom: 6 }}>{notesCount} visible notes</div>
        <Toggle label="Show labels" value={opts.labels} onChange={(v) => setOpt('labels', v)} />
        <Toggle label="Tag colors" value={opts.tagColors} onChange={(v) => setOpt('tagColors', v)} />
        <Toggle label="Size by content" value={opts.sizeByContent} onChange={(v) => setOpt('sizeByContent', v)} />
      </Row>
      <Row id="forces" title="Forces" open={open} toggle={toggle} T={T}>
        <Range label="Link distance" min="70" max="180" step="1" value={opts.linkDistance} onChange={(v) => setOpt('linkDistance', v)} T={T} />
        <Range label="Repulsion" min="20" max="60" step="1" value={opts.repulsion} onChange={(v) => setOpt('repulsion', v)} T={T} />
        <Range label="Center pull" min="0" max="0.02" step="0.001" value={opts.center} onChange={(v) => setOpt('center', v)} T={T} />
        {/* Without walls a graph can settle past the edges of the pane, so
            there has to be one control that says "show me everything". */}
        <button onClick={onFit} style={{
          marginTop: 6, width: '100%',
          padding: '5px 8px', borderRadius: 5,
          border: `1px solid ${T.line}`, background: T.bg, color: T.inkMed,
          fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
        }}>Fit to view</button>
        {pinnedCount > 0 && (
          <button onClick={onUnpinAll} style={{
            marginTop: 6, width: '100%',
            padding: '5px 8px', borderRadius: 5,
            border: `1px solid ${T.line}`, background: T.bg, color: T.inkMed,
            fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          }}>Release {pinnedCount} pinned</button>
        )}
        <button onClick={onReset} style={{
          marginTop: 6,
          padding: '5px 8px',
          borderRadius: 5,
          border: `1px solid ${T.line}`,
          background: T.bg,
          color: T.inkMed,
          fontFamily: 'var(--mn-ui)',
          fontSize: 12,
          cursor: 'pointer',
        }}>Reset layout</button>
      </Row>
      <Row id="export" title="Export" open={open} toggle={toggle} T={T}>
        <div style={{ marginBottom: 8 }}>{edgesCount} visible links</div>
        <button onClick={onExportSvg} style={{
          padding: '6px 9px',
          borderRadius: 5,
          border: `1px solid ${T.line}`,
          background: T.bg,
          color: T.ink,
          fontFamily: 'var(--mn-ui)',
          fontSize: 12,
          cursor: 'pointer',
        }}>Export SVG</button>
      </Row>
    </div>
  );
}

export { MnGraphControls };
