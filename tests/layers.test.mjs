import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/model.js';
import { parseXML } from '../src/xml.js';
import { filterLayers, computeZones, suggestContextLayers } from '../src/context.js';
import { buildGraph, lineage } from '../src/graph.js';

const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="L1" value="Services" parent="0"/>
<mxCell id="L2" value="Zones" parent="0"/>
<mxCell id="L3" value="Hidden flows" parent="0" visible="0"/>
<mxCell id="dc" value="Datacentre" style="rounded=0;fillColor=#eeeeee;" vertex="1" parent="L2"><mxGeometry x="0" y="0" width="600" height="300" as="geometry"/></mxCell>
<object label="Prod VLAN" id="vlan" trust="high"><mxCell style="fillColor=#d5e8d4;" vertex="1" parent="L2"><mxGeometry x="20" y="40" width="280" height="240" as="geometry"/></mxCell></object>
<mxCell id="cloud" value="Cloud" style="fillColor=#dae8fc;" vertex="1" parent="L2"><mxGeometry x="700" y="0" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="a" value="A" vertex="1" parent="L1"><mxGeometry x="40" y="80" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="b" value="B" vertex="1" parent="L1"><mxGeometry x="400" y="80" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="c" value="C" vertex="1" parent="L1"><mxGeometry x="760" y="80" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="d" value="D" vertex="1" parent="L1"><mxGeometry x="1200" y="80" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="e1" edge="1" source="a" target="b" parent="L1"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e2" edge="1" source="b" target="c" parent="L1"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e3" edge="1" source="c" target="d" parent="L3"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>`;
const m = buildModel(parseXML(xml));

test('layers: names, visibility, membership, counts', () => {
  assert.deepEqual(m.layers.map(l => [l.id, l.name, l.visible, l.nodes, l.edges]), [['L1', 'Services', true, 4, 2], ['L2', 'Zones', true, 3, 0], ['L3', 'Hidden flows', false, 0, 1]]);
  assert.equal(m.nodes.get('a').layer, 'L1');
  assert.equal(m.edges.find(e => e.id === 'e3').layer, 'L3');
});

test('suggestions: only the layer whose boxes contain other-layer shapes', () => {
  assert.deepEqual(suggestContextLayers(m), ['L2']);
});

test('hiding a layer removes its edges and orphans no lineage', () => {
  const full = filterLayers(m, { hidden: new Set() });
  assert.equal(full.edges.length, 3);
  const v = filterLayers(m, { hidden: new Set(['L3']) });
  assert.equal(v.edges.length, 2);
  assert.ok(!lineage(buildGraph(v), 'c', { direction: 'down', depth: 3 }).nodes.has('d'));
  const noSvc = filterLayers(m, { hidden: new Set(['L1']) });
  assert.equal(noSvc.edges.length, 0);
});

test('zones: nesting and innermost membership by geometry', () => {
  const v = filterLayers(m, { context: new Set(['L2']) });
  assert.ok(v.nodes.get('dc').ctxBox && v.nodes.get('vlan').ctxBox);
  const z = computeZones(v);
  assert.equal(z.zones.get('vlan').parent, 'dc');
  assert.deepEqual(z.chain('a'), ['vlan', 'dc']);
  assert.deepEqual(z.chain('b'), ['dc']);
  assert.deepEqual(z.chain('c'), ['cloud']);
  assert.deepEqual(z.chain('d'), []);
  assert.deepEqual([...z.zones.get('dc').members].sort(), ['a', 'b']);
  assert.equal(z.zones.get('vlan').node.meta.trust, 'high');
});

test('context boxes are not lineage nodes unless they have connectors', () => {
  const v = filterLayers(m, { context: new Set(['L1', 'L2']) });
  assert.ok(!v.nodes.get('a').ctxBox);   // has edges, stays a service
});
