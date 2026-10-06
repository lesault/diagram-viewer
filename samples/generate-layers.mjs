// Generates samples/layered-network.drawio: a multi-layer diagram.
//   Zones            boxes (with properties) that visually contain services drawn on another layer
//   Services         the shapes
//   Logging flows    connectors, one layer per kind of flow
//   Identity flows
//   Response (draft) connectors, layer hidden in the file
//   Annotations      free text
// Run: node samples/generate-layers.mjs
import { writeFileSync } from 'node:fs';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const zones = [
  ['dc', 'Corporate Datacentre', 40, 40, 940, 540, { site: 'London', classification: 'Restricted', owner: 'Infrastructure' }, '#f5f5f5'],
  ['vlan', 'Prod VLAN 10', 70, 100, 440, 440, { trust: 'High', owner: 'Platform Eng' }, '#d5e8d4'],
  ['dmz', 'DMZ', 540, 100, 410, 440, { trust: 'Low', owner: 'NetSec' }, '#ffe6cc'],
  ['cloud', 'AWS eu-west-2', 1040, 40, 520, 540, { provider: 'AWS', account: 'sec-logging', classification: 'Confidential' }, '#dae8fc'],
  ['branch', 'Branch Offices', 40, 640, 620, 230, { sites: '14', owner: 'EUC' }, '#e1d5e7'],
];
// id, label, x, y, shape, owner, criticality
const svc = [
  ['ad', 'Active Directory', 100, 160, 'r', 'Identity Ops', 'Critical'], ['erp', 'ERP Database', 300, 160, 'c', 'Apps', 'High'],
  ['app', 'App Servers', 100, 300, 'r', 'Platform Eng', 'High'], ['fs', 'File Servers', 300, 300, 'r', 'Platform Eng', 'Medium'],
  ['agent', 'Log Agent', 200, 430, 'r', 'SecOps Eng', 'High'],
  ['waf', 'WAF', 580, 160, 'r', 'NetSec', 'Critical'], ['proxy', 'Reverse Proxy', 780, 160, 'r', 'NetSec', 'High'],
  ['vpn', 'VPN Gateway', 580, 320, 'r', 'NetSec', 'High'], ['relay', 'Syslog Relay', 780, 320, 'r', 'SecOps Eng', 'High'],
  ['s3', 'Log Bucket (S3)', 1080, 160, 'c', 'Cloud CoE', 'High'], ['trail', 'CloudTrail', 1300, 160, 'r', 'Cloud CoE', 'High'],
  ['lambda', 'Parser (Lambda)', 1080, 320, 'r', 'SecOps Eng', 'Medium'], ['siem', 'SIEM SaaS', 1300, 320, 'r', 'SOC', 'Critical'],
  ['idp', 'Cloud IdP', 1300, 450, 'r', 'Identity Ops', 'Critical'],
  ['bfw', 'Branch Firewalls', 80, 700, 'r', 'NetSec', 'High'], ['bpc', 'Branch Endpoints', 300, 700, 'r', 'EUC', 'Medium'],
  ['soc', 'SOC Console', 760, 700, 'r', 'SOC', 'High'], ['soar', 'SOAR', 1000, 700, 'r', 'SOC', 'Critical'],   // outside every zone box
];
const flows = {
  L2: ['Logging flows', '#1a73e8', [['agent', 'relay', 'syslog/TLS'], ['app', 'agent', 'app logs'], ['fs', 'agent', 'audit logs'], ['waf', 'relay', 'WAF logs'], ['proxy', 'relay', 'access logs'], ['vpn', 'relay', 'VPN auth'],
    ['relay', 's3', 'forward'], ['trail', 's3', 'API audit'], ['s3', 'lambda', 'object events'], ['lambda', 'siem', 'normalised'], ['bfw', 'relay', 'syslog'], ['bpc', 'agent', 'EDR telemetry'], ['siem', 'soc', 'alerts']]],
  L3: ['Identity flows', '#e8710a', [['ad', 'idp', 'AAD Connect'], ['idp', 'siem', 'sign-in logs'], ['vpn', 'idp', 'SAML'], ['proxy', 'idp', 'OIDC'], ['ad', 'agent', 'DC events']]],
  L4: ['Response (draft)', '#d93025', [['soar', 'waf', 'block IOC'], ['soar', 'vpn', 'revoke session'], ['soc', 'soar', 'playbook']]],
};
let cells = '<mxCell id="0"/>';
const layers = [['LZ', 'Zones', true], ['L1', 'Services', true], ['L2', flows.L2[0], true], ['L3', flows.L3[0], true], ['L4', flows.L4[0], false], ['LA', 'Annotations', true]];
for (const [id, name, vis] of layers) cells += `<mxCell id="${id}" value="${esc(name)}" parent="0"${vis ? '' : ' visible="0"'}/>`;
for (const [id, label, x, y, w, h, meta, fill] of zones) {
  const attrs = Object.entries(meta).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  cells += `<object label="${esc(label)}" id="${id}"${attrs}><mxCell style="rounded=1;arcSize=2;fillColor=${fill};strokeColor=#7a7f87;dashed=1;verticalAlign=top;align=left;spacingLeft=8;fontStyle=1;html=1;" vertex="1" parent="LZ"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell></object>`;
}
for (const [id, label, x, y, shape, owner, crit] of svc) {
  const st = shape === 'c' ? 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=10;html=1;fontSize=11;' : 'rounded=1;html=1;fontSize=11;whiteSpace=wrap;';
  cells += `<object label="${esc(label)}" id="${id}" owner="${esc(owner)}" criticality="${crit}"><mxCell style="${st}" vertex="1" parent="L1"><mxGeometry x="${x}" y="${y}" width="130" height="54" as="geometry"/></mxCell></object>`;
}
let n = 0;
for (const [lid, [, color, list]] of Object.entries(flows)) for (const [s, t, label] of list)
  cells += `<mxCell id="f${++n}" value="${esc(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=9;strokeColor=${color};fontColor=${color};" edge="1" parent="${lid}" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
cells += `<mxCell id="note" value="Colours: blue = logging, orange = identity, red = response (draft)" style="text;html=1;fontSize=10;fontColor=#666666;" vertex="1" parent="LA"><mxGeometry x="40" y="900" width="420" height="20" as="geometry"/></mxCell>`;
writeFileSync(new URL('./layered-network.drawio', import.meta.url), `<mxfile host="generator"><diagram name="Network (layers)" id="l1"><mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" page="0"><root>${cells}</root></mxGraphModel></diagram></mxfile>\n`);
console.log(`${svc.length} services, ${n} connectors, ${layers.length} layers, ${zones.length} zones`);
