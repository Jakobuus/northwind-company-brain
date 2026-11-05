"""Resolve claims by class, authority, date, and valid replacement."""

from __future__ import annotations

import re
from datetime import date

from .access import can_read, readable
from .schema import Brain, CLAIM_CLASSES, CLASS_ORDER, Conflict, Note, Resolution


def authority(brain: Brain, note: Note) -> int:
    area = brain.policy.areas.get(note.area)
    if area is not None and area.owner == note.author:
        return 100
    person = brain.policy.people.get(note.author or "")
    return person.rank if person is not None else 0


def _eligible(note: Note) -> bool:
    return note.type in ("fact", "decision", "policy") and note.key is not None


def _order(brain: Brain, note: Note) -> tuple:
    claim_class = CLAIM_CLASSES.get(note.claim or "", "informal")
    rank = authority(brain, note)
    when = note.date or date.min
    if claim_class == "binding":
        within = (rank, when)
    elif claim_class == "factual":
        within = (when, rank)
    else:
        within = (when,)
    return (CLASS_ORDER[claim_class], within, note.id)


_MONTHS = {m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october november december".split())}
_MONTHS.update({m[:3]: i for m, i in list(_MONTHS.items())})
_MONTHS["sept"] = 9


def _norm(text: str) -> str:
    """Canonical form so '15 March 2027' == '2027-03-15' and 'EUR 2,690' == '2690 eur'."""
    t = re.sub(r"(?<=\d)(st|nd|rd|th)\b", "", text.strip().casefold())
    t = t.replace(",", " ") if re.search(r"[a-z]{3}", t) else t
    t = re.sub(r"\s+", " ", t).strip(" .")
    day = month = year = None
    if m := re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t):
        year, month, day = m.groups()
    elif m := re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", t):
        day, month, year = m.groups()
    elif m := re.fullmatch(r"(?:the )?(\d{1,2}) (?:of )?([a-z]+) (\d{4})", t):
        day, month, year = m.group(1), _MONTHS.get(m.group(2)), m.group(3)
    elif m := re.fullmatch(r"([a-z]+) (\d{1,2}) (\d{4})", t):
        month, day, year = _MONTHS.get(m.group(1)), m.group(2), m.group(3)
    if day and month and year:
        try:
            return date(int(year), int(month), int(day)).isoformat()
        except ValueError:
            pass
    nums = re.findall(r"\d[\d,. ]*\d|\d", t)
    rest = re.sub(r"\d[\d,. ]*\d|\d", " ", t)
    words = sorted(re.findall(r"[a-z\u20ac$\u00a3%]+", rest))
    if len(nums) == 1 and len(words) <= 2 and re.fullmatch(r"[\d,. ]+", nums[0]):
        n = nums[0].replace(" ", "")
        n = n.replace(",", "") if re.search(r",\d{3}\b", n) or "." in n else n.replace(",", ".")
        try:
            n = format(float(n), "g")
        except ValueError:
            pass
        cur = {"\u20ac": "eur", "$": "usd", "\u00a3": "gbp"}
        return " ".join([n] + [cur.get(w, w) for w in words])
    return re.sub(r"[^\w%]+", " ", t).strip()


def _value(note: Note) -> str:
    return _norm(str(note.value if note.value is not None else ""))


def _name(brain: Brain, note: Note) -> str:
    person = brain.policy.people.get(note.author or "")
    return person.name if person else (note.author or "Unknown author")


def _reason(brain: Brain, winner: Note, others: list[Note], replaced: set[str]) -> str:
    name = _name(brain, winner)
    area = brain.policy.areas.get(winner.area)
    claim_class = CLAIM_CLASSES.get(winner.claim or "", "informal")
    if not others:
        return f"{name}'s {winner.claim or 'claim'} ({winner.date or 'undated'}) is the only claim."
    rival = max(others, key=lambda note: _order(brain, note))
    rival_name = _name(brain, rival)
    explicit_replacement = rival.id in replaced and rival.id in winner.replaces
    if not explicit_replacement and CLASS_ORDER[claim_class] > CLASS_ORDER[CLAIM_CLASSES.get(rival.claim or "", "informal")]:
        return (f"{name}'s {winner.claim or 'claim'} ({winner.date or 'undated'}) outranks "
                f"{rival_name}'s {rival.claim or 'claim'} ({rival.date or 'undated'}).")
    owner = f"{name} owns {area.name}, and " if area is not None and area.owner == winner.author else ""
    subject = f"{name}'s {'figure' if winner.value is not None else winner.claim or 'claim'}"
    rival_subject = f"{rival_name}'s {'figure' if rival.value is not None else rival.claim or 'claim'}"
    if explicit_replacement:
        rule = "replaces"
    elif (winner.date or date.min) == (rival.date or date.min):
        rule = "ties with" if authority(brain, winner) == authority(brain, rival) else "has higher authority than"
    elif (winner.date or date.min) > (rival.date or date.min):
        rule = "is newer than"
    else:
        rule = "has higher authority than"
    suffix = " (same date)" if rule == "ties with" else ""
    return (f"{owner}{subject} ({winner.date or 'undated'}) {rule} "
            f"{rival_subject} ({rival.date or 'undated'}){suffix}.")


def resolve(brain: Brain, facts: list[Note]) -> Resolution:
    facts = [note for note in facts if _eligible(note)]
    if not facts:
        return Resolution(key=("", ""), winner=None, superseded=[], conflicts=[],
                          reason="No eligible claims were found.")
    key = facts[0].key
    facts = [note for note in facts if note.key == key]
    by_id = {note.id: note for note in facts}
    replaced: set[str] = set()
    invalid_replacements: set[str] = set()
    for note in facts:
        for old_id in note.replaces:
            old = by_id.get(old_id)
            if old is None or old.id == note.id:
                continue
            if (CLASS_ORDER[CLAIM_CLASSES.get(note.claim or "", "informal")] >=
                    CLASS_ORDER[CLAIM_CLASSES.get(old.claim or "", "informal")]
                    and authority(brain, note) >= authority(brain, old)):
                replaced.add(old_id)
            else:
                invalid_replacements.add(note.id)
    active = [note for note in facts if note.id not in replaced]
    winner = max(active or facts, key=lambda note: _order(brain, note))
    superseded: list[str] = []
    conflicts: list[Conflict] = []
    for note in facts:
        if note.id == winner.id:
            continue
        if note.id in replaced:
            superseded.append(note.id)
            continue
        different = _value(note) != _value(winner)
        conflict = note.id in invalid_replacements or (
            different and (note.date or date.min) > (winner.date or date.min))
        if conflict:
            area = brain.policy.areas.get(winner.area)
            route = area.owner if area and area.owner in brain.policy.people else None
            if winner.weight == "high" and route is None and not (
                    winner.access == "private" or note.access == "private"):
                candidates = (person for person in brain.policy.people.values()
                              if can_read(brain, person.id, winner) and can_read(brain, person.id, note))
                candidates = list(candidates)
                if candidates:
                    route = max(candidates, key=lambda person: (person.rank, person.id)).id
                elif winner.author in brain.policy.people:
                    route = winner.author
                elif brain.policy.people:
                    route = max(brain.policy.people.values(),
                                key=lambda person: (person.rank, person.id)).id
            conflicts.append(Conflict(
                key=key, winner=winner.id, challenger=note.id, severity=winner.weight,
                route_to=(route if winner.weight == "high" and
                          winner.access != "private" and note.access != "private" else None),
                reason=(f"{_name(brain, note)}'s {note.claim or 'claim'} cannot replace "
                        f"{_name(brain, winner)}'s higher-class or higher-authority {winner.claim or 'claim'}."
                        if note.id in invalid_replacements else
                        f"{_name(brain, note)}'s newer {note.claim or 'claim'} "
                        f"({note.date or 'undated'}) disagrees with {_name(brain, winner)}'s "
                        f"{winner.claim or 'claim'} ({winner.date or 'undated'}).")))
        elif different:
            superseded.append(note.id)
    if winner.id in invalid_replacements:
        old = next((by_id[old_id] for old_id in winner.replaces if old_id in by_id), None)
        if old is not None:
            conflicts.append(Conflict(
                key=key, winner=old.id, challenger=winner.id, severity=old.weight,
                route_to=None,
                reason=f"{_name(brain, winner)}'s {winner.claim or 'claim'} cannot replace "
                       f"{_name(brain, old)}'s higher-authority {old.claim or 'claim'}."))
    return Resolution(key=key, winner=winner.id, superseded=superseded,
                      conflicts=conflicts, reason=_reason(brain, winner, [n for n in facts if n.id != winner.id], replaced))


def resolve_for(brain: Brain, person_id: str) -> list[Resolution]:
    groups: dict[tuple[str, str], list[Note]] = {}
    for note in readable(brain, person_id):
        if _eligible(note):
            groups.setdefault(note.key, []).append(note)
    return [resolve(brain, facts) for facts in groups.values()]


def apply_status(brain: Brain) -> dict[str, str]:
    """Offline global status only. Never show this result to a viewer; use resolve_for."""
    groups: dict[tuple[str, str], list[Note]] = {}
    for note in brain.notes.values():
        if _eligible(note):
            groups.setdefault(note.key, []).append(note)
    statuses = {note.id: note.status for note in brain.notes.values() if _eligible(note)}
    for facts in groups.values():
        resolution = resolve(brain, facts)
        for note in facts:
            statuses[note.id] = "current"
        for note_id in resolution.superseded:
            statuses[note_id] = "superseded"
        for conflict in resolution.conflicts:
            statuses[conflict.challenger] = "contested"
    return statuses
