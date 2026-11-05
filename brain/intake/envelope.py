"""Intermediate representation shared by intake importers."""
from __future__ import annotations

from dataclasses import dataclass, field
import re
import unicodedata


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")[:80].rstrip("-")
    return slug or "untitled"


@dataclass
class Envelope:
    id: str
    source_type: str
    source_uri: str
    title: str
    author: str | None
    date: str | None
    area: str
    access: str
    allow: list[str]
    body: str
    type: str = "document"
    frontmatter: dict = field(default_factory=dict)
