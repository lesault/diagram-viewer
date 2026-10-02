import { depthSorted } from './subset.js';

/**
 * Re-layout a sub-model with ELK (layered, left -> right) so a service view reads as
 * inputs -> service -> outputs. Containers become compound nodes. Returns a new model.
 * `ELK` is the elkjs constructor (global in the browser, passed in for tests).
 */
export async function tidyModel(sub, ELK, { direction = 'RIGHT', spacing = 50, focus = null } = {}) {
  const nodes = new Map([...sub.nodes].map(([k, v]) => [k, { ...v }]));
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
  return { nodes, edges: outEdges, groups: sub.groups, diagnostics: sub.diagnostics, focus };
}
