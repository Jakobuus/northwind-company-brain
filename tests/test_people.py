from __future__ import annotations

from starlette.testclient import TestClient

from brain import access, graph, people
from brain.server import build_server
from brain.store import load


def _note(root, name, header, body):
    (root / f"{name}.md").write_text(f"---\n{header}\n---\n{body}\n")


def fixture(root):
    (root / "policy.yaml").write_text("""company: {id: tiny, name: Tiny Co}
people:
  maya: {name: Maya, title: CEO, rank: 100, groups: [exec], home: leadership}
  raj: {name: Raj, title: Lead, rank: 60, groups: [sales], home: sales, expertise: [forecasting]}
  lena: {name: Lena, title: Intern, rank: 20, groups: [sales], home: sales}
areas:
  core: {name: Core, owner: maya, readers: [everyone]}
  sales: {name: Sales, owner: raj, readers: [sales, exec]}
  leadership: {name: Leadership, owner: maya, readers: [exec], topics: [m&a]}
tokens: {lena-token: lena, maya-token: maya}
""")
    _note(root, "raj-profile", "id: raj-profile\ntype: person\nperson: raj\narea: core\naccess: all\nexpertise: [pricing]\nteam: Sales\nrole: Lead", "Raj profile")
    _note(root, "sales-fact", "id: sales-fact\ntype: fact\narea: sales\naccess: area\nauthor: raj\nsubject: pipeline\nattribute: forecast", "Pipeline forecast and revenue model")
    _note(root, "sales-meeting", "id: sales-meeting\ntype: meeting\narea: sales\naccess: restricted\nauthor: raj\nallow: [raj, lena]", "Revenue planning with Lena and Raj")
    _note(root, "secret", "id: secret\ntype: decision\narea: leadership\naccess: restricted\nauthor: maya\nsubject: m&a\nattribute: plan", "Acquisition negotiation, board offer")
    _note(root, "secret-meeting", "id: secret-meeting\ntype: meeting\narea: leadership\naccess: restricted\nauthor: maya\nallow: [maya, raj]", "M&A acquisition planning")
    _note(root, "private", "id: private\ntype: document\narea: personal-maya\naccess: private\nauthor: maya", "M&A confidential personal thoughts")
    return load(root)


def test_declared_and_viewer_specific_activity(tmp_path):
    brain = fixture(tmp_path)
    raj = people.profile(brain, "lena", "raj")
    assert set(raj["declared"]) == {"forecasting", "pricing"}
    assert raj["home"] == "sales" and raj["groups"] == ["sales"]
    assert any(item["topic"] == "pipeline" and item["evidence"] == ["sales-fact"]
               for item in raj["activity"])
    assert raj["collaborators"] == [{"id": "lena", "name": "Lena",
                                     "shared_notes": ["sales-meeting"]}]
    for person_id in brain.policy.people:
        for topic in people.profile(brain, "lena", person_id)["activity"]:
            assert all(access.can_read(brain, "lena", brain.notes[note_id])
                       for note_id in topic["evidence"])
    assert people.who_knows(brain, "lena", "m&a") == []
    maya = people.who_knows(brain, "maya", "m&a")
    assert maya and maya[0]["id"] == "maya"
    assert "secret" in {note_id for row in maya for topic in row["evidence"]
                        for note_id in topic["evidence"]}
    assert "secret-meeting" not in {id for item in raj["collaborators"]
                                     for id in item["shared_notes"]}


def test_declared_expertise_respects_note_access(tmp_path):
    brain = fixture(tmp_path)
    _note(tmp_path, "raj-hr", "id: raj-hr\ntype: person\nperson: raj\narea: leadership\naccess: restricted\nauthor: maya\nexpertise: [acme acquisition target]", "HR file")
    brain = load(tmp_path)
    assert people.profile(brain, "lena", "raj")["declared"] == ["forecasting", "pricing"]
    assert people.who_knows(brain, "lena", "acme") == []
    assert "acme acquisition target" in people.profile(brain, "maya", "raj")["declared"]


def test_graph_people_edges_only_from_readable_notes(tmp_path):
    brain = fixture(tmp_path)
    default = graph.export(brain, "lena")
    augmented = graph.export(brain, "lena", people=True)
    assert not any(edge["kind"] in {"attended", "collaborates"} for edge in default["edges"])
    nodes = {node["id"]: node for node in augmented["nodes"]}
    assert nodes["raj"]["type"] == "person" and nodes["raj"]["area"] == "sales"
    assert nodes["raj"]["access"] == "all"
    edges = {(edge["source"], edge["target"], edge["kind"]) for edge in augmented["edges"]}
    assert ("sales-meeting", "lena", "attended") in edges
    assert ("raj", "lena", "collaborates") in edges
    assert ("lena", "raj", "collaborates") in edges
    assert all("secret" not in source and "secret" not in target for source, target, _ in edges)
    assert ("maya", "raj", "collaborates") in {
        (edge["source"], edge["target"], edge["kind"])
        for edge in graph.export(brain, "maya", people=True)["edges"]}


def test_http_and_mcp_people_routes(tmp_path, monkeypatch):
    fixture(tmp_path)
    monkeypatch.setenv("BRAIN_DEMO", "1")
    with TestClient(build_server(tmp_path).brain_app, base_url="http://localhost") as client:
        profile = client.get("/api/person?person=lena&id=raj")
        assert profile.status_code == 200 and "pricing" in profile.json()["declared"]
        assert client.get("/api/person?person=lena&id=absent").status_code == 404
        assert client.get("/api/who?person=lena&q=m%26a").json() == []
        assert client.get("/api/who?person=maya&q=m%26a").json()
        assert client.get("/api/graph?person=lena&people=1").json()["nodes"]
        assert client.get("/api/who?person=absent&q=sales").status_code == 404
        for name, arguments in (("person", {"id": "raj"}), ("who_knows", {"topic": "m&a"})):
            response = client.post("/lena-token/mcp", json={"jsonrpc": "2.0", "id": 1,
                "method": "tools/call", "params": {"name": name, "arguments": arguments}},
                headers={"accept": "application/json, text/event-stream"})
            assert response.status_code == 200
            result = response.json()["result"]["structuredContent"]
            if name == "person":
                assert result["id"] == "raj"
            else:
                assert result == {"result": []}
