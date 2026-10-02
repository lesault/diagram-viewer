import { parseXML, kids } from './xml.js';

function bytesToString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}

// draw.io compressed form: base64 -> raw deflate -> URI-encoded XML
export function decompressDiagram(body, inflateRaw) {
  const bin = atob(body.trim());
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const out = inflateRaw(arr);
  const str = typeof out === 'string' ? out : bytesToString(new Uint8Array(out));
  try { return decodeURIComponent(str); } catch { return str; }
}

// Returns [{name, graph: <mxGraphModel element>}] for every page in the file.
export function loadDrawio(text, inflateRaw) {
  const root = parseXML(text);
  if (!root) throw new Error('Not an XML file');
  if (root.tag === 'mxGraphModel') return [{ name: 'Page-1', graph: root }];
  if (root.tag !== 'mxfile') throw new Error('Not a draw.io file (expected <mxfile>)');
  const pages = [];
  for (const d of kids(root, 'diagram')) {
    let graph = d.children.find(c => c.tag === 'mxGraphModel');
    if (!graph && d.text.trim()) {
      graph = parseXML(decompressDiagram(d.text, inflateRaw));
    }
    if (graph) pages.push({ name: d.attrs.name || `Page-${pages.length + 1}`, graph });
  }
  if (!pages.length) throw new Error('No diagrams found in file');
  return pages;
}
