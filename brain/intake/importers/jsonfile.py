import json
from pathlib import Path

from .common import envelope

_TEXT_KEYS = ("text", "body", "content", "title", "name", "description")


def load(path: Path, defaults: dict) -> list:
    if path.suffix.lower() == ".jsonl":
        value = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    else:
        value = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(value, list) and value and all(isinstance(item, dict) and
            any(item.get(key) for key in _TEXT_KEYS) for item in value):
        result = []
        for index, item in enumerate(value, 1):
            body = str(next((item[key] for key in ("text", "body", "content", "description") if item.get(key)),
                            json.dumps(item, ensure_ascii=False, indent=2)))
            title = str(item.get("title") or item.get("name") or f"{path.stem} {index}")
            result.append(envelope(path, defaults, body, title=title, suffix=f"-{index}",
                                   metadata={key: item[key] for key in ("author", "date") if key in item}))
        return result
    return [envelope(path, defaults, json.dumps(value, ensure_ascii=False, indent=2))]
