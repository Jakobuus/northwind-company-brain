from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from brain.server import build_server


@pytest.fixture
def company(tmp_path):
    (tmp_path / "policy.yaml").write_text("""company: {id: tiny, name: Tiny Co}
people:
  maya: {name: Maya Lin, title: CEO, rank: 100, groups: [exec]}
  lena: {name: Lena Ortiz, title: Intern, rank: 20, groups: [marketing]}
areas:
  core: {name: Core, owner: maya, readers: [everyone]}
  leadership: {name: Leadership, owner: maya, readers: [exec], topics: [strategy]}
tokens: {maya-token: maya, lena-token: lena}
""")
    (tmp_path / "public.md").write_text("""---
id: public
title: Public plan
type: fact
area: core
access: all
author: lena
date: 2026-10-01
subject: strategy
attribute: plan
value: public plan
claim: remark
---
Our strategy is public.
""")
    (tmp_path / "secret.md").write_text("""---
id: secret
title: Private strategy
type: decision
area: leadership
access: restricted
author: maya
date: 2026-10-02
subject: strategy
attribute: plan
value: secret pivot
claim: decision
weight: high
---
The strategy is secret.
""")
    (tmp_path / "challenge.md").write_text("""---
id: challenge
title: Public strategy challenge
type: fact
area: core
access: all
author: lena
date: 2026-10-03
subject: strategy
attribute: plan
value: alternate public plan
claim: remark
---
Another strategy was proposed.
""")
    return tmp_path


def tool(client, token, name, arguments=None):
    response = client.post(f"/{token}/mcp", json={"jsonrpc": "2.0", "id": 1,
                           "method": "tools/call", "params": {"name": name,
                           "arguments": arguments or {}}},
                           headers={"accept": "application/json, text/event-stream"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "error" not in payload, payload
    return payload["result"]["structuredContent"]


def test_tools_are_person_specific_and_unreadable_is_missing(company):
    with TestClient(build_server(company).brain_app, base_url="http://localhost") as client:
        assert tool(client, "maya-token", "whoami")["id"] == "maya"
        assert tool(client, "lena-token", "whoami")["id"] == "lena"
        assert tool(client, "maya-token", "read_note", {"id": "secret"})["id"] == "secret"
        assert tool(client, "lena-token", "read_note", {"id": "secret"}) == tool(
            client, "lena-token", "read_note", {"id": "absent"})
        assert "secret" not in str(tool(client, "lena-token", "ask", {"question": "strategy"}))
        assert list(tool(client, "maya-token", "ask", {"question": "strategy"}))[:2] == ["present_as", "brief"]
        assert tool(client, "maya-token", "who_owns", {"topic": "strategy"})
        assert tool(client, "lena-token", "my_conflicts") == {"result": []}
        assert tool(client, "maya-token", "my_conflicts")["result"][0]["challenger"] == "challenge"
        assert "lena" in str(tool(client, "lena-token", "graph_link"))


def test_http_routes_and_unknown_token(company, tmp_path, monkeypatch):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>Brain graph</h1>")
    monkeypatch.setattr("brain.server.WEB_ROOT", web)
    with TestClient(build_server(company).brain_app, base_url="http://localhost") as client:
        assert client.post("/wrong/mcp").status_code == 404
        assert client.get("/").text == "<h1>Brain graph</h1>"
        assert len(client.get("/api/people").json()) == 2
        graph = client.get("/api/graph?person=maya&ghosts=1").json()
        assert set(graph) == {"nodes", "edges", "areas"}
        note = client.get("/api/note?person=maya&id=secret").json()
        assert set(note) == {"id", "title", "type", "area", "frontmatter", "body", "links"}
        assert client.get("/api/note?person=lena&id=secret").json() == client.get(
            "/api/note?person=lena&id=absent").json()
        packet = client.get("/api/ask?person=lena&q=strategy").json()
        assert set(packet) == {"question", "person", "hits", "resolutions", "hints", "summary", "rag", "brief"}
        assert packet["person"] == "lena"


def test_production_requires_token_and_local_fallback(company, monkeypatch):
    monkeypatch.setenv("BRAIN_DEMO", "0")
    monkeypatch.setenv("BRAIN_PERSON", "lena")
    with TestClient(build_server(company).brain_app, base_url="http://localhost") as client:
        assert client.get("/api/people").status_code == 404
        assert client.get("/api/graph?person=maya").status_code == 404
        assert client.get("/api/graph?token=maya-token").status_code == 200
        assert client.get("/api/graph?token=bad").status_code == 404
        assert tool(client, "lena-token", "whoami")["id"] == "lena"
        response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1,
                               "method": "tools/call", "params": {"name": "whoami", "arguments": {}}},
                               headers={"accept": "application/json, text/event-stream"})
        assert response.json()["result"]["structuredContent"]["id"] == "lena"


def test_reloads_after_mtime_change(company):
    server = build_server(company)
    before = server.brain_cache.get()
    path = company / "public.md"
    path.write_text(path.read_text().replace("Our strategy is public.", "Our strategy was updated."))
    assert server.brain_cache.get() is before
    server.brain_cache.checked_at -= 5
    after = server.brain_cache.get()
    assert after is not before
    assert "updated" in after.notes["public"].body


def test_host_origin_and_production_ghosts(company, monkeypatch):
    monkeypatch.setenv("BRAIN_BASE_URL", "https://brain.example:8443")
    monkeypatch.setenv("BRAIN_ALLOWED_HOSTS", "extra.example")
    monkeypatch.setenv("BRAIN_DEMO", "0")
    with TestClient(build_server(company).brain_app, base_url="http://localhost") as client:
        assert client.get("/api/graph?token=maya-token", headers={"host": "evil.example"}).status_code == 400
        assert client.get("/api/graph?token=maya-token", headers={"host": "brain.example:8443"}).status_code == 200
        assert client.get("/api/graph?token=maya-token", headers={"host": "extra.example"}).status_code == 200
        assert client.get("/api/graph?token=maya-token", headers={"origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/graph?token=maya-token", headers={"origin": "https://["}).status_code == 403
        assert client.get("/api/graph?token=maya-token", headers={"origin": "https://brain.example:8443"}).status_code == 200
        assert client.post("/maya-token/mcp", headers={"origin": "https://evil.example"}).status_code == 403
        graph = client.get("/api/graph?token=lena-token&ghosts=1").json()
        assert not any(node["locked"] for node in graph["nodes"])
