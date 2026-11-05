"""Validate intake notes against the fixed schema and a policy file."""
from __future__ import annotations

from pathlib import Path
import re
import unicodedata
import yaml

from brain.schema import NOTE_TYPES, ACCESS_MODES, CLAIM_CLASSES, WEIGHTS


def _read_note(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("unclosed frontmatter") from exc
    data = yaml.safe_load("\n".join(lines[1:end]))
    if not isinstance(data, dict):
        raise ValueError("frontmatter is not a mapping")
    return data, "\n".join(lines[end + 1:])


def _read_frontmatter(path: Path) -> dict:
    return _read_note(path)[0]


# ---- grounding: the quote (the body of an extracted note) must occur in its source note ----
_FOLD = str.maketrans({
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"', "\u00ab": '"', "\u00bb": '"',
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2015": "-",
    "\u2212": "-", "\u00a0": " ", "\u202f": " ", "\u200b": "",
})
_WIKILINK = re.compile(r"\[\[[^\]]*\]\]")


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_FOLD)
    return re.sub(r"\s+", " ", _WIKILINK.sub("", text)).strip().casefold()


def _quote_lines(body: str) -> list[str]:
    """Each non-empty body line is one quote (list and blockquote markers and wrapping quotes dropped)."""
    out = []
    for raw in body.splitlines():
        line = _norm(re.sub(r"^\s*(?:>|[-*+])\s+", "", raw)).strip("\"' ")
        if line:
            out.append(line)
    return out


def _ungrounded(quote_body: str, source_body: str) -> bool:
    lines = _quote_lines(quote_body)
    source = _norm(source_body)
    return not lines or any(line not in source for line in lines)


# ---- planted instructions in imported text: warn only, never echo the text ----
_INJECTION_PATTERNS = [
    ("ignore-instructions", r"\bignore\s+(?:all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+|earlier\s+)+.{0,30}?\binstructions"),
    ("disregard", r"\bdisregard\b.{0,30}\b(?:instructions|prompt|above|previous|prior)"),
    ("system-line", r"^\s*system\s*(?:prompt)?\s*:"),
    ("you-are-now", r"\byou\s+are\s+now\b"),
    ("new-instructions", r"\bnew\s+instructions\b"),
    ("fake-role-tag", r"</?\s*(?:system|assistant|instructions|user)\s*>"),
    ("act-as-admin", r"\bact\s+as\b.{0,30}\b(?:admin|root|system)\b"),
    ("forget-previous", r"\bforget\s+(?:everything|all|what|your|previous|prior)\b"),
    ("override-rules", r"\boverride\b.{0,30}\b(?:instructions|guidelines|rules|prompt)"),
    ("reveal-prompt", r"\b(?:reveal|print|show|repeat)\b.{0,20}\b(?:system\s+prompt|instructions)\b"),
]
INJECTION_RES = [(name, re.compile(rx, re.I | re.M | re.S)) for name, rx in _INJECTION_PATTERNS]


def injection_hits(body: str) -> list[str]:
    """Names (never text) of the injection patterns the body matches."""
    return [name for name, rx in INJECTION_RES if rx.search(unicodedata.normalize("NFKC", body))]


def validate(data_root: Path, policy_path: Path, warnings: list[str] | None = None) -> list[str]:
    """Return problems. Injection warnings go to `warnings` when given, else are printed (they never fail)."""
    root = Path(data_root)
    policy_file = Path(policy_path)
    if not policy_file.is_file():
        return [f"Missing policy: {policy_file}"]
    try:
        policy = yaml.safe_load(policy_file.read_text(encoding="utf-8")) or {}
        people = set((policy.get("people") or {}).keys())
        areas = set((policy.get("areas") or {}).keys()) | {f"personal-{person}" for person in people}
    except (OSError, yaml.YAMLError, AttributeError) as exc:
        return [f"Invalid policy: {exc}"]
    problems = []
    notes = []
    seen = {}
    bodies = {}  # label -> body
    caution = []
    for path in sorted(root.rglob("*.md")):
        if any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        try:
            note, body = _read_note(path)
        except (OSError, ValueError, yaml.YAMLError) as exc:
            problems.append(f"{path}: {exc}")
            continue
        label = str(path)
        parts = path.relative_to(root).parts
        personal_person = parts[1] if len(parts) == 3 and parts[0] == "personal" else None
        if personal_person:
            note.setdefault("area", f"personal-{personal_person}")
            note.setdefault("access", "private")
            if note.get("access") != "private":
                problems.append(f"{label}: personal area note must be private")
        if note.get("access") == "private":
            if not personal_person or note.get("area") != f"personal-{personal_person}":
                problems.append(f"{label}: private note outside a personal area")
            elif note.get("author") != personal_person:
                problems.append(f"{label}: private author must match personal area owner")
        note_id = note.get("id")
        if not note_id:
            problems.append(f"{label}: missing id")
        elif note_id in seen:
            problems.append(f"{label}: duplicate id {note_id} (also {seen[note_id]})")
        else:
            seen[note_id] = label
        bodies[label] = body
        for name in injection_hits(body):
            caution.append(f"Warning: possible planted instructions in note {note_id or label} (pattern: {name})")
        if note.get("type") not in NOTE_TYPES:
            problems.append(f"{label}: unknown type {note.get('type')}")
        if note.get("access") not in ACCESS_MODES:
            problems.append(f"{label}: unknown access {note.get('access')}")
        if note.get("claim") is not None and note["claim"] not in CLAIM_CLASSES:
            problems.append(f"{label}: unknown claim {note['claim']}")
        if note.get("weight", "normal") not in WEIGHTS:
            problems.append(f"{label}: unknown weight {note.get('weight')}")
        if note.get("area") not in areas:
            problems.append(f"{label}: unknown area {note.get('area')}")
        if note.get("author") and note["author"] not in people:
            problems.append(f"{label}: unknown author {note['author']}")
        allow = note.get("allow") or []
        for person in allow if isinstance(allow, list) else [allow]:
            if person not in people:
                problems.append(f"{label}: unknown allowed person {person}")
        if note.get("type") in ("fact", "decision"):
            for field in ("subject", "attribute", "value", "claim"):
                if field not in note or note[field] is None or note[field] == "":
                    problems.append(f"{label}: missing {field}")
        if note.get("type") in ("fact", "decision") and not note.get("date"):
            problems.append(f"{label}: missing date")
        notes.append((label, note))
    ids = set(seen)
    for label, note in notes:
        if note.get("source") and note["source"] not in ids:
            problems.append(f"{label}: unknown source {note['source']}")
        elif note.get("source") and note.get("type") in ("fact", "decision"):
            if _ungrounded(bodies[label], bodies[seen[note["source"]]]):
                problems.append(f"{label}: ungrounded quote (note {note.get('id')}): not found in source {note['source']}")
        replaces = note.get("replaces") or []
        for replaced in replaces if isinstance(replaces, list) else [replaces]:
            if replaced not in ids:
                problems.append(f"{label}: unknown replaces id {replaced}")
    if warnings is None:
        for line in caution:
            print(line)
    else:
        warnings.extend(caution)
    return problems
