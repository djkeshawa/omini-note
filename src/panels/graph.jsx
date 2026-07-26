// In-layout knowledge graph for VispNote.
import { DsEmptyState } from '../shared/components/DesignPrimitives.jsx';
import { DS_HEIGHT, DS_RADIUS, dsGroupLabelStyle, dsMachineStyle } from '../shared/designSystem.js';
// Pure JS force simulation, scoped by the existing note-list search/filter.

const { useEffect, useRef, useState, useMemo } = React;

function MnGraph({ notes, links, style, focusId, onOpen, T, tags, theme, graphFilter = null, onGraphFilterChange }) {
  const frameRef = useRef(null);
  const svgRef = useRef(null);
  const rafRef = useRef(null);
  const settledRef = useRef(false);
  const [dims, setDims] = useState({ w: 900, h: 620 });
  const [nodes, setNodes] = useState(null);
  const [edges, setEdges] = useState([]);
  // Only legend the tags that are actually on screen.
  const legendTags = React.useMemo(() => {
    const present = new Set();
    (notes || []).forEach(note => (note.tags || []).forEach(tag => present.add(tag)));
    return (tags || []).filter(tag => present.has(tag.name)).slice(0, 8);
  }, [notes, tags]);
  const [hoverId, setHoverId] = useState(null);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const [panelOpen, setPanelOpen] = useState({ nodes: false, forces: false, export: false });
  const [opts, setOpts] = useState({
    labels: false,
    tagColors: true,
    sizeByContent: true,
    linkDistance: 118,
    repulsion: 34,
    center: 0.005,
  });

  const W = Math.max(560, dims.w);
  const H = Math.max(420, dims.h - 54);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setDims({ w: Math.max(560, r.width), h: Math.max(420, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tagColor = useMemo(() => {
    const map = {};
    tags.forEach(t => { map[t.name] = t.hue; });
    return map;
  }, [tags]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(notes.map(n => n.id));
    return links.filter(l => ids.has(l.source) && ids.has(l.target));
  }, [notes, links]);

  useEffect(() => {
    const linkCounts = {};
    visibleEdges.forEach(l => {
      linkCounts[l.source] = (linkCounts[l.source] || 0) + 1;
      linkCounts[l.target] = (linkCounts[l.target] || 0) + 1;
    });

    const ns = notes.map((n, i) => {
      const contentSize = (n.title || '').length * 3 + (n.body || '').length;
      const linkCount = linkCounts[n.id] || 0;
      const sizePart = opts.sizeByContent ? Math.sqrt(Math.max(24, contentSize)) * 0.23 : 2;
      const r = 4.8 + Math.min(22, sizePart + linkCount * 1.9);
      return {
        id: n.id,
        title: n.title,
        body: n.body || '',
        x: W / 2 + (Math.random() - 0.5) * Math.min(260, W * 0.35),
        y: H / 2 + (Math.random() - 0.5) * Math.min(220, H * 0.35),
        vx: 0, vy: 0,
        r,
        linkCount,
        contentSize,
        tag: n.tags[0] || 'untagged',
        date: new Date(n.date).getTime(),
        fixedX: null,
        cx: null,
        cy: null,
      };
    });

    if (style === 'timeline' && ns.length) {
      let minD = Infinity;
      let maxD = -Infinity;
      for (const n of ns) {
        if (n.date < minD) minD = n.date;
        if (n.date > maxD) maxD = n.date;
      }
      ns.forEach(n => {
        n.x = 70 + ((n.date - minD) / (maxD - minD || 1)) * (W - 140);
        n.y = H / 2 + (Math.random() - 0.5) * 90;
        n.fixedX = n.x;
      });
    } else if (style === 'cluster' && ns.length) {
      const uniqueTags = [...new Set(ns.map(n => n.tag))];
      const centers = {};
      uniqueTags.forEach((t, i) => {
        const angle = (i / uniqueTags.length) * Math.PI * 2;
        centers[t] = {
          cx: W / 2 + Math.cos(angle) * Math.min(250, W * 0.25),
          cy: H / 2 + Math.sin(angle) * Math.min(170, H * 0.24),
        };
      });
      ns.forEach(n => {
        const c = centers[n.tag];
        n.x = c.cx + (Math.random() - 0.5) * 44;
        n.y = c.cy + (Math.random() - 0.5) * 44;
        n.cx = c.cx; n.cy = c.cy;
      });
    }

    setNodes(ns);
    setEdges(visibleEdges);
  }, [notes, visibleEdges, style, W, H, layoutSeed, opts.sizeByContent]);

  useEffect(() => {
    if (!nodes) return;
    let ticks = 0;
    const maxTicks = 280;
    settledRef.current = false;

    function step() {
      ticks++;
      setNodes(prev => {
        if (!prev) return prev;
        const next = prev.map(n => ({ ...n }));
        const byId = Object.fromEntries(next.map(n => [n.id, n]));
        const alpha = Math.max(0.025, 1 - ticks / maxTicks);

        // Repulsion falls off as 1/d², so only nearby nodes matter. Bucket
        // nodes into a coarse grid and evaluate pairs within the 3×3
        // neighborhood — O(n × local density) instead of O(n²), which keeps
        // multi-thousand-note graphs interactive. Long-range spreading is
        // provided by the center-pull force below.
        const CELL = 130;
        const grid = new Map();
        for (let i = 0; i < next.length; i++) {
          const key = (((next[i].x / CELL) | 0) << 16) ^ ((next[i].y / CELL) | 0);
          const bucket = grid.get(key);
          if (bucket) bucket.push(i); else grid.set(key, [i]);
        }
        for (let i = 0; i < next.length; i++) {
          const a = next[i];
          const cx = (a.x / CELL) | 0, cy = (a.y / CELL) | 0;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            for (let gy = cy - 1; gy <= cy + 1; gy++) {
              const bucket = grid.get((gx << 16) ^ gy);
              if (!bucket) continue;
              for (const j of bucket) {
                if (j <= i) continue;
                const b = next[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist2 = dx * dx + dy * dy + 0.1;
                const dist = Math.sqrt(dist2);
                const minGap = a.r + b.r + 18;
                const force = Math.max(160, minGap * opts.repulsion) / dist2;
                const fx = (dx / dist) * force, fy = (dy / dist) * force;
                a.vx -= fx; a.vy -= fy;
                b.vx += fx; b.vy += fy;
              }
            }
          }
        }

        for (const e of edges) {
          const a = byId[e.source];
          const b = byId[e.target];
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const target = style === 'cluster' ? Math.max(68, opts.linkDistance * 0.7) : opts.linkDistance;
          const f = (dist - target) * 0.018;
          const fx = (dx / dist) * f, fy = (dy / dist) * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }

        for (const n of next) {
          if (style === 'cluster' && n.cx != null) {
            n.vx += (n.cx - n.x) * 0.028;
            n.vy += (n.cy - n.y) * 0.028;
          } else if (style === 'timeline') {
            if (n.fixedX != null) n.vx += (n.fixedX - n.x) * 0.18;
            n.vy += (H / 2 - n.y) * 0.01;
          } else {
            n.vx += (W / 2 - n.x) * opts.center;
            n.vy += (H / 2 - n.y) * opts.center;
          }
        }

        let moved = 0;
        for (const n of next) {
          n.vx *= 0.84; n.vy *= 0.84;
          n.x += n.vx * alpha * 2;
          n.y += n.vy * alpha * 2;
          n.x = Math.max(n.r + 18, Math.min(W - n.r - 18, n.x));
          n.y = Math.max(n.r + 24, Math.min(H - n.r - 22, n.y));
          moved += Math.abs(n.vx) + Math.abs(n.vy);
        }
        // Stop early once the layout has settled instead of always burning
        // the full tick budget.
        settledRef.current = next.length > 0 && moved / next.length < 0.03;
        return next;
      });
      if (ticks < maxTicks && !settledRef.current) rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // layoutSeed restarts the loop on "reset layout" — required now that the
    // simulation can settle and stop before its tick budget runs out.
  }, [edges, style, W, H, opts.linkDistance, opts.repulsion, opts.center, layoutSeed]);

  const nodeById = useMemo(() => Object.fromEntries((nodes || []).map(n => [n.id, n])), [nodes]);
  const themeName = T === MN_THEMES.dark ? 'dark' : 'light';
  const connectedToHover = (id) => {
    if (!hoverId) return true;
    if (id === hoverId) return true;
    return edges.some(e =>
      (e.source === hoverId && e.target === id) ||
      (e.target === hoverId && e.source === id));
  };

  const exportSvg = () => {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vispnote-graph.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const setOpt = (key, value) => setOpts(prev => ({ ...prev, [key]: value }));

  return (
    <div ref={frameRef} style={{
      flex: 1, minWidth: 0, height: '100%',
      background: T.bg,
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      <div style={{
        height: DS_HEIGHT.panelHeader, flexShrink: 0, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 88px 0 20px',
        borderBottom: `1px solid ${T.lineSub}`,
        background: T.bg,
      }}>
        <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink, flexShrink: 0 }}>Graph</span>
        {/* Scope reads as a pill because it is a state you can leave, not a label. */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0,
          height: 26, padding: '0 10px', borderRadius: DS_RADIUS.pill,
          background: graphFilter ? T.accentSoft : T.bgSub,
          border: `1px solid ${graphFilter ? T.selLine : T.lineSub}`,
          color: graphFilter ? T.accent : T.inkMed, fontSize: 11.5,
        }}>{graphFilter ? 'Novelist scope' : 'Follows the note list'}</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...dsMachineStyle(T), fontSize: 11, flexShrink: 0 }}>
          {(nodes || []).length} notes · {(edges || []).length} links
        </span>
        {graphFilter && (
          <select
            value={graphFilter}
            onChange={(e) => onGraphFilterChange && onGraphFilterChange(e.target.value)}
            title="Graph filter"
            style={{
              height: 28,
              border: `1px solid ${T.lineSub}`,
              borderRadius: 6,
              background: T.bg,
              color: T.inkMed,
              fontFamily: 'var(--mn-ui)',
              fontSize: 12,
              padding: '0 8px',
              outline: 'none',
            }}>
            <option value="all-novelist">All novelist notes</option>
            <option value="structure">Act structure</option>
            <option value="characters-scenes">Characters + scenes</option>
            <option value="plot-scenes">Plot threads + scenes</option>
            <option value="research-scenes">Research + scenes</option>
          </select>
        )}
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 11,
          color: T.inkDim,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>{notes.length} notes · {edges.length} links · {style}</div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, position: 'relative',
        background: `linear-gradient(180deg, ${T.bg}, ${T.bgSub})`,
        overflow: 'hidden',
      }}>
        {(!nodes || nodes.length === 0) ? (
          <DsEmptyState
            T={T}
            style={{ height: '100%' }}
            icon={(
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                <circle cx="4" cy="4" r="1.8" /><circle cx="12" cy="4" r="1.8" /><circle cx="8" cy="12" r="1.8" />
                <path d="M5.5 5L10.5 5M5.3 5.8L6.8 10.4M10.7 5.8L9.2 10.4" />
              </svg>
            )}
            headline="No notes match the current search"
            body="The graph shows whatever the note list is showing, so clear the search there."
          />
        ) : (
          <>
          {/* Legend sits over the canvas so the tag colours can be read
              without leaving the graph. */}
          {legendTags.length > 0 && (
            <div style={{
              position: 'absolute', left: 20, bottom: 18, zIndex: 2,
              padding: '12px 14px', borderRadius: DS_RADIUS.row,
              background: `color-mix(in oklab, ${T.bgElevated || T.bg} 92%, transparent)`,
              border: `1px solid ${T.lineSub}`,
              boxShadow: `0 8px 22px color-mix(in oklab, ${T.ink} 9%, transparent)`,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={dsGroupLabelStyle(T)}>Tags</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', maxWidth: 320 }}>
                {legendTags.map(tag => (
                  <span key={tag.name} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 12, color: T.inkMed,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: mnGetTagColor(tag.hue ?? 240, theme),
                    }} />
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <pattern id="mnGraphGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke={T.lineSub} strokeWidth="0.45" />
              </pattern>
            </defs>

            <rect width={W} height={H} fill="url(#mnGraphGrid)" opacity={themeName === 'dark' ? 0.18 : 0.34} />

            {style === 'timeline' && (
              <line x1={64} y1={H / 2} x2={W - 64} y2={H / 2}
                stroke={T.line} strokeWidth="1" strokeDasharray="3 5" opacity="0.6" />
            )}

            {edges.map((e, i) => {
              const a = nodeById[e.source], b = nodeById[e.target];
              if (!a || !b) return null;
              const active = connectedToHover(a.id) && connectedToHover(b.id);
              return (
                <path key={`${e.source}:${e.target}:${i}`}
                  d={mnGraphCurve(a, b)}
                  fill="none"
                  stroke={active ? T.inkDim : T.line}
                  strokeWidth={active ? 1.25 : 0.75}
                  strokeLinecap="round"
                  opacity={active ? 0.46 : 0.18} />
              );
            })}

            {nodes.map(n => {
              const active = connectedToHover(n.id);
              const focus = focusId === n.id;
              const tagHue = tagColor[n.tag] ?? 230;
              const raw = mnGetTagColor(tagHue, themeName);
              const isTagged = n.tag !== 'untagged';
              const fill = opts.tagColors && isTagged
                ? `color-mix(in oklab, ${raw} 44%, ${T.inkDim} 56%)`
                : `color-mix(in oklab, ${T.inkDim} 70%, ${T.bg} 30%)`;
              const stroke = opts.tagColors && isTagged
                ? `color-mix(in oklab, ${raw} 48%, ${T.inkDim} 52%)`
                : T.inkDim;
              const label = n.title.length > 34 ? n.title.slice(0, 32) + '…' : n.title;
              const showLabel = active && (opts.labels || notes.length <= 6 || focus || hoverId === n.id);
              return (
                <g key={n.id}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => onOpen(n.id)}
                  style={{ cursor: 'default', opacity: active ? 1 : 0.22 }}>
                  {focus && (
                    <circle cx={n.x} cy={n.y} r={n.r + 8}
                      fill="none" stroke={T.accent} strokeWidth="1.2"
                      opacity="0.62" strokeDasharray="3 4" />
                  )}
                  <circle cx={n.x} cy={n.y} r={n.r + 5}
                    fill={isTagged ? raw : T.inkDim} opacity={active ? 0.05 : 0.02} />
                  <circle cx={n.x} cy={n.y} r={n.r}
                    fill={fill} stroke={stroke} strokeWidth="1.6"
                  />
                  {showLabel && (
                    <>
                      <rect
                        x={n.x - Math.min(190, label.length * 6.2) / 2 - 7}
                        y={n.y + n.r + 7}
                        width={Math.min(190, label.length * 6.2) + 14}
                        height="21"
                        rx="6"
                        fill={`color-mix(in oklab, ${T.bg} 90%, transparent)`}
                        stroke={T.lineSub}
                        opacity="0.94" />
                      <text x={n.x} y={n.y + n.r + 22}
                        textAnchor="middle"
                        fontFamily="var(--mn-ui)" fontSize="10.5"
                        fontWeight={focus ? 600 : 500}
                        fill={T.ink}>
                        {label}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
          </>
        )}

        <div style={{
          position: 'absolute', left: 18, bottom: 14,
          fontFamily: 'var(--mn-mono)', fontSize: 10,
          color: T.inkDim, letterSpacing: '0.04em',
          background: `color-mix(in oklab, ${T.bg} 78%, transparent)`,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 6, padding: '5px 8px',
        }}>{graphFilter ? 'novelist graph filter' : 'search in All notes'} · hover to isolate · click to open</div>

        <MnGraphControls
          T={T}
          open={panelOpen}
          setOpen={setPanelOpen}
          opts={opts}
          setOpt={setOpt}
          notesCount={notes.length}
          edgesCount={edges.length}
          onReset={() => setLayoutSeed(s => s + 1)}
          onExportSvg={exportSvg}
        />
      </div>
    </div>
  );
}

function mnGraphCurve(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const bend = Math.min(36, len * 0.1);
  const cx = mx - (dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function MnGraphControls({
  T, open, setOpen, opts, setOpt,
  notesCount, edgesCount, onReset, onExportSvg,
}) {
  const toggle = (key) => setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  const Row = ({ id, title, children }) => (
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
  const Toggle = ({ label, value, onChange }) => (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 0', cursor: 'pointer',
    }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  const Range = ({ label, min, max, step, value, onChange }) => (
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
      <Row id="nodes" title="Nodes">
        <div style={{ marginBottom: 6 }}>{notesCount} visible notes</div>
        <Toggle label="Show labels" value={opts.labels} onChange={(v) => setOpt('labels', v)} />
        <Toggle label="Tag colors" value={opts.tagColors} onChange={(v) => setOpt('tagColors', v)} />
        <Toggle label="Size by content" value={opts.sizeByContent} onChange={(v) => setOpt('sizeByContent', v)} />
      </Row>
      <Row id="forces" title="Forces">
        <Range label="Link distance" min="70" max="180" step="1" value={opts.linkDistance} onChange={(v) => setOpt('linkDistance', v)} />
        <Range label="Repulsion" min="20" max="60" step="1" value={opts.repulsion} onChange={(v) => setOpt('repulsion', v)} />
        <Range label="Center pull" min="0" max="0.02" step="0.001" value={opts.center} onChange={(v) => setOpt('center', v)} />
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
      <Row id="export" title="Export">
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

export { MnGraph };
import { MN_THEMES, mnGetTagColor, mnShadow } from '../shared/theme.jsx';
