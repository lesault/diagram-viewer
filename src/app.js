// ---- app: state, DOM wiring ----
const $ = id => document.getElementById(id);
const S = {
  pages: [], page: 0, full: null, view: null, graph: null, zones: null,
  hiddenLayers: new Set(), ctxLayers: new Set(), tidied: false, fileName: 'diagram',
  direction: 'both', depth: 2, infinite: false,
  hover: null, pinned: null, finding: null, blocked: new Set(),
  previewing: false, previewModel: null,
  opt: { heading: true, title: '{service} — {direction} lineage ({hops})', subtitle: '{file} · {page} · {date}', tidy: true, lanes: true, zones: true, zoneMeta: true, focus: true,
    wholeTitle: '{file} — {page}', wholeSubtitle: 'Layers: {layers} · {date}' },
  counts: new Set(), countsAll: false,
  metaKey: '', diag: null,
  els: { n: new Map(), e: new Map(), l: new Map() }, hl: [], vb: null, bounds: null,
};
const SAMPLE_XML = /*__SAMPLE__*/'';
const DIR_TEXT = { up: 'upstream', down: 'downstream', both: 'upstream & downstream' };

const focusId = () => S.pinned || S.hover;
// connection-count badges: per shape, or for all shapes; counts always come from the main diagram
function currentBadges() {
  if (!S.view) return null;
  const m = new Map();
  for (const n of S.view.nodes.values()) if (!n.isGroup && !n.ctxBox && !n.style.text && (S.countsAll || S.counts.has(n.id))) m.set(n.id, countConnections(S.graph, n.id));
  return m.size ? m : null;
}
function redrawBadges() {
  if (S.previewing) { schedulePreview(0); return; }
  drawCanvas(S.view, {}, false); renderDetails();
}
function toggleCounts(id) { S.counts.has(id) ? S.counts.delete(id) : S.counts.add(id); redrawBadges(); }
const curDepth = () => (S.infinite ? Infinity : S.depth);
const labelOf = n => (n.text || '').split('\n')[0].trim() || `(${n.id})`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const computeView = id => lineage(S.graph, id, { direction: S.direction, depth: curDepth(), blocked: S.blocked });
const pageName = () => (S.pages[S.page] ? S.pages[S.page].name : '');
const visibleLayerNames = () => (S.full.layers || []).filter(l => !S.hiddenLayers.has(l.id)).map(l => l.name).join(', ') || 'all';

// ---------- headings ----------
function tokenCtx(id) {
  const n = id && S.view.nodes.get(id);
  return {
    service: n ? labelOf(n) : 'Full diagram', direction: DIR_TEXT[S.direction],
    hops: S.infinite ? 'all hops' : `${S.depth} hop${S.depth === 1 ? '' : 's'}`,
    file: S.fileName, page: pageName(), date: todayStr(), layers: visibleLayerNames(),
  };
}
const fillTokens = (str, ctx) => String(str).replace(/\{(\w+)\}/g, (m, k) => (k in ctx ? ctx[k] : m));
function headingFor(id) {
  if (!S.opt.heading) return null;
  const c = tokenCtx(id);
  return { title: fillTokens(S.opt.title, c).trim(), subtitle: fillTokens(S.opt.subtitle, c).trim() };
}
function wholeHeading() {
  if (!S.opt.heading) return null;
  const c = tokenCtx(null);
  return { title: fillTokens(S.opt.wholeTitle, c).trim(), subtitle: fillTokens(S.opt.wholeSubtitle, c).trim() };
}

// ---------- theme ----------
function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('theme').value = mode; S.theme = mode;
  try { localStorage.setItem('lv-theme', mode); } catch (e) { /* storage unavailable */ }
}
function applyInvert(on) {
  document.documentElement.dataset.invert = on ? '1' : '0'; $('invert').checked = on;
  try { localStorage.setItem('lv-invert', on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
}

// ---------- loading ----------
async function loadText(text, name) {
  try { S.pages = loadDrawio(text, b => pako.inflateRaw(b)); }
  catch (err) { alert('Could not open file: ' + err.message); return; }
  S.fileName = (name || 'diagram').replace(/\.[^.]+$/, '');
  S.blocked.clear(); S.tidied = false;
  renderTabs(); selectPage(0);
}

function selectPage(i) {
  S.page = i; S.previewing = false; S.finding = null;
  S.full = buildModel(S.pages[i].graph);
  S.hiddenLayers = new Set((S.full.layers || []).filter(l => !l.visible).map(l => l.id));
  S.ctxLayers = new Set(suggestContextLayers(S.full));
  S.suggested = new Set(S.ctxLayers);
  S.counts = new Set([...S.full.nodes.values()].filter(n => /^(1|true|yes)$/i.test(String((n.meta || {}).show_counts || ''))).map(n => n.id));
  S.pinned = S.hover = null; S.tidied = false;
  [...$('tabs').children].forEach((b, j) => b.classList.toggle('on', j === i));
  rebuildView(true);
}

function renderTabs() {
  const t = $('tabs'); t.innerHTML = '';
  if (S.pages.length < 2) return;
  S.pages.forEach((p, i) => { const b = document.createElement('button'); b.textContent = p.name; b.onclick = () => selectPage(i); t.appendChild(b); });
}

// Everything derived from the layer choices and (optionally) tidied connectors.
function rebuildView(fit) {
  S.view = filterLayers(S.full, { hidden: S.hiddenLayers, context: S.ctxLayers });
  if (S.tidied) rerouteAll(S.view);
  S.graph = buildGraph(S.view);
  S.zones = computeZones(S.view);
  if (S.pinned && !S.graph.out.has(S.pinned)) S.pinned = null;
  for (const id of [...S.blocked]) if (!S.graph.out.has(id)) S.blocked.delete(id);
  S.hover = null; S.finding = null;
  if (S.previewing && !S.pinned) S.previewing = false;
  $('empty').hidden = true;
  if (S.previewing) schedulePreview(0); else drawCanvas(S.view, {}, fit !== false && fit === true);
  renderList(); renderLayers(); runChecks(); renderDetails(); updateChrome();
}

// ---------- canvas ----------
function drawCanvas(model, opts = {}, doFit = true) {
  const { svg, bounds: b } = renderSVG(model, { badges: currentBadges(), ...opts });
  const old = S.vb;
  $('canvasHost').innerHTML = svg;
  const el = $('canvasHost').firstElementChild;
  S.els = { n: new Map(), e: new Map(), l: new Map() };
  el.querySelectorAll('.n').forEach(g => S.els.n.set(g.dataset.id, g));
  el.querySelectorAll('.e').forEach(g => S.els.e.set(g.dataset.id, g));
  el.querySelectorAll('.el').forEach(g => S.els.l.set(g.dataset.id, g));
  S.hl = []; S.bounds = b;
  if (doFit || !old) fit(); else { S.vb = old; applyVB(); }
  for (const id of S.blocked) { const g = S.els.n.get(id); if (g) g.classList.add('blk'); }
  if (!S.previewing) refresh();
}

function fit(b) {
  const svg = $('canvasHost').firstElementChild; if (!svg) return;
  b = b || S.bounds;
  const r = svg.getBoundingClientRect();
  const k = Math.max(b.w / r.width, b.h / r.height);
  const w = r.width * k, h = r.height * k;
  S.vb = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
  applyVB();
}
function applyVB() {
  const svg = $('canvasHost').firstElementChild; if (!svg || !S.vb) return;
  const r = svg.getBoundingClientRect(), v = S.vb;
  if (r.width) v.h = v.w * (r.height / r.width);
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}
function fitRects(rects, pad = 90) {
  if (!rects.length) return;
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
  const w = Math.max(x1 - x0 + 2 * pad, 520), h = Math.max(y1 - y0 + 2 * pad, 320);
  fit({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
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
    if (was.moved || S.previewing || !host.contains(ev.target)) return;
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
    if (S.previewing) return;
    const g = ev.target.closest && ev.target.closest('.n:not(.grp)');
    if (!g) return;
    ev.preventDefault();
    const id = g.dataset.id;
    S.blocked.has(id) ? S.blocked.delete(id) : S.blocked.add(id);
    g.classList.toggle('blk', S.blocked.has(id)); refresh();
  });
}

// ---------- focus / highlight ----------
function pin(id) { S.pinned = id; if (!id) { S.hover = null; S.finding = null; } refresh(); }

function addHl(g, f) { if (g) { g.classList.add('hl'); if (f) g.classList.add(f); S.hl.push(g); } }
const hlEdge = (eid, f) => { addHl(S.els.e.get(eid), f); addHl(S.els.l.get(eid)); };   // connector and its label together

function refresh() {
  const svg = $('canvasHost').firstElementChild; if (!svg) return;
  for (const g of S.hl) g.classList.remove('hl', 'f', 'dx');
  S.hl = [];
  const id = S.previewing ? null : focusId();
  const fin = !id && !S.previewing ? S.finding : null;
  svg.classList.toggle('focus', !!id || !!fin);
  if (id && S.graph.out.has(id)) {
    const v = computeView(id);
    const nodes = [...v.nodes.keys()];
    for (const nid of nodes) addHl(S.els.n.get(nid), nid === id ? 'f' : null);
    for (const eid of v.edges) hlEdge(eid);
    // containers and zone boxes holding highlighted shapes stay visible as context
    for (const [gid, g] of S.els.n) {
      const n = S.view.nodes.get(gid);
      if (n && n.isGroup && nodes.some(nid => isInside(nid, gid))) addHl(g);
    }
    for (const nid of nodes) for (const z of S.zones.chain(nid)) addHl(S.els.n.get(z));
  } else if (fin) {
    for (const nid of fin.nodes) addHl(S.els.n.get(nid), 'dx');
    for (const eid of fin.edges) hlEdge(eid, 'dx');
  }
  updateChrome();
  renderDetails();
  [...$('list').children].forEach(li => li.classList.toggle('sel', li.dataset.id === S.pinned));
}
function isInside(nid, gid) { let n = S.view.nodes.get(nid); while (n && n.parent) { if (n.parent === gid) return true; n = S.view.nodes.get(n.parent); } return false; }

function updateChrome() {
  const banner = $('banner');
  const id = S.previewing ? null : focusId();
  let text = '';
  if (S.previewing) text = `Service view: ${labelOf(S.view.nodes.get(S.pinned))}`;
  else if (id && S.view.nodes.has(id)) text = `${labelOf(S.view.nodes.get(id))} · ${DIR_TEXT[S.direction]} · ${S.infinite ? 'all' : S.depth} hop${!S.infinite && S.depth === 1 ? '' : 's'}${S.pinned ? ' · pinned (Esc to clear)' : ''}`;
  else if (S.finding) text = S.finding.label + ' (Esc to clear)';
  banner.hidden = !text; banner.textContent = text;
  $('viewbar').hidden = !S.previewing;
  $('preview').disabled = !S.pinned && !S.previewing;
  $('preview').textContent = S.previewing ? 'Back to diagram' : 'Preview view';
  $('preview').classList.toggle('on-state', S.previewing);
  $('export').disabled = !S.view;
  $('tidy').disabled = !S.view || S.previewing;
  $('tidy').textContent = S.tidied ? 'Original connectors' : 'Tidy connectors';
  $('tidy').classList.toggle('on-state', S.tidied);
}

// ---------- panels ----------
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('list'); ul.innerHTML = '';
  const items = [...S.view.nodes.values()].filter(n => !n.isGroup && !n.ctxBox && !n.style.text && (n.text || n.id)).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  for (const n of items) {
    const hay = (n.text + ' ' + Object.values(n.meta).join(' ')).toLowerCase();
    if (q && !hay.includes(q)) continue;
    const li = document.createElement('li'); li.textContent = labelOf(n); li.dataset.id = n.id; li.title = n.text;
    li.onclick = () => { if (S.previewing) backToDiagram(); pin(n.id); centerOn(n); };
    ul.appendChild(li);
  }
}
function centerOn(n) {
  if (S.previewing) return;
  const v = S.vb; v.x = n.x + n.w / 2 - v.w / 2; v.y = n.y + n.h / 2 - v.h / 2; applyVB();
}

function renderLayers() {
  const box = $('layerList'), layers = S.full.layers || [];
  if (layers.length < 2) { box.innerHTML = '<p class="hint">This diagram has a single layer.</p>'; return; }
  box.innerHTML = layers.map(l => `<div class="lrow">
    <label class="name"><input type="checkbox" data-show="${esc(l.id)}" ${S.hiddenLayers.has(l.id) ? '' : 'checked'}> ${esc(l.name)}</label>
    <small>${l.nodes} shape${l.nodes === 1 ? '' : 's'} · ${l.edges} connector${l.edges === 1 ? '' : 's'}</small>
    <label class="frame" title="Keep this layer's boxes as labelled frames around the shapes they contain, in service views"><input type="checkbox" data-frame="${esc(l.id)}" ${S.ctxLayers.has(l.id) ? 'checked' : ''}> frame in service views ${S.suggested && S.suggested.has(l.id) ? '<em>suggested</em>' : ''}</label>
  </div>`).join('');
  box.querySelectorAll('input[data-show]').forEach(c => c.onchange = () => { c.checked ? S.hiddenLayers.delete(c.dataset.show) : S.hiddenLayers.add(c.dataset.show); rebuildView(false); });
  box.querySelectorAll('input[data-frame]').forEach(c => c.onchange = () => { c.checked ? S.ctxLayers.add(c.dataset.frame) : S.ctxLayers.delete(c.dataset.frame); rebuildView(false); });
}

function renderDetails() {
  const id = S.previewing ? null : focusId(), box = $('details');
  if (!id || !S.view.nodes.has(id)) { box.innerHTML = '<p class="hint">Hover or select a shape to see its inputs and outputs.</p>'; return; }
  const n = S.view.nodes.get(id), v = computeView(id);
  const rows = Object.entries(n.meta).map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join('');
  const layer = (S.full.layers || []).find(l => l.id === n.layer);
  const zones = S.zones.chain(id).reverse().map(zid => {
    const z = S.zones.zones.get(zid).node, props = Object.entries(z.meta).map(([k, val]) => `${esc(k)}: ${esc(val)}`).join(' · ');
    return `<div class="zone"><b>${esc(labelOf(z))}</b>${props ? `<br><small class="hint">${props}</small>` : ''}</div>`;
  }).join('');
  const list = dir => {
    const items = [...v.nodes].filter(([nid]) => nid !== id && reach(id, nid, dir)).sort((a, b) => a[1] - b[1]);
    return items.length ? `<ul class="lin">${items.map(([nid, d]) => `<li data-id="${esc(nid)}">${esc(labelOf(S.view.nodes.get(nid)))} <small>${d} hop${d > 1 ? 's' : ''}</small></li>`).join('')}</ul>` : '<p class="hint">none</p>';
  };
  const cc = countConnections(S.graph, id);
  box.innerHTML = `<h3>${esc(labelOf(n))}</h3><p class="counts">Inbound <b>${cc.in}</b> · Outbound <b>${cc.out}</b></p><label class="check"><input type="checkbox" id="cntBox" ${S.countsAll || S.counts.has(id) ? 'checked' : ''} ${S.countsAll ? 'disabled' : ''}> Show counts on this shape <small class="hint">(c)</small></label>${layer && (S.full.layers || []).length > 1 ? `<p class="hint">Layer: ${esc(layer.name)}</p>` : ''}${rows ? `<table>${rows}</table>` : ''}`
    + (zones ? `<h4>Zones</h4>${zones}` : '')
    + (S.direction !== 'down' ? `<h4>Inputs (upstream)</h4>${list('up')}` : '')
    + (S.direction !== 'up' ? `<h4>Outputs (downstream)</h4>${list('down')}` : '')
    + `<p class="hint">${S.blocked.has(id) ? 'Traversal stops at this shape (right-click to undo).' : ''}</p>`;
  box.querySelectorAll('li').forEach(el => el.onclick = () => { const t = S.view.nodes.get(el.dataset.id); if (t) pin(t.id); });
  const cb = $('cntBox'); if (cb) cb.onchange = () => toggleCounts(id);
}
const _reach = new Map();
function reach(from, to, dir) {
  const k = from + '|' + dir + '|' + curDepth() + '|' + [...S.blocked].join(',');
  if (!_reach.has(k)) { _reach.clear(); _reach.set(k, lineage(S.graph, from, { direction: dir, depth: curDepth(), blocked: S.blocked }).nodes); }
  return _reach.get(k).has(to);
}

// ---------- checks ----------
function runChecks() {
  S.diag = diagnose(S.view, { metaKey: S.metaKey, zones: S.zones, routes: true });
  renderChecks();
}
function renderChecks() {
  const d = S.diag, sel = $('metaKey');
  const keep = S.metaKey;
  sel.innerHTML = '<option value="">(none)</option>' + d.metaKeys.map(k => `<option value="${esc(k.key)}" ${k.key === keep ? 'selected' : ''}>${esc(k.key)} (${k.count})</option>`).join('');
  $('chkSummary').innerHTML = `<span class="hint">${d.summary.shapes} shapes · ${d.summary.connectors} connectors</span> `
    + ['error', 'warn', 'info'].map(s => `<span class="chip ${s}">${d.counts[s]} ${s === 'warn' ? 'warnings' : s === 'error' ? 'errors' : 'notes'}</span>`).join('');
  const b = $('chkBadge'); const bad = d.counts.error + d.counts.warn; b.hidden = !bad; b.textContent = bad;
  b.style.background = d.counts.error ? 'var(--err)' : 'var(--warn)';
  $('checkList').innerHTML = d.findings.map((f, fi) => `<details ${f.severity === 'error' ? 'open' : ''}>
    <summary><span class="sev ${f.severity}"></span>${esc(f.title)}<b>${f.items.length || ''}</b></summary>
    <p class="hint">${esc(f.help)}</p>
    <ul>${f.items.slice(0, 40).map((it, ii) => `<li data-f="${fi}" data-i="${ii}">${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</li>`).join('')}${f.items.length > 40 ? `<li class="hint" data-more="${fi}">… ${f.items.length - 40} more (see report)</li>` : ''}</ul></details>`).join('')
    || '<p class="hint">No problems found.</p>';
}
function showFinding(fi, ii) {
  const it = S.diag.findings[fi].items[ii]; if (!it) return;
  if (S.previewing) backToDiagram();
  S.pinned = null; S.hover = null; S.finding = it;
  refresh();
  const rects = [];
  for (const id of it.nodes) { const n = S.view.nodes.get(id); if (n) rects.push(n); }
  for (const eid of it.edges) { const e = S.view.edges.find(x => x.id === eid); if (e) for (const p of routeEdge(e, S.view.nodes)) rects.push({ x: p.x, y: p.y, w: 0, h: 0 }); }
  if (it.point) rects.push({ x: it.point.x - 30, y: it.point.y - 30, w: 60, h: 60 });
  fitRects(rects);
}

// ---------- service views & export ----------
async function buildView(id) {
  const v = computeView(id);
  let sub = subModel(S.view, v.nodes.keys(), v.edges, { keepGroups: S.opt.lanes, zones: S.opt.zones && S.zones.zones.size ? S.zones : null, frameMeta: S.opt.zoneMeta });
  sub.layers = S.view.layers;
  if (S.opt.tidy) { sub = await tidyModel(sub, ELK, { focus: id }); sub.layers = S.view.layers; }
  return sub;
}
const viewName = id => `${safeName(S.fileName)}__${safeName(labelOf(S.view.nodes.get(id)))}__${S.direction}-${S.infinite ? 'all' : S.depth}`;

let previewTimer = null, previewSeq = 0;
function schedulePreview(ms = 200) { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, ms); }
async function renderPreview() {
  const id = S.pinned, seq = ++previewSeq; if (!id) return;
  try {
    const sub = await buildView(id);
    if (seq !== previewSeq || !S.previewing) return;
    S.previewModel = sub;
    drawCanvas(sub, { heading: headingFor(id), focusId: S.opt.focus ? id : null }, true);
    updateChrome();
  } catch (err) { $('banner').hidden = false; $('banner').textContent = 'Preview failed: ' + err.message; }
}
function startPreview() { if (!S.pinned) return; S.previewing = true; syncOptInputs(); updateChrome(); renderPreview(); }
function backToDiagram() { S.previewing = false; previewSeq++; drawCanvas(S.view, {}, true); updateChrome(); }
const togglePreview = () => (S.previewing ? backToDiagram() : startPreview());

const fmts = () => ({ svg: $('fSvg').checked, png: $('fPng').checked, dio: $('fDio').checked, pdf: $('fPdf').checked, scale: +$('fScale').value, bg: $('fBg').value });

async function emit(sub, base, fmt, out, extra) {
  const badges = currentBadges();
  const svg = toSVG(sub, base, { heading: extra.heading, focusId: extra.focusId, background: fmt.bg, badges });
  if (fmt.svg) out.push([base + '.svg', svg, 'image/svg+xml']);
  if (fmt.png) out.push([base + '.png', await svgToImageBlob(svg, { scale: fmt.scale, background: fmt.bg }), 'image/png']);
  if (fmt.dio) out.push([base + '.drawio', toDrawio(sub, { name: base, heading: extra.heading, focusId: extra.focusId, badges }), 'application/xml']);
  if (fmt.pdf && extra.print) printSvg(svg, base);
}

async function exportCurrent() {
  const whole = document.querySelector('input[name=scope]:checked').value === 'whole';
  const msg = $('dlgMsg');
  if (!whole && !S.pinned) { msg.textContent = 'Pin a shape first (click it), or choose “Whole diagram”.'; return; }
  const fmt = fmts();
  if (!fmt.svg && !fmt.png && !fmt.dio && !fmt.pdf) { msg.textContent = 'Choose at least one format.'; return; }
  msg.textContent = 'Working…';
  try {
    const out = [];
    if (whole) await emit(S.view, `${safeName(S.fileName)}__${safeName(pageName())}`, fmt, out, { heading: wholeHeading(), focusId: null, print: true });
    else await emit(S.previewing && S.previewModel ? S.previewModel : await buildView(S.pinned), viewName(S.pinned), fmt, out, { heading: headingFor(S.pinned), focusId: S.opt.focus ? S.pinned : null, print: true });
    for (const [n, d, t] of out) download(n, d, t);
    msg.textContent = (out.length ? `Exported ${out.length} file(s)` : 'Nothing downloaded') + (fmt.pdf ? '; in the print dialog choose “Save as PDF”.' : '.');
  } catch (err) { msg.textContent = 'Export failed: ' + err.message; }
}

async function exportAll() {
  const q = $('search').value.trim().toLowerCase();
  const ids = [...S.view.nodes.values()].filter(n => !n.isGroup && !n.ctxBox && !n.style.text && S.graph.out.get(n.id).length + S.graph.inn.get(n.id).length > 0
    && (!q || (n.text + ' ' + Object.values(n.meta).join(' ')).toLowerCase().includes(q))).map(n => n.id);
  const msg = $('dlgMsg'), fmt = fmts();
  if (!ids.length) { msg.textContent = 'No connected shapes match.'; return; }
  fmt.pdf = false;
  const zip = new JSZip(), used = new Set();
  try {
    for (let i = 0; i < ids.length; i++) {
      msg.textContent = `Building ${i + 1} / ${ids.length}…`;
      await new Promise(r => setTimeout(r));
      const out = []; let base = viewName(ids[i]); while (used.has(base)) base += '_'; used.add(base);
      await emit(await buildView(ids[i]), base, fmt, out, { heading: headingFor(ids[i]), focusId: S.opt.focus ? ids[i] : null });
      for (const [n, d] of out) zip.file(n, d);
    }
    download(`${safeName(S.fileName)}__service-views.zip`, await zip.generateAsync({ type: 'blob' }));
    msg.textContent = `Zipped ${ids.length} service views.`;
  } catch (err) { msg.textContent = 'Batch failed: ' + err.message; }
}

function openExport() {
  $('scopeView').textContent = S.pinned ? `This service view: ${labelOf(S.view.nodes.get(S.pinned))}, ${DIR_TEXT[S.direction]}, ${S.infinite ? 'all' : S.depth} hop(s)` : 'This service view (pin a shape first)';
  document.querySelector('input[name=scope][value=view]').checked = !!S.pinned;
  document.querySelector('input[name=scope][value=whole]').checked = !S.pinned;
  syncScope(); $('dHeading').checked = S.opt.heading; $('dlgMsg').textContent = '';
  $('wTitle').value = S.opt.wholeTitle; $('wSubtitle').value = S.opt.wholeSubtitle;
  $('dlg').showModal();
}
function syncScope() { $('wholeHeading').hidden = document.querySelector('input[name=scope]:checked').value !== 'whole'; }

// ---------- view options ----------
function syncOptInputs() {
  const o = S.opt;
  $('oHeading').checked = o.heading; $('oTitle').value = o.title; $('oSubtitle').value = o.subtitle;
  $('oTidy').checked = o.tidy; $('oLanes').checked = o.lanes; $('oZones').checked = o.zones; $('oZoneMeta').checked = o.zoneMeta; $('oFocus').checked = o.focus;
  $('oTitle').disabled = $('oSubtitle').disabled = !o.heading;
}
function readOptInputs() {
  const o = S.opt;
  o.heading = $('oHeading').checked; o.title = $('oTitle').value; o.subtitle = $('oSubtitle').value;
  o.tidy = $('oTidy').checked; o.lanes = $('oLanes').checked; o.zones = $('oZones').checked; o.zoneMeta = $('oZoneMeta').checked; o.focus = $('oFocus').checked;
  $('oTitle').disabled = $('oSubtitle').disabled = !o.heading;
  if (S.previewing) schedulePreview();
}

// ---------- wiring ----------
function setDir(v) { S.direction = v; [...$('dir').children].forEach(b => b.classList.toggle('on', b.dataset.v === v)); if (S.view) { if (S.previewing) schedulePreview(0); refresh(); } }
function setDepth(d) { S.depth = Math.min(8, d); S.infinite = false; $('inf').checked = false; $('depth').value = S.depth; $('depthOut').textContent = S.depth; if (S.view) { if (S.previewing) schedulePreview(0); refresh(); } }

function init() {
  setupCanvasEvents();
  let mode = 'auto', inv = true;
  try { mode = localStorage.getItem('lv-theme') || 'auto'; inv = localStorage.getItem('lv-invert') !== '0'; } catch (e) { /* storage unavailable */ }
  applyTheme(mode); applyInvert(inv);
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.theme === 'auto') applyTheme('auto'); });
  $('theme').onchange = e => applyTheme(e.target.value);
  $('invert').onchange = e => applyInvert(e.target.checked);

  $('licBtn').onclick = () => { $('licText').textContent = $('licences').textContent; $('licDlg').showModal(); };
  $('open').onclick = () => $('file').click();
  $('file').onchange = async e => { const f = e.target.files[0]; if (f) loadText(await f.text(), f.name); e.target.value = ''; };
  $('sample').onclick = () => loadText(SAMPLE_XML, 'sample');
  $('fit').onclick = () => fit();
  $('search').oninput = () => S.view && renderList();
  $('countsAll').onchange = e => { S.countsAll = e.target.checked; if (S.view) redrawBadges(); };
  $('dir').onclick = e => { const b = e.target.closest('button'); if (b) setDir(b.dataset.v); };
  $('depth').oninput = e => setDepth(+e.target.value);
  $('inf').onchange = e => { S.infinite = e.target.checked; if (S.previewing) schedulePreview(0); refresh(); };
  $('tidy').onclick = () => {
    if (!S.view) return;
    S.tidied = !S.tidied;
    $('banner').hidden = false; $('banner').textContent = S.tidied ? 'Rerouting connectors…' : 'Restoring original connectors…';
    setTimeout(() => rebuildView(false), 30);
  };
  $('preview').onclick = togglePreview;
  $('vbTitle').onclick = () => { const c = $('viewbar').classList.toggle('collapsed'); $('vbTitle').textContent = c ? 'Service view ▸' : 'Service view ▾'; };
  $('export').onclick = openExport; $('vbExport').onclick = openExport; $('vbBack').onclick = backToDiagram;
  $('doExport').onclick = exportCurrent; $('doBatch').onclick = exportAll;
  document.querySelectorAll('input[name=scope]').forEach(r => r.onchange = syncScope);
  $('dHeading').onchange = e => { S.opt.heading = e.target.checked; };
  $('wTitle').oninput = e => { S.opt.wholeTitle = e.target.value; }; $('wSubtitle').oninput = e => { S.opt.wholeSubtitle = e.target.value; };
  ['oHeading', 'oTitle', 'oSubtitle', 'oTidy', 'oLanes', 'oZones', 'oZoneMeta', 'oFocus'].forEach(id => { $(id).oninput = $(id).onchange = readOptInputs; });
  syncOptInputs();

  document.querySelectorAll('.ltabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.ltabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + b.dataset.tab; });
  });
  $('metaKey').onchange = e => { S.metaKey = e.target.value; runChecks(); };
  $('chkRun').onclick = () => S.view && runChecks();
  const rep = () => ({ file: S.fileName, page: pageName() });
  $('chkMd').onclick = () => S.diag && download(`${safeName(S.fileName)}__checks.md`, findingsToMarkdown(S.diag, rep()), 'text/markdown');
  $('chkCsv').onclick = () => S.diag && download(`${safeName(S.fileName)}__checks.csv`, findingsToCsv(S.diag), 'text/csv');
  $('checkList').onclick = e => { const li = e.target.closest('li[data-f]'); if (li) showFinding(+li.dataset.f, +li.dataset.i); };

  window.addEventListener('resize', applyVB);
  window.addEventListener('keydown', e => {
    const t = document.activeElement, typing = t && ((/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !['range', 'checkbox', 'radio'].includes(t.type)));
    if (typing || $('dlg').open) return;
    if (e.key === 'Escape') { if (S.previewing) backToDiagram(); else pin(null); }
    else if (/^[1-9]$/.test(e.key)) setDepth(+e.key);
    else if (e.key === 'c' && S.pinned && !S.countsAll) toggleCounts(S.pinned);
    else if (e.key === 'u') setDir('up'); else if (e.key === 'd') setDir('down'); else if (e.key === 'b') setDir('both');
  });
  const st = $('stage');
  ['dragenter', 'dragover'].forEach(t => st.addEventListener(t, e => { e.preventDefault(); st.classList.add('dropping'); }));
  ['dragleave', 'drop'].forEach(t => st.addEventListener(t, e => { e.preventDefault(); st.classList.remove('dropping'); }));
  st.addEventListener('drop', async e => { const f = e.dataTransfer.files[0]; if (f) loadText(await f.text(), f.name); });
  if (!SAMPLE_XML) $('sample').hidden = true;
}
init();
