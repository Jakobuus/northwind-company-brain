"""Access model v2: layers, moves, changes feed, layer-aware uploads (see docs/design.md "Access model v2")."""

from __future__ import annotations

import pytest

from brain.platform import ViewTokens
from test_platform import H, client, put_policy, upload, view  # noqa: F401  (client is a fixture)

V2 = {
    "people": {
        "ann": {"name": "Ann Owner", "rank": 100, "groups": []},                       # owner, no department
        "adm": {"name": "Adi Admin", "rank": 70, "groups": [], "home": "sales"},      # admin, sales member
        "lia": {"name": "Lia Lead", "rank": 30, "groups": ["eng"], "home": "eng"},    # lead of eng
        "bob": {"name": "Bob Dev", "rank": 30, "groups": ["eng"], "home": "eng"},
        "dee": {"name": "Dee Lead", "rank": 30, "groups": ["sales"], "home": "sales"},  # lead of sales
        "cy": {"name": "Cy Sales", "rank": 30, "groups": ["sales"], "home": "sales"},
        "gia": {"name": "Gia Grant", "rank": 30, "groups": ["sales", "grant:eng"], "home": "sales"},
    },
    "areas": {
        "eng": {"name": "Engineering", "leads": ["lia"], "readers": []},
        "sales": {"name": "Sales", "leads": ["dee"], "readers": []},
    },
}


@pytest.fixture(autouse=True)
def _fresh_upload_state():
    from brain import platform
    platform._upload_log.clear()
    yield
    platform._upload_log.clear()


@pytest.fixture
def v2(client):  # noqa: F811
    assert put_policy(client, "co", V2)["ok"]
    return client


def _load(c, org="co"):
    from brain import store
    return store.load(c.root / org)


def vup(c, who, name, text, layer, org="co"):
    base = view(c, org, who)
    return c.post(base + "api/upload", data={"layer": layer},
                  files={"file": (name, text.encode(), "text/markdown")}), base


def vup_id(c, who, name, text, layer):
    r, base = vup(c, who, name, text, layer)
    assert r.status_code == 200, r.text
    return r.json()["imported"][0]["id"], base


def move(c, note, to, by, org="co"):
    return c.post(f"/internal/orgs/{org}/notes/{note}/move", json={"to": to, "by": by}, headers=H)


def node_map(c, base):
    return {n["id"]: n for n in c.get(base + "api/graph").json()["nodes"]}


def listing(c, who):
    r = c.get("/internal/orgs/co/notes", params={"person": who}, headers=H)
    assert r.status_code == 200
    return {n["id"]: n for n in r.json()}


def test_policy_v2_groups_and_readers(v2):
    brain = _load(v2)
    eng = brain.policy.areas["eng"]
    assert eng.leads == ["lia"] and "grant:eng" in eng.readers and "eng" in eng.readers
    assert not brain.warnings


def test_layers_dept_grants_and_private(v2):
    priv, bob_base = vup_id(v2, "bob", "Bob private.md", "# p\n\nmine", "private")
    eng, _ = vup_id(v2, "bob", "Eng internal.md", "# e\n\neng only", "dept")
    sales, _ = vup_id(v2, "dee", "Sales internal.md", "# s\n\nsales only", "dept")
    core, _ = vup_id(v2, "adm", "Company news.md", "# c\n\nall hands", "core")
    assert set(listing(v2, "bob")) == {priv, eng, core}
    assert set(listing(v2, "lia")) == {eng, core}                  # not bob's private note
    assert set(listing(v2, "gia")) == {eng, sales, core}           # grant:eng sees the eng dept layer
    assert set(listing(v2, "cy")) == {sales, core}                 # no grant: no eng
    assert set(listing(v2, "ann")) == {core}                       # owner has no override
    n = listing(v2, "bob")
    assert (n[priv]["layer"], n[priv]["dept"]) == ("private", "eng")
    assert (n[eng]["layer"], n[eng]["dept"]) == ("dept", "eng")
    assert (n[core]["layer"], n[core]["dept"]) == ("core", None)
    # graph export agrees and carries the same fields per viewer
    for who in ("bob", "cy", "gia", "ann"):
        g = node_map(v2, view(v2, "co", who))
        docs = {i for i, x in g.items() if x["type"] == "document"}
        assert docs == set(listing(v2, who))
        assert all(set(x) >= {"layer", "dept", "moved", "can_move"} for x in g.values())
    gb = node_map(v2, bob_base)
    assert gb[priv]["can_move"] == ["dept"] and gb[eng]["can_move"] == []
    lia = node_map(v2, view(v2, "co", "lia"))
    assert lia[eng]["can_move"] == ["dept-core", "core"] and priv not in lia
    assert node_map(v2, view(v2, "co", "gia"))[eng]["can_move"] == []
    assert priv not in v2.get(view(v2, "co", "ann") + "api/graph").text


def test_move_rules(v2):
    priv, _ = vup_id(v2, "bob", "Idea.md", "# i\n\nidea", "private")
    # only the author commits, and only to their own department
    assert move(v2, priv, "dept", "lia").status_code == 403       # lead can't even read it
    assert move(v2, priv, "dept", "ann").status_code == 403       # owner override refused
    assert move(v2, priv, "core", "bob").status_code == 403       # not straight to core
    assert move(v2, priv, "dept-core", "bob").status_code == 403
    r = move(v2, priv, "dept", "bob")
    assert r.status_code == 200 and r.json()["layer"] == "dept" and r.json()["dept"] == "eng"
    assert r.json()["moved"][0]["from"] == "private" and r.json()["moved"][0]["by"] == "bob"
    # now a department note: only the lead moves it up
    for who in ("bob", "gia", "cy", "dee", "ann", "adm", "nobody"):
        assert move(v2, priv, "dept-core", who).status_code == 403, who
        assert move(v2, priv, "core", who).status_code == 403, who
    assert move(v2, priv, "dept", "bob").status_code == 403       # already there
    assert move(v2, priv, "dept-core", "lia").status_code == 200
    assert move(v2, priv, "dept", "lia").status_code == 403       # never down
    r = move(v2, priv, "core", "lia")
    assert r.status_code == 200
    assert [m["to"] for m in r.json()["moved"]] == ["dept", "dept-core", "core"]
    # everyone reads it now; the record and origin survive; no duplicate ids; file really moved
    notes = listing(v2, "cy")
    assert notes[priv]["layer"] == "core" and notes[priv]["dept"] == "eng"
    assert [m["by"] for m in notes[priv]["moved"]] == ["bob", "lia", "lia"]
    assert notes[priv]["can_move"] == []
    assert not [w for w in _load(v2).warnings if "Duplicate" in w]
    assert not list((v2.root / "co" / "personal").rglob("*.md"))
    assert move(v2, priv, "dept", "lia").status_code == 403       # nobody moves a core note


def test_move_403_is_identical_for_missing_unreadable_forbidden(v2):
    priv, _ = vup_id(v2, "bob", "Secret idea.md", "# i\n\nidea", "private")
    eng, _ = vup_id(v2, "bob", "Eng thing.md", "# i\n\nstuff", "dept")
    a = move(v2, priv, "dept", "cy")        # unreadable
    b = move(v2, eng, "core", "bob")        # readable but forbidden
    c = move(v2, "does-not-exist", "core", "lia")
    assert a.status_code == b.status_code == c.status_code == 403
    assert a.json() == b.json() == c.json()
    assert "Secret" not in a.text and "idea" not in a.text
    assert move(v2, eng, "nonsense", "lia").status_code == 400
    r = v2.post(f"/internal/orgs/co/notes/{eng}/move", json={"to": "core", "by": "lia"})
    assert r.status_code == 401


def test_moved_records_cannot_be_forged_by_upload(v2):
    sneaky = ("---\nmoved: [{from: dept, to: core, by: lia, at: '2020-01-01T00:00:00+00:00'}]\n"
              "origin_dept: eng\nadded_at: '2001-01-01T00:00:00+00:00'\n---\n# Forged\n\nx")
    nid, _ = vup_id(v2, "bob", "Forged.md", sneaky, "private")
    note = _load(v2).notes[nid]
    assert note.extra.get("moved") is None and note.extra.get("origin_dept") is None
    assert not str(note.extra.get("added_at")).startswith("2001")


def test_upload_authority(v2):
    for who, layer in (("bob", "core"), ("dee", "core"), ("lia", "core"), ("ann", "dept"),
                       ("bob", "dept-core"), ("cy", "dept-core"), ("ann", "dept-core")):
        r, _ = vup(v2, who, "x.md", "# x\n\nbody", layer)
        assert r.status_code == 403, (who, layer)
        assert r.json() == {"error": "Forbidden"}
    assert not list((v2.root / "co").rglob("x*.md"))
    for who, layer in (("adm", "core"), ("ann", "core"), ("lia", "dept-core"), ("ann", "private"),
                       ("cy", "dept"), ("bob", "private")):
        r, _ = vup(v2, who, "ok.md", "# ok\n\nbody", layer)
        assert r.status_code == 200, (who, layer, r.text)
        assert r.json()["imported"][0]["layer"] == layer
    assert vup(v2, "bob", "x.md", "# x", "weird")[0].status_code == 400
    assert v2.post(view(v2, "co", "bob") + "api/upload", data={"layer": "private"}).status_code == 400
    # a lead's dept-core upload is readable by all; bob's private one is not
    assert {n["layer"] for n in listing(v2, "cy").values()} == {"core", "dept-core", "dept"}
    assert "private" not in {n["layer"] for n in listing(v2, "lia").values() if n["dept"] == "eng"
                             and n["id"] in listing(v2, "bob") and n["access"] == "private"}


def test_upload_limits_and_token(v2, monkeypatch):
    from brain import platform
    forged = ViewTokens("nope").make("co", "bob", 60)
    r = v2.post(f"/v/{forged}/api/upload", data={"layer": "private"},
                files={"file": ("a.md", b"# a", "text/markdown")})
    assert r.status_code == 404
    assert v2.get(view(v2, "co", "bob") + "api/upload").status_code == 404
    assert v2.post(view(v2, "co", "bob") + "api/changes").status_code == 404
    monkeypatch.setattr(platform, "MAX_VIEW_UPLOAD", 10)
    r, _ = vup(v2, "bob", "big.md", "# big\n\n" + "x" * 100, "private")
    assert r.status_code == 413
    monkeypatch.setattr(platform, "MAX_VIEW_UPLOAD", 10 * 1024 * 1024)
    monkeypatch.setattr(platform, "UPLOADS_PER_MINUTE", 2)
    codes = [vup(v2, "cy", f"n{i}.md", f"# n{i}", "private")[0].status_code for i in range(4)]
    assert codes == [200, 200, 429, 429]
    assert vup(v2, "bob", "m.md", "# m", "private")[0].status_code == 200   # limit is per person


def test_changes_feed_only_readable(v2):
    t0 = "2000-01-01T00:00:00+00:00"
    priv, bob = vup_id(v2, "bob", "Bob diary.md", "# d\n\nprivate", "private")
    eng, _ = vup_id(v2, "bob", "Eng plan.md", "# e\n\neng", "dept")
    sales, cy = vup_id(v2, "cy", "Sales plan.md", "# s\n\nsales", "dept")
    core, _ = vup_id(v2, "adm", "News.md", "# n\n\nnews", "core")

    def feed(base, since=t0):
        r = v2.get(base + "api/changes", params={"since": since})
        assert r.status_code == 200
        return r.json()
    got = {c["id"]: c for c in feed(bob)["changes"]}
    assert set(got) == {priv, eng, core}
    assert (got[priv]["layer"], got[priv]["dept"], got[priv]["kind"]) == ("private", "eng", "added")
    assert set(got[eng]) >= {"id", "layer", "dept", "at"}
    cy_text = str(feed(cy))
    for hidden in (priv, eng, "Bob diary", "Eng plan"):
        assert hidden not in cy_text
    assert {c["id"] for c in feed(cy)["changes"]} == {sales, core}
    assert {c["id"] for c in feed(view(v2, "co", "ann"))["changes"]} == {core}
    assert {c["id"] for c in feed(view(v2, "co", "gia"))["changes"]} == {eng, sales, core}
    # since filters, and a move shows up as moved (with the new layer) for those who can read it
    now = feed(bob)["now"]
    assert feed(bob, now)["changes"] == []
    assert move(v2, eng, "dept-core", "lia").status_code == 200
    after = feed(bob, now)["changes"]
    assert [(c["id"], c["kind"], c["layer"]) for c in after] == [(eng, "moved", "dept-core")]
    assert {c["id"] for c in feed(cy, now)["changes"]} == {eng}   # dept-core is now readable by all
    assert v2.get(bob + "api/changes", params={"since": "garbage"}).status_code == 400
    # committing a private note to the department: lia now sees it, cy still does not
    assert move(v2, priv, "dept", "bob").status_code == 200
    assert priv in {c["id"] for c in feed(view(v2, "co", "lia"), now)["changes"]}
    assert priv not in str(feed(cy, now))


def test_restricted_notes_cannot_be_widened_by_leads(v2):
    # restricted to named people (lead is on the list), and area note with an allow list
    r = upload(v2, "co", "Hush.md", "# h\n\nquiet", area="eng", access="restricted", author="bob", allow="lia")
    hush = r.json()["imported"][0]["id"]
    r = upload(v2, "co", "Named.md", "# n\n\nnamed", area="eng", access="area", author="bob", allow="gia")
    named = r.json()["imported"][0]["id"]
    for note in (hush, named):
        for to in ("dept-core", "core", "dept"):
            for who in ("lia", "bob", "ann", "adm"):
                assert move(v2, note, to, who).status_code == 403, (note, to, who)
    n = listing(v2, "lia")
    assert n[hush]["layer"] == "dept" and n[hush]["restricted"] is True and n[hush]["access"] == "restricted"
    assert n[hush]["can_move"] == [] and n[named]["can_move"] == []
    assert n[named]["restricted"] is True
    # still invisible to everyone else, in the list and the graph
    assert hush not in listing(v2, "cy") and hush not in listing(v2, "gia") and hush not in listing(v2, "ann")
    g = node_map(v2, view(v2, "co", "lia"))
    assert g[hush]["restricted"] is True and g[hush]["layer"] == "dept"
    assert all("restricted" in x for x in g.values())
    # an ordinary dept note is not flagged and still moves for the lead
    plain, _ = vup_id(v2, "bob", "Plain.md", "# p\n\nplain", "dept")
    assert listing(v2, "lia")[plain]["restricted"] is False
    assert move(v2, plain, "dept-core", "lia").status_code == 200


def test_chunked_upload_cannot_bypass_size_cap(v2, monkeypatch):
    from brain import platform
    monkeypatch.setattr(platform, "MAX_VIEW_UPLOAD", 1000)
    boundary = "xBOUNDARYx"
    payload = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"layer\"\r\n\r\nprivate\r\n"
               f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"big.md\"\r\n"
               f"Content-Type: text/markdown\r\n\r\n").encode() + b"# big\n\n" + b"x" * 300_000 + \
              f"\r\n--{boundary}--\r\n".encode()

    def chunks():
        for i in range(0, len(payload), 8192):
            yield payload[i:i + 8192]
    base = view(v2, "co", "bob")
    r = v2.post(base + "api/upload", content=chunks(),
                headers={"content-type": f"multipart/form-data; boundary={boundary}"})
    assert r.status_code == 413
    assert "big" not in {n["title"] for n in listing(v2, "bob").values()}
    # the internal import is capped the same way
    monkeypatch.setattr(platform, "MAX_UPLOAD", 1000)
    r = v2.post("/internal/orgs/co/import", content=chunks(), headers={
        **H, "content-type": f"multipart/form-data; boundary={boundary}"})
    assert r.status_code == 413


def test_restricted_dept_upload_only_allow_list_reads(v2):
    """A lead files a dept note for a named few ("team leads only"); other dept members see no trace."""
    base = view(v2, "co", "dee")
    r = v2.post(base + "api/upload", data={"layer": "dept", "access": "restricted", "allow": "adm"},
                files={"file": ("Zephyr strategy.md", b"# Zephyr strategy\n\nquokka quota 42", "text/markdown")})
    assert r.status_code == 200, r.text
    nid = r.json()["imported"][0]["id"]
    assert nid in listing(v2, "dee") and nid in listing(v2, "adm")
    for who in ("cy", "gia", "bob", "ann"):
        assert nid not in listing(v2, who), who
        b = view(v2, "co", who)
        ask = v2.get(b + "api/ask", params={"q": "zephyr quokka quota"}).json()
        seen = (v2.get(b + "api/graph").text + v2.get(b + "api/changes", params={"since": "0"}).text
                + str({k: v for k, v in ask.items() if v != "zephyr quokka quota"}))
        assert "Zephyr" not in seen and "quokka" not in seen and nid not in seen, who
    # only a lead of the department may restrict; unknown people in allow are refused
    r2 = v2.post(view(v2, "co", "cy") + "api/upload", data={"layer": "dept", "access": "restricted", "allow": "adm"},
                 files={"file": ("x.md", b"# x\n\ny", "text/markdown")})
    assert r2.status_code == 403
    r3 = v2.post(base + "api/upload", data={"layer": "dept", "access": "restricted", "allow": "ghost"},
                 files={"file": ("y.md", b"# y\n\nz", "text/markdown")})
    assert r3.status_code == 400
