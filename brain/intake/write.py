"""Write a confined, non-destructive Markdown note."""
from __future__ import annotations

from pathlib import Path
import re
import yaml

from .envelope import Envelope, slugify


def write_note(env: Envelope, data_root: Path) -> Path:
    root = Path(data_root).resolve()
    # Area is a single policy key, never a path fragment.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", env.area):
        raise ValueError(f"Unsafe area: {env.area}")
    base = slugify(env.id or env.title)
    for number in range(1, 10000):
        stem = base if number == 1 else f"{base[:80-len(str(number))-1]}-{number}"
        frag = (Path("personal") / env.area.removeprefix("personal-") / f"{stem}.md"
                if env.area.startswith("personal-") else Path(env.area) / f"{stem}.md")
        path = (root / frag).resolve()
        path.relative_to(root.resolve())
        metadata = dict(env.frontmatter)
        metadata.update({"id": stem, "type": env.type, "title": env.title, "area": env.area,
                         "access": env.access, "allow": env.allow, "author": env.author,
                         "date": env.date})
        metadata = {key: value for key, value in metadata.items() if value is not None}
        content = f"---\n{yaml.safe_dump(metadata, sort_keys=False, allow_unicode=True)}---\n{env.body}"
        if path.exists():
            if path.read_text(encoding="utf-8") == content:
                return path
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation avoids overwriting a concurrent import.
        try:
            with path.open("x", encoding="utf-8") as stream:
                stream.write(content)
            return path
        except FileExistsError:
            continue
    raise RuntimeError("No free note filename")
