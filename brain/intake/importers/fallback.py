"""Best effort text import for unrecognized files."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from .common import envelope


def _text(raw: bytes) -> str | None:
    if not raw or b"\0" in raw:
        return None
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            text = raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        controls = sum(not char.isprintable() and char not in "\n\r\t\f" for char in text)
        if controls / max(len(text), 1) > 0.05:
            return None
        return text if text.strip() else None
    return None


def load(path: Path, defaults: dict) -> list | None:
    if sys.platform == "darwin" and path.suffix.lower() in {".rtf", ".doc", ".pages"} and shutil.which("textutil"):
        result = subprocess.run(["textutil", "-convert", "txt", "-stdout", str(path)],
                                capture_output=True, check=False)
        if result.returncode == 0 and (text := _text(result.stdout)):
            return [envelope(path, defaults, text)]
    text = _text(path.read_bytes())
    return [envelope(path, defaults, text)] if text is not None else None
