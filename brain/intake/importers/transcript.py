import re
from pathlib import Path

from .common import envelope, person_id

_SPEAKER = re.compile(r"^(?:(?:\[\d{1,2}:\d{2}(?::\d{2})?\]|\d{1,2}:\d{2}(?::\d{2})?)\s*)?([^\W\d_][^\W\d_ .'-]*(?:[\w .'-]*[^\W\d_])?):\s*\S", re.UNICODE)
_HEADERS = {"to", "from", "subject", "agenda", "date", "re"}


def speaker(line: str) -> str | None:
    match = _SPEAKER.match(line)
    if not match:
        return None
    name = match.group(1).strip()
    if name.casefold() in _HEADERS or not 1 <= len(name.split()) <= 4:
        return None
    return name


def load(path: Path, defaults: dict) -> list:
    return from_text(path, path.read_text(encoding="utf-8-sig"), defaults)


def from_text(path: Path, body: str, defaults: dict) -> list:
    """Turn transcript text into one meeting note; speakers found become `allow`."""
    speakers = []
    warnings = []
    for line in body.splitlines():
        name = speaker(line)
        if name:
            pid = person_id(name, defaults)
            if pid and pid not in speakers:
                speakers.append(pid)
            elif not pid:
                warnings.append(f"Unknown speaker {name} in {path}")
    env = envelope(path, {**defaults, "access": defaults.get("access") or "restricted"}, body, kind="meeting")
    env.allow = list(dict.fromkeys([*env.allow, *speakers]))
    for warning in dict.fromkeys(warnings):
        import warnings as warning_module
        warning_module.warn(warning, stacklevel=2)
    return [env]
