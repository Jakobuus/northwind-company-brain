import pytest

from brain import rag
from brain.ask import ask
from test_search import company  # noqa: F401


@pytest.fixture
def captured(monkeypatch):
    monkeypatch.setenv("BRAIN_RAG", "1")
    seen = []

    def fake(prompt, model):
        seen.append((prompt, model))
        return "Answer [exec-smb-decision] and [intern-smb-remark] and [bogus-id]."

    monkeypatch.setattr(rag, "_runner", fake)
    return seen


def test_prompt_never_contains_unreadable_notes(company, captured):
    company.notes["exec-smb-decision"].body += " Hidden phrase velvet comet."
    hidden = company.notes["exec-smb-decision"]
    for person, can_see in (("lena", False), ("maya", True)):
        captured.clear()
        packet = ask(company, person, "SMB strategy")
        result = rag.generate("SMB strategy", packet, company)
        assert result is not None and captured
        prompt = captured[0][0]
        for needle in (hidden.id, hidden.title, "velvet comet"):
            assert (needle in prompt) is can_see, (person, needle)


def test_cited_only_includes_prompted_notes_and_guard_text(company, captured):
    packet = ask(company, "lena", "SMB strategy")
    result = rag.generate("SMB strategy", packet, company)
    assert "exec-smb-decision" not in result["cited"] and "bogus-id" not in result["cited"]
    assert "intern-smb-remark" in result["cited"]
    prompt = captured[0][0]
    assert "untrusted" in prompt and "not in your readable notes" in prompt
    assert captured[0][1] == "haiku"


def test_hints_and_winner_are_passed(company, captured):
    packet = ask(company, "lena", "SMB strategy")
    rag.generate("SMB strategy", packet, company)
    prompt = captured[0][0]
    assert packet["hints"][0] in prompt
    assert f"Precedence winner for {'/'.join(packet['resolutions'][0]['key'])}" in prompt


def test_disabled_and_failure_return_none(company, monkeypatch):
    packet = ask(company, "maya", "SMB strategy")
    monkeypatch.setattr(rag, "_runner", lambda p, m: "x")
    monkeypatch.setenv("BRAIN_RAG", "0")
    assert rag.generate("q", packet, company) is None
    monkeypatch.setenv("BRAIN_RAG", "1")
    monkeypatch.setattr(rag, "_runner", lambda p, m: None)
    out = rag.generate("q", packet, company)  # model failed: deterministic text from readable facts
    assert out and out["model"] == "fallback" and out["text"]

    def boom(p, m):
        raise RuntimeError

    monkeypatch.setattr(rag, "_runner", boom)
    assert rag.generate("q", packet, company) is None


def test_outside_frameworks_optional(company, captured, monkeypatch):
    import sys
    import types
    mod = types.ModuleType("brain.outside")
    mod.frameworks = lambda q, k=3: [{"title": "Porter", "snippet": "five forces", "source_url": "http://x"}]
    monkeypatch.setitem(sys.modules, "brain.outside", mod)
    import brain
    monkeypatch.setattr(brain, "outside", mod, raising=False)
    packet = ask(company, "maya", "SMB strategy")
    result = rag.generate("SMB strategy", packet, company)
    assert result["frameworks"][0]["title"] == "Porter"
    assert "Outside knowledge (public business frameworks" in captured[0][0]


def test_api_ask_adds_rag_field(company, monkeypatch, tmp_path):
    from starlette.testclient import TestClient
    from brain import server
    monkeypatch.setattr(server.store, "load", lambda root: company)
    monkeypatch.setattr(server.BrainCache, "_fingerprint", lambda self: ())
    monkeypatch.setenv("BRAIN_DEMO", "1")
    monkeypatch.setenv("BRAIN_RAG", "1")
    monkeypatch.setattr(rag, "_runner", lambda p, m: "ok [intern-smb-remark]")
    app = server.build_server(tmp_path)
    with TestClient(app.brain_app, base_url="http://localhost") as client:
        body = client.get("/api/ask", params={"person": "lena", "q": "SMB strategy"}).json()
    assert body["rag"]["text"].startswith("ok") and body["rag"]["cited"] == ["intern-smb-remark"]
    assert "summary" in body and "hits" in body


def test_brief_shape_json_and_plain_and_no_leak(company, monkeypatch):
    monkeypatch.setenv("BRAIN_RAG", "1")
    packet = ask(company, "lena", "SMB strategy")
    assert set(packet["brief"]) == {"headline", "points", "conflict", "sources"}
    monkeypatch.setattr(rag, "_runner", lambda p, m: '{"headline": "Go SMB.", "points": ["a", "b", "c", "d"], '
                        '"text": "Go SMB [exec-smb-decision]."}')
    out = rag.generate("SMB strategy", packet, company)
    assert out["text"] == "Go SMB [exec-smb-decision]." and out["brief"]["headline"] == "Go SMB."
    assert len(out["brief"]["points"]) == 3
    monkeypatch.setattr(rag, "_runner", lambda p, m: "One. Two. Three. Four. Five.")
    out = rag.generate("SMB strategy", ask(company, "lena", "SMB strategy"), company)
    assert out["brief"]["headline"] == "One." and out["brief"]["points"] == ["Two.", "Three.", "Four."]
    # leak: every viewer's brief mentions only notes that viewer can read
    from brain import access
    for person in company.policy.people:
        pk = ask(company, person, "SMB strategy")
        readable = {n.id: n for n in access.readable(company, person)}
        hidden = [n for n in company.notes.values() if n.id not in readable]
        blob = str(pk["brief"])
        assert all(s["id"] in readable for s in pk["brief"]["sources"])
        assert not any(n.id in blob or n.title in blob for n in hidden)
