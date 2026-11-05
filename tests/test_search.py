from __future__ import annotations

import json
from datetime import date

import pytest

from brain import access
from brain.schema import Area, Brain, Note, Person, Policy
from brain.search import search


@pytest.fixture
def company(tmp_path):
    people = {
        "maya": Person("maya", "Maya Lin", "CEO", 100, ["exec"]),
        "raj": Person("raj", "Raj Patel", "Sales lead", 60, ["sales"]),
        "lena": Person("lena", "Lena Ortiz", "Marketing intern", 20, ["marketing"]),
    }
    areas = {
        "core": Area("core", "Core", "maya", ["everyone"]),
        "sales": Area("sales", "Sales", "raj", ["sales", "exec"]),
        "marketing": Area("marketing", "Marketing", "lena", ["marketing", "exec"]),
        "leadership": Area("leadership", "Leadership", "maya", ["exec"], ["strategy", "smb"]),
    }
    brain = Brain(tmp_path, Policy("tinyco", "Tiny Co", people, areas, {}), {})

    def note(id, title, area, author, when, value=None, *, type="fact", access_mode="area",
             subject=None, attribute=None, claim=None, replaces=None, body="", source=None,
             links=None, weight="normal"):
        brain.notes[id] = Note(id, type, title, area, access=access_mode, author=author,
                               date=date.fromisoformat(when), subject=subject, attribute=attribute,
                               value=value, claim=claim, replaces=replaces or [], body=body,
                               source=source, links=links or [], weight=weight)

    note("exec-smb-decision", "Private SMB strategy", "leadership", "maya", "2026-10-01",
         "secret enterprise pivot", type="decision", access_mode="restricted",
         subject="smb", attribute="strategy", claim="decision", weight="high",
         body="The private SMB strategy is a secret enterprise pivot.")
    note("intern-smb-remark", "SMB strategy remark", "marketing", "lena", "2026-10-03",
         "public small business plan", subject="smb", attribute="strategy", claim="remark",
         body="Our SMB strategy is a public small business plan.")
    note("ceo-sales-target", "Old sales target", "sales", "maya", "2026-10-01",
         "3.5 million", subject="emea", attribute="q4-target", claim="target",
         body="The EMEA Q4 target was 3.5 million.")
    note("lead-sales-target", "New sales target", "sales", "raj", "2026-10-30",
         "3.6 million", subject="emea", attribute="q4-target", claim="target",
         replaces=["ceo-sales-target"], body="The EMEA Q4 target is 3.6 million.")
    note("old-estimate", "Old signup estimate", "core", "maya", "2026-09-01",
         "120 signups", subject="signup", attribute="count", claim="estimate",
         body="The signup count estimate was 120 signups.")
    note("new-observation", "New signup observation", "core", "lena", "2026-10-01",
         "145 signups", subject="signup", attribute="count", claim="observation",
         body="The observed signup count was 145 signups.")
    note("exec-meeting", "Executive meeting private", "leadership", "maya", "2026-10-01",
         type="meeting", access_mode="restricted", body="Private executive meeting discussion.")
    note("sales-note", "Sales target source", "sales", "raj", "2026-10-30",
         type="document", body="Background for EMEA target", links=["exec-meeting"])
    brain.notes["lead-sales-target"].source = "sales-note"
    return brain


def test_search_filters_before_scoring_and_hops(company):
    hits, hints = search(company, "lena", "SMB strategy", k=8)
    assert "intern-smb-remark" in {hit.id for hit in hits}
    assert any("SMB" in hint.text() or "smb" in hint.text() for hint in hints)
    assert "exec-smb-decision" not in {hit.id for hit in hits}
    assert "exec-meeting" not in {hit.id for hit in hits}
    assert all(hit.id in {n.id for n in access.readable(company, "lena")} for hit in hits)


def test_search_expands_readable_relationships(company):
    hits, _ = search(company, "raj", "3.6 million", k=1)
    assert hits[0].id == "lead-sales-target"
    assert any(hit.id == "ceo-sales-target" and hit.via.startswith("hop:") for hit in hits)
    assert any(hit.id == "sales-note" and hit.via == "hop:from_source" for hit in hits)


def test_search_snippet_and_empty_query(company):
    hits, _ = search(company, "maya", "observed", hops=0)
    assert hits[0].id == "new-observation" and "observed" in hits[0].snippet
    assert search(company, "maya", "  ")[0] == []


def assert_no_intern_leak(company, payload):
    dump = json.dumps(payload, default=str)
    for note in company.notes.values():
        if not access.can_read(company, "lena", note):
            for secret in (note.id, note.title, note.value):
                if secret:
                    assert secret not in dump


def test_search_json_has_no_hidden_data(company):
    company.notes["exec-smb-decision"].body += " Unlisted phrase velvet comet."
    hits, hints = search(company, "lena", "SMB strategy private executive")
    assert_no_intern_leak(company, {"hits": [hit.__dict__ for hit in hits],
                                    "hints": [hint.text() for hint in hints]})
    assert "velvet comet" not in json.dumps({"hits": [hit.__dict__ for hit in hits],
                                                "hints": [hint.text() for hint in hints]}, default=str)


def test_embedding_adds_readable_hit_without_shared_word(company, monkeypatch):
    monkeypatch.setenv("BRAIN_EMBED", "1")
    monkeypatch.setattr("brain.search._embed_scores", lambda brain, notes, contents, query:
                        [1.0 if note.id == "sales-note" else 0.0 for note in notes])
    hits, _ = search(company, "raj", "celestial", hops=0)
    assert "sales-note" in {hit.id for hit in hits}
    assert "exec-meeting" not in {hit.id for hit in hits}
