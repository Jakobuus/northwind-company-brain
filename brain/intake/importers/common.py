"""Small shared helpers for source metadata."""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
import re

from brain.intake.envelope import Envelope, slugify

_DATES = (
    re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)"),
    re.compile(r"(?<!\d)(\d{1,2}/\d{1,2}/\d{4})(?!\d)"),
    re.compile(r"\b([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b"),
)


def date_value(value: object) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value is None:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y"):
        try:
            return datetime.strptime(str(value).strip(), fmt).date().isoformat()
        except ValueError:
            pass
    return None


def detect_date(path: Path, body: str, metadata: object = None) -> str | None:
    explicit = date_value(metadata)
    if explicit and explicit >= "2015-01-01":
        return explicit
    for text in (path.stem, "\n".join(body.splitlines()[:20])):
        for pattern in _DATES:
            for match in pattern.finditer(text):
                found = date_value(match.group(1))
                if found:
                    return found
    return explicit


def person_id(value: object, defaults: dict) -> str | None:
    if not isinstance(value, str):
        return None
    people = defaults.get("people") or {}
    matches = [pid for pid, name in people.items()
               if value.casefold() in (pid.casefold(), str(name).casefold(), str(name).split()[0].casefold())]
    return matches[0] if len(matches) == 1 else None


def envelope(path: Path, defaults: dict, body: str, *, title: str | None = None,
             suffix: str = "", metadata: dict | None = None, kind: str | None = None) -> Envelope:
    meta = metadata or {}
    name = title or path.stem
    raw_allow = defaults.get("allow") if defaults.get("allow") is not None else meta.get("allow", [])
    if isinstance(raw_allow, str):
        raw_allow = [raw_allow]
    return Envelope(
        id=str(meta.get("id") or slugify(f"{path.stem}{suffix}")),
        source_type=path.suffix.lower().lstrip("."), source_uri=str(path.resolve()),
        title=str(meta.get("title") or name),
        author=defaults.get("author") or person_id(meta.get("author"), defaults),
        date=date_value(defaults.get("date")) or detect_date(path, body, meta.get("date")),
        area=str(defaults.get("area") or meta.get("area") or "core"),
        access=str(defaults.get("access") or meta.get("access") or "area"),
        allow=list(raw_allow or []), body=body,
        type=str(kind or meta.get("type") or "document"), frontmatter=dict(meta),
    )
