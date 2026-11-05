"""Permission-filtered note search."""

from __future__ import annotations

import os
import re

from rank_bm25 import BM25Okapi

from . import access, embed
from .schema import Brain, Hit, Note


_STOP = frozenset("a an the is are was were be what whats which who whom how when where why do does did "
                  "in on of for to our we us my me you your it its this that and or with about any".split())
_WORDS = re.compile(r"\w+", re.UNICODE)


def _terms(value: str) -> list[str]:
    return _WORDS.findall(value.casefold())


def _content(brain: Brain, note: Note) -> str:
    area = brain.policy.areas.get(note.area)
    author = brain.policy.people.get(note.author or "")
    return " ".join(str(value) for value in (
        note.title, note.body, note.subject, note.attribute, note.value,
        area.name if area else None, author.name if author else None,
    ) if value)


def _snippet(note: Note, query: str) -> str:
    source = " ".join(note.body.split()) or note.title
    match = next((m for term in _terms(query)
                  if (m := re.search(r"\b" + re.escape(term) + r"\w*", source, re.I))), None)
    if match is None:
        return source[:200]
    start = max(0, match.start() - 90)
    end = min(len(source), start + 200)
    start = max(0, end - 200)
    return ("…" if start else "") + source[start:end] + ("…" if end < len(source) else "")


def _embed_scores(brain: Brain, notes: list[Note], contents: list[str], query: str) -> list[float] | None:
    """Compatibility hook for callers that inject an embedding scorer."""
    return None


def _neighbours(note: Note, visible: dict[str, Note]):
    for kind, ids in (("from_source", [note.source] if note.source else []),
                      ("replaces", note.replaces), ("link", note.links)):
        for target in ids:
            if target in visible and target != note.id:
                yield kind, visible[target]
    for other in visible.values():
        if other.id == note.id:
            continue
        if other.source == note.id:
            yield "from_source", other
        if note.id in other.replaces:
            yield "replaces", other
        if note.id in other.links:
            yield "link", other
        if note.key and other.key == note.key:
            yield "same_key", other


def search(brain: Brain, person_id: str, query: str, k: int = 8,
           hops: int = 1) -> tuple[list[Hit], list]:
    hints = access.hints_for(brain, person_id, query)
    notes = access.readable(brain, person_id)
    if not notes or not _terms(query) or k <= 0:
        return [], hints
    # Filler words ("how", "our", "the") must not count as keyword matches: they would drown the meaning score.
    qterms = [t for t in _terms(query) if t not in _STOP] or _terms(query)
    contents = [_content(brain, note) for note in notes]
    corpus = [_terms(content) or [""] for content in contents]
    bm25 = BM25Okapi(corpus)
    raw = list(map(float, bm25.get_scores(qterms)))
    ranked = sorted(range(len(notes)), key=lambda i: (-raw[i], notes[i].id))
    semantic_rows = (embed.ranked(brain, person_id, query, min(len(notes), max(k * 3, 20)))
                     if os.getenv("BRAIN_EMBED") != "0" and embed.built(brain)
                     and embed.available() else [])
    snippets = dict(semantic_rows)
    embedding = _embed_scores(brain, notes, contents, query)
    if embedding is None and semantic_rows:
        positions = {note_id: rank for rank, (note_id, _) in enumerate(semantic_rows)}
        embedding = [float(len(notes) - positions[note.id]) if note.id in positions else 0.0
                     for note in notes]
    if embedding is None:
        scores = raw
    else:
        embed_rank = sorted(range(len(notes)), key=lambda i: (-embedding[i], notes[i].id))
        bm_pos = {index: rank for rank, index in enumerate(i for i in ranked if raw[i] > 0)}
        em_pos = {index: rank for rank, index in enumerate(i for i in embed_rank if embedding[i] > 0)}
        scores = [(1 / (60 + bm_pos[i] + 1) if i in bm_pos else 0)
                  + (1 / (60 + em_pos[i] + 1) if i in em_pos else 0)
                  for i in range(len(notes))]
        ranked = sorted(range(len(notes)), key=lambda i: (-scores[i], notes[i].id))
    query_terms = set(qterms)
    # Title match boost: a note whose title holds every content word of the question (and little
    # else) is the thing asked about; long documents dilute BM25 and lose to chatty notes.
    content = query_terms - _STOP
    if content and max(scores) > 0:
        top = max(scores)
        boosted = list(scores)
        for i, note in enumerate(notes):
            title_terms = set(_terms(note.title))
            if title_terms and content <= title_terms:
                boosted[i] = scores[i] + 0.6 * top * (len(content) / len(title_terms))
        scores = boosted
        ranked = sorted(range(len(notes)), key=lambda i: (-scores[i], notes[i].id))
    if embedding is None:
        direct = [i for i in ranked if query_terms.intersection(corpus[i])][:k]
    else:
        lexical = [i for i in ranked if query_terms.intersection(corpus[i])]
        semantic = [i for i in embed_rank if embedding[i] > 0]
        candidates = set(lexical) | set(semantic)
        direct = [i for i in ranked if i in candidates][:k]

    def hit(note: Note, score: float, via: str = "match") -> Hit:
        return Hit(note.id, note.title, note.type, note.area, note.date, note.author,
                   snippets.get(note.id, _snippet(note, query)) if via == "match" else _snippet(note, query),
                   score, via)

    result = [hit(notes[i], scores[i]) for i in direct]
    seen = {item.id for item in result}
    visible = {note.id: note for note in notes}
    if hops > 0:
        for index in direct[:3]:
            for kind, neighbour in _neighbours(notes[index], visible):
                if neighbour.id not in seen:
                    result.append(hit(neighbour, scores[index] * 0.5, f"hop:{kind}"))
                    seen.add(neighbour.id)
    return result, hints
