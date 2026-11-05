"""Contract from raw intake files through the public HTTP and MCP interfaces."""

import asyncio
import subprocess
import sys

import httpx2 as httpx
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from starlette.testclient import TestClient

from brain.server import build_server


def assert_people_contract(people):
    assert isinstance(people, list) and people
    for person in people:
        assert set(person) == {"id", "name", "title"}, "people keys"
        assert all(isinstance(person[key], str) for key in person), "people types"


def assert_graph_contract(graph):
    assert set(graph) == {"nodes", "edges", "areas"}, "graph keys"
    assert all(isinstance(graph[key], list) for key in graph), "graph list types"
    assert graph["nodes"] and graph["edges"] and graph["areas"]
    for node in graph["nodes"]:
        keys = {"id", "title", "type", "area", "access", "locked"}
        if not node["locked"]:
            keys |= {"status", "date", "author", "claim", "weight", "layer", "dept", "restricted", "moved", "can_move"}
        assert set(node) == keys, "graph node keys"
        assert all(isinstance(node[key], str) for key in ("id", "title", "type", "area", "access"))
        assert type(node["locked"]) is bool, "graph node locked type"
        if not node["locked"]:
            assert isinstance(node["status"], str), "graph node status type"
            assert all(node[key] is None or isinstance(node[key], str)
                       for key in ("date", "author", "claim", "weight")), "graph node optional types"
    for edge in graph["edges"]:
        assert set(edge) == {"source", "target", "kind"}, "graph edge keys"
        assert all(isinstance(value, str) for value in edge.values()), "graph edge types"
    for area in graph["areas"]:
        keys = {"id", "name", "owner", "owner_name", "color", "open", "kind"}
        if area["kind"] == "personal":
            keys |= {"person", "home"}
        assert set(area) == keys, "graph area keys"
        assert all(area[key] is None or isinstance(area[key], str) for key in keys - {"open"}), "graph area types"
        assert type(area["open"]) is bool, "graph area open type"
        assert area["kind"] in {"core", "department", "personal"}


def assert_note_contract(note):
    assert set(note) == {"id", "title", "type", "area", "frontmatter", "body", "links"}, "note keys"
    assert all(isinstance(note[key], str) for key in ("id", "title", "type", "area", "body")), "note text types"
    assert isinstance(note["frontmatter"], dict), "note frontmatter type"
    assert isinstance(note["links"], list), "note links type"
    for link in note["links"]:
        assert set(link) == {"id", "title"}, "note link keys"
        assert all(isinstance(value, str) for value in link.values()), "note link types"


def assert_ask_contract(packet):
    assert set(packet) == {"question", "person", "hits", "resolutions", "hints", "summary", "brief"} | ({"rag"} & set(packet)), "ask keys"
    assert all(isinstance(packet[key], str) for key in ("question", "person", "summary")), "ask text types"
    assert all(isinstance(packet[key], list) for key in ("hits", "resolutions", "hints")), "ask list types"
    assert all(isinstance(hint, str) for hint in packet["hints"]), "ask hint types"
    for hit in packet["hits"]:
        assert set(hit) == {"id", "title", "type", "area", "date", "author", "snippet", "score", "via"}, "ask hit keys"
        assert all(isinstance(hit[key], str) for key in ("id", "title", "type", "area", "snippet", "via")), "ask hit text types"
        assert hit["date"] is None or isinstance(hit["date"], str), "ask hit date type"
        assert hit["author"] is None or isinstance(hit["author"], str), "ask hit author type"
        assert type(hit["score"]) in (int, float), "ask hit score type"
    for resolution in packet["resolutions"]:
        assert set(resolution) == {"key", "winner", "superseded", "conflicts", "reason"}, "ask resolution keys"
        assert isinstance(resolution["key"], list) and len(resolution["key"]) == 2
        assert all(isinstance(value, str) for value in resolution["key"]), "ask resolution key types"
        assert isinstance(resolution["reason"], str), "ask resolution reason type"
        assert set(resolution["winner"]) == {"id", "title", "value", "date", "author_name"}, "ask winner keys"
        assert all(value is None or isinstance(value, str) for value in resolution["winner"].values()), "ask winner types"
        assert isinstance(resolution["superseded"], list) and isinstance(resolution["conflicts"], list)
        for loser in resolution["superseded"]:
            assert set(loser) == {"id", "title", "value", "date"}, "ask superseded keys"
            assert all(value is None or isinstance(value, str) for value in loser.values()), "ask superseded types"
        for conflict in resolution["conflicts"]:
            assert set(conflict) == {"winner", "challenger", "severity", "route_to", "reason"}, "ask conflict keys"
            assert all(value is None or isinstance(value, str) for value in conflict.values()), "ask conflict types"


def test_raw_intake_to_http_and_mcp_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_DEMO", "1")
    monkeypatch.delenv("BRAIN_PERSON", raising=False)
    raw = tmp_path / "raw"
    raw.mkdir()
    data = tmp_path / "data"
    data.mkdir()
    (data / "policy.yaml").write_text("""company: {id: tiny, name: Tiny Co}
people:
  maya: {name: Maya Lin, title: CEO, rank: 100, groups: [exec], home: leadership}
  raj: {name: Raj Patel, title: Sales Lead, rank: 60, groups: [sales], home: sales}
  lena: {name: Lena Ortiz, title: Analyst, rank: 20, groups: [sales], home: sales}
  theo: {name: Theo Park, title: Designer, rank: 20, groups: [design]}
areas:
  core: {name: Core, owner: maya, readers: [everyone]}
  leadership: {name: Leadership, owner: maya, readers: [exec], topics: [strategy]}
  sales: {name: Sales, owner: raj, readers: [sales, exec]}
tokens: {lena-token: lena}
""")
    (raw / "memo.md").write_text("""---
id: launch-target
title: Launch target memo
type: fact
author: Raj Patel
date: 2026-11-04
area: core
access: all
subject: launch
attribute: target
value: 200 signups
claim: target
---
The launch target is 200 signups. [[sales-table]]
""")
    (raw / "exec.transcript").write_text(
        "[00:01] Maya Lin: Strategy review.\nRaj Patel: Sales is ready.\nLena Ortiz: I will follow up.\n"
    )
    (raw / "sales-table.csv").write_text("team,signups\nSales,200\n")
    (raw / "personal.md").write_text("My private planning detail: blue lantern.\n")

    def cli(*args):
        return subprocess.run([sys.executable, "-m", "brain.intake.cli", *map(str, args)],
                              capture_output=True, text=True, check=True)

    cli("import", raw / "memo.md", "--data", data)
    cli("import", raw / "exec.transcript", "--data", data, "--area", "leadership", "--author", "maya")
    cli("import", raw / "sales-table.csv", "--data", data, "--area", "sales", "--author", "raj")
    cli("import", raw / "personal.md", "--data", data, "--personal", "lena")
    assert "Validation: 0 problem(s)" in cli("validate", "--data", data).stdout

    server = build_server(data)
    with TestClient(server.brain_app, base_url="http://localhost") as client:
        people = client.get("/api/people").json()
        assert_people_contract(people)
        assert {person["id"] for person in people} == {"maya", "raj", "lena", "theo"}

        graph = client.get("/api/graph", params={"person": "lena", "ghosts": "1"}).json()
        assert_graph_contract(graph)
        areas = {area["id"]: area for area in graph["areas"]}
        assert areas["personal-lena"]["person"] == "lena"
        assert areas["personal-lena"]["home"] == "sales"
        assert areas["personal-lena"]["open"] is True
        assert areas["personal-maya"]["open"] is False
        assert {node["access"] for node in graph["nodes"]} >= {"all", "area", "restricted", "private"}
        assert any(node["id"] == "personal" for node in graph["nodes"])
        assert any(edge["kind"] == "link" for edge in graph["edges"])
        maya_graph = client.get("/api/graph", params={"person": "maya"}).json()
        assert_graph_contract(maya_graph)
        assert "personal" not in {node["id"] for node in maya_graph["nodes"]}

        memo = client.get("/api/note", params={"person": "lena", "id": "launch-target"}).json()
        assert_note_contract(memo)
        assert memo["links"] == [{"id": "sales-table", "title": "sales-table"}]
        personal = client.get("/api/note", params={"person": "lena", "id": "personal"}).json()
        assert_note_contract(personal)
        assert personal["frontmatter"]["access"] == "private"
        meeting = client.get("/api/note", params={"person": "lena", "id": "exec"}).json()
        assert_note_contract(meeting)
        assert meeting["frontmatter"]["allow"] == ["maya", "raj", "lena"]
        assert client.get("/api/note", params={"person": "theo", "id": "exec"}).status_code == 404
        denied = client.get("/api/note", params={"person": "maya", "id": "personal"})
        absent = client.get("/api/note", params={"person": "maya", "id": "absent"})
        assert denied.status_code == absent.status_code == 404
        assert denied.json() == absent.json()

        response = client.get("/api/ask", params={"person": "lena", "q": "launch target"})
        assert response.status_code == 200
        packet = response.json()
        assert_ask_contract(packet)
        assert packet["question"] == "launch target" and packet["person"] == "lena"
        assert packet["hits"] and packet["resolutions"]
        assert packet["resolutions"][0]["winner"]["value"] == "200 signups"

    async def call_mcp():
        transport = StreamableHttpTransport(
            "http://localhost/lena-token/mcp",
            httpx_client_factory=lambda **kwargs: httpx.AsyncClient(
                transport=httpx.ASGITransport(app=server.brain_app), **kwargs),
        )
        async with Client(transport) as mcp_client:
            return await mcp_client.call_tool("ask", {"question": "launch target"})

    with TestClient(server.brain_app, base_url="http://localhost"):
        mcp_result = asyncio.run(call_mcp())
    assert not mcp_result.is_error
    out = mcp_result.structured_content
    assert list(out)[:2] == ["present_as", "brief"]
    assert set(out) <= {"present_as", "brief", "sources", "hints", "frameworks", "evidence"}
    assert out["brief"] == packet["brief"] and out["hints"] == packet["hints"]
    assert len(out["evidence"]) <= 4
