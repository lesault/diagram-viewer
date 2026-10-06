import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { loadDrawio } from '../src/loader.js';
import { buildModel } from '../src/model.js';
import { filterLayers } from '../src/context.js';
import { rerouteAll, routeMetrics } from '../src/router.js';

const load = f => buildModel(loadDrawio(readFileSync(new URL(f, import.meta.url), 'utf8'), b => zlib.inflateRawSync(b))[0].graph);

test('reroute: no connector crosses a shape, fewer overlaps, anchors on shape borders', () => {
  const m = filterLayers(load('../samples/cyber-dataflow.drawio'), {});
  const before = routeMetrics(m);
  const t0 = Date.now();
  const stats = rerouteAll(m);
  const ms = Date.now() - t0;
  const after = routeMetrics(m);
  console.log('before', JSON.stringify({ ...before, through: before.through.length }), 'after', JSON.stringify({ ...after, through: after.through.length }), stats, ms + 'ms');
  assert.equal(after.through.length, 0);
  assert.ok(after.overlaps < before.overlaps || before.overlaps === 0);
  assert.ok(stats.routed >= 60);
  for (const e of m.edges.filter(e => e.route && e.source && e.target)) {
    const n = m.nodes.get(e.source), p = e.route[0];
    const onBorder = Math.abs(p.x - n.x) < 1 || Math.abs(p.x - n.x - n.w) < 1 || Math.abs(p.y - n.y) < 1 || Math.abs(p.y - n.y - n.h) < 1;
    assert.ok(onBorder, e.id);
    for (let i = 1; i < e.route.length; i++) assert.ok(Math.abs(e.route[i].x - e.route[i - 1].x) < 0.01 || Math.abs(e.route[i].y - e.route[i - 1].y) < 0.01, `${e.id} not orthogonal`);
  }
});

test('reroute: simple obstacle is avoided with a short detour', () => {
  const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="0" y="100" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="x" value="X" vertex="1" parent="1"><mxGeometry x="200" y="90" width="80" height="60" as="geometry"/></mxCell>
  <mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="400" y="100" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="e" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>`;
  const m = buildModel(loadDrawio(`<mxfile><diagram>${xml}</diagram></mxfile>`, null)[0].graph);
  assert.equal(routeMetrics(m).through.length, 1);      // straight line goes through X
  rerouteAll(m);
  const r = routeMetrics(m);
  assert.equal(r.through.length, 0);
  assert.ok(r.bends <= 4, 'bends ' + r.bends);
});
