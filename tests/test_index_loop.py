import threading
import time

from brain import embed, rag, server
from brain.ask import ask
from test_embed import fake_embedder, fixture_brain
from test_search import company  # noqa: F401


def test_fingerprint_ignores_cache_and_tmp_so_build_does_not_retrigger(tmp_path, monkeypatch):
    brain = fixture_brain(tmp_path)
    (tmp_path / "note.md").write_text("x")
    monkeypatch.setattr(server.store, "load", lambda root: brain)
    cache = server.BrainCache(tmp_path, auto_index=True)
    before = cache._fingerprint()
    monkeypatch.setattr(embed, "_embedder", fake_embedder([]))
    embed.build(brain)
    (tmp_path / "stray.json.tmp").write_text("t")
    assert any(embed.CACHE in str(p) for p in tmp_path.rglob("*"))
    assert cache._fingerprint() == before


def test_concurrent_ensure_index_builds_once(tmp_path, monkeypatch):
    brain = fixture_brain(tmp_path)
    calls, gate = [], threading.Event()

    def slow_build(b):
        calls.append(1)
        gate.wait(5)
        return {"notes": 1, "chunks": 1, "embedded_notes": 1, "seconds": 0.0}

    monkeypatch.setattr(embed, "_embedder", fake_embedder([]))
    monkeypatch.setattr(embed, "build", slow_build)
    threads = [threading.Thread(target=embed.ensure_index, args=(brain,)) for _ in range(5)]
    for t in threads:
        t.start()
    time.sleep(0.3)
    gate.set()
    for t in threads:
        t.join()
    assert len(calls) == 1
    assert embed.ensure_index(brain) == 1 and len(calls) == 2  # flag released afterwards


def _packet(company):
    return ask(company, "lena", "SMB strategy")


def test_long_question_skips_rag(company, monkeypatch):
    monkeypatch.setenv("BRAIN_RAG", "1")
    seen = []
    monkeypatch.setattr(rag, "_runner", lambda p, m: seen.append(p) or "ok")
    assert rag.generate_limited("x" * (rag.MAX_QUESTION + 1), _packet(company), company) is None
    assert seen == []


def test_concurrency_cap_returns_null_without_queueing(company, monkeypatch):
    monkeypatch.setenv("BRAIN_RAG", "1")
    monkeypatch.setattr(rag, "_starts", [])
    gate, started = threading.Event(), threading.Semaphore(0)

    def slow(prompt, model):
        started.release()
        gate.wait(5)
        return "ok"

    monkeypatch.setattr(rag, "_runner", slow)
    packet, out = _packet(company), []
    threads = [threading.Thread(target=lambda: out.append(rag.generate_limited("SMB strategy", packet, company)))
               for _ in range(rag.MAX_CONCURRENT)]
    for t in threads:
        t.start()
    for _ in threads:
        assert started.acquire(timeout=5)
    assert rag.generate_limited("SMB strategy", packet, company) is None  # extra: immediate null
    gate.set()
    for t in threads:
        t.join()
    assert all(r and r["text"] == "ok" for r in out)


def test_rate_limit_returns_null(company, monkeypatch):
    monkeypatch.setenv("BRAIN_RAG", "1")
    monkeypatch.setattr(rag, "_starts", [])
    monkeypatch.setattr(rag, "_runner", lambda p, m: "ok")
    packet = _packet(company)
    results = [rag.generate_limited("SMB strategy", packet, company) for _ in range(rag.MAX_PER_MINUTE + 3)]
    assert all(results[:rag.MAX_PER_MINUTE]) and results[rag.MAX_PER_MINUTE:] == [None] * 3
