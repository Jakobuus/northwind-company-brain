"""Outside knowledge: the public MBA Vault framework library (read-only MCP connector).

frameworks(question, k) -> [{"kind": "framework", "title", "snippet", "source_url"}]
Never mixes with company notes. Returns [] on any error, timeout (5 s) or when not configured.
The connector URL (may hold a secret token) comes from env BRAIN_FRAMEWORKS_URL or the
untracked file .env.local in the repo root. Never log or print it.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

TIMEOUT = 8.0  # cold connector calls sometimes take 5-7 s; one retry follows
TRIES = 2
_cache: dict[tuple[str, int], list[dict]] = {}


def _url() -> str:
    u = os.environ.get("BRAIN_FRAMEWORKS_URL", "").strip()
    if u:
        return u
    f = Path(__file__).resolve().parent.parent / ".env.local"
    try:
        for line in f.read_text().splitlines():
            if line.startswith("BRAIN_FRAMEWORKS_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def _items(payload) -> list:
    if isinstance(payload, dict):
        for key in ("results", "hits", "items", "matches", "notes"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return [payload]
    return payload if isinstance(payload, list) else []


def _map(raw, k: int) -> list[dict]:
    out = []
    for it in _items(raw):
        if isinstance(it, str):
            it = {"snippet": it}
        if not isinstance(it, dict):
            continue
        path = it.get("source_url") or it.get("url") or it.get("path") or it.get("file") or ""
        text = it.get("snippet") or it.get("text") or it.get("content") or it.get("excerpt") or ""
        title = it.get("title") or it.get("name") or (Path(str(path)).stem.replace("-", " ") if path else "")
        if not (title or text):
            continue
        text = re.sub(r"\s+", " ", str(text)).strip()
        out.append({"kind": "framework", "title": str(title), "snippet": text[:300],
                    "source_url": str(path)})
        if len(out) >= k:
            break
    return out


_HIT = re.compile(r"(?m)^(\d+(?:\.\d+)?)\s+(\S+\.md)\s+\u2014\s*")


def _parse_text(text: str) -> list[dict]:
    """The connector returns one string: '<score> <path>.md — <heading>\\n<body>' blocks."""
    ms = list(_HIT.finditer(text))
    out = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        out.append({"path": m.group(2), "snippet": text[m.end():end]})
    return out


def _payload(res):
    for v in (getattr(res, "data", None), getattr(res, "structured_content", None)):
        if isinstance(v, dict) and isinstance(v.get("result"), (str, list)):
            v = v["result"]
        if isinstance(v, str):
            hits = _parse_text(v)
            if hits:
                return hits
        elif v:
            return v
    text = "\n".join(getattr(c, "text", "") for c in getattr(res, "content", []) or [])
    hits = _parse_text(text)
    if hits:
        return hits
    try:
        return json.loads(text)
    except ValueError:
        return []


async def _query(url: str, question: str, k: int, client_factory=None):
    if client_factory is None:
        from fastmcp import Client as client_factory
    async with client_factory(url) as c:
        props = {}
        for t in await c.list_tools():
            if t.name == "semantic_search":
                props = ((getattr(t, "input_schema", None) or getattr(t, "inputSchema", None) or {})).get("properties", {})
        qname = next((n for n in ("query", "question", "q", "text") if n in props), "query")
        args = {qname: question}
        for n in ("k", "limit", "top_k", "n", "max_results"):
            if n in props:
                args[n] = k
                break
        res = await c.call_tool("semantic_search", args)
        return _payload(res)


def frameworks(question: str, k: int = 3, _client_factory=None) -> list[dict]:
    key = (question, k)
    if key in _cache:
        return [dict(x) for x in _cache[key]]
    url = _url()
    if not url or not question.strip():
        return []
    res = []
    for _ in range(TRIES):
        try:
            raw = asyncio.run(asyncio.wait_for(_query(url, question, k, _client_factory), TIMEOUT))
            res = _map(raw, k)
        except Exception as e:
            print(f"outside.frameworks failed: {type(e).__name__}", file=sys.stderr)  # never the message: it can carry the URL
            res = []
        if res:
            break
    if not res:
        return _local(question, k) if _client_factory is None else []
    _cache[key] = res
    return [dict(x) for x in res]


def _local(question: str, k: int) -> list[dict]:
    """Offline fallback: match the question against the bundled framework title list (web/frameworks.json)."""
    try:
        data = json.loads((Path(__file__).resolve().parent.parent / "web" / "frameworks.json").read_text())
    except (OSError, ValueError):
        return []
    words = {w[:5] for w in re.findall(r"[a-z]{4,}", question.lower())}
    scored = []
    for d in data.get("disciplines", []):
        for f in d.get("frameworks", []):
            t = {w[:5] for w in re.findall(r"[a-z]{4,}", f["title"].lower())}
            if words & t:
                scored.append((len(words & t), {"kind": "framework", "title": f["title"],
                                                "snippet": f"{d['name']} framework: {f['title']}.",
                                                "source_url": f["path"]}))
    scored.sort(key=lambda x: -x[0])
    return [x[1] for x in scored[:k]]


# ---- read-only framework note + total count (for the map halo) --------------------------------
COUNT_TTL = 600.0
_index: dict = {"at": 0.0, "files": {}}  # slug -> note path, filled by one directory sweep
_note_cache: dict[str, str] = {}
ROOT = "01-frameworks"


def _text(res) -> str:
    for v in (getattr(res, "data", None), getattr(res, "structured_content", None)):
        if isinstance(v, dict) and isinstance(v.get("result"), str):
            v = v["result"]
        if isinstance(v, str) and v:
            return v
    return "\n".join(getattr(c, "text", "") for c in getattr(res, "content", []) or [])


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def strip_note(md: str) -> str:
    """Drop the YAML front matter and the section about recognising when the framework applies."""
    md = re.sub(r"\A---\s*\n.*?\n---\s*\n", "", md, count=1, flags=re.S)
    out, skip = [], False
    for line in md.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            skip = bool(re.search(r"recogni|\bcues?\b|spot(ting)?\b|when to (use|apply)", m.group(2), re.I)
                        and not re.search(r"not", m.group(2), re.I))
        if not skip:
            out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


async def _sweep(c) -> dict[str, str]:
    files = {}
    for d in _text(await c.call_tool("list_dir", {"path": ROOT})).split():
        if not d.endswith("/"):
            continue
        for f in re.findall(r"^(\S+\.md)\s", _text(await c.call_tool("list_dir", {"path": ROOT + "/" + d})), re.M):
            files[f[:-3]] = f"{ROOT}/{d.strip('/')}/{f}"
    return files


async def _files(c) -> dict[str, str]:
    import time
    if not _index["files"] or time.time() - _index["at"] > COUNT_TTL:
        _index["files"], _index["at"] = await _sweep(c), time.time()
    return _index["files"]


async def _resolve(c, name: str, files: dict[str, str]) -> str:
    s = _slug(name)
    if s in files:
        return files[s]
    words = set(s.split("-"))
    best = max(files, key=lambda k: len(words & set(k.split("-"))) / (len(set(k.split("-"))) or 1), default="")
    if best and words and words <= set(best.split("-")):
        return files[best]
    hits = _parse_text(_text(await c.call_tool("semantic_search", {"query": name, "limit": 5, "folder": ROOT})))
    for h in hits:
        if h["path"].startswith(ROOT + "/"):
            return h["path"]
    raise LookupError("no match")


def _call(coro_fn, _client_factory=None):
    url = _url()
    if not url:
        raise RuntimeError("not configured")

    async def run():
        factory = _client_factory
        if factory is None:
            from fastmcp import Client as factory
        async with factory(url) as c:
            return await coro_fn(c)

    last = None
    for _ in range(2):
        try:
            return asyncio.run(asyncio.wait_for(run(), 5.0 if _client_factory else 25.0))
        except Exception as e:
            last = e
            print(f"outside call failed: {type(e).__name__}", file=sys.stderr)  # never the message
    raise last  # type: ignore[misc]


def framework_note(name: str, _client_factory=None) -> dict:
    """{"name", "title", "markdown"} fetched live; title = the note actually matched (may differ from name).
    Raises on failure (caller turns that into a 503)."""
    name = name.strip()[:200]
    if not name:
        raise ValueError("empty name")
    if name in _note_cache:
        title, md = _note_cache[name]
        return {"name": name, "title": title, "markdown": md}

    async def go(c):
        path = await _resolve(c, name, await _files(c))
        return path, _text(await c.call_tool("read_note", {"path": path}))

    path, raw = _call(go, _client_factory)
    md = strip_note(raw)
    if not md:
        raise LookupError("empty")
    title = Path(str(path)).stem.replace("-", " ").capitalize()
    _note_cache[name] = (title, md)
    return {"name": name, "title": title, "markdown": md}


def framework_count(_client_factory=None) -> dict:
    async def go(c):
        return len(await _files(c))

    return {"count": _call(go, _client_factory)}
