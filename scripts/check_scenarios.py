#!/usr/bin/env python
"""Check every demo scenario (docs/demo-company.md) against the LIVE brain.

  .venv/bin/python scripts/check_scenarios.py            read-only checks on the seeded Northwind org
  .venv/bin/python scripts/check_scenarios.py --mutate   ALSO runs the live actions (commit, promote,
                                                         live-ingest drops) in a THROWAWAY org copied from
                                                         Northwind's people/departments. Northwind is never written.

Prints `PASS <name>` / `FAIL <name>: <reason>`; exit 1 if any FAIL.
Env: BRAIN_URL (default http://localhost:8000), API_URL (default http://localhost:3001/api).
Needs ../.brain-dev.env (service token) and ../.northwind-seed.json + ../brain-root (to find the org and people).
The throwaway org is left in brain-root as `scratch-check-<hex>` (safe to delete the folder).
"""
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

KIT = Path(__file__).resolve().parent.parent
BASE = KIT.parent
BRAIN = os.getenv("BRAIN_URL", "http://localhost:8000").rstrip("/")
API = os.getenv("API_URL", "http://localhost:3001/api").rstrip("/")
RAW = KIT / "demo-raw" / "northwind"
TOKEN = dict(l.strip().split("=", 1) for l in (BASE / ".brain-dev.env").read_text().splitlines() if "=" in l)["BRAIN_SERVICE_TOKEN"]


class Fail(Exception):
    pass


def need(cond, msg):
    if not cond:
        raise Fail(msg)


# ---------------------------------------------------------------- http (retries: the brain may be restarting)

def http(url, method="GET", headers=None, data=None, timeout=240, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, method=method, headers=headers or {}, data=data)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (502, 503) and i < tries - 1:
                last = e
                time.sleep(4)
                continue
            return e.code, e.read()
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            last = e
            time.sleep(4)
    raise Fail(f"unreachable {url.split('?')[0]}: {last}")


def jget(url, **kw):
    code, body = http(url, **kw)
    try:
        return code, json.loads(body)
    except ValueError:
        return code, None


def internal(org, path, method="GET", body=None):
    h = {"X-Brain-Service": TOKEN, "content-type": "application/json"}
    code, out = jget(f"{BRAIN}/internal/orgs/{org}/{path}", method=method, headers=h,
                     data=json.dumps(body).encode() if body is not None else None)
    return code, out


def multipart(url, fields, fname, content):
    b = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\n'
                 f'Content-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    return jget(url, method="POST", headers={"content-type": f"multipart/form-data; boundary={b}"},
                data=b"".join(parts))


# ---------------------------------------------------------------- an org with named personas

class Org:
    def __init__(self, org_id, policy):
        self.id = org_id
        self.people = {}
        for pid, p in policy["people"].items():
            self.people.setdefault(p["name"].split()[0], pid)
        self._views = {}
        self._asks = {}
        self.policy = policy

    def view(self, who):
        if who not in self._views:
            code, out = internal(self.id, "view-token", "POST", {"person": self.people[who], "ttl_seconds": 3600})
            need(code == 200 and out, f"view-token {who} -> {code}")
            self._views[who] = out["url"]
        return self._views[who]

    def get(self, who, path):
        """JSON of /v/<token>/api/... as persona; None on 404."""
        code, out = jget(self.view(who) + path.lstrip("/"))
        if code == 404:
            return None
        need(code == 200, f"{who} {path.split('?')[0]} -> HTTP {code}")
        return out

    def note(self, who, nid):
        return self.get(who, "api/note?id=" + urllib.parse.quote(nid))

    def notes(self, who):
        code, out = internal(self.id, "notes?person=" + self.people[who])
        need(code == 200, f"notes list {who} -> {code}")
        return out

    def ask(self, who, q):
        key = (who, q)
        if key not in self._asks:
            for _ in range(3):  # the LLM answer (rag) is null when the model call fails/times out: retry
                a = self.get(who, "api/ask?q=" + urllib.parse.quote(q))
                if a is None or a.get("rag"):
                    break
            self._asks[key] = a
        return self._asks[key]

    def prefetch(self, jobs):
        with ThreadPoolExecutor(3) as ex:
            list(ex.map(lambda j: self.ask(*j), jobs))


def blob(*objs):
    return json.dumps(objs, ensure_ascii=False).lower()


def res_for(a, attr_hint, subj_hint=""):
    return [r for r in a["resolutions"] if attr_hint in r["key"][1] and subj_hint in r["key"][0]]


def rag_text(a):
    return ((a.get("rag") or {}).get("text") or "")


# ---------------------------------------------------------------- Northwind scenarios (read-only)

PRIVATE = {  # note id -> (author, topical question)
    "ingrid-private-fast-charge-temperature-worry": ("Ingrid", "Any worries about heat during fast charging?"),
    "felix-private-outside-offer": ("Felix", "Did anyone get an outside job offer?"),
    "clara-private-halden-ceiling": ("Clara", "What is the ceiling for the Halden acquisition?"),
}
Q_LAUNCH = "When does the Model T2 launch?"
Q_PRICE = "What is the retail price of the Model T2?"
Q_FRAME = "How should we price the T2, cost-plus or value-based?"
Q_LEAD = "How long do Cellwerk battery packs take to arrive?"
Q_HEAT = "Any worries about heat during fast charging?"
Q_BMS = "Who knows about BMS?"
Q_PIPE = "What is in our Q4 pipeline?"
Q_RESTR = "What is happening with restructuring?"
Q_SAL = "What is the salary band for a senior engineer?"
Q_FELIX = "What did Felix write privately?"


def needles(org, nid, author):
    """id + title + a distinctive snippet of a private note, read as its author."""
    n = org.note(author, nid)
    need(n is not None, f"{author} cannot read own private note {nid}")
    snippet = next((l.strip()[:50] for l in n["body"].splitlines() if len(l.strip()) > 60 and not l.startswith("#")), "")
    return [nid, n["title"], snippet]


def s_leak_private(org):
    bad = []
    for nid, (author, q) in PRIVATE.items():
        ns = [x.lower() for x in needles(org, nid, author) if x]
        for viewer in ("Tobias", "Daan", "Mia", "Clara", "Felix", "Ingrid"):
            if viewer == author or (viewer == "Mia" and author == "Clara" and False):
                continue
            if org.note(viewer, nid) is not None:
                bad.append(f"{viewer} can open {nid}")
            if any(x["id"] == nid for x in org.notes(viewer)):
                bad.append(f"{viewer} notes list has {nid}")
            texts = blob(org.get(viewer, "api/graph?ghosts=1&people=1"), org.get(viewer, "api/who?q=" + urllib.parse.quote(q)))
            if viewer in ("Tobias", "Clara", "Mia", "Daan") or True:
                texts += blob(org.ask(viewer, q))
            for x in ns:
                if x in texts:
                    bad.append(f"{viewer} responses contain {x[:30]!r} of {nid}")
    need(not bad, "; ".join(bad[:3]))


def s_dept_isolation(org):
    bad = []
    daan = org.notes("Daan")
    for n in daan:
        if n["layer"] not in ("core", "dept-core") and n["dept"] != "sales" and n["layer"] != "private":
            bad.append(f"Daan list has {n['id']} ({n['layer']}/{n['dept']})")
    for nid in ("bms-design-doc-v3", "t2-pricing-memo-2-21-oct", "salary-bands-2026-confidential", "board-meeting-2026-10-27"):
        if org.note("Daan", nid) is not None:
            bad.append(f"Daan opens {nid}")
    for nid in ("bms-design-doc-v3", "t2-architecture"):
        if org.note("Jonas", nid) is not None:
            bad.append(f"Jonas (Finance) opens Engineering note {nid}")
    for q in (Q_PRICE, Q_BMS, Q_RESTR):
        t = blob(org.ask("Daan", q))
        for nid in ("t2-pricing-memo-2-21-oct", "t2-pricing-memo-1-10-sep", "bms-design-doc-v3", "board-meeting-2026-10-27", "board-deck-project-harbour-halden"):
            if nid in t:
                bad.append(f"Daan ask {q[:20]!r} contains {nid}")
    need(not bad, "; ".join(bad[:3]))


def s_1a_tobias(org):
    a = org.ask("Tobias", Q_LAUNCH)
    r = res_for(a, "launch_date", "t2")
    need(r, "no launch_date resolution for model_t2")
    r = r[0]
    need(r["winner"]["id"] == "model-t2-launch-date-8e1f11" and "2027-03-15" in r["winner"]["value"], f"winner is {r['winner']['id']} {r['winner']['value']}")
    need(r["conflicts"], "no conflict listed (Tobias's April chat remark not extracted as a claim?)")
    ch = json.dumps(r["conflicts"])
    chal = [c["challenger"] if isinstance(c["challenger"], str) else c["challenger"].get("id", "") for c in r["conflicts"]]
    bodies = " ".join(((org.note("Tobias", x) or {}).get("body", "") + (org.note("Tobias", x) or {}).get("title", "")) for x in chal)
    need("april" in ch.lower() or "april" in bodies.lower(), f"conflict challenger does not show the April remark: {chal}")


def s_1a_daan(org):
    a = org.ask("Daan", Q_LAUNCH)
    r = res_for(a, "launch_date", "t2")
    need(r and r[0]["winner"]["id"] == "model-t2-launch-date-8e1f11", "Daan does not get the 15 March decision")
    need("2027-03-15" in r[0]["winner"]["value"], "wrong date")
    t = blob(a)
    need("eng-t2-chat" not in t and "realistically" not in t and not r[0]["conflicts"], "Daan sees Tobias's April remark / a conflict")
    need(org.note("Daan", "eng-t2-chat-export-2-nov-2026") is None, "Daan can open the Engineering chat")


def s_1b_jonas(org):
    a = org.ask("Jonas", Q_PRICE)
    need("2,690" in rag_text(a) or "2690" in rag_text(a), "answer text lacks EUR 2,690")
    r = [x for x in res_for(a, "price", "t2") if "2,690" in json.dumps(x) or "2,490" in json.dumps(x)]
    need(r, "no resolution holding the 2,690 / 2,490 memo prices (only: " + ", ".join(f"{x['key'][1]}={x['winner']['value'][:20]}" for x in res_for(a, "price", "t2")) + ")")
    w = r[0]
    need("2,690" in w["winner"]["value"] or "2690" in w["winner"]["value"], f"winner is {w['winner']['value']}")
    need(any("2,490" in s["value"] or "2490" in s["value"] for s in w["superseded"]), "2,490 not shown as superseded")


def s_1b_daan(org):
    a = org.ask("Daan", Q_PRICE)
    t = blob(a)
    need("2,690" not in t and "2,490" not in t and "2690" not in t and "2490" not in t, "Daan sees a T2 price")
    need(any("jonas" in h.lower() for h in a["hints"]), f"no hint to Jonas: {a['hints']}")


def s_1c_elena(org):
    a = org.ask("Elena", Q_LEAD)
    need("9 weeks" in rag_text(a), "answer text lacks '9 weeks'")
    r = res_for(a, "lead_time")
    need(r, "no lead_time resolution (estimate vs measurement not extracted)")
    need(r[0]["winner"]["id"].startswith("supplier-lead-time-report") or "9" in r[0]["winner"]["value"], f"winner {r[0]['winner']['value']}")
    need(any("6" in s["value"] for s in r[0]["superseded"]) or r[0]["conflicts"], "her 6-week estimate not shown")


def s_1c_ines(org):
    a = org.ask("Ines", Q_LEAD)
    need("9 weeks" in rag_text(a), "Ines does not get 9 weeks")
    need("battery-pack-lead-time-for-dealer-planning" not in blob(a) and "6 weeks" not in rag_text(a), "Ines sees Elena's 6-week estimate")
    need(org.note("Ines", "supplier-lead-time-report-cellwerk") is not None, "Ines cannot read the dept-core report")


def s_2_before(org):
    nid = "ingrid-private-fast-charge-temperature-worry"
    mine = [n for n in org.notes("Ingrid") if n["id"] == nid]
    need(mine and mine[0]["layer"] == "private", "Ingrid's note missing or not private")
    need("dept" in mine[0]["can_move"], f"Ingrid cannot commit it: can_move={mine[0]['can_move']}")
    for who in ("Tobias", "Clara", "Felix"):
        t = blob(org.ask(who, Q_HEAT))
        need(nid not in t and "cell temperature gradient" not in t, f"{who} sees Ingrid's private note")
    for nid2, a in (("felix-private-outside-offer", "Felix"), ("clara-private-halden-ceiling", "Clara")):
        n = [x for x in org.notes(a) if x["id"] == nid2]
        need(n and n[0]["layer"] == "private", f"control note {nid2} not private")


def s_3_before(org):
    nid = "bms-explained-in-plain-words"
    need(org.note("Daan", nid) is None, "Daan can already read the BMS explainer")
    who = org.get("Daan", "api/who?q=BMS")
    need("ingrid" not in blob(who), "Daan's 'who knows BMS' already names Ingrid")
    t = {x["id"]: x for x in org.notes("Tobias")}.get(nid)
    need(t and "core" in t["can_move"], f"Tobias has no Promote option: {t and t['can_move']}")
    c = {x["id"]: x for x in org.notes("Clara")}.get(nid)
    need(c is None or "core" not in c["can_move"], "Clara (owner, not Eng lead) has a Promote option")


def s_3_pending(org):
    em = {p["name"].split()[0]: p["email"] for p in json.loads((KIT / "demo-raw/northwind/manifest.json").read_text())["people"]}
    try:
        code, out = jget(f"{API}/auth/login", method="POST", headers={"content-type": "application/json"},
                         data=json.dumps({"email": em["Elena"], "password": "Demo123!"}).encode(), tries=2)
        need(code in (200, 201) and out, f"api login Elena -> {code}")
        code, out = jget(f"{API}/organizations/{org.id}/brain/promotion-requests", headers={"authorization": "Bearer " + out["accessToken"]})
    except Fail as e:
        raise Fail(f"api unavailable ({e})")
    need(code == 200, f"promotion-requests -> {code}")
    hit = [i for i in out["items"] if i["noteId"] == "wiki-dealer-onboarding-checklist" and i["status"] == "PENDING"]
    need(hit and hit[0]["requestedBy"]["name"].startswith("Lukas"), f"no pending Lukas request for dealer onboarding: {out['items'][:1]}")


def s_4_grants(org):
    bad = []
    for who, nid in (("Jonas", "pipeline-2026-q4"), ("Jonas", "q3-sales-review"), ("Sofia", "t2-architecture")):
        if org.note(who, nid) is None:
            bad.append(f"{who} cannot read {nid}")
    for who, nid in (("Noor", "pipeline-2026-q4"), ("Mateo", "t2-architecture")):
        if org.note(who, nid) is not None:
            bad.append(f"{who} can read {nid}")
    need(not bad, "; ".join(bad))
    j = org.ask("Jonas", Q_PIPE)
    need("14 deals" in rag_text(j) or "14" in rag_text(j), "Jonas's pipeline answer lacks 14 deals")
    n = org.ask("Noor", Q_PIPE)
    need(any("elena" in h.lower() for h in n["hints"]), f"Noor has no hint to Elena: {n['hints']}")
    need("pipeline-2026-q4" not in blob(n), "Noor's response names the pipeline note")
    lea = [x for x in org.notes("Lea") if x["dept"] == "customer-care"]
    need(lea, "Lea (granted) sees no Customer Care notes")
    need(not [x for x in org.notes("Marta") if x["dept"] == "customer-care" and x["layer"] == "dept"], "Marta (not granted) sees Care internal notes")


def s_5_frameworks(org):
    a = org.ask("Jonas", Q_FRAME)
    rag = a.get("rag") or {}
    need(rag.get("frameworks"), "no frameworks in the pricing answer")
    t = rag_text(a)
    need(any(x in t for x in ("2,494", "2,750", "2,600", "3,100", "2494", "2750")), "no memo numbers in the answer")
    need("general" in t.lower() or "framework" in t.lower(), "frameworks not marked as general knowledge in text")
    need("t2-pricing-memo-2-21-oct" in rag.get("cited", []) or "t2-pricing-memo-2-21-oct" in t, "memo not cited")


def s_7_owner_hint(org):
    f = org.ask("Felix", Q_RESTR)
    need(any("clara" in h.lower() for h in f["hints"]), f"Felix: no hint to Clara: {f['hints']}")
    need("all-hands-notes-30-oct-2026" in blob(f), "Felix: all-hands wording missing")
    ft = blob(f)
    need("halden" not in ft and "board-meeting" not in ft and "board-deck" not in ft, "Felix sees board detail")
    s = org.ask("Felix", Q_SAL)
    need(any("hannah" in h.lower() for h in s["hints"]), f"Felix salary: no hint to Hannah: {s['hints']}")
    need("salary-bands-2026" not in blob(s), "Felix salary: sees the salary bands note")
    c = org.ask("Clara", Q_RESTR)
    need("board-meeting-2026-10-27" in blob(c) and "halden" in blob(c), "Clara does not get the board detail")
    p = blob(org.ask("Clara", Q_FELIX))
    need("felix-private-outside-offer" not in p and "munich" not in p and "78k" not in p, "Clara sees Felix's private note")


def s_6_not_dropped(org):
    titles = " ".join(n["title"].lower() for n in org.notes("Clara"))
    need("okrs" not in titles and "ticket spike" not in titles and "roadmap doubts" not in titles,
         "a _live file is already in Northwind (reset to restore the pre-demo state)")


# ---------------------------------------------------------------- mutating scenarios in a throwaway org

def make_scratch(src_policy):
    org_id = "scratch-check-" + secrets.token_hex(3)
    body = {"company_name": "Scratch check",
            "people": {pid: {k: p[k] for k in ("name", "title", "rank", "groups", "home")} for pid, p in src_policy["people"].items()},
            "areas": {s: {k: a.get(k, []) for k in ("name", "owner", "readers", "topics", "leads")} for s, a in src_policy["areas"].items()}}
    code, out = internal(org_id, "policy", "PUT", body)
    need(code == 200, f"create scratch org -> {code} {out}")
    return Org(org_id, yaml.safe_load((BASE / "brain-root" / org_id / "policy.yaml").read_text()))


def drop(org, who, layer, rel):
    p = RAW / rel
    code, out = multipart(org.view(who) + "api/upload", {"layer": layer}, p.name, p.read_bytes())
    need(code == 200 and out.get("imported"), f"{who} upload {rel} as {layer} -> {code} {out}")
    return out["imported"][0]["id"]


def run_mutate(emit):
    pol = None
    for d in (BASE / "brain-root").iterdir():
        if d.name in SEED_ORGS and (d / "policy.yaml").exists():
            pol = yaml.safe_load((d / "policy.yaml").read_text())
    sc = make_scratch(pol)
    print(f"# mutate checks run in throwaway org {sc.id} (Northwind untouched)")
    state = {}

    def commit(org):
        nid = drop(org, "Ingrid", "private", "private/ingrid/private-note-fast-charge.md")
        fel = drop(org, "Felix", "private", "private/felix/private-note-offer.md")
        cla = drop(org, "Clara", "private", "private/clara/private-note-halden-ceiling.md")
        state["fc"] = nid
        for who in ("Tobias", "Felix", "Priya", "Oskar", "Clara"):
            need(org.note(who, nid) is None, f"{who} sees it before commit")
        code, out = internal(org.id, f"notes/{nid}/move", "POST", {"to": "dept", "by": org.people["Ingrid"]})
        need(code == 200, f"commit -> {code} {out}")
        for who in ("Tobias", "Felix", "Priya", "Oskar"):
            need(org.note(who, nid) is not None, f"{who} cannot read it after commit")
        need(org.note("Clara", nid) is None, "Clara can read Ingrid's committed note")
        need(org.note("Daan", nid) is None, "Daan (Sales) can read it")
        need(org.note("Tobias", fel) is None and org.note("Tobias", cla) is None, "control private notes leaked")
        need(org.note("Felix", fel) is not None and org.note("Clara", cla) is not None, "authors lost their private notes")
        t = blob(org.ask("Tobias", Q_HEAT))
        need(nid in t, "Tobias's heat question does not find Ingrid's note after commit")
        t = blob(org.ask("Clara", Q_HEAT))
        need(nid not in t, "Clara's heat question finds it")

    def promote(org):
        nid = drop(org, "Ingrid", "dept", "product-engineering/bms-explained-for-everyone.md")
        need(org.note("Daan", nid) is None, "Daan reads it before promotion")
        row = {x["id"]: x for x in org.notes("Clara")}.get(nid)
        need(row is None or "core" not in row["can_move"], "Clara has a Promote option")
        trow = {x["id"]: x for x in org.notes("Tobias")}.get(nid)
        need(trow and "core" in trow["can_move"], "Tobias has no Promote option")
        code, out = internal(org.id, f"notes/{nid}/move", "POST", {"to": "core", "by": org.people["Clara"]})
        need(code == 403, f"Clara's promote was not refused ({code})")
        code, out = internal(org.id, f"notes/{nid}/move", "POST", {"to": "core", "by": org.people["Tobias"]})
        need(code == 200, f"Tobias promote -> {code} {out}")
        need(org.note("Daan", nid) is not None, "Daan cannot read it after promotion")
        need({x["id"]: x for x in org.notes("Daan")}[nid]["layer"] == "core", "note is not in the core layer")

    def live(org):
        okr = drop(org, "Clara", "core", "_live/company-okrs-2027.docx")
        care = drop(org, "Yara", "dept", "_live/care-ticket-spike-2026-11-03.csv")
        priv = drop(org, "Priya", "private", "_live/priya-roadmap-doubts.md")
        n = org.note("Daan", okr)
        need(n and "28" in n["body"], "Daan cannot read the OKRs (or no EUR 28.0M in them)")
        need(org.note("Lea", care) is not None, "Lea (granted) cannot read the ticket spike")
        need(org.note("Marta", care) is None, "Marta can read the ticket spike")
        need(org.note("Priya", priv) is not None and org.note("Tobias", priv) is None, "Priya's private note: wrong visibility")
        need(all(x["id"] != priv for who in ("Tobias", "Clara", "Yara") for x in org.notes(who)), "private live note in someone's list")
        need("rattle" in org.note("Lea", care)["body"].lower() or "23" in org.note("Lea", care)["body"], "ticket spike body lacks rattle/23")

    for name, fn in (("mutate/s2-commit-to-department", commit), ("mutate/s3-lead-promotes-to-core", promote), ("mutate/s6-live-ingest-right-rings", live)):
        emit(name, fn, sc)


# ---------------------------------------------------------------- runner

SEED_ORGS = set(json.loads((BASE / ".northwind-seed.json").read_text()))

SCENARIOS = [
    ("leak/private-notes-hidden-from-everyone-else", s_leak_private),
    ("access/member-sees-no-other-department-internals", s_dept_isolation),
    ("s1a/tobias-launch-15-march-with-april-conflict", s_1a_tobias),
    ("s1a/daan-launch-date-only", s_1a_daan),
    ("s1b/jonas-price-2690-replaces-2490", s_1b_jonas),
    ("s1b/daan-no-price-hint-to-jonas", s_1b_daan),
    ("s1c/elena-9-weeks-measured-beats-6-estimate", s_1c_elena),
    ("s1c/ines-9-weeks-only", s_1c_ines),
    ("s2/before-commit-only-ingrid-sees-it", s_2_before),
    ("s3/before-promote-daan-blind-clara-no-button", s_3_before),
    ("s3/lukas-request-pending-for-elena", s_3_pending),
    ("s4/grants-outsider-vs-colleague", s_4_grants),
    ("s5/pricing-answer-has-memo-numbers-and-frameworks", s_5_frameworks),
    ("s6/live-files-not-yet-in-northwind", s_6_not_dropped),
    ("s7/ask-the-owner-hints-and-board-detail", s_7_owner_hint),
]

ASKS = [("Tobias", Q_LAUNCH), ("Daan", Q_LAUNCH), ("Jonas", Q_PRICE), ("Daan", Q_PRICE), ("Jonas", Q_FRAME),
        ("Elena", Q_LEAD), ("Ines", Q_LEAD), ("Tobias", Q_HEAT), ("Clara", Q_HEAT), ("Felix", Q_HEAT), ("Daan", Q_BMS),
        ("Daan", Q_RESTR), ("Jonas", Q_PIPE), ("Noor", Q_PIPE), ("Felix", Q_RESTR), ("Felix", Q_SAL), ("Clara", Q_RESTR),
        ("Clara", Q_FELIX)]


def main():
    mutate = "--mutate" in sys.argv
    nw = None
    for oid in SEED_ORGS:
        f = BASE / "brain-root" / oid / "policy.yaml"
        if f.exists():
            nw = Org(oid, yaml.safe_load(f.read_text()))
    if nw is None:
        print("FAIL setup: Northwind org not found in brain-root")
        return 1
    fails = 0

    def emit(name, fn, org):
        nonlocal fails
        try:
            fn(org)
            print(f"PASS {name}", flush=True)
        except Fail as e:
            fails += 1
            print(f"FAIL {name}: {e}", flush=True)
        except Exception as e:  # script/brain error, still a FAIL line
            fails += 1
            print(f"FAIL {name}: {type(e).__name__}: {str(e)[:150]}", flush=True)

    try:
        jobs = list(ASKS) + [(v, q) for nid, (a, q) in PRIVATE.items() for v in ("Tobias", "Daan", "Mia", "Clara", "Felix", "Ingrid") if v != a]
        nw.prefetch(list(dict.fromkeys(jobs)))
    except Exception as e:
        print(f"# prefetch problem (checks will retry individually): {e}")
    for name, fn in SCENARIOS:
        emit(name, fn, nw)
    if mutate:
        try:
            run_mutate(emit)
        except Exception as e:
            fails += 1
            print(f"FAIL mutate/setup: {e}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
