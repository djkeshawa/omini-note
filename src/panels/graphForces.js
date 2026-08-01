// One tick of the graph's force layout.
//
// Lifted out of the panel unchanged in behaviour so the arrangement can be
// tested without a browser or a running animation frame, and so the panel is
// left holding the loop rather than the physics.
//
// Three forces act every tick: nodes push each other apart, links pull their
// two ends toward a target distance, and each layout style adds its own
// restoring pull — a cluster centre, a timeline's fixed column, or the middle
// of the canvas. Then velocities are damped and integrated.

// Repulsion falls off as 1/d², so only nearby nodes matter. Bucketing into a
// coarse grid and evaluating the 3×3 neighbourhood is O(n × local density)
// instead of O(n²), which is what keeps multi-thousand-note graphs
// interactive. Long-range spreading comes from the centre pull instead.
const MN_GRAPH_CELL = 130;
const MN_GRAPH_MAX_TICKS = 280;

function mnGraphAlpha(ticks = 0, maxTicks = MN_GRAPH_MAX_TICKS) {
  return Math.max(0.025, 1 - ticks / maxTicks);
}

function mnGraphRepel(next, repulsion) {
  const grid = new Map();
  for (let i = 0; i < next.length; i++) {
    const key = (((next[i].x / MN_GRAPH_CELL) | 0) << 16) ^ ((next[i].y / MN_GRAPH_CELL) | 0);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i); else grid.set(key, [i]);
  }
  for (let i = 0; i < next.length; i++) {
    const a = next[i];
    const cx = (a.x / MN_GRAPH_CELL) | 0, cy = (a.y / MN_GRAPH_CELL) | 0;
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
          const force = Math.max(160, minGap * repulsion) / dist2;
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
    }
  }
}

function mnGraphPullLinks(next, edges, style, linkDistance) {
  const byId = new Map(next.map(n => [n.id, n]));
  for (const e of edges || []) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const target = style === 'cluster' ? Math.max(68, linkDistance * 0.7) : linkDistance;
    const f = (dist - target) * 0.018;
    const fx = (dx / dist) * f, fy = (dy / dist) * f;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }
}

function mnGraphRestore(next, style, W, H, center) {
  for (const n of next) {
    if (style === 'cluster' && n.cx != null) {
      n.vx += (n.cx - n.x) * 0.028;
      n.vy += (n.cy - n.y) * 0.028;
    } else if (style === 'timeline') {
      if (n.fixedX != null) n.vx += (n.fixedX - n.x) * 0.18;
      n.vy += (H / 2 - n.y) * 0.01;
    } else {
      n.vx += (W / 2 - n.x) * center;
      n.vy += (H / 2 - n.y) * center;
    }
  }
}

// Returns a new node list and whether the layout has come to rest. A held node
// — one being dragged — is placed where the grip says and skips integration
// and the viewport clamp both, because a clamp applied to a held node would
// fight the pointer at the edge of the pane. It is still in the list the force
// passes above read, which is exactly what makes its neighbours follow it.
function mnGraphTick(nodes, { edges = [], style = 'force', W = 900, H = 600, ticks = 0, opts = {} } = {}) {
  if (!Array.isArray(nodes)) return { nodes, settled: false };
  const next = nodes.map(n => ({ ...n }));
  const alpha = mnGraphAlpha(ticks);

  mnGraphRepel(next, opts.repulsion ?? 34);
  mnGraphPullLinks(next, edges, style, opts.linkDistance ?? 118);
  mnGraphRestore(next, style, W, H, opts.center ?? 0.005);

  let moved = 0;
  for (const n of next) {
    if (n.hx != null) {
      n.x = n.hx; n.y = n.hy;
      n.vx = 0; n.vy = 0;
      continue;
    }
    n.vx *= 0.84; n.vy *= 0.84;
    n.x += n.vx * alpha * 2;
    n.y += n.vy * alpha * 2;
    n.x = Math.max(n.r + 18, Math.min(W - n.r - 18, n.x));
    n.y = Math.max(n.r + 24, Math.min(H - n.r - 22, n.y));
    moved += Math.abs(n.vx) + Math.abs(n.vy);
  }

  // Settling early beats always burning the full tick budget.
  return { nodes: next, settled: next.length > 0 && moved / next.length < 0.03 };
}

export { mnGraphTick, mnGraphAlpha, MN_GRAPH_MAX_TICKS, MN_GRAPH_CELL };
