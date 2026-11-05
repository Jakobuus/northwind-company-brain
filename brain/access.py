"""The single read gate for company notes and area hints."""

from __future__ import annotations

import re

from .schema import Brain, Hint, Note


def _area_readable(brain: Brain, person_id: str, area_id: str) -> bool:
    person = brain.policy.people.get(person_id)
    area = brain.policy.areas.get(area_id)
    if person is None or area is None:
        return False
    return (area.owner == person_id or "everyone" in area.readers
            or bool(set(person.groups) & set(area.readers)))


def can_read(brain: Brain, person_id: str, note: Note) -> bool:
    if person_id not in brain.policy.people:
        return False
    if note.access == "private":
        return person_id == note.author
    if person_id in note.allow:
        return True
    if note.access == "all":
        return True
    if note.access == "restricted":
        return person_id == note.author
    if note.access == "area":
        return _area_readable(brain, person_id, note.area)
    return False


def readable(brain: Brain, person_id: str) -> list[Note]:
    return [note for note in brain.notes.values() if can_read(brain, person_id, note)]


def _topic_matches(topic: str, query: str) -> bool:
    words = re.findall(r"[^\W_]+(?:['&.-][^\W_]+)*", topic.casefold())
    if not words:
        return False
    query_words = re.findall(r"[^\W_]+(?:['&.-][^\W_]+)*", query.casefold())
    return all(any(candidate == word if len(word) < 3 or not word.isalnum()
                   else candidate.startswith(word) for candidate in query_words) for word in words)


def hints_for(brain: Brain, person_id: str, query: str) -> list[Hint]:
    if person_id not in brain.policy.people:
        return []
    hints = []
    for area in brain.policy.areas.values():
        if area.id.startswith("personal-"):
            continue
        if _area_readable(brain, person_id, area.id):
            continue
        matching = [topic for topic in area.topics if _topic_matches(topic, query)]
        query_tokens = re.findall(r"[^\W_]+(?:['&.-][^\W_]+)*", query.casefold())
        topic = min(matching, key=lambda value: (min(
            index for index, token in enumerate(query_tokens)
            if any(token.startswith(word) for word in re.findall(r"[^\W_]+(?:['&.-][^\W_]+)*", value.casefold()))),
            -len(value))) if matching else None
        if topic is not None:
            owner = brain.policy.people.get(area.owner)
            hints.append(Hint(area=area.id, area_name=area.name, owner=area.owner,
                              owner_name=owner.name if owner else area.owner, topic=topic))
    return hints
