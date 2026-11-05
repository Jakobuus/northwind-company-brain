/* Frameworks view: interactive MBA Brain cloud. window.FwView = { mount(el, {api}), unmount() } */
(function () {
  var BASE = (document.currentScript && document.currentScript.src) || "";
  var DIR = BASE ? BASE.replace(/[^\/]*$/, "") : "/viz/";
  var st = null;

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function inline(s) {
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
      return /^(https?:|\/|#|mailto:)/i.test(u) ? '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + "</a>" : t;
    });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, function (m, a, b) { return "<strong>" + (a || b) + "</strong>"; });
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_]*)_/g, "$1<em>$2</em>");
    return s;
  }
  function md(src) {
    var lines = String(src || "").replace(/\r/g, "").split("\n"), out = [], para = [], list = null, i, m;
    function flushP() { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } }
    function flushL() { if (list) { out.push("</" + list + ">"); list = null; } }
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l.trim()) { flushP(); flushL(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { flushP(); flushL(); out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">"); continue; }
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(l))) { flushP(); if (list !== "ul") { flushL(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inline(m[1]) + "</li>"); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flushP(); if (list !== "ol") { flushL(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inline(m[1]) + "</li>"); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { flushP(); flushL(); out.push("<hr>"); continue; }
      flushL(); para.push(l.trim());
    }
    flushP(); flushL();
    return out.join("\n");
  }

  var CSS = ".fwv{position:absolute;inset:0;overflow:hidden;background:#0b0d12;color:#dcddde;font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
    ".fwv canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}.fwv canvas.pt{cursor:pointer}.fwv canvas.drag{cursor:grabbing}" +
    ".fwv-head{position:absolute;top:14px;left:18px;font-size:15px;font-weight:600;color:#fff;pointer-events:none;text-shadow:0 1px 6px #000}.fwv-head span{color:#8b8d91;font-weight:400}" +
    ".fwv-tip{position:absolute;pointer-events:none;background:#16181dee;border:1px solid #3a3d46;border-radius:7px;padding:4px 9px;font-size:12.5px;color:#fff;white-space:nowrap;transform:translate(12px,-34px);display:none;z-index:3}" +
    ".fwv-panel{position:absolute;top:0;right:0;bottom:0;width:40%;min-width:320px;background:#1b1c20;border-left:1px solid #333;box-shadow:-12px 0 30px #0009;overflow:auto;padding:22px 26px 40px;z-index:4;box-sizing:border-box;display:none}" +
    ".fwv-panel.on{display:block}.fwv-x{position:sticky;top:0;float:right;background:#2b2b2d;color:#ddd;border:1px solid #444;border-radius:7px;width:30px;height:30px;cursor:pointer;font-size:15px}.fwv-x:hover{border-color:#888}" +
    ".fwv-panel h1,.fwv-panel h2,.fwv-panel h3{color:#fff;margin:1.1em 0 .4em;line-height:1.25}.fwv-panel h1{font-size:22px;margin-top:0}.fwv-panel h2{font-size:17px}.fwv-panel h3{font-size:14.5px}" +
    ".fwv-panel p,.fwv-panel li{font-size:14px;line-height:1.55}.fwv-panel a{color:#7fd0ff}.fwv-panel code{background:#2b2b2d;padding:1px 5px;border-radius:4px}.fwv-panel hr{border:0;border-top:1px solid #333}" +
    ".fwv-err{color:#ff8a8a}";

  function mount(el, opts) {
    unmount();
    var api = ((opts && opts.api) || "").replace(/\/$/, "");
    var DEMO = false;
    try { DEMO = new URLSearchParams(location.search).get("demo") === "1" || new URLSearchParams(location.hash.slice(1)).get("demo") === "1"; } catch (_) {}
    var s = st = { el: el, dead: false, listeners: [], raf: 0, G: null, view: { cx: 0, cy: 0, R: 0 }, hover: -1, hv: -1, ha: 0, ht: 0, dirty: true, cache: null, W: 0, H: 0, dpr: 1 };
    var styleEl = document.createElement("style"); styleEl.textContent = CSS; document.head.appendChild(styleEl); s.styleEl = styleEl;
    var root = document.createElement("div"); root.className = "fwv"; s.root = root;
    var cv = document.createElement("canvas"); root.appendChild(cv);
    var head = document.createElement("div"); head.className = "fwv-head"; head.innerHTML = "Frameworks <span>\u00b7 MBA Brain</span>";
    var tip = document.createElement("div"); tip.className = "fwv-tip";
    var panel = document.createElement("div"); panel.className = "fwv-panel";
    root.appendChild(head); root.appendChild(tip); root.appendChild(panel); el.appendChild(root);
    var ctx = cv.getContext("2d");

    function on(t, ev, fn, o) { t.addEventListener(ev, fn, o); s.listeners.push([t, ev, fn, o]); }
    function need() { s.dirty = true; if (!s.raf && !s.dead) s.raf = requestAnimationFrame(frame); }

    function resize() {
      var r = root.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      var W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
      var first = !s.view.R;
      if (W === s.W && H === s.H && dpr === s.dpr) return;
      if (!first && s.W) { s.view.cx += (W - s.W) / 2; s.view.cy += (H - s.H) / 2; }
      s.W = W; s.H = H; s.dpr = dpr;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      if (first) { s.view.cx = W / 2; s.view.cy = H / 2; s.view.R = Math.min(W, H) * 0.47; }
      s.cache = null; need();
    }
    on(window, "resize", resize);
    // browser zoom changes devicePixelRatio; resize event fires for it, plus a cheap poll fallback in frame()

    // ---- graph prep ----
    function prep(d) {
      var n = d.nodes, N = n.length, deg = new Int32Array(N), adj = new Array(N), i;
      for (i = 0; i < N; i++) adj[i] = [];
      d.edges.forEach(function (e) { deg[e[0]]++; deg[e[1]]++; adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
      // softer colours: mix ~30% toward grey
      d.cats.forEach(function (c) {
        var v = parseInt(c.color.slice(1), 16), ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(function (u) { return Math.round(u * 0.7 + 150 * 0.3); });
        c.color = "#" + ch.map(function (u) { return (u < 16 ? "0" : "") + u.toString(16); }).join("");
      });
      // grouping: one angular sector per category (sized by node count, related fields adjacent), seeded jitter inside it
      var ORDER = ["strategy", "nonmarket", "economics", "finance", "accounting", "analytics", "operations", "supply chain", "marketing", "negotiation", "leadership", "ethics", "entrepreneurship", "innovation", "case studies"];
      var order = ORDER.map(function (id) { return d.cats.findIndex(function (c) { return c.id === id; }); }).filter(function (k) { return k >= 0; });
      d.cats.forEach(function (c, k) { if (order.indexOf(k) < 0) order.push(k); });
      var cnt = new Array(d.cats.length).fill(0); for (i = 0; i < N; i++) cnt[n[i].c]++;
      var sec = {}, acc = -Math.PI / 2, TAU = Math.PI * 2;
      order.forEach(function (k) { var w = TAU * cnt[k] / N; sec[k] = [acc, w]; acc += w; });
      var seed = 12345; function rnd() { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
      for (i = 0; i < N; i++) {
        var sc = sec[n[i].c], gap = Math.min(0.03, sc[1] * 0.1), r0 = Math.hypot(n[i].x, n[i].y), a = sc[0] + gap + rnd() * (sc[1] - 2 * gap);
        n[i].x = Math.cos(a) * r0; n[i].y = Math.sin(a) * r0;
      }
      var hub = {}; // cat -> idx
      for (i = 0; i < N; i++) if (hub[n[i].c] === undefined || deg[i] > deg[hub[n[i].c]]) hub[n[i].c] = i;
      var big = {}; // idx -> label
      Object.keys(hub).forEach(function (c) {
        big[hub[c]] = d.cats[c].label;
        var oi = order.indexOf(+c), ang = sec[c][0] + sec[c][1] / 2, rr = oi % 2 ? 0.74 : 0.5; // stagger hub radius so labels don't collide
        n[hub[c]].x = Math.cos(ang) * rr; n[hub[c]].y = Math.sin(ang) * rr;
      });
      // GTM: highest-degree node near the centre
      function nearHub(i) { return Object.keys(big).some(function (k) { return Math.hypot(n[i].x - n[k].x, n[i].y - n[k].y) < 0.16; }); }
      var best = -1, bs = -1;
      for (i = 0; i < N; i++) { var r = Math.hypot(n[i].x, n[i].y); if (r < 0.45 && deg[i] > bs && !nearHub(i)) { bs = deg[i]; best = i; } }
      if (DEMO && best >= 0) { big[best] = "Entry mode selection"; n[best].t = "Entry mode selection"; }
      // push big nodes apart (elliptical min distance so labels under hubs never collide), in memory only
      var ids = Object.keys(big).map(Number), A = 0.27, B = 0.1, MAXR = 0.85, it, p, q;
      for (it = 0; it < 400; it++) {
        var moved = false;
        for (p = 0; p < ids.length; p++) for (q = p + 1; q < ids.length; q++) {
          var a = n[ids[p]], b = n[ids[q]], dx = b.x - a.x, dy = b.y - a.y, e = Math.sqrt((dx / A) * (dx / A) + (dy / B) * (dy / B));
          if (e >= 1) continue;
          if (e < 1e-6) { dx = 0.001 * (q - p); dy = 0.001; e = Math.sqrt((dx / A) * (dx / A) + (dy / B) * (dy / B)); }
          var k = (1 - e) / e * 0.5 + 0.002; // push apart along the scaled vector
          a.x -= dx * k * 0.5; a.y -= dy * k * 0.5; b.x += dx * k * 0.5; b.y += dy * k * 0.5; moved = true;
        }
        ids.forEach(function (i) { var r = Math.hypot(n[i].x, n[i].y); if (r > MAXR) { n[i].x *= MAXR / r; n[i].y *= MAXR / r; } });
        if (!moved) break;
      }
      d.deg = deg; d.adj = adj; d.big = big; d.gtm = DEMO ? best : -1;
      s.G = d;
    }

    // ---- drawing ----
    function pos(i) { var n = s.G.nodes[i]; return [s.view.cx + n.x * s.view.R, s.view.cy + n.y * s.view.R]; }
    function rad(i) {
      var G = s.G, n = G.nodes[i], R = s.view.R, base = n.r * Math.min(3.2, Math.max(1, 0.9 + R / 1100));
      if (G.big[i] !== undefined) return Math.max(6, Math.min(18, 5.6 + R / 86));
      return base;
    }
    function paintStatic() {
      var G = s.G, c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
      var x = c.getContext("2d"); x.scale(s.dpr, s.dpr);
      var N = G.nodes.length, X = new Float32Array(N), Y = new Float32Array(N), i, e, v = s.view, W = s.W, H = s.H, m = 40;
      for (i = 0; i < N; i++) { X[i] = v.cx + G.nodes[i].x * v.R; Y[i] = v.cy + G.nodes[i].y * v.R; }
      function vis(i) { return X[i] > -m && X[i] < W + m && Y[i] > -m && Y[i] < H + m; }
      x.lineWidth = 0.8;
      for (var ep = 0; ep < 2; ep++) {
        x.strokeStyle = ep ? "rgba(155,168,192,0.05)" : "rgba(155,168,192,0.16)"; x.beginPath();
        for (e = 0; e < G.edges.length; e++) { var a = G.edges[e][0], b = G.edges[e][1]; if ((G.nodes[a].c !== G.nodes[b].c ? 1 : 0) !== ep || (!vis(a) && !vis(b))) continue; x.moveTo(X[a], Y[a]); x.lineTo(X[b], Y[b]); }
        x.stroke();
      }
      for (var pass = 0; pass < 2; pass++) for (var k = 0; k < G.cats.length; k++) {
        x.fillStyle = G.cats[k].color; x.globalAlpha = pass ? 0.92 : 0.8; x.beginPath(); var any = false;
        for (i = 0; i < N; i++) {
          var isBig = G.big[i] !== undefined;
          if (G.nodes[i].c !== k || isBig || (G.nodes[i].r >= 1.6 ? 1 : 0) !== pass || !vis(i)) continue;
          var rr = rad(i); x.moveTo(X[i] + rr, Y[i]); x.arc(X[i], Y[i], rr, 0, 6.2832); any = true;
        }
        if (any) x.fill();
      }
      x.globalAlpha = 1;
      s.cache = c;
    }
    function drawBig(x, i, alpha) {
      var G = s.G, p = pos(i), r = rad(i), col = i === G.gtm ? "#ffffff" : G.cats[G.nodes[i].c].color;
      if (p[0] < -60 || p[0] > s.W + 60 || p[1] < -60 || p[1] > s.H + 60) return;
      x.globalAlpha = alpha;
      x.beginPath(); x.arc(p[0], p[1], r + 4, 0, 6.2832); x.fillStyle = "rgba(11,13,18,0.85)"; x.fill();
      x.beginPath(); x.arc(p[0], p[1], r, 0, 6.2832); x.fillStyle = col; x.fill();
      x.lineWidth = 2; x.strokeStyle = i === G.gtm ? G.cats[G.nodes[i].c].color : "#0b0d12"; x.stroke();
      x.font = (i === G.gtm ? "700 15px" : "600 12.5px") + " -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      x.textAlign = "center"; x.textBaseline = "top";
      var t = G.big[i], ty = p[1] + r + 7;
      x.lineWidth = 4; x.strokeStyle = "rgba(11,13,18,0.9)"; x.strokeText(t, p[0], ty);
      x.fillStyle = i === G.gtm ? "#fff" : "#e8eaf0"; x.fillText(t, p[0], ty);
      x.globalAlpha = 1;
    }
    function frame() {
      s.raf = 0;
      if (s.dead || !s.G) return;
      var dpr = window.devicePixelRatio || 1; if (dpr !== s.dpr) resize();
      if (!s.ht || (s.ha === (s.hover >= 0 ? 1 : 0))) s.ht = performance.now();
      if (!s.cache) paintStatic();
      var G = s.G, h = s.hover, x = ctx;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = "#0b0d12"; x.fillRect(0, 0, cv.width, cv.height);
      x.drawImage(s.cache, 0, 0);
      x.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      var now = performance.now(), dt = Math.min(64, now - (s.ht || now)); s.ht = now;
      var tgt = h >= 0 ? 1 : 0;
      if (h >= 0) s.hv = h;
      if (s.ha < tgt) s.ha = Math.min(tgt, s.ha + dt / 150); else if (s.ha > tgt) s.ha = Math.max(tgt, s.ha - dt / 150);
      var HA = s.ha; h = s.hv;
      if (HA > 0 && h >= 0) {
        var cat = G.nodes[h].c, N = G.nodes.length, i, hp = pos(h), v = s.view;
        // dim everything slightly
        x.fillStyle = "rgba(11,13,18," + (0.55 * HA) + ")"; x.fillRect(0, 0, s.W, s.H);
        // same-category nodes slightly brighter
        var col = G.cats[cat].color; x.fillStyle = col; x.globalAlpha = 0.7 * HA; x.beginPath();
        for (i = 0; i < N; i++) {
          if (G.nodes[i].c !== cat || G.big[i] !== undefined) continue;
          var px = v.cx + G.nodes[i].x * v.R, py = v.cy + G.nodes[i].y * v.R;
          if (px < -10 || px > s.W + 10 || py < -10 || py > s.H + 10) continue;
          var rr = rad(i) + 0.2; x.moveTo(px + rr, py); x.arc(px, py, rr, 0, 6.2832);
        }
        x.fill(); x.globalAlpha = 1;
        // bright edges of hovered node + neighbours
        var nb = G.adj[h];
        x.lineWidth = 1.6; x.strokeStyle = "rgba(255,255,255," + (0.55 * HA) + ")"; x.beginPath();
        for (i = 0; i < nb.length; i++) { var q = pos(nb[i]); x.moveTo(hp[0], hp[1]); x.lineTo(q[0], q[1]); }
        x.stroke();
        for (i = 0; i < nb.length; i++) {
          var q2 = pos(nb[i]), c2 = G.cats[G.nodes[nb[i]].c].color;
          x.globalAlpha = HA; x.beginPath(); x.arc(q2[0], q2[1], rad(nb[i]) + 1.4, 0, 6.2832); x.fillStyle = c2; x.fill();
          x.lineWidth = 1; x.strokeStyle = "rgba(255,255,255,0.7)"; x.stroke(); x.globalAlpha = 1;
        }
        x.globalAlpha = HA; x.beginPath(); x.arc(hp[0], hp[1], rad(h) + 2.5, 0, 6.2832); x.fillStyle = col; x.fill(); x.lineWidth = 1.6; x.strokeStyle = "rgba(255,255,255,0.8)"; x.stroke(); x.globalAlpha = 1;
      }
      Object.keys(G.big).forEach(function (k) { drawBig(x, +k, HA > 0 && h >= 0 && +k !== h && G.nodes[+k].c !== G.nodes[h].c ? 1 - 0.55 * HA : 1); });
      s.dirty = false;
      if (s.ha !== tgt) need();
    }

    // ---- hit-test ----
    function hit(mx, my) {
      var G = s.G, v = s.view, best = -1, bd = 1e9;
      var rx = (mx - v.cx) / v.R, ry = (my - v.cy) / v.R, N = G.nodes.length;
      var lim = 8 / v.R;
      for (var i = 0; i < N; i++) {
        var n = G.nodes[i], dx = n.x - rx, dy = n.y - ry;
        if (dx > lim + 0.03 || dx < -lim - 0.03 || dy > lim + 0.03 || dy < -lim - 0.03) continue;
        var d = Math.sqrt(dx * dx + dy * dy) * v.R;
        var tol = G.big[i] !== undefined ? rad(i) + 6 : 7;
        if (d <= tol && d - (G.big[i] !== undefined ? 100 : 0) < bd) { bd = d - (G.big[i] !== undefined ? 100 : 0); best = i; }
      }
      return best;
    }
    function nameOf(i) { var G = s.G, n = G.nodes[i]; if (!DEMO) return G.big[i] !== undefined ? G.cats[n.c].label : n.t ? n.t : G.cats[n.c].label; return G.big[i] !== undefined && i !== G.gtm ? G.big[i] + " framework" : (n.t || (G.cats[n.c].label + " framework")); }

    // ---- interaction ----
    var drag = null, moved = 0;
    on(cv, "pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; moved = 0; try { cv.setPointerCapture(e.pointerId); } catch (_) {} cv.classList.add("drag"); });
    on(cv, "pointermove", function (e) {
      var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX; drag.y = e.clientY; s.view.cx += dx; s.view.cy += dy; s.cache = null; s.hover = -1; tip.style.display = "none"; need(); return;
      }
      if (!s.G) return;
      var h = hit(mx, my);
      if (h !== s.hover) { s.hover = h; need(); }
      cv.classList.toggle("pt", h >= 0);
      if (h >= 0) { tip.textContent = nameOf(h); tip.style.left = mx + "px"; tip.style.top = my + "px"; tip.style.display = "block"; } else tip.style.display = "none";
    });
    on(cv, "pointerup", function (e) {
      var was = moved; drag = null; cv.classList.remove("drag");
      if (was < 5 && s.G) { var r = cv.getBoundingClientRect(), h = hit(e.clientX - r.left, e.clientY - r.top); if (h >= 0) openPanel(h); }
    });
    on(cv, "pointerleave", function () { if (!drag && s.hover >= 0) { s.hover = -1; tip.style.display = "none"; need(); } });
    on(cv, "wheel", function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = s.view;
      var k = Math.exp(-e.deltaY * 0.0015), nR = Math.max(Math.min(s.W, s.H) * 0.2, Math.min(60000, v.R * k)); k = nR / v.R;
      v.cx = mx - (mx - v.cx) * k; v.cy = my - (my - v.cy) * k; v.R = nR; s.cache = null; s.hover = -1; tip.style.display = "none"; need();
    }, { passive: false });
    on(window, "keydown", function (e) { if (e.key === "Escape") closePanel(); });

    // ---- panel ----
    function closePanel() { panel.classList.remove("on"); }
    function fwUrl() { return api + "/api/framework?name=" + encodeURIComponent("Entry mode selection"); }
    function getFw() {
      if (!s.fwP) s.fwP = fetch(fwUrl()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
        if (!d || !d.markdown) throw new Error("empty");
        s.fw = d;
        if (!s.dead && s.G && s.G.gtm >= 0 && d.title) { s.G.big[s.G.gtm] = d.title; s.G.nodes[s.G.gtm].t = d.title; need(); }
        return d;
      }, function (err) { s.fwP = null; throw err; });
      return s.fwP;
    }
    function openPanel(i) {
      if (!DEMO) return openReal(i);
      var X = '<button class="fwv-x" aria-label="Close">\u2715</button>';
      panel.classList.add("on");
      panel.innerHTML = X + "<p>Loading\u2026</p>";
      panel.querySelector(".fwv-x").onclick = closePanel;
      getFw().then(function (d) {
        if (s.dead) return;
        panel.innerHTML = X + "<h1>" + esc(d.title || d.name || "Entry mode selection") + "</h1>" + md(d.markdown);
        panel.querySelector(".fwv-x").onclick = closePanel; panel.scrollTop = 0;
      }).catch(function () {
        if (s.dead) return;
        panel.innerHTML = X + '<p class="fwv-err">Couldn\u2019t load the framework</p>';
        panel.querySelector(".fwv-x").onclick = closePanel;
      });
    }
    function openReal(i) {
      var G = s.G, n = G.nodes[i], title = n.t;
      if (G.big[i] !== undefined || !title) return; // hubs and filler dots open nothing
      var X = '<button class="fwv-x" aria-label="Close">\u2715</button>', tok = s.tok = (s.tok || 0) + 1;
      function bind() { panel.querySelector(".fwv-x").onclick = closePanel; }
      panel.classList.add("on"); panel.innerHTML = X + "<p>Loading\u2026</p>"; bind();
      s.fwc = s.fwc || {};
      if (!s.fwc[title]) s.fwc[title] = fetch(api + "/api/framework?name=" + encodeURIComponent(title)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) { if (!d || !d.markdown) throw new Error("empty"); return d; }, function (e) { delete s.fwc[title]; throw e; });
      s.fwc[title].then(function (d) {
        if (s.dead || tok !== s.tok) return;
        var rt = d.title || d.name || title, note = rt.trim().toLowerCase() !== title.trim().toLowerCase() ? '<p style="color:#8b8d91;font-size:12.5px;margin:-6px 0 12px">closest match for ' + esc(title) + "</p>" : "";
        panel.innerHTML = X + "<h1>" + esc(rt) + "</h1>" + note + md(d.markdown); bind(); panel.scrollTop = 0;
      }).catch(function () {
        if (s.dead || tok !== s.tok) return;
        panel.innerHTML = X + '<p class="fwv-err">Couldn\u2019t load this framework</p>'; bind();
      });
    }
    function setCount(n) { s.countSet = true; head.innerHTML = "Frameworks <span>· " + esc(n) + " in the MBA Brain</span>"; }

    // ---- boot ----
    resize();
    fetch(DIR + "mba-graph.json").then(function (r) { return r.json(); }).then(function (d) { if (s.dead) return; prep(d); if (DEMO && s.fw && s.fw.title) { d.big[d.gtm] = s.fw.title; d.nodes[d.gtm].t = s.fw.title; } need(); if (DEMO) getFw().catch(function () {});
      fetch(api + "/api/frameworks/count").then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (c) { if (!s.dead && c && c.count != null) setCount(c.count); }).catch(function () {});
    }).catch(function () { head.innerHTML = "Frameworks <span>· couldn’t load the graph</span>"; });
  }

  function unmount() {
    var s = st; if (!s) return;
    s.dead = true; if (s.raf) cancelAnimationFrame(s.raf);
    s.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    if (s.root && s.root.parentNode) s.root.parentNode.removeChild(s.root);
    if (s.styleEl && s.styleEl.parentNode) s.styleEl.parentNode.removeChild(s.styleEl);
    st = null;
  }

  window.FwView = { mount: mount, unmount: unmount };
})();
