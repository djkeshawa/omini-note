// In-layout knowledge graph for OminiNote.
// Pure JS force simulation, scoped by the existing note-list search/filter.

const { useEffect, useRef, useState, useMemo } = React;

function MnGraph({ notes, links, style, focusId, onOpen, T, tags }) {
  const frameRef = useRef(null);
  const svgRef = useRef(null);
  const rafRef = useRef(null);
  const [dims, setDims] = useState({ w: 900, h: 620 });
  const [nodes, setNodes] = useState(null);
  const [edges, setEdges] = useState([]);
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
      };
    });

    if (style === 'timeline' && ns.length) {
      const dates = ns.map(n => n.date);
      const minD = Math.min(...dates), maxD = Math.max(...dates);
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

    function step() {
      ticks++;
      setNodes(prev => {
        if (!prev) return prev;
        const next = prev.map(n => ({ ...n }));
        const byId = Object.fromEntries(next.map(n => [n.id, n]));
        const alpha = Math.max(0.025, 1 - ticks / maxTicks);

        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const a = next[i], b = next[j];
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

        for (const n of next) {
          n.vx *= 0.84; n.vy *= 0.84;
          n.x += n.vx * alpha * 2;
          n.y += n.vy * alpha * 2;
          n.x = Math.max(n.r + 18, Math.min(W - n.r - 18, n.x));
          n.y = Math.max(n.r + 24, Math.min(H - n.r - 22, n.y));
        }
        return next;
      });
      if (ticks < maxTicks) rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [edges, style, W, H, opts.linkDistance, opts.repulsion, opts.center]); // eslint-disable-line

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
    a.download = 'omininote-graph.svg';
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
        height: 54, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px',
        borderBottom: `1px solid ${T.lineSub}`,
        background: T.bg,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: T.inkDim,
          }}>Graph</div>
          <div style={{
            fontFamily: 'var(--mn-ui)', fontSize: 12.5,
            color: T.inkMed, marginTop: 2,
          }}>Filtered by the All notes search</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 11,
          color: T.inkDim,
        }}>{notes.length} notes · {edges.length} links · {style}</div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, position: 'relative',
        background: `linear-gradient(180deg, ${T.bg}, ${T.bgSub})`,
        overflow: 'hidden',
      }}>
        {(!nodes || nodes.length === 0) ? (
          <div style={{
            height: '100%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: T.inkDim, fontFamily: 'var(--mn-ui)', fontSize: 13,
          }}>No notes match the current search.</div>
        ) : (
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
                <path key={i}
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
              const showLabel = active && (opts.labels || focus || hoverId === n.id);
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
        )}

        <div style={{
          position: 'absolute', left: 18, bottom: 14,
          fontFamily: 'var(--mn-mono)', fontSize: 10,
          color: T.inkDim, letterSpacing: '0.04em',
          background: `color-mix(in oklab, ${T.bg} 78%, transparent)`,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 6, padding: '5px 8px',
        }}>search in All notes · hover to isolate · click to open</div>

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
        width: '100%', height: 44,
        border: 'none', background: 'transparent',
        display: 'flex', alignItems: 'center',
        padding: '0 14px',
        fontFamily: 'var(--mn-ui)', fontSize: 16,
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
          padding: '0 14px 12px',
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
      right: 24,
      width: 214,
      zIndex: 3,
      background: `color-mix(in oklab, ${T.bg} 94%, transparent)`,
      border: `1px solid ${T.lineSub}`,
      borderRadius: 6,
      boxShadow: `0 18px 42px color-mix(in oklab, ${T.ink} 12%, transparent)`,
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

window.MnGraph = MnGraph;
