// Build a standalone sub-model (selected nodes + their ancestor containers + the chosen edges).
export function subModel(model, nodeIds, edgeIds, { fitGroups = true, keepGroups = true, zones = null, frameMeta = true } = {}) {
  const nodes = new Map();
  const want = new Set(nodeIds);
  const clone = n => ({ ...n });
  for (const id of want) { const n = model.nodes.get(id); if (n) nodes.set(id, clone(n)); }
  if (keepGroups) {
    for (const id of want) {
      let p = model.nodes.get(id) && model.nodes.get(id).parent;
      while (p && model.nodes.has(p)) { if (!nodes.has(p)) nodes.set(p, clone(model.nodes.get(p))); p = model.nodes.get(p).parent; }
    }
  } else for (const n of nodes.values()) n.parent = null;
  for (const n of nodes.values()) if (n.parent && !nodes.has(n.parent)) n.parent = null;

  const keepEdge = e => (!edgeIds || edgeIds.has(e.id)) && (!e.source || nodes.has(e.source)) && (!e.target || nodes.has(e.target)) && !(e.source && !want.has(e.source)) && !(e.target && !want.has(e.target));
  const edges = model.edges.filter(keepEdge).map(e => ({ ...e }));

  const out = { nodes, edges, groups: new Map(), diagnostics: model.diagnostics };
  // a container is a "group" in the sub-model if it was not itself selected as a lineage node
  for (const n of nodes.values()) {
    const kids = [...nodes.values()].some(c => c.parent === n.id);
    n.isContainer = kids;
    n.isGroup = kids && !want.has(n.id);
    if (n.isGroup) out.groups.set(n.id, n);
  }
  if (fitGroups) fitContainers(out);

  // zone frames: boxes from "context" layers that contain selected shapes (membership by geometry, computed in context.js)
  if (zones) {
    const incl = new Map();
    for (const id of want) for (const z of zones.chain(id)) { if (!incl.has(z)) incl.set(z, new Set()); incl.get(z).add(id); }
    out.zones = [...incl].map(([zid, members]) => {
      let p = zones.zones.get(zid).parent;
      while (p && !incl.has(p)) p = zones.zones.get(p).parent;
      const b = zones.zones.get(zid).node;
      return { id: zid, text: b.text, style: b.style, styleStr: b.styleStr, meta: b.meta, raw: b.raw, members, parent: p };
    });
    out.zoneOf = new Map([...want].filter(id => zones.zoneOf.has(id)).map(id => [id, zones.zoneOf.get(id)]));
  }
  out.frameMeta = frameMeta;
  layoutZones(out, { frameMeta });
  return out;
}

const depthOf = (nodes, n) => { let d = 0; while (n.parent && nodes.has(n.parent)) { n = nodes.get(n.parent); d++; } return d; };

/**
 * Detect swimlane structure: a "pool" (root group whose children are groups) holding lanes, or
 * several sibling root swimlanes. axis 'row' = header on the left (horizontal=0), else 'col'.
 * Lanes come back ordered by position along the stacking axis.
 */
export function findLanes(m) {
  const all = [...m.nodes.values()];
  const groups = all.filter(n => n.isGroup);
  const roots = groups.filter(g => !g.parent || !m.nodes.has(g.parent));
  const kidGroups = g => groups.filter(c => c.parent === g.id);
  let blocks = roots.filter(r => kidGroups(r).length).map(p => ({ pool: p, lanes: kidGroups(p) }));
  if (!blocks.length) {
    const sw = roots.filter(r => r.style.swimlane);
    if (sw.length < 2) return null;
    blocks = [{ pool: null, lanes: sw }];
  }
  const axis = blocks[0].lanes[0].style.horizontal === '0' ? 'row' : 'col';
  const key = axis === 'row' ? 'y' : 'x';
  for (const b of blocks) b.lanes.sort((p, q) => p[key] - q[key]);
  blocks.sort((p, q) => (p.pool || p.lanes[0])[key] - (q.pool || q.lanes[0])[key]);
  return { blocks, axis };
}

export function fitContainers(m, pad = 20, header = 30) {
  const list = [...m.nodes.values()].filter(n => n.isContainer).sort((a, b) => depthOf(m.nodes, b) - depthOf(m.nodes, a));
  for (const g of list) {
    const ch = [...m.nodes.values()].filter(c => c.parent === g.id);
    if (!ch.length) continue;
    const x0 = Math.min(...ch.map(c => c.x)), y0 = Math.min(...ch.map(c => c.y));
    const x1 = Math.max(...ch.map(c => c.x + c.w)), y1 = Math.max(...ch.map(c => c.y + c.h));
    g.x = x0 - pad; g.y = y0 - pad - header; g.w = x1 - x0 + 2 * pad; g.h = y1 - y0 + 2 * pad + header;
  }
  const lanes = findLanes(m);
  if (lanes) for (const b of lanes.blocks) fitLaneBlock(m, b, lanes.axis, pad);
}

// Lanes become full-width bands that touch each other; the pool wraps them. Works for rows and columns.
function fitLaneBlock(m, { pool, lanes }, axis, pad) {
  const R = axis === 'row' ? { st: 'y', sz: 'h', al: 'x', az: 'w' } : { st: 'x', sz: 'w', al: 'y', az: 'h' };
  const live = lanes.filter(l => [...m.nodes.values()].some(c => c.parent === l.id));
  if (!live.length) return;
  const ext = l => {
    const ch = [...m.nodes.values()].filter(c => c.parent === l.id);
    return { s0: Math.min(...ch.map(c => c[R.st])), s1: Math.max(...ch.map(c => c[R.st] + c[R.sz])), a0: Math.min(...ch.map(c => c[R.al])), a1: Math.max(...ch.map(c => c[R.al] + c[R.az])) };
  };
  const e = live.map(ext), hdr = live.map(l => +l.style.startSize || 23);
  const A0 = Math.min(...e.map((q, i) => q.a0 - pad - hdr[i])), A1 = Math.max(...e.map(q => q.a1 + pad));
  const bound = [e[0].s0 - pad];
  for (let i = 1; i < live.length; i++) bound.push((e[i - 1].s1 + pad + e[i].s0 - pad) / 2);
  bound.push(e[e.length - 1].s1 + pad);
  live.forEach((l, i) => { l[R.al] = A0; l[R.az] = A1 - A0; l[R.st] = bound[i]; l[R.sz] = bound[i + 1] - bound[i]; });
  for (const l of lanes) if (!live.includes(l)) m.nodes.delete(l.id);
  if (pool) { const ph = +pool.style.startSize || 23; pool[R.al] = A0 - ph; pool[R.az] = A1 - A0 + ph; pool[R.st] = bound[0]; pool[R.sz] = bound[live.length] - bound[0]; }
}

const textW = (t, fs) => String(t).length * fs * 0.58;

/**
 * Compute zone frames from the current node positions: each frame wraps its member shapes (and its child frames)
 * with padding, plus a header for the zone's name and (optionally) its properties. Call again after any re-layout.
 */
export function layoutZones(m, { frameMeta = true, pad = 14 } = {}) {
  const zs = m.zones || [];
  m.frames = [];
  if (!zs.length) return m.frames;
  const byId = new Map(zs.map(z => [z.id, z]));
  const kids = new Map(zs.map(z => [z.id, []]));
  for (const z of zs) if (z.parent && byId.has(z.parent)) kids.get(z.parent).push(z.id);
  const height = new Map();
  const h = id => { if (!height.has(id)) height.set(id, kids.get(id).length ? 1 + Math.max(...kids.get(id).map(h)) : 0); return height.get(id); };
  zs.forEach(z => h(z.id));
  const frames = new Map();
  for (const z of [...zs].sort((a, b) => height.get(a.id) - height.get(b.id))) {
    const rects = [...z.members].map(id => m.nodes.get(id)).filter(Boolean);
    for (const c of kids.get(z.id)) if (frames.has(c)) rects.push(frames.get(c));
    if (!rects.length) continue;
    const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
    const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
    const lines = frameMeta ? Object.entries(z.meta || {}).slice(0, 5).map(([k, v]) => `${k}: ${v}`) : [];
    const title = String(z.text || '').split('\n')[0];
    const head = 20 + lines.length * 12;
    const f = { id: z.id, x: x0 - pad, y: y0 - pad - head, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad + head, title, lines, style: z.style, depth: height.get(z.id) };
    const need = Math.max(textW(title, 12), ...lines.map(l => textW(l, 10))) + 24;
    if (f.w < need) { f.x -= (need - f.w) / 2; f.w = need; }
    frames.set(z.id, f);
  }
  m.frames = [...frames.values()].sort((a, b) => b.depth - a.depth);   // outermost first
  return m.frames;
}

export const depthSorted = m => [...m.nodes.values()].sort((a, b) => depthOf(m.nodes, a) - depthOf(m.nodes, b) || a.order - b.order);
