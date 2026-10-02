import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { loadDrawio } from '../src/loader.js';
import { buildModel } from '../src/model.js';
import { buildGraph, lineage } from '../src/graph.js';
import { subModel } from '../src/subset.js';
import { tidyModel } from '../src/tidy.js';
import { toDrawio, toSVG } from '../src/export.js';

const ELK = createRequire(import.meta.url)('elkjs');
const m = buildModel(loadDrawio(readFileSync(new URL('../samples/security.drawio', import.meta.url), 'utf8'), b => zlib.inflateRawSync(b))[0].graph);
const view = () => { const r = lineage(buildGraph(m), 'siem', { direction: 'both', depth: 2 }); return subModel(m, r.nodes.keys(), r.edges); };

test('subModel keeps ancestor zone and fits it to contents', () => {
  const s = view();
  assert.ok(s.groups.has('zone'));
  assert.ok(s.nodes.get('zone').w < m.nodes.get('zone').w + 1);
  assert.ok(!s.nodes.has('missing'));
  assert.equal(s.edges.length, 4);
});

test('tidy: all nodes placed without overlap, edges routed', async () => {
  const t = await tidyModel(view(), ELK);
  const leaves = [...t.nodes.values()].filter(n => !n.isGroup);
  for (const a of leaves) for (const b of leaves) if (a !== b)
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
  assert.ok(t.edges.every(e => e.route && e.route.length >= 2));
  const zone = t.nodes.get('zone');
  for (const n of leaves.filter(n => n.parent === 'zone')) assert.ok(n.x >= zone.x && n.x + n.w <= zone.x + zone.w);
  assert.match(toSVG(t, 'x'), /<svg[^>]*width=/);
});

test('drawio export round-trips', async () => {
  const t = await tidyModel(view(), ELK);
  const back = buildModel(loadDrawio(toDrawio(t), null)[0].graph);
  assert.equal(back.nodes.size, t.nodes.size);
  assert.equal(back.edges.length, t.edges.length);
  assert.equal(back.nodes.get('fw').meta.owner, 'NetSec');
  assert.equal(back.nodes.get('fw').x, Math.round(t.nodes.get('fw').x));
});
