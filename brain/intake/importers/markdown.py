from pathlib import Path
import yaml

from .common import envelope


def load(path: Path, defaults: dict) -> list:
    text = path.read_text(encoding="utf-8-sig")
    metadata = {}
    body = text
    lines = text.splitlines(keepends=True)
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
        if end is not None:
            parsed = yaml.safe_load("".join(lines[1:end]))
            if parsed is not None and not isinstance(parsed, dict):
                raise ValueError(f"Frontmatter must be a mapping: {path}")
            metadata = parsed or {}
            body = "".join(lines[end + 1:])
    return [envelope(path, defaults, body, metadata=metadata)]
