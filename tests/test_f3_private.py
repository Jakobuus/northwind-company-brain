import json

from brain import access, ask, graph, precedence, search, store
from brain.intake.cli import main as intake_main
from brain.intake.validate import validate


def company(tmp_path):
    (tmp_path / "policy.yaml").write_text(
        "company: {id: co, name: Company}\n"
        "people:\n  maya: {name: Maya, title: CEO, rank: 100, groups: [exec]}\n"
        "  lena: {name: Lena, title: Intern, rank: 20, groups: [intern]}\n"
        "areas:\n  core: {name: Core, owner: maya, readers: [everyone]}\n"
    )
    (tmp_path / "core").mkdir()
    (tmp_path / "core" / "decision.md").write_text(
        "---\nid: decision\ntype: decision\ntitle: Public decision\narea: core\n"
        "access: all\nauthor: maya\ndate: 2026-11-01\nsubject: plan\n"
        "attribute: direction\nvalue: public-value\nclaim: decision\nweight: high\n---\nPublic body\n"
    )
    (tmp_path / "personal" / "lena").mkdir(parents=True)
    (tmp_path / "personal" / "lena" / "secret.md").write_text(
        "---\nid: secret-id\ntype: fact\ntitle: Secret title\n"
        "author: lena\nallow: [maya]\ndate: 2026-11-02\nsubject: plan\n"
        "attribute: direction\nvalue: secret-value\nclaim: remark\n---\nSecret body\n"
    )
    return store.load(tmp_path)


def test_personal_defaults_access_conflict_and_no_leak(tmp_path):
    brain = company(tmp_path)
    area = brain.policy.areas["personal-lena"]
    assert (area.name, area.owner, area.readers, area.topics) == ("Personal: Lena", "lena", [], [])
    private = brain.notes["secret-id"]
    assert (private.area, private.access) == ("personal-lena", "private")
    assert access.can_read(brain, "lena", private)
    assert not access.can_read(brain, "maya", private)
    resolutions = precedence.resolve_for(brain, "lena")
    conflict = next(c for r in resolutions for c in r.conflicts)
    assert (conflict.challenger, conflict.route_to, conflict.severity) == ("secret-id", None, "high")
    assert all(not r.conflicts for r in precedence.resolve_for(brain, "maya"))
    for payload in (search.search(brain, "maya", "Secret"), ask.ask(brain, "maya", "plan"),
                    graph.export(brain, "maya", demo_ghosts=True)):
        encoded = json.dumps(payload, default=lambda value: value.__dict__)
        for secret in ("secret-id", "Secret title", "secret-value", "Secret body"):
            assert secret not in encoded
    maya_graph = graph.export(brain, "maya", demo_ghosts=True)
    assert not any(n.get("area") == "personal-lena" for n in maya_graph["nodes"])
    lena_area = next(a for a in maya_graph["areas"] if a["id"] == "personal-lena")
    assert {"id": "personal-lena", "name": "Personal: Lena", "owner": "lena", "open": False}.items() <= lena_area.items()
    assert lena_area["kind"] == "personal" and lena_area["person"] == "lena"
    lena_graph = graph.export(brain, "lena")
    assert any(n["id"] == "personal-lena" for n in lena_graph["nodes"])
    assert any(n["id"] == "secret-id" for n in lena_graph["nodes"])


def test_validator_rejects_private_mismatch_and_outside(tmp_path):
    company(tmp_path)
    assert validate(tmp_path, tmp_path / "policy.yaml") == []
    path = tmp_path / "personal" / "lena" / "secret.md"
    path.write_text(path.read_text().replace("author: lena", "author: maya"))
    assert "private author" in " ".join(validate(tmp_path, tmp_path / "policy.yaml"))
    (tmp_path / "core" / "outside.md").write_text(
        "---\nid: outside\ntype: document\narea: core\naccess: private\nauthor: lena\n---\n")
    assert "outside a personal area" in " ".join(validate(tmp_path, tmp_path / "policy.yaml"))
    path.write_text(path.read_text().replace("author: maya", "author: lena"))
    path.write_text(path.read_text().replace("allow: [maya]", "access: all\nallow: [maya]"))
    assert "must be private" in " ".join(validate(tmp_path, tmp_path / "policy.yaml"))
    assert store.load(tmp_path).notes["secret-id"].access == "private"


def test_intake_personal_flag(tmp_path):
    company(tmp_path)
    source = tmp_path.parent / "source.txt"
    source.write_text("Personal text")
    assert intake_main(["import", str(source), "--data", str(tmp_path), "--personal", "lena"]) == 0
    note = store.load(tmp_path).notes["source"]
    assert (note.area, note.access, note.author) == ("personal-lena", "private", "lena")
    assert note.path == tmp_path / "personal" / "lena" / "source.md"
