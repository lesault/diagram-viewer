import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { loadDrawio } from '../src/loader.js';
import { buildModel } from '../src/model.js';
import { filterLayers, computeZones } from '../src/context.js';
import { buildGraph, lineage } from '../src/graph.js';
import { subModel } from '../src/subset.js';
import { tidyModel } from '../src/tidy.js';
import { renderSVG, bounds } from '../src/render.js';
import { toDrawio, toSVG } from '../src/export.js';
import { rerouteAll } from '../src/router.js';

const ELK = createRequire(import.meta.url)('elkjs');
const file = new URL('../samples/layered-network.drawio', import.meta.url);
if (!existsSync(file)) execFileSync('node', [new URL('../samples/generate-layers.mjs', import.meta.url).pathname]);
const full = buildModel(loadDrawio(readFileSync(file, 'utf8'), null)[0].graph);
const hidden = new Set(full.layers.filter(l => !l.visible).map(l => l.id));
const view = filterLayers(full, { hidden, context: new Set(['LZ']) });
const zones = computeZones(view);
const graph = buildGraph(view);
const sub = (id, depth = 2, o = {}) => { const r = lineage(graph, id, { direction: 'both', depth }); return subModel(view, r.nodes.keys(), r.edges, { zones, ...o }); };
const inside = (n, f, tol = 0.5) => n.x >= f.x - tol && n.y >= f.y - tol && n.x + n.w <= f.x + f.w + tol && n.y + n.h <= f.y + f.h + tol;

test('hidden layer: its connectors are not in the view, so lineage stops', () => {
  assert.equal(full.edges.length, 21);
  assert.equal(view.edges.length, 18);                       // 3 "Response (draft)" connectors dropped
  assert.ok(!lineage(graph, 'soc', { direction: 'down', depth: 3 }).nodes.has('soar'));
  assert.ok(view.nodes.get('dc').ctxBox && !view.nodes.get('ad').ctxBox);
});

test('zone frames: nested, contain their members, carry name + properties', () => {
  const s = sub('siem');
  const f = Object.fromEntries(s.frames.map(x => [x.id, x]));
  assert.deepEqual(Object.keys(f).sort(), ['cloud', 'dc', 'dmz', 'vlan']);
  assert.ok(f.dc.w > f.dmz.w && f.dc.h > f.vlan.h);
  for (const z of s.zones) for (const id of z.members) assert.ok(inside(s.nodes.get(id), f[z.id]), `${id} in ${z.id}`);
  assert.ok(inside(f.dmz, f.dc) && inside(f.vlan, f.dc));
  assert.equal(f.cloud.title, 'AWS eu-west-2');
  assert.ok(f.cloud.lines.includes('provider: AWS'));
  const bare = sub('siem', 2, { frameMeta: false });
  assert.deepEqual(bare.frames.find(x => x.id === 'cloud').lines, []);
  assert.equal(sub('siem', 2, { zones: null }).frames.length, 0);
});

test('tidy keeps zone members together; sibling zones do not overlap; frames still enclose members', async () => {
  const t = await tidyModel(sub('siem'), ELK);
  const f = Object.fromEntries(t.frames.map(x => [x.id, x]));
  for (const z of t.zones) for (const id of z.members) assert.ok(inside(t.nodes.get(id), f[z.id]), `${id} in ${z.id}`);
  const apart = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  assert.ok(apart(f.dmz, f.vlan), 'DMZ and VLAN frames overlap');
  assert.ok(apart(f.cloud, f.dc), 'cloud and datacentre frames overlap');
  assert.ok(t.edges.every(e => e.route));
  const nonMembers = [...t.nodes.values()].filter(n => !t.zones.find(z => z.id === 'cloud').members.has(n.id));
  assert.ok(nonMembers.every(n => apart(n, f.cloud)), 'a non-member sits inside the cloud frame');
});

test('headings: SVG grows upwards and contains the text; draw.io gets title cells above the diagram', async () => {
  const t = await tidyModel(sub('siem'), ELK);
  const plain = renderSVG(t, { standalone: true }).bounds;
  const withH = renderSVG(t, { standalone: true, heading: { title: 'SIEM SaaS — lineage', subtitle: 'Prod · 2026-10-06' }, focusId: 'siem' });
  assert.ok(withH.bounds.h > plain.h + 40 && withH.bounds.y < plain.y);
  assert.match(withH.svg, /SIEM SaaS — lineage/);
  assert.match(withH.svg, /Prod · 2026-10-06/);
  const ys = [...withH.svg.matchAll(/<text x="[\d.-]+" y="([\d.-]+)"[^>]*font-size="20"/g)].map(m => +m[1]);
  assert.ok(ys.length === 1 && ys[0] > withH.bounds.y && ys[0] < plain.y, 'title baseline should sit in the new band above the diagram');
  assert.match(withH.svg, /stroke-width="3"/);                         // focus emphasis
  const none = toSVG(t, 'x', { background: 'none' });
  assert.ok(!/<rect[^>]*fill="#ffffff"/.test(none.slice(0, 400)));    // transparent background

  const back = buildModel(loadDrawio(toDrawio(t, { heading: { title: 'T1', subtitle: 'S1' }, focusId: 'siem' }), null)[0].graph);
  const title = back.nodes.get('heading_title'), top = Math.min(...[...back.nodes.values()].filter(n => !n.id.startsWith('heading')).map(n => n.y));
  assert.ok(title && title.text === 'T1' && title.y + title.h <= top + 1, 'heading must sit above everything');
  assert.ok(back.nodes.has('zone_cloud') && /dashed=1/.test(back.nodes.get('zone_cloud').styleStr));
  assert.match(back.nodes.get('siem').styleStr, /strokeWidth=3/);
  // tidied connectors are written with matching ports so draw.io re-opens them as drawn
  const e = back.edges.find(x => x.source && x.target);
  assert.ok(e.style.exitX !== undefined && e.style.entryX !== undefined && /orthogonal/.test(e.style.edgeStyle));
});

test('whole-diagram export after tidy keeps context boxes behind shapes and still loads', () => {
  const v = filterLayers(full, { hidden, context: new Set(['LZ']) });
  rerouteAll(v);
  const back = buildModel(loadDrawio(toDrawio(v), null)[0].graph);
  assert.equal([...back.nodes.values()].filter(n => !n.isGroup).length, [...v.nodes.values()].length);
  const order = [...back.nodes.keys()];
  assert.ok(order.indexOf('dc') < order.indexOf('ad'), 'zone boxes first (behind)');
  assert.equal(back.edges.length, v.edges.length);
});

test('connection counts: graph counts, SVG badge and draw.io badge cell', async () => {
  const { countConnections } = await import('../src/graph.js');
  const c = countConnections(graph, 'siem');
  assert.deepEqual(c, { in: 2, out: 1 });             // lambda + idp in; soc out
  const badges = new Map([['siem', c]]);
  const s = sub('siem');
  const svg = renderSVG(s, { standalone: true, badges }).svg;
  assert.match(svg, /in 2 · out 1/);
  assert.ok(!/in \d+ · out/.test(renderSVG(s, { standalone: true }).svg));
  const back = buildModel(loadDrawio(toDrawio(s, { badges }), null)[0].graph);
  assert.equal(back.nodes.get('count_siem').text, 'in 2 · out 1');
});

test('connector labels: placed clear of shapes and each other, drawn above shapes, written to draw.io', async () => {
  const { placeLabels } = await import('../src/render.js');
  // unit: a shape hugging the upper side of the connector pushes the label below it
  const mk = (id, x, y, w, h) => ({ id, x, y, w, h, text: id, style: {}, meta: {}, isGroup: false });
  const nodes = new Map([['a', mk('a', 0, 0, 80, 40)], ['b', mk('b', 420, 0, 80, 40)], ['x', mk('x', 150, -40, 200, 52)]]);
  const e = { id: 'e', source: 'a', target: 'b', label: 'syslog/TLS', style: {}, points: [], route: [{ x: 80, y: 20 }, { x: 420, y: 20 }], fwd: true };
  const lp = placeLabels({ nodes, edges: [e] }).get('e');
  const x = nodes.get('x');
  assert.ok(lp.clear && (lp.y - lp.h / 2 >= x.y + x.h || lp.x + lp.w / 2 <= x.x || lp.x - lp.w / 2 >= x.x + x.w), 'label must not overlap the shape');
  assert.ok(lp.f > 0 && lp.f < 1);

  // every tidied 2-hop view of both samples has every label clear
  let labels = 0;
  for (const id of ['siem', 'soar', 'corr', 'lambda', 'idp', 'relay', 'agent']) {
    if (!graph.out.has(id)) continue;
    const t = await tidyModel(sub(id), ELK);
    for (const [, p] of placeLabels(t)) { labels++; assert.ok(p.clear, `label obscured in view of ${id}`); }
  }
  assert.ok(labels > 20);

  const t = await tidyModel(sub('siem'), ELK);
  const svg = renderSVG(t, { standalone: true }).svg;
  assert.ok(svg.lastIndexOf('class="el"') > svg.lastIndexOf('class="n'), 'labels are drawn after (above) shapes');
  const dio = toDrawio(t);
  assert.match(dio, /as="offset"/);
  assert.equal(buildModel(loadDrawio(dio, null)[0].graph).edges.length, t.edges.length);
});
