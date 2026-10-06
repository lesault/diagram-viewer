import { routeEdge, orthoPath, defaultSides, sideMid } from './render.js';

// Orthogonal connector router for the main diagram. Shapes stay where they are; only connectors move.
// Each connector is routed on a grid built from the shapes' clearance lines (A* with penalties for bends,
// for running over connectors already routed, and for crossing them), then ports are spread along each
// side and remaining parallel overlaps are nudged apart.

const r2 = v => Math.round(v * 100) / 100;
const lowerBound = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; };

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = [k[0], v[0]], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
    return top;
  }
}

const sidesOf = (n, m) => {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  return [
    { s: 'R', a: { x: n.x + n.w, y: cy }, c: { x: n.x + n.w + m, y: cy }, axis: 0 },
    { s: 'L', a: { x: n.x, y: cy }, c: { x: n.x - m, y: cy }, axis: 0 },
    { s: 'T', a: { x: cx, y: n.y }, c: { x: cx, y: n.y - m }, axis: 1 },
    { s: 'B', a: { x: cx, y: n.y + n.h }, c: { x: cx, y: n.y + n.h + m }, axis: 1 },
  ];
};

const compress = pts => {
  const out = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 0.01 && Math.abs(out[out.length - 1].y - p.y) < 0.01) continue;
    out.push({ x: p.x, y: p.y });
    while (out.length >= 3) {
      const a = out[out.length - 3], b = out[out.length - 2], c = out[out.length - 1];
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) out.splice(out.length - 2, 1); else break;
    }
  }
  return out;
};

export function rerouteAll(model, { margin = 14, bendCost = 50, overlapCost = 8, overlapRate = 0.2, crossCost = 10, step = 5 } = {}) {
  // free-floating text notes are not obstacles (they would also create routing corridors outside the diagram)
  const obst = [...model.nodes.values()].filter(n => !n.isGroup && !n.ctxBox && !n.isContainer && !n.style.text);
  const byId = new Map(obst.map(n => [n.id, n]));
  const todo = model.edges.filter(e => e.source && e.target && e.source !== e.target && byId.has(e.source) && byId.has(e.target));
  const stats = { routed: 0, fallback: 0, skipped: model.edges.length - todo.length };
  if (!todo.length) return stats;

  const xset = new Set(), yset = new Set();
  for (const n of obst) {
    xset.add(r2(n.x - margin)); xset.add(r2(n.x + n.w + margin)); xset.add(r2(n.x + n.w / 2));
    yset.add(r2(n.y - margin)); yset.add(r2(n.y + n.h + margin)); yset.add(r2(n.y + n.h / 2));
  }
  const xs = [...xset].sort((a, b) => a - b), ys = [...yset].sort((a, b) => a - b);
  const xi = new Map(xs.map((v, i) => [v, i])), yi = new Map(ys.map((v, i) => [v, i]));
  const NYg = ys.length;
  const segUse = new Map(), ptMask = new Map();
  const centre = n => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  const order = [...todo].sort((a, b) => {
    const d = e => { const p = centre(byId.get(e.source)), q = centre(byId.get(e.target)); return Math.abs(p.x - q.x) + Math.abs(p.y - q.y); };
    return d(a) - d(b);
  });

  const routes = [];
  for (const e of order) {
    const sn = byId.get(e.source), tn = byId.get(e.target);
    const S = sidesOf(sn, margin), T = sidesOf(tn, margin);
    let found = null;
    let W = 220;
    for (let attempt = 0; attempt < 4 && !found; attempt++, W *= 3) {
      const bx0 = Math.min(sn.x, tn.x) - W, bx1 = Math.max(sn.x + sn.w, tn.x + tn.w) + W, by0 = Math.min(sn.y, tn.y) - W, by1 = Math.max(sn.y + sn.h, tn.y + tn.h) + W;
      const full = attempt === 3;
      const i0 = full ? 0 : lowerBound(xs, bx0), i1 = full ? xs.length - 1 : Math.min(xs.length - 1, lowerBound(xs, bx1 + 1e-6) - 1);
      const j0 = full ? 0 : lowerBound(ys, by0), j1 = full ? ys.length - 1 : Math.min(ys.length - 1, lowerBound(ys, by1 + 1e-6) - 1);
      const NX = i1 - i0 + 1, NY = j1 - j0 + 1;
      if (NX < 2 || NY < 2) continue;
      const blocked = new Uint8Array(NX * NY);
      for (const o of obst) {
        const l = o.x - margin + 1e-3, r = o.x + o.w + margin - 1e-3, t = o.y - margin + 1e-3, b = o.y + o.h + margin - 1e-3;
        if (r < xs[i0] || l > xs[i1] || b < ys[j0] || t > ys[j1]) continue;
        const a0 = Math.max(i0, lowerBound(xs, l)), a1 = Math.min(i1, lowerBound(xs, r + 1e-9) - 1);
        const c0 = Math.max(j0, lowerBound(ys, t)), c1 = Math.min(j1, lowerBound(ys, b + 1e-9) - 1);
        for (let i = a0; i <= a1; i++) for (let j = c0; j <= c1; j++) blocked[(i - i0) * NY + (j - j0)] = 1;
      }
      const loc = c => { const gi = xi.get(r2(c.x)), gj = yi.get(r2(c.y)); return gi === undefined || gj === undefined || gi < i0 || gi > i1 || gj < j0 || gj > j1 ? -1 : (gi - i0) * NY + (gj - j0); };
      const targets = new Map();
      for (const t of T) { const p = loc(t.c); if (p >= 0 && !blocked[p]) targets.set(p, t); }
      const starts = [];
      for (const s of S) { const p = loc(s.c); if (p >= 0 && !blocked[p]) starts.push({ p, s }); }
      if (!targets.size || !starts.length) continue;
      const tl = [...targets.keys()].map(p => [xs[i0 + Math.floor(p / NY)], ys[j0 + (p % NY)]]);
      const hfn = p => { const x = xs[i0 + Math.floor(p / NY)], y = ys[j0 + (p % NY)]; let m = Infinity; for (const [tx, ty] of tl) m = Math.min(m, Math.abs(x - tx) + Math.abs(y - ty)); return m; };
      const dist = new Float64Array(NX * NY * 3).fill(Infinity), prev = new Int32Array(NX * NY * 3).fill(-1);
      const heap = new Heap();
      const startSide = new Map();
      for (const { p, s } of starts) { const st = p * 3 + s.axis; dist[st] = 0; startSide.set(st, s); heap.push(hfn(p), st); }
      let best = null;
      while (heap.size) {
        const [f, st] = heap.pop();
        if (best && f >= best.total) break;
        const p = Math.floor(st / 3), d = st % 3, g = dist[st];
        if (g + hfn(p) > f + 1e-6) continue;
        const tgt = targets.get(p);
        if (tgt) { const total = g + (d !== tgt.axis ? bendCost : 0); if (!best || total < best.total) best = { total, st, tgt }; }
        const pi = Math.floor(p / NY), pj = p % NY, gi = i0 + pi, gj = j0 + pj;
        for (let dir = 0; dir < 4; dir++) {
          const di = dir === 0 ? 1 : dir === 1 ? -1 : 0, dj = dir === 2 ? 1 : dir === 3 ? -1 : 0;
          const ni = pi + di, nj = pj + dj;
          if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
          const np = ni * NY + nj;
          if (blocked[np]) continue;
          const nd = di ? 0 : 1;
          const len = di ? Math.abs(xs[i0 + ni] - xs[gi]) : Math.abs(ys[j0 + nj] - ys[gj]);
          const kg = Math.min(gi, i0 + ni) * NYg + Math.min(gj, j0 + nj);
          let c = len + (d !== nd ? bendCost : 0);
          if (segUse.has(kg * 2 + nd)) c += overlapCost + overlapRate * len;
          const mk = ptMask.get((i0 + ni) * NYg + (j0 + nj)) || 0;
          if (mk & (nd === 0 ? 2 : 1)) c += crossCost;
          const ns = np * 3 + nd, ng = g + c;
          if (ng < dist[ns]) { dist[ns] = ng; prev[ns] = st; heap.push(ng + hfn(np), ns); }
        }
      }
      if (best) {
        const chain = []; let st = best.st;
        for (; st >= 0; st = prev[st]) chain.push(st);
        chain.reverse();
        const pts = chain.map(s => { const p = Math.floor(s / 3); return { x: xs[i0 + Math.floor(p / NY)], y: ys[j0 + (p % NY)] }; });
        // mark usage for later connectors
        for (let k = 0; k < chain.length; k++) {
          const p = Math.floor(chain[k] / 3), gi = i0 + Math.floor(p / NY), gj = j0 + (p % NY);
          if (k > 0) {
            const q = Math.floor(chain[k - 1] / 3), hi = i0 + Math.floor(q / NY), hj = j0 + (q % NY);
            const ax = gi !== hi ? 0 : 1;
            segUse.set((Math.min(gi, hi) * NYg + Math.min(gj, hj)) * 2 + ax, 1);
            ptMask.set(gi * NYg + gj, (ptMask.get(gi * NYg + gj) || 0) | (1 << ax));
            ptMask.set(hi * NYg + hj, (ptMask.get(hi * NYg + hj) || 0) | (1 << ax));
          }
        }
        found = compress([startSide.get(chain[0]).a, ...pts, best.tgt.a]);
      }
    }
    if (!found) {
      const [sa, sb] = defaultSides(sn, tn);
      found = compress(orthoPath(sideMid(sn, sa), sa, sideMid(tn, sb), sb));
      stats.fallback++;
    } else stats.routed++;
    routes.push({ e, sn, tn, pts: found });
  }

  spreadPorts(routes);
  nudgeParallels(routes, margin, step);
  for (const { e, pts } of routes) { e.route = pts; e.points = pts.slice(1, -1); }
  return stats;
}

function sideOfPoint(n, p) {
  if (Math.abs(p.x - n.x) < 0.5) return 'L';
  if (Math.abs(p.x - (n.x + n.w)) < 0.5) return 'R';
  if (Math.abs(p.y - n.y) < 0.5) return 'T';
  return 'B';
}

// several connectors on the same side of a shape: fan them out instead of stacking on the midpoint
function spreadPorts(routes) {
  const groups = new Map();
  for (const r of routes) {
    if (r.pts.length < 3) continue;
    for (const end of [0, 1]) {
      const n = end ? r.tn : r.sn, p = end ? r.pts[r.pts.length - 1] : r.pts[0];
      const key = n.id + '|' + sideOfPoint(n, p);
      if (!groups.has(key)) groups.set(key, { n, side: sideOfPoint(n, p), items: [] });
      groups.get(key).items.push({ r, end });
    }
  }
  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    const horiz = g.side === 'L' || g.side === 'R';             // side runs vertically -> spread along y
    const ax = horiz ? 'y' : 'x';
    const pull = ({ r, end }) => {
      const pts = end ? [...r.pts].reverse() : r.pts, a = pts[0][ax];
      for (const p of pts) if (Math.abs(p[ax] - a) > 0.5) return p[ax];
      return pts[pts.length - 1][ax];
    };
    const items = g.items.map(it => ({ ...it, key: pull(it) })).sort((p, q) => p.key - q.key);
    const lo = horiz ? g.n.y : g.n.x, len = horiz ? g.n.h : g.n.w;
    items.forEach(({ r, end }, i) => {
      const pos = lo + (len * (i + 1)) / (items.length + 1);
      const k = end ? r.pts.length - 1 : 0, nb = end ? k - 1 : 1;
      if (Math.abs(r.pts[nb][ax] - r.pts[k][ax]) > 0.5) return;  // first segment is not perpendicular to the side; leave it
      r.pts[k][ax] = pos; r.pts[nb][ax] = pos;
    });
  }
}

// collinear overlapping runs from different connectors are pushed apart inside the clearance channel
function nudgeParallels(routes, margin, step) {
  const segs = [];
  routes.forEach((r, ri) => {
    for (let i = 1; i + 1 <= r.pts.length - 2; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) > 0.01) segs.push({ r, ri, i, v: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.01 && Math.abs(a.x - b.x) > 0.01) segs.push({ r, ri, i, v: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  });
  const buckets = new Map();
  for (const s of segs) { const k = (s.v ? 'v' : 'h') + Math.round(s.c * 2); (buckets.get(k) || buckets.set(k, []).get(k)).push(s); }
  const maxOff = margin - 3;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.lo - q.lo || p.ri - q.ri);
    let cluster = [], hi = -Infinity;
    const flush = () => {
      const k = cluster.length;
      if (k > 1) {
        const st = Math.min(step, (2 * maxOff) / (k - 1));
        cluster.forEach((s, j) => {
          const off = (j - (k - 1) / 2) * st, a = s.r.pts[s.i], b = s.r.pts[s.i + 1];
          if (s.v) { a.x += off; b.x += off; } else { a.y += off; b.y += off; }
        });
      }
      cluster = []; hi = -Infinity;
    };
    for (const s of list) {
      if (cluster.length && s.lo >= hi - 2) flush();
      cluster.push(s); hi = Math.max(hi, s.hi);
    }
    flush();
  }
}

/** Quality measures for the connectors as currently routed (used by tests and diagnostics). */
export function routeMetrics(model) {
  const leaves = [...model.nodes.values()].filter(n => !n.isGroup && !n.ctxBox && !n.isContainer && !n.style.text);
  const through = [];
  let bends = 0, length = 0, overlaps = 0;
  const segs = [];
  model.edges.forEach((e, ei) => {
    const pts = routeEdge(e, model.nodes);
    if (pts.length < 2) return;
    bends += Math.max(0, pts.length - 2);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      segs.push({ ei, a, b });
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      for (const n of leaves) {
        if (n.id === e.source || n.id === e.target) continue;
        if (x1 > n.x + 1 && x0 < n.x + n.w - 1 && y1 > n.y + 1 && y0 < n.y + n.h - 1) { through.push({ edge: e.id, node: n.id }); break; }
      }
    }
  });
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const p = segs[i], q = segs[j];
    if (p.ei === q.ei) continue;
    const pv = Math.abs(p.a.x - p.b.x) < 0.5, qv = Math.abs(q.a.x - q.b.x) < 0.5, ph = Math.abs(p.a.y - p.b.y) < 0.5, qh = Math.abs(q.a.y - q.b.y) < 0.5;
    if (pv && qv && Math.abs(p.a.x - q.a.x) < 0.5) { const o = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y)) - Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y)); if (o > 2) overlaps++; }
    else if (ph && qh && Math.abs(p.a.y - q.a.y) < 0.5) { const o = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) - Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x)); if (o > 2) overlaps++; }
  }
  return { bends, length: Math.round(length), through, overlaps };
}
