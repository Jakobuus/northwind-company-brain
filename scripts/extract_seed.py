"""One-off: run fact extraction over already-seeded notes of an org dir.
usage: .venv/bin/python scripts/extract_seed.py <org_dir>"""
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from brain import extract, store  # noqa: E402

org = Path(sys.argv[1])
brain = store.load(org)
have = {n.source for n in brain.notes.values() if extract.is_child(n)}
todo = [n.id for n in brain.notes.values()
        if n.type in extract.EXTRACTABLE and not extract.is_child(n) and n.id not in have
        and "_live" not in str(n.path) and "_live" not in str(n.extra.get("origin", ""))]
print(f"{len(todo)} notes to extract", flush=True)


def one(nid):
    n = extract.extract_now(org, nid)
    print(f"{nid}: {n}", flush=True)
    return n


with ThreadPoolExecutor(2) as ex:
    res = list(ex.map(one, todo))
print(f"processed={len(res)} facts={sum(res)} zero={sum(1 for r in res if r == 0)}")
