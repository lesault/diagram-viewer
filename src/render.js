import { depthSorted } from './subset.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const color = (v, d) => (v === undefined || v === 'default' ? d : v);

export function wrapLines(text, maxW, fs) {
  const cw = fs * 0.56, maxChars = Math.max(3, Math.floor(maxW / cw));
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((cur + ' ' + word).trim().length <= maxChars) cur = (cur + ' ' + word).trim();
      else { if (cur) lines.push(cur); cur = word; while (cur.length > maxChars) { lines.push(cur.slice(0, maxChars)); cur = cur.slice(maxChars); } }
    }
    lines.push(cur);
  }
  return lines;
}

function textEl(text, cx, cy, maxW, style, { top = false } = {}) {
  if (!text) return '';
  const fs = +style.fontSize || 12, fill = color(style.fontColor, '#000');
  const lines = wrapLines(text, maxW, fs), lh = fs * 1.25;
  const anchor = style.align === 'left' ? 'start' : style.align === 'right' ? 'end' : 'middle';
  const bold = (+style.fontStyle & 1) ? ' font-weight="bold"' : '', ital = (+style.fontStyle & 2) ? ' font-style="italic"' : '';
  const y0 = top ? cy + fs : cy - ((lines.length - 1) * lh) / 2 + fs * 0.35;
  const tspans = lines.map((l, i) => `<tspan x="${cx}" y="${(y0 + i * lh).toFixed(1)}">${esc(l)}</tspan>`).join('');
  return `<text text-anchor="${anchor}" font-family="Helvetica,Arial,sans-serif" font-size="${fs}" fill="${fill}"${bold}${ital}>${tspans}</text>`;
}

function shapeKind(s) {
  const sh = typeof s.shape === 'string' ? s.shape : '';
  if (s.ellipse || sh === 'ellipse' || sh === 'cloud' || /doubleEllipse|terminator/.test(sh) && false) return 'ellipse';
  if (s.rhombus || sh === 'rhombus') return 'rhombus';
  if (/^cylinder|database/.test(sh)) return 'cylinder';
  if (sh === 'hexagon') return 'hexagon';
  if (sh === 'parallelogram') return 'parallelogram';
  if (sh === 'triangle' || s.triangle) return 'triangle';
  if (s.text || sh === 'text') return 'text';
  if (s.swimlane || sh === 'swimlane') return 'swimlane';
  return 'rect';
}

function badgeSVG(n, b) {
  const t = `in ${b.in} · out ${b.out}`, w = Math.round(t.length * 5.1 + 12), h = 15;
  const x = n.x + n.w - w - 4, y = n.y + n.h - h / 2;
  return `<g class="badge"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="7.5" fill="#ffffff" stroke="#5b616b"/><text x="${(x + w / 2).toFixed(1)}" y="${(y + 10.5).toFixed(1)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#1d2430">${t}</text></g>`;
}
export const badgeText = b => `in ${b.in} · out ${b.out}`;

function nodeSVG(n, emph = false, badge = null) {
  const s = n.style, k = n.isGroup && !s.swimlane ? 'group' : shapeKind(s);
  const { x, y, w, h } = n;
  const fill = k === 'group' ? color(s.fillColor, 'none') : color(s.fillColor, '#ffffff');
  const stroke = color(s.strokeColor, '#000000');
  const sw = emph ? Math.max(3, (+s.strokeWidth || 1) + 2) : +s.strokeWidth || 1;
  const dash = s.dashed === '1' ? ` stroke-dasharray="${(s.dashPattern || '6 4').replace(/ /g, ' ')}"` : '';
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}`;
  let body = '', custom = null, labelBox = { cx: x + w / 2, cy: y + h / 2, w: w - 8 }, top = false;
  const rx = s.rounded === '1' ? Math.min(+s.arcSize ? (+s.arcSize / 100) * Math.min(w, h) : 10, h / 2) : 0;
  switch (k) {
    case 'ellipse': body = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`; break;
    case 'rhombus': body = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${attrs}/>`; labelBox.w = w * 0.6; break;
    case 'hexagon': { const d = w * 0.25; body = `<polygon points="${x + d},${y} ${x + w - d},${y} ${x + w},${y + h / 2} ${x + w - d},${y + h} ${x + d},${y + h} ${x},${y + h / 2}" ${attrs}/>`; break; }
    case 'parallelogram': { const d = w * 0.2; body = `<polygon points="${x + d},${y} ${x + w},${y} ${x + w - d},${y + h} ${x},${y + h}" ${attrs}/>`; break; }
    case 'triangle': body = `<polygon points="${x},${y + h} ${x + w / 2},${y} ${x + w},${y + h}" ${attrs}/>`; break;
    case 'cylinder': { const e = Math.min(h * 0.18, 14);
      body = `<path d="M${x},${y + e}V${y + h - e}A${w / 2},${e} 0 0 0 ${x + w},${y + h - e}V${y + e}A${w / 2},${e} 0 0 0 ${x},${y + e}Z" ${attrs}/><path d="M${x},${y + e}A${w / 2},${e} 0 0 0 ${x + w},${y + e}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
      labelBox.cy = y + h / 2 + e / 2; break; }
    case 'text': break;
    case 'swimlane': { const hh = +s.startSize || 23, vert = s.horizontal === '0';
      const bodyFill = color(s.swimlaneFillColor, 'none');
      const hdr = vert ? `<rect x="${x}" y="${y}" width="${hh}" height="${h}" ${attrs}/>` : `<rect x="${x}" y="${y}" width="${w}" height="${hh}" ${attrs}/>`;
      body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs.replace(`fill="${fill}"`, `fill="${bodyFill}"`)}/>${hdr}`;
      if (vert) { const cx = x + hh / 2, cy = y + h / 2; custom = `<g transform="rotate(-90 ${cx} ${cy})">${textEl(n.text, cx, cy, h - 8, s)}</g>`; }
      else labelBox = { cx: x + w / 2, cy: y + hh / 2, w: w - 8 };
      break; }
    case 'group': body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${s.strokeColor ? stroke : '#888'}" stroke-dasharray="${s.dashed === '0' ? '' : '6 4'}" stroke-width="${sw}"/>`; labelBox = { cx: x + 8, cy: y + 4, w: w - 16 }; top = true; break;
    default: body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ${attrs}/>`;
  }
  // plain boxes and text shapes honour draw.io's label alignment (e.g. zone boxes with the name at top-left)
  if (k === 'rect' || k === 'text') {
    if (s.align === 'left') labelBox.cx = x + 6 + (+s.spacingLeft || 0);
    else if (s.align === 'right') labelBox.cx = x + w - 6 - (+s.spacingRight || 0);
    if (s.align === 'left' || s.align === 'right') labelBox.w = w - 12 - (+s.spacingLeft || 0);
    if (s.verticalAlign === 'top') { labelBox.cy = y + 3 + (+s.spacingTop || 0); top = true; }
    else if (s.verticalAlign === 'bottom') labelBox.cy = y + h - 12 - (+s.spacingBottom || 0);
  }
  const st = k === 'group' ? { ...s, align: 'left' } : s;
  const label = custom !== null ? custom : textEl(n.text, labelBox.cx, labelBox.cy, labelBox.w, st, { top });
  return `<g class="n${n.isGroup || n.ctxBox ? ' grp' : ''}${emph ? ' focus-shape' : ''}${n.ctxBox ? ' ctx' : ''}" data-id="${esc(n.id)}">${body}${label}${badge ? badgeSVG(n, badge) : ''}</g>`;
}

// ---- edge routing ----
const center = n => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

function clip(n, from, to) {
  // boundary point of node n on the ray from `from` (inside) toward `to`
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx && !dy) return from;
  const hw = n.w / 2, hh = n.h / 2;
  const k = shapeKind(n.style);
  let t;
  if (k === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (k === 'rhombus') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

export const DIR = { L: [-1, 0], R: [1, 0], T: [0, -1], B: [0, 1] };
export const sideOfPort = (fx, fy) => (fx <= 0 ? 'L' : fx >= 1 ? 'R' : fy <= 0 ? 'T' : fy >= 1 ? 'B' : null);
export const sideMid = (n, side) => ({ L: { x: n.x, y: n.y + n.h / 2 }, R: { x: n.x + n.w, y: n.y + n.h / 2 }, T: { x: n.x + n.w / 2, y: n.y }, B: { x: n.x + n.w / 2, y: n.y + n.h } })[side];

// explicit draw.io port (exitX/exitY/entryX/entryY, plus Dx/Dy offsets) -> {pt, side} or null
function portOf(n, s, pre) {
  if (s[pre + 'X'] === undefined || s[pre + 'Y'] === undefined) return null;
  const fx = +s[pre + 'X'], fy = +s[pre + 'Y'];
  return { pt: { x: n.x + fx * n.w + (+s[pre + 'Dx'] || 0), y: n.y + fy * n.h + (+s[pre + 'Dy'] || 0) }, side: sideOfPort(fx, fy) };
}

// default sides when no port is given: face each other along the axis with a gap between the boxes
export function defaultSides(a, b) {
  const gapX = a.x + a.w <= b.x ? 'R' : b.x + b.w <= a.x ? 'L' : null;
  const gapY = a.y + a.h <= b.y ? 'B' : b.y + b.h <= a.y ? 'T' : null;
  const opp = { L: 'R', R: 'L', T: 'B', B: 'T' };
  const dx = Math.abs(b.x + b.w / 2 - a.x - a.w / 2), dy = Math.abs(b.y + b.h / 2 - a.y - a.h / 2);
  let side;
  if (gapX && gapY) side = dx >= dy ? gapX : gapY;
  else side = gapX || gapY || (dx >= dy ? (b.x >= a.x ? 'R' : 'L') : (b.y >= a.y ? 'B' : 'T'));
  return [side, opp[side]];
}

export function orthoPath(A, sa, B, sb, stub = 20) {
  const da = DIR[sa], db = DIR[sb];
  const ha = da[0] !== 0, hb = db[0] !== 0;
  let pts;
  if (ha && hb) {
    if (da[0] * (B.x - A.x) > 0 && db[0] * (A.x - B.x) > 0) { const mx = (A.x + B.x) / 2; pts = [A, { x: mx, y: A.y }, { x: mx, y: B.y }, B]; }
    else if (da[0] === db[0]) { const x1 = A.x + da[0] * stub, x2 = B.x + db[0] * stub, xm = da[0] > 0 ? Math.max(x1, x2) : Math.min(x1, x2); pts = [A, { x: xm, y: A.y }, { x: xm, y: B.y }, B]; }
    else { const x1 = A.x + da[0] * stub, x2 = B.x + db[0] * stub, my = (A.y + B.y) / 2; pts = [A, { x: x1, y: A.y }, { x: x1, y: my }, { x: x2, y: my }, { x: x2, y: B.y }, B]; }
  } else if (!ha && !hb) {
    if (da[1] * (B.y - A.y) > 0 && db[1] * (A.y - B.y) > 0) { const my = (A.y + B.y) / 2; pts = [A, { x: A.x, y: my }, { x: B.x, y: my }, B]; }
    else if (da[1] === db[1]) { const y1 = A.y + da[1] * stub, y2 = B.y + db[1] * stub, ym = da[1] > 0 ? Math.max(y1, y2) : Math.min(y1, y2); pts = [A, { x: A.x, y: ym }, { x: B.x, y: ym }, B]; }
    else { const y1 = A.y + da[1] * stub, y2 = B.y + db[1] * stub, mx = (A.x + B.x) / 2; pts = [A, { x: A.x, y: y1 }, { x: mx, y: y1 }, { x: mx, y: y2 }, { x: B.x, y: y2 }, B]; }
  } else {
    // one horizontal, one vertical: a single corner when it lies in front of both ends
    const c = ha ? { x: B.x, y: A.y } : { x: A.x, y: B.y };
    const okA = ha ? da[0] * (c.x - A.x) > 0 : da[1] * (c.y - A.y) > 0;
    const okB = hb ? db[0] * (c.x - B.x) > 0 : db[1] * (c.y - B.y) > 0;
    if (okA && okB) pts = [A, c, B];
    else {
      const a1 = { x: A.x + da[0] * stub, y: A.y + da[1] * stub }, b1 = { x: B.x + db[0] * stub, y: B.y + db[1] * stub };
      pts = ha ? [A, a1, { x: a1.x, y: b1.y }, b1, B] : [A, a1, { x: b1.x, y: a1.y }, b1, B];
    }
  }
  return pts.filter((p, i) => !i || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5);
}

export function routeEdge(e, nodes) {
  if (e.route) return e.route;  // tidy output: already final, including end points
  const sn = e.source && nodes.get(e.source), tn = e.target && nodes.get(e.target);
  const s = e.style, ortho = /orthogonal|elbow/i.test(String(s.edgeStyle || ''));
  const ps = sn && portOf(sn, s, 'exit'), pt = tn && portOf(tn, s, 'entry');
  if (sn && tn && ortho && !e.points.length) {
    let [sa, sb] = defaultSides(sn, tn);
    if (ps && ps.side) sa = ps.side;
    if (pt && pt.side) sb = pt.side;
    return orthoPath(ps ? ps.pt : sideMid(sn, sa), sa, pt ? pt.pt : sideMid(tn, sb), sb);
  }
  const sc = (ps && ps.pt) || (sn ? center(sn) : e.srcPoint || e.points[0]);
  const tc = (pt && pt.pt) || (tn ? center(tn) : e.tgtPoint || e.points[e.points.length - 1]);
  if (!sc || !tc) return [];
  const pts = [sc, ...e.points, tc];
  if (sn && !ps) pts[0] = clip(sn, sc, pts[1]);
  if (tn && !pt) pts[pts.length - 1] = clip(tn, tc, pts[pts.length - 2]);
  return pts;
}

function arrow(tip, from, size, stroke, kind) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x), c = Math.cos(a), s = Math.sin(a);
  const p = (d, w) => `${(tip.x - d * c - w * s).toFixed(1)},${(tip.y - d * s + w * c).toFixed(1)}`;
  if (kind === 'open') return `<polyline points="${p(size, size / 2.2)} ${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${p(size, -size / 2.2)}" fill="none" stroke="${stroke}"/>`;
  return `<polygon points="${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${p(size, size / 2.4)} ${p(size, -size / 2.4)}" fill="${stroke}" stroke="${stroke}"/>`;
}

function edgeSVG(e, pts) {
  if (pts.length < 2) return '';
  const s = e.style, stroke = color(s.strokeColor, '#000000'), sw = +s.strokeWidth || 1;
  const dash = s.dashed === '1' || e.inferred || !e.source || !e.target ? ' stroke-dasharray="6 4"' : '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const size = 8 + sw;
  let heads = '';
  const ek = s.endArrow || 'classic', sk = s.startArrow || 'none';
  if (e.fwd) heads += arrow(pts[pts.length - 1], pts[pts.length - 2], size, stroke, ek === 'open' ? 'open' : 'filled');
  if (e.back) heads += arrow(pts[0], pts[1], size, stroke, sk === 'open' ? 'open' : 'filled');
  return `<g class="e" data-id="${esc(e.id)}"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} stroke-linejoin="round"/>${heads}</g>`;
}

const labelText = e => String(e.label || '').split('\n')[0].trim();

/**
 * Choose where each connector label goes. Candidates sit beside (or on) every segment of the connector; the best one
 * is the position that overlaps no shape, no already-placed label and as few other connectors as possible.
 * Returns Map<edgeId, {x,y,w,h,f,at:{x,y},clear}> (x,y = label centre; f = fraction along the path; at = the path point it hangs from).
 */
export function placeLabels(model, routes = null) {
  const out = new Map();
  const shapes = [...model.nodes.values()].filter(n => !n.isGroup && !n.ctxBox);
  const obst = shapes.map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  for (const f of model.frames || []) obst.push({ x: f.x, y: f.y, w: f.w, h: 20 + f.lines.length * 12 });   // zone name headers
  const rt = routes || new Map(model.edges.map(e => [e.id, routeEdge(e, model.nodes)]));
  const segs = [];
  model.edges.forEach((e, ei) => { const p = rt.get(e.id) || []; for (let i = 1; i < p.length; i++) segs.push({ ei, a: p[i - 1], b: p[i] }); });
  const hit = (r, x0, y0, x1, y1) => Math.max(x0, x1) > r.x && Math.min(x0, x1) < r.x + r.w && Math.max(y0, y1) > r.y && Math.min(y0, y1) < r.y + r.h;
  const placed = [];
  model.edges.forEach((e, ei) => {
    const text = labelText(e), pts = rt.get(e.id) || [];
    if (!text || pts.length < 2) return;
    const fs = +e.style.fontSize || 11, w = estW(text, fs, 0.56) + 6, h = fs + 4;
    const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = lens[lens.length - 1] || 1;
    let best = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = lens[i] - lens[i - 1];
      if (L < 6) continue;
      const horiz = Math.abs(a.y - b.y) < 0.5, vert = Math.abs(a.x - b.x) < 0.5;
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const mx = a.x + (b.x - a.x) * t, my = a.y + (b.y - a.y) * t;
        const spots = horiz ? [[mx, my - h / 2 - 2, 0], [mx, my + h / 2 + 2, 1], [mx, my, 3]]
          : vert ? [[mx + w / 2 + 4, my, 0], [mx - w / 2 - 4, my, 1], [mx, my, 3]] : [[mx, my, 2]];
        for (const [cx, cy, pref] of spots) {
          const r = { x: cx - w / 2, y: cy - h / 2, w, h };
          let score = pref + Math.abs(t - 0.5) * 2;
          if (horiz && L < w) score += (w - L) * 0.6;                    // label would overhang the segment
          for (const o of obst) if (hit(r, o.x, o.y, o.x + o.w, o.y + o.h)) score += 1000;
          for (const q of placed) if (hit(r, q.x - q.w / 2, q.y - q.h / 2, q.x + q.w / 2, q.y + q.h / 2)) score += 600;
          for (const sg of segs) if (sg.ei !== ei && hit(r, sg.a.x, sg.a.y, sg.b.x, sg.b.y)) score += 40;
          if (pref === 3) score += 6;                                      // sitting on its own line is the fallback
          if (!best || score < best.score) best = { score, x: cx, y: cy, w, h, f: (lens[i - 1] + L * t) / total, at: { x: mx, y: my }, clear: score < 600 };
        }
      }
    }
    if (best) { placed.push(best); out.set(e.id, best); }
  });
  return out;
}

function labelSVG(e, pos) {
  const fs = +e.style.fontSize || 11;
  return `<g class="el" data-id="${esc(e.id)}"><text x="${pos.x.toFixed(1)}" y="${(pos.y + fs * 0.35).toFixed(1)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="${fs}" fill="${color(e.style.fontColor, '#222')}" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(labelText(e))}</text></g>`;
}

const estW = (t, fs, k = 0.58) => String(t).length * fs * k;

function frameSVG(f) {
  const s = f.style || {};
  const fill = color(s.fillColor, '#f3f4f6'), stroke = color(s.strokeColor, '#8a8f98');
  const dash = s.dashed === '0' ? '' : ' stroke-dasharray="6 4"';
  const ink = color(s.fontColor, '#2b2f36');
  const lines = f.lines.map((l, i) => `<text x="${(f.x + 10).toFixed(1)}" y="${(f.y + 30 + i * 12).toFixed(1)}" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#5b616b">${esc(l)}</text>`).join('');
  return `<g class="z" data-zone="${esc(f.id)}"><rect x="${f.x.toFixed(1)}" y="${f.y.toFixed(1)}" width="${f.w.toFixed(1)}" height="${f.h.toFixed(1)}" rx="8" fill="${fill}" fill-opacity="0.3" stroke="${stroke}" stroke-width="1.5"${dash}/>`
    + `<text x="${(f.x + 10).toFixed(1)}" y="${(f.y + 16).toFixed(1)}" font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="bold" fill="${ink}">${esc(f.title)}</text>${lines}</g>`;
}

export function bounds(model, margin = 20, extra = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const n of model.nodes.values()) { add(n.x, n.y); add(n.x + n.w, n.y + n.h); }
  for (const f of model.frames || []) { add(f.x, f.y); add(f.x + f.w, f.y + f.h); }
  for (const e of model.edges) for (const p of (extra.routes && extra.routes.get(e.id)) || routeEdge(e, model.nodes)) add(p.x, p.y);
  if (extra.labels) for (const l of extra.labels.values()) { add(l.x - l.w / 2, l.y - l.h / 2); add(l.x + l.w / 2, l.y + l.h / 2); }
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 100; }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}

/**
 * Render a model to an SVG string. `standalone` adds xmlns, width/height and a background.
 * heading: {title, subtitle} adds a title block above the diagram so it reads without the main diagram.
 * focusId: emphasise one shape (the service the view is about).
 */
export function renderSVG(model, { standalone = false, margin = 20, title = '', background = '#ffffff', heading = null, focusId = null, badges = null } = {}) {
  const routes = new Map(model.edges.map(e => [e.id, routeEdge(e, model.nodes)]));
  const labels = placeLabels(model, routes);
  let b = bounds(model, margin, { routes, labels });
  const nodes = depthSorted(model);
  const li = new Map((model.layers || []).map((l, i) => [l.id, i]));
  const lay = n => (li.has(n.layer) ? li.get(n.layer) : 0);
  const back = nodes.filter(n => n.isGroup || n.ctxBox).sort((p, q) => lay(p) - lay(q) || (p.ctxBox && q.ctxBox ? q.w * q.h - p.w * p.h : 0));
  const front = nodes.filter(n => !n.isGroup && !n.ctxBox);

  let head = '';
  if (heading && (heading.title || heading.subtitle)) {
    const tfs = 20, sfs = 12, maxW = Math.max(b.w - 2 * margin, 560);
    const tl = heading.title ? wrapLines(heading.title, maxW, tfs * 1.08) : [], sl = heading.subtitle ? wrapLines(heading.subtitle, maxW, sfs) : [];
    const widest = Math.max(0, ...tl.map(l => estW(l, tfs, 0.6)), ...sl.map(l => estW(l, sfs)));
    if (widest + 2 * margin > b.w) b = { ...b, w: widest + 2 * margin };
    const hh = 14 + tl.length * (tfs + 6) + (sl.length ? 4 + sl.length * (sfs + 4) : 0) + 14;
    const top = b.y - hh, x = b.x + margin;
    let y = top + 12;
    const parts = [];
    tl.forEach(l => { y += tfs + 6; parts.push(`<text x="${x}" y="${(y - 6).toFixed(1)}" font-family="Helvetica,Arial,sans-serif" font-size="${tfs}" font-weight="bold" fill="#1d2430">${esc(l)}</text>`); });
    sl.forEach(l => { y += sfs + 4; parts.push(`<text x="${x}" y="${y.toFixed(1)}" font-family="Helvetica,Arial,sans-serif" font-size="${sfs}" fill="#5b616b">${esc(l)}</text>`); });
    const ry = (top + hh - 8).toFixed(1);
    parts.push(`<line x1="${x}" y1="${ry}" x2="${(b.x + b.w - margin).toFixed(1)}" y2="${ry}" stroke="#c9cdd3"/>`);
    head = `<g class="heading">${parts.join('')}</g>`;
    b = { x: b.x, y: top, w: b.w, h: b.h + hh };
  }

  const body = back.map(n => nodeSVG(n)).join('') + (model.frames || []).map(frameSVG).join('')
    + model.edges.map(e => edgeSVG(e, routes.get(e.id))).join('') + front.map(n => nodeSVG(n, n.id === focusId, badges && badges.get(n.id))).join('')
    + model.edges.map(e => (labels.has(e.id) ? labelSVG(e, labels.get(e.id)) : '')).join('');
  const vb = `${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.w.toFixed(1)} ${b.h.toFixed(1)}`;
  const bg = standalone && background && background !== 'none' ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${background}"/>` : '';
  const top = standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}">${title ? `<title>${esc(title)}</title>` : ''}${bg}`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" id="canvas">`;
  return { svg: `${top}${head}${body}</svg>`, bounds: b };
}
