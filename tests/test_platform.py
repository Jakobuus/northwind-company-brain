"""Platform mode: many orgs under one root, internal api, signed view links, per-org MCP links."""

from __future__ import annotations

import time

import pytest
from starlette.testclient import TestClient

from brain.platform import ViewTokens, build_platform_app

SECRET = "test-secret-0123456789"
H = {"X-Brain-Service": SECRET}
POLICY = {
    "people": {
        "ann": {"name": "Ann A", "title": "CEO", "rank": 100, "groups": ["exec"], "home": "lead"},
        "bob": {"name": "Bob B", "title": "Dev", "rank": 30, "groups": ["eng"], "home": "eng"},
        "cat": {"name": "Cat C", "title": "Sales", "rank": 30, "groups": ["sales"], "home": None},
    },
    "areas": {
        "lead": {"name": "Leadership", "owner": "ann", "readers": ["exec"], "topics": ["strategy"]},
        "eng": {"name": "Engineering", "owner": "bob", "readers": ["eng"], "topics": ["firmware"]},
    },
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_EMBED", "0")
    monkeypatch.setenv("BRAIN_PUBLIC_URL", "http://localhost")
    app = build_platform_app(tmp_path / "root", SECRET)
    with TestClient(app, base_url="http://localhost") as c:
        c.root = tmp_path / "root"
        yield c


def put_policy(c, org="acme", body=POLICY):
    r = c.put(f"/internal/orgs/{org}/policy", json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def upload(c, org, name, text, **fields):
    data = {"area": "core", "access": "all", "author": "ann", **fields}
    return c.post(f"/internal/orgs/{org}/import", data=data, headers=H,
                  files={"file": (name, text.encode(), "text/markdown")})


def view(c, org, person, ttl=3600):
    r = c.post(f"/internal/orgs/{org}/view-token", json={"person": person, "ttl_seconds": ttl}, headers=H)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("http://localhost/v/") and url.endswith("/")
    return url[len("http://localhost"):]


@pytest.fixture
def org(client):
    assert put_policy(client) == {"ok": True, "people": 3, "areas": 3}
    assert upload(client, "acme", "Public plan.md", "# Public plan\n\nOpen to all.").status_code == 200
    r = upload(client, "acme", "Salary review.md", "# Salary review\n\nSecret numbers.",
               access="restricted", author="ann", allow="bob")
    assert r.status_code == 200 and r.json()["imported"][0]["title"]
    r = upload(client, "acme", "Ann diary.md", "# Ann diary\n\nPrivate thoughts.", access="private", author="ann")
    assert r.status_code == 200
    r = upload(client, "acme", "Firmware plan.md", "# Firmware plan\n\nEngineering only.", area="eng", access="area", author="bob")
    assert r.status_code == 200
    return client


def titles(c, org, person):
    r = c.get(f"/internal/orgs/{org}/notes", params={"person": person}, headers=H)
    assert r.status_code == 200
    return {n["title"] for n in r.json()}


# ---------------------------------------------------------------- auth

@pytest.mark.parametrize("method,path", [
    ("PUT", "/internal/orgs/acme/policy"), ("POST", "/internal/orgs/acme/import"),
    ("GET", "/internal/orgs/acme/notes?person=ann"), ("POST", "/internal/orgs/acme/view-token"),
    ("GET", "/internal/orgs/acme/mcp-link?person=ann")])
def test_internal_needs_secret(org, method, path):
    assert org.request(method, path).status_code == 401
    assert org.request(method, path, headers={"X-Brain-Service": "wrong"}).status_code == 401
    assert org.request(method, path, headers={"X-Brain-Service": SECRET[:-1]}).status_code == 401


def test_bad_org_ids_rejected(client):
    for bad in ("..", "a.b", "a%2Fb", "x" * 65, "%2e%2e"):
        r = client.put(f"/internal/orgs/{bad}/policy", json=POLICY, headers=H)
        assert r.status_code in (400, 404), (bad, r.status_code)
    assert not (client.root.parent / "policy.yaml").exists()
    assert list(client.root.iterdir()) == []


def test_policy_validation_and_tokens_kept(client):
    assert client.put("/internal/orgs/acme/policy", json={"people": []}, headers=H).status_code == 400
    bad = {"people": {"../x": {"name": "x"}}}
    assert client.put("/internal/orgs/acme/policy", json=bad, headers=H).status_code == 400
    put_policy(client)
    link = client.get("/internal/orgs/acme/mcp-link", params={"person": "bob"}, headers=H).json()["url"]
    put_policy(client)  # re-sync keeps the token
    assert client.get("/internal/orgs/acme/mcp-link", params={"person": "bob"}, headers=H).json()["url"] == link
    smaller = {"people": {"ann": POLICY["people"]["ann"]}, "areas": {}}
    assert put_policy(client, body=smaller)["people"] == 1  # bob gone: his link dies
    assert client.post(link.replace("http://localhost", ""), json={}).status_code == 404


# ---------------------------------------------------------------- access through upload

def test_notes_list_respects_access(org):
    assert titles(org, "acme", "ann") == {"Public plan", "Salary review", "Ann diary"}
    assert titles(org, "acme", "bob") == {"Public plan", "Salary review", "Firmware plan"}
    assert titles(org, "acme", "cat") == {"Public plan"}
    assert org.get("/internal/orgs/acme/notes", params={"person": "zed"}, headers=H).status_code == 404


def test_upload_frontmatter_cannot_widen_access(org):
    sneaky = "---\naccess: all\narea: core\nauthor: cat\n---\n# Sneaky\n\nbody"
    assert upload(org, "acme", "Sneaky.md", sneaky, access="private", author="ann").status_code == 200
    assert "Sneaky" in titles(org, "acme", "ann")
    assert "Sneaky" not in titles(org, "acme", "cat") | titles(org, "acme", "bob")


def test_upload_validation(org):
    assert upload(org, "acme", "x.md", "# x", author="nobody").status_code == 400
    assert upload(org, "acme", "x.md", "# x", area="personal-ann").status_code == 400
    assert upload(org, "acme", "x.md", "# x", allow="ghost").status_code == 400
    assert upload(org, "acme", "x.md", "# x", access="public").status_code == 400
    assert upload(org, "nope", "x.md", "# x").status_code == 404
    r = upload(org, "acme", "../../evil.md", "# Evil\n\nbody")
    assert r.status_code == 200
    found = list(org.root.parent.rglob("evil.md"))
    assert found and all(p.resolve().is_relative_to((org.root / "acme").resolve()) for p in found)
    r = org.post("/internal/orgs/acme/import", data={"author": "ann"}, headers=H)
    assert r.status_code == 400


# ---------------------------------------------------------------- view links

def test_view_pages_and_static(org):
    base = view(org, "acme", "bob")
    page = org.get(base)
    assert page.status_code == 200 and "<html" in page.text.lower()
    assert org.get(base + "how.html").status_code == 200
    assert org.get(base + "graph.js").status_code == 200
    assert org.get(base.rstrip("/")).status_code in (200, 308)


def test_view_is_fixed_to_person(org):
    ann, bob, cat = (view(org, "acme", p) for p in ("ann", "bob", "cat"))

    def graph(base, extra=""):
        r = org.get(base + "api/graph" + extra)
        assert r.status_code == 200
        return r.json()

    def open_titles(g):
        return {n["title"] for n in g["nodes"] if n["type"] == "document" and not n["locked"]}
    assert open_titles(graph(ann)) == {"Public plan", "Salary review", "Ann diary"}
    assert open_titles(graph(bob)) == {"Public plan", "Salary review", "Firmware plan"}
    assert open_titles(graph(cat)) == {"Public plan"}
    # ?person= and ?token= are ignored: cat cannot become ann
    assert open_titles(graph(cat, "?person=ann&token=ann&ghosts=1")) == {"Public plan"}
    assert org.get(cat + "api/people").status_code == 404
    everything = str(graph(cat, "?person=ann")) + org.get(cat + "api/ask?q=salary+diary+firmware").text
    for word in ("Salary review", "Secret numbers", "Ann diary", "Private thoughts", "Firmware plan"):
        assert word not in everything
    # note reads
    ids = {n["title"]: n["id"] for n in graph(ann)["nodes"] if n["type"] == "document"}
    assert org.get(ann + f"api/note?id={ids['Ann diary']}").status_code == 200
    for who in (bob, cat):
        r = org.get(who + f"api/note?id={ids['Ann diary']}")
        assert r.status_code == 404 and "Private thoughts" not in r.text
        assert r.json() == org.get(who + "api/note?id=absent").json()
    assert org.get(cat + f"api/note?id={ids['Salary review']}&person=ann").status_code == 404
    assert org.get(bob + f"api/note?id={ids['Salary review']}").status_code == 200
    r = org.get(cat + "api/who?q=salary")
    assert "Secret" not in r.text


def test_tampered_expired_and_foreign_tokens(org, client):
    unknown = org.get("/nothing/here")
    assert unknown.status_code == 404
    good = view(org, "acme", "cat")
    token = good.split("/")[2]
    body, sig = token.split(".")
    flipped = ("A" if body[0] != "A" else "B") + body[1:]
    forged = ViewTokens("another-secret-value").make("acme", "ann", 3600)
    expired = ViewTokens(SECRET).make("acme", "ann", -10)
    for bad in (f"{flipped}.{sig}", token + "x", forged, expired, "garbage", "a.b", "."):
        for tail in ("", "api/graph", "how.html"):
            r = org.get(f"/v/{bad}/{tail}")
            assert r.status_code == 404 and r.text == unknown.text, (bad, tail)
    # token for ann swapped into cat's signature
    ann_token = view(org, "acme", "ann").split("/")[2]
    r = org.get(f"/v/{ann_token.split('.')[0]}.{sig}/api/graph")
    assert r.status_code == 404
    # not served through a view link
    assert org.get(good + "mcp").status_code == 404
    assert org.post(good + "api/graph").status_code == 404


def test_org_isolation(org):
    put_policy(org, "other", {"people": {"ann": {"name": "Other Ann", "rank": 100, "groups": []}}, "areas": {}})
    assert upload(org, "other", "Other secret.md", "# Other secret\n\nzzz").status_code == 200
    a_acme, a_other = view(org, "acme", "ann"), view(org, "other", "ann")
    acme = str(org.get(a_acme + "api/graph").json())
    other = str(org.get(a_other + "api/graph").json())
    assert "Other secret" not in acme and "Public plan" not in other
    # a token for an org that does not exist
    forged = ViewTokens(SECRET).make("ghostorg", "ann", 60)
    assert org.get(f"/v/{forged}/api/graph").status_code == 404
    # nonexistent person
    r = org.post("/internal/orgs/acme/view-token", json={"person": "zed"}, headers=H)
    assert r.status_code == 404
    # removed person's old link stops working
    put_policy(org, body={"people": {"ann": POLICY["people"]["ann"]}, "areas": {}})
    assert org.get(view_url_for(org, "ann") + "api/graph").status_code == 200
    assert org.get(view_cat_old(org)).status_code == 404


def view_url_for(c, person):
    return view(c, "acme", person)


def view_cat_old(c):
    token = ViewTokens(SECRET).make("acme", "cat", 60)
    return f"/v/{token}/api/graph"


# ---------------------------------------------------------------- mcp

def mcp_call(c, path, name, arguments=None):
    r = c.post(path, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                           "params": {"name": name, "arguments": arguments or {}}},
               headers={"accept": "application/json, text/event-stream"})
    assert r.status_code == 200, r.text
    return r.json()["result"]["structuredContent"]


def test_mcp_links_per_org(org):
    put_policy(org, "other", {"people": {"ann": {"name": "Other Ann", "rank": 100, "groups": []}}, "areas": {}})
    link = org.get("/internal/orgs/acme/mcp-link", params={"person": "cat"}, headers=H).json()["url"]
    path = link[len("http://localhost"):]
    assert path.endswith("/mcp") and path.startswith("/acme.")
    assert mcp_call(org, path, "whoami")["id"] == "cat"
    text = str(mcp_call(org, path, "ask", {"question": "salary diary firmware"}))
    for word in ("Salary review", "Secret numbers", "Ann diary", "Firmware plan"):
        assert word not in text
    assert "/v/" in mcp_call(org, path, "graph_link")["result"]
    # same token string under another org is unknown; random tokens too
    assert org.post(path.replace("/acme.", "/other."), json={}).status_code == 404
    assert org.post("/acme.nottoken/mcp", json={}).status_code == 404
    assert org.post("/mcp", json={}).status_code == 404
    other = org.get("/internal/orgs/other/mcp-link", params={"person": "ann"}, headers=H).json()["url"]
    assert mcp_call(org, other[len("http://localhost"):], "whoami")["id"] == "ann"
    assert org.get("/internal/orgs/acme/mcp-link", params={"person": "zed"}, headers=H).status_code == 404


def test_view_token_ttl_bounds(org):
    for ttl in (0, -5, 10**9, "x", True):
        r = org.post("/internal/orgs/acme/view-token", json={"person": "ann", "ttl_seconds": ttl}, headers=H)
        assert r.status_code == 400
    short = view(org, "acme", "ann", ttl=1)
    time.sleep(2.1)
    assert org.get(short + "api/graph").status_code == 404


# ---------------------------------------------------------------- upload cannot shadow or out-rank notes

def _load(c, org="acme"):
    from brain import store
    return store.load(c.root / org)


def test_upload_gets_fresh_id_and_no_precedence_keys(org):
    before = _load(org)
    target = next(n for n in before.notes.values() if n.title == "Firmware plan")
    sneaky = (f"---\nid: {target.id}\ntype: decision\nsubject: fw\nattribute: plan\nvalue: hijacked\n"
              f"claim: decision\nweight: high\nreplaces: [{target.id}]\nstatus: current\nmyflag: kept\n---\n"
              "# Hijack\n\nbody")
    r = upload(org, "acme", "Hijack.md", sneaky)
    assert r.status_code == 200
    new_id = r.json()["imported"][0]["id"]
    after = _load(org)
    assert new_id != target.id and not [w for w in after.warnings if "Duplicate" in w]
    assert len(after.notes) == len(before.notes) + 1
    assert after.notes[target.id].body == target.body and after.notes[target.id].area == "eng"
    note = after.notes[new_id]
    assert (note.type, note.replaces, note.weight, note.claim, note.subject, note.value) == (
        "document", [], "normal", None, None, None)
    assert note.extra.get("myflag") == "kept"


def test_same_title_in_two_areas_gets_distinct_ids(org):
    first = upload(org, "acme", "Budget.md", "# Budget\n\none").json()["imported"][0]["id"]
    second = upload(org, "acme", "Budget.md", "# Budget\n\ntwo", area="eng", access="area",
                    author="bob").json()["imported"][0]["id"]
    third = upload(org, "acme", "Budget.md", "# Budget\n\nthree").json()["imported"][0]["id"]
    assert len({first, second, third}) == 3
    notes = _load(org).notes
    assert [notes[i].body.split()[-1] for i in (first, second, third)] == ["one", "two", "three"]


def test_write_rejects_existing_id(org, monkeypatch):
    from brain import platform
    existing = next(n for n in _load(org).notes.values() if n.title == "Firmware plan")
    monkeypatch.setattr(platform, "_fresh_id", lambda *a, **k: existing.id)
    r = upload(org, "acme", "Another.md", "# Another\n\nbody")
    assert r.status_code == 400
    after = _load(org)
    assert after.notes[existing.id].body == existing.body
    assert not [w for w in after.warnings if "Duplicate" in w]
