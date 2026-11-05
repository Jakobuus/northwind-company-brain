"""Multi-company mode for the web platform: many orgs under BRAIN_ROOT, one process.

Contract: docs/design.md "Platform". The Nest api calls ``/internal/*`` (shared secret); browsers use
``/v/<signed token>/...``; chat clients use ``/<org>.<random>/mcp``. All reads still go through
``brain.access`` (the per-org servers are the ordinary single-company ones)."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
from datetime import datetime, timezone
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode

import yaml
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import access, classify, embed, extract, layers, store
from .intake.envelope import slugify
from .intake.registry import import_path
from .schema import Note
from .intake.write import write_note
from .server import build_server, fixed_person

ORG_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
ACCESS_MODES = {"all", "area", "restricted", "private"}
MAX_UPLOAD = 25 * 1024 * 1024
MAX_TTL = 30 * 24 * 3600
_policy_lock = threading.Lock()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def not_found() -> Response:
    return Response("Not Found", status_code=404, media_type="text/plain")


class BadRequest(Exception):
    pass


class TooLarge(Exception):
    pass


def capped(receive, limit: int):
    """ASGI receive that refuses request bodies over `limit` bytes, whatever the headers claim (chunked too)."""
    seen = 0

    async def wrapped():
        nonlocal seen
        message = await receive()
        if message["type"] == "http.request":
            seen += len(message.get("body", b""))
            if seen > limit:
                raise TooLarge()
        return message
    return wrapped


# ---------------------------------------------------------------- view tokens

class ViewTokens:
    """token = b64(org|person|exp) . b64(HMAC-SHA256(key, org|person|exp)); stateless."""

    def __init__(self, secret: str):
        self._key = hashlib.sha256(b"brain-view-v1:" + secret.encode()).digest()

    def _sig(self, payload: bytes) -> bytes:
        return hmac.new(self._key, payload, hashlib.sha256).digest()

    def make(self, org: str, person: str, ttl: int) -> str:
        payload = f"{org}|{person}|{int(time.time()) + ttl}".encode()
        return f"{_b64(payload)}.{_b64(self._sig(payload))}"

    def verify(self, token: str) -> tuple[str, str] | None:
        try:
            body, sig = token.split(".", 1)
            payload = _unb64(body)
            if not hmac.compare_digest(self._sig(payload), _unb64(sig)):
                return None
            org, person, exp = payload.decode().split("|")
            if int(exp) < time.time() or not ORG_RE.fullmatch(org) or not ID_RE.fullmatch(person):
                return None
        except (ValueError, UnicodeError):
            return None
        return org, person


_NOTE_FIELDS = set(Note.__dataclass_fields__)
_RESERVED = {"moved", "origin_dept", "added_at", extract.MARK, "speaker"}  # set by the brain only, never taken from a file
_FM = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _when(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _note_path(org_dir: Path, env) -> Path:
    folder = (Path("personal") / env.area.removeprefix("personal-") if env.area.startswith("personal-")
              else Path(env.area))
    return org_dir / folder / f"{slugify(env.id)}.md"


def _fresh_id(org_dir: Path, env, taken: set[str]) -> str:
    """Slug of the title if no note of the org has that id and no file would be reused, else with a random suffix."""
    base = slugify(env.title)[:60].rstrip("-") or "untitled"
    if base not in taken and not _note_path(org_dir, replace(env, id=base)).exists():
        return base
    while True:
        candidate = f"{base}-{secrets.token_hex(4)}"
        if candidate not in taken:
            return candidate


# ---------------------------------------------------------------- policy files

def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + f".{secrets.token_hex(4)}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _read_policy(org_dir: Path) -> dict:
    try:
        raw = yaml.safe_load((org_dir / "policy.yaml").read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return {}
    return raw if isinstance(raw, dict) else {}


def build_policy(org: str, body: dict, existing: dict) -> dict:
    """Validate the api payload and return a policy mapping in the on-disk format."""
    people_in, areas_in = body.get("people"), body.get("areas") or {}
    if not isinstance(people_in, dict) or not isinstance(areas_in, dict):
        raise BadRequest("people and areas must be objects")
    people: dict = {}
    for pid, p in people_in.items():
        if not isinstance(pid, str) or not ID_RE.fullmatch(pid) or not isinstance(p, dict):
            raise BadRequest(f"invalid person id {str(pid)[:40]!r}")
        rank, groups = p.get("rank", 0), p.get("groups") or []
        if isinstance(rank, bool) or not isinstance(rank, int):
            raise BadRequest(f"rank of {pid} must be an integer")
        if not isinstance(groups, list) or not all(isinstance(g, str) for g in groups):
            raise BadRequest(f"groups of {pid} must be a list of strings")
        people[pid] = {"name": str(p.get("name") or pid), "title": str(p.get("title") or ""),
                       "rank": rank, "groups": groups, "home": p.get("home") or None}
    areas: dict = {}
    for slug, a in areas_in.items():
        if (not isinstance(slug, str) or not ID_RE.fullmatch(slug) or slug.startswith("personal-")
                or not isinstance(a, dict)):
            raise BadRequest(f"invalid area slug {str(slug)[:40]!r}")
        for key in ("readers", "topics"):
            if not isinstance(a.get(key) or [], list) or not all(isinstance(x, str) for x in a.get(key) or []):
                raise BadRequest(f"{key} of {slug} must be a list of strings")
        owner = a.get("owner") or ""
        if owner and owner not in people:
            raise BadRequest(f"owner of {slug} is not a known person")
        areas[slug] = {"name": str(a.get("name") or slug), "owner": owner,
                       "readers": list(a.get("readers") or []), "topics": list(a.get("topics") or [])}
        if "leads" in a:  # access model v2 department
            leads = a.get("leads") or []
            if not isinstance(leads, list) or not all(isinstance(x, str) and x in people for x in leads):
                raise BadRequest(f"leads of {slug} must be known people")
            areas[slug]["leads"] = list(dict.fromkeys(leads))
            areas[slug]["owner"] = owner or (leads[0] if leads else "")
            # members read the department; people given group grant:<slug> read it too
            areas[slug]["readers"] = list(dict.fromkeys([*areas[slug]["readers"], slug, f"grant:{slug}"]))
    if "core" not in areas:  # everyone reads core; personal-<id> areas are added by store.load
        boss = max(people, key=lambda x: people[x]["rank"], default="")
        areas = {"core": {"name": "Company core", "owner": boss, "readers": ["everyone"], "topics": []},
                 **areas}
    for p in people.values():
        if p["home"] is not None and p["home"] not in areas:
            p["home"] = None
    for slug, a in areas.items():  # v2: home department and lead status imply membership of the group
        if "leads" in a:
            for pid, p in people.items():
                if (p["home"] == slug or pid in a["leads"]) and slug not in p["groups"]:
                    p["groups"] = [*p["groups"], slug]
    company = existing.get("company") if isinstance(existing.get("company"), dict) else {}
    name = body.get("company_name") or body.get("name") or company.get("name") or org
    tokens = {t: who for t, who in (existing.get("tokens") or {}).items() if who in people}
    out = {"company": {"id": org, "name": str(name)}, "people": people, "areas": areas, "tokens": tokens}
    rules = body["access_rules"] if "access_rules" in body else existing.get("access_rules")
    if rules is not None:  # upload classification table; absent = built-in defaults
        if not isinstance(rules, list) or classify.rules_of(rules) is classify.DEFAULT_RULES and rules:
            raise BadRequest("access_rules must be a list of {kind, keywords, to: leads|department}")
        out["access_rules"] = classify.rules_of(rules) if rules else []
    return out


def changes_since(brain, person: str, since: datetime | None, limit: int = 200) -> list[dict]:
    """Readable notes added or moved after `since`. Built from `access.readable` only."""
    out = []
    for note in access.readable(brain, person):
        added = _when(note.extra.get("added_at"))
        if added is None and note.path is not None:
            try:
                added = datetime.fromtimestamp(Path(note.path).stat().st_mtime, timezone.utc)
            except OSError:
                continue
        moves = layers.moved_of(note)
        moved = _when(moves[-1].get("at")) if moves else None
        at, kind = (moved, "moved") if moved and (added is None or moved >= added) else (added, "added")
        if at is None or (since is not None and at <= since):
            continue
        out.append({"id": note.id, "title": note.title, "layer": layers.layer_of(brain, note),
                    "dept": layers.dept_of(brain, note), "kind": kind, "at": at.isoformat(timespec="microseconds")})
    out.sort(key=lambda c: c["at"], reverse=True)
    return out[:limit]


MAX_VIEW_UPLOAD = 10 * 1024 * 1024
UPLOADS_PER_MINUTE = 10
_upload_slots = threading.BoundedSemaphore(2)
_upload_log: dict[str, list[float]] = {}
_upload_lock = threading.Lock()


def upload_rate_ok(key: str) -> bool:
    now = time.monotonic()
    with _upload_lock:
        recent = [t for t in _upload_log.get(key, []) if now - t < 60]
        if len(recent) >= UPLOADS_PER_MINUTE:
            _upload_log[key] = recent
            return False
        _upload_log[key] = [*recent, now]
        return True


# ---------------------------------------------------------------- org registry

class Registry:
    def __init__(self, root: Path, secret: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.secret = secret
        self.tokens = ViewTokens(secret)
        self.public_url = (os.getenv("BRAIN_PUBLIC_URL") or os.getenv("BRAIN_BASE_URL")
                           or "http://localhost:8000").rstrip("/")
        self._orgs: dict[str, object] = {}
        self._tasks: dict[str, tuple[asyncio.Task, asyncio.Event]] = {}
        self._lock: asyncio.Lock | None = None

    def org_dir(self, org: str) -> Path:
        if not ORG_RE.fullmatch(org or ""):
            raise BadRequest("invalid org id")
        path = (self.root / org).resolve()
        if path.parent != self.root:
            raise BadRequest("invalid org id")
        return path

    def exists(self, org: str) -> bool:
        try:
            return (self.org_dir(org) / "policy.yaml").is_file()
        except BadRequest:
            return False

    def _build(self, org: str):
        server = build_server(self.org_dir(org),
                              graph_url=lambda person: self.view_url(org, person, 24 * 3600))
        server.brain_cache.auto_index = True  # reload -> meaning index refresh, like `serve --data`
        if os.getenv("BRAIN_EMBED") != "0":
            threading.Thread(target=embed.ensure_index, args=(server.brain_cache.brain,), daemon=True).start()
        return server

    async def server(self, org: str):
        """Lazy per-org server, with its ASGI lifespan running in a task of its own."""
        if org in self._orgs:
            return self._orgs[org]
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            if org in self._orgs:
                return self._orgs[org]
            server = await run_in_threadpool(self._build, org)
            ready, stop = asyncio.Event(), asyncio.Event()

            async def run():
                queue: asyncio.Queue = asyncio.Queue()
                await queue.put({"type": "lifespan.startup"})

                async def send(message):
                    if message["type"].startswith("lifespan.startup"):
                        ready.set()

                async def receive():
                    if queue.empty() and ready.is_set():
                        await stop.wait()
                        return {"type": "lifespan.shutdown"}
                    return await queue.get()
                try:
                    await server.brain_app({"type": "lifespan", "asgi": {"version": "3.0"}}, receive, send)
                finally:
                    ready.set()
            self._tasks[org] = (asyncio.create_task(run()), stop)
            await ready.wait()
            self._orgs[org] = server
            return server

    async def shutdown(self):
        for task, stop in self._tasks.values():
            stop.set()
        for task, _ in self._tasks.values():
            try:
                await asyncio.wait_for(task, 5)
            except (asyncio.TimeoutError, Exception):  # noqa: BLE001
                task.cancel()

    def refresh(self, org: str) -> None:
        """Make the running org server notice a file change now instead of within 5 seconds."""
        server = self._orgs.get(org)
        if server is not None:
            server.brain_cache.checked_at = float("-inf")
            server.brain_cache.get()

    def view_url(self, org: str, person: str, ttl: int) -> str:
        return f"{self.public_url}/v/{self.tokens.make(org, person, ttl)}/"

    # ---- sync file operations (run in a thread)

    def put_policy(self, org: str, body: dict) -> dict:
        org_dir = self.org_dir(org)
        with _policy_lock:
            org_dir.mkdir(parents=True, exist_ok=True)
            policy = build_policy(org, body, _read_policy(org_dir))
            _atomic_write(org_dir / "policy.yaml",
                          yaml.safe_dump(policy, sort_keys=False, allow_unicode=True, default_flow_style=False))
        self.refresh(org)
        return {"ok": True, "people": len(policy["people"]), "areas": len(policy["areas"])}

    def mcp_link(self, org: str, person: str) -> str:
        org_dir = self.org_dir(org)
        with _policy_lock:
            raw = _read_policy(org_dir)
            if person not in (raw.get("people") or {}):
                raise KeyError(person)
            tokens = raw.get("tokens") if isinstance(raw.get("tokens"), dict) else {}
            token = next((t for t, who in tokens.items() if who == person and t.startswith(f"{org}.")), None)
            if token is None:
                token = f"{org}.{secrets.token_urlsafe(24)}"
                raw["tokens"] = {**tokens, token: person}
                _atomic_write(org_dir / "policy.yaml",
                              yaml.safe_dump(raw, sort_keys=False, allow_unicode=True, default_flow_style=False))
        self.refresh(org)
        return f"{self.public_url}/{quote(token)}/mcp"

    def notes_for(self, org: str, person: str) -> list[dict]:
        brain = store.load(self.org_dir(org))
        if person not in brain.policy.people:
            raise KeyError(person)
        return [{"id": n.id, "title": n.title, "type": n.type, "area": n.area,
                 "date": n.date.isoformat() if n.date else None, "access": n.access,
                 **layers.describe(brain, person, n)}
                for n in sorted(access.readable(brain, person), key=lambda n: (str(n.date or ""), n.id), reverse=True)]

    def move_note(self, org: str, note_id: str, to: str, by: str) -> dict | None:
        """Move a note to another layer if `by` may. None = refused (same for unreadable, missing, forbidden)."""
        if to not in ("dept", "dept-core", "core"):
            raise BadRequest("to must be dept, dept-core or core")
        org_dir = self.org_dir(org)
        with _policy_lock:
            brain = store.load(org_dir)
            note = brain.notes.get(note_id)
            if note is None or note.path is None or not access.can_read(brain, by, note):
                return None
            plan = layers.plan_move(brain, by, note, to)
            if plan is None:
                return None
            area, mode, origin = plan
            before = layers.layer_of(brain, note)
            path = Path(note.path)
            text = path.read_text(encoding="utf-8")
            match = _FM.match(text)
            if match is None:
                return None
            fm = yaml.safe_load(match.group(1)) or {}
            entry = {"from": before, "to": to, "by": by, "at": _now()}
            fm.update({"area": area, "access": mode, "moved": [*layers.moved_of(note), entry]})
            fm.setdefault("added_at", datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="microseconds"))
            if before == "private":
                fm["allow"] = []  # a committed note starts department-wide, never with leftover grants
            if origin:
                fm["origin_dept"] = origin
            new_text = f"---\n{yaml.safe_dump(fm, sort_keys=False, allow_unicode=True)}---\n{text[match.end():]}"
            folder = org_dir / area
            target = folder / f"{path.stem}.md"
            if target != path and target.exists():
                target = folder / f"{path.stem}-{secrets.token_hex(4)}.md"
            if not target.resolve().is_relative_to(org_dir.resolve()):
                return None
            target.parent.mkdir(parents=True, exist_ok=True)
            if target == path:
                _atomic_write(path, new_text)
            else:
                with target.open("x", encoding="utf-8") as stream:
                    stream.write(new_text)
                path.unlink()
            # extracted notes follow their source (same lock, before anyone reloads); none yet -> extract now
            moved_children = extract.sync_children(org_dir, note_id)
        self.refresh(org)  # reload + meaning-index rebuild
        if not moved_children:
            extract.enqueue(org_dir, note_id, lambda: self.refresh(org))
        return {"ok": True, "id": note_id, "layer": to, "dept": origin or (area if to != "core" else None),
                "moved": [*layers.moved_of(note), entry]}

    def import_upload(self, org: str, filename: str, data: bytes, fields: dict) -> dict:
        org_dir = self.org_dir(org)
        brain = store.load(org_dir)
        policy, taken = brain.policy, set(brain.notes)
        author, mode = fields.get("author") or "", fields.get("access") or "area"
        if author not in policy.people:
            raise BadRequest("author is not a known person")
        if mode not in ACCESS_MODES:
            raise BadRequest("access must be all, area, restricted or private")
        allow = [x.strip() for x in (fields.get("allow") or "").split(",") if x.strip()]
        if any(x not in policy.people for x in allow):
            raise BadRequest("allow contains an unknown person")
        if mode == "private":
            area, allow = f"personal-{author}", []
        else:
            area = fields.get("area") or "core"
            if area not in policy.areas or area.startswith("personal-"):
                raise BadRequest("unknown area")
        safe = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(filename.replace("\\", "/")).name).lstrip(".") or "upload.txt"
        tmp = Path(tempfile.mkdtemp(prefix="brain-upload-"))
        try:
            src = tmp / safe[-120:]
            src.write_bytes(data)
            skipped: list[str] = []
            defaults = {"area": area, "access": mode, "author": author, "allow": allow,
                        "people": {pid: p.name for pid, p in policy.people.items()}}
            envelopes = import_path(src, defaults, skipped=skipped)
            # The uploader's choices win over anything the file's own frontmatter claims.
            # Uploads are plain documents: no id, type or precedence/claim keys from the file's frontmatter
            # (they could shadow another note or win a conflict). Each note gets a fresh org-unique id.
            suggestions: list[dict | None] = [None] * len(envelopes)
            if fields.get("classify"):  # the brain decides: department-wide, or leads only (see classify.py)
                rules = classify.rules_of(_read_policy(org_dir).get("access_rules"))
                suggestions = [classify.suggest(brain, rules, author, area, e.title, e.body, use_model=(i == 0))
                               for i, e in enumerate(envelopes)]
                # one upload = one decision: every part gets the most restrictive result (never fail open)
                tight = next((s for s in suggestions if s and s["access"] == "restricted"), None)
                if tight is not None:
                    suggestions = [tight] * len(envelopes)
            areas_of = [s["department"] if s else area for s in suggestions]  # classify may file elsewhere
            envelopes = [replace(e, author=author, area=a, type="document",
                                 access=s["access"] if s else mode, allow=s["allow"] if s else allow,
                                 frontmatter={**{k: v for k, v in e.frontmatter.items() if k not in _NOTE_FIELDS | _RESERVED},
                                              "added_at": _now()})
                         for e, s, a in zip(envelopes, suggestions, areas_of)]
            paths = []
            for index, e in enumerate(envelopes):
                envelopes[index] = e = replace(e, id=_fresh_id(org_dir, e, taken))
                if e.id in taken or _note_path(org_dir, e).exists():  # never keep-first silently: refuse
                    raise BadRequest("note id already exists in this org")
                path = write_note(e, org_dir)
                if path.stem != e.id:
                    raise BadRequest("could not assign a unique note id")
                taken.add(e.id)
                paths.append(path)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        self.refresh(org)  # reload + background meaning-index rebuild for this org
        for p in paths:  # facts/decisions/remarks appear a few seconds later (background, Haiku)
            extract.enqueue(org_dir, p.stem, lambda: self.refresh(org))
        imported = []
        for p, e in zip(paths, envelopes):
            area = e.area
            shown = Note(id="", type="document", title="", area=area, access=e.access, allow=e.allow, author=author)
            layer = layers.layer_of(brain, shown)
            dept = layers.home_dept(brain, author) if layer == "private" else (None if layer == "core" else area)
            imported.append({"id": p.stem, "title": e.title, "layer": layer, "dept": dept})
        reasons = [m.replace(str(src), safe).replace(str(tmp), "") for m in skipped]
        out = [{"name": safe, "reason": r} for r in reasons]
        if not imported and not out:
            out = [{"name": safe, "reason": "no notes could be made from this file"}]
        result = {"imported": imported, "skipped": out}
        if suggestions and suggestions[0] is not None:
            result["suggested"] = suggestions[0]  # all parts share it (see the restrictive merge above)
        return result


# ---------------------------------------------------------------- ASGI app

def build_platform_app(root: Path, secret: str):
    reg = Registry(root, secret)

    def index_all() -> None:  # every org's meaning index is ready before its first question
        from brain import embed
        for d in sorted(p for p in Path(root).iterdir() if (p / "policy.yaml").is_file()):
            embed.ensure_index(store.load(d))
    if os.getenv("BRAIN_EMBED") != "0" and Path(root).is_dir():
        threading.Thread(target=index_all, daemon=True).start()

    def authed(request: Request) -> bool:
        given = request.headers.get("x-brain-service", "")
        return hmac.compare_digest(given.encode(), secret.encode())

    async def internal(request: Request) -> Response:
        if not authed(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        parts = request.url.path.split("/")  # ['', 'internal', 'orgs', org, kind]
        if parts[1:3] != ["internal", "orgs"] or len(parts) not in (5, 7):
            return not_found()
        org, kind, method = parts[3], parts[4], request.method
        if len(parts) == 7:
            if not (kind == "notes" and parts[6] == "move" and method == "POST"):
                return not_found()
            kind = "move"
        try:
            reg.org_dir(org)
            if kind == "policy" and method == "PUT":
                body = await request.json()
                if not isinstance(body, dict):
                    raise BadRequest("JSON object expected")
                return JSONResponse(await run_in_threadpool(reg.put_policy, org, body))
            if not reg.exists(org):
                return JSONResponse({"error": "Unknown org"}, status_code=404)
            if kind == "import" and method == "POST":
                if int(request.headers.get("content-length") or 0) > MAX_UPLOAD + 65536:
                    return JSONResponse({"error": "File too large"}, status_code=413)
                form = await request.form(max_files=1, max_fields=20)
                upload = form.get("file")
                if upload is None or not hasattr(upload, "read"):
                    raise BadRequest("multipart field 'file' is required")
                data = await upload.read(MAX_UPLOAD + 1)
                if len(data) > MAX_UPLOAD:
                    return JSONResponse({"error": "File too large"}, status_code=413)
                fields = {k: str(form.get(k) or "") for k in ("area", "access", "author", "allow")}
                return JSONResponse(await run_in_threadpool(
                    reg.import_upload, org, upload.filename or "upload.txt", data, fields))
            if kind == "move":
                body = await request.json()
                if not isinstance(body, dict) or not isinstance(body.get("to"), str):
                    raise BadRequest("to is required")
                done = await run_in_threadpool(reg.move_note, org, parts[5], body["to"], str(body.get("by") or ""))
                if done is None:  # one body for unreadable, missing and forbidden
                    return JSONResponse({"error": "Forbidden"}, status_code=403)
                return JSONResponse(done)
            if kind == "notes" and method == "GET":
                return JSONResponse(await run_in_threadpool(
                    reg.notes_for, org, request.query_params.get("person", "")))
            if kind == "view-token" and method == "POST":
                body = await request.json()
                person = body.get("person") if isinstance(body, dict) else None
                ttl = body.get("ttl_seconds", 3600) if isinstance(body, dict) else 3600
                if isinstance(ttl, bool) or not isinstance(ttl, int) or not 1 <= ttl <= MAX_TTL:
                    raise BadRequest(f"ttl_seconds must be 1..{MAX_TTL}")
                if not isinstance(person, str) or person not in store.load(reg.org_dir(org)).policy.people:
                    return JSONResponse({"error": "Unknown person"}, status_code=404)
                return JSONResponse({"url": reg.view_url(org, person, ttl)})
            if kind == "mcp-link" and method == "GET":
                return JSONResponse({"url": await run_in_threadpool(
                    reg.mcp_link, org, request.query_params.get("person", ""))})
        except TooLarge:
            return JSONResponse({"error": "File too large"}, status_code=413)
        except BadRequest as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except KeyError:
            return JSONResponse({"error": "Unknown person"}, status_code=404)
        except ValueError:  # bad JSON / form
            return JSONResponse({"error": "Bad request"}, status_code=400)
        return not_found()

    async def view_changes(request: Request, brain, person: str) -> Response:
        raw = request.query_params.get("since")
        since = _when(raw) if raw else None
        if raw and since is None:
            return JSONResponse({"error": "since must be an ISO timestamp"}, status_code=400)
        return JSONResponse({"now": _now(), "changes": changes_since(brain, person, since)})

    async def view_upload(request: Request, org: str, brain, person: str) -> Response:
        if not upload_rate_ok(f"{org}/{person}") or not _upload_slots.acquire(blocking=False):
            return JSONResponse({"error": "Too many uploads, try again shortly"}, status_code=429)
        try:
            if int(request.headers.get("content-length") or 0) > MAX_VIEW_UPLOAD + 65536:
                return JSONResponse({"error": "File too large"}, status_code=413)
            form = await request.form(max_files=1, max_fields=10)
            upload = form.get("file")
            layer = str(form.get("layer") or "dept")
            if upload is None or not hasattr(upload, "read") or layer not in layers.LAYERS:
                return JSONResponse({"error": "file is required; layer must be private|dept|dept-core|core"},
                                    status_code=400)
            target = layers.upload_target(brain, person, layer)
            if target is None:  # e.g. core by a non-admin, dept-core by a non-lead
                return JSONResponse({"error": "Forbidden"}, status_code=403)
            data = await upload.read(MAX_VIEW_UPLOAD + 1)
            if len(data) > MAX_VIEW_UPLOAD:
                return JSONResponse({"error": "File too large"}, status_code=413)
            area, mode = target
            allow = ""
            explicit = bool(str(form.get("access") or "") or str(form.get("allow") or ""))
            classify_it = layer == "dept" and not explicit  # no choices sent: the brain decides who sees it
            if layer == "dept" and str(form.get("access") or "") == "restricted":
                # a lead files a department note for a named few only (e.g. "team leads only")
                if not layers.is_lead(brain, person, area):
                    return JSONResponse({"error": "Forbidden"}, status_code=403)
                mode, allow = "restricted", str(form.get("allow") or "")
            try:
                return JSONResponse(await run_in_threadpool(
                    reg.import_upload, org, upload.filename or "upload.txt", data,
                    {"area": area, "access": mode, "author": person, "allow": allow, "classify": classify_it}))
            except BadRequest as exc:
                return JSONResponse({"error": str(exc)}, status_code=400)
        except TooLarge:
            return JSONResponse({"error": "File too large"}, status_code=413)
        except ValueError:
            return JSONResponse({"error": "Bad request"}, status_code=400)
        finally:
            _upload_slots.release()

    async def view_facts(request: Request, brain, person: str) -> Response:
        """Facts extracted from one source note, only those `person` may read. A missing or unreadable
        source gives the same empty answer."""
        source = brain.notes.get(request.query_params.get("source") or "")
        facts = []
        if source is not None and access.can_read(brain, person, source):
            for n in sorted(extract.children_of(brain, source.id), key=lambda n: n.id):
                if access.can_read(brain, person, n) and len(facts) < 10:
                    facts.append({"id": n.id, "subject": n.subject, "attribute": n.attribute,
                                  "value": n.value, "quote": n.body.strip()})
        return JSONResponse({"facts": facts})

    async def view(scope, receive, send, token: str, rest: str):
        ident = reg.tokens.verify(token)
        if ident is None or not reg.exists(ident[0]) or rest.startswith("/mcp") or rest.startswith("/internal"):
            await not_found()(scope, receive, send)
            return
        org, person = ident
        method = scope["method"]
        special = rest in ("/api/changes", "/api/upload", "/api/facts")
        if method not in ("GET", "HEAD") and not (rest == "/api/upload" and method == "POST"):
            await not_found()(scope, receive, send)
            return
        if rest in ("/api/framework", "/api/frameworks/count"):
            # public framework library, no company notes involved: token check above is the only gate
            from . import outside
            try:
                if rest == "/api/frameworks/count":
                    body = await run_in_threadpool(outside.framework_count)
                else:
                    name = dict(parse_qsl(scope.get("query_string", b"").decode("latin-1"))).get("name", "")
                    body = await run_in_threadpool(outside.framework_note, name)
                response = JSONResponse(body)
            except Exception:
                response = JSONResponse({"error": "frameworks unavailable"}, status_code=503)
            await response(scope, receive, send)
            return
        if rest in ("/api/framework", "/api/frameworks/count"):
            # public framework library, no company notes involved: the token check above is the only gate
            from . import outside
            try:
                if rest == "/api/frameworks/count":
                    body = await run_in_threadpool(outside.framework_count)
                else:
                    name = dict(parse_qsl(scope.get("query_string", b"").decode("latin-1"))).get("name", "")
                    body = await run_in_threadpool(outside.framework_note, name)
                response = JSONResponse(body)
            except Exception:
                response = JSONResponse({"error": "frameworks unavailable"}, status_code=503)
            await response(scope, receive, send)
            return
        server = await reg.server(org)
        brain = server.brain_cache.get()
        if person not in brain.policy.people or (rest == "/api/upload") != (method == "POST") and special:
            await not_found()(scope, receive, send)
            return
        if special:
            request = Request(scope, capped(receive, MAX_VIEW_UPLOAD + 65536)
                              if rest == "/api/upload" else receive)
            response = await (view_changes(request, brain, person) if rest == "/api/changes"
                              else view_facts(request, brain, person) if rest == "/api/facts"
                              else view_upload(request, org, brain, person))
            await response(scope, receive, send)
            return
        # Identity comes only from the token: drop any person/token the caller put in the query.
        query = urlencode([(k, v) for k, v in parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                                                         keep_blank_values=True) if k not in ("person", "token")])
        inner = {**scope, "path": rest or "/", "raw_path": (rest or "/").encode(),
                 "query_string": query.encode(), "root_path": ""}
        marker = fixed_person.set(person)
        try:
            await server.brain_app(inner, receive, send)
        finally:
            fixed_person.reset(marker)

    async def app(scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                else:
                    await reg.shutdown()
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] != "http":
            return
        path = scope.get("path", "")
        if path.startswith("/internal/"):
            limited = capped(receive, MAX_UPLOAD + 65536) if path.endswith("/import") else receive
            response = await internal(Request(scope, limited))
            await response(scope, receive, send)
            return
        if path.startswith("/v/"):
            token, _, tail = path[3:].partition("/")
            if not tail and path.count("/") == 2 and scope["method"] in ("GET", "HEAD"):
                # /v/<token> -> /v/<token>/ so relative page links resolve under the prefix
                if reg.tokens.verify(token) is not None:
                    await Response(status_code=308, headers={"location": f"/v/{token}/"})(scope, receive, send)
                    return
                await not_found()(scope, receive, send)
                return
            await view(scope, receive, send, token, "/" + tail)
            return
        parts = path.split("/")
        if len(parts) == 3 and parts[2] == "mcp" and "." in parts[1]:
            org = parts[1].split(".", 1)[0]
            if ORG_RE.fullmatch(org) and reg.exists(org):
                server = await reg.server(org)
                await server.brain_app(scope, receive, send)
                return
        await not_found()(scope, receive, send)

    app.registry = reg
    log_path = os.environ.get("BRAIN_REQ_LOG")
    if not log_path:
        return app

    async def logged(scope, receive, send):  # temporary debug log, tokens masked
        if scope["type"] != "http":
            await app(scope, receive, send)
            return
        h = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        path = re.sub(r"/[^/]*\.[A-Za-z0-9_-]{8,}(?=/)", "/<tok>", scope.get("path", ""))
        path = re.sub(r"^/v/[^/]+", "/v/<tok>", path)
        mcp = path.endswith("/mcp")
        st = {"req": b"", "res": b"", "h": []}

        async def rcv():
            msg = await receive()
            if mcp and msg.get("type") == "http.request":
                st["req"] += msg.get("body", b"")[:2000]
            return msg

        async def snd(msg):
            if msg["type"] == "http.response.start":
                st["s"] = msg["status"]
                st["h"] = [(k.decode("latin-1"), v.decode("latin-1")) for k, v in msg.get("headers", [])]
            elif mcp and msg["type"] == "http.response.body":
                st["res"] += msg.get("body", b"")[:2000]
            await send(msg)
        with open(log_path, "a") as f:
            f.write(f"{datetime.now().strftime('%H:%M:%S')} START {scope.get('method')} {path} "
                    f"ip={h.get('cf-connecting-ip') or h.get('x-forwarded-for')} sid={h.get('mcp-session-id')} "
                    f"accept={h.get('accept')}\n")
        try:
            await app(scope, rcv if mcp else receive, snd)
        finally:
            with open(log_path, "a") as f:
                f.write(f"{datetime.now().strftime('%H:%M:%S')} {scope.get('method')} {path} -> {st.get('s')} "
                        f"host={h.get('host')} ip={h.get('cf-connecting-ip')} xff={h.get('x-forwarded-for')} "
                        f"ua={h.get('user-agent','')[:60]!r} origin={h.get('origin')} accept={h.get('accept')} "
                        f"mcpv={h.get('mcp-protocol-version')} sid={h.get('mcp-session-id')} ct={h.get('content-type')}\n")
                if mcp:
                    f.write(f"   REQ {st['req'][:1500]!r}\n   RESH {st['h']}\n   RES {st['res'][:1500]!r}\n")

    logged.registry = reg
    return logged
