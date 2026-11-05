"""Permission-filtered graph export."""

from __future__ import annotations

from . import access, layers, precedence
from .people import _participants
from .schema import Brain


# Structure nodes (area hubs, company, people) carry the layer keys too, with empty values.
_NO_LAYER = {"layer": None, "dept": None, "restricted": False, "moved": [], "can_move": []}
_COLORS = ("#64748b", "#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ef4444")


def export(brain: Brain, person_id: str, demo_ghosts: bool = False, people: bool = False) -> dict:
    visible = {note.id: note for note in access.readable(brain, person_id)}
    statuses = {note.id: "current" for note in visible.values()}
    resolutions = precedence.resolve_for(brain, person_id)
    for resolution in resolutions:
        for note in visible.values():
            if note.key == resolution.key:
                statuses[note.id] = "current"
        for note_id in resolution.superseded:
            statuses[note_id] = "superseded"
        for conflict in resolution.conflicts:
            statuses[conflict.challenger] = "contested"
    nodes = [{"id": note.id, "title": note.title, "type": note.type,
              "area": note.area, "access": note.access,
              "author": note.author if note.author in brain.policy.people else None,
              "claim": note.claim,
              "weight": note.weight if getattr(note, "_weight_present", True) else None,
              "status": statuses[note.id],
              "date": note.date.isoformat() if note.date else None, "locked": False,
              **layers.describe(brain, person_id, note)}
             for note in visible.values()]
    edges = []
    edge_set = set()

    def edge(source: str, target: str, kind: str) -> None:
        item = (source, target, kind)
        if item not in edge_set:
            edges.append({"source": source, "target": target, "kind": kind})
            edge_set.add(item)

    areas = []
    def home_for(person_id: str) -> str:
        person = brain.policy.people.get(person_id)
        if person is None:
            return "core"
        if person.home in brain.policy.areas and not person.home.startswith("personal-"):
            return person.home
        departments = [a for a in brain.policy.areas.values()
                       if a.id != "core" and not a.id.startswith("personal-")]
        # An area whose readers are exactly the person's groups (e.g. exec-only Leadership) beats a shared one.
        for candidate in departments:
            if set(candidate.readers) and set(candidate.readers) <= set(person.groups):
                return candidate.id
        for candidate in brain.policy.areas.values():
            if (candidate.id != "core" and not candidate.id.startswith("personal-")
                    and set(person.groups) & set(candidate.readers)):
                return candidate.id
        return "core"

    for index, area in enumerate(brain.policy.areas.values()):
        owner = brain.policy.people.get(area.owner)
        common = {"id": area.id, "name": area.name, "owner": area.owner,
                  "owner_name": owner.name if owner else None,
                  "color": area.color or _COLORS[index % len(_COLORS)]}
        if area.id.startswith("personal-"):
            areas.append({**common, "open": area.owner == person_id, "kind": "personal",
                          "person": area.owner, "home": home_for(area.owner)})
            continue
        is_open = (area.owner == person_id or "everyone" in area.readers or
                   bool(set(brain.policy.people.get(person_id).groups) & set(area.readers))
                   if person_id in brain.policy.people else False)
        areas.append({**common, "open": is_open,
                      "kind": "core" if area.id == "core" else "department"})
    # Policy identities and area hubs are public graph structure, even for closed areas.
    node_ids = {node["id"] for node in nodes}
    for area in brain.policy.areas.values():
        if area.id.startswith("personal-") and area.owner != person_id:
            continue
        if area.id not in node_ids:
            nodes.append({"id": area.id, "title": area.name, "type": "area", "area": area.id,
                          "access": "private" if area.id.startswith("personal-") else "area",
                          "author": None, "claim": None, "weight": None,
                          "status": "current", "date": None, "locked": False, **_NO_LAYER})
            node_ids.add(area.id)
    if brain.policy.company_id not in node_ids:
        nodes.append({"id": brain.policy.company_id, "title": brain.policy.company_name,
                      "type": "company", "area": "core", "access": "all",
                      "author": None, "claim": None, "weight": None, "status": "current",
                      "date": None, "locked": False, **_NO_LAYER})
        node_ids.add(brain.policy.company_id)
    for person in brain.policy.people.values():
        if person.id not in node_ids:
            nodes.append({"id": person.id, "title": person.name, "type": "person",
                          "area": home_for(person.id) if people else "core", "access": "all", "author": None,
                          "claim": None, "weight": None,
                          "status": "current", "date": None, "locked": False, **_NO_LAYER})
            node_ids.add(person.id)
        elif people:
            for node in nodes:
                if node["id"] == person.id and node["type"] == "person":
                    node["area"] = home_for(person.id)
    for area in brain.policy.areas.values():
        if area.id in node_ids:
            edge(area.id, brain.policy.company_id, "in_area")
    for note in visible.values():
        if note.id != note.area and note.area in node_ids:
            edge(note.id, note.area, "in_area")
        if note.author in node_ids:
            edge(note.id, note.author, "authored")
        if people and note.type == "meeting":
            for attendee in note.allow:
                if attendee in brain.policy.people and attendee in node_ids:
                    edge(note.id, attendee, "attended")
        if note.source in visible:
            edge(note.id, note.source, "from_source")
        for target in note.replaces:
            if target in visible:
                edge(note.id, target, "replaces")
        for target in note.links:
            if target in visible:
                edge(note.id, target, "link")
    for resolution in resolutions:
        for conflict in resolution.conflicts:
            if conflict.winner in visible and conflict.challenger in visible:
                edge(conflict.winner, conflict.challenger, "conflicts")
    if people:
        shared = set()
        for note in visible.values():
            if note.access == "private":
                continue
            participants = sorted(_participants(note, set(brain.policy.people)))
            for index, first in enumerate(participants):
                for second in participants[index + 1:]:
                    shared.add((first, second))
        for first, second in sorted(shared):
            if first in node_ids and second in node_ids:
                edge(first, second, "collaborates")
                edge(second, first, "collaborates")
    if demo_ghosts:
        for index, note in enumerate((n for n in brain.notes.values()
                                      if n.id not in visible and n.access != "private"
                                      and not n.area.startswith("personal-")), 1):
            ghost_id = f"locked-{index}"
            nodes.append({"id": ghost_id, "title": "Restricted", "type": "locked",
                          "area": note.area if note.area in brain.policy.areas else "core",
                          "access": note.access, "locked": True})
            if note.area in node_ids:
                edge(ghost_id, note.area, "in_area")
    return {"nodes": nodes, "edges": edges, "areas": areas}
