/* "How it works": a system diagram (input -> ingestion -> rings -> retrieval).
 * One SVG in a 1920x1080 viewBox, scaled to its container. Dots move with SMIL
 * (no JS timers), so unmount = remove the node. API: HowFlow.mount(el, stats?), unmount(). */
(function () {
  var W = 1920, H = 1080, NS = 'http://www.w3.org/2000/svg';
  var cur = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(v) { var n = Number(v); return v == null || v === '' || !isFinite(n) ? '—' : n.toLocaleString('en-US'); }

  // Real importer list (brain.intake.cli formats), grouped into friendly names.
  var GROUPS = [
    ['documents', [['PDF', '.pdf', 'PDF'], ['Word', '.docx', 'DOC'], ['PowerPoint', '.pptx', 'PPT'], ['Markdown, text', '.md .txt', 'MD'], ['Web page', '.html .htm', '</>']]],
    ['data', [['Excel', '.xlsx', 'XLS'], ['CSV', '.csv', 'CSV'], ['JSON', '.json .jsonl', '{ }']]],
    ['conversations', [['Email', '.eml .mbox', '@'], ['Captions', '.vtt .srt', 'CC'], ['Transcript', '.transcript', 'TR']]]
  ];

  function t(x, y, s, cls, extra) { return '<text x="' + x + '" y="' + y + '" class="' + cls + '"' + (extra || '') + '>' + s + '</text>'; }

  function tile(x, y, w, h, f) {
    var gx = x + 14, gy = y + (h - 34) / 2;
    return '<g class="hf-tile"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5"/>' +
      '<path class="hf-doc" d="M' + gx + ' ' + gy + 'h19l8 8v26h-27z M' + (gx + 19) + ' ' + gy + 'v8h8"/>' +
      t(gx + 13.5, gy + 25, esc(f[2]), 'hf-doctag', ' text-anchor="middle"') +
      t(x + 54, y + h / 2 - 3, esc(f[0]), 'hf-tname') +
      t(x + 54, y + h / 2 + 16, esc(f[1]), 'hf-mono hf-ext') + '</g>';
  }

  // box: lines = [title, sub1, sub2...]; opts {n, cls, pill, lock}
  function box(x, y, w, h, lines, o) {
    o = o || {};
    var s = '<g class="hf-box ' + (o.cls || '') + '"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6"/>';
    var lh = 21, total = 26 + (lines.length - 1) * lh, ty = y + (h - total) / 2 + 19;
    s += t(x + 20, ty, lines[0], 'hf-btitle');
    for (var i = 1; i < lines.length; i++) s += t(x + 20, ty + 8 + i * lh, lines[i], (o.subcls && o.subcls[i - 1]) || 'hf-mono hf-bsub');
    if (o.n) s += t(x + w - 14, y + 22, o.n, 'hf-mono hf-bnum', ' text-anchor="end"');
    if (o.pill) s += '<g class="hf-pill"><rect x="' + (x + 160) + '" y="' + (ty - 16) + '" width="38" height="20" rx="3"/>' + t(x + 179, ty - 1.5, o.pill, 'hf-mono', ' text-anchor="middle"') + '</g>';
    if (o.lock) s += lock(x + w - 34, y + h - 34);
    return s + '</g>';
  }
  function lock(x, y) { return '<g class="hf-lock"><rect x="' + x + '" y="' + (y + 8) + '" width="16" height="12" rx="2"/><path d="M' + (x + 3.5) + ' ' + (y + 8) + 'v-3a4.5 4.5 0 0 1 9 0v3"/></g>'; }

  function pipe(id, d, cls) { return '<path id="' + id + '" class="hf-pipe ' + (cls || '') + '" d="' + d + '"/>'; }
  function dots(id, dur, n, cls) {
    var s = '';
    for (var i = 0; i < n; i++) {
      s += '<g class="hf-dot ' + (cls || '') + '"><circle r="7" class="hf-halo"/><circle r="3.2"/>' +
        '<animateMotion dur="' + dur + 's" begin="' + (-(i * dur / n)).toFixed(2) + 's" repeatCount="indefinite" calcMode="linear"><mpath xlink:href="#' + id + '"/></animateMotion></g>';
    }
    return s;
  }

  function build(stats) {
    stats = stats || {};
    var P = [], D = [], B = [];   // pipes, dots, boxes (drawn in that order: boxes hide dots passing "through")

    // ---- column headers
    var heads = [[60, '01', 'what goes in'], [490, '02', 'ingestion'], [930, '03', 'store'], [1420, '04', 'retrieval']];
    heads.forEach(function (h) { B.push(t(h[0], 182, '<tspan class="hf-hn">' + h[1] + '</tspan>  ' + h[2].toUpperCase(), 'hf-mono hf-colhead')); });
    B.push('<path class="hf-rule" d="M60 196H1860"/>');

    // ---- 01 input tiles
    var x0 = 60, tw = 168, gap = 14, th = 62, y = 222, rows = [];
    GROUPS.forEach(function (g) {
      B.push(t(x0, y + 12, g[0], 'hf-mono hf-group'));
      y += 22;
      g[1].forEach(function (f, i) {
        var cx = x0 + (i % 2) * (tw + gap), r = Math.floor(i / 2);
        B.push(tile(cx, y + r * (th + 10), tw, th, f));
        if (i % 2 === 1 || i === g[1].length - 1) rows.push(y + r * (th + 10) + th / 2);
      });
      y += Math.ceil(g[1].length / 2) * (th + 10) + 8;
    });
    B.push('<g class="hf-tile hf-other"><rect x="60" y="' + y + '" width="350" height="40" rx="5"/>' +
      t(76, y + 26, 'other text', 'hf-tname') + t(394, y + 26, 'best effort', 'hf-mono hf-ext', ' text-anchor="end"') + '</g>');
    rows.push(y + 20);

    // bus from tiles into "read"
    var BUS = 440, readY = 222, readH = 92, readC = readY + readH / 2;
    rows.forEach(function (ry) { P.push('<path class="hf-pipe" d="M410 ' + ry + 'H' + BUS + '"/>'); });
    P.push('<path class="hf-pipe" d="M' + BUS + ' ' + rows[rows.length - 1] + 'V' + readC + 'H490"/>');

    // ---- 02 ingestion pipeline
    var px = 490, pw = 360, pcx = px + pw / 2;
    var steps = [
      [92, ['read', 'parse each file into plain text'], { n: '01' }],
      [118, ['extract facts', 'decisions · policies · facts', '+ exact quote → whose word wins'], { n: '02', pill: 'AI', cls: 'hf-ai' }],
      [92, ['detect department + access', 'rule table + AI suggestion', 'uploader may override'], { n: '03' }],
      [92, ['set who may read', 'all · area · restricted · private'], { n: '04', lock: 1 }],
      [92, ['index', 'keyword index', '+ meaning vectors (bge-small)'], { n: '05' }]
    ];
    var sum = steps.reduce(function (a, s) { return a + s[0]; }, 0), sg = (900 - readY - sum) / (steps.length - 1), py = readY, idxC = 0;
    steps.forEach(function (s) { B.push(box(px, py, pw, s[0], s[1], s[2])); idxC = py + s[0] / 2; py += s[0] + sg; });

    // ---- 03 the four rings
    var RX = 1010, RY = 320, radii = [100, 76, 52, 28];
    var ringNames = ['private', 'department internal', 'department core', 'company core'];
    var ringSub = ['author only', 'team only', 'whole department', 'everyone'];
    var rs = '<g class="hf-rings">';
    radii.forEach(function (r, i) { rs += '<circle class="hf-ring hf-r' + i + '" cx="' + RX + '" cy="' + RY + '" r="' + r + '"/>'; });
    ringNames.forEach(function (n, i) {
      var ly = 252 + i * 38;
      rs += '<circle class="hf-ring hf-r' + i + '" cx="1140" cy="' + (ly - 4) + '" r="5"/>' + t(1156, ly, n, 'hf-mono hf-rname') + t(1156, ly + 16, ringSub[i], 'hf-mono hf-rsub');
    });
    rs += t(RX, RY + 128, 'the four rings', 'hf-btitle', ' text-anchor="middle"') + '</g>';
    B.push(rs);

    // store detail panel: 5 places things live
    var SX = 930, SW = 470, SY = 470, SH = 48, SG = 4;
    var store = [
      ['<dept>/', '*.md per note', 'YAML header: id · type · area · access · author · date', 'M'],
      ['extracted', 'next to its source', 'subject · attribute · value · exact quote, source access', 'F'],
      ['policy.yaml', 'one per company', 'people · groups · areas · link tokens', 'P'],
      ['.brain-cache/', 'vectors + chunks', 'bge-small embeddings, local, built per org when on', 'V'],
      ['postgres', 'app database', 'accounts · orgs · brain areas · members · promotions', 'DB']
    ];
    var STC = [];
    store.forEach(function (r, i) {
      var y0 = SY + i * (SH + SG);
      STC.push(y0 + SH / 2);
      B.push('<g class="hf-box hf-store' + (i === 2 ? ' hf-perm' : '') + '"><rect x="' + SX + '" y="' + y0 + '" width="' + SW + '" height="' + SH + '" rx="5"/>' +
        '<rect class="hf-sg" x="' + (SX + 10) + '" y="' + (y0 + 12) + '" width="26" height="24" rx="3"/>' + t(SX + 23, y0 + 28.5, r[3], 'hf-mono hf-sgt', ' text-anchor="middle"') +
        t(SX + 46, y0 + 20, esc(r[0]), 'hf-mono hf-sname') + t(SX + 46 + r[0].length * 8.6 + 12, y0 + 20, esc(r[1]), 'hf-mono hf-ssub') +
        t(SX + 46, y0 + 38, esc(r[2]), 'hf-mono hf-ssub') + '</g>');
    });
    B.push(t(SX, SY + 5 * (SH + SG) + 14, 'per company: own folder, policy, index · no cross-company reads', 'hf-mono hf-ssub'));
    STC.forEach(function (cy) { P.push('<path class="hf-pipe" d="M895 ' + cy + 'H' + SX + '"/>'); });

    // MBA Brain: second store, open to everyone
    var mbY = 770, mbH = 96;
    B.push(box(930, mbY, 400, mbH, ['MBA Brain', num(stats.frameworks == null ? 1012 : stats.frameworks) + ' frameworks everyone has'], { cls: 'hf-mba' }));

    // ---- 04 retrieval
    var rx = 1420, rw = 440, rcx = rx + rw / 2;
    B.push(box(rx, 222, rw, 92, ['question', 'asked by one person'], { n: '01' }));
    B.push(box(rx, 380, rw, 180, ['permission filter', 'only notes this person may read', 'runs before search', 'private = author only'],
      { n: '02 · FIRST', cls: 'hf-perm', lock: 1, subcls: ['hf-permline', 'hf-mono hf-bsub', 'hf-mono hf-bsub'] }));
    B.push(box(rx, 622, rw, 92, ['search', 'meaning + keywords', 'vector + keyword scores combined'], { n: '03' }));
    var aY = 778, aH = 122, aw = 212;
    B.push(box(rx, aY, aw, aH, ['answer', 'with sources'], { n: '04', cls: 'hf-ans' }));
    B.push(box(rx + rw - aw, aY, aw, aH, ['ask ‹person›', 'nothing readable', 'answers it'], { n: '04b', cls: 'hf-askp' }));
    B.push(t(rx + aw / 2 - 10, aY - 10, 'readable match', 'hf-mono hf-edge', ' text-anchor="end"'));
    B.push(t(rx + rw - aw / 2 - 10, aY - 10, 'no readable match', 'hf-mono hf-edge', ' text-anchor="end"'));

    // ---- pipes + dots
    var ax = rx + aw / 2, bx = rx + rw - aw / 2;
    P.push(pipe('hf-p-in1', 'M410 ' + rows[0] + 'H' + BUS + 'V' + readC + 'H' + pcx));
    P.push(pipe('hf-p-in2', 'M410 ' + rows[3] + 'H' + BUS + 'V' + readC + 'H' + pcx));
    P.push(pipe('hf-p-in3', 'M410 ' + rows[rows.length - 1] + 'H' + BUS + 'V' + readC + 'H' + pcx));
    P.push(pipe('hf-p-ing', 'M' + pcx + ' ' + readC + 'V' + idxC + 'H895V' + RY + 'H' + (RX - radii[0])));
    P.push(pipe('hf-p-pol', 'M1400 ' + STC[2] + 'H1410V' + 470 + 'H1420'));
    P.push(pipe('hf-p-ret', 'M' + rcx + ' 268V' + (aY - 32) + 'H' + ax + 'V' + (aY + aH / 2)));
    P.push(pipe('hf-p-ask', 'M' + rcx + ' 714V' + (aY - 32) + 'H' + bx + 'V' + (aY + aH / 2), 'hf-dash'));
    P.push(pipe('hf-p-mba', 'M1330 ' + (mbY + mbH / 2) + 'H' + (rx + 8)));
    // centre boxes on top of pipes: pipe tail hidden under the next box
    D.push(dots('hf-p-in1', 7, 3), dots('hf-p-in2', 6, 2), dots('hf-p-in3', 8, 3));
    D.push(dots('hf-p-ing', 14, 7), dots('hf-p-pol', 2.5, 2), dots('hf-p-ret', 9, 4));
    D.push(dots('hf-p-ask', 9, 1, 'hf-dim'), dots('hf-p-mba', 4, 2, 'hf-dim'));

    // ---- header + legend
    var head = t(60, 92, 'How it works', 'hf-h1') + t(60, 128, 'system diagram · files in → facts + access → the four rings → permission-first retrieval', 'hf-mono hf-h2') +
      '<g class="hf-legend"><circle cx="1548" cy="88" r="4" class="hf-lg-flow"/>' + t(1562, 93, 'data flow', 'hf-mono hf-lgt') +
      '<rect x="1676" y="81" width="14" height="14" rx="2" class="hf-lg-perm"/>' + t(1700, 93, 'permission check', 'hf-mono hf-lgt') + '</g>';

    // ---- live counts strip
    var cells = [['documents you can read', stats.docs], ['facts you can read', stats.facts], ['people', stats.people], ['departments', stats.departments]];
    var strip = '<path class="hf-rule" d="M60 940H1860"/>' + '<circle class="hf-live" cx="66" cy="972" r="4"/>' + t(80, 977, 'LIVE · YOUR VIEW', 'hf-mono hf-colhead');
    var cw = (1860 - 300) / 4;
    cells.forEach(function (c, i) {
      var cx = 300 + i * cw;
      strip += '<rect class="hf-cell" x="' + cx + '" y="956" width="' + (cw - 20) + '" height="76" rx="5"/>' +
        t(cx + 22, 1008, esc(num(c[1])), 'hf-count') + t(cx + cw - 42, 1002, c[0], 'hf-mono hf-clabel', ' text-anchor="end"');
    });

    return '<svg xmlns="' + NS + '" xmlns:xlink="http://www.w3.org/1999/xlink" class="hf-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="How it works: system diagram">' +
      '<defs><pattern id="hf-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="hf-gridline"/></pattern></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#hf-grid)"/>' +
      head + '<g class="hf-pipes">' + P.join('') + '</g><g class="hf-dots">' + D.join('') + '</g>' + B.join('') + strip + '</svg>';
  }

  function mount(el, stats) {
    unmount();
    if (!el) return;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var root = document.createElement('div');
    root.className = 'hf-root';
    root.innerHTML = build(stats);
    el.appendChild(root);
    cur = { root: root };
  }
  function unmount() {
    if (!cur) return;
    if (cur.root.parentNode) cur.root.parentNode.removeChild(cur.root);
    cur = null;
  }
  window.HowFlow = { mount: mount, unmount: unmount };
})();
