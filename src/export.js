import { depthSorted } from './subset.js';
import { renderSVG, bounds, wrapLines } from './render.js';

const xa = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');
const clamp01 = v => Math.max(0, Math.min(1, v));
const fr = v => +clamp01(v).toFixed(3);

// style string helpers
const dropKeys = (style, re) => style.split(';').filter(p => p && !re.test(p.split('=')[0])).join(';');

// exit/entry points that match a routed polyline, so draw.io re-opens the connector as it was tidied
function edgeStyleFor(e, nodes) {
  if (!e.route || e.route.length < 2) return e.styleStr;
  let st = dropKeys(e.styleStr, /^(exit|entry)(X|Y|Dx|Dy|Perimeter)$|^edgeStyle$|^curved$/);
  st += `;edgeStyle=orthogonalEdgeStyle;curved=0`;
  const sn = nodes.get(e.source), tn = nodes.get(e.target);
  if (sn) { const p = e.route[0]; st += `;exitX=${fr((p.x - sn.x) / sn.w)};exitY=${fr((p.y - sn.y) / sn.h)};exitDx=0;exitDy=0`; }
  if (tn) { const p = e.route[e.route.length - 1]; st += `;entryX=${fr((p.x - tn.x) / tn.w)};entryY=${fr((p.y - tn.y) / tn.h)};entryDx=0;entryDy=0`; }
  return st;
}

/**
 * Serialise a (sub-)model as an uncompressed draw.io file that opens and edits normally.
 * heading: {title, subtitle} is written as text cells above the diagram; zone frames become dashed container-style boxes.
 */
export function toDrawio(model, { name = 'Service view', heading = null, margin = 20, focusId = null } = {}) {
  const cells = [];
  const all = depthSorted(model);
  const li = new Map((model.layers || []).map((l, i) => [l.id, i]));
  const lay = n => (li.has(n.layer) ? li.get(n.layer) : 0);
  const back = all.filter(n => n.isGroup || n.ctxBox).sort((p, q) => lay(p) - lay(q) || (p.ctxBox && q.ctxBox ? q.w * q.h - p.w * p.h : 0));
  const front = all.filter(n => !n.isGroup && !n.ctxBox);
  const hasLanes = back.some(n => n.isGroup);

  const vertex = n => {
    const p = n.parent && model.nodes.get(n.parent);
    const gx = n.x - (p ? p.x : 0), gy = n.y - (p ? p.y : 0);
    let style = n.styleStr;
    if (n.id === focusId) style = dropKeys(style, /^strokeWidth$/) + ';strokeWidth=3';
    const meta = Object.keys(n.meta || {}).length;
    const cell = `<mxCell${meta ? '' : ` id="${xa(n.id)}" value="${xa(n.raw)}"`} style="${xa(style)}" vertex="1" parent="${p ? xa(p.id) : '1'}"><mxGeometry x="${Math.round(gx)}" y="${Math.round(gy)}" width="${Math.round(n.w)}" height="${Math.round(n.h)}" as="geometry"/></mxCell>`;
    if (!meta) return cell;
    const attrs = Object.entries(n.meta).map(([k, v]) => ` ${xa(k)}="${xa(v)}"`).join('');
    return `<object label="${xa(n.raw)}" id="${xa(n.id)}"${attrs}>${cell}</object>`;
  };
  const frameCell = f => {
    const s = f.style || {};
    const fill = s.fillColor && s.fillColor !== 'default' ? s.fillColor : '#f3f4f6', stroke = s.strokeColor && s.strokeColor !== 'default' ? s.strokeColor : '#8a8f98';
    const label = `<b>${f.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b>` + f.lines.map(l => `<br><font style="font-size:10px" color="#5b616b">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</font>`).join('');
    return `<mxCell id="zone_${xa(f.id)}" value="${xa(label)}" style="rounded=1;arcSize=3;html=1;whiteSpace=wrap;dashed=1;fillColor=${fill};fillOpacity=30;strokeColor=${stroke};verticalAlign=top;align=left;spacingLeft=8;spacingTop=2;fontSize=12;" vertex="1" parent="1"><mxGeometry x="${Math.round(f.x)}" y="${Math.round(f.y)}" width="${Math.round(f.w)}" height="${Math.round(f.h)}" as="geometry"/></mxCell>`;
  };
  const frames = (model.frames || []).map(frameCell);

  // z-order: lanes/context boxes, then zone frames (frames go on top of lanes with low opacity so lane borders still show), connectors, shapes
  for (const n of back) cells.push(vertex(n));
  if (!hasLanes) cells.push(...frames);
  else cells.push(...frames);
  for (const e of model.edges) {
    const pts = e.points.length ? `<Array as="points">${e.points.map(p => `<mxPoint x="${Math.round(p.x)}" y="${Math.round(p.y)}"/>`).join('')}</Array>` : '';
    const src = e.source ? ` source="${xa(e.source)}"` : '', tgt = e.target ? ` target="${xa(e.target)}"` : '';
    cells.push(`<mxCell id="${xa(e.id)}" value="${xa(e.rawLabel || e.label || '')}" style="${xa(edgeStyleFor(e, model.nodes))}" edge="1" parent="1"${src}${tgt}><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
  }
  for (const n of front) cells.push(vertex(n));

  if (heading && (heading.title || heading.subtitle)) {
    const b = bounds(model, margin), w = Math.max(b.w - 2 * margin, 560);
    const tl = heading.title ? wrapLines(heading.title, w, 21.6).length : 0, sl = heading.subtitle ? wrapLines(heading.subtitle, w, 12).length : 0;
    const th = tl * 28, sh = sl * 17, top = b.y - th - sh - 16;
    if (tl) cells.push(`<mxCell id="heading_title" value="${xa(heading.title)}" style="text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=20;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${Math.round(b.x + margin)}" y="${Math.round(top)}" width="${Math.round(w)}" height="${th}" as="geometry"/></mxCell>`);
    if (sl) cells.push(`<mxCell id="heading_subtitle" value="${xa(heading.subtitle)}" style="text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=12;fontColor=#5b616b;" vertex="1" parent="1"><mxGeometry x="${Math.round(b.x + margin)}" y="${Math.round(top + th + 2)}" width="${Math.round(w)}" height="${sh}" as="geometry"/></mxCell>`);
  }
  return `<mxfile host="diagram-viewer"><diagram name="${xa(name)}" id="view1"><mxGraphModel dx="0" dy="0" grid="1" gridSize="10" page="0" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
}

export const toSVG = (model, title, opts = {}) => renderSVG(model, { standalone: true, title, ...opts }).svg;

// ---- browser-only helpers ----
export function svgToImageBlob(svgString, { scale = 2, type = 'image/png', background = '#ffffff' } = {}) {
  return new Promise((resolve, reject) => {
    const m = svgString.match(/width="(\d+)" height="(\d+)"/);
    const w = Math.min(+m[1] * scale, 16000), h = Math.min(+m[2] * scale, 16000);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (background && background !== 'none') { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Image encode failed'))), type, 0.92);
    };
    img.onerror = () => reject(new Error('SVG could not be rasterised'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  });
}
export const svgToPngBlob = (svg, scale = 2) => svgToImageBlob(svg, { scale });

// vector PDF through the browser's print dialog ("Save as PDF"); a hidden iframe avoids popup blockers
export function printSvg(svgString, title = 'diagram') {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  const m = svgString.match(/width="(\d+)" height="(\d+)"/);
  const landscape = !m || +m[1] >= +m[2];
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>@page{size:${landscape ? 'landscape' : 'portrait'};margin:10mm}html,body{margin:0}svg{width:100%;height:auto;max-height:190mm}</style></head><body>${svgString}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 300);
}

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const safeName = s => (String(s).replace(/[^\w\-. ]+/g, '_').trim() || 'view').slice(0, 80);
