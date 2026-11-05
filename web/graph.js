/* Company Brain graph page: structured rings with cards (mockup v5), drawn on canvas.
 *
 * Data comes only from the brain server's HTTP API (docs/design.md, "HTTP API"):
 *   /api/people, /api/graph?person=&ghosts=1, /api/note?person=&id=, /api/ask?person=&q=
 * URL params: ?api=<base url> (default same origin), ?person=<id>, ?token=<link token>
 * (non-demo servers identify by token instead of person), ?q=<question> (asked on load).
 *
 * Layout: company core = grid of cards in the centre. Departments are slices around it, their
 * angle proportional to note count with a minimum. Rings outward = access level: everyone,
 * department, restricted, then the personal ring split per person. Each ring segment is packed
 * with upright cards on a row grid that follows the arc; when a segment is full, the overflow
 * collapses into a "+N more" card that expands the segment on click.
 */
'use strict';
(() => {
  // ---------- constants ----------
  const CW = 122, CH = 34, GX = 8, ROWH = 40;           // card size, gap, row pitch (world units)
  const RING_PAD = 13;                                   // inner padding of a ring band (labels live there)
  const CORE_CAP = 36;                                   // cards shown in the core before "+N more"
  const FW_TOTAL = { n: 1012 };   // real MBA Brain framework total; replaced by /api/frameworks/count when it answers
  const GHOST_CAP = 6; const FACT_CAP = 8, SEG_CAP = 14;                                  // padlock placeholders shown per locked segment
  const TMIN = { 1: 90, 2: 90, 3: 90, 4: 90 };       // ring band thickness bounds
  const TMAX = { 1: 170, 2: 170, 3: 170, 4: 130 };   // compact bands for a readable 1080p overview
  const TEMPTY = { 1: 64, 2: 64, 3: 64, 4: 84 };
  const PALETTE = ['#4fa3ff', '#ff9f43', '#4fd1a5', '#ffd166', '#a882ff', '#ff6b9d', '#5fd4e8', '#c3e66e', '#f78fb3', '#9fa8ff', '#e8a35f', '#7ee0c3'];
  const CORE_COLOR = '#e0e0e0';
  const RING_NAMES = { 1: 'department core · everyone', 2: 'department internal · team only', 4: 'private · owner only' };
  const RINGS = [1, 2, 4];
  const LAYER_LABEL = { core: 'Company core', 'dept-core': 'Department core', dept: 'Department internal', private: 'Private' };
  const LAYER_RING = { core: 0, 'dept-core': 1, dept: 2, private: 4 };
  const TAU = Math.PI * 2;

  // ---------- url / api ----------
  const Q = new URLSearchParams(location.search);
  // Platform: under /v/<signed token>/ the server fixes the viewer and API calls stay under that prefix.
  const VIEW = (/^\/v\/[^/]+/.exec(location.pathname) || [''])[0];
  const TOKEN = Q.get('token') || (VIEW ? 'view' : null);
  const apiParam = Q.get('api') || '';
  let API = VIEW, apiError = '';
  if (apiParam) {
    try {
      const url = new URL(apiParam, location.href);
      const allowed = Array.isArray(window.BRAIN_ALLOWED_APIS) ? window.BRAIN_ALLOWED_APIS : [];
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
          (url.origin !== location.origin && !allowed.includes(url.origin))) {
        throw new Error('API origin is not allowed');
      }
      API = url.href.replace(/\/+$/, '');
    } catch { apiError = 'The API URL is invalid or its origin is not allowed for this page.'; }
  }

  const $ = (s) => document.querySelector(s);
  const canvas = $('#c'), ctx = canvas.getContext('2d');

  function ident() { return VIEW ? {} : TOKEN ? { token: TOKEN } : { person: state.person }; }
  async function getJSON(path, params, ms) {
    const qs = new URLSearchParams(params || {}).toString();
    const url = `${API}${path}${qs ? '?' + qs : ''}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 20000);
    let res;
    try { res = await fetch(url, { signal: ctl.signal, redirect: 'error', headers: { Accept: 'application/json' } }); }
    catch (e) { const err = new Error(e.name === 'AbortError' ? 'timed out' : 'server not reachable'); err.status = 0; throw err; }
    finally { clearTimeout(timer); }
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
    try { return await res.json(); } catch { const err = new Error('bad JSON'); err.status = res.status; throw err; }
  }

  // ---------- state ----------
  const state = {
    people: [], peopleById: new Map(), person: null,
    G: null, nameById: new Map(),   // normalised graph; names from the export (token links have no people list)
    cam: { s: 1, x: 0, y: 0 }, W: 0, H: 0, dpr: 1,
    hover: null, selected: null, cited: new Set(), pulses: [], trails: [], winners: new Set(), askT0: 0,
    fw: null, fwLit: new Map(), fwT0: 0, toasts: [],
    expanded: new Set(), lastQ: '', graphSeq: 0, askSeq: 0, noteSeq: 0,
    preview: null, view: 'brain', cloudOK: false, cloudLit: new Set(), mcam: { s: 1, x: 0, y: 0 },
  };

  // ---------- small helpers ----------
  const str = (v) => (v === null || v === undefined) ? '' : String(v);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso));
    if (!m) return str(iso);
    return `${+m[3]} ${MONTHS[+m[2] - 1] || m[2]} ${m[1].slice(2)}`;
  }
  function viewerName() { const me = state.G && state.G.personals.find((p) => p.mine); return (me && me.name) || personName(state.person) || ''; }
  function personName(id) { const p = state.peopleById.get(id); return p ? p.name : (state.nameById.get(str(id)) || str(id)); }
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'onclick') e.addEventListener('click', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  }
  function cardLink(id, label) {
    const c = state.G && state.G.byId.get(str(id));
    if (!c) return h('span', null, label || str(id));
    return h('a', { class: 'lk', onclick: (ev) => { ev.preventDefault(); focusCard(c, true); } }, label || c.title);
  }

  // ---------- normalise the export ----------
  function normalise(g) {
    const nodes = Array.isArray(g && g.nodes) ? g.nodes : [];
    const edgesIn = Array.isArray(g && g.edges) ? g.edges : [];
    const areas = (Array.isArray(g && g.areas) ? g.areas : []).filter((a) => a && a.id !== undefined && a.id !== null)
      .map((a) => ({ ...a, id: str(a.id) }));
    const areaById = new Map(areas.map((a) => [a.id, a]));
    for (const a of areas) if (a.owner && a.owner_name) state.nameById.set(str(a.owner), str(a.owner_name));
    for (const a of areas) {
      if (!a.kind) a.kind = a.id === 'core' ? 'core' : (a.person ? 'personal' : 'department');
      a.isOpen = a.open !== false;
    }
    const depts = [], deptById = new Map();
    let pi = 0;
    function addDept(a) {
      const leads = Array.isArray(a.leads) && a.leads.length ? a.leads.map(str) : (a.owner ? [str(a.owner)] : []);
      const d = { id: a.id, name: str(a.name) || a.id, owner: a.owner, leads, leadNames: leads.map((x) => personName(x)).filter(Boolean),
        ownerName: a.owner_name || (a.owner ? personName(a.owner) : ''),
        color: a.color || PALETTE[pi++ % PALETTE.length], open: a.open !== false, personals: [], synthetic: !!a.synthetic, count: 0 };
      depts.push(d); deptById.set(d.id, d); return d;
    }
    for (const a of areas) if (a.kind === 'department') addDept(a);
    const coreArea = areas.find((a) => a.kind === 'core');
    const coreIds = new Set(['core']); if (coreArea) coreIds.add(coreArea.id);

    // personal areas -> segments inside their home slice
    const personals = [];
    for (const a of areas) {
      if (a.kind !== 'personal') continue;
      let home = deptById.get(str(a.home));
      if (!home) home = deptById.get('__nodept') || addDept({ id: '__nodept', name: 'No department', open: true, color: '#8b8d91', synthetic: true });
      const mine = TOKEN ? a.open === true : (a.person ? str(a.person) === state.person : a.open === true);
      const seg = { area: a, id: a.id, person: str(a.person), name: TOKEN ? (str(a.owner_name) || str(a.name) || a.id) : (personName(a.person) || str(a.name) || a.id), mine, dept: home, cards: [] };
      home.personals.push(seg); personals.push(seg);
      if (seg.person && seg.name && !state.nameById.has(seg.person)) state.nameById.set(seg.person, seg.name);
    }
    const segById = new Map(personals.map((s) => [s.id, s]));
    const segByPerson = new Map(personals.map((s) => [s.person, s]));

    // sectors
    const sectors = new Map();
    function sector(key, ring, dept, seg) {
      let s = sectors.get(key);
      if (!s) { s = { key, ring, dept, seg, cards: [] }; sectors.set(key, s); }
      return s;
    }
    sector('core', 0, null, null);

    let company = '';
    const cards = [], byId = new Map();
    let lockedCount = 0;
    for (const n of nodes) {
      if (!n || n.id === undefined || n.id === null) continue;
      const id = str(n.id), type = str(n.type);
      if (type === 'company') { company = str(n.title) || company; continue; }
      if (type === 'area' && areaById.has(id)) continue;                         // area hub = the slice itself
      if (type === 'person' && !n.date && (!n.area || coreIds.has(str(n.area))) && !n.locked) continue; // policy person node
      // Hidden notes never reach the page: no placeholders, titles or counts (access model v2).
      if (n.locked) continue;
      const locked = false;
      const areaId = str(n.area);
      const area = areaById.get(areaId);
      const access = n.access ? str(n.access) : '';
      // layer: from the export when present, else derived from area + access
      let layer = str(n.layer);
      if (!LAYER_LABEL[layer]) {
        if ((area && area.kind === 'personal') || access === 'private' || areaId.startsWith('personal-')) layer = 'private';
        else if (!areaId || coreIds.has(areaId)) layer = 'core';
        else if (access === 'all') layer = 'dept-core';
        else layer = 'dept';
      }
      let sec = null, dept = null, seg = null;
      if (layer === 'private') {
        seg = (area && area.kind === 'personal') ? segById.get(areaId) : segByPerson.get(str(n.author));
        if (seg) { sec = sector('p:' + seg.id, 4, seg.dept, seg); dept = seg.dept; }
        else layer = 'dept';
      }
      if (!sec) {
        if (layer !== 'core') {
          const did = str(n.dept) || areaId;
          dept = deptById.get(did) || (did && !coreIds.has(did) ? addDept({ id: did, name: did, open: true, synthetic: true }) : null);
        }
        if (!dept) { layer = 'core'; sec = sector('core', 0, null, null); }
        else { const ring = LAYER_RING[layer]; sec = sector(dept.id + ':' + ring, ring, dept, null); }
      }
      const claim = str(n.claim);
      const c = {
        id, n, kind: locked ? 'ghost' : 'note', sec, dept: sec.dept, color: sec.dept ? sec.dept.color : CORE_COLOR,
        title: locked ? 'Restricted' : (str(n.title) || id), type,
        decision: !locked && (type === 'decision' || claim === 'decision'),
        remark: !locked && claim === 'remark',
        superseded: !locked && n.status === 'superseded',
        contested: !locked && n.status === 'contested',
        priv: sec.ring === 4, date: str(n.date), conflict: false, x: undefined, y: undefined, host: null,
        layer, moved: Array.isArray(n.moved) ? n.moved : [], canMove: Array.isArray(n.can_move) ? n.can_move.map(str) : null,
        originDept: str(n.dept || n.origin_dept), isDoc: type === 'document',
      };
      let meta = claim || type || 'note';
      if (type === 'document') meta = 'doc';
      if (c.decision) meta = 'decision' + (n.weight === 'high' ? ' · high' : '');
      if (c.date) meta += ' · ' + fmtDate(c.date);
      if (c.superseded) meta += ' · replaced';
      if (c.priv) meta = 'private' + (c.date ? ' · ' + fmtDate(c.date) : ' · only you');
      c.restricted = !!n.restricted || access === 'restricted';
      if (c.restricted && !c.priv) meta = 'department leads only · ' + meta;
      c.meta = meta;
      if (locked) lockedCount++;
      if (byId.has(id)) continue;
      cards.push(c); byId.set(id, c); sec.cards.push(c);
      if (sec.dept) sec.dept.count++;
    }

    // edges between cards (structural kinds are implied by the layout itself)
    const edges = [], seen = new Set();
    for (const e of edgesIn) {
      if (!e) continue;
      const kind = str(e.kind);
      if (kind === 'in_area' || kind === 'authored') continue;
      const a = byId.get(str(e.source)), b = byId.get(str(e.target));
      if (!a || !b || a === b) continue;
      const k = kind + '|' + a.id + '|' + b.id;
      if (seen.has(k)) continue; seen.add(k);
      edges.push({ a, b, kind });
      if (kind === 'conflicts') { a.conflict = true; b.conflict = true; }
      if (kind === 'from_source') { a.src = b; b.nFacts = (b.nFacts || 0) + 1; }
    }
    const adj = new Map();
    for (const e of edges) {
      if (!adj.has(e.a)) adj.set(e.a, []); if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a).push(e); adj.get(e.b).push(e);
    }

    // priority inside a segment: conflicts, decisions, weight, then newest
    const recent = (c) => { const m = c.moved.length ? c.moved[c.moved.length - 1] : null; const t = m && Date.parse(m.at); return t && Date.now() - t < 30 * 60000 ? 20 : 0; };
    const prio = (c) => (state.flowId && c.id === state.flowId ? 50 : 0) + recent(c) + (c.kind === 'ghost' ? -10 : 0) + (c.conflict || c.contested ? 8 : 0) + (c.decision ? 4 : 0)
      + (c.isDoc ? 3 : 0) + (c.n.weight === 'high' ? 2 : 0) - (c.superseded ? 1 : 0);
    for (const s of sectors.values()) {
      s.cards.sort((x, y) => prio(y) - prio(x) || (y.date > x.date ? 1 : y.date < x.date ? -1 : 0) || (x.title < y.title ? -1 : 1));
    }
    return { company, areas, depts, personals, sectors, cards, byId, edges, adj, lockedCount };
  }

  // ---------- geometry ----------
  // Slots for upright cards inside the annular sector rIn..rOut, a0..a1 (a1 > a0, span <= 2pi).
  // Rows lie on a global row grid; within a row cards are packed left to right; slots are then
  // ordered inner-to-outer, then along the arc. Disjoint sectors give non-overlapping slots.
  function sectorSlots(rIn, rOut, a0, a1) {
    const out = [];
    if (rOut - rIn < CH || a1 <= a0) return out;
    const span = a1 - a0, big = span > Math.PI, hw = CW / 2, hh = CH / 2;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let i = 0; i <= 64; i++) {
      const a = a0 + span * i / 64, ca = Math.cos(a), sa = Math.sin(a);
      for (const r of [rIn, rOut]) { const x = ca * r, y = sa * r; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    }
    const inWedge = (x, y) => {
      const r = Math.hypot(x, y); if (r < 1e-6) return false;
      let rel = Math.atan2(y, x) - a0; rel = ((rel % TAU) + TAU) % TAU;
      const g = 6 / r;
      return rel >= g && rel <= span - g;
    };
    const fits = (x, y) => {
      if (!(inWedge(x - hw, y - hh) && inWedge(x + hw, y - hh) && inWedge(x - hw, y + hh) && inWedge(x + hw, y + hh))) return false;
      if (big && !(inWedge(x, y - hh) && inWedge(x, y + hh) && inWedge(x - hw, y) && inWedge(x + hw, y))) return false;
      return true;
    };
    for (let k = Math.ceil((by0 + hh) / ROWH); k * ROWH <= by1 - hh; k++) {
      const y = k * ROWH, far = Math.abs(y) + hh;
      if (far > rOut) continue;
      const xo = Math.sqrt(rOut * rOut - far * far) - hw;                  // outer corners inside rOut
      const near = Math.max(0, Math.abs(y) - hh);
      const ivs = [];
      if (near < rIn) { const xi = Math.sqrt(rIn * rIn - near * near) + hw; if (xo >= xi) { ivs.push([-xo, -xi], [xi, xo]); } }
      else ivs.push([-xo, xo]);
      for (const [l0, l1] of ivs) {
        const x0 = Math.max(l0, bx0 + hw), x1 = Math.min(l1, bx1 - hw);
        for (let x = x0; x <= x1;) { if (fits(x, y)) { out.push({ x, y }); x += CW + GX; } else x += 4; }
      }
    }
    for (const p of out) {
      const r = Math.hypot(p.x, p.y);
      let rel = Math.atan2(p.y, p.x) - a0; rel = ((rel % TAU) + TAU) % TAU;
      p.band = Math.floor((r - rIn) / ROWH); p.rel = rel;
    }
    out.sort((p, q) => p.band - q.band || p.rel - q.rel);
    return out;
  }

  // Split `total` angle among weights with a per-item minimum (water filling).
  function shareAngles(weights, total, minA) {
    const n = weights.length; if (!n) return [];
    if (minA * n >= total) return weights.map(() => total / n);
    const out = new Array(n).fill(0), fixed = new Array(n).fill(false);
    for (let iter = 0; iter < n + 1; iter++) {
      let rest = total, wsum = 0;
      for (let i = 0; i < n; i++) if (fixed[i]) rest -= minA; else wsum += weights[i];
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (fixed[i]) { out[i] = minA; continue; }
        out[i] = wsum > 0 ? rest * weights[i] / wsum : rest / n;
        if (out[i] < minA) { fixed[i] = true; changed = true; }
      }
      if (!changed) break;
    }
    return out;
  }

  // ---------- layout ----------
  function layout() {
    const G = state.G;
    for (const c of G.cards) { c.x = c.y = undefined; c.host = null; }
    // preview: cells the previewed person can't read keep none of the viewer's cards (decoration only)
    for (const sec of G.sectors.values()) { if (!sec.all) sec.all = sec.cards; sec.cards = sec.all.filter(cardVisible); }
    G.extra = [];                 // "+N more" / "show fewer" pseudo cards
    // core grid
    const core = G.sectors.get('core');
    const coreExp = state.expanded.has('core');
    let shown = core.cards, more = 0;
    if (!coreExp && core.cards.length > CORE_CAP) { shown = core.cards.slice(0, CORE_CAP - 1); more = core.cards.length - shown.length; }
    const items = shown.slice();
    if (more) items.push(mkExtra('more', core, more, core.cards.slice(shown.length)));
    else if (coreExp && core.cards.length > CORE_CAP) items.push(mkExtra('less', core, 0, []));
    const nI = items.length;
    // pick the column count that gives the smallest enclosing circle
    let cols = 1, best = Infinity;
    for (let k = 1; k <= Math.max(1, nI); k++) {
      const rr = Math.ceil(nI / k), rad = Math.hypot((k * (CW + GX) - GX) / 2, (rr * ROWH - (ROWH - CH)) / 2 + 12);
      if (rad < best - 0.5) { best = rad; cols = k; }
    }
    const rows = Math.ceil(nI / cols);
    const gw = cols * (CW + GX) - GX, gh = rows * ROWH - (ROWH - CH);
    const top = -gh / 2 + 12;
    items.forEach((c, i) => {
      const r = Math.floor(i / cols), inRow = Math.min(cols, nI - r * cols), col = i % cols;
      c.x = -((inRow * (CW + GX) - GX) / 2) + col * (CW + GX) + CW / 2; c.y = top + r * ROWH + CH / 2;
    });
    for (const c of core.cards.slice(shown.length)) c.host = items[items.length - 1];
    const Rc = nI ? Math.max(84, Math.hypot(gw / 2, gh / 2 + 12) + 14) : 84;
    G.Rc = Rc;

    // slice angles
    const D = G.depts, nd = D.length;
    G.rings = {};
    if (!nd) { G.Rring = Rc; G.Rav = Rc + 22; layoutHalo(G); G.Rmax = G.Rhalo ? G.Rhalo[1] + 10 : Rc; return; }
    const r1 = Math.max(Rc + 14, nd * (CW + 36) / (TAU * 0.8));
    const minA = Math.min(TAU / nd, Math.max(0.16, (CW + 36) / r1));
    const totalCards = D.reduce((s, d) => s + d.count, 0);
    const floor = Math.max(2, totalCards * 0.04);
    // department angles always come from the viewer's own weights, so switching preview never resizes a
    // department or reshuffles its cards; only the person slots inside the previewed person's department move
    const weights = D.map((d) => Math.max(1, d.personals.reduce((n, p) => n + (p.mine ? 3.5 : 1), 0)));
    const angs = shareAngles(weights, TAU, minA);
    let a = -Math.PI / 2 - angs[0] / 2;
    D.forEach((d, i) => {
      d.a0 = a + 0.012; d.a1 = a + angs[i] - 0.012; a += angs[i];
      // personal segments: own segment gets a bigger share when it holds notes
      const P = d.personals.length;
      if (P) {
        const w = d.personals.map(slotW);
        const sa = shareAngles(w, d.a1 - d.a0, 0);
        let b = d.a0;
        d.personals.forEach((s, j) => { s.a0 = b + 0.006; s.a1 = b + sa[j] - 0.006; b += sa[j]; });
      }
    });

    // rings 1..4, each band grows (row by row) until its segments fit or it hits its maximum
    let r = r1;
    for (const ring of RINGS) {
      const secs = [];
      // ring sizes come from the viewer's full layout so previews never make the rings jump
      if (ring < 4) for (const d of D) { const s = G.sectors.get(d.id + ':' + ring); if (s && (s.all || s.cards).length) secs.push([s, d.a0, d.a1]); }
      else for (const p of G.personals) { const s = G.sectors.get('p:' + p.id); if (s && (s.all || s.cards).length) secs.push([s, p.a0, p.a1]); }
      // bigger brains get somewhat thicker rings before overflow collapses into "+N more"
      const tmax = TMAX[ring];
      let T = secs.length ? TMIN[ring] : TEMPTY[ring];
      let slotsBy = new Map();
      if (secs.length) {
        for (let guard = 0; guard < 600; guard++) {
          slotsBy = new Map();
          let grow = false;
          for (const [s, a0, a1] of secs) {
            const sl = sectorSlots(r + RING_PAD, r + T - 3, a0, a1);
            slotsBy.set(s, sl);
            const exp = state.expanded.has(s.key);
            const nAll = (s.all || s.cards).length, need = exp ? nAll + 1 : Math.min(nAll, segCap(s));
            if (sl.length < need && (exp || T < tmax)) grow = true;
          }
          if (!grow) break;
          T += T < tmax ? 10 : ROWH;
        }
      }
      G.rings[ring] = [r, r + T];
      for (const [s] of secs) placeSector(s, slotsBy.get(s) || []);
      r += T;
    }
    G.Rring = r;                 // outer edge of the private ring
    G.inner = innerLinks(G);
    G.Rav = r + 26;              // people avatars
    layoutHalo(G);
    G.Rmax = G.Rhalo ? G.Rhalo[1] + 10 : r + 60;
    G.Rbrain = G.Rav + 24; G.Rcloud = G.Rbrain * 1.9;
    if (state.cloudOK) G.Rmax = G.Rbrain * 1.16;   // the brain fills the screen; the cloud spills past the edges
  }

  // faint ties from outer notes (dept internal, private) to inner notes (dept core, company core).
  // Only cards drawn right now (placed, readable in this view); prefers notes linked by an edge, then same dept.
  function innerLinks(G) {
    const shown = (c) => c && c.kind === 'note' && c.x !== undefined && !c.host;
    const inner = G.cards.filter((c) => shown(c) && (c.sec.ring === 0 || c.sec.ring === 1));
    const out = [];
    for (const c of G.cards) {
      if (!shown(c) || !(c.sec.ring === 2 || c.sec.ring === 4)) continue;
      const picks = [];
      for (const e of G.adj.get(c) || []) {
        const o = e.a === c ? e.b : e.a;
        if (picks.length < 2 && inner.includes(o) && !picks.includes(o)) picks.push(o);
      }
      if (picks.length < 2 && c.dept) {
        const same = inner.filter((o) => o.dept === c.dept && !picks.includes(o));
        const pool = same.length ? same : inner.filter((o) => o.sec.ring === 0 && !picks.includes(o));
        pool.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
        for (const o of pool) { if (picks.length >= 2) break; picks.push(o); }
      }
      for (const o of picks) out.push({ a: c, b: o, color: c.dept ? c.dept.color : CORE_COLOR });
    }
    return out;
  }

  // ---------- MBA Brain halo: frameworks grouped by discipline, outside the company ----------
  const FW_PLACEHOLDER = { disciplines: [
    { name: 'Strategy', frameworks: ['Porter\'s Five Forces', 'SWOT', 'Blue Ocean', 'Ansoff Matrix', 'Value Chain', 'BCG Matrix', 'PESTEL', 'Jobs to be Done'] },
    { name: 'Marketing', frameworks: ['4Ps', 'STP', 'Customer Lifetime Value', 'AIDA', 'Brand Positioning', 'Pricing Ladder', 'Net Promoter Score'] },
    { name: 'Finance', frameworks: ['DCF', 'Unit Economics', 'Break-even Analysis', 'Working Capital Cycle', 'WACC', 'Contribution Margin'] },
    { name: 'Operations', frameworks: ['Lean', 'Theory of Constraints', 'Six Sigma', 'Little\'s Law', 'Kanban', 'Supplier Risk Matrix'] },
    { name: 'Leadership', frameworks: ['Situational Leadership', 'RACI', 'OKRs', 'Radical Candor', 'Tuckman Stages', 'Decision Rights'] },
    { name: 'Negotiation', frameworks: ['BATNA', 'ZOPA', 'Interest-based Bargaining', 'Anchoring', 'Logrolling'] },
    { name: 'Sales', frameworks: ['BANT', 'MEDDIC', 'SPIN Selling', 'Challenger Sale', 'Sales Funnel', 'Land and Expand'] },
    { name: 'People', frameworks: ['9-Box Grid', 'Hiring Scorecard', 'Compensation Bands', 'Psychological Safety', 'Onboarding 30-60-90'] },
  ].map((d) => ({ name: d.name, frameworks: d.frameworks.map((t) => ({ title: t, path: '' })) })) };
  const normT = (t) => str(t).toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function hash(t) { let x = 2166136261; for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; }
  function layoutHalo(G) {
    const src = state.fw || FW_PLACEHOLDER;
    const groups = (Array.isArray(src.disciplines) ? src.disciplines : []).filter((d) => d && Array.isArray(d.frameworks) && d.frameworks.length);
    const total = groups.reduce((n, d) => n + d.frameworks.length, 0);
    if (!total) { G.halo = null; G.Rhalo = null; return; }
    const r0 = G.Rav + 92, depth = Math.min(150, 46 + Math.sqrt(total) * 3.2);
    G.Rhalo = [r0, r0 + depth];
    const gap = 0.05, avail = TAU - gap * groups.length;
    let a = -Math.PI / 2 + gap / 2;
    const dots = [], discs = [];
    for (const d of groups) {
      const span = avail * d.frameworks.length / total;
      discs.push({ name: str(d.name), a0: a, a1: a + span, n: d.frameworks.length });
      d.frameworks.forEach((f, i) => {
        const title = str(f && f.title) || str(f && f.path);
        const u = (i + 0.5) / d.frameworks.length, j = hash(title + i);
        const ang = a + span * u, rad = r0 + depth * (0.08 + 0.84 * ((j * 7.31) % 1));
        dots.push({ title, key: normT(title), disc: str(d.name), x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, tw: j });
      });
      a += span + gap;
    }
    G.halo = { dots, discs, byKey: new Map(dots.map((d) => [d.key, d])) };
  }

  function mkExtra(kind, sec, count, hidden) {
    const e = { id: '__' + kind + ':' + sec.key, kind, sec, dept: sec.dept, color: sec.dept ? sec.dept.color : CORE_COLOR,
      count, hidden, title: kind === 'more' ? `+${count} ${hidden.every((c) => c.kind === 'ghost') ? 'locked' : 'more'}` : 'show fewer', meta: '', x: 0, y: 0 };
    state.G.extra.push(e);
    return e;
  }

  // locked placeholders sort last; a segment shows at most a few of them, then "+N"
  function segCap(s) {
    if (state.expanded.has(s.key)) return Infinity;
    const ghosts = s.cards.reduce((n, c) => n + (c.kind === 'ghost'), 0);
    // extracted facts: show the important ones, fold the rest into "+N more" so rings stay compact
    const plain = s.cards.reduce((n, c) => n + (c.src && !c.decision && !c.conflict && !c.contested ? 1 : 0), 0);
    const cap = plain > FACT_CAP ? s.cards.length - plain + FACT_CAP : Infinity;
    return Math.min(cap, SEG_CAP, ghosts > GHOST_CAP ? s.cards.length - ghosts + GHOST_CAP : Infinity);
  }
  // n of the slots, spread evenly over the cell (farthest-point picks, deterministic), in band/arc order
  function spreadSlots(slots, n) {
    if (n <= 0) return [];
    if (n >= slots.length) return slots.slice(0, n);
    const d = slots.map(() => Infinity), used = new Array(slots.length).fill(false), out = [];
    let cur = Math.floor((slots.length - 1) / (2 * n));
    for (let k = 0; k < n; k++) {
      used[cur] = true; out.push(cur);
      const p = slots[cur]; let bi = -1, bd = -1;
      for (let i = 0; i < slots.length; i++) {
        if (used[i]) continue;
        const q = slots[i], dd = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
        if (dd < d[i]) d[i] = dd;
        if (d[i] > bd) { bd = d[i]; bi = i; }
      }
      if (bi < 0) break; cur = bi;
    }
    out.sort((a, b) => a - b);
    return out.map((i) => slots[i]);
  }
  function placeSector(s, slots) {
    const list = s.cards, exp = state.expanded.has(s.key);
    if (list.length > segCap(s)) slots = spreadSlots(slots, segCap(s));   // capped: spread the shown cards + chip over the cell
    if (!slots.length) { s.more = null; return; }      // no room at all: cards stay hidden
    if (!exp && list.length < slots.length) {        // room to spare: spread the cards over the whole cell
      const pick = spreadSlots(slots, list.length);
      const order = list.slice().sort((a, b) => hash(a.id) - hash(b.id));   // stable seat per note id
      order.forEach((c, i) => { c.x = pick[i].x; c.y = pick[i].y; });
      return;
    }
    if (list.length <= slots.length - (exp ? 1 : 0)) {
      list.forEach((c, i) => { c.x = slots[i].x; c.y = slots[i].y; });
      if (exp) { const e = mkExtra('less', s, 0, []); e.x = slots[list.length].x; e.y = slots[list.length].y; }
      return;
    }
    const k = slots.length - 1;
    for (let i = 0; i < k; i++) { list[i].x = slots[i].x; list[i].y = slots[i].y; }
    const hidden = list.slice(k);
    const e = mkExtra('more', s, hidden.length, hidden); e.x = slots[k].x; e.y = slots[k].y;
    for (const c of hidden) c.host = e;
  }

  // ---------- camera ----------
  const toScreen = (x, y) => [x * state.cam.s + state.cam.x, y * state.cam.s + state.cam.y];
  const toWorld = (sx, sy) => [(sx - state.cam.x) / state.cam.s, (sy - state.cam.y) / state.cam.s];
  const TOP_M = 128, BOT_M = 56;            // header and legend bands (screen px)
  function fitScale() {
    if (state.cloudOK && state.G && state.G.Rbrain) {   // the brain dominates; the cloud is a band around it
      const lg = document.querySelector('.legend'), legH = lg ? Math.max(0, lg.offsetHeight - 22) : 40;
      const ad = document.querySelector('.askdock'), adTop = ad && ad.offsetParent ? ad.offsetTop : state.H - legH;
      const bottom = Math.min(state.H - legH, adTop);
      const room = bottom - (state.H / 2 + (TOP_M - BOT_M) / 2) - 16 - 60;   // below the disc: department labels, then the ask bar / legend
      return Math.min(0.42 * Math.min(state.W, state.H - 100), room) / state.G.Rbrain;
    }
    const R = (state.G ? state.G.Rmax : 400) + 64; return Math.min(state.W - 40, state.H - TOP_M - BOT_M) / (2 * R);
  }
  function fitView(animate) {
    const s = fitScale();
    setCam(s, 0, -((TOP_M - BOT_M) / 2) / s, animate, animate === 'slow' ? 1300 : 0);
  }
  let anim = null;
  function setCam(s, wx, wy, animate, dur) {   // centre world point (wx, wy) at scale s
    s = Math.max(0.03, Math.min(5, s));
    const target = { s, x: state.W / 2 - wx * s, y: state.H / 2 - wy * s };
    if (!animate) { state.cam = target; anim = null; draw(); return; }
    anim = { from: { ...state.cam }, to: target, t0: performance.now(), d: dur || 450 };
    requestDraw();
  }
  function zoomAt(f, sx, sy) {
    const s = Math.max(0.03, Math.min(5, state.cam.s * f)); f = s / state.cam.s;
    state.cam = { s, x: sx - (sx - state.cam.x) * f, y: sy - (sy - state.cam.y) * f };
    anim = null; requestDraw();
  }

  // ---------- drawing ----------
  let rafPending = false;
  function requestDraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); } }

  function sectorPath(r0, r1, a0, a1) {
    ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.arc(0, 0, r0, a1, a0, true); ctx.closePath();
  }
  function rrect(x, y, w, hh, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function lockIcon(x, y, sz, color) {      // vector padlock centred at x,y (current transform)
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = sz * 0.16;
    ctx.beginPath(); ctx.arc(x, y - sz * 0.12, sz * 0.26, Math.PI, 0); ctx.stroke();
    ctx.fillRect(x - sz * 0.38, y - sz * 0.12, sz * 0.76, sz * 0.58); ctx.restore();
  }
  const truncCache = new Map();
  function fitText(t, maxW, font) {
    const key = font + '|' + maxW + '|' + t;
    let v = truncCache.get(key); if (v !== undefined) return v;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = font;
    if (ctx.measureText(t).width <= maxW) v = t;
    else { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(t.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; } v = t.slice(0, lo) + '…'; }
    ctx.restore();
    if (truncCache.size > 20000) truncCache.clear();
    truncCache.set(key, v); return v;
  }
  const F_TITLE = '500 10.5px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  const F_META = '9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  const F_MORE = '600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

  function draw() {
    const { W, H, dpr } = state;
    if (anim) {
      const t = Math.min(1, (performance.now() - anim.t0) / anim.d), e = 1 - Math.pow(1 - t, 3);
      state.cam = { s: anim.from.s + (anim.to.s - anim.from.s) * e, x: anim.from.x + (anim.to.x - anim.from.x) * e, y: anim.from.y + (anim.to.y - anim.from.y) * e };
      if (t >= 1) anim = null;
    }
    if (state.view === 'mba') { drawCloudFull(); return; }
    if (state.view === 'how') return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const G = state.G;
    if (!G) return;
    const { s, x: ox, y: oy } = state.cam;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    const [vx0, vy0] = toWorld(0, 0), [vx1, vy1] = toWorld(W, H);
    const lw = 1 / s;   // one screen pixel in world units

    const now = performance.now();
    let busy = stepAnims(now);
    if (stepSlices(now)) busy = true;
    if (state.cloudOK) drawCloudBehind(G);
    else drawHalo(now, lw);
    // the brain's disc is opaque: the MBA Brain never shines through the rings
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(0, 0, G.Rbrain || G.Rc, 0, TAU);
    ctx.fillStyle = '#1f1e26'; ctx.fill();
    if (state.cloudOK) { ctx.strokeStyle = 'rgba(196,173,255,0.28)'; ctx.lineWidth = 2 * lw; ctx.stroke(); }
    // slices + rings
    for (const d of G.depts) {
      for (const ring of [1, 2]) {
        const rr = G.rings[ring]; if (!rr) continue;
        const cs = cellState(d, ring), vis = cs === 'show';
        sectorPath(rr[0] + 3, rr[1] - 3, d.a0, d.a1);
        if (cs === 'grey') {             // no access: grey, decorative dots only (never derived from notes)
          ctx.globalAlpha = 0.92; ctx.fillStyle = '#141417'; ctx.fill();
          ctx.globalAlpha = 0.5; ctx.fillStyle = hatch(s); ctx.fill();
          ctx.globalAlpha = 0.7; ctx.strokeStyle = '#4a4b52'; ctx.lineWidth = lw; ctx.setLineDash([4 * lw, 5 * lw]); ctx.stroke(); ctx.setLineDash([]);
          decoDots(rr[0] + 3, rr[1] - 3, d.a0, d.a1, '#7c7d85', 0.7, s);
        } else if (cs === 'ponly') {     // the previewed person may read it, the viewer may not: tint + decoration
          ctx.globalAlpha = 0.24; ctx.fillStyle = d.color; ctx.fill();
          ctx.globalAlpha = 0.9; ctx.strokeStyle = d.color; ctx.lineWidth = 2 * lw; ctx.stroke();
          decoDots(rr[0] + 3, rr[1] - 3, d.a0, d.a1, d.color, 0.9, s);
        } else {
          const empty = !(G.sectors.get(d.id + ':' + ring)?.cards.length);
          // an empty readable cell stays neutral so it never reads as a big coloured area
          ctx.globalAlpha = empty ? 0.025 : ring === 1 ? 0.11 : 0.06; ctx.fillStyle = empty ? '#ffffff' : d.color; ctx.fill();
          ctx.globalAlpha = empty ? 0.18 : 0.38; ctx.strokeStyle = d.color; ctx.lineWidth = lw; ctx.stroke();
        }
        if (!vis && s > 0.25) {          // structure only: a padlock, no notes, titles or counts
          const am = (d.a0 + d.a1) / 2, rm = (rr[0] + rr[1]) / 2;
          ctx.globalAlpha = 0.75; lockIcon(Math.cos(am) * rm, Math.sin(am) * rm - 6, 14, cs === 'grey' ? '#8b8d91' : d.color);
          if (s > 0.9 && cs === 'grey') { ctx.font = '9px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#9a9ca2';
            ctx.fillText('no access', Math.cos(am) * rm, Math.sin(am) * rm + 14); ctx.textAlign = 'left'; }
        }
      }
      const rr = G.rings[4];
      if (rr) for (const p of d.personals) {
        sectorPath(rr[0] + 3, rr[1] - 3, p.a0, p.a1);
        if (personalState(p) === 'plit') {      // the previewed person's own space: shape only, never content
          ctx.globalAlpha = 0.3; ctx.fillStyle = d.color; ctx.fill();
          ctx.globalAlpha = 1; ctx.strokeStyle = d.color; ctx.lineWidth = 2.5 * lw; ctx.stroke();
          decoDots(rr[0] + 3, rr[1] - 3, p.a0, p.a1, '#ffffff', 0.55, s);
          continue;
        }
        if (personalState(p) === 'grey') {
          ctx.globalAlpha = 0.92; ctx.fillStyle = '#141417'; ctx.fill();
          ctx.globalAlpha = 0.5; ctx.fillStyle = hatch(s); ctx.fill();
          ctx.globalAlpha = 0.6; ctx.strokeStyle = '#4a4b52'; ctx.lineWidth = lw; ctx.setLineDash([3 * lw, 5 * lw]); ctx.stroke(); ctx.setLineDash([]);
          decoDots(rr[0] + 3, rr[1] - 3, p.a0, p.a1, '#7c7d85', 0.6, s);
          continue;
        }
        const empty = !(G.sectors.get('p:' + p.id)?.cards.length);
        ctx.globalAlpha = empty ? 0.035 : 0.06; ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.globalAlpha = empty ? 0.35 : 0.5; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 1.3;
        ctx.setLineDash(!empty ? [] : [3 * lw, 5 * lw]); ctx.stroke(); ctx.setLineDash([]);
      }
      // people: small avatars on the outer edge of their private space (names are not secret)
      if (rr) for (const p of d.personals) {
        const am = (p.a0 + p.a1) / 2, ax = Math.cos(am) * G.Rav, ay = Math.sin(am) * G.Rav, R = 16;
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(ax, ay, R, 0, TAU);
        ctx.fillStyle = p.mine ? '#ffffff' : '#232326'; ctx.fill();
        ctx.lineWidth = Math.max(1.5 * lw, 1.6); ctx.strokeStyle = d.color; ctx.stroke();
        if (d.leads.includes(p.person)) { ctx.beginPath(); ctx.arc(ax + R * 0.72, ay - R * 0.72, 3.6, 0, TAU); ctx.fillStyle = '#ffb547'; ctx.fill(); }
        if (s * R > 5) {
          ctx.font = '700 12px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = p.mine ? '#111' : '#e6e6e6'; ctx.fillText(initials(p.name), ax, ay + 0.5);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
      }
    }
    ctx.globalAlpha = 1;
    // viewer and preview alike: one continuous lit wedge from the person's own slot through their department into the core
    const sd = subjectDept();
    if (sd && G.rings[4]) {
      const sp = G.personals.find(isSubject), rOut = G.rings[4][1] - 3, breath = 0.75 + 0.25 * Math.sin(now / 500);
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, rOut, sp.a0, sp.a1); ctx.arc(0, 0, G.rings[4][0], sp.a1, sd.a1); ctx.arc(0, 0, G.Rc, sd.a1, sd.a0, true); ctx.arc(0, 0, G.rings[4][0], sd.a0, sp.a0); ctx.closePath();
      ctx.globalAlpha = 0.1; ctx.fillStyle = sd.color; ctx.fill();
      ctx.shadowColor = sd.color; ctx.shadowBlur = 18; ctx.globalAlpha = breath; ctx.strokeStyle = sd.color; ctx.lineWidth = 3 * lw; ctx.stroke();
      ctx.restore(); busy = true;
    }
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, G.Rc);
    cg.addColorStop(0, 'rgba(168,130,255,0.16)'); cg.addColorStop(1, 'rgba(168,130,255,0.03)');
    ctx.beginPath(); ctx.arc(0, 0, G.Rc - 4, 0, TAU);
    ctx.fillStyle = cg; ctx.fill(); ctx.strokeStyle = sd ? sd.color : 'rgba(196,173,255,0.45)'; ctx.lineWidth = (sd ? 3 : 1.4) * lw; ctx.stroke();
    drawTrails(now, lw);

    // edges
    const hl = state.hover || state.selected;
    const hlSet = new Set();
    if (hl && G.adj.has(hl)) for (const e of G.adj.get(hl)) { hlSet.add(e); }
    const pos = (c) => (c.x !== undefined ? c : c.host);
    const linkAlpha = s < 0.35 ? 0.08 : 0.22;
    for (const t of G.inner || []) {
      const on = hl && (t.a === hl || t.b === hl);
      ctx.beginPath(); ctx.moveTo(t.a.x, t.a.y); ctx.lineTo(t.b.x, t.b.y);
      ctx.strokeStyle = t.color; ctx.globalAlpha = on ? 0.75 : 0.13; ctx.lineWidth = on ? Math.max(1.4, 1.4 * lw) : Math.max(0.6, 0.8 * lw);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const pass of [0, 1]) {
      for (const e of G.edges) {
        const strong = e.kind === 'conflicts' || e.kind === 'replaces', isHl = hlSet.has(e);
        if (pass === 0 ? (strong || isHl) : !(strong || isHl)) continue;
        if (!strong && !isHl && (e.kind === 'from_source' || (G.edges.length > 2500 && s < 0.3))) continue;
        const A = pos(e.a), B = pos(e.b); if (!A || !B || A === B) continue;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, cx = mx * 0.65, cy = my * 0.65;
        if (Math.max(A.x, B.x) < vx0 - 200 && Math.max(A.x, B.x, cx) < vx0) continue;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(cx, cy, B.x, B.y);
        if (e.kind === 'conflicts') { ctx.strokeStyle = '#ff5c6c'; ctx.globalAlpha = 0.95; ctx.lineWidth = Math.max(2, 1.6 * lw); ctx.setLineDash([6, 4]); }
        else if (e.kind === 'replaces') { ctx.strokeStyle = '#4fd1a5'; ctx.globalAlpha = 0.95; ctx.lineWidth = Math.max(2, 1.6 * lw); ctx.setLineDash([]); }
        else { ctx.strokeStyle = isHl ? '#c9c9d1' : '#888'; ctx.globalAlpha = isHl ? 0.85 : linkAlpha; ctx.lineWidth = isHl ? Math.max(1.4, 1.4 * lw) : Math.max(1, lw); ctx.setLineDash([]); }
        if (isHl && strong) ctx.lineWidth *= 1.5;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // cards
    const neigh = new Set(); for (const e of hlSet) { neigh.add(e.a); neigh.add(e.b); }
    // same cards and text at every zoom, just scaled; text is skipped only when it would be under ~2 device px
    const lod = s * 9 * (state.dpr || 1) < 2 ? 1 : 3;
    const drawOne = (c) => {
      if (c.x === undefined) return;
      const x = c.x - CW / 2, y = c.y - CH / 2;
      if (x > vx1 || x + CW < vx0 || y > vy1 || y + CH < vy0) return;
      if (c.kind === 'ghost') {
        rrect(x, y, CW, CH, 6); ctx.fillStyle = '#1a1a1b'; ctx.fill();
        ctx.strokeStyle = '#3a3a3d'; ctx.lineWidth = Math.max(lw, 1); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        lockIcon(c.x, c.y, 11, '#55585e');
      } else if (c.kind === 'more' || c.kind === 'less') {
        rrect(x, y, CW, CH, 6); ctx.fillStyle = '#232325'; ctx.fill();
        ctx.strokeStyle = c.color; ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(lw, 1); ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (lod >= 2) { ctx.fillStyle = '#e6e6e6'; ctx.font = F_MORE; ctx.textAlign = 'center'; ctx.fillText(c.title, c.x, c.y + (lod >= 3 && c.kind === 'more' ? 0 : 4)); ctx.textAlign = 'left';
          if (lod >= 3 && c.kind === 'more') { ctx.fillStyle = '#8b8d91'; ctx.font = F_META; ctx.textAlign = 'center'; ctx.fillText('click to expand', c.x, c.y + 11); ctx.textAlign = 'left'; } }
      } else {
        const sup = c.superseded;
        ctx.globalAlpha = sup ? 0.5 : 1;
        rrect(x, y, CW, CH, 6); ctx.fillStyle = '#2b2b2d'; ctx.fill();
        ctx.strokeStyle = c.decision ? '#ffb547' : c.remark ? '#7fd0ff' : c.priv ? 'rgba(255,255,255,0.5)' : '#444';
        ctx.lineWidth = c.decision ? 2 : Math.max(1, lw); ctx.stroke();
        ctx.fillStyle = c.priv ? '#ffffff' : c.color; ctx.fillRect(x, y + 2, 3.5, CH - 4);
        if (c.contested || c.conflict) { ctx.fillStyle = '#ff5c6c'; ctx.beginPath(); ctx.arc(x + CW - 7, y + 7, 2.6, 0, TAU); ctx.fill(); }
        if (c.restricted && !c.priv) lockIcon(x + CW - (c.contested || c.conflict ? 17 : 8), y + 8, 9, '#ffb547');
        if (lod >= 2) {
          ctx.globalAlpha = sup ? 0.55 : 1;
          ctx.font = F_TITLE; ctx.fillStyle = '#e6e6e6';
          const t = fitText(c.title, CW - 18 - (c.restricted && !c.priv ? 9 : 0), F_TITLE), ty = lod >= 3 ? y + 15 : y + 21;
          ctx.fillText(t, x + 9, ty);
          if (sup) { const tw = Math.min(ctx.measureText(t).width, CW - 18); ctx.fillRect(x + 9, ty - 3.5, tw, 0.9); }
          if (lod >= 3) { ctx.font = F_META; ctx.fillStyle = '#8b8d91'; ctx.fillText(fitText(c.meta, CW - 16, F_META), x + 9, y + 28); }
        }
        ctx.globalAlpha = 1;
      }
      if (state.cited.has(c.id)) {             // retrieved: soft glow behind the outline
        ctx.save(); ctx.shadowColor = state.winners.has(c.id) ? '#ffb547' : '#a882ff'; ctx.shadowBlur = 18 * s; rrect(x - 2, y - 2, CW + 4, CH + 4, 8);
        ctx.strokeStyle = 'rgba(168,130,255,0.35)'; ctx.lineWidth = 3 * lw; ctx.stroke(); ctx.restore();
      }
      if (c === state.selected || c === state.hover || neigh.has(c) || state.cited.has(c.id)) {
        rrect(x - 2, y - 2, CW + 4, CH + 4, 8);
        const breath = 0.6 + 0.4 * Math.sin(now / 170);
        ctx.strokeStyle = c === state.selected ? '#a882ff' : state.winners.has(c.id) ? `rgba(255,181,71,${breath})` : state.cited.has(c.id) ? `rgba(168,130,255,${breath})` : 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(c === state.selected ? 2.4 : 1.4, (c === state.selected ? 2.4 : 1.4) * lw); ctx.stroke();
      }
    };
    for (const c of G.cards) drawOne(c);
    for (const c of G.extra) drawOne(c);

    // pulses around focused / newly arrived cards
    state.pulses = state.pulses.filter((pu) => {
      const t = (now - pu.t0) / (pu.d || 1600);
      const c = pu.card, P = c.x !== undefined ? c : c.host;
      if (t < 0) return true;
      if (t >= 1 || !P) return false;
      const k = (t * 2) % 1, grow = 6 + k * 26;
      rrect(P.x - CW / 2 - grow * lw * 4, P.y - CH / 2 - grow * lw * 4, CW + grow * lw * 8, CH + grow * lw * 8, 10);
      ctx.strokeStyle = pu.color || '#a882ff'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2.5 * lw; ctx.stroke(); ctx.globalAlpha = 1;
      return true;
    });
    // cited cards breathe for a few seconds after an answer
    if (state.cited.size && now - state.askT0 < 6000) busy = true;

    // world-space core label
    ctx.fillStyle = '#ffffff'; ctx.font = '700 12px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'center';
    if (s * 12 > 6) ctx.fillText('COMPANY CORE', 0, -G.Rc + 22);
    ctx.textAlign = 'left';

    // screen-space labels (constant pixel size)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLabels();
    const drift = state.cloudOK && typeof window.MBACloud.animating === 'function' && window.MBACloud.animating();
    if (anim || busy || drift || state.haloBusy || state.fwLit.size || state.cloudLit.size || state.pulses.length) requestDraw();
  }

  function initials(name) {
    const w = str(name).replace(/^Personal:\s*/, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }

  // ---------- motion: cards glide to new places; new ones fly in from the edge ----------
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3));
  function stepAnims(now) {
    const G = state.G; if (!G) return false;
    let busy = false;
    for (const c of G.cards) {
      const m = c.mv; if (!m) continue;
      if (c.tx === undefined) { c.mv = null; continue; }
      const t = (now - m.t0) / m.d, e = ease(t);
      if (m.kind === 'move') {           // arc inward along the circle, not straight through it
        const rA = Math.hypot(m.fx, m.fy), rB = Math.hypot(c.tx, c.ty);
        let aA = Math.atan2(m.fy, m.fx), aB = Math.atan2(c.ty, c.tx);
        while (aB - aA > Math.PI) aB -= TAU; while (aA - aB > Math.PI) aB += TAU;
        const r = rA + (rB - rA) * e, a = aA + (aB - aA) * e;
        c.x = rB < 1 && e >= 1 ? c.tx : Math.cos(a) * r + (c.tx - Math.cos(aB) * rB) * e;
        c.y = rB < 1 && e >= 1 ? c.ty : Math.sin(a) * r + (c.ty - Math.sin(aB) * rB) * e;
      } else { c.x = m.fx + (c.tx - m.fx) * e; c.y = m.fy + (c.ty - m.fy) * e; }
      if (m.kind !== 'glide') { m.trail.push([c.x, c.y, now]); }
      if (t >= 1) {
        c.x = c.tx; c.y = c.ty; c.mv = null;
        if (m.kind !== 'glide') { state.pulses.push({ card: c, t0: now, d: 2400, color: m.kind === 'move' ? '#ffb547' : '#a882ff' }); state.trails.push({ pts: m.trail, color: m.color, t0: now }); }
      } else busy = true;
    }
    if (state.trails.length) busy = true;
    return busy;
  }
  function drawTrails(now, lw) {
    const G = state.G; if (!G) return;
    const lines = [];
    for (const c of G.cards) if (c.mv && c.mv.trail && c.mv.trail.length > 1) lines.push({ pts: c.mv.trail, color: c.mv.color, fade: 1 });
    state.trails = state.trails.filter((t) => now - t.t0 < 1200);
    for (const t of state.trails) lines.push({ pts: t.pts, color: t.color, fade: 1 - (now - t.t0) / 1200 });
    for (const L of lines) {
      const pts = L.pts, n = pts.length;
      for (let i = 1; i < n; i++) {
        const age = (now - pts[i][2]) / 700; if (age > 1) continue;
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = L.color; ctx.globalAlpha = Math.max(0, (1 - age) * 0.8 * L.fade); ctx.lineWidth = Math.max(2, 5 * (1 - age)) * Math.max(lw, 0.6); ctx.lineCap = 'round'; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }
  // after a fresh layout: keep where cards were drawn, then animate to the new targets
  function retarget(prev, fresh, movedIds) {
    const G = state.G, now = performance.now();
    let i = 0;
    for (const c of G.cards) {
      c.tx = c.x; c.ty = c.y;
      if (c.x === undefined) continue;
      const p = prev && prev.get(c.id);
      if (fresh && fresh.has(c.id)) {
        const sp = c.src && c.src.x !== undefined && !fresh.has(c.src.id) ? (prev && prev.get(c.src.id)) || [c.src.x, c.src.y] : null;
        if (sp) {                          // an extracted fact grows out of its document, quietly
          c.mv = { kind: 'glide', fx: sp[0], fy: sp[1], t0: now + 60 * Math.min(i++, 20), d: 900, trail: [], color: c.color };
        } else {
          const a = Math.atan2(c.y, c.x) || -Math.PI / 2, R = G.Rmax + 260;
          c.mv = { kind: 'fly', fx: Math.cos(a) * R, fy: Math.sin(a) * R, t0: now + 120 * Math.min(i++, 10), d: 1500, trail: [], color: c.priv ? '#ffffff' : c.color };
        }
        c.x = c.mv.fx; c.y = c.mv.fy;
      } else if (p && (Math.abs(p[0] - c.x) > 0.5 || Math.abs(p[1] - c.y) > 0.5)) {
        const isMove = movedIds && movedIds.has(c.id);
        c.mv = { kind: isMove ? 'move' : 'glide', fx: p[0], fy: p[1], t0: now + (isMove ? 700 : 0), d: isMove ? 1500 : 700, trail: [], color: '#ffb547' };
        c.x = p[0]; c.y = p[1];
      }
    }
    requestDraw();
  }
  function positions() {
    const m = new Map(); if (!state.G) return m;
    for (const c of state.G.cards) if (c.x !== undefined) m.set(c.id, [c.x, c.y]);
    return m;
  }
  function relayout() {
    const G = state.G, olds = G ? [...G.depts, ...G.personals].map((o) => [o, o.a0, o.a1]) : [];
    const prev = positions(); layout(); retarget(prev, null, null);
    // slices glide to their new angles (~400 ms) instead of jumping
    const tw = olds.filter(([o, a0, a1]) => a0 !== undefined && (Math.abs(o.a0 - a0) > 1e-4 || Math.abs(o.a1 - a1) > 1e-4)).map(([o, a0, a1]) => [o, a0, a1, o.a0, o.a1]);
    state.sliceTw = tw.length ? { t0: performance.now(), tw } : null;
  }
  function stepSlices(now) {
    const st = state.sliceTw; if (!st) return false;
    const k = Math.min(1, (now - st.t0) / 400), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    for (const [o, f0, f1, t0, t1] of st.tw) { o.a0 = f0 + (t0 - f0) * e; o.a1 = f1 + (t1 - f1) * e; }
    if (k >= 1) { state.sliceTw = null; return false; }
    return true;
  }

  // ---------- decorative placeholder dots for cells the subject can't read ----------
  // Fixed pseudo-random positions seeded ONLY by the cell's geometry: never by notes, counts, titles or ids.
  const decoCache = new Map();
  let hatchPat = null;
  function hatch(s) {                    // faint diagonal hatch, constant spacing on screen
    if (!hatchPat) {
      const c = document.createElement('canvas'); c.width = c.height = 20; const x = c.getContext('2d');
      x.strokeStyle = '#5a5b62'; x.lineWidth = 2; x.beginPath();
      for (const o of [-20, 0, 20]) { x.moveTo(o, 20); x.lineTo(o + 20, 0); }
      x.stroke(); hatchPat = ctx.createPattern(c, 'repeat');
    }
    try { hatchPat.setTransform(new DOMMatrix([0.5 / s, 0, 0, 0.5 / s, 0, 0])); } catch { /* old browsers: world-scaled hatch */ }
    return hatchPat;
  }
  function decoDots(r0, r1, a0, a1, color, alpha, s) {
    // dots live at stable fractions of their slice (seeded by ring + colour), so a slice that grows or
    // shrinks keeps the same dots in the same relative places instead of reshuffling them
    const key = [color, r0.toFixed(0), r1.toFixed(0)].join(',');
    let fr = decoCache.get(key);
    if (!fr) {
      let seed = Math.floor(hash(key) * 2147483646) + 1;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      fr = [];
      for (let i = 0; i < 70; i++) fr.push([rnd(), 0.08 + 0.84 * rnd(), 2 + rnd() * 2.2]);
      if (decoCache.size > 400) decoCache.clear();
      decoCache.set(key, fr);
    }
    const area = (a1 - a0) * (r1 * r1 - r0 * r0) / 2, n = Math.max(6, Math.min(70, Math.round(area / 2600)));
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const [u, v, rad] = fr[i], a = a0 + 0.02 + (a1 - a0 - 0.04) * u, r = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * v);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, TAU);
    }
    ctx.fill(); ctx.globalAlpha = 1;
  }

  // ---------- MBA Brain cloud (web/viz/mba-cloud.js), cached to an offscreen canvas ----------
  // drawn in screen space at the current zoom; the module keeps its own crisp cache per scale
  const CLOUD_RF = 1100, CLOUD_PAD = 1.3; let cloudLayer = null;
  function drawCloudBehind(G) {
    const { dpr } = state, [cx, cy] = toScreen(0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the cloud is painted once per frame at ONE fixed size into its own layer, then scaled with the camera,
    // so its density and opacity look the same at every zoom (no per-zoom re-render that changes how bright it is)
    try {
      const RF = CLOUD_RF, side = Math.ceil(RF * 2 * CLOUD_PAD);
      if (!cloudLayer) { cloudLayer = document.createElement('canvas'); cloudLayer.width = cloudLayer.height = side; }
      const lc = cloudLayer.getContext('2d');
      lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, side, side);
      window.MBACloud.draw(lc, { cx: side / 2, cy: side / 2, R: RF, alpha: 1, lit: state.cloudLit, now: performance.now(), hole: (G.Rbrain || G.Rc) / (G.Rcloud || 1000), muted: true });
      const R = (G.Rcloud || 1000) * state.cam.s, k = R / RF, w = side * k;
      ctx.save(); ctx.globalAlpha = 0.92; ctx.drawImage(cloudLayer, cx - w / 2, cy - w / 2, w, w); ctx.restore();
    }
    catch (e) { console.warn('MBA Brain cloud draw failed', e); }
    const s = state.cam.s; ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * state.cam.x, dpr * state.cam.y);
  }
  function drawCloudFull() {          // "MBA Brain only": live draw so zoom keeps labels sharp
    const { W, H, dpr } = state, m = state.mcam;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!state.cloudOK) { ctx.fillStyle = '#8b8d91'; ctx.font = '15px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Loading the MBA Brain…', W / 2, H / 2); ctx.textAlign = 'left'; return; }
    const R0 = Math.min(W, H - 140) / 2 - 10;
    try { window.MBACloud.draw(ctx, { cx: W / 2 + m.x, cy: H / 2 + 30 + m.y, R: R0 * m.s, alpha: 1, lit: state.cloudLit, now: performance.now() }); }
    catch (e) { console.warn('MBA Brain cloud draw failed', e); }
    if (state.cloudLit.size) requestDraw();
  }

  // ---------- drawing: MBA Brain halo ----------
  function drawHalo(now, lw) {
    const G = state.G, H = G && G.halo; if (!H) return;
    const s = state.cam.s, [r0, r1] = G.Rhalo;
    // soft band
    const g = ctx.createRadialGradient(0, 0, r0 - 30, 0, 0, r1 + 30);
    g.addColorStop(0, 'rgba(127,208,255,0)'); g.addColorStop(0.5, 'rgba(127,208,255,0.035)'); g.addColorStop(1, 'rgba(127,208,255,0)');
    ctx.beginPath(); ctx.arc(0, 0, r1 + 30, 0, TAU); ctx.arc(0, 0, Math.max(0, r0 - 30), TAU, 0, true); ctx.fillStyle = g; ctx.fill();
    // discipline arcs
    for (const d of H.discs) {
      ctx.beginPath(); ctx.arc(0, 0, r1 + 14, d.a0, d.a1); ctx.strokeStyle = 'rgba(127,208,255,0.22)'; ctx.lineWidth = 1.2 * lw; ctx.stroke();
    }
    const lit = state.fwLit, fwAge = now - state.fwT0;
    const rad = 2.2;
    ctx.fillStyle = '#7fd0ff';
    for (const d of H.dots) {
      if (lit.has(d.key)) continue;
      ctx.globalAlpha = 0.18 + 0.1 * Math.sin(now / 1400 + d.tw * 40) * 0; // static: calm
      ctx.beginPath(); ctx.arc(d.x, d.y, rad, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // lit frameworks: glow + a thin line flowing into the core
    let i = 0;
    for (const [key, d] of lit) {
      const t = Math.min(1, Math.max(0, (fwAge - i * 250) / 900)); i++;
      if (t <= 0) continue;
      const cx = d.x * 0.35, cy = d.y * 0.35, ex = d.x / Math.hypot(d.x, d.y) * G.Rc, ey = d.y / Math.hypot(d.x, d.y) * G.Rc;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.quadraticCurveTo(cx + d.y * 0.12, cy - d.x * 0.12, ex, ey);
      ctx.strokeStyle = 'rgba(127,208,255,0.75)'; ctx.globalAlpha = t; ctx.lineWidth = Math.max(1.2 * lw, 1.2);
      ctx.setLineDash([10 * Math.max(lw, 0.8), 8 * Math.max(lw, 0.8)]); ctx.lineDashOffset = -(now / 25) * Math.max(lw, 0.8); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.save(); ctx.shadowColor = '#7fd0ff'; ctx.shadowBlur = 22 * s;
      ctx.beginPath(); ctx.arc(d.x, d.y, rad * 2.6, 0, TAU); ctx.fillStyle = '#bfe9ff'; ctx.fill(); ctx.restore();
      if (s > 0.2) {
        ctx.font = `600 ${Math.max(11, 12 / s * 0.9)}px -apple-system,BlinkMacSystemFont,sans-serif`; ctx.fillStyle = '#d6f1ff'; ctx.textAlign = d.x < 0 ? 'right' : 'left';
        const fs = Math.max(11, 12 / s * 0.9), lx = d.x + (d.x < 0 ? -1 : 1) * rad * 4, tw = ctx.measureText(d.title).width;
        ctx.save(); ctx.globalAlpha = t * 0.88; ctx.fillStyle = '#121a22'; rrect(d.x < 0 ? lx - tw - 6 / s : lx - 6 / s, d.y - fs * 0.85, tw + 12 / s, fs * 1.5, fs * 0.5); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#d6f1ff'; ctx.fillText(key && d.title, lx, d.y + fs * 0.35); ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    }
    if (lit.size && fwAge < 4000) state.haloBusy = true; else state.haloBusy = false;
  }
  function litFrameworks(list) {
    const G = state.G; state.fwLit = new Map(); state.fwT0 = performance.now();
    state.cloudLit = new Set((Array.isArray(list) ? list : []).map((f) => str(f && f.title).toLowerCase()).filter(Boolean));
    if (state.cloudOK) { requestDraw(); return; }
    if (!G || !G.halo || !Array.isArray(list)) return;
    for (const f of list) {
      const k = normT(f && (f.title || f.path)); if (!k) continue;
      let d = G.halo.byKey.get(k);
      if (!d) for (const x of G.halo.dots) if (x.key.includes(k) || k.includes(x.key)) { d = x; break; }
      if (!d) {                                     // not in the list: place it in the halo anyway
        const a = -Math.PI / 2 + hash(k) * TAU, r = (G.Rhalo[0] + G.Rhalo[1]) / 2;
        d = { title: str(f.title), key: k, x: Math.cos(a) * r, y: Math.sin(a) * r, tw: 0 };
      }
      state.fwLit.set(k, d);
    }
    requestDraw();
  }

  function drawLabels() {
    const G = state.G, s = state.cam.s;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    // ring names at the top, in each band's inner padding
    for (const ring of RINGS) {
      const rr = G.rings[ring]; if (!rr || (rr[1] - rr[0]) * s < 26 || s < 0.6) continue;
      const [x, y] = toScreen(0, -(rr[0] + 10));
      if (y < TOP_M + 14 || y > state.H - BOT_M) continue;        // never under the header or legend
      ctx.font = '600 10.5px -apple-system,BlinkMacSystemFont,sans-serif';
      const label = RING_NAMES[ring].toUpperCase(), tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(24,24,28,0.86)'; rrect(x - tw / 2 - 8, y - 8, tw + 16, 16, 8); ctx.fill();
      ctx.fillStyle = '#9a9da5'; ctx.fillText(label, x, y + 4);
    }
    const boxes = [];
    { const rO = G.Rav + 22;
      for (const d of G.depts) {
        const am = (d.a0 + d.a1) / 2, ca = Math.cos(am), sa = Math.sin(am), [sx, sy] = toScreen(ca * rO, sa * rO);
        const lx = sx + ca * 14, w = 230, al = ca > 0.3 ? 0 : ca < -0.3 ? -w : -w / 2;
        boxes.push([lx + al - 6, sy + sa * 16 - 40, lx + al + w + 6, sy + sa * 16 + 44]);
      } }
    // MBA Brain halo: discipline names + title
    if (G.halo && !state.cloudOK) {
      const [h0, h1] = G.Rhalo;
      for (const d of G.halo.discs) {
        const am = (d.a0 + d.a1) / 2, [x, y] = toScreen(Math.cos(am) * (h1 + 14), Math.sin(am) * (h1 + 14));
        const ca = Math.cos(am), sa = Math.sin(am);
        ctx.font = '500 11.5px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillStyle = 'rgba(127,208,255,0.6)';
        ctx.textAlign = Math.abs(ca) < 0.3 ? 'center' : ca > 0 ? 'left' : 'right';
        const tx = x + ca * 10, ty = y + sa * 12 + 4, tw = ctx.measureText(d.name).width;
        const bx0 = ctx.textAlign === 'center' ? tx - tw / 2 : ctx.textAlign === 'left' ? tx : tx - tw;
        if (boxes.some((b) => bx0 < b[2] && bx0 + tw > b[0] && ty - 12 < b[3] && ty + 2 > b[1])) continue;
        if (ty < 74 || ty > state.H - 40) continue;  // keep clear of the page header and legend
        let near = false;
        for (const L of state.fwLit.values()) { const [lx, ly] = toScreen(L.x, L.y); if (Math.abs(ly - ty) < 26 && Math.abs(lx - tx) < 260) { near = true; break; } }
        if (near) continue;
        ctx.fillText(d.name, tx, ty);
      }
    }
    const rOuter = G.Rav + 22;
    for (const d of G.depts) {
      const am = (d.a0 + d.a1) / 2, ca = Math.cos(am), sa = Math.sin(am);
      const [sx, sy] = toScreen(ca * rOuter, sa * rOuter);
      const lead = d.leadNames.length ? d.leadNames.join(', ') : d.ownerName;
      const lines = 1 + (lead ? 1 : 0) + (d.personals.some((p) => p.mine) ? 1 : 0);
      const lx = sx + ca * 14, ly = sy + sa * 16 + 4 - (sa < -0.3 ? (lines - 1) * 17 : 0) - (Math.abs(sa) <= 0.3 ? (lines - 1) * 8 : 0);
      ctx.textAlign = ca > 0.3 ? 'left' : ca < -0.3 ? 'right' : 'center';
      const arcPx = (d.a1 - d.a0) * rOuter * s;
      const name = fitText(d.name, Math.max(60, Math.min(260, arcPx + 40)), '650 15px -apple-system,BlinkMacSystemFont,sans-serif');
      ctx.font = '650 15px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillStyle = d.color; ctx.globalAlpha = 1;
      ctx.fillText(name, lx, ly);
      ctx.globalAlpha = 1;
      if (lead) { ctx.font = '12px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillStyle = '#a4a6ac'; ctx.fillText(fitText('lead: ' + lead, 220, '12px -apple-system,BlinkMacSystemFont,sans-serif'), lx, ly + 17); }
      const me = state.preview ? null : d.personals.find((p) => p.mine);
      if (me) { ctx.font = '700 12px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText(fitText('you are here', 220, ctx.font), lx, ly + (lead ? 34 : 17)); }
      ctx.textAlign = 'center';
      // personal segment names
      const rr = G.rings[4];
      if (rr) for (const p of d.personals) {
        const bm = (p.a0 + p.a1) / 2, segPx = (p.a1 - p.a0) * ((rr[0] + rr[1]) / 2) * s;
        const font = p.mine ? '600 11px -apple-system,BlinkMacSystemFont,sans-serif' : '11px -apple-system,BlinkMacSystemFont,sans-serif';
        if (p.mine && !state.preview) {            // the viewer's own space: say what it is
          const [mx, my] = toScreen(Math.cos(bm) * (rr[0] + rr[1]) / 2, Math.sin(bm) * (rr[0] + rr[1]) / 2);
          if (!(G.sectors.get('p:' + p.id)?.cards.length) && (rr[1] - rr[0]) * s > 30) {
            ctx.font = '600 11px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.fillText('your private space', mx, my - 2); ctx.font = '10px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillStyle = '#8b8d91'; ctx.fillText('only you', mx, my + 11);
          }
          continue;
        }
        const label = p.mine ? 'you' : str(p.name).split(' ')[0];
        ctx.font = font; const tw = ctx.measureText(label).width + 16;
        if (segPx < Math.min(tw, 40) || (rr[1] - rr[0]) * s < 14) continue;
        const rad = p.mine ? rr[1] - 12 : (rr[0] + rr[1]) / 2;
        const [px, py] = toScreen(Math.cos(bm) * rad, Math.sin(bm) * rad);
        const txt = fitText(label, Math.max(30, segPx - 16), font);
        if (txt !== label) continue;
        const w = ctx.measureText(txt).width;
        ctx.fillStyle = p.mine ? '#ffffff' : '#6f727a';
        ctx.fillText(txt, px + 7, py + 4);
        lockIcon(px + 7 - w / 2 - 9, py, 10, '#6f727a');
      }
    }
    // preview: a clear pill on each cell only the previewed person can read
    if (state.preview && G.rings[2]) {
      const rr = G.rings[2], first = state.preview.name.split(' ')[0];
      for (const d of G.depts) {
        if (cellState(d, 2) !== 'ponly') continue;
        const am = (d.a0 + d.a1) / 2, rm = (rr[0] + rr[1]) / 2, [x, y] = toScreen(Math.cos(am) * rm, Math.sin(am) * rm);
        const t = `${first} can read`; ctx.font = '700 13px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'center';
        const tw = ctx.measureText(t).width;
        ctx.fillStyle = 'rgba(20,20,24,0.9)'; rrect(x - tw / 2 - 10, y - 12, tw + 20, 24, 12); ctx.fill();
        ctx.strokeStyle = d.color; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillText(t, x, y + 4.5);
      }
    }
    // zoomed out: "+N" chips still say how many are folded
    if (s * CW < 34 || s < 0.56) {
      ctx.font = '700 10.5px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e6e6e6';
      for (const e of G.extra) if (e.kind === 'more') { const [x, y] = toScreen(e.x, e.y); ctx.fillText('+' + e.count, x, y + 4); }
    }
    // hover: the card's title next to the pointer side of the card, readable at any zoom
    const hc = state.hover;
    if (hc && hc.x !== undefined && s < 0.8) {
      const [x, y] = toScreen(hc.x, hc.y), t1 = hc.title, t2 = (hc.meta || '') + (hc.kind === 'note' ? ' · ' + placeName(hc) : '');
      ctx.font = '600 14px -apple-system,BlinkMacSystemFont,sans-serif'; const w1 = Math.min(420, ctx.measureText(t1).width);
      ctx.font = '12px -apple-system,BlinkMacSystemFont,sans-serif'; const w2 = ctx.measureText(t2).width;
      const w = Math.max(w1, w2) + 24, hh = t2 ? 46 : 30, bx = Math.min(state.W - w - 8, Math.max(8, x - w / 2)), by = y - CH * s / 2 - hh - 8 < 70 ? y + CH * s / 2 + 8 : y - CH * s / 2 - hh - 8;
      ctx.fillStyle = 'rgba(30,29,38,0.96)'; rrect(bx, by, w, hh, 8); ctx.fill();
      ctx.strokeStyle = hc.priv ? '#ffffff' : hc.color; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff'; ctx.font = '600 14px -apple-system,BlinkMacSystemFont,sans-serif';
      ctx.fillText(fitText(t1, 420, ctx.font), bx + 12, by + 20);
      if (t2) { ctx.fillStyle = '#9a9ca2'; ctx.font = '12px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillText(t2, bx + 12, by + 37); }
    }
    ctx.textAlign = 'left';
  }

  // ---------- picking ----------
  function cardAt(sx, sy) {
    const G = state.G; if (!G) return null;
    const [wx, wy] = toWorld(sx, sy);
    const hit = (c) => c.x !== undefined && Math.abs(wx - c.x) <= CW / 2 && Math.abs(wy - c.y) <= CH / 2;
    for (const c of G.extra) if (hit(c)) return c;
    for (const c of G.cards) if (hit(c)) return c;
    // zoomed out, cards are small: take the nearest one within ~10 screen px
    const pad = 10 / state.cam.s; let best = null, bd = Infinity;
    for (const c of G.cards.concat(G.extra)) {
      if (c.x === undefined) continue;
      const dx = Math.max(0, Math.abs(wx - c.x) - CW / 2), dy = Math.max(0, Math.abs(wy - c.y) - CH / 2);
      if (dx <= pad && dy <= pad && dx + dy < bd) { bd = dx + dy; best = c; }
    }
    return best;
  }
  function segmentAt(sx, sy) {
    const G = state.G; if (!G || !G.rings[4]) return null;
    const [wx, wy] = toWorld(sx, sy), r = Math.hypot(wx, wy), rr = G.rings[4];
    if (r < rr[0] || r > rr[1]) return null;
    for (const p of G.personals) {
      let rel = Math.atan2(wy, wx) - p.a0; rel = ((rel % TAU) + TAU) % TAU;
      if (rel <= p.a1 - p.a0) return p;
    }
    return null;
  }

  // ---------- interaction ----------
  let drag = null;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    state.userT = performance.now(); director.cancel();
    zoomAt(Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    state.userT = performance.now(); director.cancel();
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 3) { canvas.classList.add('drag'); state.cam.x += dx; state.cam.y += dy; anim = null; requestDraw(); }
      drag.x = e.clientX; drag.y = e.clientY;
      return;
    }
    const c = cardAt(e.clientX - r.left, e.clientY - r.top);
    const hov = c && c.kind !== 'more' && c.kind !== 'less' ? c : null;
    canvas.classList.toggle('pt', !!c);
    if (hov !== state.hover) { state.hover = hov; requestDraw(); }
  });
  canvas.addEventListener('pointerleave', () => { if (state.hover) { state.hover = null; requestDraw(); } });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = drag && drag.moved <= 3;
    drag = null; canvas.classList.remove('drag');
    if (!wasClick) return;
    const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const c = cardAt(sx, sy);
    if (c) { onCardClick(c); return; }
    const p = segmentAt(sx, sy);
    if (p && !p.mine) { state.selected = null; showSegment(p); requestDraw(); return; }
    if (state.selected) { state.selected = null; requestDraw(); }
  });
  $('#zin').onclick = () => zoomAt(1.4, state.W / 2, state.H / 2);
  $('#zout').onclick = () => zoomAt(1 / 1.4, state.W / 2, state.H / 2);
  $('#zfit').onclick = () => fitView(true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.tagName === 'INPUT') { e.target.blur(); }
    else if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === '0' || e.key === 'f') fitView(true);
    else if (e.key === '+' || e.key === '=') zoomAt(1.4, state.W / 2, state.H / 2);
    else if (e.key === '-') zoomAt(1 / 1.4, state.W / 2, state.H / 2);
    else if (e.key === 'Escape') { if (!flowEl.hidden) { closeFlow(); return; } closeDrop(); clearBox(noteBox); clearBox(ansBox); }
  });

  function onCardClick(c) {
    if (c.kind === 'more' || c.kind === 'less') { toggleExpand(c); return; }
    state.selected = c; requestDraw();
    if (c.kind === 'ghost') showGhost(c); else showNote(c);
  }

  function toggleExpand(c) {
    const key = c.sec.key, wasMore = c.kind === 'more';
    if (wasMore) state.expanded.add(key); else state.expanded.delete(key);
    relayout();
    if (wasMore) {
      // frame the newly shown cards
      const shown = c.sec.cards.filter((x) => x.x !== undefined);
      if (shown.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const k of shown) { x0 = Math.min(x0, k.x); x1 = Math.max(x1, k.x); y0 = Math.min(y0, k.y); y1 = Math.max(y1, k.y); }
        const s = Math.min(1.6, Math.max(0.35, Math.min(state.W / (x1 - x0 + CW * 3), state.H / (y1 - y0 + CH * 6))));
        setCam(s, (x0 + x1) / 2, (y0 + y1) / 2, true);
        return;
      }
    }
    requestDraw();
  }

  function focusCard(c, openNote) {
    if (!c) return;
    if (c.x === undefined && c.sec) { state.expanded.add(c.sec.key); relayout(); }
    const P = c.x !== undefined ? c : c.host;
    state.selected = c; state.pulses.push({ card: c, t0: performance.now() });
    if (P) setCam(Math.max(state.cam.s, 1.25), P.x, P.y, true); else requestDraw();
    if (openNote) { if (c.kind === 'ghost') showGhost(c); else showNote(c); }
  }

  // ---------- side panel: card ----------
  const noteBox = $('#note');
  const EMPTY = { ans: 'Answers use only what the selected person may read, plus the MBA Brain.', note: 'Click a card.' };
  function clearBox(box) {
    if (box.id === 'ans') { ++state.askSeq; state.cited = new Set(); state.winners = new Set(); state.fwLit = new Map(); state.cloudLit = new Set(); askForm.classList.remove('busy'); askForm.querySelector('button').disabled = false; }
    else { ++state.noteSeq; state.selected = null; }
    box.replaceChildren(h('span', { class: 'muted' }, EMPTY[box.id] || '')); requestDraw();
  }
  function setBox(box, ...kids) {
    const items = kids.flat().filter(Boolean);
    const x = h('button', { type: 'button', class: 'boxclose', title: 'Close (Esc)', 'aria-label': 'Close' }, '\u2715');
    x.addEventListener('click', () => clearBox(box));
    box.replaceChildren(x, ...items);
  }

  function areaLabel(c) {
    if (c.sec.ring === 4 && c.sec.seg) return `personal (${c.sec.seg.name})`;
    return c.dept ? c.dept.name : 'Company core';
  }
  function edgeLines(c) {
    const G = state.G, out = [];
    for (const e of G.adj.get(c) || []) {
      const other = e.a === c ? e.b : e.a;
      let label;
      if (e.kind === 'conflicts') label = 'conflicts with';
      else if (e.kind === 'replaces') label = e.a === c ? 'replaces' : 'replaced by';
      else if (e.kind === 'from_source') label = e.a === c ? 'from source' : 'source of';
      else label = e.a === c ? 'links to' : 'linked from';
      out.push(h('div', { class: 'tiny' }, h('span', { class: e.kind === 'conflicts' ? 'k-con' : e.kind === 'replaces' ? 'k-rep' : 'muted' }, label + ': '), cardLink(other.id, other.kind === 'ghost' ? 'Restricted' : other.title)));
    }
    return out;
  }
  function yamlBlock(fm, c) {
    const pre = h('div', { class: 'yaml' });
    const keys = Object.keys(fm || {}).filter((k) => !['id', 'title', 'can_move', 'locked', 'restricted', 'added_at'].includes(k));
    let first = true;
    if (c && c.sec) { pre.append(h('b', null, 'ring:'), ' ', placeName(c)); first = false; }
    for (const k of keys) {
      let v = fm[k];
      if (k === 'moved' && Array.isArray(v)) v = v.map((m) => m && typeof m === 'object' ? `${str(m.from)} → ${str(m.to)}${m.by ? ' by ' + personName(str(m.by)) : ''}${m.at ? ', ' + fmtDate(m.at) : ''}` : m);
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (!first) pre.append('\n'); first = false;
      pre.append(h('b', null, k + ':'), ' ');
      const idLike = k === 'source' || k === 'replaces';
      const vals = Array.isArray(v) ? v : [v];
      if (Array.isArray(v)) pre.append('[');
      vals.forEach((x, i) => {
        if (i) pre.append(', ');
        if (idLike && state.G.byId.has(str(x))) pre.append(cardLink(x, state.G.byId.get(str(x)).title));
        else if ((k === 'author' || k === 'allow' || k === 'by') && personName(str(x)) !== str(x)) pre.append(personName(str(x)));
        else pre.append(typeof x === 'object' ? JSON.stringify(x) : str(x));
      });
      if (Array.isArray(v)) pre.append(']');
    }
    if (c && c.sec.ring === 4) pre.append('\n', h('b', null, 'visible to:'), ' only you, not even the CEO');
    return pre;
  }
  function bodyBlock(body) {
    const text = str(body).slice(0, 4000);
    if (!text.trim()) return null;
    const div = h('div', { class: 'body' });
    const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      div.append(text.slice(last, m.index));
      const id = m[1].trim();
      div.append(state.G.byId.has(id) ? cardLink(id, state.G.byId.get(id).title) : m[0]);
      last = re.lastIndex;
    }
    div.append(text.slice(last) + (str(body).length > 4000 ? '\n…' : ''));
    return div;
  }

  async function showNote(c) {
    const seq = ++state.noteSeq;
    setBox(noteBox, h('div', { style: 'font-weight:600;color:#fff;margin-bottom:6px' }, c.title), h('span', { class: 'muted' }, 'Loading…'));
    let note = null, err = null;
    try { note = await getJSON('/api/note', { ...ident(), id: c.id }); } catch (e) { err = e; }
    if (seq !== state.noteSeq) return;
    const head = h('div', { style: 'font-weight:600;color:#fff;margin-bottom:6px' }, c.title);
    if (!note) {
      setBox(noteBox, head, h('div', { class: 'muted' }, err && err.status === 404 ? 'This note is not readable for this role.' : `Could not load the note (${err ? err.message : 'unknown error'}).`), ...edgeLines(c));
      return;
    }
    const fm = { ...(note.frontmatter || {}) };
    if (!('id' in fm)) fm.id = note.id;
    if (!('area' in fm) && note.area) fm.area = note.area;
    const kids = [h('div', { style: 'font-weight:600;color:#fff;margin-bottom:6px' }, str(note.title) || c.title), yamlBlock(fm, c)];
    if (state.G && c.n && c.n.status && c.n.status !== 'current') kids.push(h('div', { class: c.n.status === 'contested' ? 'flag' : 'tiny muted', style: 'margin-top:6px' }, `status for you: ${c.n.status}`));
    const links = Array.isArray(note.links) ? note.links : [];
    const el = edgeLines(c);
    if (links.length || el.length) {
      kids.push(h('div', { class: 'sub' }, 'Links'));
      for (const l of links) if (l && l.id !== undefined) kids.push(h('div', { class: 'tiny' }, h('span', { class: 'muted' }, '→ '), cardLink(l.id, str(l.title) || str(l.id))));
      kids.push(...el);
    }
    const b = bodyBlock(note.body); if (b) { kids.push(h('div', { class: 'sub' }, 'Body')); kids.push(b); }
    setBox(noteBox, kids);
  }
  function showGhost(c) {
    const d = c.dept;
    setBox(noteBox,
      h('div', { style: 'font-weight:600;color:#fff;margin-bottom:6px' }, h('span', { class: 'lock' }, '\u{1F512} '), 'Restricted'),
      h('div', { class: 'yaml' }, h('b', null, 'area:'), ' ', d ? d.name : 'Company core', d && d.ownerName ? ['\n', h('b', null, 'owner:'), ' ', d.ownerName] : null, '\n', h('b', null, 'access:'), ' not open to your role'),
      h('div', { class: 'tiny muted', style: 'margin-top:8px' }, 'Title and content stay hidden. ' + (d && d.ownerName ? `Ask ${d.ownerName} if you need it.` : '')));
  }
  function showSegment(p) {
    setBox(noteBox,
      h('div', { style: 'font-weight:600;color:#fff;margin-bottom:6px' }, h('span', { class: 'lock' }, '\u{1F512} '), `Personal space · ${p.name}`),
      h('div', { class: 'muted' }, `Only ${p.name} can open these notes. Nobody else sees them, not even the CEO.`));
  }

  // ---------- side panel: ask ----------
  const ansBox = $('#ans'), askForm = $('#askform'), qInput = $('#q');
  askForm.addEventListener('submit', (e) => { e.preventDefault(); ask(qInput.value); });
  async function ask(q) {
    q = str(q).trim(); if (!q) return;
    state.lastQ = q;
    const seq = ++state.askSeq;
    const btn = askForm.querySelector('button'); btn.disabled = true; askForm.classList.add('busy');
    setBox(ansBox, stepper(true), h('div', { class: 'muted tiny', style: 'margin-top:8px' }, 'Searching what ' + (viewerName() || 'you') + ' may read…'));
    state.cited = new Set(); state.winners = new Set(); state.fwLit = new Map(); requestDraw();
    let pk = null, err = null;
    try { pk = await getJSON('/api/ask', { ...ident(), q }, 90000); } catch (e) { err = e; }
    if (seq !== state.askSeq) return;
    btn.disabled = false; askForm.classList.remove('busy');
    if (!pk) { setBox(ansBox, h('div', { class: 'flag' }, `Ask failed: ${err ? err.message : 'unknown error'}`)); return; }
    renderAsk(pk, seq);
  }
  // tiny markdown: **bold** and [note-id] -> link to the card (only ids the viewer can already see)
  function richText(t) {
    const p = h('p', null), re = /\*\*([^*]+)\*\*|\[([A-Za-z0-9_.:-]+)\]/g;
    let last = 0, m;
    while ((m = re.exec(t))) {
      p.append(t.slice(last, m.index));
      if (m[1] !== undefined) p.append(h('b', null, m[1]));
      else if (state.G && state.G.byId.has(m[2])) p.append(cardLink(m[2], '↗'));
      else p.append(m[0]);
      last = re.lastIndex;
    }
    p.append(t.slice(last));
    return p;
  }
  function stepper(loading) {
    const names = ['Search', 'Access', 'Whose word wins', 'Answer'];
    return h('div', { class: 'steps' + (loading ? ' loading' : '') }, names.map((n, i) => h('span', { class: 'step', style: `animation-delay:${i * 0.6}s` }, h('i', null, String(i + 1)), n)));
  }
  // compact answer card: headline · <=3 points · conflict line · source chips · framework chips (reads pk.brief, or pk.card)
  function briefCard(pk, rag, hitTitle) {
    const b = pk && (pk.brief || pk.card || (rag && (rag.brief || rag.card)));
    if (!b || typeof b !== 'object') return null;
    const head = str(b.headline || b.answer || b.title).trim();
    if (!head) return null;
    const pts = (Array.isArray(b.points) ? b.points : Array.isArray(b.bullets) ? b.bullets : []).map((x) => str(x && x.text || x).trim()).filter(Boolean).slice(0, 3);
    const conf = str(b.conflict && typeof b.conflict === 'object' ? b.conflict.text : b.conflict).trim();
    const srcs = (Array.isArray(b.sources) ? b.sources : []).map((x) => (x && typeof x === 'object') ? { id: str(x.id), title: str(x.title) } : { id: str(x), title: '' }).filter((x) => x.id).filter((x, i, a) => a.findIndex((y) => (y.title || y.id) === (x.title || x.id)) === i).slice(0, 4);
    const fwRaw = Array.isArray(pk.frameworks) ? pk.frameworks : Array.isArray(b.frameworks) ? b.frameworks : (rag && Array.isArray(rag.frameworks)) ? rag.frameworks : [];
    const fws = fwRaw.map((f) => ({ title: str(f && typeof f === 'object' ? f.title || f.path : f).replace(/^./, (x) => x.toUpperCase()) })).filter((f) => f.title);
    const el = h('div', { class: 'answer acard' }, h('div', { class: 'ahead' }, richText(head)));
    if (pts.length) el.append(h('ul', { class: 'apts' }, pts.map((t) => h('li', null, richText(t)))));
    if (conf) el.append(h('div', { class: 'aconf' }, '\u26A0 ', conf));
    if (srcs.length) el.append(h('div', { class: 'achips' }, srcs.map((x) => { const c = state.G && state.G.byId.get(x.id); return h('span', { class: 'chip src' }, cardLink(x.id, x.title || (c && c.title) || hitTitle.get(x.id) || x.id)); })));
    if (fws.length) el.append(h('div', { class: 'achips fwchips' }, fws.map((f) => h('span', { class: 'chip fwc' }, f.title))));
    return { el, ids: srcs.map((x) => x.id), fws };
  }
  function renderAsk(pk, seq) {
    const kids = [stepper(false)];
    const rag = pk.rag && typeof pk.rag === 'object' ? pk.rag : null;
    const hits0 = Array.isArray(pk.hits) ? pk.hits : [];
    const hitTitle = new Map(hits0.map((x) => [str(x && x.id), str(x && x.title)]));
    const later = (sec, el) => { el.classList.add('later'); el.style.animationDelay = sec + 's'; return el; };
    kids.push(later(0.2, h('div', { class: 'tiny muted stepnote' }, `Search found ${hits0.length} note${hits0.length === 1 ? '' : 's'}; access check kept only what ${viewerName() || 'this viewer'} may read.`)));
    const bc = briefCard(pk, rag, hitTitle);
    if (bc) kids.push(later(1.8, bc.el));
    else if (rag && str(rag.text).trim()) {
      const card = h('div', { class: 'answer' }, h('div', { class: 'sub', style: 'margin-top:0' }, 'Answer'));
      for (const para of str(rag.text).trim().split(/\n{2,}/)) card.append(richText(para.trim()));
      const cited = Array.isArray(rag.cited) ? rag.cited.map(str) : [];
      if (cited.length) {
        card.append(h('div', { class: 'sub' }, 'Cited'));
        const ul = h('ul', { class: 'cites' });
        for (const id of cited) { const c = state.G && state.G.byId.get(id); ul.append(h('li', null, cardLink(id, (c && c.title) || hitTitle.get(id) || id), c ? h('span', { class: 'muted tiny' }, ' · ' + areaLabel(c)) : null)); }
        card.append(ul);
      }
      const fws = Array.isArray(rag.frameworks) ? rag.frameworks : [];
      if (fws.length) {
        card.append(h('div', { class: 'sub fwsub' }, 'From the MBA Brain'));
        for (const f of fws) card.append(h('div', { class: 'fw' }, h('b', null, str(f && f.title).replace(/^./, (x) => x.toUpperCase()))));
      }
      kids.push(later(1.8, card));
    } else {
      const summary = str(pk.summary).trim();
      if (summary) kids.push(later(1.8, h('p', { class: 'answer' }, summary)));
    }
    const res = Array.isArray(pk.resolutions) ? pk.resolutions : [];
    for (const r of res) {
      if (!r) continue;
      const key = Array.isArray(r.key) ? r.key.filter(Boolean).join(' · ') : str(r.key);
      const w = r.winner || {};
      const box = h('div', { class: 'res' },
        h('div', { class: 'key' }, key),
        h('div', { class: 'win' }, h('b', null, str(w.value) || str(w.title)), ' ', h('span', { class: 'muted' }, '· ', w.date ? fmtDate(w.date) : 'undated', w.author_name ? ' · ' + w.author_name : ''), ' ', w.id ? cardLink(w.id, '↗') : null),
        r.reason ? h('div', { class: 'why' }, str(r.reason)) : null);
      for (const sp of Array.isArray(r.superseded) ? r.superseded : []) {
        if (!sp) continue;
        box.append(h('div', { class: 'sup' }, `${str(sp.value) || str(sp.title)} · ${sp.date ? fmtDate(sp.date) : 'undated'} `, sp.id ? cardLink(sp.id, '↗') : null));
      }
      for (const cf of Array.isArray(r.conflicts) ? r.conflicts : []) {
        if (!cf) continue;
        const ch = state.G && state.G.byId.get(str(cf.challenger));
        box.append(h('div', { class: 'flag' },
          h('b', null, 'Conflict'), cf.severity ? ` (${cf.severity})` : '', ': ',
          cf.challenger ? cardLink(cf.challenger, ch ? ch.title : str(cf.challenger)) : '', ' ',
          cf.reason ? h('div', { class: 'tiny' }, str(cf.reason)) : null,
          cf.route_to ? h('div', { class: 'tiny muted' }, `Sent to ${personName(cf.route_to)}`) : null));
      }
      kids.push(later(1.2, box));
    }
    for (const t of Array.isArray(pk.hints) ? pk.hints : []) kids.push(later(1.8, h('div', { class: 'hint' }, '\u{1F4A1} ' + str(t))));
    const hits = Array.isArray(pk.hits) ? pk.hits : [];
    state.cited = new Set(hits.map((x) => str(x && x.id)).filter((id) => state.G && state.G.byId.has(id)));
    if (hits.length) {
      kids.push(h('div', { class: 'sub' }, `Sources (${hits.length})`));
      const ul = h('ul', { class: 'cites' });
      for (const x of hits) {
        if (!x) continue;
        ul.append(h('li', null, cardLink(x.id, str(x.title) || str(x.id)), ' ',
          h('span', { class: 'muted tiny' }, [x.date ? fmtDate(x.date) : '', x.author ? personName(x.author) : ''].filter(Boolean).join(' · ')),
          x.via && x.via !== 'match' ? h('span', { class: 'via' }, ` (${str(x.via).replace('hop:', 'via ')})`) : null));
      }
      kids.push(ul);
    }
    if (kids.length < 3) kids.push(h('span', { class: 'muted' }, 'No readable answer found.'));
    setBox(ansBox, kids);
    state.askT0 = performance.now();
    if (bc) for (const id of bc.ids) if (state.G && state.G.byId.has(id)) state.cited.add(id);
    if (rag && Array.isArray(rag.cited)) for (const id of rag.cited) if (state.G && state.G.byId.has(str(id))) state.cited.add(str(id));
    setTimeout(() => {               // whose word wins: winners glow amber
      if (seq !== state.askSeq) return;
      state.winners = new Set(res.map((r) => str(r && r.winner && r.winner.id)).filter(Boolean)); state.askT0 = performance.now(); requestDraw();
    }, 1200);
    setTimeout(() => { if (seq === state.askSeq) litFrameworks(bc ? bc.fws : rag && rag.frameworks); }, 1800);
    requestDraw();
  }

  // ---------- roles ----------
  // Signed view links fix one viewer. A switcher is only possible between links the opener already holds:
  // #personas=<base64url JSON [{name, title, url}]> (never sent to the server). Each switch loads that link's own API.
  let PERSONAS = [];
  try {
    const m = /(?:^#|&)personas=([^&]+)/.exec(location.hash);
    if (m) PERSONAS = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))))).filter((p) => p && p.url && p.name);
  } catch { PERSONAS = []; }
  // only the /v/<token> path of each link is used, always against this page's own origin
  const viewPrefix = (u) => { try { const x = new URL(u, location.href); return (/^\/v\/[^/]+/.exec(x.pathname) || [''])[0]; } catch { return ''; } };
  // the token's first part is base64url("org|person|expiry"): the person id, nothing secret
  const tokenPerson = (pre) => { try { const t = pre.slice(3).split('.')[0]; return atob(t.replace(/-/g, '+').replace(/_/g, '/')).split('|')[1] || ''; } catch { return ''; } };
  PERSONAS = PERSONAS.filter((p) => viewPrefix(p.url)).map((p) => ({ ...p, pid: tokenPerson(viewPrefix(p.url)) }));
  // Viewer V = this frame's own link (normally PERSONAS[0]). Previewing P never loads P's notes: the page keeps
  // V's own graph and only learns P's departments and grants (V's /api/person?id=P), then greys what P can't read.
  function renderPersonas() {
    const box = $('#roles');
    box.hidden = false;
    const cur = state.preview ? state.preview.persona : null;
    box.replaceChildren(h('span', { class: 'lbl' }, 'Preview as'), ...PERSONAS.map((p, i) => {
      const on = cur ? cur === p : i === 0;
      const first = p.name.split(' ')[0];
      const b = h('button', { type: 'button', title: `${p.name}${p.title ? ', ' + p.title : ''}`, 'aria-pressed': String(on) }, i === 0 ? `${first} (you)` : first);
      if (on) b.classList.add('on');
      b.onclick = () => setPreview(i === 0 ? null : p);
      return b;
    }));
  }
  let previewSeq = 0;
  async function setPreview(p) {
    const seq = ++previewSeq;
    if (!p) {
      if (!state.preview) return;
      state.preview = null;
    } else {
      if (state.preview && state.preview.persona === p) return;
      let prof = null;
      try { prof = await getJSON('/api/person', { ...ident(), id: p.pid }); } catch { prof = null; }
      if (seq !== previewSeq) return;
      const groups = new Set(prof && Array.isArray(prof.groups) ? prof.groups.map(str) : (p.dept ? [str(p.dept)] : []));
      state.preview = { persona: p, pid: p.pid, name: str(prof && prof.name) || p.name, title: str(prof && prof.title) || str(p.title), groups };
    }
    renderPersonas();
    state.selected = null; state.hover = null; state.cited = new Set(); state.winners = new Set(); state.pulses = [];
    ++state.askSeq; ++state.noteSeq; director.cancel(); closeDrop();
    noteBox.replaceChildren(h('span', { class: 'muted' }, EMPTY.note));
    applyPreviewUI();
    if (state.G) { relayout(); setTitle(); }
    requestDraw();
  }
  function applyPreviewUI() {
    const P = state.preview, btn = askForm.querySelector('button');
    qInput.disabled = !!P; btn.disabled = !!P; askForm.classList.remove('busy');
    document.body.classList.toggle('previewing', !!P);
    if (P) ansBox.replaceChildren(h('div', { class: 'pvhint' }, h('b', null, `Previewing ${P.name.split(' ')[0]}`), ' · ask as yourself'),
      h('div', { class: 'muted' }, `Greyed sections are ones ${P.name.split(' ')[0]} can't read. Only your own notes are ever drawn; switch back to yourself to ask or add files.`));
    else ansBox.replaceChildren(h('span', { class: 'muted' }, EMPTY.ans));
  }
  // ---------- who can read which cell (docs/design.md "Access model v2") ----------
  function previewReads(d) {           // dept internal readable for the previewed person?
    const P = state.preview; if (!P) return d.open;
    if (d.synthetic) return d.open;
    return P.groups.has(d.id) || P.groups.has('grant:' + d.id) || str(d.owner) === P.pid;
  }
  function cellState(d, ring) {         // 'show' | 'ponly' (P may read, V not: decoration only) | 'grey'
    if (ring === 1) return 'show';
    if (ring === 2) { const p = previewReads(d); return p && d.open ? 'show' : p ? 'ponly' : 'grey'; }
    return 'grey';
  }
  function isSubject(p) { return state.preview ? p.person === state.preview.pid : p.mine; }
  function slotW(p) { return isSubject(p) ? 3.5 : 1; }
  function personalState(p) { return state.preview ? (p.person === state.preview.pid ? 'plit' : 'grey') : p.mine ? 'show' : 'grey'; }
  function subjectDept() { const G = state.G; if (!G) return null; const p = G.personals.find(isSubject); return p ? p.dept : null; }
  function cardVisible(c) {
    const P = state.preview; if (!P) return true;
    if (c.layer === 'private' || c.priv) return false;
    if (c.layer === 'dept' && c.dept) {
      if (cellState(c.dept, 2) !== 'show') return false;
      if (c.restricted && !c.dept.leads.includes(P.pid)) return false;
    }
    return true;
  }
  function renderRoles() {
    const box = $('#roles');
    if (VIEW && PERSONAS.length) { renderPersonas(); return; }
    if (TOKEN || !state.people.length) { box.hidden = true; return; }
    box.hidden = false;
    const label = (p) => { const first = str(p.name).split(' ')[0] || p.id; return p.title ? `${first} · ${p.title}` : first; };
    if (state.people.length <= 6) {
      box.replaceChildren(...state.people.map((p) => {
        const b = h('button', { type: 'button', title: `${p.name}${p.title ? ', ' + p.title : ''}`, 'aria-pressed': String(p.id === state.person) }, label(p));
        if (p.id === state.person) b.classList.add('on');
        b.onclick = () => switchPerson(p.id);
        return b;
      }));
    } else {
      const sel = h('select', { 'aria-label': 'View as' });
      for (const p of state.people) { const o = h('option', { value: p.id }, `${p.name}${p.title ? ' · ' + p.title : ''}`); if (p.id === state.person) o.selected = true; sel.append(o); }
      sel.onchange = () => switchPerson(sel.value);
      box.replaceChildren(h('span', { class: 'lbl' }, 'View as'), sel);
    }
  }
  async function switchPerson(id) {
    if (id === state.person) return;
    state.person = id;
    const u = new URL(location.href); u.searchParams.set('person', id); history.replaceState(null, '', u);
    renderRoles();
    state.G = null; state.expanded.clear(); state.selected = null; state.hover = null; state.cited = new Set(); state.pulses = []; state.fwLit = new Map(); state.winners = new Set();
    ++state.askSeq; ++state.noteSeq;
    askForm.querySelector('button').disabled = false;
    $('#title').firstChild.nodeValue = 'Company Brain ';
    $('#subtitle').textContent = '';
    draw();
    noteBox.replaceChildren(h('span', { class: 'muted' }, EMPTY.note));
    ansBox.replaceChildren(h('span', { class: 'muted' }, EMPTY.ans));
    if (await loadGraph() && state.person === id && state.lastQ) ask(state.lastQ);
  }

  // ---------- loading ----------
  const statusEl = $('#status');
  function setStatus(msg, isErr, retry) {
    if (!msg) { statusEl.hidden = true; return; }
    statusEl.hidden = false; statusEl.classList.toggle('err', !!isErr);
    statusEl.replaceChildren(h('div', null, msg), retry ? h('button', { type: 'button', onclick: retry }, 'Retry') : null);
  }
  async function loadGraph() {
    const seq = ++state.graphSeq;
    setStatus('Loading the brain…');
    let g;
    try { g = await getJSON('/api/graph', ident()); }
    catch (e) {
      if (seq !== state.graphSeq) return;
      setStatus(e.status === 404 ? 'This person or link is not known to the brain.' : `Could not load the graph: ${e.message}${API ? '' : ' (open the page from the brain server, or add ?api=<server url>)'}`, true, loadGraph);
      return false;
    }
    if (seq !== state.graphSeq) return false;
    try {
      state.G = normalise(g);
      layout();
    } catch (e) {
      state.G = null; draw();
      console.error(e); setStatus('The graph data could not be laid out: ' + e.message, true); return false;
    }
    retarget(null, null, null);
    loadTitles(seq);
    setTitle();
    setStatus(state.G.cards.length ? '' : 'No notes yet. Drop a file here to add the first one.');
    fitView(false);
    state.since = new Date().toISOString();
    if (state.view === 'how' && window.HowFlow) { try { window.HowFlow.mount(howEl, howStats()); } catch (e) { console.warn(e); } }
    return true;
  }
  const titleOf = new Map();
  async function loadTitles(seq) {
    const G = state.G; if (!G) return;
    const todo = G.personals.filter((p) => p.person && !titleOf.has(API + '|' + p.person));
    await Promise.all(todo.map((p) => getJSON('/api/person', { ...ident(), id: p.person }).then((x) => titleOf.set(API + '|' + p.person, str(x && x.title))).catch(() => {})));
    if (seq !== state.graphSeq || state.G !== G) return;
    applyTitles(G); requestDraw();
  }
  function applyTitles(G) {
    for (const d of G.depts) {
      const t = (p) => titleOf.get(API + '|' + p.person) || '';
      // label: the person titled "Head of <this department>", else the data's first lead (export owner = leads[0])
      const heads = d.personals.filter((p) => normT(t(p)).startsWith('head of ' + normT(d.name)));
      const tls = d.personals.filter((p) => /^team lead/i.test(t(p)));
      d.leads = [...new Set(d.leads.concat([...heads, ...tls].map((p) => p.person)))];
      const first = d.owner ? personName(str(d.owner)) : '';
      d.leadNames = heads.length ? heads.map((p) => p.name) : first ? [first] : d.leadNames;
    }
  }
  function setTitle() {
    const G = state.G; if (!G) return;
    const notes = G.cards.length, me = G.personals.find((p) => p.mine);
    $('#title').firstChild.nodeValue = `${G.company || 'Company'} Brain `;
    const who = TOKEN ? (me ? me.name : '') : personName(state.person);
    $('#subtitle').textContent = (who ? `· viewing as ${who}${me && !me.dept.synthetic ? ', ' + me.dept.name : ''}` : '') + ` · ${notes} note${notes === 1 ? '' : 's'} you can open`;
    document.title = who ? `${who} · Company Brain` : `${G.company || 'Company'} Brain`;
    if (!state.preview) renderViewer(me, who);
    const n = state.cloudOK ? (window.MBACloud.titles() || []).length : G.halo ? G.halo.dots.length : 0;
    $('#halocap').hidden = !n;
    $('#halocap').replaceChildren(h('i'), h('span', null, h('b', null, 'MBA Brain'), ` · ${FW_TOTAL.n.toLocaleString('en-US')} business frameworks everyone has${state.cloudOK ? ', behind the company' : ', outer ring'}`));
    const P = state.preview, emb = document.body.classList.contains('embedded');
    if (emb) $('#title').firstChild.nodeValue = '';            // the app's header already names the company
    if (P && emb) $('#subtitle').textContent = `Previewing ${P.name.split(' ')[0]} · grey = ${P.name.split(' ')[0]} can't read`;
    if (P) {
      if (!emb) $('#subtitle').textContent = `· previewing as ${P.name}${P.title ? ', ' + P.title : ''} · grey = ${P.name.split(' ')[0]} can't read`;
      viewerEl.hidden = false; viewerEl.style.setProperty('--vc', '#8b8d91');
      viewerEl.replaceChildren(h('span', { class: 'v-av' }, initials(P.name)), h('span', { class: 'v-txt' }, h('b', null, P.name), h('small', null, ['Preview', P.title].filter(Boolean).join(' · '))));
    }
  }

  // ---------- who is looking: a big badge so every persona tab is unmistakable ----------
  const viewerEl = $('#viewer'); let viewerFor = null;
  async function renderViewer(me, who) {
    if (!viewerEl) return;
    if (!who) { viewerEl.hidden = true; return; }
    const pid = (me && me.person) || state.person || '', dept = me && !me.dept.synthetic ? me.dept : null;
    const lead = dept && dept.leads.includes(pid);
    const paint = (title) => {
      viewerEl.hidden = false;
      viewerEl.style.setProperty('--vc', dept ? dept.color : '#a882ff');
      viewerEl.replaceChildren(h('span', { class: 'v-av' }, initials(who)),
        h('span', { class: 'v-txt' }, h('b', null, who), h('small', null, [title, dept ? dept.name : '', lead ? 'department lead' : ''].filter(Boolean).join(' · '))));
    };
    const key = API + '|' + pid;
    if (viewerFor && viewerFor.key === key) { paint(viewerFor.title); return; }
    paint('');
    let title = '';
    try { const p = await getJSON('/api/person', { ...ident(), id: pid }); title = str(p && p.title); } catch { /* name alone is fine */ }
    viewerFor = { key, title };
    if (key === API + '|' + ((state.G && (state.G.personals.find((x) => x.mine) || {}).person) || state.person || '')) paint(title);
  }

  // ---------- toasts ----------
  const toastBox = $('#toasts');
  function toast(text, color, ms) {
    const el = h('div', { class: 'toast' }, h('span', { class: 'dot', style: `background:${color || '#a882ff'}` }), h('span', null, text));
    toastBox.append(el);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, ms || 6500);
    return el;
  }
  function placeName(c) {
    if (c.layer === 'private') return c.sec.seg ? `${c.sec.seg.mine ? 'Your' : c.sec.seg.name + "'s"} private space` : 'Private';
    if (c.layer === 'core') return 'Company core';
    return `${c.dept ? c.dept.name : ''} ${c.layer === 'dept-core' ? 'core' : 'internal'}${c.restricted ? ' · department leads only' : ''}`.trim();
  }

  // extracted facts arrive in bursts: one quiet toast at most every 8 s
  const factQ = new Map(); let factT = 0, factTimer = null;
  function flushFacts() {
    if (!factQ.size) return;
    const wait = factT + 8000 - performance.now();
    if (wait > 0) { clearTimeout(factTimer); factTimer = setTimeout(flushFacts, wait); return; }
    const total = [...factQ.values()].reduce((a, b) => a + b, 0), top = [...factQ.entries()].sort((a, b) => b[1] - a[1])[0];
    toast(factQ.size === 1 ? `${total} fact${total === 1 ? '' : 's'} extracted from '${top[0]}'` : `${total} facts extracted from ${factQ.size} documents`, '#7fd0ff', 4500);
    factQ.clear(); factT = performance.now();
  }

  // camera director: when a document lands or a note is promoted, glide in so the title is readable, then back out
  const DIRECT = Q.get('director') !== '0';
  const director = {
    t: null, until: 0,
    busy() { return performance.now() < this.until; },
    cancel() { clearTimeout(this.t); this.t = null; this.until = 0; },
    show(c, from) {
      if (!DIRECT || !c || c.x === undefined && !c.host) return;
      if (state.userT && performance.now() - state.userT < 8000) return;
      const P = c.tx !== undefined ? { x: c.tx, y: c.ty } : (c.host || c);
      let cx = P.x, cy = P.y, s = Math.max(1.05, fitScale() * 2.2);
      if (from && from.x !== undefined) {           // promotion: frame where it was and where it lands
        cx = (from.x + P.x) / 2; cy = (from.y + P.y) / 2;
        s = Math.min(1.1, Math.max(fitScale() * 1.4, Math.min((state.W - 160) / (Math.abs(from.x - P.x) + CW * 3), (state.H - 200) / (Math.abs(from.y - P.y) + CH * 6))));
      }
      clearTimeout(this.t); this.until = performance.now() + 6500;
      if (!flowEl.hidden && !flowEl.classList.contains('fl-mini')) cx -= (flowEl.offsetWidth / 2 + 20) / s;   // keep the landing spot clear of the ingestion panel
      setCam(s, cx, cy, true, 900);
      this.t = setTimeout(() => { this.t = null; if (!(state.userT && performance.now() - state.userT < 6000)) fitView('slow'); }, 6000);
    },
  };

  // ---------- live: poll for changes, diff the graph, animate what is new or moved ----------
  let refreshing = false, pollTimer = null, changesMode = 'changes', pollN = 0;
  const sig = (G) => G.cards.map((c) => c.id + '@' + c.sec.key).sort().join('|');
  async function refreshGraph(force) {
    if (refreshing || !state.G || (state.flowHold && !force)) return;
    refreshing = true;
    try {
      const seq = state.graphSeq, person = state.person;
      let g; try { g = await getJSON('/api/graph', ident()); } catch { return; }
      if (seq !== state.graphSeq || person !== state.person || !state.G) return;
      const old = state.G, G = normalise(g);
      if (sig(old) === sig(G)) return;
      applyTitles(G);
      const prev = positions();
      const was = new Map(old.cards.map((c) => { const P = c.x !== undefined ? c : c.host; return [c.id, { sec: c.sec.key, layer: c.layer, dept: c.dept, x: P ? P.x : undefined, y: P ? P.y : undefined }]; }));
      state.G = G; state.hover = null;
      if (state.selected) state.selected = G.byId.get(state.selected.id) || null;
      layout();
      const fresh = new Set(), moved = new Set();
      for (const c of G.cards) { const o = was.get(c.id); if (!o) fresh.add(c.id); else if (o.sec !== c.sec.key) moved.add(c.id); }
      // a card whose old place was hidden in "+N more" still flies from its last drawn spot
      for (const id of moved) { const o = was.get(id); if (o.x !== undefined) prev.set(id, [o.x, o.y]); }
      retarget(prev, fresh, moved);
      const docs = [...fresh].map((id) => G.byId.get(id)).filter((c) => !c.src);
      const facts = [...fresh].map((id) => G.byId.get(id)).filter((c) => c.src);
      if (!director.busy() && Math.abs(G.Rmax - old.Rmax) / old.Rmax > 0.06) fitView(true);
      let n = 0;
      for (const c of docs) {
        if (c.id === state.flowId) continue;        // the ingestion panel already tells this story
        if (++n > 2) { toast(`${docs.length - 2} more new documents`, '#a882ff'); break; }
        const by = c.n.author ? ` · from ${personName(str(c.n.author))}` : '';
        toast(`${placeName(c)}: '${c.title}' just arrived${by}`, c.priv ? '#ffffff' : c.color);
      }
      for (const c of facts) { const k = c.src.title; factQ.set(k, (factQ.get(k) || 0) + 1); }
      flushFacts();
      const focus = moved.size ? [...moved].map((id) => G.byId.get(id)) : docs;
      if (focus.length) director.show(focus[0], moved.size ? was.get(focus[0].id) : null);
      for (const id of moved) {
        const c = G.byId.get(id), o = was.get(id), m = c.moved.length ? c.moved[c.moved.length - 1] : null;
        const from = o.dept ? o.dept.name : 'Company core';
        const who = m && m.by ? personName(str(m.by)) : '';
        const verb = c.layer === 'core' || c.layer === 'dept-core' ? 'approved by' : 'by';
        toast(`${from}: '${c.title}' → ${LAYER_LABEL[c.layer] || c.layer}${who ? `, ${verb} ${who}` : ''}`, '#ffb547', 8000);
      }
      setTitle();
    } finally { refreshing = false; }
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (state.G && !document.hidden) {
      if (changesMode === 'changes') {
        try {
          const r = await getJSON('/api/changes', { ...ident(), since: state.since || new Date().toISOString() });
          const list = Array.isArray(r) ? r : Array.isArray(r && r.changes) ? r.changes : [];
          let next = r && !Array.isArray(r) && typeof (r.now || r.until) === 'string' ? (r.now || r.until) : '';
          if (!next && list.length) next = list.map((x) => str(x && (x.at || x.time))).filter(Boolean).sort().pop() || '';
          if (next) state.since = next;
          // full re-sync every ~8 s too: notes that vanished (e.g. a data restore) never show up in the feed
          if (list.length || ++pollN % 7 === 0) await refreshGraph();
        } catch (e) { if (e.status === 404 || e.status === 405) changesMode = 'graph'; }
      } else await refreshGraph();
    }
    pollTimer = setTimeout(poll, changesMode === 'changes' ? 1200 : 5000);
  }

  // ---------- drop a file onto the brain ----------
  const left = $('#left'), dropMenu = $('#dropmenu');
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let dragOff = null;
  const dragOn = (e) => {
    if (!hasFiles(e)) return;
    if (state.preview || state.view !== 'brain') { e.preventDefault(); return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; left.classList.add('dropping');
    clearTimeout(dragOff); dragOff = setTimeout(() => left.classList.remove('dropping'), 400);   // no dragover for 400 ms = drag left the window
  };
  window.addEventListener('dragenter', dragOn);
  window.addEventListener('dragover', dragOn);
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); clearTimeout(dragOff); left.classList.remove('dropping');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !state.G) return;
    if (state.preview || state.view !== 'brain') { toast(state.preview ? 'Previewing: switch back to yourself to add files' : 'Switch to the Company Brain view to add files', '#8b8d91', 3500); return; }
    const r = left.getBoundingClientRect();
    const inLeft = e.clientX >= r.left && e.clientX <= r.right;
    if (FLOW) startFlow(f); else openDropMenu(f, inLeft ? e.clientX : r.left + r.width / 2, inLeft ? e.clientY : r.top + r.height / 2);
  });
  $('#addfile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (state.preview) return; if (f && FLOW && state.G) startFlow(f); else if (f) { const r = left.getBoundingClientRect(); openDropMenu(f, r.left + r.width / 2, r.top + r.height / 2); } });
  function myDept() { const me = state.G && state.G.personals.find((p) => p.mine); return me ? me.dept : null; }
  function openDropMenu(file, cx, cy) {
    const d = myDept(), r = left.getBoundingClientRect();
    const me = state.G && state.G.personals.find((p) => p.mine);
    const lead = d && d.leads.includes((me && me.person) || state.person);
    const opts = [
      ['private', 'Private', 'only you can read it'],
      ['dept', 'My department', d ? `${d.name} team` : 'your team'],
      ['dept-core', 'Department core', lead ? 'everyone can read it' : 'everyone · leads only'],
      ['core', 'Company core', 'everyone · owners and leads'],
    ];
    dropMenu.replaceChildren(
      h('div', { class: 'dm-title' }, 'Where does it go?'),
      h('div', { class: 'dm-file' }, file.name),
      ...opts.map(([layer, label, sub]) => h('button', { type: 'button', class: 'dm-opt', 'data-layer': layer, onclick: () => { closeDrop(); upload(file, layer); } },
        h('span', { class: 'dm-ring r-' + layer }), h('span', null, h('b', null, label), h('small', null, sub)))),
      h('button', { type: 'button', class: 'dm-cancel', onclick: closeDrop }, 'Cancel'));
    dropMenu.hidden = false;
    const w = 280, hgt = 300;
    dropMenu.style.left = Math.max(12, Math.min(r.width - w - 12, cx - r.left - w / 2)) + 'px';
    dropMenu.style.top = Math.max(60, Math.min(r.height - hgt - 12, cy - r.top - 40)) + 'px';
  }
  function closeDrop() { dropMenu.hidden = true; }
  async function upload(file, layer) {
    const d = myDept();
    const t = toast(`Adding '${file.name}' to ${LAYER_LABEL[layer]}…`, '#8b8d91', 4000);
    const fd = new FormData(); fd.append('file', file); fd.append('layer', layer);
    if (!VIEW && !TOKEN && state.person) fd.append('person', state.person);
    const qs = new URLSearchParams(ident()).toString();
    let res;
    try { res = await fetch(`${API}/api/upload${qs ? '?' + qs : ''}`, { method: 'POST', body: fd, redirect: 'error' }); }
    catch { t.remove(); toast('Could not reach the brain to upload.', '#ff5c6c'); return; }
    t.remove();
    if (res.status === 403) {
      const leads = d && d.leadNames.length ? d.leadNames.join(' or ') : 'a lead';
      toast(layer === 'core' ? `Only owners, admins or a department lead can put files straight into the company core. Add it to your department and ask ${leads} to promote it.`
        : `Only a lead of ${d ? d.name : 'your department'} can publish to the department core. Add it to your department and ask ${leads} to promote it.`, '#ffb547', 9000);
      return;
    }
    if (res.status === 404 || res.status === 405) { toast('Uploading is not switched on for this server yet.', '#ff5c6c'); return; }
    if (!res.ok) { toast(`Upload failed (HTTP ${res.status}).`, '#ff5c6c'); return; }
    await refreshGraph();
  }

  // ---------- ingestion flow: a dropped file walks through the pipeline, step by step, then really lands ----------
  // ?flow=0 turns it off (old "where does it go?" menu); ?flowlayer=<private|dept|dept-core|core> picks the upload layer.
  const FLOW = Q.get('flow') !== '0';
  const flowEl = $('#flow');
  const TYPES = { pdf: 'PDF document', docx: 'Word document', doc: 'Word document', pptx: 'PowerPoint slides', xlsx: 'Excel workbook', csv: 'Spreadsheet (CSV)',
    md: 'Markdown note', txt: 'Plain text', eml: 'E-mail', mbox: 'Mailbox', html: 'Web page', htm: 'Web page', vtt: 'Meeting transcript', transcript: 'Meeting transcript', json: 'Data (JSON)' };
  const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let flowSeq = 0;
  function closeFlow() { ++flowSeq; flowEl.hidden = true; left.classList.remove('flowing'); if (state.flowHold) { state.flowHold = false; refreshGraph(true); } }
  async function startFlow(file) {
    const seq = ++flowSeq;
    closeDrop();
    const G = state.G, me = G.personals.find((p) => p.mine), dept = me && !me.dept.synthetic ? me.dept : null;
    const who = viewerName() || 'you', myId = (me && me.person) || state.person || '';
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name) || [, ''])[1].toLowerCase();
    const type = TYPES[ext] || (file.type ? file.type : 'Document');
    state.flowHold = true;
    // Only the file goes up. Department, layer, access and who may read it are decided by the brain and come back in `suggested`.
    const fd = new FormData(); fd.append('file', file);
    if (!VIEW && !TOKEN && state.person) fd.append('person', state.person);
    const qs = new URLSearchParams(ident()).toString();
    const upP = fetch(`${API}/api/upload${qs ? '?' + qs : ''}`, { method: 'POST', body: fd, redirect: 'error' })
      .then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, status: 0, j: null }));
    const myTitleP = getJSON('/api/person', { ...ident(), id: myId }).then((x) => str(x && x.title)).catch(() => '');

    const rows = [];
    const step = (n, label) => {
      const el = h('div', { class: 'fl-step run' }, h('span', { class: 'fl-dot' }, String(n)), h('div', { class: 'fl-body' }, h('div', { class: 'fl-label' }, label), h('div', { class: 'fl-detail' })));
      list.append(el); rows.push(el); return el;
    };
    const wait = (el, msg) => el.querySelector('.fl-detail').replaceChildren(h('span', { class: 'muted' }, msg));
    const done = (el, ...detail) => { el.classList.remove('run'); el.classList.add('ok'); el.querySelector('.fl-dot').textContent = '✓'; el.querySelector('.fl-detail').replaceChildren(...detail.flat().filter(Boolean)); };
    const fail = (el, msg) => { el.classList.remove('run'); el.classList.add('bad'); el.querySelector('.fl-dot').textContent = '!'; el.querySelector('.fl-detail').replaceChildren(msg); };
    const x = h('button', { type: 'button', class: 'boxclose', title: 'Close (Esc)', 'aria-label': 'Close' }, '✕'); x.onclick = closeFlow;
    const list = h('div', { class: 'fl-list' });
    flowEl.style.setProperty('--fc', dept ? dept.color : '#a882ff');
    flowEl.replaceChildren(x, h('div', { class: 'fl-head' }, h('span', { class: 'fl-pulse' }), 'Ingesting into the company brain'), h('div', { class: 'fl-file' }, file.name), list);
    flowEl.classList.remove('fl-mini'); flowEl.hidden = false; left.classList.add('flowing');
    const live = () => seq === flowSeq;
    const PACE = 500;

    // steps 1-3 are local and real
    let el = step(1, 'File received'); await sleep(PACE); if (!live()) return;
    done(el, h('b', null, file.name), ` · ${fmtSize(file.size)}`);
    el = step(2, 'Type detected'); await sleep(PACE); if (!live()) return;
    done(el, h('b', null, type), ext ? ` · .${ext}` : '');
    el = step(3, 'Uploaded by'); const myTitle = await Promise.race([myTitleP, sleep(1500).then(() => '')]); if (!live()) return;
    done(el, h('b', null, who), myTitle ? ` · ${myTitle}` : '');

    // step 4 waits for the upload, then for the facts the brain really extracted
    const s4 = step(4, 'Read + classified'); wait(s4, 'Uploading and reading the document…');
    const up = await upP; if (!live()) return;
    const imp = up.ok && up.j && Array.isArray(up.j.imported) && up.j.imported[0];
    if (!imp) {
      const why = up.j && typeof up.j.error === 'string' ? up.j.error : '';
      fail(s4, up.status === 403 ? 'Not filed: you are not allowed to file this document.'
        : up.status === 429 ? 'Not filed: too many uploads, try again in a minute.'
        : up.status === 413 ? 'Not filed: the file is larger than 10 MB.'
        : up.status === 400 ? `Not filed: the brain could not take this file${why ? ' (' + why + ')' : ''}.`
        : `Not filed: upload failed${up.status ? ' (HTTP ' + up.status + ')' : ', the brain is not reachable'}.`);
      flowEl.querySelector('.fl-head').classList.add('bad');
      state.flowHold = false; refreshGraph(true); return;
    }
    const noteId = str(imp.id);
    wait(s4, 'Extracting key facts…');
    const factsP = (async () => {
      const t0 = Date.now(); let misses = 0;
      while (live() && Date.now() - t0 < 60000) {
        try {
          const r = await getJSON('/api/facts', { ...ident(), source: noteId });
          const fs = r && Array.isArray(r.facts) ? r.facts : [];
          if (fs.length) return fs;
          misses = 0;
        } catch (e) { if ((e.status === 404 || e.status === 405) && ++misses >= 3) return []; }   // route not there (older brain): stop asking
        await sleep(2000);
      }
      return [];
    })();
    factsP.then((fs) => {
      if (!live()) return;
      const line = (f) => [str(f && f.subject), str(f && f.attribute)].filter(Boolean).join(' · ') + (f && str(f.value) ? `: ${str(f.value)}` : '');
      const pts = fs.map(line).filter((t) => t.trim()).slice(0, 3);
      done(s4, pts.length ? h('ul', { class: 'fl-points' }, pts.map((t) => h('li', null, t))) : h('span', { class: 'muted' }, 'No facts extracted yet'));
    });

    // steps 5-6 come straight from the brain's suggestion
    const sg = up.j && up.j.suggested && typeof up.j.suggested === 'object' ? up.j.suggested : {};
    const dash = h('span', { class: 'muted' }, '—');
    const deptName = str(sg.department_name) || str(sg.department);
    const gd = G.depts.find((d) => (sg.department && d.id === str(sg.department)) || (deptName && normT(d.name) === normT(deptName)));
    if (gd && gd.color) flowEl.style.setProperty('--fc', gd.color);
    el = step(5, 'Department'); wait(el, 'Waiting for the brain…'); await sleep(PACE); if (!live()) return;
    const detName = str(sg.detected_department_name) || str(sg.detected_department);
    done(el, deptName ? h('span', { class: 'fl-chip dept' }, deptName) : dash,
      detName && normT(detName) !== normT(deptName) ? h('div', { class: 'fl-reason muted' }, `looks like ${detName} content · filed in your department`) : null);
    el = step(6, 'Access'); wait(el, 'Waiting for the brain…'); await sleep(PACE); if (!live()) return;
    const access = str(sg.access), layer = str(sg.layer);
    const names = Array.isArray(sg.allow_names) ? sg.allow_names.map(str).filter(Boolean) : [];
    const words = layer === 'private' ? 'Private · only you'
      : access === 'restricted' ? 'Restricted · only the people below'
      : access === 'area' ? `${deptName || 'Department'} team only`
      : access === 'all' ? 'Everyone in the company'
      : access ? access : '';
    done(el, words ? h('div', { class: 'fl-ring' }, words) : dash,
      str(sg.reason) ? h('div', { class: 'fl-reason muted' }, str(sg.reason)) : null,
      access === 'restricted' && names.length ? h('div', { class: 'fl-people' }, names.map((n) => h('span', { class: 'fl-chip yes' }, '✓ ', h('b', null, n)))) : null);

    el = step(7, 'Filed'); await sleep(PACE); if (!live()) return;
    state.flowHold = false; state.flowId = noteId;
    await refreshGraph(true); if (!live()) return;
    const c = state.G && state.G.byId.get(noteId);
    done(el, 'Now in ', h('b', null, c ? placeName(c) : (deptName || 'the brain')), ' · indexed for search and answers');
    if (c) { state.selected = c; state.pulses.push({ card: c, t0: performance.now(), d: 3000, color: '#4fd1a5' }); requestDraw(); }
    // the panel folds into a small "Filed" pill once the facts are in (or the wait is over)
    await factsP; await sleep(1600); if (!live()) return;
    flowEl.classList.add('fl-mini'); flowEl.querySelector('.fl-head').lastChild.nodeValue = 'Filed ✓';
    if (c) { state.userT = 0; director.show(c); state.pulses.push({ card: c, t0: performance.now() + 500, d: 3000, color: '#4fd1a5' }); requestDraw(); }
  }

  // ---------- MBA Brain list ----------
  async function loadFrameworks() {
    try {
      const res = await fetch('frameworks.json', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const fw = await res.json();
      if (fw && Array.isArray(fw.disciplines) && fw.disciplines.length) {
        state.fw = fw;
        if (state.G) { const lit = [...state.fwLit.values()].map((d) => ({ title: d.title })); relayout(); fitView(false); setTitle(); if (lit.length) litFrameworks(lit); }
      }
    } catch { /* placeholder stays */ }
  }

  // ---------- views: Company Brain + MBA Brain · MBA Brain only · How it works ----------
  const howEl = $('#howview'), fwEl = $('#fwview');
  function setView(v) {
    if (!['brain', 'mba', 'how'].includes(v) || v === state.view) return;
    const was = state.view; state.view = v;
    for (const b of document.querySelectorAll('#views button')) { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    document.body.classList.remove('v-brain', 'v-mba', 'v-how'); document.body.classList.add('v-' + v);
    if (was === 'how' && window.HowFlow) { try { window.HowFlow.unmount(); } catch (e) { console.warn(e); } }
    howEl.hidden = v !== 'how';
    if (v === 'how' && window.HowFlow) { try { window.HowFlow.mount(howEl, howStats()); } catch (e) { console.warn(e); } }
    // Frameworks view: FwView (web/viz/fw-view.js) draws in its own full-size layer above the cloud canvas
    if (was === 'mba' && window.FwView) { try { window.FwView.unmount(); } catch (e) { console.warn(e); } }
    fwEl.hidden = !(v === 'mba' && window.FwView);
    if (v === 'mba' && window.FwView) { try { window.FwView.mount(fwEl, { api: API }); } catch (e) { console.warn(e); } }
    if (v !== 'brain') { state.hover = null; closeDrop(); }
    if (v === 'mba') state.mcam = { s: 1, x: 0, y: 0 };
    $('#mbacap').hidden = v !== 'mba';
    resize();
    if (v === 'brain' && state.G) fitView(false);
    requestDraw();
  }
  for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => setView(b.dataset.v));
  // counts of what the viewer can read, for the How it works diagram
  function howStats() {
    const G = state.G; if (!G) return { docs: 0, facts: 0, people: 0, departments: 0 };
    const docs = G.cards.filter((c) => c.isDoc).length;
    return { docs, facts: G.cards.length - docs, people: G.personals.length, departments: G.depts.filter((d) => !d.synthetic).length };
  }
  // embedded in the app: the app's header tabs drive the view through the frame hash (#view=brain|frameworks|how&personas=…)
  const HASH_VIEW = { brain: 'brain', frameworks: 'mba', how: 'how' };
  function hashView() { try { return new URLSearchParams(location.hash.slice(1)).get('view'); } catch { return null; } }
  function applyHashView() {
    const hv = hashView(), embedded = window.top !== window || hv !== null;
    document.body.classList.toggle('embedded', embedded);
    if (hv !== null) setView(HASH_VIEW[hv] || 'brain');
    if (state.G) setTitle();
  }
  window.addEventListener('hashchange', applyHashView);
  applyHashView();
  // MBA Brain only: its own pan/zoom (captured before the brain's handlers)
  let mdrag = null;
  canvas.addEventListener('wheel', (e) => {
    if (state.view !== 'mba') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const r = canvas.getBoundingClientRect(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, m = state.mcam;
    const f0 = Math.exp(-dy * 0.0015), s1 = Math.max(0.5, Math.min(12, m.s * f0)), f = s1 / m.s;
    const px = e.clientX - r.left - state.W / 2, py = e.clientY - r.top - state.H / 2 - 30;
    m.x = px - (px - m.x) * f; m.y = py - (py - m.y) * f; m.s = s1; requestDraw();
  }, { passive: false, capture: true });
  canvas.addEventListener('pointerdown', (e) => { if (state.view !== 'mba') return; e.stopImmediatePropagation(); mdrag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); }, { capture: true });
  canvas.addEventListener('pointermove', (e) => {
    if (state.view !== 'mba') return; e.stopImmediatePropagation();
    if (mdrag) { state.mcam.x += e.clientX - mdrag.x; state.mcam.y += e.clientY - mdrag.y; mdrag.x = e.clientX; mdrag.y = e.clientY; requestDraw(); }
  }, { capture: true });
  canvas.addEventListener('pointerup', (e) => { if (state.view !== 'mba') return; e.stopImmediatePropagation(); mdrag = null; }, { capture: true });
  // the real MBA Brain total (the cloud only draws a sample); server count when available, else 1,012
  fetch(`${API}/api/frameworks/count`, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null))
    .then((x) => { const c = x && Number(x.count); if (c > 0) { FW_TOTAL.n = c; if (state.G) setTitle(); } }).catch(() => {});
  function loadCloud() {
    if (!window.MBACloud || typeof window.MBACloud.load !== 'function') return;
    window.MBACloud.load('viz/mba-graph.json').then(() => {
      state.cloudOK = true;
      const n = (window.MBACloud.titles() || []).length;
      $('#mbacap').replaceChildren(h('b', null, 'MBA Brain'), ` · ${FW_TOTAL.n.toLocaleString('en-US')} business frameworks everyone has · scroll to zoom, drag to move`);
      if (state.G) { relayout(); fitView(false); setTitle(); }
      requestDraw();
    }).catch((e) => console.warn('MBA Brain cloud not loaded', e));
  }

  async function boot() {
    loadCloud();
    resize();
    if (apiError) { setStatus(apiError, true); return; }
    if (!TOKEN) {
      try { state.people = await getJSON('/api/people'); }
      catch (e) {
        setStatus(e.status === 404 ? 'This server needs a personal link (?token=…).' : `Could not reach the brain server: ${e.message}${API ? '' : ' (open the page from the brain server, or add ?api=<server url>)'}`, true, () => location.reload());
        return;
      }
      if (!Array.isArray(state.people)) state.people = [];
      state.people = state.people.filter((p) => p && p.id !== undefined && p.id !== null).map((p) => ({ ...p, id: str(p.id), name: str(p.name) || str(p.id), title: str(p.title) }));
      state.peopleById = new Map(state.people.map((p) => [p.id, p]));
      if (!state.people.length) { setStatus('The brain has no people yet.', true); return; }
      const want = Q.get('person');
      state.person = state.peopleById.has(want) ? want : state.people[0].id;
      renderRoles();
    } else renderRoles();
    loadFrameworks();
    await loadGraph();
    pollTimer = setTimeout(poll, 2000);
    const q = Q.get('q'); if (q) { qInput.value = q; ask(q); }
  }

  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = Math.max(1, r.width), H = Math.max(1, r.height);
    const hadView = state.W > 0;
    const cx = hadView ? toWorld(state.W / 2, state.H / 2) : null;
    state.W = W; state.H = H; state.dpr = dpr;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (hadView && state.G) setCam(state.cam.s, cx[0], cx[1], false); else requestDraw();
  }
  new ResizeObserver(() => resize()).observe(canvas);
  (function watchDpr() {               // browser zoom changes devicePixelRatio: re-render at the new density
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', () => { resize(); watchDpr(); }, { once: true });
  })();

  // test/debug hook: read-only summary of the current layout
  window.__brain = {
    stats() {
      const G = state.G; if (!G) return null;
      const shown = G.cards.filter((c) => c.x !== undefined);
      let overlaps = 0;
      const all = shown.concat(G.extra), cell = new Map();
      for (const c of all) { const k = Math.floor(c.x / 120) + ',' + Math.floor(c.y / 40); (cell.get(k) || cell.set(k, []).get(k)).push(c); }
      for (const c of all) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const d of cell.get((Math.floor(c.x / 120) + i) + ',' + (Math.floor(c.y / 40) + j)) || []) if (d !== c && Math.abs(c.x - d.x) < CW && Math.abs(c.y - d.y) < CH) overlaps++;
      }
      return { cards: G.cards.length, shown: shown.length, more: G.extra.filter((e) => e.kind === 'more').reduce((s, e) => s + e.count, 0),
        overlaps: overlaps / 2, depts: G.depts.length, rings: G.rings, Rc: G.Rc, scale: state.cam.s, edges: G.edges.length };
    },
    timeLayout() { const t = performance.now(); layout(); return performance.now() - t; },
    timeDraw(n = 20) { const t = performance.now(); for (let i = 0; i < n; i++) draw(); return (performance.now() - t) / n; },
    moreCards() { return state.G.extra.filter((e) => e.kind === 'more').map((e) => { const [x, y] = toScreen(e.x, e.y); return { key: e.sec.key, count: e.count, x, y }; }); },
    sectors() {
      const G = state.G; if (!G) return null;
      return [...G.sectors.values()].map((s) => {
        const span = s.seg ? s.seg.a1 - s.seg.a0 : s.dept ? s.dept.a1 - s.dept.a0 : 0;
        const a0 = s.seg ? s.seg.a0 : s.dept ? s.dept.a0 : 0, rr = G.rings[s.ring];
        return { key: s.key, n: s.cards.length, placed: s.cards.filter((c) => c.x !== undefined).length,
          span: +span.toFixed(2), a0: +a0.toFixed(2), slotsAtMin: rr ? sectorSlots(rr[0] + RING_PAD, rr[0] + TMIN[s.ring || 1] - 3, a0, a0 + span).length : null };
      });
    },
    zoom(s) { setCam(s, ...toWorld(state.W / 2, state.H / 2), false); },
    focus(id) { focusCard(state.G.byId.get(id), true); },
    find(title) { const c = state.G && state.G.cards.find((x) => x.title === title); return c ? c.id : null; },
  };

  boot();
})();
