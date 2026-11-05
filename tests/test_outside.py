import asyncio
from types import SimpleNamespace as NS

from brain import outside


class FakeClient:
    def __init__(self, url, results=None, delay=0):
        self.results, self.delay = results, delay

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def list_tools(self):
        return [NS(name="semantic_search", input_schema={"properties": {"query": {}, "limit": {}}})]

    async def call_tool(self, name, args):
        assert name == "semantic_search" and args == {"query": "price", "limit": 2}
        await asyncio.sleep(self.delay)
        return NS(data=self.results, structured_content=None, content=[])


def _setup(monkeypatch):
    outside._cache.clear()
    monkeypatch.setenv("BRAIN_FRAMEWORKS_URL", "https://x.test/***")


def test_mapping(monkeypatch):
    _setup(monkeypatch)
    rows = {"results": [{"title": "Van Westendorp", "text": "x" * 500, "path": "f/vw.md"},
                        {"path": "f/value-based-pricing.md", "snippet": "Price by value"},
                        {"title": "third", "text": "t"}]}
    out = outside.frameworks("price", 2, _client_factory=lambda u: FakeClient(u, rows))
    assert [o["title"] for o in out] == ["Van Westendorp", "value based pricing"]
    assert all(o["kind"] == "framework" and len(o["snippet"]) <= 300 for o in out)
    assert out[0]["source_url"] == "f/vw.md"


def test_real_text_shape(monkeypatch):
    _setup(monkeypatch)
    txt = ("0.45 01-frameworks/tech/subscription-pricing.md \u2014 How to Apply\n\n1. Choose the unit\n\n"
           "0.41 01-frameworks/marketing/bundle-design.md \u2014 (cues)\nBundle Design")
    out = outside.frameworks("price", 2, _client_factory=lambda u: FakeClient(u, txt))
    assert [o["title"] for o in out] == ["subscription pricing", "bundle design"]
    assert out[0]["source_url"].endswith("subscription-pricing.md") and "Choose the unit" in out[0]["snippet"]


def test_not_configured(monkeypatch):
    outside._cache.clear()
    monkeypatch.setattr(outside, "_url", lambda: "")
    assert outside.frameworks("price", 2) == []


def test_timeout_and_error(monkeypatch):
    _setup(monkeypatch)
    monkeypatch.setattr(outside, "TIMEOUT", 0.05)
    slow = lambda u: FakeClient(u, {"results": [{"title": "a"}]}, delay=1)
    assert outside.frameworks("price", 2, _client_factory=slow) == []

    def boom(u):
        raise RuntimeError("down")
    assert outside.frameworks("price", 2, _client_factory=boom) == []


NOTE = """---
type: framework
recognition_cues:
  - "we cannot tell"
---

## Recognition Prose

You will notice symptoms like these.

## Core Concept

Do the thing.

## When NOT to Use

Never when tiny.
"""


class NoteClient:
    def __init__(self, url):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def call_tool(self, name, args):
        if name == "list_dir":
            out = {"01-frameworks": "alpha/\nbeta/\n",
                   "01-frameworks/alpha": ".gitkeep  (0 bytes)\nfoo-bar.md  (10 bytes)\nbaz.md  (5 bytes)\n",
                   "01-frameworks/beta": "qux.md  (7 bytes)\n"}[args["path"].rstrip("/")]
        else:
            assert name == "read_note" and args["path"] == "01-frameworks/alpha/foo-bar.md"
            out = NOTE
        return NS(data=out, structured_content=None, content=[])


def _fresh(monkeypatch):
    outside._index.update(at=0.0, files={})
    outside._note_cache.clear()
    monkeypatch.setattr(outside, "_url", lambda: "https://x.test/***")


def test_strip_note():
    md = outside.strip_note(NOTE)
    assert "type: framework" not in md and "Recognition" not in md and "symptoms" not in md
    assert "## Core Concept" in md and "## When NOT to Use" in md


def test_framework_note_and_count(monkeypatch):
    _fresh(monkeypatch)
    r = outside.framework_note("Foo bar", _client_factory=NoteClient)
    assert r["name"] == "Foo bar" and r["markdown"].startswith("## Core Concept")
    assert outside.framework_count(_client_factory=NoteClient) == {"count": 3}


def test_framework_routes(client_and_view, monkeypatch):
    c, token = client_and_view
    monkeypatch.setattr(outside, "framework_note", lambda n: {"name": n, "markdown": "## X"})
    monkeypatch.setattr(outside, "framework_count", lambda: {"count": 1012})
    assert c.get(f"/v/{token}/api/framework?name=Go").json() == {"name": "Go", "markdown": "## X"}
    assert c.get(f"/v/{token}/api/frameworks/count").json() == {"count": 1012}

    def boom(*a):
        raise RuntimeError("secret-url")
    monkeypatch.setattr(outside, "framework_note", boom)
    monkeypatch.setattr(outside, "framework_count", boom)
    for tail in ("api/framework?name=Go", "api/frameworks/count"):
        r = c.get(f"/v/{token}/{tail}")
        assert r.status_code == 503 and r.json() == {"error": "frameworks unavailable"}
    assert c.get("/v/garbage/api/frameworks/count").status_code == 404
    assert c.get("/v/garbage/api/framework?name=Go").status_code == 404


import pytest
from test_platform import client, org, view  # noqa: F401  (fixtures)


@pytest.fixture
def client_and_view(org):
    return org, view(org, "acme", "ann").split("/")[2]
