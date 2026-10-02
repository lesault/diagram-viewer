import { depthSorted } from './subset.js';
import { renderSVG } from './render.js';

const xa = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');

/** Serialise a (sub-)model as an uncompressed draw.io file that opens and edits normally. */
export function toDrawio(model, { name = 'Service view' } = {}) {
  const cells = [];
  const sorted = depthSorted(model);
  for (const n of sorted) {
    const p = n.parent && model.nodes.get(n.parent);
    const gx = n.x - (p ? p.x : 0), gy = n.y - (p ? p.y : 0);
    const cell = `<mxCell${Object.keys(n.meta || {}).length ? '' : ` id="${xa(n.id)}" value="${xa(n.raw)}"`} style="${xa(n.styleStr)}" vertex="1" parent="${p ? xa(p.id) : '1'}"><mxGeometry x="${Math.round(gx)}" y="${Math.round(gy)}" width="${Math.round(n.w)}" height="${Math.round(n.h)}" as="geometry"/></mxCell>`;
    if (Object.keys(n.meta || {}).length) {
      const attrs = Object.entries(n.meta).map(([k, v]) => ` ${xa(k)}="${xa(v)}"`).join('');
      cells.push(`<object label="${xa(n.raw)}" id="${xa(n.id)}"${attrs}>${cell}</object>`);
    } else cells.push(cell);
  }
  for (const e of model.edges) {
    const pts = e.points.length ? `<Array as="points">${e.points.map(p => `<mxPoint x="${Math.round(p.x)}" y="${Math.round(p.y)}"/>`).join('')}</Array>` : '';
    const src = e.source ? ` source="${xa(e.source)}"` : '', tgt = e.target ? ` target="${xa(e.target)}"` : '';
    cells.push(`<mxCell id="${xa(e.id)}" value="${xa(e.rawLabel || e.label || '')}" style="${xa(e.route ? e.styleStr.replace(/(exit|entry)(X|Y|Dx|Dy|Perimeter)=[^;]*;?/g, '') : e.styleStr)}" edge="1" parent="1"${src}${tgt}><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
  }
  return `<mxfile host="diagram-viewer"><diagram name="${xa(name)}" id="view1"><mxGraphModel dx="0" dy="0" grid="1" gridSize="10" page="0" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
}

export const toSVG = (model, title) => renderSVG(model, { standalone: true, title }).svg;

// ---- browser-only helpers ----
export function svgToPngBlob(svgString, scale = 2) {
  return new Promise((resolve, reject) => {
    const m = svgString.match(/width="(\d+)" height="(\d+)"/);
    const w = +m[1] * scale, h = +m[2] * scale;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('SVG could not be rasterised'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  });
}

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const safeName = s => (String(s).replace(/[^\w\-. ]+/g, '_').trim() || 'view').slice(0, 80);
