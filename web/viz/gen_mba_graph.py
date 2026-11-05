#!/usr/bin/env python3
"""Generate web/viz/mba-graph.json: the "MBA Brain" knowledge-graph cloud.

Real framework titles (web/frameworks.json) are labelled nodes; ~2,400 filler nodes
are generated, clustered by category. Seeded and deterministic. Positions are
precomputed and normalised to the unit disc.
Run: python3 web/viz/gen_mba_graph.py
"""
import json, math, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "frameworks.json")
OUT = os.path.join(HERE, "mba-graph.json")
TOTAL = 4500
SEED = 7

CATS = [  # id, label, colour (vivid on dark)
    ("strategy", "Strategy", "#4f8cff"),
    ("innovation", "Innovation", "#ffd23f"),
    ("entrepreneurship", "Entrepreneurship", "#ff8a3d"),
    ("nonmarket", "Nonmarket", "#9aa5b8"),
    ("analytics", "Analytics", "#19d3c5"),
    ("economics", "Economics", "#b266ff"),
    ("finance", "Finance", "#3ddc84"),
    ("accounting", "Accounting", "#7a8cff"),
    ("operations", "Operations", "#ff4d5e"),
    ("supply chain", "Supply chain", "#ff9eb5"),
    ("marketing", "Marketing", "#ff4fd8"),
    ("leadership", "Leadership", "#c8e64a"),
    ("negotiation", "Negotiation", "#2ec4ff"),
    ("ethics", "Ethics", "#e8e8ee"),
    ("case studies", "Case studies", "#d98a4e"),
]
CID = {c[0]: i for i, c in enumerate(CATS)}
# relative share of filler nodes per category (dense body weights)
WEIGHT = [1.4, 1.0, 1.0, 0.45, 1.0, 0.9, 1.1, 0.8, 1.0, 0.8, 1.2, 1.1, 0.8, 0.7, 0.9]
DISC_MAP = {
    "Accounting": "accounting", "Analytics": "analytics",
    "Competitive strategy": "strategy", "Corporate strategy": "strategy",
    "International strategy": "strategy",
    "Creativity": "innovation", "Innovation": "innovation",
    "Technology digital business": "innovation",
    "Economics": "economics", "Entrepreneurship": "entrepreneurship",
    "Social entrepreneurship": "entrepreneurship", "Ethics": "ethics",
    "Finance": "finance", "Personal finance": "finance",
    "Leadership": "leadership", "Personal effectiveness": "leadership",
    "Marketing": "marketing", "Negotiation": "negotiation", "Nonmarket": "nonmarket",
    "Operations": "operations", "Supply chain management": "supply chain",
}

rnd = random.Random(SEED)


def gauss_pt(cx, cy, s):
    return cx + rnd.gauss(0, s), cy + rnd.gauss(0, s)


def main():
    fw = json.load(open(SRC))
    real = []  # (title, cat)
    for d in fw["disciplines"]:
        cat = DISC_MAP[d["name"]]
        for f in d["frameworks"]:
            real.append((f["title"], CID[cat]))
    n_real = len(real)
    n_fill = TOTAL - n_real

    # category centres: golden-angle spiral so neighbours overlap like a real graph
    k = len(CATS)
    centres = []
    for i in range(k):
        a = i * 2.399963 + 0.4
        r = 0.08 + 0.36 * math.sqrt((i + 0.5) / k)
        centres.append((r * math.cos(a), r * math.sin(a)))
    # sub-clusters per category
    subs = []  # per cat: list of (x, y, sigma, weight)
    for i, (cx, cy) in enumerate(centres):
        m = 4 + int(WEIGHT[i] * 2)
        lst = []
        for _ in range(m):
            x, y = gauss_pt(cx, cy, 0.12)
            lst.append((x, y, rnd.uniform(0.03, 0.075), rnd.uniform(0.4, 1.6)))
        subs.append(lst)

    nodes = []  # dict x,y,c,r,t
    by_cat = [[] for _ in range(k)]

    def add(x, y, c, r, t=None):
        nodes.append({"x": x, "y": y, "c": c, "r": r, "t": t})
        by_cat[c].append(len(nodes) - 1)
        return len(nodes) - 1

    def body_pt(c):
        tot = sum(s[3] for s in subs[c])
        u = rnd.random() * tot
        for sx, sy, ss, w in subs[c]:
            u -= w
            if u <= 0:
                return gauss_pt(sx, sy, ss)
        return gauss_pt(*subs[c][0][:3])

    def fill_r():
        return round(rnd.uniform(1.5, 2.2) if rnd.random() < 0.15 else rnd.uniform(1.0, 1.6), 2)

    # real nodes first (bigger)
    for t, c in real:
        x, y = body_pt(c)
        add(x, y, c, round(rnd.uniform(1.6, 2.6), 2), t)

    # loose outer ring: ~9% of filler
    n_ring = int(n_fill * 0.075)      # faint loose outer ring
    n_annulus = int(n_fill * 0.48)    # connected outer band (0.5-0.95), wraps around the centre
    n_outer_hub = 480                 # spokes of hub clusters placed in that band
    n_hub_budget = 560
    n_body = n_fill - n_ring - n_annulus - n_outer_hub - n_hub_budget - 17
    wsum = sum(WEIGHT)
    for c in range(k):
        cnt = round(n_body * WEIGHT[c] / wsum)
        for _ in range(cnt):
            x, y = body_pt(c)
            add(x, y, c, fill_r())
    # trim / pad to exact body count
    while len(nodes) > n_real + n_body:
        nodes.pop()
        for lst in by_cat:
            if lst and lst[-1] >= len(nodes):
                lst.pop()
    while len(nodes) < n_real + n_body:
        c = rnd.randrange(k)
        x, y = body_pt(c)
        add(x, y, c, fill_r())

    # hubs: a few per big category, with star-shaped spokes laid out radially
    edges = set()

    def link(a, b):
        if a != b:
            edges.add((min(a, b), max(a, b)))

    n_body_end = len(nodes)
    hubs = []
    hub_cats = [0, 0, 1, 2, 4, 5, 6, 8, 10, 10, 11, 12, 14, 7, 9, 13, 3]
    for c in hub_cats:
        sub = rnd.choice(subs[c])
        hx, hy = gauss_pt(sub[0], sub[1], sub[2] * 0.8)
        h = add(hx, hy, c, round(rnd.uniform(4.0, 6.0), 2))
        hubs.append(h)
        spokes = min(rnd.randint(18, 50), max(0, TOTAL - n_ring - n_annulus - n_outer_hub - len(nodes) - 1))
        radius = rnd.uniform(0.04, 0.09)
        for j in range(spokes):
            a = rnd.uniform(0, 2 * math.pi)
            rr = radius * (0.35 + 0.65 * math.sqrt(rnd.random()))
            cc = c if rnd.random() < 0.85 else rnd.randrange(k)
            s = add(hx + rr * math.cos(a), hy + rr * math.sin(a), cc,
                    fill_r())
            link(h, s)
            if rnd.random() < 0.12:  # spoke to spoke
                link(s, len(nodes) - 1 - rnd.randint(1, min(j + 1, 6)))

    # normalise the dense body (core + hubs) to radius ~0.72 (98th percentile)
    cx = sum(n["x"] for n in nodes) / len(nodes)
    cy = sum(n["y"] for n in nodes) / len(nodes)
    rs = sorted(math.hypot(n["x"] - cx, n["y"] - cy) for n in nodes)
    scale = 0.50 / rs[int(len(rs) * 0.98)]
    for n in nodes:
        n["x"] = (n["x"] - cx) * scale
        n["y"] = (n["y"] - cy) * scale

    # connected annulus: sectors aligned to each category's angle, radius 0.45-0.92,
    # so the cloud stays rich around a central opaque disc
    cang = [math.atan2(centres[i][1] - cy * 0, centres[i][0]) for i in range(k)]
    for _ in range(n_annulus):
        c = rnd.choices(range(k), weights=WEIGHT)[0]
        a = cang[c] + rnd.gauss(0, 0.55)
        rr = 0.5 + 0.45 * math.sqrt(rnd.random())
        add(rr * math.cos(a), rr * math.sin(a), c,
            round(rnd.uniform(1.5, 2.3), 2) if rnd.random() < 0.28 else round(rnd.uniform(1.0, 1.6), 2))

    # hub clusters in the outer band, so the visible ring around a central disc has spiky stars too
    outer_left = n_outer_hub
    for hi in range(12):
        c = hub_cats[(hi * 3) % len(hub_cats)]
        a = hi * 2.399963 + 0.7
        rr = rnd.uniform(0.58, 0.86)
        hx, hy = rr * math.cos(a), rr * math.sin(a)
        h = add(hx, hy, c, round(rnd.uniform(4.0, 5.5), 2))
        hubs.append(h)
        spokes = min(outer_left, rnd.randint(30, 46)) if hi < 11 else outer_left
        outer_left -= spokes
        radius = rnd.uniform(0.05, 0.095)
        for j in range(spokes):
            b = rnd.uniform(0, 2 * math.pi)
            r2 = radius * (0.3 + 0.7 * math.sqrt(rnd.random()))
            cc = c if rnd.random() < 0.85 else rnd.randrange(k)
            sidx = add(hx + r2 * math.cos(b), hy + r2 * math.sin(b), cc,
                       round(rnd.uniform(1.4, 2.2), 2) if rnd.random() < 0.25 else fill_r())
            link(h, sidx)

    # real framework nodes live in the visible band (0.52-0.92), clustered by category sector,
    # so they stay visible when an opaque disc covers the middle of the cloud
    for i in range(n_real):
        c = nodes[i]["c"]
        ang = cang[c] + rnd.gauss(0, 0.5)
        rr = 0.52 + 0.40 * math.sqrt(rnd.random())
        nodes[i]["x"], nodes[i]["y"] = rr * math.cos(ang), rr * math.sin(ang)

    # loose ring (sparse, mostly unconnected), clearly separate at r 0.93-1.0
    ring = []
    while len(nodes) < TOTAL:
        a = rnd.uniform(0, 2 * math.pi)
        rr = 0.94 + min(0.06, abs(rnd.gauss(0, 0.03)))
        c = rnd.randrange(k)
        ring.append(add(rr * math.cos(a), rr * math.sin(a), c, round(rnd.uniform(0.7, 1.2), 2)))
    for lst in by_cat:
        while lst and lst[-1] >= len(nodes):
            lst.pop()

    # kNN edges inside the dense body using a spatial hash
    cell = 0.03
    grid = {}
    ringset = set(ring)
    body_ids = [i for i in range(len(nodes)) if i not in ringset]
    for i in body_ids:
        grid.setdefault((int(nodes[i]["x"] // cell), int(nodes[i]["y"] // cell)), []).append(i)

    def near(i, ring_n=2):
        gx, gy = int(nodes[i]["x"] // cell), int(nodes[i]["y"] // cell)
        out = []
        for dx in range(-ring_n, ring_n + 1):
            for dy in range(-ring_n, ring_n + 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if j != i:
                        d = (nodes[i]["x"] - nodes[j]["x"]) ** 2 + (nodes[i]["y"] - nodes[j]["y"]) ** 2
                        out.append((d, j))
        out.sort()
        return out

    for i in body_ids:
        nb = near(i)
        same = [j for d, j in nb if nodes[j]["c"] == nodes[i]["c"]]
        other = [j for d, j in nb if nodes[j]["c"] != nodes[i]["c"]]
        for j in same[: rnd.choice((2, 3, 3, 4, 5))]:
            link(i, j)
        if other and rnd.random() < 0.25:
            link(i, other[0])
        if rnd.random() < 0.03:  # medium-range cross-category bridge (no long stray lines)
            far = [j for d, j in nb if d > 0.0004]
            if far:
                link(i, far[-1])
    # connect hubs to each other loosely
    for a, b in zip(hubs, hubs[1:] + hubs[:1]):
        if rnd.random() < 0.6:
            link(a, b)
    # sprinkle a few ring links
    # ring dots stay unlinked on purpose

    out_nodes = []
    for i, n in enumerate(nodes):
        x, y = n["x"], n["y"]
        d = math.hypot(x, y)
        if d > 1:
            x, y = x / d, y / d
        o = {"x": round(x, 3), "y": round(y, 3), "c": n["c"], "r": n["r"]}
        if n["t"]:
            o["t"] = n["t"]
        out_nodes.append(o)

    data = {
        "cats": [{"id": i, "label": l, "color": col} for i, l, col in CATS],
        "nodes": out_nodes,
        "edges": sorted([list(e) for e in edges]),
    }
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(out_nodes)} nodes ({n_real} labelled), {len(edges)} edges, "
          f"{os.path.getsize(OUT)} bytes -> {OUT}")


if __name__ == "__main__":
    main()
