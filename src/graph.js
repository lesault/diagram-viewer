// Direction-aware lineage over a normalised model.
export function buildGraph(model) {
  const out = new Map(), inn = new Map();
  for (const id of model.nodes.keys()) { out.set(id, []); inn.set(id, []); }
  const link = (a, b, e) => {
    if (!out.has(a) || !inn.has(b) || a === b) return;
    out.get(a).push({ edge: e, to: b }); inn.get(b).push({ edge: e, to: a });
  };
  for (const e of model.edges) {
    if (!e.source || !e.target) continue;
    if (e.fwd || e.undirected) link(e.source, e.target, e);
    if (e.back || e.undirected) link(e.target, e.source, e);
  }
  return { out, inn };
}

function walk(adj, start, depth, blocked, res) {
  const seen = new Map([[start, 0]]);
  let frontier = [start];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      if (id !== start && blocked && blocked.has(id)) continue; // shown, but not traversed through
      for (const { edge, to } of adj.get(id) || []) {
        res.edges.add(edge.id);
        if (!seen.has(to)) { seen.set(to, d); next.push(to); }
      }
    }
    frontier = next;
  }
  for (const [id, d] of seen) {
    const prev = res.nodes.get(id);
    if (prev === undefined || d < prev) res.nodes.set(id, d);
  }
}

/**
 * lineage(graph, startId, {direction:'up'|'down'|'both', depth, blocked})
 * -> { nodes: Map<id, hops>, edges: Set<edgeId>, up: Set, down: Set }
 * 'both' is the union of an upstream and a downstream walk from the start,
 * so lineage never leaks sideways through shared hubs.
 */
export function lineage(graph, start, { direction = 'both', depth = 2, blocked = null } = {}) {
  const res = { nodes: new Map(), edges: new Set() };
  if (!graph.out.has(start)) return res;
  if (direction === 'down' || direction === 'both') walk(graph.out, start, depth, blocked, res);
  if (direction === 'up' || direction === 'both') walk(graph.inn, start, depth, blocked, res);
  return res;
}

// All simple paths/shortest path helper for the path finder (shortest only, directed)
export function shortestPath(graph, a, b) {
  if (!graph.out.has(a) || !graph.out.has(b)) return null;
  const prev = new Map([[a, null]]); const q = [a];
  while (q.length) {
    const id = q.shift();
    if (id === b) break;
    for (const { edge, to } of graph.out.get(id)) if (!prev.has(to)) { prev.set(to, { id, edge }); q.push(to); }
  }
  if (!prev.has(b)) return null;
  const nodes = [], edges = [];
  for (let c = b; c; ) { nodes.unshift(c); const p = prev.get(c); if (p) edges.unshift(p.edge.id); c = p ? p.id : null; }
  return { nodes, edges };
}

/** Connectors arriving at / leaving a shape (an undirected or two-way connector counts in both). */
export function countConnections(graph, id) {
  return { in: graph.inn.has(id) ? graph.inn.get(id).length : 0, out: graph.out.has(id) ? graph.out.get(id).length : 0 };
}
