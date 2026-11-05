"""Build a cited, viewer-specific ask packet."""

from __future__ import annotations

from . import access, precedence
from .schema import CLAIM_CLASSES, Brain, Note
from .search import search


def ask(brain: Brain, person_id: str, question: str) -> dict:
    hits, hints = search(brain, person_id, question)
    visible = {note.id: note for note in access.readable(brain, person_id)}
    keys = {visible[hit.id].key for hit in hits
            if hit.id in visible and visible[hit.id].type in ("fact", "decision")
            and visible[hit.id].key}
    resolutions = []
    paragraphs = []
    for resolution in precedence.resolve_for(brain, person_id):
        if resolution.key not in keys or resolution.winner not in visible:
            continue
        winner = visible[resolution.winner]

        def short(note: Note, include_author: bool = False) -> dict:
            item = {"id": note.id, "title": note.title, "value": note.value,
                    "date": note.date.isoformat() if note.date else None}
            if include_author:
                person = brain.policy.people.get(note.author or "")
                item["author_name"] = person.name if person else (note.author or "Unknown")
            return item

        conflicts = [{"winner": conflict.winner, "challenger": conflict.challenger,
                      "severity": conflict.severity, "route_to": conflict.route_to,
                      "route_to_name": (brain.policy.people[conflict.route_to].name
                                        if conflict.route_to in brain.policy.people else None),
                      "reason": conflict.reason}
                     for conflict in resolution.conflicts
                     if conflict.winner in visible and conflict.challenger in visible]
        resolutions.append({"key": list(resolution.key), "winner": short(winner, True),
                            "superseded": [short(visible[note_id]) for note_id in resolution.superseded
                                           if note_id in visible],
                            "conflicts": conflicts, "reason": resolution.reason})
        informal = CLAIM_CLASSES.get(winner.claim or "") == "informal"
        paragraphs.append(f"{'Only an informal remark so far: ' if informal else ''}"
                          f"{winner.value} — {resolutions[-1]['winner']['author_name']}, "
                          f"{winner.date.isoformat() if winner.date else 'undated'}. "
                          f"{resolution.reason}")
        for conflict in conflicts:
            challenger = visible[conflict["challenger"]]
            paragraphs.append(f"Conflict: {challenger.value} ({challenger.title}, "
                              f"{challenger.date.isoformat() if challenger.date else 'undated'}). "
                              f"{conflict['reason']}")
    hint_text = [hint.text() for hint in hints]
    brief = _brief(brain, visible, resolutions, hits)
    return {"question": question, "person": person_id,
            "hits": [{**hit.__dict__, "date": hit.date.isoformat() if hit.date else None}
                     for hit in hits],
            "resolutions": resolutions, "hints": hint_text,
            "summary": " ".join(paragraphs) if paragraphs else "No readable answer found.",
            "brief": brief}


def clip(text: str, words: int = 15) -> str:
    parts = str(text).split()
    return " ".join(parts[:words]) + ("..." if len(parts) > words else "")


def _who(brain: Brain, note: Note) -> str:
    person = brain.policy.people.get(note.author or "")
    return person.name if person else "Someone"


def _brief(brain: Brain, visible: dict, resolutions: list[dict], hits: list) -> dict:
    """Deterministic answer brief built only from notes the viewer can read (names, never raw ids)."""
    sources: list[dict] = []

    def add(note_id: str) -> None:
        note = visible.get(note_id)
        if note and all(s["id"] != note_id for s in sources):
            sources.append({"id": note.id, "title": note.title})

    headline, points, conflict = "No readable answer found.", [], None
    if resolutions:
        top = resolutions[0]
        win = visible[top["winner"]["id"]]
        headline = f"{win.value} ({win.title}, {win.date.isoformat() if win.date else 'undated'})."
        points.append(clip(top["reason"]))
        for sup in top["superseded"][:1]:
            points.append(clip(f"Superseded: {sup['value']} ({sup['title']})"))
        for res in resolutions:
            add(res["winner"]["id"])
            for sup in res["superseded"]:
                add(sup["id"])
            for c in res["conflicts"]:
                lose, won = visible[c["challenger"]], visible[c["winner"]]
                add(lose.id)
                add(won.id)
                if conflict is None:
                    verb = "decided" if won.type == "decision" else "says"
                    conflict = f"{_who(brain, lose)} says {lose.value} · {_who(brain, won)} {verb} {won.value}"
                    points.append(clip(c["reason"]))
    else:
        for hit in hits[:3]:
            add(hit.id)
            snippet = (hit.snippet or "").strip()
            if snippet:
                points.append(clip(snippet))
        if points:
            headline = clip(points.pop(0), 25)
    return {"headline": headline, "points": points[:3], "conflict": conflict, "sources": sources}
