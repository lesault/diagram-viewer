import { depthSorted } from './subset.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const color = (v, d) => (v === undefined || v === 'default' ? d : v);

function wrapLines(text, maxW, fs) {
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

function nodeSVG(n) {
  const s = n.style, k = n.isGroup && !s.swimlane ? 'group' : shapeKind(s);
  const { x, y, w, h } = n;
  const fill = k === 'group' ? color(s.fillColor, 'none') : color(s.fillColor, '#ffffff');
  const stroke = color(s.strokeColor, '#000000');
  const sw = +s.strokeWidth || 1;
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
  const st = k === 'group' ? { ...s, align: 'left' } : s;
  const label = custom !== null ? custom : textEl(n.text, labelBox.cx, labelBox.cy, labelBox.w, st, { top });
  return `<g class="n${n.isGroup ? ' grp' : ''}" data-id="${esc(n.id)}">${body}${label}</g>`;
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

function edgeSVG(e, nodes) {
  const pts = routeEdge(e, nodes);
  if (pts.length < 2) return '';
  const s = e.style, stroke = color(s.strokeColor, '#000000'), sw = +s.strokeWidth || 1;
  const dash = s.dashed === '1' || e.inferred ? ' stroke-dasharray="6 4"' : '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const size = 8 + sw;
  let heads = '';
  const ek = s.endArrow || 'classic', sk = s.startArrow || 'none';
  if (e.fwd) heads += arrow(pts[pts.length - 1], pts[pts.length - 2], size, stroke, ek === 'open' ? 'open' : 'filled');
  if (e.back) heads += arrow(pts[0], pts[1], size, stroke, sk === 'open' ? 'open' : 'filled');
  let label = '';
  if (e.label) {
    let tot = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); tot += l; }
    let acc = tot / 2, i = 0; while (i < seg.length - 1 && acc > seg[i]) { acc -= seg[i]; i++; }
    const t = seg[i] ? acc / seg[i] : 0.5, a = pts[i], b = pts[i + 1];
    const fs = +s.fontSize || 11;
    label = `<text x="${(a.x + (b.x - a.x) * t).toFixed(1)}" y="${(a.y + (b.y - a.y) * t - 4).toFixed(1)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="${fs}" fill="${color(s.fontColor, '#222')}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(e.label.split('\n')[0])}</text>`;
  }
  return `<g class="e" data-id="${esc(e.id)}"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} stroke-linejoin="round"/>${heads}${label}</g>`;
}

export function bounds(model, margin = 20) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const n of model.nodes.values()) { add(n.x, n.y); add(n.x + n.w, n.y + n.h); }
  for (const e of model.edges) for (const p of routeEdge(e, model.nodes)) add(p.x, p.y);
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 100; }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}

/** Render a model to an SVG string. `standalone` adds xmlns, width/height and a white background. */
export function renderSVG(model, { standalone = false, margin = 20, title = '', background = '#ffffff' } = {}) {
  const b = bounds(model, margin);
  const nodes = depthSorted(model);
  const body = nodes.filter(n => n.isGroup).map(nodeSVG).join('') + model.edges.map(e => edgeSVG(e, model.nodes)).join('') + nodes.filter(n => !n.isGroup).map(nodeSVG).join('');
  const vb = `${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.w.toFixed(1)} ${b.h.toFixed(1)}`;
  const head = standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}">${title ? `<title>${esc(title)}</title>` : ''}<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${background}"/>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" id="canvas">`;
  return { svg: `${head}${body}</svg>`, bounds: b };
}
