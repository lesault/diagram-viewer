import { findLanes, layoutZones } from './subset.js';
import { orthoPath, defaultSides, sideMid } from './render.js';

/**
 * Re-layout a sub-model with ELK (layered, left -> right) so a service view reads as
 * inputs -> service -> outputs. Containers become compound nodes. Returns a new model.
 * `ELK` is the elkjs constructor (global in the browser, passed in for tests).
 */
export async function tidyModel(sub, ELK, { direction = 'RIGHT', spacing = 50, focus = null } = {}) {
  const lanes = findLanes(sub);
  if (lanes) return tidyLanes(sub, lanes, ELK, { spacing, focus });
  const nodes = new Map([...sub.nodes].map(([k, v]) => [k, { ...v }]));
  // zones become temporary compound nodes so ELK keeps their members together; frames are laid out from the result
  if (sub.zones && sub.zones.length) {
    for (const z of sub.zones) nodes.set('zone:' + z.id, { id: 'zone:' + z.id, synthetic: true, isGroup: true, isContainer: true, parent: z.parent ? 'zone:' + z.parent : null, x: 0, y: 0, w: 0, h: 0, style: {}, meta: {}, text: '', order: -1 });
    for (const n of nodes.values()) if (!n.synthetic && !n.parent && sub.zoneOf && sub.zoneOf.has(n.id)) n.parent = 'zone:' + sub.zoneOf.get(n.id);
  }
  const childrenOf = new Map();
  for (const n of nodes.values()) {
    const p = n.parent && nodes.has(n.parent) ? n.parent : null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(n);
  }
  const build = n => {
    const kids = childrenOf.get(n.id);
    const o = { id: n.id };
    if (kids && kids.length) {
      o.children = kids.map(build);
      o.layoutOptions = { 'elk.padding': '[top=40,left=20,bottom=20,right=20]' };
    } else { o.width = n.w; o.height = n.h; }
    return o;
  };
  const edges = sub.edges.filter(e => e.source && e.target && nodes.has(e.source) && nodes.has(e.target));
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(spacing), 'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing + 20),
      'elk.edgeRouting': 'ORTHOGONAL', 'elk.layered.mergeEdges': 'false',
    },
    children: (childrenOf.get(null) || []).map(build),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await new ELK().layout(graph);

  const abs = new Map([['root', { x: 0, y: 0 }]]);
  const place = (el, ox, oy) => {
    for (const c of el.children || []) {
      const n = nodes.get(c.id);
      n.x = ox + c.x; n.y = oy + c.y;
      if (c.children && c.children.length) { n.w = c.width; n.h = c.height; }
      abs.set(c.id, { x: n.x, y: n.y });
      place(c, n.x, n.y);
    }
  };
  place(res, 0, 0);

  const outEdges = [];
  for (const re of res.edges || []) {
    const src = edges.find(e => e.id === re.id);
    const off = abs.get(re.container || 'root') || { x: 0, y: 0 };
    const sec = re.sections && re.sections[0];
    const e = { ...src, inferred: src.inferred };
    if (sec) {
      const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map(p => ({ x: p.x + off.x, y: p.y + off.y }));
      e.route = pts; e.points = pts.slice(1, -1);
    }
    outEdges.push(e);
  }
  for (const [id, n] of [...nodes]) { if (n.synthetic) nodes.delete(id); else n.parent = sub.nodes.get(id).parent; }
  const out = { nodes, edges: outEdges, groups: sub.groups, diagnostics: sub.diagnostics, focus, zones: sub.zones, zoneOf: sub.zoneOf, frameMeta: sub.frameMeta, layers: sub.layers };
  layoutZones(out, { frameMeta: sub.frameMeta !== false });
  return out;
}

// ---------- swimlane-aware tidy ----------
const transposeModel = m => {
  for (const n of m.nodes.values()) { [n.x, n.y] = [n.y, n.x]; [n.w, n.h] = [n.h, n.w]; }
  const t = p => ({ x: p.y, y: p.x });
  for (const e of m.edges) { if (e.route) e.route = e.route.map(t); e.points = e.points.map(t); }
};
const segHits = (p, q, r) => {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > r.x + 1 && x0 < r.x + r.w - 1 && y1 > r.y + 1 && y0 < r.y + r.h - 1;
};

/**
 * Keeps the diagram's swimlanes as bands. ELK (flat, left -> right) decides the column each shape
 * belongs to; shapes are then stacked inside their own lane, lanes are packed tight and wrapped by
 * the pool, and connectors are routed through the gaps between columns. Column-style lanes
 * (header on top) are handled by transposing, running the same code and transposing back.
 */
async function tidyLanes(sub, { blocks, axis }, ELK, { spacing, focus }) {
  const m = {
    nodes: new Map([...sub.nodes].map(([k, v]) => [k, { ...v }])),
    edges: sub.edges.filter(e => e.source && e.target).map(e => ({ ...e, route: null, points: [] })),
    groups: sub.groups, diagnostics: sub.diagnostics, focus, zones: sub.zones, zoneOf: sub.zoneOf, frameMeta: sub.frameMeta, layers: sub.layers,
  };
  const keep = new Set();
  blocks.forEach(b => { if (b.pool) keep.add(b.pool.id); b.lanes.forEach(l => keep.add(l.id)); });
  // leaves = everything that is not a pool/lane/other container; nested groups are flattened into their lane
  const leaves = [...m.nodes.values()].filter(n => !n.isGroup);
  const laneOf = new Map();
  for (const n of leaves) {
    let p = n.parent;
    while (p && !blocks.some(b => b.lanes.some(l => l.id === p))) p = m.nodes.get(p) && m.nodes.get(p).parent;
    laneOf.set(n.id, p || null);
    n.parent = p || null;
  }
  for (const [id, n] of [...m.nodes]) if (n.isGroup && !keep.has(id)) m.nodes.delete(id);
  const origLaneIds = blocks.map(b => b.lanes.map(l => l.id));
  if (axis === 'col') transposeModel(m);

  const HEAD = 24, PADY = 22, gapX = spacing + 70, gapY = Math.max(16, spacing / 2);
  const res = await new ELK().layout({
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': String(spacing), 'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing + 20), 'elk.edgeRouting': 'ORTHOGONAL' },
    children: leaves.map(n => ({ id: n.id, width: n.w, height: n.h })),
    edges: m.edges.filter(e => m.nodes.has(e.source) && m.nodes.has(e.target)).map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const pos = new Map(res.children.map(c => [c.id, c]));

  // columns from ELK's layer positions
  const sorted = [...leaves].sort((a, b) => pos.get(a.id).x - pos.get(b.id).x || pos.get(a.id).y - pos.get(b.id).y);
  const layerOf = new Map(), layers = [];
  let start = -1e9;
  for (const n of sorted) {
    const x = pos.get(n.id).x;
    if (!layers.length || x - start > 30) { layers.push([]); start = x; }
    layers[layers.length - 1].push(n); layerOf.set(n.id, layers.length - 1);
  }
  const lw = layers.map(l => Math.max(...l.map(n => n.w)));

  // bands: pool lanes in order, then shapes that sit in no lane
  const bands = [];
  blocks.forEach((b, bi) => b.lanes.forEach((l, li) => bands.push({ block: bi, lane: m.nodes.get(l.id), leaves: leaves.filter(n => laneOf.get(n.id) === l.id) })));
  const loose = leaves.filter(n => !laneOf.get(n.id));
  if (loose.length) bands.push({ block: -1, lane: null, leaves: loose });
  const liveBands = bands.filter(b => b.leaves.length);

  const poolHdr = b => (b.pool ? +b.pool.style.startSize || 23 : 0);
  const laneHdr = l => (l ? +l.style.startSize || 23 : 0);
  const PH = Math.max(0, ...blocks.map(poolHdr)), LH = Math.max(0, ...liveBands.map(b => laneHdr(b.lane)));
  const x0 = PH + LH + HEAD;
  const layerX = []; let cx = x0;
  lw.forEach((w, k) => { layerX.push(cx); cx += w + gapX; });
  const totalW = cx - gapX + HEAD;

  let y = 0;
  const poolBox = new Map();
  for (let i = 0; i < liveBands.length; i++) {
    const band = liveBands[i];
    const byLayer = new Map();
    for (const n of band.leaves.sort((a, b) => pos.get(a.id).y - pos.get(b.id).y)) {
      const k = layerOf.get(n.id); if (!byLayer.has(k)) byLayer.set(k, []); byLayer.get(k).push(n);
    }
    const heights = new Map([...byLayer].map(([k, arr]) => [k, arr.reduce((s, n) => s + n.h, 0) + gapY * (arr.length - 1)]));
    const inner = Math.max(...heights.values());
    band.h = Math.max(inner + 2 * PADY, 70);
    if (i > 0 && liveBands[i - 1].block !== band.block) y += 30;
    band.y = y;
    for (const [k, arr] of byLayer) {
      let cy = y + (band.h - heights.get(k)) / 2;
      for (const n of arr) { n.x = layerX[k] + (lw[k] - n.w) / 2; n.y = cy; cy += n.h + gapY; }
    }
    if (band.block >= 0) { const pb = poolBox.get(band.block) || { top: y, bottom: y }; pb.bottom = y + band.h; poolBox.set(band.block, pb); }
    y += band.h;
  }
  for (const band of liveBands) if (band.lane) {
    const ph = poolHdr(blocks[band.block]);
    Object.assign(band.lane, { x: ph, y: band.y, w: totalW - ph, h: band.h });
  }
  blocks.forEach((b, i) => { if (b.pool && poolBox.has(i)) { const pb = poolBox.get(i); Object.assign(m.nodes.get(b.pool.id), { x: 0, y: pb.top, w: totalW, h: pb.bottom - pb.top }); } });
  const liveIds = new Set([...liveBands.filter(b => b.lane).map(b => b.lane.id), ...blocks.filter((b, i) => b.pool && poolBox.has(i)).map(b => b.pool.id)]);
  for (const [id, n] of [...m.nodes]) if (n.isGroup && !liveIds.has(id)) m.nodes.delete(id);
  m.groups = new Map([...m.nodes].filter(([, n]) => n.isGroup));

  routeLaneEdges(m, leaves, layerOf, layerX, lw, gapX);
  if (axis === 'col') transposeModel(m);
  layoutZones(m, { frameMeta: sub.frameMeta !== false });
  return m;
}

function routeLaneEdges(m, leaves, layerOf, layerX, lw, gapX) {
  const nodes = m.nodes, rects = leaves;
  const fwd = m.edges.filter(e => nodes.has(e.source) && nodes.has(e.target) && layerOf.get(e.target) > layerOf.get(e.source));
  const cy = n => n.y + n.h / 2;
  const spread = (keyOf, otherOf) => {
    const groups = new Map();
    for (const e of fwd) { const k = keyOf(e); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
    const out = new Map();
    for (const arr of groups.values()) {
      arr.sort((a, b) => cy(nodes.get(otherOf(a))) - cy(nodes.get(otherOf(b))));
      arr.forEach((e, i) => out.set(e.id, { f: (i + 1) / (arr.length + 1), rank: i, n: arr.length }));
    }
    return out;
  };
  const backRank = new Map();
  const outS = spread(e => e.source, e => e.target), inS = spread(e => e.target, e => e.source);
  for (const e of m.edges) {
    const sn = nodes.get(e.source), tn = nodes.get(e.target);
    if (!sn || !tn) continue;
    let route;
    if (fwd.includes(e)) {
      const o = outS.get(e.id), i = inS.get(e.id);
      const A = { x: sn.x + sn.w, y: sn.y + sn.h * o.f }, B = { x: tn.x, y: tn.y + tn.h * i.f };
      let best = null;
      for (let j = layerOf.get(e.source); j < layerOf.get(e.target); j++) {
        const c = layerX[j] + lw[j] + gapX / 2 + (o.rank - (o.n - 1) / 2) * 6;
        const pts = Math.abs(A.y - B.y) < 0.5 ? [A, B] : [A, { x: c, y: A.y }, { x: c, y: B.y }, B];
        let score = 0;
        for (let k = 1; k < pts.length; k++) for (const r of rects) if (r !== sn && r !== tn && segHits(pts[k - 1], pts[k], r)) score++;
        if (!best || score < best.score) best = { score, pts };
      }
      route = best.pts;
    } else if (layerOf.get(e.target) < layerOf.get(e.source)) {
      // backward edge: loop over the top so it never runs along the forward connectors between the same shapes
      const k = backRank.get(e.source) || 0; backRank.set(e.source, k + 1);
      let bestB = null;
      for (const side of ['T', 'B']) {
        const pts = orthoPath(sideMid(sn, side), side, sideMid(tn, side), side, 22 + 9 * k);
        let score = 0;
        for (let i = 1; i < pts.length; i++) for (const r of rects) if (r !== sn && r !== tn && segHits(pts[i - 1], pts[i], r)) score++;
        if (!bestB || score < bestB.score) bestB = { score, pts };
      }
      route = bestB.pts;
    } else {
      const [sa, sb] = defaultSides(sn, tn);
      route = orthoPath(sideMid(sn, sa), sa, sideMid(tn, sb), sb);
    }
    e.route = route; e.points = route.slice(1, -1);
  }
}
