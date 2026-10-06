// Layer handling: visibility filtering, and "context" layers whose boxes frame the shapes they contain.

const centre = n => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const within = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const area = n => n.w * n.h;

/**
 * Layers worth framing sub-views with: no connectors of their own, and at least one shape whose
 * rectangle contains the centre of a shape on another layer (e.g. network zones drawn behind services).
 */
export function suggestContextLayers(model) {
  const out = [];
  for (const l of model.layers || []) {
    if (l.edges) continue;
    const mine = [...model.nodes.values()].filter(n => n.layer === l.id && !n.style.text);
    const others = [...model.nodes.values()].filter(n => n.layer !== l.id && !n.isGroup);
    if (mine.some(b => others.some(o => within(centre(o), b)))) out.push(l.id);
  }
  return out;
}

/**
 * A copy of the model restricted to visible layers. Connectors whose end shapes are on hidden layers are dropped
 * (connectors that were already unattached are kept). Shapes on context layers that have no connectors are flagged
 * `ctxBox`: they are drawn behind everything, ignored by lineage, and used as zone frames in sub-views.
 */
export function filterLayers(model, { hidden = new Set(), context = new Set() } = {}) {
  const vis = id => !hidden.has(id);
  const nodes = new Map();
  for (const [id, n] of model.nodes) if (vis(n.layer)) nodes.set(id, { ...n, ctxBox: false });
  const edges = [];
  for (const e of model.edges) {
    if (!vis(e.layer)) continue;
    if ((e.source && model.nodes.has(e.source) && !nodes.has(e.source)) || (e.target && model.nodes.has(e.target) && !nodes.has(e.target))) continue;
    edges.push({ ...e });
  }
  const attached = new Set();
  for (const e of edges) { if (e.source) attached.add(e.source); if (e.target) attached.add(e.target); }
  for (const n of nodes.values()) {
    n.ctxBox = context.has(n.layer) && !n.isGroup && !attached.has(n.id) && !n.style.text;
    if (n.ctxBox) n.isContainer = false;
  }
  const groups = new Map([...nodes].filter(([, n]) => n.isGroup));
  return { nodes, edges, groups, layers: model.layers, diagnostics: model.diagnostics };
}

/**
 * Zone membership by geometry. A leaf shape is inside a zone when its centre is inside the zone box; zones nest by the
 * same rule (smallest enclosing box is the parent).
 * Returns { zones: Map<id, {id,node,members:Set,parent,children:[]}>, zoneOf: Map<nodeId, innermostZoneId>, chain(nodeId) }.
 */
export function computeZones(model) {
  const boxes = [...model.nodes.values()].filter(n => n.ctxBox).sort((a, b) => area(a) - area(b));
  const leaves = [...model.nodes.values()].filter(n => !n.isGroup && !n.ctxBox && !n.isContainer);
  const zones = new Map(boxes.map(b => [b.id, { id: b.id, node: b, members: new Set(), parent: null, children: [] }]));
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i], c = centre(b);
    for (let j = i + 1; j < boxes.length; j++) {
      const o = boxes[j];
      if (area(o) > area(b) && within(c, o)) { zones.get(b.id).parent = o.id; zones.get(o.id).children.push(b.id); break; }
    }
  }
  const zoneOf = new Map();
  const chain = id => { const out = []; for (let z = zoneOf.get(id); z; z = zones.get(z).parent) out.push(z); return out; };
  for (const n of leaves) {
    const c = centre(n), inner = boxes.find(b => within(c, b));
    if (inner) zoneOf.set(n.id, inner.id);
  }
  for (const n of leaves) for (const z of chain(n.id)) zones.get(z).members.add(n.id);
  return { zones, zoneOf, chain };
}
