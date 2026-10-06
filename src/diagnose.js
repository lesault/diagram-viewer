import { buildGraph } from './graph.js';
import { findLanes } from './subset.js';
import { routeMetrics } from './router.js';

// Checks on the main diagram. Pure: takes the (layer-filtered) model and returns findings the UI can list,
// highlight and export. severity: error | warn | info.

const label = n => (n.text || '').split('\n')[0].trim() || `(${n.id})`;

export function diagnose(model, { metaKey = null, zones = null, routes = true } = {}) {
  const graph = buildGraph(model);
  const services = [...model.nodes.values()].filter(n => !n.isGroup && !n.ctxBox && !n.style.text);
  const svc = new Map(services.map(n => [n.id, n]));
  const nm = id => (model.nodes.has(id) ? label(model.nodes.get(id)) : id);
  const elabel = e => `${e.label ? `“${e.label.split('\n')[0]}” ` : ''}${e.source ? nm(e.source) : '∅'} → ${e.target ? nm(e.target) : '∅'}`;
  const findings = [];
  const add = (id, severity, title, help, items) => { if (items.length) findings.push({ id, severity, title, help, items }); };
  const nodeItem = n => ({ label: label(n), nodes: [n.id], edges: [] });
  const edgeItem = (e, note) => ({ label: elabel(e), nodes: [e.source, e.target].filter(Boolean), edges: [e.id], note });

  // ---- connector attachment
  const free = model.edges.filter(e => !e.source && !e.target);
  add('free-edges', 'error', 'Connectors attached at neither end', 'These lines are not connected to any shape, so they carry no lineage. Glue both ends to shapes in draw.io.',
    free.map(e => ({ ...edgeItem(e), point: e.srcPoint || e.tgtPoint || e.points[0] || null })));
  const dangling = model.edges.filter(e => !!e.source !== !!e.target);
  add('dangling', 'error', 'Connectors attached at only one end', 'Lineage stops at the loose end. Connect it to the missing shape.', dangling.map(e => edgeItem(e, e.source ? 'no target' : 'no source')));
  add('inferred', 'warn', 'Connectors attached by proximity only', 'The line ends near a shape but is not glued to it; the viewer assumed the nearest shape. Re-attach them in draw.io so other tools agree.',
    model.edges.filter(e => e.inferred && e.source && e.target).map(e => edgeItem(e)));
  add('self-loops', 'warn', 'Connectors that start and end on the same shape', 'Usually an accidental drag; ignored by lineage.', model.edges.filter(e => e.source && e.source === e.target).map(e => edgeItem(e)));
  const toContainer = model.edges.filter(e => [e.source, e.target].some(id => id && model.nodes.get(id) && model.nodes.get(id).isContainer));
  add('container-edges', 'warn', 'Connectors attached to a container, not a service', 'The line ends on a box that also holds other shapes. Attach it to the service inside, or the container is treated as one service.', toContainer.map(e => edgeItem(e)));

  // ---- connector semantics
  const real = model.edges.filter(e => e.source && e.target && e.source !== e.target && svc.has(e.source) && svc.has(e.target));
  const dup = new Map();
  for (const e of real) { const k = e.source + '>' + e.target; (dup.get(k) || dup.set(k, []).get(k)).push(e); }
  add('duplicate-edges', 'warn', 'Repeated connectors between the same two shapes', 'Merge them (and combine their labels) or confirm they are different flows.',
    [...dup.values()].filter(g => g.length > 1).map(g => ({ label: `${nm(g[0].source)} → ${nm(g[0].target)} ×${g.length}`, nodes: [g[0].source, g[0].target], edges: g.map(e => e.id), note: g.map(e => e.label || '(no label)').join(' | ') })));
  const recip = [];
  for (const [k, g] of dup) { const [s, t] = k.split('>'); if (s < t && dup.has(t + '>' + s)) recip.push({ label: `${nm(s)} ⇄ ${nm(t)}`, nodes: [s, t], edges: [...g, ...dup.get(t + '>' + s)].map(e => e.id) }); }
  add('reciprocal', 'info', 'Two-way flows drawn as two connectors', 'Fine for request/response, but check both directions are intended.', recip);
  add('undirected', 'warn', 'Connectors with no arrowheads', 'Direction is unknown, so lineage treats them as two-way and upstream/downstream results are inflated.', real.filter(e => e.undirected).map(e => edgeItem(e)));
  add('unlabelled-edges', 'info', 'Connectors with no label', 'Label what flows (data type, protocol) so exported views are self-explanatory.', real.filter(e => !e.label).map(e => edgeItem(e)));

  // ---- shapes
  add('unlabelled-shapes', 'warn', 'Shapes with no label', 'Exported views will show blank boxes.', services.filter(n => !n.text.trim()).map(n => ({ label: `(${n.id})`, nodes: [n.id], edges: [] })));
  const connected = new Set(); for (const e of real) { connected.add(e.source); connected.add(e.target); }
  add('unconnected', 'warn', 'Shapes with no connectors', 'Not part of any lineage. Connect, or remove if obsolete.', services.filter(n => !connected.has(n.id) && !n.isContainer && n.text.trim()).map(nodeItem));
  const byLabel = new Map();
  for (const n of services) { const t = n.text.trim(); if (t) (byLabel.get(t) || byLabel.set(t, []).get(t)).push(n.id); }
  add('duplicate-labels', 'warn', 'Shapes sharing a label', 'They are separate in lineage but indistinguishable in lists and exports. Rename, or confirm they are different things.',
    [...byLabel].filter(([, ids]) => ids.length > 1).map(([t, ids]) => ({ label: `${t.split('\n')[0]} ×${ids.length}`, nodes: ids, edges: [] })));

  // overlapping shapes
  const ov = [];
  for (let i = 0; i < services.length; i++) for (let j = i + 1; j < services.length; j++) {
    const a = services[i], b = services[j];
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w > 2 && h > 2 && w * h > 0.1 * Math.min(a.w * a.h, b.w * b.h) && !(a.isContainer || b.isContainer)) ov.push({ label: `${label(a)} / ${label(b)}`, nodes: [a.id, b.id], edges: [] });
  }
  add('overlapping-shapes', 'warn', 'Overlapping shapes', 'One shape may be hiding another (or a duplicate was pasted on top).', ov);

  // ---- connectivity
  const nbr = new Map(services.map(n => [n.id, new Set()]));
  for (const e of real) { nbr.get(e.source).add(e.target); nbr.get(e.target).add(e.source); }
  const comps = [], seen = new Set();
  for (const n of services) {
    if (seen.has(n.id) || !nbr.get(n.id).size) continue;
    const comp = []; const q = [n.id]; seen.add(n.id);
    while (q.length) { const id = q.pop(); comp.push(id); for (const m of nbr.get(id)) if (!seen.has(m)) { seen.add(m); q.push(m); } }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  add('islands', 'warn', `Disconnected groups (${comps.length} in total)`, 'The diagram is split into separate islands; lineage cannot cross between them. The largest is treated as the main diagram.',
    comps.slice(1).map(c => ({ label: `${c.length} shapes: ${c.slice(0, 4).map(nm).join(', ')}${c.length > 4 ? '…' : ''}`, nodes: c, edges: [] })));

  const hasIn = n => graph.inn.get(n.id).length > 0, hasOut = n => graph.out.get(n.id).length > 0;
  add('sources', 'info', 'Origins: shapes with outputs but no inputs', 'Expected for real data sources; anything else may be missing an inbound connector.', services.filter(n => hasOut(n) && !hasIn(n)).map(nodeItem));
  add('sinks', 'info', 'Dead ends: shapes with inputs but no outputs', 'Expected for stores and reports; processing services that end here may be missing an outbound connector.', services.filter(n => hasIn(n) && !hasOut(n)).map(nodeItem));

  // hubs
  const deg = services.map(n => ({ n, d: nbr.get(n.id).size })).sort((a, b) => b.d - a.d);
  const med = deg.length ? deg[Math.floor(deg.length / 2)].d : 0, thr = Math.max(6, med * 2.5);
  add('hubs', 'info', 'Highly connected shapes (hubs)', 'Lineage through these shapes fans out widely. Right-click a hub to stop traces passing through it.',
    deg.filter(x => x.d >= thr).slice(0, 10).map(x => ({ label: `${label(x.n)} (${x.d} neighbours)`, nodes: [x.n.id], edges: [] })));

  // articulation points (single points of connectivity)
  const ap = articulationPoints(nbr);
  const partsAfter = id => {
    const sn = new Set([id]); let parts = 0; const sizes = [];
    for (const s of nbr.get(id)) { if (sn.has(s)) continue; let c = 0; const q = [s]; sn.add(s); while (q.length) { const x = q.pop(); c++; for (const m of nbr.get(x)) if (!sn.has(m)) { sn.add(m); q.push(m); } } parts++; sizes.push(c); }
    return sizes.sort((a, b) => b - a);
  };
  add('cut-points', 'info', 'Single points of connectivity', 'Removing one of these shapes disconnects part of the diagram: candidates for resilience or ownership review.',
    ap.map(id => ({ id, sizes: partsAfter(id) })).filter(x => x.sizes.length > 1).sort((a, b) => b.sizes.length - a.sizes.length || b.sizes[1] - a.sizes[1]).slice(0, 15)
      .map(x => ({ label: `${nm(x.id)} → splits into ${x.sizes.length} parts (${x.sizes.slice(0, 4).join(' / ')}${x.sizes.length > 4 ? '…' : ''})`, nodes: [x.id], edges: [] })));

  // lanes
  const lanes = findLanes(model);
  if (lanes) {
    const inLane = new Set();
    for (const b of lanes.blocks) for (const l of b.lanes) for (const n of services) { let p = n.parent; while (p) { if (p === l.id) { inLane.add(n.id); break; } p = model.nodes.get(p) && model.nodes.get(p).parent; } }
    add('outside-lanes', 'warn', 'Shapes outside every swimlane', 'In a swimlane diagram each service should sit in a lane.', services.filter(n => !inLane.has(n.id) && !n.isContainer).map(nodeItem));
  }

  // zones from context layers
  if (zones && zones.zones.size) {
    add('outside-zones', 'warn', 'Shapes not inside any zone box', 'No box on a context layer contains these shapes, so sub-views will not show their zone.', services.filter(n => !zones.zoneOf.has(n.id) && !n.isContainer).map(nodeItem));
    add('empty-zones', 'info', 'Zone boxes containing no shapes', 'Unused or misplaced boxes on a context layer.', [...zones.zones.values()].filter(z => !z.members.size).map(z => ({ label: label(z.node), nodes: [z.node.id], edges: [] })));
  }

  // metadata completeness
  const keys = new Map();
  for (const n of services) for (const k of Object.keys(n.meta || {})) keys.set(k, (keys.get(k) || 0) + 1);
  const metaKeys = [...keys].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ key: k, count: c }));
  if (metaKey) add('missing-property', 'warn', `Shapes missing “${metaKey}”`, 'Fill in the draw.io property (Edit Data) so reports and filters are complete.', services.filter(n => !(n.meta && String(n.meta[metaKey] || '').trim())).map(nodeItem));

  // layers
  const info = [];
  for (const l of model.layers || []) if (!l.nodes && !l.edges) info.push({ label: `Layer “${l.name}” is empty`, nodes: [], edges: [] });
  add('empty-layers', 'info', 'Empty layers', 'Candidates for clean-up.', info);

  // routing quality
  if (routes) {
    const m = routeMetrics(model);
    add('through-shapes', 'warn', 'Connectors drawn through other shapes', 'The line crosses a shape that is not one of its ends, which makes it look connected to it. Use Tidy to reroute connectors.',
      m.through.map(t => { const e = model.edges.find(x => x.id === t.edge); return { label: `${elabel(e)} passes through ${nm(t.node)}`, nodes: [t.node], edges: [t.edge] }; }));
    if (m.overlaps > 0) findings.push({ id: 'overlapping-lines', severity: 'info', title: 'Connectors running on top of each other', help: `${m.overlaps} places where lines overlap and look like one. Tidy spreads them apart.`, items: [] });
  }

  const order = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] += f.items.length || 1;
  return { findings, counts, metaKeys, summary: { shapes: services.length, connectors: model.edges.length, islands: comps.length, layers: (model.layers || []).length } };
}

// iterative Tarjan on an undirected adjacency map
function articulationPoints(nbr) {
  const disc = new Map(), low = new Map(), out = new Set();
  let t = 0;
  for (const root of nbr.keys()) {
    if (disc.has(root)) continue;
    let rootKids = 0;
    const stack = [{ id: root, parent: null, it: [...nbr.get(root)][Symbol.iterator]() }];
    disc.set(root, ++t); low.set(root, t);
    while (stack.length) {
      const f = stack[stack.length - 1], nx = f.it.next();
      if (nx.done) {
        stack.pop();
        if (stack.length) {
          const p = stack[stack.length - 1];
          low.set(p.id, Math.min(low.get(p.id), low.get(f.id)));
          if (p.id !== root && low.get(f.id) >= disc.get(p.id)) out.add(p.id);
        }
        continue;
      }
      const m = nx.value;
      if (m === f.parent) continue;
      if (disc.has(m)) low.set(f.id, Math.min(low.get(f.id), disc.get(m)));
      else { disc.set(m, ++t); low.set(m, t); if (f.id === root) rootKids++; stack.push({ id: m, parent: f.id, it: [...nbr.get(m)][Symbol.iterator]() }); }
    }
    if (rootKids > 1) out.add(root);
  }
  return [...out];
}

const sevMark = { error: 'ERROR', warn: 'WARN', info: 'INFO' };

export function findingsToMarkdown(result, { file = '', page = '' } = {}) {
  const L = [`# Diagram checks${file ? ` — ${file}` : ''}${page ? ` (${page})` : ''}`, '',
    `${result.summary.shapes} shapes · ${result.summary.connectors} connectors · ${result.summary.layers} layers`, '',
    `Errors: ${result.counts.error} · Warnings: ${result.counts.warn} · Notes: ${result.counts.info}`, ''];
  for (const f of result.findings) {
    L.push(`## [${sevMark[f.severity]}] ${f.title}`, '', f.help, '');
    for (const it of f.items.slice(0, 200)) L.push(`- ${it.label}${it.note ? ` — ${it.note}` : ''}`);
    if (f.items.length > 200) L.push(`- … ${f.items.length - 200} more`);
    L.push('');
  }
  return L.join('\n');
}

export function findingsToCsv(result) {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['severity', 'check', 'item', 'note', 'shape_ids', 'connector_ids'].join(',')];
  for (const f of result.findings) for (const it of (f.items.length ? f.items : [{ label: f.help, nodes: [], edges: [] }]))
    rows.push([f.severity, q(f.title), q(it.label), q(it.note || ''), q(it.nodes.join(' ')), q(it.edges.join(' '))].join(','));
  return rows.join('\n');
}
