"""WebVTT / SubRip captions -> one meeting note with `[HH:MM:SS] Speaker: text` lines."""
from __future__ import annotations

import html
import re
from pathlib import Path

from . import transcript

_TIMING = re.compile(r"^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,]\d+)?\s*-->")
_TAG = re.compile(r"<[^>]*>")
_VOICE = re.compile(r"<v(?:\.[^\s>]*)?\s+([^>]*)>")


def decode(data: bytes) -> str:
    """Text from bytes: UTF-8 (BOM ok), UTF-16 with BOM, else cp1252, else latin-1. Never raises."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            pass
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            pass
    return data.decode("latin-1")


def cues_to_text(text: str) -> str:
    out = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n")):
        lines = block.split("\n")
        for i, line in enumerate(lines):
            match = _TIMING.match(line)
            if not match:
                continue  # header, NOTE/STYLE blocks and cue ids carry no spoken text
            hours, minutes, seconds = (int(part or 0) for part in match.groups())
            raw = _VOICE.sub(lambda v: v.group(1).strip() + ": ", " ".join(x.strip() for x in lines[i + 1:]))
            spoken = " ".join(html.unescape(_TAG.sub("", raw)).split())
            if spoken:
                out.append(f"[{hours:02d}:{minutes:02d}:{seconds:02d}] {spoken}")
            break
    return "\n".join(out)


def load(path: Path, defaults: dict) -> list:
    body = cues_to_text(decode(path.read_bytes()))
    if not body:
        raise ValueError("no caption cues found")
    return transcript.from_text(path, body + "\n", defaults)
