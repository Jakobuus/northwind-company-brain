"""Snapshot the public framework library into web/frameworks.json (titles only, no source paths)."""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from brain.outside import _url  # noqa: E402

BASE = "01-frameworks"
PER, TOTAL = 40, 400


NAMES = {"Scm": "Supply chain management", "Strategy competitive": "Competitive strategy",
         "Strategy corporate": "Corporate strategy", "Strategy international": "International strategy"}


def human(name: str) -> str:
    name = re.sub(r"\.md$", "", name.strip("/"))
    name = re.sub(r"^\d+[-_. ]+", "", name)
    s = re.sub(r"[-_]+", " ", name).strip()
    return s[:1].upper() + s[1:] if s else name


async def ls(c, path: str) -> list[tuple[str, bool]]:
    r = await c.call_tool("list_dir", {"path": path})
    text = "\n".join(getattr(x, "text", "") for x in r.content)
    out = []
    for line in text.splitlines():
        line = re.sub(r"\s+\(\d+ bytes\)\s*$", "", line.strip())
        if line:
            out.append((line.rstrip("/"), line.endswith("/")))
    return out


async def walk(c, path: str, depth: int = 0) -> list[str]:
    files = []
    for name, is_dir in await ls(c, path):
        p = f"{path}/{name}"
        if is_dir:
            if depth < 3:
                files += await walk(c, p, depth + 1)
        elif name.endswith(".md") and name.lower() not in ("readme.md", "index.md"):
            files.append(p)
    return files


async def main() -> None:
    from fastmcp import Client
    discs = []
    async with Client(_url()) as c:
        for name, is_dir in await ls(c, BASE):
            if not is_dir:
                continue
            files = sorted(await walk(c, f"{BASE}/{name}"), key=lambda p: human(p.rsplit("/", 1)[1]).lower())
            if files:
                discs.append((NAMES.get(human(name), human(name)), files))
    discs.sort()
    total = sum(min(len(f), PER) for _, f in discs)
    per = PER
    while total > TOTAL and per > 1:
        per -= 1
        total = sum(min(len(f), per) for _, f in discs)
    out = {"source": "MBA Brain public framework library", "disciplines": [
        {"name": n, "frameworks": [{"title": human(p.rsplit("/", 1)[1])} for p in f[:per]]}
        for n, f in discs]}
    (ROOT / "web" / "frameworks.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    for d in out["disciplines"]:
        print(d["name"], len(d["frameworks"]))
    print("total", sum(len(d["frameworks"]) for d in out["disciplines"]))


asyncio.run(main())
