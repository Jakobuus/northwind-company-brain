"""Select importers by suffix or MIME type and walk directories deterministically."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Callable

from .importers import markdown, pdf, docx, table, jsonfile, transcript, mail, captions, html, pptx, fallback

Importer = Callable[[Path, dict], list]
_SUFFIXES: dict[str, Importer] = {}
_MIMES: dict[str, Importer] = {}


def register(*suffixes: str, mimes: tuple[str, ...] = ()):
    """Register a load(path, defaults) function for source formats."""
    def decorator(loader: Importer) -> Importer:
        for suffix in suffixes:
            key = suffix.lower()
            if not key.startswith(".") or key in _SUFFIXES:
                raise ValueError(f"Invalid or duplicate suffix: {suffix}")
            _SUFFIXES[key] = loader
        for mime in mimes:
            key = mime.lower()
            if key in _MIMES:
                raise ValueError(f"Duplicate MIME type: {mime}")
            _MIMES[key] = loader
        return loader
    return decorator


register(".md", ".txt", mimes=("text/markdown", "text/plain"))(markdown.load)
register(".pdf", mimes=("application/pdf",))(pdf.load)
register(".docx", mimes=("application/vnd.openxmlformats-officedocument.wordprocessingml.document",))(docx.load)
register(".csv", ".xlsx", mimes=("text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))(table.load)
register(".json", ".jsonl", mimes=("application/json", "application/x-ndjson"))(jsonfile.load)
register(".transcript")(transcript.load)
register(".eml", ".mbox", mimes=("message/rfc822", "application/mbox"))(mail.load)
register(".vtt", ".srt", mimes=("text/vtt", "application/x-subrip"))(captions.load)
register(".html", ".htm", mimes=("text/html",))(html.load)
register(".pptx", mimes=("application/vnd.openxmlformats-officedocument.presentationml.presentation",))(pptx.load)


def formats() -> list[tuple[str, str]]:
    return [(suffix, loader.__module__) for suffix, loader in sorted(_SUFFIXES.items())]


def import_path(path: Path, defaults: dict, *, skipped: list[str] | None = None) -> list:
    path = Path(path)
    if path.name.startswith("."):
        _skip(f"Skipped {path}: hidden file or folder", skipped)
        return []
    if path.is_dir():
        result = []
        for child in sorted(path.rglob("*")):
            relative = child.relative_to(path)
            if any(part.startswith(".") for part in relative.parts):
                if child.name.startswith("."):
                    _skip(f"Skipped {child}: hidden file or folder", skipped)
                continue
            if child.is_file():
                result.extend(import_path(child, defaults, skipped=skipped))
        return result
    try:
        mime = mimetypes.guess_type(path.name)[0]
        loader = _SUFFIXES.get(path.suffix.lower()) or _MIMES.get((mime or "").lower())
        if loader is None:
            result = fallback.load(path, defaults)
            if result is None:
                _skip(f"Skipped {path}: unsupported or binary file", skipped)
                return []
            return result
        if path.suffix.lower() == ".txt":
            lines = path.read_text(encoding="utf-8-sig").splitlines()
            speakers = {name.casefold() for line in lines if (name := transcript.speaker(line))}
            if len(lines) >= 5 and len(speakers) >= 3:
                return transcript.load(path, defaults)
        return loader(path, defaults)
    except Exception as exc:
        _skip(f"Skipped {path}: {exc}", skipped)
        return []


def _skip(message: str, skipped: list[str] | None) -> None:
    if skipped is not None:
        skipped.append(message)
    else:
        import warnings
        warnings.warn(message, stacklevel=2)
