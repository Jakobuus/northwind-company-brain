/* MBA Brain cloud: Obsidian-style knowledge-graph cloud on a 2D canvas.
 *
 * window.MBACloud = {
 *   load(url) -> Promise        // fetches mba-graph.json
 *   draw(ctx, {cx, cy, R, alpha=1, lit=new Set(), now=performance.now(), hole=0, muted=false})
 *   animating() -> true while muted drift is on (host keeps requesting frames)
 *   titles() -> string[]        // real framework titles (original case)
 * }
 * draw() renders into an already DPR-scaled 2D ctx in CSS pixels; the unit disc maps to a
 * circle of radius R at (cx, cy). `lit` holds lower-cased framework titles.
 */
(function () {
  var curMuted = false;
  var G = null;            // loaded graph
  var byTitle = null;      // lower-cased title -> node index
  var adj = null;          // node index -> array of neighbour indexes
  var cache = null, mcache = null;        // {canvas, Rc, dpr, pad}
  var LABEL_MIN_R = 900;
  var MAX_CACHE_PX = 4096; // largest offscreen canvas side

  function hexToRgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function load(url) {
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      G = d;
      byTitle = new Map();
      adj = new Array(d.nodes.length);
      for (var i = 0; i < d.nodes.length; i++) {
        adj[i] = [];
        if (d.nodes[i].t) byTitle.set(d.nodes[i].t.toLowerCase(), i);
      }
      for (var e = 0; e < d.edges.length; e++) {
        adj[d.edges[e][0]].push(d.edges[e][1]);
        adj[d.edges[e][1]].push(d.edges[e][0]);
      }
      d.rgb = d.cats.map(function (c) { return hexToRgb(c.color); });
      d.pastel = d.rgb.map(function (c) { // desaturate toward grey, then lighten
        var l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], f = function (v) { return Math.round((0.5 * v + 0.5 * l) * 0.75 + 255 * 0.25); };
        return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")";
      });
      cache = null; mcache = null;
      buildGrid();
      return d;
    });
  }

  function titles() {
    if (!G) return [];
    var out = [];
    for (var i = 0; i < G.nodes.length; i++) if (G.nodes[i].t) out.push(G.nodes[i].t);
    return out;
  }

  function PX(o, n) { return o.cx + o.R * (n.x * o.C - n.y * o.S); }
  function PY(o, n) { return o.cy + o.R * (n.x * o.S + n.y * o.C); }
  function nodeRadius(n, R) { return n.r * Math.min(3.2, Math.max(1.0, 0.9 + R / 1100)); }

  // Paint the static layer (edges, nodes, labels) with the unit disc at (ox, oy), radius R,
  // into ctx. If `clip` is given ({x0,y0,x1,y1}) skip nodes/edges outside it.
  function paintStatic(ctx, ox, oy, R, clip, muted) {
    var nodes = G.nodes, edges = G.edges, i, e, n;
    var X = new Float32Array(nodes.length), Y = new Float32Array(nodes.length);
    for (i = 0; i < nodes.length; i++) { X[i] = ox + nodes[i].x * R; Y[i] = oy + nodes[i].y * R; }
    function vis(i) {
      return !clip || (X[i] >= clip.x0 && X[i] <= clip.x1 && Y[i] >= clip.y0 && Y[i] <= clip.y1);
    }
    // edges: thin, low alpha, one path
    ctx.lineWidth = muted ? 0.5 : 0.9; // hairline
    ctx.strokeStyle = muted ? "rgba(185,198,220,0.45)" : "rgba(155,168,192,0.32)";
    ctx.beginPath();
    for (e = 0; e < edges.length; e++) {
      var a = edges[e][0], b = edges[e][1];
      if (!vis(a) && !vis(b)) continue;
      ctx.moveTo(X[a], Y[a]); ctx.lineTo(X[b], Y[b]);
    }
    ctx.stroke();
    // nodes batched per category (hubs/real last so they sit on top)
    for (var pass = 0; pass < 2; pass++) {
      for (var c = 0; c < G.cats.length; c++) {
        ctx.fillStyle = muted ? G.pastel[c] : G.cats[c].color;
        ctx.globalAlpha = muted ? 1 : (pass ? 1 : 0.93);
        ctx.beginPath();
        var any = false;
        for (i = 0; i < nodes.length; i++) {
          n = nodes[i];
          if (n.c !== c || (n.r >= 1.6 ? 1 : 0) !== pass || !vis(i)) continue;
          var rr = nodeRadius(n, R);
          ctx.moveTo(X[i] + rr, Y[i]);
          ctx.arc(X[i], Y[i], rr, 0, 6.2832);
          any = true;
        }
        if (any) ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }


  // ---- labels: max 5 live, never over a dot or another label; lit nodes handled separately ----
  var CELL = 0.012, grid = null, labelCands = null;
  function buildGrid() {
    grid = new Map();
    for (var i = 0; i < G.nodes.length; i++) {
      var n = G.nodes[i], key = Math.floor(n.x / CELL) * 4096 + Math.floor(n.y / CELL);
      var l = grid.get(key); if (!l) grid.set(key, l = []); l.push(i);
    }
    labelCands = [];
    for (i = 0; i < G.nodes.length; i++) if (G.nodes[i].t) labelCands.push(i);
    labelCands.sort(function (p, q) { return G.nodes[q].r - G.nodes[p].r; });
    labelCands = labelCands.slice(0, 60);
  }
  // does the px box [x0,y0,x1,y1] (disc origin ox,oy radius R) cover any dot (other than `self`)?
  function hitsDot(x0, y0, x1, y1, ox, oy, R, self) {
    if (curMuted) return false;
    var u0 = (x0 - ox) / R, u1 = (x1 - ox) / R, v0 = (y0 - oy) / R, v1 = (y1 - oy) / R, m = 0.012;
    for (var gx = Math.floor((u0 - m) / CELL); gx <= Math.floor((u1 + m) / CELL); gx++)
      for (var gy = Math.floor((v0 - m) / CELL); gy <= Math.floor((v1 + m) / CELL); gy++) {
        var l = grid.get(gx * 4096 + gy);
        if (!l) continue;
        for (var q = 0; q < l.length; q++) {
          if (l[q] === self) continue;
          var n = G.nodes[l[q]], rr = nodeRadius(n, R) + 2;
          var px = ox + n.x * R, py = oy + n.y * R;
          if (px + rr > x0 && px - rr < x1 && py + rr > y0 && py - rr < y1) return true;
        }
      }
    return false;
  }
  function overlaps(b, placed) {
    for (var p = 0; p < placed.length; p++) {
      var q = placed[p];
      if (b[0] < q[2] + 8 && b[2] > q[0] - 8 && b[1] < q[3] + 4 && b[3] > q[1] - 4) return true;
    }
    return false;
  }
  // try right/left/above/below; returns {x,y,align,box} or null if every spot is blocked
  function placeLabel(ctx, i, text, fs, o, placed, force) {
    var n = G.nodes[i], R = o.R, x = PX(o, n), y = PY(o, n);
    var w = ctx.measureText(text).width, g = nodeRadius(n, R) + 4, h = fs * 0.62, best = null;
    var opts = [
      [x + g, y, "left", x + g - 2, y - h, x + g + w + 2, y + h],
      [x - g, y, "right", x - g - w - 2, y - h, x - g + 2, y + h],
      [x - w / 2, y - g - h, "center", x - w / 2 - 2, y - g - 2 * h, x + w / 2 + 2, y - g],
      [x + 0, y + g + h, "center", x - w / 2 - 2, y + g, x + w / 2 + 2, y + g + 2 * h]
    ];
    for (var k = 0; k < opts.length; k++) {
      var c = opts[k], box = [c[3], c[4], c[5], c[6]];
      if (overlaps(box, placed)) continue;
      if (o.hole) { // optional opaque disc in the middle: keep labels outside it
        var nx = Math.max(box[0], Math.min(o.cx, box[2])), ny = Math.max(box[1], Math.min(o.cy, box[3]));
        if (Math.hypot(nx - o.cx, ny - o.cy) < o.hole * R + 3) continue;
      }
      if (!hitsDot(box[0], box[1], box[2], box[3], o.cx, o.cy, R, i)) {
        return { x: c[0] + (c[2] === "center" ? w / 2 : 0), y: c[1] + (k === 2 ? -h - g + g : 0), align: c[2], box: box, ty: k === 2 ? y - g - h : k === 3 ? y + g + h : y };
      }
      if (!best) best = { x: c[0] + (c[2] === "center" ? w / 2 : 0), align: c[2], box: box, ty: k === 2 ? y - g - h : k === 3 ? y + g + h : y };
    }
    return force ? best : null;
  }
  function drawLabels(ctx, o, litIdx, W, H) {
    var placed = [], count = 0;
    var fs = 14;
    ctx.textBaseline = "middle";
    // lit titles always labelled (spot chosen to avoid dots where possible)
    ctx.font = "600 " + fs + "px -apple-system, 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "#fff";
    for (var k = 0; k < litIdx.length; k++) {
      var i = litIdx[k], L = placeLabel(ctx, i, G.nodes[i].t, fs, o, placed, true);
      if (!L) continue;
      placed.push(L.box);
      ctx.textAlign = L.align;
      ctx.fillText(G.nodes[i].t, L.x, L.ty);
    }
    if (o.R < LABEL_MIN_R || o.muted) return;
    ctx.font = "12px -apple-system, 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "rgba(235,238,245,0.9)";
    var litSet = new Set(litIdx);
    for (k = 0; k < labelCands.length && count < 5; k++) {
      i = labelCands[k];
      if (litSet.has(i)) continue;
      var n = G.nodes[i], x = PX(o, n), y = PY(o, n);
      if (x < 80 || y < 20 || x > W - 240 || y > H - 20) continue;
      var L2 = placeLabel(ctx, i, n.t, 12, o, placed, false);
      if (!L2) continue;
      placed.push(L2.box); count++;
      ctx.textAlign = L2.align;
      ctx.fillText(n.t, L2.x, L2.ty);
    }
  }

  // Crisp cache: rendered at exactly R x dpr. While zoom is changing we blit the old cache
  // scaled (fast, slightly soft); ~150 ms after R/dpr settle we re-render it crisp.
  var lastR = 0, lastDpr = 0, lastChange = 0, timer = 0, SETTLE_MS = 150;
  function renderCache(R, dpr, muted) {
    var Rc = R, pad = 4, prev = muted ? mcache : cache;
    var cv = (prev && prev.canvas) || document.createElement("canvas");
    cv.width = Math.ceil((2 * Rc + 2 * pad) * dpr);
    cv.height = cv.width;
    var c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    paintStatic(c, Rc + pad, Rc + pad, Rc, null, muted);
    var r = { canvas: cv, Rc: Rc, dpr: dpr, pad: pad };
    if (muted) mcache = r; else cache = r;
    return r;
  }
  function getCache(R, dpr, muted) {
    if (2 * R * dpr > MAX_CACHE_PX) return null;
    var cch = muted ? mcache : cache;
    if (cch && cch.dpr === dpr && Math.abs(cch.Rc - R) < 0.01) return cch;
    var t = performance.now();
    if (R !== lastR || dpr !== lastDpr) { lastR = R; lastDpr = dpr; lastChange = t; }
    if (!cch) return renderCache(R, dpr, muted);
    var ratio = R / cch.Rc * (cch.dpr / dpr);
    if (t - lastChange >= SETTLE_MS || ratio < 0.6 || ratio > 1.67) return renderCache(R, dpr, muted);
    if (!timer) timer = setTimeout(function () {
      timer = 0;
      window.dispatchEvent(new Event("mbacloud:settled"));
    }, SETTLE_MS + 10);
    return cch;
  }

  function drawLit(ctx, o) {
    var lit = o.lit, R = o.R, t = o.now / 1000, nodes = G.nodes, idx = [];
    lit.forEach(function (title) {
      var i = byTitle.get(String(title).toLowerCase());
      if (i !== undefined) idx.push(i);
    });
    if (!idx.length) return idx;
    var k, i, j, n, m, rgb;
    // brightened edges + neighbour dots
    ctx.lineWidth = 1.1;
    for (k = 0; k < idx.length; k++) {
      i = idx[k]; n = nodes[i]; rgb = G.rgb[n.c];
      var x = PX(o, n), y = PY(o, n);
      ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.55)";
      ctx.beginPath();
      for (j = 0; j < adj[i].length; j++) {
        m = nodes[adj[i][j]];
        ctx.moveTo(x, y); ctx.lineTo(PX(o, m), PY(o, m));
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.9)";
      ctx.beginPath();
      for (j = 0; j < adj[i].length; j++) {
        m = nodes[adj[i][j]];
        var mx = PX(o, m), my = PY(o, m), mr = nodeRadius(m, R) * 1.3;
        ctx.moveTo(mx + mr, my); ctx.arc(mx, my, mr, 0, 6.2832);
      }
      ctx.fill();
    }
    // glowing, pulsing lit nodes
    var prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (k = 0; k < idx.length; k++) {
      i = idx[k]; n = nodes[i]; rgb = G.rgb[n.c];
      var cx = PX(o, n), cy = PY(o, n);
      var pulse = 0.5 + 0.5 * Math.sin(t * 3 + k * 1.7);
      var gr = (10 + 7 * pulse) * (0.8 + R / 1500) + nodeRadius(n, R);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
      g.addColorStop(0, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.9)");
      g.addColorStop(0.3, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.35)");
      g.addColorStop(1, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, gr, 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = prev;
    for (k = 0; k < idx.length; k++) {
      n = nodes[idx[k]];
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(PX(o, n), PY(o, n), nodeRadius(n, R) * 1.4 + 1, 0, 6.2832);
      ctx.fill();
    }
    return idx;
  }

  var DRIFT = 0.01745; // rad per second (~1 deg/s) for muted drift
  var animating = false;

  function draw(ctx, o) {
    if (!G) return;
    o = o || {};
    var R = o.R, alpha = o.alpha === undefined ? 1 : o.alpha, muted = !!o.muted;
    if (!(R > 0) || alpha <= 0) return;
    var now = o.now === undefined ? performance.now() : o.now;
    var rot = muted ? (now / 1000) * DRIFT : 0;
    curMuted = muted; animating = muted;
    var opts = {
      cx: o.cx, cy: o.cy, R: R,
      lit: o.lit || new Set(),
      now: now, muted: muted, C: Math.cos(rot), S: Math.sin(rot),
      hole: o.hole || 0 // optional: unit radius of an opaque disc covering the middle (labels avoid it)
    };
    var tr = ctx.getTransform ? ctx.getTransform() : { a: 1 };
    var dpr = tr.a || 1;
    ctx.save();
    ctx.globalAlpha = alpha * (muted ? 0.18 : 1);
    var cc = getCache(R, dpr, muted);
    if (cc) {
      var s = R / cc.Rc, side = (2 * cc.Rc + 2 * cc.pad) * s;
      if (muted) {
        ctx.translate(opts.cx, opts.cy); ctx.rotate(rot);
        ctx.drawImage(cc.canvas, -side / 2, -side / 2, side, side);
      } else {
        var bx = opts.cx - (cc.Rc + cc.pad) * s, by = opts.cy - (cc.Rc + cc.pad) * s;
        if (s === 1) { bx = Math.round(bx * dpr) / dpr; by = Math.round(by * dpr) / dpr; } // pixel-aligned = crisp
        ctx.drawImage(cc.canvas, bx, by, side, side);
      }
    } else if (muted) {
      ctx.translate(opts.cx, opts.cy); ctx.rotate(rot);
      paintStatic(ctx, 0, 0, R, null, true);
    } else {
      // very large R: draw directly, culled to the visible canvas
      var W = ctx.canvas.width / dpr, H = ctx.canvas.height / dpr;
      paintStatic(ctx, opts.cx, opts.cy, R, { x0: -20, y0: -20, x1: W + 20, y1: H + 20 }, false);
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = alpha; // lit nodes stay full colour on top, even when muted
    var litIdx = drawLit(ctx, opts);
    var dW = ctx.canvas.width / dpr, dH = ctx.canvas.height / dpr;
    drawLabels(ctx, opts, litIdx, dW, dH);
    ctx.restore();
  }

  window.MBACloud = { load: load, draw: draw, titles: titles, animating: function () { return animating; } };
})();
