import pytest


@pytest.fixture(autouse=True)
def _rag_off_by_default(monkeypatch):
    """Tests never call the real LLM unless they opt in (see test_rag.py)."""
    monkeypatch.setenv("BRAIN_RAG", "0")
    # Never reach the live framework connector from tests (it made rag tests flaky); a refused port fails fast.
    monkeypatch.setenv("BRAIN_FRAMEWORKS_URL", "http://127.0.0.1:9/disabled")


@pytest.fixture(autouse=True)
def _extract_off_by_default(monkeypatch):
    """Tests never call the real LLM for fact extraction unless they opt in (see test_extract.py)."""
    monkeypatch.setenv("BRAIN_EXTRACT", "0")
