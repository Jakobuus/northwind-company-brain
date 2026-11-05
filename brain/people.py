"""Declared and viewer-specific expertise for policy people."""

from __future__ import annotations

from collections import Counter, defaultdict
from math import log
import re

import yaml

from . import access
from .schema import Brain, Note


_WORDS = re.compile(r"[^\W_]+(?:['&.-][^\W_]+)*", re.UNICODE)
_STOP = {"about", "after", "also", "and", "are", "been", "company", "from",
         "have", "into", "meeting", "notes", "that", "the", "their", "this",
         "with", "were", "will", "your"}


def _words(value: str) -> list[str]:
    return [word for word in _WORDS.findall(value.casefold())
            if len(word) >= 3 and word not in _STOP]


def _declared(brain: Brain, viewer: str, person_id: str) -> list[str]:
    # Policy.expertise is not represented in the shared Person schema. Read only
    # this public declaration from the already loaded brain's policy file.
    values = []
    try:
        with (brain.root / "policy.yaml").open(encoding="utf-8") as stream:
            policy = yaml.safe_load(stream) or {}
        person = (policy.get("people") or {}).get(person_id) or {}
        expertise = person.get("expertise")
        if isinstance(expertise, list):
            values.extend(expertise)
    except (OSError, yaml.YAMLError, AttributeError, TypeError):
        pass
    for note in brain.notes.values():
        if (note.type == "person" and access.can_read(brain, viewer, note)
                and note.extra.get("person") == person_id):
            expertise = note.extra.get("expertise")
            if isinstance(expertise, list):
                values.extend(expertise)
    return list(dict.fromkeys(value.strip() for value in values
                              if isinstance(value, str) and value.strip()))


def _participants(note: Note, people: set[str]) -> set[str]:
    participants = {note.author} if note.author in people else set()
    for key in ("authors", "coauthors"):
        values = note.extra.get(key, [])
        if isinstance(values, list):
            participants.update(value for value in values if isinstance(value, str) and value in people)
    if note.type == "meeting":
        participants.update(value for value in note.allow if value in people)
    return participants


def _activity_notes(brain: Brain, viewer: str, person_id: str) -> tuple[list[Note], dict[str, int]]:
    visible = access.readable(brain, viewer)
    people = set(brain.policy.people)
    relevant = [note for note in visible if person_id in _participants(note, people)]
    document_frequency = Counter(word for note in visible
                                 for word in set(_words(f"{note.title} {note.body}")))
    return relevant, document_frequency


def _activity(brain: Brain, viewer: str, person_id: str) -> list[dict]:
    relevant, df = _activity_notes(brain, viewer, person_id)
    if not relevant:
        return []
    visible_count = len(access.readable(brain, viewer))
    topics: dict[str, dict[str, float]] = defaultdict(dict)
    for note in relevant:
        candidates: dict[str, float] = {}
        if note.subject and note.subject.strip():
            candidates[note.subject.strip().casefold()] = 4.0
        area = brain.policy.areas.get(note.area)
        if area and not note.area.startswith("personal-"):
            candidates[area.name.casefold()] = 2.0
        counts = Counter(_words(f"{note.title} {note.body}"))
        weighted = sorted(((word, (1 + log(count)) *
                            (1 + log((visible_count + 1) / (df[word] + 1))))
                           for word, count in counts.items()),
                          key=lambda item: (-item[1], item[0]))
        for word, score in weighted[:8]:
            if score >= 1.3:
                candidates[word] = max(candidates.get(word, 0), score)
        for topic, weight in candidates.items():
            topics[topic][note.id] = max(topics[topic].get(note.id, 0), weight)
    return sorted(({"topic": topic, "weight": round(sum(evidence.values()), 3),
                    "evidence": sorted(evidence)} for topic, evidence in topics.items()),
                  key=lambda item: (-item["weight"], item["topic"]))


def profile(brain: Brain, viewer: str, person_id: str) -> dict:
    """Public identity plus activity and colleagues supported by viewer-readable notes."""
    if viewer not in brain.policy.people or person_id not in brain.policy.people:
        raise KeyError(person_id)
    person = brain.policy.people[person_id]
    people = set(brain.policy.people)
    shared: dict[str, set[str]] = defaultdict(set)
    for note in access.readable(brain, viewer):
        participants = _participants(note, people)
        if person_id in participants and note.access != "private":
            for other in participants - {person_id}:
                shared[other].add(note.id)
    return {"id": person.id, "name": person.name, "title": person.title,
            "home": person.home, "groups": list(person.groups),
            "declared": _declared(brain, viewer, person_id),
            "activity": _activity(brain, viewer, person_id),
            "collaborators": [
                {"id": other, "name": brain.policy.people[other].name,
                 "shared_notes": sorted(ids)} for other, ids in sorted(shared.items())]}


def _matches(query: str, topic: str) -> bool:
    q = _words(query)
    t = _words(topic)
    return bool(q) and all(word in t for word in q)


def who_knows(brain: Brain, viewer: str, topic: str, k: int = 5) -> list[dict]:
    """Rank public declarations and evidence that this viewer may read."""
    if viewer not in brain.policy.people or not _words(topic) or k <= 0:
        return []
    ranked = []
    for person_id in brain.policy.people:
        item = profile(brain, viewer, person_id)
        declared = [value for value in item["declared"] if _matches(topic, value)]
        evidence = [value for value in item["activity"] if _matches(topic, value["topic"])]
        if declared or evidence:
            ranked.append({"id": item["id"], "name": item["name"],
                           "declared": declared, "evidence": evidence,
                           "score": round(10 * len(declared) + sum(value["weight"] for value in evidence), 3)})
    return sorted(ranked, key=lambda item: (-item["score"], item["name"], item["id"]))[:k]
