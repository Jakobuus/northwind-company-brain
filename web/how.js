/* "How it works" page: ingest + retrieve, driven only by what the API returns for the viewer.
 * Uses /api/people (demo switcher), /api/graph (no ghosts), /api/note, /api/ask. Same-origin only.
 * Access rule: everything shown here is already filtered for the viewer by the server; this page
 * never asks for locked/ghost nodes and never shows what was removed. */
(() => {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const VIEW = (/^\/v\/[^/]+/.exec(location.pathname) || [''])[0];   // platform: /v/<signed token>/
  const TOKEN = Q.get('token') || (VIEW ? 'view' : null);
  const STEP = Math.max(200, Number(Q.get('step')) || 1200);
  const $ = (s) => document.querySelector(s);
  const str = (v) => (v === null || v === undefined) ? '' : String(v);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style') e.style.cssText = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  }
  async function getJSON(path, params) {
    const qs = new URLSearchParams(params || {}).toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let res;
    try { res = await fetch(`${VIEW}${path}${qs ? '?' + qs : ''}`, { signal: ctl.signal, redirect: 'error', headers: { Accept: 'application/json' } }); }
    catch (e) { const err = new Error(e.name === 'AbortError' ? 'timed out' : 'server not reachable'); err.status = 0; throw err; }
    finally { clearTimeout(timer); }
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
    return res.json();
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso));
    return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : 'undated';
  }
  const clip = (t, n) => { t = str(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  // Supported importers (static: mirrors `python -m brain.intake.cli formats`, not company data).
  const FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'eml', 'mbox', 'transcript', 'vtt', 'srt', 'html', 'md', 'txt', 'json'];
  const ACCESS = {
    all: { label: 'Everyone', sub: 'whole company', c: 'var(--all)', ic: '●' },
    area: { label: 'Area', sub: 'one department', c: 'var(--area)', ic: '■' },
    restricted: { label: 'Restricted', sub: 'named people only', c: 'var(--restricted)', ic: '\u{1F512}' },
    private: { label: 'Private', sub: 'only the author', c: 'var(--private)', ic: '\u{1F464}' },
  };
  const STRUCTURE = new Set(['company', 'area', 'person']);

  const state = { people: [], person: null, nodes: new Map(), names: new Map(), areaColor: new Map(),
    company: '', graphSeq: 0, runSeq: 0, lastQ: '', packet: null, extra: null };

  const statusEl = $('#status');
  function setStatus(msg, isErr) {
    statusEl.hidden = !msg; statusEl.classList.toggle('err', !!isErr); statusEl.textContent = msg || '';
  }
  const ident = () => TOKEN ? { token: TOKEN } : { person: state.person };
  function viewerName() {
    const p = state.people.find((x) => x.id === state.person);
    return p ? str(p.name).split(' ')[0] : 'you';
  }
  const nameOf = (id) => state.names.get(str(id)) || str(id) || 'Unknown';

  // ---------- lane 1: ingest ----------
  function renderTypes() {
    $('#types').replaceChildren(...FORMATS.map((f) => h('span', { class: 'chip' }, f)));
    $('#types-foot').textContent = `${FORMATS.length} file types · anything else: best-effort text`;
  }
  async function loadGraph() {
    const seq = ++state.graphSeq;
    let g;
    try { g = await getJSON('/api/graph', ident()); }
    catch (e) { if (seq === state.graphSeq) setStatus(e.status === 404 ? 'This person or link is not known to the brain.' : `Could not load the brain: ${e.message}`, true); return false; }
    if (seq !== state.graphSeq) return false;
    setStatus('');
    const nodes = (g.nodes || []).filter((n) => n && !n.locked);   // never use locked/ghost nodes
    state.nodes = new Map(nodes.map((n) => [str(n.id), n]));
    state.names = new Map(nodes.filter((n) => n.type === 'person').map((n) => [str(n.id), str(n.title)]));
    state.areaColor = new Map((g.areas || []).map((a) => [str(a.id), str(a.color)]));
    const company = nodes.find((n) => n.type === 'company');
    state.company = company ? str(company.title) : 'Company';
    $('#co').textContent = state.company;
    document.title = `${state.company} Brain · How it works`;
    document.querySelectorAll('.vname').forEach((e) => { e.textContent = viewerName(); });

    const notes = nodes.filter((n) => !STRUCTURE.has(n.type));
    const count = (pred) => notes.filter(pred).length;
    $('#acc').replaceChildren(...Object.entries(ACCESS).map(([k, a]) =>
      h('div', { class: 'accrow', style: `--c:${a.c}` },
        h('span', { class: 'ic' }, a.ic),
        h('span', { class: 'l' }, a.label, h('small', null, a.sub)),
        h('span', { class: 'n' }, count((n) => n.access === k)))));
    const docs = count((n) => n.type === 'document'), meets = count((n) => n.type === 'meeting');
    $('#notes-foot').textContent = `${plural(notes.length, 'note')} ${viewerName()} can read · ${plural(docs, 'document')} · ${plural(meets, 'meeting')}`;
    const facts = notes.filter((n) => n.type === 'fact' || n.type === 'decision' || n.type === 'policy');
    const isDecision = (n) => ['decision', 'policy'].includes(n.type) || ['decision', 'policy'].includes(str(n.claim));
    $('#nfacts').textContent = facts.length;
    const nd = facts.filter(isDecision).length;
    $('#ndec').textContent = nd; $('#ndec').nextSibling.nodeValue = nd === 1 ? ' decision' : ' decisions';
    $('#nfacts').nextSibling.firstChild.nodeValue = facts.length === 1 ? 'fact · ' : 'facts · ';
    const sourced = new Map((g.edges || []).filter((e) => e.kind === 'from_source' && state.nodes.has(str(e.source)) && state.nodes.has(str(e.target)))
      .map((e) => [str(e.source), str(e.target)]));
    $('#facts-foot').textContent = `${sourced.size} linked to their source · every quote is checked`;
    renderQuote(facts.filter((n) => sourced.has(str(n.id))).sort((a, b) => isDecision(b) - isDecision(a))[0], sourced, seq);
    return true;
  }
  async function renderQuote(fact, sourced, seq) {
    const box = $('#quote');
    if (!fact) { box.replaceChildren(h('span', { class: 'dim' }, 'No extracted facts yet: they appear here with their quote.')); return; }
    let note;
    try { note = await getJSON('/api/note', { ...ident(), id: fact.id }); } catch { return; }
    if (seq !== state.graphSeq) return;
    const line = str(note.body).split('\n').map((l) => l.replace(/^[>\s"“]+|["”\s]+$/g, '')).find((l) => l.length > 8) || str(note.frontmatter && note.frontmatter.value);
    const src = state.nodes.get(sourced.get(str(fact.id)));
    box.replaceChildren(h('q', null, clip(line, 170)),
      h('span', { class: 'src' }, `↳ ${src ? clip(src.title, 60) : 'source'} · ${fact.author ? nameOf(fact.author) + ', ' : ''}${fmtDate(fact.date)}`));
  }
  async function playIngest() {
    const stages = [...document.querySelectorAll('#ingest .stage')], arrows = [...document.querySelectorAll('#ingest .arr')];
    stages.forEach((s) => s.classList.remove('on')); arrows.forEach((a) => a.classList.remove('on'));
    for (let i = 0; i < stages.length; i++) {
      if (i) arrows[i - 1].classList.add('on');
      stages[i].classList.add('on');
      await sleep(320);
    }
  }

  // ---------- lane 2: retrieve ----------
  const rStages = () => [...document.querySelectorAll('#retrieve .stage')];
  const rArrows = () => [...document.querySelectorAll('#retrieve .arr')];
  function resetRetrieve() {
    rStages().forEach((s) => s.classList.remove('on', 'live'));
    rArrows().forEach((a) => a.classList.remove('on'));
    ['#s-search', '#s-access', '#s-prec', '#s-ans'].forEach((s) => $(s).replaceChildren());
  }
  function stagger(container, els, gap = 110) {
    container.replaceChildren(...els);
    els.forEach((e, i) => setTimeout(() => e.classList.add('in'), 60 + i * gap));
  }
  function accessTag(id) {
    const n = state.nodes.get(str(id)), a = n && ACCESS[n.access];
    return a ? h('span', { class: 'tag', style: `--c:${a.c}` }, a.label) : null;
  }
  function renderSearch(p) {
    const hits = p.hits.slice(0, 5);
    if (!hits.length) { $('#s-search').replaceChildren(h('li', { class: 'empty' }, 'No readable note matches this question.')); return; }
    const max = Math.max(...hits.map((x) => Number(x.score) || 0), 1e-9);
    stagger($('#s-search'), hits.map((x) => h('li', { class: 'item', style: `--c:${state.areaColor.get(str(x.area)) || '#888'}` },
      h('div', { class: 't' }, x.title),
      h('div', { class: 'm' },
        h('span', { class: 'bar-s' }, h('i', { style: `width:${Math.round(100 * (Number(x.score) || 0) / max)}%` })),
        h('span', null, `${x.type} · ${str(x.via) === 'match' ? 'match' : 'linked to a match'} · ${fmtDate(x.date)}`)))));
  }
  function renderAccess(p) {
    const hits = p.hits.slice(0, 5);
    if (!hits.length) { $('#s-access').replaceChildren(h('li', { class: 'empty' }, 'Nothing to check.')); return; }
    stagger($('#s-access'), hits.map((x) => h('li', { class: 'item', style: `--c:var(--green)` },
      h('div', { class: 't' }, h('span', { class: 'ok' }, '✓'), x.title),
      h('div', { class: 'm' }, accessTag(x.id), h('span', null, `readable by ${viewerName()}`)))));
  }
  function renderPrec(p) {
    const res = p.resolutions.slice(0, 2);
    if (!res.length) { $('#s-prec').replaceChildren(h('div', { class: 'res in empty' }, 'No competing claims on this question: nothing to settle.')); return; }
    stagger($('#s-prec'), res.map((r) => {
      const w = r.winner || {};
      const kids = [h('div', { class: 'key' }, (r.key || []).join(' · ')),
        h('div', { class: 'win' }, h('div', { class: 'v' }, w.value || w.title),
          h('div', { class: 'by' }, `${w.author_name || 'Unknown'} · ${fmtDate(w.date)} · ${clip(w.title, 50)}`))];
      for (const s of (r.superseded || []).slice(0, 2)) {
        kids.push(h('div', { class: 'loser sup' }, h('span', { class: 'lab' }, 'replaced  '), h('s', null, s.value || s.title), ` · ${fmtDate(s.date)}`));
      }
      for (const c of (r.conflicts || []).slice(0, 2)) {
        const ch = state.extra.challengers.get(str(c.challenger));
        const node = state.nodes.get(str(c.challenger));
        if (!ch && !node) continue;
        kids.push(h('div', { class: 'loser con' }, h('span', { class: 'lab' }, 'conflict  '),
          (ch && ch.value) || (node && node.title), ` · ${fmtDate(node && node.date)} · does not override`));
      }
      kids.push(h('div', { class: 'why' }, r.reason));
      return h('div', { class: 'res' }, ...kids);
    }), 260);
  }
  function renderAnswer(p) {
    const cited = [], seen = new Set();
    for (const r of p.resolutions) if (r.winner && !seen.has(r.winner.id)) { seen.add(r.winner.id); cited.push(r.winner); }
    for (const x of p.hits) if (!seen.has(x.id)) { seen.add(x.id); cited.push(x); }
    const kids = [h('div', { class: 'summary' }, h('div', null, p.summary))];
    if (cited.length) kids.push(h('div', { class: 'sublbl' }, 'Cited notes'),
      h('ul', { class: 'cites' }, ...cited.slice(0, 4).map((c) => h('li', null, `${clip(c.title, 60)} · ${fmtDate(c.date)}`))));
    if (p.hints.length) kids.push(h('div', { class: 'sublbl' }, 'Out of reach? Ask the owner'),
      ...p.hints.slice(0, 2).map((t) => h('div', { class: 'hint' }, t)));
    const box = $('#s-ans'); box.replaceChildren(...kids);
  }
  async function play(seq) {
    const p = state.packet, stages = rStages(), arrows = rArrows();
    const steps = [renderSearch, renderAccess, renderPrec, renderAnswer];
    resetRetrieve();
    $('#replay').disabled = true;
    for (let i = 0; i < steps.length; i++) {
      if (seq !== state.runSeq) return;
      if (i) { arrows[i - 1].classList.add('on'); stages[i - 1].classList.remove('live'); }
      stages[i].classList.add('on', 'live');
      steps[i](p);
      await sleep(i === steps.length - 1 ? 300 : STEP);
    }
    if (seq !== state.runSeq) return;
    stages[stages.length - 1].classList.remove('live');
    $('#replay').disabled = false;
  }
  async function ask(q) {
    q = str(q).trim(); if (!q) return;
    const seq = ++state.runSeq;
    state.lastQ = q;
    resetRetrieve();
    $('#askbtn').disabled = true;
    try {
      const p = await getJSON('/api/ask', { ...ident(), q });
      // Conflict challengers are readable by construction (ask.py filters them); fetch their value
      // through the access-checked note endpoint. A 404 just means we show the title only.
      const ids = [...new Set(p.resolutions.flatMap((r) => (r.conflicts || []).map((c) => str(c.challenger))))].slice(0, 4);
      const challengers = new Map();
      await Promise.all(ids.map(async (id) => {
        try { const n = await getJSON('/api/note', { ...ident(), id }); challengers.set(id, { value: n.frontmatter && n.frontmatter.value }); } catch { /* unreadable: skip */ }
      }));
      if (seq !== state.runSeq) return;
      p.hits = Array.isArray(p.hits) ? p.hits : []; p.resolutions = Array.isArray(p.resolutions) ? p.resolutions : [];
      p.hints = Array.isArray(p.hints) ? p.hints : [];
      state.packet = p; state.extra = { challengers };
      setStatus('');
    } catch (e) {
      if (seq === state.runSeq) setStatus(`Ask failed: ${e.message}`, true);
      return;
    } finally { if (seq === state.runSeq) $('#askbtn').disabled = false; }
    play(seq);
  }

  // ---------- boot ----------
  $('#askform').addEventListener('submit', (e) => { e.preventDefault(); ask($('#q').value); });
  $('#replay').addEventListener('click', () => { if (state.packet) play(++state.runSeq); });
  const sel = $('#person');
  sel.addEventListener('change', async () => {
    state.person = sel.value;
    const u = new URL(location.href); u.searchParams.set('person', state.person); history.replaceState(null, '', u);
    $('#back').href = `./?person=${encodeURIComponent(state.person)}`;
    state.packet = null; ++state.runSeq; resetRetrieve(); $('#replay').disabled = true;
    if (await loadGraph()) { playIngest(); if (state.lastQ) ask(state.lastQ); }
  });

  async function boot() {
    renderTypes();
    if (TOKEN) {
      sel.hidden = true; document.querySelector('.who .lbl').hidden = true;
      $('#back').href = `./?token=${encodeURIComponent(TOKEN)}`;
    } else {
      try { state.people = await getJSON('/api/people'); }
      catch (e) { setStatus(e.status === 404 ? 'This server needs a personal link (?token=…).' : `Could not reach the brain server: ${e.message}`, true); return; }
      state.people = (Array.isArray(state.people) ? state.people : []).map((p) => ({ id: str(p.id), name: str(p.name) || str(p.id), title: str(p.title) }));
      if (!state.people.length) { setStatus('The brain has no people yet.', true); return; }
      const want = Q.get('person');
      state.person = state.people.some((p) => p.id === want) ? want : state.people[0].id;
      sel.replaceChildren(...state.people.map((p) => {
        const o = h('option', { value: p.id }, `${p.name}${p.title ? ' · ' + p.title : ''}`);
        if (p.id === state.person) o.selected = true;
        return o;
      }));
      $('#back').href = `./?person=${encodeURIComponent(state.person)}`;
    }
    if (!await loadGraph()) return;
    await playIngest();
    const q = Q.get('q'); if (q) { $('#q').value = q; ask(q); }
  }
  boot();
})();
