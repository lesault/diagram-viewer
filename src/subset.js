// Build a standalone sub-model (selected nodes + their ancestor containers + the chosen edges).
export function subModel(model, nodeIds, edgeIds, { fitGroups = true, keepGroups = true } = {}) {
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
  return out;
}

const depthOf = (nodes, n) => { let d = 0; while (n.parent && nodes.has(n.parent)) { n = nodes.get(n.parent); d++; } return d; };

export function fitContainers(m, pad = 20, header = 30) {
  const list = [...m.nodes.values()].filter(n => n.isContainer).sort((a, b) => depthOf(m.nodes, b) - depthOf(m.nodes, a));
  for (const g of list) {
    const ch = [...m.nodes.values()].filter(c => c.parent === g.id);
    if (!ch.length) continue;
    const x0 = Math.min(...ch.map(c => c.x)), y0 = Math.min(...ch.map(c => c.y));
    const x1 = Math.max(...ch.map(c => c.x + c.w)), y1 = Math.max(...ch.map(c => c.y + c.h));
    g.x = x0 - pad; g.y = y0 - pad - header; g.w = x1 - x0 + 2 * pad; g.h = y1 - y0 + 2 * pad + header;
  }
}

export const depthSorted = m => [...m.nodes.values()].sort((a, b) => depthOf(m.nodes, a) - depthOf(m.nodes, b) || a.order - b.order);
