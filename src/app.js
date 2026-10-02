// ---- app: state, DOM wiring ----
const $ = id => document.getElementById(id);
const S = {
  pages: [], page: 0, model: null, graph: null,
  direction: 'both', depth: 2, infinite: false,
  hover: null, pinned: null, blocked: new Set(), previewing: false, previewModel: null,
  els: { n: new Map(), e: new Map() }, hl: [], vb: null, bounds: null,
};
const SAMPLE_XML = /*__SAMPLE__*/'';

const focusId = () => S.pinned || S.hover;
const curDepth = () => (S.infinite ? Infinity : S.depth);
const labelOf = n => (n.text || '').split('\n')[0].trim() || `(${n.id})`;

function computeView(id) {
  return lineage(S.graph, id, { direction: S.direction, depth: curDepth(), blocked: S.blocked });
}

// ---------- loading ----------
async function loadText(text, name) {
  try {
    S.pages = loadDrawio(text, b => pako.inflateRaw(b));
  } catch (err) { alert('Could not open file: ' + err.message); return; }
  S.fileName = (name || 'diagram').replace(/\.[^.]+$/, '');
  S.blocked.clear(); S.pinned = S.hover = null;
  renderTabs(); selectPage(0);
}

function selectPage(i) {
  S.page = i; S.previewing = false;
  S.model = buildModel(S.pages[i].graph);
  S.graph = buildGraph(S.model);
  S.pinned = S.hover = null;
  [...$('tabs').children].forEach((b, j) => b.classList.toggle('on', j === i));
  $('empty').hidden = true;
  drawCanvas(S.model); renderList(); renderDiagnostics(); renderDetails(); updateButtons();
}

function renderTabs() {
  const t = $('tabs'); t.innerHTML = '';
  if (S.pages.length < 2) return;
  S.pages.forEach((p, i) => { const b = document.createElement('button'); b.textContent = p.name; b.onclick = () => selectPage(i); t.appendChild(b); });
}

// ---------- canvas ----------
function drawCanvas(model) {
  const { svg, bounds: b } = renderSVG(model);
  $('canvasHost').innerHTML = svg;
  const el = $('canvasHost').firstElementChild;
  S.els = { n: new Map(), e: new Map() };
  el.querySelectorAll('.n').forEach(g => S.els.n.set(g.dataset.id, g));
  el.querySelectorAll('.e').forEach(g => S.els.e.set(g.dataset.id, g));
  S.hl = []; S.bounds = b; fit();
  $('empty').hidden = true;
}

function fit() {
  const svg = $('canvasHost').firstElementChild; if (!svg) return;
  const r = svg.getBoundingClientRect(), b = S.bounds;
  const k = Math.max(b.w / r.width, b.h / r.height);
  const w = r.width * k, h = r.height * k;
  S.vb = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
  applyVB();
}
function applyVB() {
  const svg = $('canvasHost').firstElementChild; if (!svg) return;
  const r = svg.getBoundingClientRect(), v = S.vb;
  if (r.width) v.h = v.w * (r.height / r.width);
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}

function setupCanvasEvents() {
  const host = $('canvasHost');
  let drag = null;
  host.addEventListener('wheel', ev => {
    const svg = host.firstElementChild; if (!svg) return;
    ev.preventDefault();
    const r = svg.getBoundingClientRect(), v = S.vb;
    const f = Math.exp(ev.deltaY * 0.0015);
    const mx = v.x + ((ev.clientX - r.left) / r.width) * v.w, my = v.y + ((ev.clientY - r.top) / r.height) * v.h;
    v.x = mx - (mx - v.x) * f; v.y = my - (my - v.y) * f; v.w *= f;
    applyVB();
  }, { passive: false });
  host.addEventListener('mousedown', ev => { if (ev.button !== 0) return; drag = { x: ev.clientX, y: ev.clientY, vx: S.vb.x, vy: S.vb.y, moved: false }; });
  window.addEventListener('mousemove', ev => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 3) { drag.moved = true; host.firstElementChild.classList.add('drag'); }
    if (drag.moved) {
      const r = host.firstElementChild.getBoundingClientRect();
      S.vb.x = drag.vx - dx * (S.vb.w / r.width); S.vb.y = drag.vy - dy * (S.vb.w / r.width); applyVB();
    }
  });
  window.addEventListener('mouseup', ev => {
    if (!drag) return;
    const was = drag; drag = null;
    const svg = host.firstElementChild; if (svg) svg.classList.remove('drag');
    if (was.moved || S.previewing) return;
    const g = ev.target.closest && ev.target.closest('.n:not(.grp)');
    pin(g ? g.dataset.id : null);
  });
  host.addEventListener('mouseover', ev => {
    if (S.previewing) return;
    const g = ev.target.closest && ev.target.closest('.n:not(.grp)');
    const id = g ? g.dataset.id : null;
    if (id !== S.hover) { S.hover = id; if (!S.pinned) refresh(); }
  });
  host.addEventListener('mouseleave', () => { if (S.hover) { S.hover = null; if (!S.pinned) refresh(); } });
  host.addEventListener('contextmenu', ev => {
    const g = ev.target.closest && ev.target.closest('.n:not(.grp)');
    if (!g) return;
    ev.preventDefault();
    const id = g.dataset.id;
    S.blocked.has(id) ? S.blocked.delete(id) : S.blocked.add(id);
    g.classList.toggle('blk', S.blocked.has(id)); refresh();
  });
}

// ---------- focus / highlight ----------
function pin(id) { S.pinned = id; if (!id) S.hover = null; refresh(); }

function refresh() {
  const svg = $('canvasHost').firstElementChild; if (!svg) return;
  for (const g of S.hl) g.classList.remove('hl', 'f');
  S.hl = [];
  const id = S.previewing ? null : focusId();
  svg.classList.toggle('focus', !!id);
  if (id && S.graph.out.has(id)) {
    const v = computeView(id);
    for (const [nid] of v.nodes) { const g = S.els.n.get(nid); if (g) { g.classList.add('hl'); if (nid === id) g.classList.add('f'); S.hl.push(g); } }
    for (const eid of v.edges) { const g = S.els.e.get(eid); if (g) { g.classList.add('hl'); S.hl.push(g); } }
    // containers holding highlighted nodes stay visible as context
    for (const [gid, g] of S.els.n) if (S.model.nodes.get(gid)?.isGroup) {
      const keep = [...v.nodes.keys()].some(nid => isInside(nid, gid));
      if (keep) { g.classList.add('hl'); S.hl.push(g); }
    }
  }
  $('banner').hidden = !id && !S.previewing;
  if (S.previewing) $('banner').textContent = 'Service view preview — click “Preview view” to return';
  else if (id) $('banner').textContent = `${labelOf(S.model.nodes.get(id))} · ${S.direction} · ${S.infinite ? '∞' : S.depth} hop${!S.infinite && S.depth === 1 ? '' : 's'}${S.pinned ? ' · pinned (Esc to clear)' : ''}`;
  renderDetails(); updateButtons();
  [...$('list').children].forEach(li => li.classList.toggle('sel', li.dataset.id === S.pinned));
}
function isInside(nid, gid) { let n = S.model.nodes.get(nid); while (n && n.parent) { if (n.parent === gid) return true; n = S.model.nodes.get(n.parent); } return false; }

function updateButtons() {
  const has = !!S.pinned;
  $('preview').disabled = !has && !S.previewing;
  $('export').disabled = !S.model;
}

// ---------- panels ----------
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('list'); ul.innerHTML = '';
  const items = [...S.model.nodes.values()].filter(n => !n.isGroup && (n.text || n.id)).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  for (const n of items) {
    const hay = (n.text + ' ' + Object.values(n.meta).join(' ')).toLowerCase();
    if (q && !hay.includes(q)) continue;
    const li = document.createElement('li'); li.textContent = labelOf(n); li.dataset.id = n.id; li.title = n.text;
    li.onclick = () => { S.previewing = false; pin(n.id); centerOn(n); };
    ul.appendChild(li);
  }
}
function centerOn(n) {
  if (S.previewing) return;
  const v = S.vb; v.x = n.x + n.w / 2 - v.w / 2; v.y = n.y + n.h / 2 - v.h / 2; applyVB();
}

function renderDiagnostics() {
  const d = S.model.diagnostics, b = $('diagBody');
  const li = (ids, t) => ids.length ? `<h4>${t} (${ids.length})</h4><ul>${ids.map(id => `<li data-id="${esc(id)}">${esc(S.model.nodes.has(id) ? labelOf(S.model.nodes.get(id)) : id)}</li>`).join('')}</ul>` : '';
  b.innerHTML = `<p class="hint">${S.model.nodes.size - S.model.groups.size} shapes · ${S.model.edges.length} connections</p>`
    + li(d.inferredEdges.map(id => S.model.edges.find(e => e.id === id)?.target || id), 'Edges attached by proximity (dashed)')
    + (d.danglingEdges.length ? `<h4>Unattached edges (${d.danglingEdges.length})</h4><p class="hint">One or both ends connect to nothing, so they are excluded from lineage.</p>` : '')
    + li(d.unconnected, 'Shapes with no connections')
    + (d.duplicateLabels.length ? `<h4>Duplicate labels (${d.duplicateLabels.length})</h4><ul>${d.duplicateLabels.map(x => `<li data-id="${esc(x.ids[0])}">${esc(x.label)} ×${x.ids.length}</li>`).join('')}</ul>` : '');
  b.querySelectorAll('li').forEach(el => el.onclick = () => { const n = S.model.nodes.get(el.dataset.id); if (n) { pin(n.id); centerOn(n); } });
}

function renderDetails() {
  const id = focusId(), box = $('details');
  if (!id || !S.model.nodes.has(id)) { box.innerHTML = '<p class="hint">Hover or select a shape to see its inputs and outputs.</p>'; return; }
  const n = S.model.nodes.get(id), v = computeView(id);
  const rows = Object.entries(n.meta).map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join('');
  const list = dir => {
    const items = [...v.nodes].filter(([nid]) => nid !== id && reach(id, nid, dir)).sort((a, b) => a[1] - b[1]);
    return items.length ? `<ul class="lin">${items.map(([nid, d]) => `<li data-id="${esc(nid)}">${esc(labelOf(S.model.nodes.get(nid)))} <small>${d} hop${d > 1 ? 's' : ''}</small></li>`).join('')}</ul>` : '<p class="hint">none</p>';
  };
  box.innerHTML = `<h3>${esc(labelOf(n))}</h3>${rows ? `<table>${rows}</table>` : ''}`
    + (S.direction !== 'down' ? `<h4>Inputs (upstream)</h4>${list('up')}` : '')
    + (S.direction !== 'up' ? `<h4>Outputs (downstream)</h4>${list('down')}` : '')
    + `<p class="hint">${S.blocked.has(id) ? 'Traversal stops at this shape (right-click to undo).' : ''}</p>`;
  box.querySelectorAll('li').forEach(el => el.onclick = () => { const t = S.model.nodes.get(el.dataset.id); if (t) { pin(t.id); } });
}
const _reach = new Map();
function reach(from, to, dir) { // is `to` upstream/downstream of `from` within the current view?
  const k = from + '|' + dir + '|' + curDepth();
  if (!_reach.has(k)) { _reach.clear(); _reach.set(k, lineage(S.graph, from, { direction: dir, depth: curDepth(), blocked: S.blocked }).nodes); }
  return _reach.get(k).has(to);
}

// ---------- service views & export ----------
async function buildView(id, { tidy, zones }) {
  const v = computeView(id);
  let sub = subModel(S.model, v.nodes.keys(), v.edges, { keepGroups: zones });
  if (tidy) sub = await tidyModel(sub, ELK, { focus: id });
  return sub;
}
const viewName = id => `${safeName(S.fileName)}__${safeName(labelOf(S.model.nodes.get(id)))}__${S.direction}-${S.infinite ? 'all' : S.depth}`;

async function togglePreview() {
  if (S.previewing) { S.previewing = false; drawCanvas(S.model); refresh(); return; }
  if (!S.pinned) return;
  const sub = await buildView(S.pinned, { tidy: $('optTidy').checked, zones: $('optZones').checked });
  S.previewing = true; S.previewModel = sub; drawCanvas(sub);
  $('banner').hidden = false; $('banner').textContent = 'Service view preview — click “Preview view” to return';
  $('preview').disabled = false;
}

async function emit(sub, base, fmt, out) {
  if (fmt.svg || fmt.png) {
    const svg = toSVG(sub, base);
    if (fmt.svg) out.push([base + '.svg', svg, 'image/svg+xml']);
    if (fmt.png) out.push([base + '.png', await svgToPngBlob(svg, 2), 'image/png']);
  }
  if (fmt.dio) out.push([base + '.drawio', toDrawio(sub, { name: base }), 'application/xml']);
}
const fmts = () => ({ svg: $('fSvg').checked, png: $('fPng').checked, dio: $('fDio').checked });
const opts = () => ({ tidy: $('optTidy').checked, zones: $('optZones').checked });

async function exportCurrent() {
  const id = S.pinned; if (!id) { $('dlgMsg').textContent = 'Pin a shape first (click it).'; return; }
  $('dlgMsg').textContent = 'Working…';
  try {
    const out = []; await emit(await buildView(id, opts()), viewName(id), fmts(), out);
    for (const [n, d, t] of out) download(n, d, t);
    $('dlgMsg').textContent = `Exported ${out.length} file(s).`;
  } catch (err) { $('dlgMsg').textContent = 'Export failed: ' + err.message; }
}

async function exportAll() {
  const q = $('search').value.trim().toLowerCase();
  const ids = [...S.model.nodes.values()].filter(n => !n.isGroup && S.graph.out.get(n.id).length + S.graph.inn.get(n.id).length > 0
    && (!q || (n.text + ' ' + Object.values(n.meta).join(' ')).toLowerCase().includes(q))).map(n => n.id);
  if (!ids.length) { $('dlgMsg').textContent = 'No connected shapes match.'; return; }
  const zip = new JSZip(), used = new Set();
  try {
    for (let i = 0; i < ids.length; i++) {
      $('dlgMsg').textContent = `Building ${i + 1} / ${ids.length}…`;
      await new Promise(r => setTimeout(r));
      const out = []; let base = viewName(ids[i]); while (used.has(base)) base += '_'; used.add(base);
      await emit(await buildView(ids[i], opts()), base, fmts(), out);
      for (const [n, d] of out) zip.file(n, d);
    }
    download(`${safeName(S.fileName)}__service-views.zip`, await zip.generateAsync({ type: 'blob' }));
    $('dlgMsg').textContent = `Zipped ${ids.length} service views.`;
  } catch (err) { $('dlgMsg').textContent = 'Batch failed: ' + err.message; }
}

// ---------- wiring ----------
function init() {
  setupCanvasEvents();
  $('open').onclick = () => $('file').click();
  $('file').onchange = async e => { const f = e.target.files[0]; if (f) loadText(await f.text(), f.name); e.target.value = ''; };
  $('sample').onclick = () => loadText(SAMPLE_XML, 'sample');
  $('fit').onclick = fit;
  $('search').oninput = () => S.model && renderList();
  $('dir').onclick = e => { const b = e.target.closest('button'); if (b) setDir(b.dataset.v); };
  $('depth').oninput = e => setDepth(+e.target.value);
  $('inf').onchange = e => { S.infinite = e.target.checked; refresh(); };
  $('preview').onclick = togglePreview;
  $('export').onclick = () => { $('dlgScope').textContent = S.pinned ? `Current view: ${labelOf(S.model.nodes.get(S.pinned))}, ${S.direction}, ${S.infinite ? 'all' : S.depth} hop(s).` : 'Pin a shape (click) to export its view, or export every service.'; $('dlgMsg').textContent = ''; $('dlg').showModal(); };
  $('doExport').onclick = exportCurrent; $('doBatch').onclick = exportAll;
  window.addEventListener('resize', applyVB);
  window.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox') return;
    if (e.key === 'Escape') { if (S.previewing) togglePreview(); else pin(null); }
    else if (/^[1-9]$/.test(e.key)) setDepth(+e.key);
    else if (e.key === 'u') setDir('up'); else if (e.key === 'd') setDir('down'); else if (e.key === 'b') setDir('both');
  });
  const st = $('stage');
  ['dragenter', 'dragover'].forEach(t => st.addEventListener(t, e => { e.preventDefault(); st.classList.add('dropping'); }));
  ['dragleave', 'drop'].forEach(t => st.addEventListener(t, e => { e.preventDefault(); st.classList.remove('dropping'); }));
  st.addEventListener('drop', async e => { const f = e.dataTransfer.files[0]; if (f) loadText(await f.text(), f.name); });
  if (!SAMPLE_XML) $('sample').hidden = true;
}
function setDir(v) { S.direction = v; [...$('dir').children].forEach(b => b.classList.toggle('on', b.dataset.v === v)); if (S.model) refresh(); }
function setDepth(d) { S.depth = Math.min(8, d); S.infinite = false; $('inf').checked = false; $('depth').value = S.depth; $('depthOut').textContent = S.depth; if (S.model) refresh(); }
init();
