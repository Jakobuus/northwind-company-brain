import json

from brain.graph import export
from brain.store import load
from test_search import assert_no_intern_leak, company  # noqa: F401


def test_graph_viewer_status_and_edges(company):
    graph = export(company, "maya")
    nodes = {node["id"]: node for node in graph["nodes"]}
    assert nodes["exec-smb-decision"]["status"] == "current"
    assert nodes["intern-smb-remark"]["status"] == "contested"
    assert nodes["ceo-sales-target"]["status"] == "superseded"
    assert nodes["old-estimate"]["status"] == "superseded"
    assert {"source": "lead-sales-target", "target": "ceo-sales-target", "kind": "replaces"} in graph["edges"]
    assert {"source": "exec-smb-decision", "target": "intern-smb-remark", "kind": "conflicts"} in graph["edges"]


def test_graph_ghosts_are_opaque_and_only_in_area(company):
    company.notes["exec-smb-decision"].body += " Unlisted phrase velvet comet."
    graph = export(company, "lena", demo_ghosts=True)
    locked = [node for node in graph["nodes"] if node["locked"]]
    assert locked and all(node["title"] == "Restricted" and node["id"].startswith("locked-")
                          and node["type"] == "locked" for node in locked)
    assert all(set(node) == {"id", "title", "type", "area", "access", "locked"}
               for node in locked)
    assert {node["access"] for node in locked} == {"restricted", "area"}
    locked_ids = {node["id"] for node in locked}
    assert all(edge["kind"] == "in_area" for edge in graph["edges"]
               if edge["source"] in locked_ids or edge["target"] in locked_ids)
    assert_no_intern_leak(company, graph)
    assert "velvet comet" not in json.dumps(graph)
    assert not any(node["locked"] for node in export(company, "lena")["nodes"])


def test_graph_area_colors_and_open(company):
    company.policy.areas["sales"].color = "#123456"
    areas = {area["id"]: area for area in export(company, "lena")["areas"]}
    assert areas["sales"]["color"] == "#123456"
    assert not areas["sales"]["open"]
    assert areas["marketing"]["open"]
    assert areas["core"]["color"]
    assert areas["core"]["kind"] == "core"
    assert areas["sales"]["kind"] == "department"
    assert areas["sales"]["owner_name"] == "Raj Patel"
    assert "person" not in areas["sales"] and "home" not in areas["sales"]


def test_note_fields_and_public_author_only(company):
    company.notes["sales-note"].author = "unlisted-author"
    nodes = {node["id"]: node for node in export(company, "maya")["nodes"]}
    assert (nodes["intern-smb-remark"]["access"], nodes["intern-smb-remark"]["author"],
            nodes["intern-smb-remark"]["claim"], nodes["intern-smb-remark"]["weight"]) == (
                "area", "lena", "remark", "normal")
    assert (nodes["sales-note"]["author"], nodes["sales-note"]["claim"]) == (None, None)
    assert (nodes["lena"]["access"], nodes["lena"]["author"],
            nodes["lena"]["claim"], nodes["lena"]["weight"]) == ("all", None, None, None)


def test_personal_area_home_and_absent_weight(tmp_path):
    (tmp_path / "policy.yaml").write_text(
        "company: {id: co, name: Company}\n"
        "people:\n"
        "  lena: {name: Lena, title: Intern, rank: 20, groups: [marketing]}\n"
        "  raj: {name: Raj, title: Lead, rank: 60, groups: [sales], home: sales}\n"
        "  maya: {name: Maya, title: CEO, rank: 100, groups: [exec], home: missing}\n"
        "areas:\n"
        "  core: {name: Core, owner: maya, readers: [everyone]}\n"
        "  marketing: {name: Marketing, owner: lena, readers: [marketing]}\n"
        "  sales: {name: Sales, owner: raj, readers: [sales]}\n"
    )
    (tmp_path / "core").mkdir()
    (tmp_path / "core" / "notice.md").write_text(
        "---\nid: notice\ntitle: Notice\ntype: document\narea: core\n"
        "access: all\nauthor: lena\n---\nBody\n")
    brain = load(tmp_path)
    assert brain.policy.people["raj"].home == "sales"
    assert brain.policy.people["maya"].home is None
    assert any("Unknown home area missing for maya" in warning for warning in brain.warnings)
    graph = export(brain, "lena")
    areas = {area["id"]: area for area in graph["areas"]}
    assert (areas["personal-lena"]["kind"], areas["personal-lena"]["person"],
            areas["personal-lena"]["home"], areas["personal-lena"]["owner_name"]) == (
                "personal", "lena", "marketing", "Lena")
    assert areas["personal-raj"]["home"] == "sales"
    assert areas["personal-maya"]["home"] == "core"
    assert "person" not in areas["core"] and "home" not in areas["core"]
    nodes = {node["id"]: node for node in graph["nodes"]}
    assert (nodes["notice"]["access"], nodes["notice"]["author"],
            nodes["notice"]["claim"], nodes["notice"]["weight"]) == (
                "all", "lena", None, None)


def test_stored_status_never_reaches_viewer(company):
    company.notes["ceo-sales-target"].status = "contested"
    company.notes["sales-note"].status = "superseded"
    company.notes["lead-sales-target"].access = "restricted"
    company.notes["lead-sales-target"].author = "maya"
    nodes = {node["id"]: node for node in export(company, "raj")["nodes"]}
    assert nodes["ceo-sales-target"]["status"] == "current"
    assert nodes["sales-note"]["status"] == "current"


def test_ghost_unknown_area_uses_core(company):
    hidden = company.notes["exec-meeting"]
    hidden.area = "secret-project"
    graph = export(company, "lena", demo_ghosts=True)
    assert all(node["area"] != "secret-project" for node in graph["nodes"] if node["locked"])
