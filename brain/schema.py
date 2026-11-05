"""Shared types for every lane. Change only with the design doc (docs/design.md)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

NOTE_TYPES = ("company", "area", "person", "document", "meeting", "decision", "policy", "fact")
ACCESS_MODES = ("all", "area", "restricted", "private")
CLAIM_CLASSES = {
    "decision": "binding", "policy": "binding", "target": "binding",
    "observation": "factual", "measurement": "factual", "estimate": "factual",
    "remark": "informal",
}
CLASS_ORDER = {"binding": 3, "factual": 2, "informal": 1}
WEIGHTS = ("high", "normal", "low")
STATUSES = ("current", "superseded", "contested")


@dataclass
class Note:
    id: str
    type: str
    title: str
    area: str
    access: str = "area"
    allow: list[str] = field(default_factory=list)
    author: str | None = None
    date: date | None = None
    source: str | None = None
    subject: str | None = None
    attribute: str | None = None
    value: str | None = None
    claim: str | None = None
    weight: str = "normal"
    replaces: list[str] = field(default_factory=list)
    status: str = "current"
    body: str = ""
    links: list[str] = field(default_factory=list)   # [[wikilink]] targets found in body
    path: Path | None = None
    extra: dict = field(default_factory=dict)         # unknown frontmatter keys, preserved

    @property
    def key(self) -> tuple[str, str] | None:
        return (self.subject, self.attribute) if self.subject and self.attribute else None


@dataclass
class Person:
    id: str
    name: str
    title: str
    rank: int
    groups: list[str]
    home: str | None = None


@dataclass
class Area:
    id: str
    name: str
    owner: str
    readers: list[str]            # group names, or "everyone"
    topics: list[str] = field(default_factory=list)
    color: str | None = None
    leads: list[str] = field(default_factory=list)   # department leads (may promote notes upward)


@dataclass
class Policy:
    company_id: str
    company_name: str
    people: dict[str, Person]
    areas: dict[str, Area]
    tokens: dict[str, str]        # token -> person id


@dataclass
class Brain:
    """A loaded company: policy + all notes (unfiltered). Filter through access before showing anything."""
    root: Path
    policy: Policy
    notes: dict[str, Note]
    warnings: list[str] = field(default_factory=list)


@dataclass
class Hint:
    area: str
    area_name: str
    owner: str
    owner_name: str
    topic: str

    def text(self) -> str:
        return (f"For where decisions on {self.topic} currently stand, talk to {self.owner_name} "
                f"({self.area_name}): that area isn't open to your role.")


@dataclass
class Conflict:
    key: tuple[str, str]
    winner: str        # note id
    challenger: str    # note id
    severity: str      # = winner.weight
    route_to: str | None   # person id when severity == "high"
    reason: str


@dataclass
class Resolution:
    key: tuple[str, str]
    winner: str | None
    superseded: list[str]
    conflicts: list[Conflict]
    reason: str


@dataclass
class Hit:
    id: str
    title: str
    type: str
    area: str
    date: date | None
    author: str | None
    snippet: str
    score: float
    via: str = "match"      # "match" or "hop:<edge kind>"


# ---- interfaces (implemented by the lanes; signatures are the contract) ----
# store.py      load(root: Path) -> Brain ; parse_note(path: Path) -> Note ; dump_note(note: Note) -> str
# access.py     can_read(brain, person_id, note) -> bool ; readable(brain, person_id) -> list[Note]
#               hints_for(brain, person_id, query) -> list[Hint]
# precedence.py authority(brain, note) -> int ; resolve(brain, facts: list[Note]) -> Resolution
#               resolve_for(brain, person_id) -> list[Resolution]   (over readable facts only)
# search.py     search(brain, person_id, query, k=8, hops=1) -> tuple[list[Hit], list[Hint]]
# graph.py      export(brain, person_id, demo_ghosts=False) -> dict
# server.py     build_server(root: Path) -> FastMCP
