// Generates samples/cyber-dataflow.drawio: a representative cross-functional (swimlane) security
// dataflow with metadata, labelled connectors, a hub, duplicate labels and some deliberately messy
// connectors. Run: node samples/generate-cyber.mjs
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const LANES = [
  ['E', 'Endpoints & Servers', '#dae8fc'], ['N', 'Network', '#d5e8d4'], ['I', 'Identity & Access', '#fff2cc'],
  ['C', 'Cloud & SaaS', '#e1d5e7'], ['P', 'Collection & Pipeline', '#f8cecc'], ['D', 'Data Platform', '#dae8fc'],
  ['A', 'Detection & Analytics', '#d5e8d4'], ['R', 'Response & Operations', '#fff2cc'], ['G', 'Governance & Reporting', '#e1d5e7'],
];
const lanes = Object.fromEntries(LANES.map(l => [l[0], { name: l[1], fill: l[2] }]));
// id, label, lane, column, row, shape, owner, criticality, classification
const N = [
  ['ep_win', 'Windows Endpoints', 'E', 0, 0, 'r', 'EUC', 'High', 'Internal'], ['ep_lin', 'Linux Servers', 'E', 0, 1, 'r', 'Platform Eng', 'High', 'Confidential'],
  ['mdm', 'MDM Platform', 'E', 1, 0, 'r', 'EUC', 'Medium', 'Internal'], ['dc', 'Domain Controllers', 'E', 1, 1, 'r', 'Identity Ops', 'Critical', 'Restricted'],
  ['fw_p', 'Perimeter Firewalls', 'N', 0, 0, 'r', 'NetSec', 'Critical', 'Confidential'], ['fw_i', 'Internal NGFW', 'N', 0, 1, 'r', 'NetSec', 'Critical', 'Confidential'],
  ['vpn', 'VPN Gateway', 'N', 1, 0, 'r', 'NetSec', 'High', 'Confidential'], ['proxy', 'Secure Web Gateway', 'N', 1, 1, 'r', 'NetSec', 'High', 'Internal'],
  ['dns', 'DNS Resolvers', 'N', 2, 0, 'r', 'Network Ops', 'High', 'Internal'], ['ndr_s', 'Network Sensors (NDR)', 'N', 2, 1, 'r', 'NetSec', 'Medium', 'Confidential'],
  ['idp', 'Identity Provider (SSO)', 'I', 0, 0, 'r', 'Identity Ops', 'Critical', 'Restricted'], ['ad', 'Active Directory', 'I', 0, 1, 'r', 'Identity Ops', 'Critical', 'Restricted'],
  ['mfa', 'MFA Service', 'I', 1, 0, 'r', 'Identity Ops', 'High', 'Confidential'], ['pam', 'PAM Vault', 'I', 1, 1, 'r', 'Identity Ops', 'Critical', 'Restricted'],
  ['aws', 'AWS CloudTrail', 'C', 0, 0, 'r', 'Cloud CoE', 'High', 'Confidential'], ['az', 'Azure Activity Logs', 'C', 0, 1, 'r', 'Cloud CoE', 'High', 'Confidential'],
  ['m365', 'M365 Audit', 'C', 1, 0, 'r', 'EUC', 'Medium', 'Internal'], ['casb', 'CASB', 'C', 1, 1, 'r', 'Cloud CoE', 'Medium', 'Internal'],
  ['syslog', 'Syslog Collectors', 'P', 3, 0, 'r', 'SecOps Eng', 'High', 'Confidential'], ['api', 'Cloud API Connectors', 'P', 3, 1, 'r', 'SecOps Eng', 'High', 'Confidential'],
  ['fwd_a', 'Log Forwarder', 'P', 2, 0, 'r', 'SecOps Eng', 'Medium', 'Confidential'], ['fwd_b', 'Log Forwarder', 'P', 2, 1, 'r', 'SecOps Eng', 'Medium', 'Confidential'],
  ['kafka', 'Kafka Event Bus', 'P', 4, 0, 'h', 'SecOps Eng', 'Critical', 'Confidential'], ['parser', 'Normalisation & Enrichment', 'P', 4, 1, 'r', 'SecOps Eng', 'High', 'Confidential'],
  ['tip', 'Threat Intel Platform', 'D', 3, 0, 'r', 'CTI', 'Medium', 'Internal'], ['cmdb', 'Asset CMDB', 'D', 4, 0, 'c', 'IT Ops', 'High', 'Internal'],
  ['lake', 'Raw Log Lake (S3)', 'D', 5, 0, 'c', 'Data Platform', 'High', 'Restricted'], ['siemidx', 'SIEM Index', 'D', 5, 1, 'c', 'SecOps Eng', 'Critical', 'Restricted'],
  ['vulndb', 'Vulnerability DB', 'D', 5, 2, 'c', 'VM Team', 'High', 'Confidential'],
  ['vscan', 'Vulnerability Scanner', 'A', 4, 0, 'r', 'VM Team', 'High', 'Confidential'], ['corr', 'SIEM Correlation Engine', 'A', 6, 0, 'r', 'SOC', 'Critical', 'Confidential'],
  ['ueba', 'UEBA', 'A', 6, 1, 'r', 'SOC', 'Medium', 'Confidential'], ['ndra', 'NDR Analytics', 'A', 6, 2, 'r', 'NetSec', 'Medium', 'Confidential'],
  ['edrc', 'EDR Console', 'R', 2, 2, 'r', 'SOC', 'Critical', 'Confidential'], ['soar', 'SOAR', 'R', 7, 0, 'r', 'SOC', 'Critical', 'Confidential'],
  ['console', 'SOC Analyst Console', 'R', 7, 1, 'r', 'SOC', 'High', 'Confidential'], ['case', 'Case Management (ITSM)', 'R', 8, 0, 'r', 'IT Ops', 'High', 'Internal'],
  ['grc', 'GRC Platform', 'G', 8, 0, 'r', 'GRC', 'Medium', 'Internal'], ['dash', 'Exec Risk Dashboard', 'G', 9, 0, 'r', 'GRC', 'Low', 'Internal'],
  ['audit', 'Audit Evidence Store', 'G', 9, 1, 'c', 'GRC', 'Medium', 'Restricted'],
];
// src, dst, label, extra style
const E = [
  ['ep_win', 'edrc', 'EDR telemetry'], ['ep_lin', 'edrc', 'EDR telemetry'], ['ep_win', 'syslog', 'Windows Event Fwd'], ['ep_lin', 'syslog', 'syslog (TLS)'],
  ['mdm', 'api', 'MDM API'], ['dc', 'syslog', 'security events'], ['ad', 'dc', 'replication', 'startArrow=classic;startFill=1;'],
  ['fw_p', 'syslog', 'syslog / CEF'], ['fw_i', 'syslog', 'syslog / CEF'], ['vpn', 'syslog', 'auth logs'], ['vpn', 'idp', 'SAML / RADIUS'],
  ['proxy', 'fwd_a', 'web logs'], ['dns', 'fwd_a', 'DNS queries'], ['ndr_s', 'ndra', 'flow metadata'], ['ndr_s', 'fwd_b', 'sensor alerts'],
  ['idp', 'api', 'System Log API'], ['mfa', 'api', 'auth events'], ['pam', 'syslog', 'session audit'], ['idp', 'ad', 'LDAPS sync', 'startArrow=classic;startFill=1;'], ['mfa', 'idp', 'assertions'],
  ['aws', 'api', 'S3 / SQS'], ['az', 'api', 'Event Hub'], ['m365', 'api', 'Mgmt Activity API'], ['casb', 'api', 'REST'],
  ['syslog', 'kafka', 'produce'], ['api', 'kafka', 'produce'], ['fwd_a', 'kafka', 'produce'], ['fwd_b', 'kafka', 'produce'],
  ['kafka', 'parser', 'consume'], ['tip', 'parser', 'IOC feed'], ['cmdb', 'parser', 'asset context'], ['parser', 'lake', 'raw + normalised'], ['parser', 'siemidx', 'indexed events'],
  ['vscan', 'vulndb', 'scan results'], ['vscan', 'ep_lin', 'authenticated scan'], ['vscan', 'cmdb', 'asset discovery'],
  ['siemidx', 'corr', 'search'], ['siemidx', 'ueba', 'baselines'], ['lake', 'ueba', 'history'], ['ndra', 'corr', 'detections'], ['vulndb', 'corr', 'exposure context'], ['tip', 'corr', 'IOC rules'],
  ['corr', 'soar', 'alerts'], ['ueba', 'soar', 'risk scores'], ['ndra', 'console', 'network detections'], ['corr', 'console', 'alerts'], ['tip', 'soar', 'enrichment'],
  ['soar', 'case', 'create incident'], ['soar', 'console', 'enrichment'], ['console', 'soar', 'playbook trigger'], ['edrc', 'soar', 'host events'],
  ['soar', 'edrc', 'isolate host'], ['soar', 'mfa', 'force re-auth'], ['soar', 'pam', 'revoke session'], ['soar', 'fw_p', 'block IOC'], ['soar', 'proxy', 'block URL'],
  ['case', 'grc', 'incident records'], ['corr', 'grc', 'control coverage'], ['vulndb', 'grc', 'vulnerability posture'], ['grc', 'dash', 'KPIs'], ['grc', 'audit', 'evidence'],
  ['siemidx', 'audit', 'retention export'], ['case', 'audit', 'evidence'],
];

const CW = 190, NW = 140, NH = 54, GAP = 22, PAD = 20, LHDR = 24, POOLHDR = 24;
const POOL = { x: 40, y: 40 };
const rowsIn = k => Math.max(1, ...N.filter(n => n[2] === k).map(n => n[4] + 1));
const laneH = Object.fromEntries(LANES.map(l => [l[0], PAD * 2 + rowsIn(l[0]) * NH + (rowsIn(l[0]) - 1) * GAP]));
const maxCol = Math.max(...N.map(n => n[3]));
const laneW = LHDR + PAD * 2 + (maxCol + 1) * CW;
const laneY = {}; let acc = 0;
for (const l of LANES) { laneY[l[0]] = acc; acc += laneH[l[0]]; }
const poolW = POOLHDR + laneW, poolH = acc;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const nodePos = {};
let cells = '';
cells += `<mxCell id="pool" value="Enterprise Security Dataflow" style="swimlane;html=1;childLayout=stackLayout;resizeParent=1;resizeParentMax=0;horizontal=0;startSize=${POOLHDR};horizontalStack=0;fontStyle=1;fontSize=14;" vertex="1" parent="1"><mxGeometry x="${POOL.x}" y="${POOL.y}" width="${poolW}" height="${poolH}" as="geometry"/></mxCell>`;
for (const [k, l] of Object.entries(lanes)) {
  cells += `<mxCell id="lane_${k}" value="${esc(l.name)}" style="swimlane;html=1;horizontal=0;startSize=${LHDR};fillColor=${l.fill};swimlaneFillColor=#ffffff;fontSize=12;" vertex="1" parent="pool"><mxGeometry x="${POOLHDR}" y="${laneY[k]}" width="${laneW}" height="${laneH[k]}" as="geometry"/></mxCell>`;
}
const styleFor = (shape, lane) => {
  const base = 'html=1;whiteSpace=wrap;fontSize=11;';
  if (shape === 'c') return `shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=10;${base}fillColor=#ffffff;`;
  if (shape === 'h') return `shape=hexagon;perimeter=hexagonPerimeter2;${base}fillColor=#f8cecc;strokeWidth=2;`;
  return `rounded=1;${base}fillColor=${lanes[lane].fill};`;
};
for (const [id, label, lane, col, row, shape, owner, crit, cls] of N) {
  const x = LHDR + PAD + col * CW, y = PAD + row * (NH + GAP);
  nodePos[id] = { x: POOL.x + POOLHDR + x, y: POOL.y + laneY[lane] + y, w: NW, h: NH };
  cells += `<object label="${esc(label)}" id="${id}" owner="${esc(owner)}" criticality="${crit}" data_classification="${cls}" environment="Prod"><mxCell style="${styleFor(shape, lane)}" vertex="1" parent="lane_${lane}"><mxGeometry x="${x}" y="${y}" width="${NW}" height="${NH}" as="geometry"/></mxCell></object>`;
}
let ei = 0;
const edgeStyle = x => `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=9;${x || ''}`;
const colOf = Object.fromEntries(N.map(n => [n[0], n[3]]));
const colLeft = c => POOL.x + POOLHDR + LHDR + PAD + c * CW;       // absolute x of a column's left edge
const rects = Object.values(nodePos);
const hit = (p, q, r) => Math.max(p.x, q.x) > r.x + 1 && Math.min(p.x, q.x) < r.x + r.w - 1 && Math.max(p.y, q.y) > r.y + 1 && Math.min(p.y, q.y) < r.y + r.h - 1;
// spread connectors along a node side so they don't all stack on the middle
const side = {};
const slot = (id, which) => { const k = id + which; side[k] = (side[k] || 0) + 1; return side[k]; };
const total = {};
for (const [s, t] of E) { const f = colOf[t] > colOf[s] ? 'R' : colOf[t] < colOf[s] ? 'L' : 'V'; total[s + 'o' + f] = (total[s + 'o' + f] || 0) + 1; total[t + 'i' + f] = (total[t + 'i' + f] || 0) + 1; }
const frac = (id, kind, f) => { const n = total[id + kind + f], i = slot(id, kind + f); return i / (n + 1); };
const route = (s, t) => {
  const a = nodePos[s], b = nodePos[t], cs = colOf[s], ct = colOf[t];
  if (ct === cs) {                       // same column: straight down/up
    const down = b.y > a.y, fo = frac(s, 'o', 'V'), fi = frac(t, 'i', 'V');
    const A = { x: a.x + a.w * fo, y: down ? a.y + a.h : a.y }, B = { x: b.x + b.w * fi, y: down ? b.y : b.y + b.h };
    const my = (A.y + B.y) / 2;
    return { ports: `exitX=${fo.toFixed(2)};exitY=${down ? 1 : 0};entryX=${fi.toFixed(2)};entryY=${down ? 0 : 1};`, pts: Math.abs(A.x - B.x) < 1 ? [] : [{ x: A.x, y: my }, { x: B.x, y: my }] };
  }
  const fw = ct > cs, fo = frac(s, 'o', fw ? 'R' : 'L'), fi = frac(t, 'i', fw ? 'R' : 'L');
  const A = { x: fw ? a.x + a.w : a.x, y: a.y + a.h * fo }, B = { x: fw ? b.x : b.x + b.w, y: b.y + b.h * fi };
  let best = null;
  const lo = Math.min(cs, ct), hi = Math.max(cs, ct);
  for (let g = lo; g < hi; g++) {          // gap between column g and g+1
    const cx = colLeft(g) + NW + (CW - NW) / 2 + ((s.length + t.length + g) % 5 - 2) * 4;
    const pts = [A, { x: cx, y: A.y }, { x: cx, y: B.y }, B];
    let score = 0;
    for (let k = 1; k < pts.length; k++) for (const r of rects) if (r !== a && r !== b && hit(pts[k - 1], pts[k], r)) score++;
    if (!best || score < best.score) best = { score, cx };
  }
  const pts = Math.abs(A.y - B.y) < 1 ? [] : [{ x: best.cx, y: A.y }, { x: best.cx, y: B.y }];
  return { ports: `exitX=${fw ? 1 : 0};exitY=${fo.toFixed(2)};entryX=${fw ? 0 : 1};entryY=${fi.toFixed(2)};`, pts };
};
for (const [s, t, label, extra] of E) {
  const id = `e${++ei}`;
  const parent = ei % 9 === 0 ? 'pool' : '1';       // some connectors live inside the pool, so their coordinates are pool-relative
  const off = parent === 'pool' ? POOL : { x: 0, y: 0 };
  const r = route(s, t);
  const arr = r.pts.length ? `<Array as="points">${r.pts.map(p => `<mxPoint x="${Math.round(p.x - off.x)}" y="${Math.round(p.y - off.y)}"/>`).join('')}</Array>` : '';
  cells += `<mxCell id="${id}" value="${esc(label)}" style="${edgeStyle(r.ports + (extra || ''))}" edge="1" parent="${parent}" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry">${arr}</mxGeometry></mxCell>`;
}
// deliberately messy connectors (as hand-drawn diagrams have): ends dropped near shapes rather than glued to them
const near = (id, dx = 0, dy = 0, side = 'r') => { const p = nodePos[id]; return side === 'r' ? { x: p.x + p.w + 6 + dx, y: p.y + p.h / 2 + dy } : { x: p.x - 6 + dx, y: p.y + p.h / 2 + dy }; };
const loose = (label, a, b) => `<mxCell id="e${++ei}" value="${label}" style="${edgeStyle()}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${a.x}" y="${a.y}" as="sourcePoint"/><mxPoint x="${b.x}" y="${b.y}" as="targetPoint"/></mxGeometry></mxCell>`;
cells += loose('GeoIP feed', near('tip', 0, 0, 'l'), near('tip', -90, 0, 'l'));   // dangling stub (target connects to nothing)
cells += loose('flow export', near('fw_i', 0, 12), near('ndr_s', 0, 0, 'l'));                // both ends unglued but touching shapes
cells += loose('NetFlow', near('dns', 0, 10), near('ndra', 0, 0, 'l'));
// a free-floating note, and an orphan service with no connections
cells += `<mxCell id="note" value="Legend: cylinders = data stores, hexagon = shared bus" style="text;html=1;fontSize=10;fontColor=#666666;" vertex="1" parent="1"><mxGeometry x="${POOL.x}" y="${POOL.y + poolH + 10}" width="360" height="20" as="geometry"/></mxCell>`;
cells += `<object label="Legacy Syslog Relay" id="legacy" owner="Unknown" criticality="Low" data_classification="Internal"><mxCell style="rounded=1;dashed=1;html=1;fontSize=11;" vertex="1" parent="lane_P"><mxGeometry x="${LHDR + PAD + 5 * CW}" y="${PAD}" width="${NW}" height="${NH}" as="geometry"/></mxCell></object>`;

const page1 = `<mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" page="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
// page 2 stored in draw.io's compressed form to exercise that loader path
const p2 = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="Backup Vault" style="shape=cylinder3;html=1;" vertex="1" parent="1"><mxGeometry x="60" y="60" width="80" height="70" as="geometry"/></mxCell>
<mxCell id="b" value="Immutable Archive" style="shape=cylinder3;html=1;" vertex="1" parent="1"><mxGeometry x="260" y="60" width="80" height="70" as="geometry"/></mxCell>
<mxCell id="c" value="eDiscovery" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="460" y="65" width="100" height="60" as="geometry"/></mxCell>
<mxCell id="x1" value="replicate" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="x2" value="export" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="b" target="c"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>`;
const packed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(p2))).toString('base64');
writeFileSync(new URL('./cyber-dataflow.drawio', import.meta.url),
  `<mxfile host="generator"><diagram name="Security Dataflow" id="main">${page1}</diagram><diagram name="Backup (compressed page)" id="p2">${packed}</diagram></mxfile>\n`);
console.log(`${N.length} services, ${E.length + 3} connectors, ${LANES.length} lanes`);
