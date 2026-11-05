"""Create an isolated Obsidian vault around a company data directory."""

from __future__ import annotations

import json
import os
from pathlib import Path

import yaml

from .schema import NOTE_TYPES


GREY = "#808080"
MARKER = "brain-kit.json"


def _same_path(left: Path, right: Path) -> bool:
    if str(left).casefold() == str(right).casefold():
        return True
    try:
        return os.path.samefile(left, right)
    except OSError:
        return False


def _color(value: object) -> int:
    if not isinstance(value, str) or len(value) != 7 or not value.startswith("#"):
        raise ValueError(f"Invalid policy color: {value!r} (expected #RRGGBB)")
    return int(value[1:], 16)


def _files(root: Path) -> dict[Path, str]:
    policy = yaml.safe_load((root / "policy.yaml").read_text(encoding="utf-8")) or {}
    areas = policy.get("areas") or {}
    people = policy.get("people") or {}
    groups = []
    for area, details in sorted(areas.items()):
        color = GREY if area.startswith("personal-") else (details or {}).get("color") or GREY
        groups.append({"query": f"path:{area}/", "color": {"a": 1, "rgb": _color(color)}})
    for person in sorted(people):
        groups.append({"query": f"path:personal/{person}/", "color": {"a": 1, "rgb": _color(GREY)}})

    def encoded(value: object) -> str:
        return json.dumps(value, indent=2, ensure_ascii=False) + "\n"

    files = {
        root / ".obsidian" / MARKER: encoded({"owner": "brain-kit"}),
        root / ".obsidian" / "app.json": encoded({"showUnsupportedFiles": False}),
        root / ".obsidian" / "appearance.json": encoded({"baseFontSize": 16}),
        root / ".obsidian" / "graph.json": encoded({"search": "-path:.brain-cache -path:_templates", "colorGroups": groups}),
        root / ".obsidian" / "core-plugins.json": encoded(["file-explorer", "global-search", "switcher", "graph", "backlinks", "templates"]),
        root / ".obsidian" / "templates.json": encoded({"folder": "_templates"}),
        root / "README.md": (
            "---\n"
            "id: obsidian-vault-readme\n"
            "type: document\n"
            "title: Company brain vault\n"
            f"area: {next(iter(areas), 'core')}\n"
            "access: all\n"
            "allow: []\n"
            "---\n\n"
            "# Company brain vault\n\n"
            "In Obsidian, choose File → Open folder as vault → choose this data folder.\n"
            "This is a separate vault from your main Obsidian vault.\n"
        ),
    }
    for kind in NOTE_TYPES:
        fields = [f"id: template-{kind}", f"type: {kind}", f"title: New {kind}",
                  "area: core", "access: area", "allow: []", "author:", "date: '{{date}}'", "source:"]
        if kind in ("fact", "decision"):
            fields += ["subject: subject", "attribute: attribute", "value: value",
                       f"claim: {'decision' if kind == 'decision' else 'observation'}",
                       "weight: normal", "replaces: []", "status: current"]
        files[root / "_templates" / f"{kind}.md"] = "---\n" + "\n".join(fields) + "\n---\n\n"
    return files


def setup(root: Path, *, force: bool = False) -> tuple[list[Path], list[Path]]:
    """Return (written paths, preserved user-edited paths)."""
    root = Path(root).expanduser().resolve()
    protected = os.getenv("BRAIN_PROTECTED_VAULT", "").strip()  # e.g. your own main Obsidian vault
    if protected:
        main_vault = Path(protected).expanduser().resolve()
        if any(_same_path(candidate, main_vault) for candidate in (root, *root.parents)):
            raise ValueError(f"Refusing {root}: it is inside the protected vault (BRAIN_PROTECTED_VAULT)")
    for parent in root.parents:
        if (parent / ".obsidian").exists():
            raise ValueError(f"Refusing {root}: parent {parent} already contains .obsidian")
    if not root.is_dir():
        raise ValueError(f"Data directory does not exist: {root}")
    files = _files(root)
    for path in files:
        if not path.resolve().is_relative_to(root):
            raise ValueError(f"Refusing {path}: output resolves outside the data directory")
    if (root / ".obsidian").exists() and not (root / ".obsidian" / MARKER).is_file():
        raise ValueError(f"Refusing {root}: root already contains .obsidian without brain-kit marker")
    written, preserved = [], []
    for path, content in files.items():
        if path.exists() and path.read_text(encoding="utf-8") == content:
            continue
        if path.exists() and not force:
            preserved.append(path)
            continue
        if path == root / "README.md" and path.exists():
            from .store import parse_note
            try:
                if parse_note(path).id != "obsidian-vault-readme":
                    preserved.append(path)
                    continue
            except (OSError, ValueError):
                preserved.append(path)
                continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        written.append(path)
    return written, preserved
