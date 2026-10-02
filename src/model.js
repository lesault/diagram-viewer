import { kids, kid, decodeEntities } from './xml.js';

export function parseStyle(str) {
  const m = {};
  for (const part of (str || '').split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) m[part] = true; else m[part.slice(0, i)] = part.slice(i + 1);
  }
  return m;
}

export function htmlToText(v, isHtml) {
  if (!v) return '';
  if (!isHtml) return v;
  return decodeEntities(v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();
}

const num = (v, d = 0) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

function ptsOf(geo) {
  if (!geo) return { points: [], src: null, tgt: null };
  const arr = geo.children.find(c => c.tag === 'Array' && c.attrs.as === 'points');
  const points = arr ? kids(arr, 'mxPoint').map(p => ({ x: num(p.attrs.x), y: num(p.attrs.y) })) : [];
  const pt = as => { const p = geo.children.find(c => c.tag === 'mxPoint' && c.attrs.as === as); return p ? { x: num(p.attrs.x), y: num(p.attrs.y) } : null; };
  return { points, src: pt('sourcePoint'), tgt: pt('targetPoint') };
}

const distToBox = (p, n) => {
  const dx = Math.max(n.x - p.x, 0, p.x - (n.x + n.w));
  const dy = Math.max(n.y - p.y, 0, p.y - (n.y + n.h));
  return Math.hypot(dx, dy);
};

/**
 * Normalise an <mxGraphModel> into { nodes, edges, groups, diagnostics }.
 * nodes: every vertex except pure containers & edge labels (the lineage graph).
 * groups: vertices that contain other vertices and have no edges of their own.
 */
export function buildModel(graphEl, { snapTolerance = 24 } = {}) {
  const rootEl = kid(graphEl, 'root');
  const cells = new Map();
  for (const el of rootEl ? rootEl.children : []) {
    let cell = el, meta = null, label = null;
    if (el.tag === 'object' || el.tag === 'UserObject') {
      cell = kid(el, 'mxCell');
      if (!cell) continue;
      meta = { ...el.attrs };
      label = meta.label; delete meta.label; delete meta.id;
    } else if (el.tag !== 'mxCell') continue;
    const a = cell.attrs;
    const id = el.attrs.id || a.id;
    const geo = kid(cell, 'mxGeometry');
    const style = a.style || '';
    const sm = parseStyle(style);
    cells.set(id, {
      id, parent: a.parent, vertex: a.vertex === '1', edge: a.edge === '1',
      source: a.source, target: a.target, styleStr: style, style: sm,
      raw: label !== null ? label : (a.value || el.attrs.label || ''), meta,
      geo: geo ? { x: num(geo.attrs.x), y: num(geo.attrs.y), w: num(geo.attrs.width), h: num(geo.attrs.height), relative: geo.attrs.relative === '1', ...ptsOf(geo) } : null,
    });
  }

  // absolute origin of a parent chain (vertex parents only; layers/root contribute 0)
  const origin = id => {
    let x = 0, y = 0, c = cells.get(id), guard = 0;
    while (c && c.vertex && guard++ < 100) { x += c.geo ? c.geo.x : 0; y += c.geo ? c.geo.y : 0; c = cells.get(c.parent); }
    return { x, y };
  };

  const diagnostics = { inferredEdges: [], danglingEdges: [], unconnected: [], duplicateLabels: [] };
  const vertices = [...cells.values()].filter(c => c.vertex);
  const childOfVertex = new Set();
  for (const v of vertices) { const p = cells.get(v.parent); if (p && p.vertex) childOfVertex.add(p.id); }
  const isEdgeLabel = v => { const p = cells.get(v.parent); return v.style.edgeLabel || (p && p.edge); };

  const nodes = new Map();
  for (const v of vertices) {
    if (isEdgeLabel(v)) continue;
    const o = origin(cells.get(v.parent) ? v.parent : null);
    const isHtml = v.style.html === '1';
    const text = htmlToText(v.raw, isHtml);
    nodes.set(v.id, {
      id: v.id, raw: v.raw, text, html: isHtml, style: v.style, styleStr: v.styleStr, meta: v.meta || {},
      x: (v.geo ? v.geo.x : 0) + o.x, y: (v.geo ? v.geo.y : 0) + o.y,
      w: v.geo ? v.geo.w : 80, h: v.geo ? v.geo.h : 40,
      parent: cells.get(v.parent) && cells.get(v.parent).vertex ? v.parent : null,
      isContainer: childOfVertex.has(v.id), order: nodes.size,
    });
  }

  const edgeLabelFor = new Map();
  for (const v of vertices) if (isEdgeLabel(v) && cells.get(v.parent)) edgeLabelFor.set(v.parent, htmlToText(v.raw, v.style.html === '1'));

  const edges = [];
  for (const c of cells.values()) {
    if (!c.edge) continue;
    const o = origin(cells.get(c.parent) && cells.get(c.parent).vertex ? c.parent : null);
    const shift = p => p && { x: p.x + o.x, y: p.y + o.y };
    let source = c.source && nodes.has(c.source) ? c.source : null;
    let target = c.target && nodes.has(c.target) ? c.target : null;
    const g = c.geo || { points: [], src: null, tgt: null };
    const points = g.points.map(shift);
    let inferred = false;
    const snap = (pt) => {
      if (!pt) return null;
      // leaf shapes within tolerance win; a container is only used if no leaf is close
      let best = null, bd = snapTolerance;
      for (const n of nodes.values()) {
        if (n.isContainer) continue;
        const d = distToBox(pt, n);
        if (d < bd) { bd = d; best = n; }
      }
      if (!best) for (const n of nodes.values()) {
        if (!n.isContainer) continue;
        if (distToBox(pt, n) === 0 && (!best || n.w * n.h < best.w * best.h)) best = n;
      }
      return best ? best.id : null;
    };
    if (!source) { const s = snap(shift(g.src) || points[0]); if (s) { source = s; inferred = true; } }
    if (!target) { const t = snap(shift(g.tgt) || points[points.length - 1]); if (t) { target = t; inferred = true; } }
    const e = {
      id: c.id, source, target, style: c.style, styleStr: c.styleStr, points, inferred,
      srcPoint: shift(g.src), tgtPoint: shift(g.tgt),
      label: htmlToText(c.raw, c.style.html === '1') || edgeLabelFor.get(c.id) || '', rawLabel: c.raw, meta: c.meta || {},
    };
    const fwd = c.style.endArrow !== 'none', back = c.style.startArrow !== undefined && c.style.startArrow !== 'none';
    e.fwd = fwd; e.back = back;
    e.undirected = !fwd && !back;
    if (!source || !target) { diagnostics.danglingEdges.push(e.id); if (!source && !target) continue; }
    if (inferred) diagnostics.inferredEdges.push(e.id);
    edges.push(e);
  }

  // containers with no edges are pure groups; containers with edges stay lineage nodes
  const hasEdge = new Set();
  for (const e of edges) { if (e.source) hasEdge.add(e.source); if (e.target) hasEdge.add(e.target); }
  const groups = new Map();
  for (const n of nodes.values()) {
    n.isGroup = n.isContainer && !hasEdge.has(n.id);
    if (n.isGroup) groups.set(n.id, n);
  }
  const labels = new Map();
  for (const n of nodes.values()) {
    if (n.isGroup) continue;
    if (!hasEdge.has(n.id)) diagnostics.unconnected.push(n.id);
    const t = n.text.trim();
    if (t) labels.set(t, (labels.get(t) || []).concat(n.id));
  }
  for (const [t, ids] of labels) if (ids.length > 1) diagnostics.duplicateLabels.push({ label: t, ids });

  // drop edges whose only resolved end is a group-less ghost; keep the rest
  return { nodes, edges, groups, diagnostics };
}
