"""Permission-aware MCP and read-only web API for one company brain."""

from __future__ import annotations

import os
import re
import threading
import time
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastmcp import FastMCP
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import access, ask as ask_module, embed, graph, people, precedence, rag, search, store


WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
_identity: ContextVar[tuple[str, str] | None] = ContextVar("brain_identity", default=None)
# Platform mode: the signed view token fixes the viewer; any ?person= / ?token= is ignored.
fixed_person: ContextVar[str | None] = ContextVar("brain_fixed_person", default=None)
_NOT_FOUND = {"error": "Note not found"}
READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False}


class BrainCache:
    def __init__(self, root: Path, auto_index: bool = False):
        self.root = Path(root)
        self.auto_index = auto_index
        self.brain = store.load(self.root)
        self.fingerprint = self._fingerprint()
        self.checked_at = time.monotonic()

    def _fingerprint(self) -> tuple:
        return tuple(sorted((str(path.relative_to(self.root)), path.stat().st_mtime_ns)
                            for path in self.root.rglob("*")
                            if path.is_file() and embed.CACHE not in path.relative_to(self.root).parts
                            and not path.name.endswith(".tmp")))

    def get(self):
        now = time.monotonic()
        if now - self.checked_at >= 5:
            self.checked_at = now
            fingerprint = self._fingerprint()
            if fingerprint != self.fingerprint:
                self.brain = store.load(self.root)
                self.fingerprint = fingerprint
                if self.auto_index:  # keep the meaning index fresh without blocking the request
                    threading.Thread(target=embed.ensure_index, args=(self.brain,), daemon=True).start()
        return self.brain


CHAT_ORIGINS = {"claude.ai", "chatgpt.com"}  # chat clients may send their own Origin


def build_server(root: Path, auto_index: bool = False, graph_url=None) -> FastMCP:
    """Build one FastMCP server. Serve its ``brain_app`` with an ASGI server.

    ``auto_index=True`` (used by ``cli serve``) builds the meaning index now and after data changes.
    ``graph_url(person_id) -> str`` (platform mode) replaces the default graph_link target."""
    cache = BrainCache(root, auto_index=auto_index)
    if auto_index:
        embed.ensure_index(cache.brain)
    mcp = FastMCP(cache.brain.policy.company_name or "Company Brain", instructions=(
        "Company brain for the person this link belongs to. Use ask() for questions. Answer in this shape, "
        "nothing else: **one bold sentence** that answers the question; up to 3 short bullets; one line "
        "'Conflict: …' only if the brain reports one; then 'Sources:' with note titles and dates; if the "
        "brain gives a hint (talk to <person>), end with it verbatim. Never guess at hidden information."))
    base_host = urlsplit(os.getenv("BRAIN_BASE_URL", "")).hostname
    allowed_hosts = {"localhost", "127.0.0.1"}
    if base_host:
        allowed_hosts.add(base_host.lower())
    public_host = urlsplit(os.getenv("BRAIN_PUBLIC_URL", "")).hostname
    if public_host:
        allowed_hosts.add(public_host.lower())
    allowed_hosts.update(host.strip().lower() for host in
                         os.getenv("BRAIN_ALLOWED_HOSTS", "").split(",") if host.strip())

    def caller() -> tuple[str, str]:
        identity = _identity.get()
        if identity is None:
            raise ValueError("A personal MCP link is required")
        return identity

    def note_payload(person: str, note_id: str) -> dict | None:
        brain = cache.get()
        note = brain.notes.get(note_id)
        if note is None or not access.can_read(brain, person, note):
            return None
        fields = ("id", "type", "title", "area", "access", "allow", "author", "date",
                  "source", "subject", "attribute", "value", "claim", "weight", "replaces")
        frontmatter = {key: getattr(note, key) for key in fields}
        frontmatter["date"] = note.date.isoformat() if note.date else None
        frontmatter.update(note.extra)
        return {"id": note.id, "title": note.title, "type": note.type, "area": note.area,
                "frontmatter": frontmatter, "body": note.body,
                "links": [{"id": linked.id, "title": linked.title}
                          for target in note.links
                          if (linked := brain.notes.get(target)) is not None
                          and access.can_read(brain, person, linked)]}

    @mcp.tool(annotations=READ_ONLY, description="Identify the person and role attached to this MCP link.")
    def whoami() -> dict:
        person_id, _ = caller()
        person = cache.get().policy.people[person_id]
        return {"id": person.id, "name": person.name, "title": person.title}

    @mcp.tool(annotations=READ_ONLY, name="search", description="Search readable company notes. Cite note titles and dates in answers; pass any hints to the user verbatim.")
    def search_notes(query: str) -> dict:
        person_id, _ = caller()
        hits, hints = search.search(cache.get(), person_id, query)
        return {"hits": [{**hit.__dict__, "date": hit.date.isoformat() if hit.date else None}
                         for hit in hits], "hints": [hint.text() for hint in hints]}

    @mcp.tool(annotations=READ_ONLY, name="read_note", description="Read one permitted note. Missing and unreadable IDs give the same result. Cite its title and date in answers.")
    def read_note(id: str) -> dict:
        person_id, _ = caller()
        return note_payload(person_id, id) or _NOT_FOUND

    @mcp.tool(annotations=READ_ONLY, description="Get a cited context packet for a question. Phrase the answer using readable evidence, cite note titles and dates, and pass hints on verbatim.")
    def ask(question: str) -> dict:
        person_id, _ = caller()
        brain = cache.get()
        packet = ask_module.ask(brain, person_id, question)  # already access-filtered
        brief = packet["brief"]
        dated = {hit["id"]: hit["date"] for hit in packet["hits"]}
        sources = []
        for src in brief["sources"]:
            note = brain.notes.get(src["id"])
            date = dated.get(src["id"]) or (note.date.isoformat() if note and note.date else None)
            sources.append({"title": src["title"], "date": date})
        out = {"present_as": "One bold sentence answering; up to 3 short bullets; 'Conflict: …' line only if "
                             "present; 'Sources:' titles + dates; end with any hint verbatim.",
               "brief": brief, "sources": sources, "hints": packet["hints"]}
        if packet.get("frameworks"):
            out["frameworks"] = [f.get("name", f) if isinstance(f, dict) else f for f in packet["frameworks"]]
        out["evidence"] = [{"title": h["title"], "date": h["date"], "snippet": (h["snippet"] or "")[:200]}
                           for h in packet["hits"][:4]]
        return out

    @mcp.tool(annotations=READ_ONLY, description="Find the declared owner of an area by its name or topics. This reveals no notes.")
    def who_owns(topic: str) -> list[dict]:
        caller()
        brain = cache.get()
        query = topic.casefold().strip()
        return [{"area": area.id, "area_name": area.name, "owner": area.owner,
                 "owner_name": brain.policy.people[area.owner].name}
                for area in brain.policy.areas.values()
                if area.owner in brain.policy.people and query
                and (query in area.name.casefold() or query in area.id.casefold()
                     or any(query in value.casefold() for value in area.topics))]

    @mcp.tool(annotations=READ_ONLY, name="who_knows", description="Find people with declared expertise or viewer-readable activity evidence.")
    def who_knows_tool(topic: str) -> list[dict]:
        person_id, _ = caller()
        return people.who_knows(cache.get(), person_id, topic)

    @mcp.tool(annotations=READ_ONLY, name="person", description="Get a person's declared profile and viewer-readable activity and collaborators.")
    def person_tool(id: str) -> dict:
        person_id, _ = caller()
        try:
            return people.profile(cache.get(), person_id, id)
        except KeyError:
            return {"error": "Person not found"}

    @mcp.tool(annotations=READ_ONLY, description="List high-severity conflicts routed to you when both notes are readable. Cite both note titles and dates.")
    def my_conflicts() -> list[dict]:
        person_id, _ = caller()
        brain = cache.get()
        visible = {note.id: note for note in access.readable(brain, person_id)}
        return [{"key": list(conflict.key), "winner": conflict.winner,
                 "winner_title": visible[conflict.winner].title,
                 "winner_date": visible[conflict.winner].date.isoformat() if visible[conflict.winner].date else None,
                 "challenger": conflict.challenger,
                 "challenger_title": visible[conflict.challenger].title,
                 "challenger_date": visible[conflict.challenger].date.isoformat() if visible[conflict.challenger].date else None,
                 "severity": conflict.severity, "route_to": conflict.route_to, "reason": conflict.reason}
                for resolution in precedence.resolve_for(brain, person_id)
                for conflict in resolution.conflicts
                if conflict.severity == "high" and conflict.route_to == person_id
                and conflict.winner in visible and conflict.challenger in visible]

    @mcp.tool(annotations=READ_ONLY, description="Get your personal web graph URL.")
    def graph_link() -> str:
        person_id, token = caller()
        if graph_url is not None:
            return graph_url(person_id)
        base = os.getenv("BRAIN_BASE_URL", "http://localhost:8000").rstrip("/")
        if not token:
            token = next((key for key, value in cache.get().policy.tokens.items()
                          if value == person_id), "")
        parameter = f"token={quote(token)}" if os.getenv("BRAIN_DEMO", "1") == "0" else f"person={quote(person_id)}"
        return f"{base}/?{parameter}"

    def api_person(request: Request) -> str | None:
        brain = cache.get()
        fixed = fixed_person.get()
        if fixed is not None:
            return fixed if fixed in brain.policy.people else None
        if os.getenv("BRAIN_DEMO", "1") == "0":
            person = brain.policy.tokens.get(request.query_params.get("token", ""))
        else:
            person = request.query_params.get("person")
        return person if person in brain.policy.people else None

    @mcp.custom_route("/api/people", methods=["GET"])
    async def people_route(request: Request) -> Response:
        if os.getenv("BRAIN_DEMO", "1") == "0" or fixed_person.get() is not None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return JSONResponse([{"id": p.id, "name": p.name, "title": p.title}
                             for p in cache.get().policy.people.values()])

    @mcp.custom_route("/api/graph", methods=["GET"])
    async def graph_route(request: Request) -> Response:
        person = api_person(request)
        if person is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return JSONResponse(graph.export(cache.get(), person,
                                         demo_ghosts=(os.getenv("BRAIN_DEMO", "1") != "0" and fixed_person.get() is None and
                                                      request.query_params.get("ghosts") == "1"),
                                         people=request.query_params.get("people") == "1"))

    @mcp.custom_route("/api/person", methods=["GET"])
    async def person_route(request: Request) -> Response:
        viewer = api_person(request)
        if viewer is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        try:
            return JSONResponse(people.profile(cache.get(), viewer, request.query_params.get("id", "")))
        except KeyError:
            return JSONResponse({"error": "Person not found"}, status_code=404)

    @mcp.custom_route("/api/who", methods=["GET"])
    async def who_route(request: Request) -> Response:
        viewer = api_person(request)
        if viewer is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return JSONResponse(people.who_knows(cache.get(), viewer, request.query_params.get("q", "")))

    @mcp.custom_route("/api/note", methods=["GET"])
    async def note_route(request: Request) -> Response:
        person = api_person(request)
        payload = note_payload(person, request.query_params.get("id", "")) if person else None
        return JSONResponse(payload if payload else _NOT_FOUND, status_code=200 if payload else 404)

    @mcp.custom_route("/api/ask", methods=["GET"])
    async def ask_route(request: Request) -> Response:
        person = api_person(request)
        if person is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        brain, question = cache.get(), request.query_params.get("q", "")
        packet = ask_module.ask(brain, person, question)
        # LLM answer from the viewer-filtered packet only; blocking subprocess, so off the event loop.
        packet["rag"] = (await run_in_threadpool(rag.generate_limited, question, packet, brain)
                         if len(question) <= rag.MAX_QUESTION else None)
        return JSONResponse(packet)

    @mcp.custom_route("/", methods=["GET"])
    @mcp.custom_route("/{path:path}", methods=["GET"])
    async def static_route(request: Request) -> Response:
        relative = request.path_params.get("path", "") or "index.html"
        target = (WEB_ROOT / relative).resolve()
        if not target.is_relative_to(WEB_ROOT.resolve()) or not target.is_file():
            return Response(status_code=404)
        return FileResponse(target)

    # stateful streamable HTTP (session id + SSE): what claude.ai's connector expects
    if os.getenv("BRAIN_MCP_STATEFUL") == "1":
        inner = mcp.http_app(path="/mcp")
    else:
        inner = mcp.http_app(path="/mcp", stateless_http=True, json_response=True)
    inner.router.routes.sort(key=lambda r: getattr(r, "path", "") != "/mcp")  # /mcp before the static catch-all

    async def brain_app(scope, receive, send):
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return
        path = scope.get("path", "")
        token = None
        if path == "/mcp":
            person = os.getenv("BRAIN_PERSON")
            if person not in cache.get().policy.people:
                await Response(status_code=404)(scope, receive, send)
                return
        elif path.count("/") == 2 and path.endswith("/mcp"):
            token = path.split("/")[1]
            person = cache.get().policy.tokens.get(token)
            if person not in cache.get().policy.people:
                await Response(status_code=404)(scope, receive, send)
                return
            scope = {**scope, "path": "/mcp", "raw_path": b"/mcp"}
        else:
            await inner(scope, receive, send)
            return
        marker = _identity.set((person, token or ""))
        try:
            if os.getenv("BRAIN_MCP_PIN") and scope.get("method") == "POST":
                receive, send = await _pinned_initialize(receive, send)
            if scope.get("method") == "GET":
                await _primed_stream(inner, scope, receive, send)
                return
            await inner(scope, receive, send)
        finally:
            _identity.reset(marker)

    async def origin_checked(scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            if path.startswith("/api/") or path == "/mcp" or path.endswith("/mcp"):
                headers = dict(scope.get("headers", []))
                origin = headers.get(b"origin")
                if origin is not None:
                    try:
                        parsed = urlsplit(origin.decode("latin-1"))
                        origin_host = parsed.hostname
                    except ValueError:
                        await Response(status_code=403)(scope, receive, send)
                        return
                    if (parsed.scheme not in ("http", "https") or
                            not origin_host or origin_host.lower() not in allowed_hosts | CHAT_ORIGINS or
                            parsed.username or parsed.password or parsed.path not in ("", "/") or
                            parsed.query or parsed.fragment):
                        await Response(status_code=403)(scope, receive, send)
                        return
        await brain_app(scope, receive, send)

    mcp.brain_app = TrustedHostMiddleware(origin_checked, allowed_hosts=sorted(allowed_hosts))
    mcp.brain_cache = cache
    return mcp


async def _pinned_initialize(receive, send):
    """Debug for chat clients: answer initialize as 2025-06-18 with tools-only capabilities (env BRAIN_MCP_PIN)."""
    import json as _json
    chunks, more = [], True
    while more:
        msg = await receive()
        chunks.append(msg.get("body", b""))
        more = msg.get("more_body", False)
    body = b"".join(chunks)
    try:
        req = _json.loads(body)
    except ValueError:
        req = None
    is_init = isinstance(req, dict) and req.get("method") == "initialize"
    if is_init:
        req.setdefault("params", {})["protocolVersion"] = "2025-06-18"
        body = _json.dumps(req).encode()
    sent = {"done": False}

    async def recv():
        if sent["done"]:
            return await receive()  # block until the client really goes away
        sent["done"] = True
        return {"type": "http.request", "body": body, "more_body": False}

    if not is_init:
        return recv, send

    async def snd(msg):
        if msg["type"] == "http.response.start":
            msg = {**msg, "headers": [(k, v) for k, v in msg.get("headers", []) if k.lower() != b"content-length"]}
        elif msg["type"] == "http.response.body" and msg.get("body"):
            def fix(m):
                try:
                    obj = _json.loads(m.group(1))
                    obj["result"]["capabilities"] = {"tools": {"listChanged": False}}
                    obj["result"].pop("instructions", None)
                    return "data: " + _json.dumps(obj)
                except Exception:
                    return m.group(0)
            text = msg["body"].decode()
            text = re.sub(r"data: (\{.*\})", fix, text) if "data: " in text else (
                fix(re.match(r"(\{.*\})", text, re.S)).removeprefix("data: ") if text.startswith("{") else text)
            msg = {**msg, "body": text.encode()}
        await send(msg)
    return recv, snd


async def _primed_stream(app, scope, receive, send):
    """GET event stream: send a comment right after the headers and every 15 s, so proxies
    (Cloudflare tunnels) pass the headers on at once instead of holding them until the first event."""
    import asyncio
    lock, state = asyncio.Lock(), {"open": False, "done": False}

    async def snd(msg):
        async with lock:
            if state["done"]:
                return
            await send(msg)
            if msg["type"] == "http.response.start" and msg.get("status") == 200:
                state["open"] = True
                await send({"type": "http.response.body", "body": b": ok\n\n", "more_body": True})
            elif msg["type"] == "http.response.body" and not msg.get("more_body", False):
                state["done"] = True

    async def pinger():
        while True:
            await asyncio.sleep(15)
            async with lock:
                if state["done"]:
                    return
                if state["open"]:
                    try:
                        await send({"type": "http.response.body", "body": b": ping\n\n", "more_body": True})
                    except Exception:
                        return

    task = asyncio.create_task(pinger())
    try:
        await app(scope, receive, snd)
    finally:
        task.cancel()
