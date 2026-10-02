import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { loadDrawio } from '../src/loader.js';
import { buildModel } from '../src/model.js';
import { buildGraph, lineage } from '../src/graph.js';
import { subModel, findLanes } from '../src/subset.js';
import { tidyModel } from '../src/tidy.js';
import { toDrawio } from '../src/export.js';

const ELK = createRequire(import.meta.url)('elkjs');
const file = new URL('../samples/cyber-dataflow.drawio', import.meta.url);
if (!existsSync(file)) execFileSync('node', [new URL('../samples/generate-cyber.mjs', import.meta.url).pathname]);
const pages = loadDrawio(readFileSync(file, 'utf8'), b => zlib.inflateRawSync(b));
const m = buildModel(pages[0].graph);
const g = buildGraph(m);
const view = (id, depth = 2, direction = 'both') => { const r = lineage(g, id, { direction, depth }); return subModel(m, r.nodes.keys(), r.edges); };
const inside = (n, l) => n.x >= l.x && n.x + n.w <= l.x + l.w && n.y >= l.y && n.y + n.h <= l.y + l.h;

test('swimlane model: pool + 9 lanes, nested absolute positions, pool-relative edges', () => {
  assert.equal(m.groups.size, 10);
  const lanes = findLanes(m);
  assert.equal(lanes.axis, 'row');
  assert.equal(lanes.blocks[0].lanes.length, 9);
  assert.equal(m.nodes.get('soar').x, 40 + 24 + 24 + 20 + 7 * 190);   // pool.x + pool hdr + lane hdr + pad + col*width
  const e = m.edges.find(x => x.source === 'soar' && x.target === 'mfa');  // explicit waypoints with parent=pool
  assert.ok(e.points.every(p => p.x > 40));
});

test('messy connectors: snapped by proximity, never glued to a lane', () => {
  assert.equal(m.diagnostics.inferredEdges.length, 3);
  assert.equal(m.diagnostics.danglingEdges.length, 1);
  assert.ok(m.edges.every(e => !m.groups.has(e.source) && !m.groups.has(e.target)));
  assert.deepEqual(m.diagnostics.unconnected, ['legacy']);
  assert.equal(m.diagnostics.duplicateLabels[0].label, 'Log Forwarder');
});

test('compressed second page loads', () => assert.equal(buildModel(pages[1].graph).nodes.size, 3));

test('service view keeps lanes and pool, lanes are full-width touching bands', () => {
  const s = view('siemidx');
  const lanes = findLanes(s).blocks[0].lanes;
  assert.ok(lanes.length >= 4 && lanes.length < 9);
  assert.ok(s.nodes.has('pool'));
  assert.equal(new Set(lanes.map(l => l.x)).size, 1);
  assert.equal(new Set(lanes.map(l => l.w)).size, 1);
  for (let i = 1; i < lanes.length; i++) assert.ok(Math.abs(lanes[i].y - (lanes[i - 1].y + lanes[i - 1].h)) < 0.01);
  for (const n of s.nodes.values()) if (!n.isGroup) assert.ok(inside(n, s.nodes.get(n.parent)), n.id);
});

test('lane-aware tidy: shapes stay in their lane, lanes keep order, no overlap, routed edges', async () => {
  const s = view('soar', 2);
  const orig = findLanes(s).blocks[0].lanes.map(l => l.id);
  const t = await tidyModel(s, ELK);
  const lanes = findLanes(t).blocks[0].lanes;
  assert.deepEqual(lanes.map(l => l.id), orig);
  for (const n of t.nodes.values()) if (!n.isGroup) { assert.equal(n.parent, s.nodes.get(n.id).parent); assert.ok(inside(n, t.nodes.get(n.parent)), n.id); }
  const pool = t.nodes.get('pool');
  for (const l of lanes) assert.ok(inside(l, pool));
  const leaves = [...t.nodes.values()].filter(n => !n.isGroup);
  for (const a of leaves) for (const b of leaves) if (a !== b)
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id}/${b.id}`);
  assert.ok(t.edges.length && t.edges.every(e => e.route && e.route.length >= 2));
});

test('tidied lane view exports to draw.io and reloads with nesting intact', async () => {
  const t = await tidyModel(view('corr', 1), ELK);
  const back = buildModel(loadDrawio(toDrawio(t), null)[0].graph);
  assert.equal(back.nodes.size, t.nodes.size);
  assert.ok(back.nodes.get('corr').parent.startsWith('lane_'));
  assert.equal(Math.round(back.nodes.get('corr').x), Math.round(t.nodes.get('corr').x));
});
