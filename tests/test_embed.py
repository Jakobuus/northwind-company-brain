from __future__ import annotations

import json
import importlib.util
from pathlib import Path

import numpy as np
import pytest

from brain import embed, search
from brain.schema import Area, Brain, Note, Person, Policy


def fixture_brain(tmp_path: Path) -> Brain:
    people = {name: Person(name, name, "", 0, []) for name in ("author", "viewer", "ceo")}
    areas = {"core": Area("core", "Core", "author", ["everyone"])}
    brain = Brain(tmp_path, Policy("demo", "Demo", people, areas, {}), {})
    brain.notes = {
        "open": Note("open", "document", "Canine care", "core", access="all",
                     author="author", body="# Feeding\nPuppies need regular meals and clean water."),
        "private": Note("private", "document", "Hidden kennel", "core", access="private",
                        author="author", body="Confidential shelter location."),
        "restricted": Note("restricted", "document", "Hidden shelter", "core",
                           access="restricted", author="author", body="Confidential rescue budget."),
    }
    return brain


def fake_embedder(calls):
    def embed_texts(texts):
        calls.extend(texts)
        return [np.array([1.0, 0.0] if "Puppies" in text or "dog" in text else [0.0, 1.0],
                         dtype=np.float32) for text in texts]
    return embed_texts


def test_chunk_headings_and_overlap():
    note = Note("n", "document", "Title", "core", body="# First\n" + "A" * 1000 + "\n## Second\nTail")
    rows = embed.chunks(note)
    assert len(rows) >= 3
    assert all(row["note_id"] == "n" and len(row["text"]) <= 800 for row in rows)
    assert any(row["text"].startswith("Second\nTail") for row in rows)
    assert rows[1]["text"].count("A") > 0


def test_incremental_index_and_access_gate(tmp_path, monkeypatch):
    brain = fixture_brain(tmp_path)
    calls = []
    monkeypatch.setattr(embed, "_embedder", fake_embedder(calls))
    first = embed.build(brain)
    assert first["embedded_notes"] == 3
    assert embed.built(brain)
    calls.clear()
    second = embed.build(brain)
    assert second["embedded_notes"] == 0 and calls == []
    assert embed.semantic(brain, "viewer", "dog", 8) == ["open"]
    hits, _ = search.search(brain, "viewer", "dog", hops=0)
    assert hits[0].id == "open" and "Puppies" in hits[0].snippet
    payload = json.dumps([hit.__dict__ for hit in hits], default=str)
    assert "Hidden" not in payload and "Confidential" not in payload
    assert embed.semantic(brain, "ceo", "shelter", 8) == []
    assert set(embed.semantic(brain, "author", "shelter", 8)) == {"private", "restricted"}
    monkeypatch.setenv("BRAIN_EMBED", "0")
    assert search.search(brain, "viewer", "dog", hops=0)[0] == []
    monkeypatch.delenv("BRAIN_EMBED")
    brain.notes["open"].body = "# Feeding\nPuppies need fresh water."
    del brain.notes["restricted"]
    calls.clear()
    third = embed.build(brain)
    assert third["embedded_notes"] == 1 and third["removed_notes"] == 1
    assert len(calls) == 1
    assert "restricted" not in json.loads((tmp_path / ".brain-cache" / "manifest.json").read_text())


def test_semantic_cosine_floor_and_freshness_stat_fast_path(tmp_path, monkeypatch):
    brain = fixture_brain(tmp_path)
    source = tmp_path / "open.md"
    source.write_text("Puppies need meals")
    brain.notes["open"].path = source
    monkeypatch.setattr(embed, "_embedder", lambda texts: [
        np.array([1.0, 0.0], dtype=np.float32) if "Puppies" in text else
        np.array([0.0, 1.0], dtype=np.float32) for text in texts])
    embed.build(brain)
    original_digest = embed._digest
    monkeypatch.setattr(embed, "_digest", lambda note: (
        (_ for _ in ()).throw(AssertionError("hashed unchanged file"))
        if note.id == "open" else original_digest(note)))
    assert embed.semantic(brain, "viewer", "Puppies", 8) == ["open"]
    monkeypatch.setenv("BRAIN_EMBED_MIN", "1.01")
    assert embed.semantic(brain, "viewer", "Puppies", 8) == []


def test_search_limits_semantic_candidates(tmp_path, monkeypatch):
    brain = fixture_brain(tmp_path)
    for i in range(30):
        brain.notes[f"extra-{i}"] = Note(f"extra-{i}", "document", f"Extra {i}", "core",
                                          access="all", body="Other topic")
    called = []
    monkeypatch.setattr(embed, "available", lambda: True)
    monkeypatch.setattr(embed, "built", lambda brain: True)
    monkeypatch.setattr(embed, "ranked", lambda brain, person, query, k: called.append(k) or [])
    search.search(brain, "viewer", "puppies", k=2, hops=0)
    assert called == [20]


@pytest.mark.skipif(importlib.util.find_spec("fastembed") is None,
                    reason="fastembed is not installed")
def test_real_fastembed_indexes_five_notes(tmp_path, monkeypatch):
    monkeypatch.setattr(embed, "_embedder", None)
    monkeypatch.setattr(embed, "_model", None)
    brain = fixture_brain(tmp_path)
    for i in range(2):
        brain.notes[f"extra-{i}"] = Note(f"extra-{i}", "document", f"Extra {i}", "core",
                                          access="all", body=f"Unrelated memo number {i}.")
    counts = embed.build(brain)
    assert counts["notes"] == 5 and counts["chunks"] >= 5
    assert "open" in embed.semantic(brain, "viewer", "dog meals", 5)


def test_every_org_gets_its_own_index_even_when_builds_overlap(tmp_path, monkeypatch):
    """Several orgs asking for an index at once must each end up indexed (no org dropped by coalescing)."""
    import threading
    started, release = threading.Event(), threading.Event()
    seen = []

    def slow_embedder(texts):
        started.set()
        release.wait(5)
        seen.append(len(texts))
        return [np.array([1.0, 0.0], dtype=np.float32) for _ in texts]

    brains = []
    for name in ("org-a", "org-b", "org-c"):
        root = tmp_path / name
        root.mkdir()
        brains.append(fixture_brain(root))
    monkeypatch.setattr(embed, "_embedder", slow_embedder)
    threads = [threading.Thread(target=embed.ensure_index, args=(b,)) for b in brains]
    threads[0].start()
    assert started.wait(5)  # org-a is mid-build; b and c arrive now
    threads[1].start()
    threads[2].start()
    release.set()
    for thread in threads:
        thread.join(10)
    assert all(embed.built(b) for b in brains)


def test_missing_model_never_breaks_search(tmp_path, monkeypatch, capsys):
    brain = fixture_brain(tmp_path)
    monkeypatch.setattr(embed, "_embedder", fake_embedder([]))
    embed.build(brain)

    def broken(texts):
        raise RuntimeError("model files missing")
    monkeypatch.setattr(embed, "_embedder", broken)
    monkeypatch.setattr(embed, "_warned_query", False)
    hits, _ = search.search(brain, "viewer", "puppies", hops=0)  # keyword match still works
    assert hits and hits[0].id == "open"
    assert "keyword search only" in capsys.readouterr().err
    assert embed.ensure_index(brain) is None  # model failure is logged, not raised
    assert "embedding model not available" in capsys.readouterr().err
