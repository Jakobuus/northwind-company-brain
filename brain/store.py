"""Load a markdown company vault without changing its source files."""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import yaml

from .schema import Area, Brain, Note, Person, Policy


_LINK = re.compile(r"\[\[([^\]]+)\]\]")
_FIELDS = set(Note.__dataclass_fields__) - {"body", "links", "path", "extra"}


def _links(body: str) -> list[str]:
    return [target for match in _LINK.findall(body)
            if (target := match.split("|", 1)[0].split("#", 1)[0].strip().rsplit("/", 1)[-1])]


def parse_note(path: Path) -> Note:
    content = path.read_text(encoding="utf-8")
    match = re.match(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", content, re.S)
    if not match:
        raise ValueError("missing or unclosed YAML frontmatter")
    try:
        fields = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"invalid YAML frontmatter: {exc}") from exc
    if not isinstance(fields, dict):
        raise ValueError("frontmatter must be a mapping")
    fields = dict(fields)
    if "date" in fields and fields["date"] is not None:
        raw_date = fields["date"]
        if isinstance(raw_date, datetime):
            fields["date"] = raw_date.date()
        elif isinstance(raw_date, date):
            fields["date"] = raw_date
        elif isinstance(raw_date, str):
            try:
                fields["date"] = date.fromisoformat(raw_date)
            except ValueError as exc:
                try:
                    fields["date"] = datetime.fromisoformat(raw_date).date()
                except ValueError:
                    raise ValueError(f"invalid date: {raw_date}") from exc
        else:
            raise ValueError("date must be an ISO date")
    fields.setdefault("id", path.stem)
    fields.setdefault("title", path.stem)
    fields.setdefault("type", "document")
    if len(path.parts) >= 3 and path.parent.parent.name == "personal":
        fields["area"] = f"personal-{path.parent.name}"
        fields["access"] = "private"
    else:
        fields.setdefault("area", "core")
    for name in ("allow", "replaces"):
        if name in fields and not isinstance(fields[name], list):
            raise ValueError(f"{name} must be a list")
    extra = {key: value for key, value in fields.items() if key not in _FIELDS}
    known = {key: value for key, value in fields.items() if key in _FIELDS}
    body = content[match.end():]
    note = Note(**known, body=body, links=_links(body), path=path, extra=extra)
    note._weight_present = "weight" in fields
    return note


def dump_note(note: Note) -> str:
    fields = {name: getattr(note, name) for name in _FIELDS}
    fields.update(note.extra)
    if fields["date"] is not None:
        fields["date"] = fields["date"].isoformat()
    header = yaml.safe_dump(fields, allow_unicode=True, sort_keys=False, default_flow_style=False)
    return f"---\n{header}---\n{note.body}"


def load(root: Path) -> Brain:
    root = Path(root)
    raw = yaml.safe_load((root / "policy.yaml").read_text(encoding="utf-8")) or {}
    warnings = []
    if not isinstance(raw, dict):
        warnings.append("Invalid policy mapping; using defaults")
        raw = {}
    company = raw.get("company") if isinstance(raw.get("company"), dict) else {}
    for key in sorted(set(raw) - {"company", "people", "areas", "tokens", "access_rules"}, key=str):
        warnings.append(f"Ignored unknown policy key: {key}")
    for key in sorted(set(company) - {"id", "name"}, key=str):
        warnings.append(f"Ignored unknown company key: {key}")
    people = {}
    areas = {}
    for kind, cls, target, defaults, allowed in (
        ("people", Person, people, {"title": "", "rank": 0, "groups": [], "home": None},
         {"name", "title", "rank", "groups", "home"}),
        ("areas", Area, areas, {"topics": [], "readers": [], "owner": "", "color": None, "leads": []},
         {"name", "owner", "readers", "topics", "color", "leads"}),
    ):
        entries = raw.get(kind) or {}
        if not isinstance(entries, dict):
            warnings.append(f"Invalid {kind} mapping; skipped")
            continue
        for entry_id, values in entries.items():
            if not isinstance(entry_id, str) or not isinstance(values, dict):
                warnings.append(f"Invalid {kind} entry {entry_id}; skipped")
                continue
            unknown = set(values) - allowed
            if unknown:
                warnings.append(f"Ignored unknown {kind} keys for {entry_id}: {', '.join(sorted(map(str, unknown)))}")
            fields = {**defaults, **{key: values[key] for key in allowed if key in values}}
            if kind == "areas" and isinstance(fields["readers"], str):
                fields["readers"] = [fields["readers"]]
            if kind == "people":
                valid = (isinstance(fields.get("name"), str) and isinstance(fields["title"], str)
                         and isinstance(fields["rank"], int) and not isinstance(fields["rank"], bool)
                         and isinstance(fields["groups"], list)
                         and all(isinstance(x, str) for x in fields["groups"])
                         and (fields["home"] is None or isinstance(fields["home"], str)))
            else:
                valid = (isinstance(fields.get("name"), str) and isinstance(fields["owner"], str)
                         and isinstance(fields["readers"], list) and isinstance(fields["topics"], list)
                         and isinstance(fields["leads"], list)
                         and all(isinstance(x, str) for x in fields["readers"] + fields["topics"] + fields["leads"]))
            if not valid:
                warnings.append(f"Invalid {kind} entry {entry_id}; skipped")
                continue
            target[entry_id] = cls(id=entry_id, **fields)
    for person in people.values():
        if person.home is not None and (person.home not in areas or
                                        person.home.startswith("personal-")):
            warnings.append(f"Unknown home area {person.home} for {person.id}; using fallback")
            person.home = None
    for person in people.values():
        areas[f"personal-{person.id}"] = Area(
            id=f"personal-{person.id}", name=f"Personal: {person.name}",
            owner=person.id, readers=[], topics=[])
    policy = Policy(company_id=str(company.get("id", root.name)),
                    company_name=str(company.get("name", "")), people=people, areas=areas,
                    tokens=raw.get("tokens") if isinstance(raw.get("tokens"), dict) else {})
    brain = Brain(root=root, policy=policy, notes={}, warnings=warnings)
    resolved_root = root.resolve()
    for path in sorted(root.rglob("*.md")):
        relative = path.relative_to(root)
        if any(part.startswith(".") for part in relative.parts) or relative.parts[0] == "_templates":
            continue
        if not path.resolve().is_relative_to(resolved_root):
            brain.warnings.append(f"Skipped {path}: outside company root")
            continue
        try:
            note = parse_note(path)
        except (OSError, ValueError) as exc:
            brain.warnings.append(f"Skipped {path}: {exc}")
            continue
        if relative == Path("README.md") and note.id == "obsidian-vault-readme":
            continue
        if note.id in brain.notes:
            brain.warnings.append(f"Duplicate id {note.id} in {path}; kept {brain.notes[note.id].path}")
            continue
        brain.notes[note.id] = note
    return brain
