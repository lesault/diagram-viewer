import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { loadDrawio } from '../src/loader.js';
import { buildModel } from '../src/model.js';
import { filterLayers } from '../src/context.js';
import { diagnose, findingsToMarkdown, findingsToCsv } from '../src/diagnose.js';

const load = f => buildModel(loadDrawio(readFileSync(new URL(f, import.meta.url), 'utf8'), b => zlib.inflateRawSync(b))[0].graph);
const ids = (r, id) => (r.findings.find(f => f.id === id) || { items: [] }).items;

test('checks on the swimlane sample find the planted problems', () => {
  const r = diagnose(filterLayers(load('../samples/cyber-dataflow.drawio'), {}), { metaKey: 'environment' });
  assert.equal(ids(r, 'dangling').length, 1);                          // GeoIP stub
  assert.equal(ids(r, 'inferred').length, 2);                          // two connectors attached by proximity
  assert.equal(ids(r, 'duplicate-labels')[0].nodes.length, 2);          // Log Forwarder x2
  assert.deepEqual(ids(r, 'unconnected').map(i => i.nodes[0]), ['legacy']);
  assert.ok(ids(r, 'through-shapes').length > 5);
  assert.ok(ids(r, 'cut-points').length >= 1);
  assert.ok(ids(r, 'hubs').some(i => /Kafka|SOAR|Syslog/.test(i.label)));
  assert.ok(ids(r, 'sources').length && ids(r, 'sinks').length);
  assert.deepEqual(ids(r, 'missing-property').map(i => i.nodes[0]), ['legacy']);   // the only shape without an environment property
  assert.ok(r.metaKeys.some(k => k.key === 'owner'));
  assert.ok(r.counts.error >= 1);
  const md = findingsToMarkdown(r, { file: 'x', page: 'p' });
  assert.match(md, /## \[ERROR\] Connectors attached at only one end/);
  assert.ok(findingsToCsv(r).split('\n').length > 10);
});

test('fully unattached connectors are reported and kept out of lineage', () => {
  const xml = `<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="300" y="0" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="c" value="C" vertex="1" parent="1"><mxGeometry x="300" y="300" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="d" value="D" vertex="1" parent="1"><mxGeometry x="600" y="300" width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="e1" edge="1" source="a" target="b" parent="1" style="endArrow=none;"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e2" edge="1" source="c" target="d" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e3" edge="1" source="c" target="d" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e4" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="500" y="500" as="sourcePoint"/><mxPoint x="560" y="500" as="targetPoint"/></mxGeometry></mxCell>
  </root></mxGraphModel></diagram></mxfile>`;
  const m = filterLayers(buildModel(loadDrawio(xml, null)[0].graph), {});
  const r = diagnose(m, { routes: false });
  assert.equal(ids(r, 'free-edges').length, 1);
  assert.equal(ids(r, 'undirected').length, 1);
  assert.equal(ids(r, 'duplicate-edges').length, 1);
  assert.equal(ids(r, 'islands').length, 1);          // C-D island besides A-B (same size: first is main)
  assert.equal(r.findings[0].severity, 'error');
});

test('articulation points: a bridge shape is flagged', () => {
  const cell = (id, x, y) => `<mxCell id="${id}" value="${id}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="60" height="30" as="geometry"/></mxCell>`;
  const edge = (a, b) => `<mxCell id="${a}${b}" edge="1" source="${a}" target="${b}" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  const xml = `<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell('a', 0, 0)}${cell('b', 100, 0)}${cell('c', 200, 0)}${cell('d', 300, 0)}${cell('e', 400, 0)}${edge('a', 'b')}${edge('b', 'c')}${edge('c', 'a')}${edge('c', 'd')}${edge('d', 'e')}</root></mxGraphModel></diagram></mxfile>`;
  const r = diagnose(filterLayers(buildModel(loadDrawio(xml, null)[0].graph), {}), { routes: false });
  assert.deepEqual(ids(r, 'cut-points').map(i => i.nodes[0]).sort(), ['c', 'd']);
});
