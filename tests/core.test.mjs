import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { loadDrawio } from '../src/loader.js';
import { buildModel } from '../src/model.js';
import { buildGraph, lineage, shortestPath } from '../src/graph.js';

const inflate = b => zlib.inflateRawSync(b);
const sample = readFileSync(new URL('../samples/security.drawio', import.meta.url), 'utf8');
const load = txt => buildModel(loadDrawio(txt, inflate)[0].graph);

test('model: groups, absolute geometry, metadata, inferred edge', () => {
  const m = load(sample);
  assert.ok(m.groups.has('zone'));
  assert.equal(m.nodes.get('coll').x, 240);            // 200 + zone.x 40
  assert.equal(m.nodes.get('fw').meta.owner, 'NetSec');
  assert.equal(m.nodes.get('fw').text, 'Firewall');
  const e4 = m.edges.find(e => e.id === 'e4');
  assert.equal(e4.source, 'idp'); assert.equal(e4.target, 'siem'); assert.ok(e4.inferred);
});

test('lineage: direction and depth', () => {
  const g = buildGraph(load(sample));
  assert.deepEqual([...lineage(g, 'siem', { direction: 'down', depth: 1 }).nodes.keys()].sort(), ['siem', 'soar']);
  const up2 = lineage(g, 'siem', { direction: 'up', depth: 2 }).nodes;
  assert.equal(up2.get('fw'), 2); assert.ok(up2.has('idp'));
  assert.ok(!lineage(g, 'coll', { direction: 'up', depth: 1 }).nodes.has('soar'));
  assert.deepEqual(shortestPath(g, 'fw', 'soar').nodes, ['fw', 'coll', 'siem', 'soar']);
});

test('lineage: cycles terminate and blocked hubs are not traversed', () => {
  const g = buildGraph(load(sample));
  const r = lineage(g, 'fw', { direction: 'down', depth: Infinity, blocked: new Set(['coll']) });
  assert.ok(r.nodes.has('coll')); assert.ok(!r.nodes.has('siem'));
});

test('loader: compressed diagram', () => {
  const inner = sample.match(/<mxGraphModel>[\s\S]*<\/mxGraphModel>/)[0];
  const body = zlib.deflateRawSync(Buffer.from(encodeURIComponent(inner))).toString('base64');
  const m = load(`<mxfile><diagram name="c">${body}</diagram></mxfile>`);
  assert.equal(m.nodes.size, 6);
});
