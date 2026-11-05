"""Access model v2: the four layers (core, dept-core, dept, private) and who may move a note between them.

Layers are derived from existing note fields (area + access); nothing new is stored except `moved` and
`origin_dept` in the note's extra frontmatter. Reading is still decided only by ``access.can_read``."""

from __future__ import annotations

from .schema import Brain, Note

LAYERS = ("core", "dept-core", "dept", "private")
ADMIN_RANK = 70  # OWNER 100 / ADMIN 70 / MEMBER 30 (design.md "Platform")


def is_dept(brain: Brain, area_id: str | None) -> bool:
    return bool(area_id) and area_id != "core" and not area_id.startswith("personal-") and area_id in brain.policy.areas


def home_dept(brain: Brain, person_id: str | None) -> str | None:
    person = brain.policy.people.get(person_id or "")
    return person.home if person is not None and is_dept(brain, person.home) else None


def layer_of(brain: Brain, note: Note) -> str:
    if note.access == "private" or note.area.startswith("personal-"):
        return "private"
    if note.area == "core":
        return "core"
    return "dept-core" if note.access == "all" else "dept"


def is_restricted(note: Note) -> bool:
    """Named-people-only notes (and area notes with an allow list). Leads cannot widen them."""
    return note.access != "private" and note.access != "all" and (note.access == "restricted" or bool(note.allow))


def dept_of(brain: Brain, note: Note) -> str | None:
    layer = layer_of(brain, note)
    if layer == "private":
        return home_dept(brain, note.author)
    if layer == "core":
        origin = note.extra.get("origin_dept")
        return origin if isinstance(origin, str) and is_dept(brain, origin) else None
    return note.area if is_dept(brain, note.area) else None


def is_lead(brain: Brain, person_id: str, dept: str | None) -> bool:
    area = brain.policy.areas.get(dept or "")
    return area is not None and person_id in area.leads and person_id in brain.policy.people


def is_admin(brain: Brain, person_id: str) -> bool:
    person = brain.policy.people.get(person_id)
    return person is not None and person.rank >= ADMIN_RANK


def moved_of(note: Note) -> list[dict]:
    moved = note.extra.get("moved")
    return [m for m in moved if isinstance(m, dict)] if isinstance(moved, list) else []


def plan_move(brain: Brain, by: str, note: Note, to: str) -> tuple[str, str, str | None] | None:
    """Return (new_area, new_access, origin_dept) when `by` may move `note` to layer `to`, else None.

    Rules: the author commits private -> own department; only a lead of the department moves
    dept -> dept-core and dept|dept-core -> core. Owners/admins get no override. Never downwards."""
    layer, dept = layer_of(brain, note), dept_of(brain, note)
    if by not in brain.policy.people:
        return None
    if layer == "private" and to == "dept":
        home = home_dept(brain, by)
        if note.author == by and home is not None:
            return home, "area", None
    elif (layer == "dept" and note.access == "area" and not note.allow
          and to == "dept-core" and is_lead(brain, by, dept)):
        return note.area, "all", None
    elif (layer in ("dept", "dept-core") and note.access in ("area", "all") and not is_restricted(note)
          and to == "core" and is_lead(brain, by, dept)):
        return "core", "all", dept
    return None


def can_move_targets(brain: Brain, person_id: str, note: Note) -> list[str]:
    return [to for to in ("dept", "dept-core", "core") if plan_move(brain, person_id, note, to) is not None]


def upload_target(brain: Brain, person_id: str, layer: str) -> tuple[str, str] | None:
    """(area, access) for a direct upload by `person_id` into `layer`, or None when not allowed."""
    home = home_dept(brain, person_id)
    if layer == "private":
        return f"personal-{person_id}", "private"
    if layer == "dept" and home is not None:
        return home, "area"
    if layer == "dept-core" and home is not None and is_lead(brain, person_id, home):
        return home, "all"
    if layer == "core" and is_admin(brain, person_id):
        return "core", "all"
    return None


def describe(brain: Brain, person_id: str, note: Note) -> dict:
    """The per-note fields the graph export and notes list add for one viewer."""
    return {"layer": layer_of(brain, note), "dept": dept_of(brain, note),
            "restricted": is_restricted(note), "moved": moved_of(note), "can_move": can_move_targets(brain, person_id, note)}
