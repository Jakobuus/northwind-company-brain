"""Incremental chunk embeddings for permission-filtered semantic search."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable

from . import access, store
from .schema import Brain, Note

MODEL = "BAAI/bge-small-en-v1.5"
CACHE = ".brain-cache"
_embedder: Callable[[list[str]], object] | None = None  # injectable for tests
_model = None
_model_lock = threading.Lock()
_warned_query = False


def available() -> bool:
    if _embedder is not None:
        return True
    try:
        import fastembed  # noqa: F401
        import numpy  # noqa: F401
    except ImportError:
        return False
    return True


def _embed(texts: list[str]):
    global _model
    if _embedder is not None:
        return _embedder(texts)
    from fastembed import TextEmbedding
    with _model_lock:  # one model load, even when several orgs build/search at once
        if _model is None:
            _model = TextEmbedding(model_name=MODEL,
                                   cache_dir=os.path.expanduser(os.getenv(
                                       "BRAIN_MODEL_DIR", "~/.cache/brain-fastembed")))
        model = _model
    return model.embed(texts, batch_size=16)


def _digest(note: Note) -> str:
    if note.path and note.path.is_file():
        source = note.path.read_bytes()
    else:
        source = json.dumps([note.title, note.body, note.subject, note.attribute,
                             note.value, note.area, note.author], ensure_ascii=False,
                            default=str).encode("utf-8")
    return hashlib.sha256(source).hexdigest()


def _signature(note: Note, previous: object = None) -> dict:
    """Reuse a file digest when its size and modification time are unchanged."""
    if note.path and note.path.is_file():
        stat = note.path.stat()
        if (isinstance(previous, dict) and previous.get("mtime_ns") == stat.st_mtime_ns
                and previous.get("size") == stat.st_size):
            return previous
        return {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size, "digest": _digest(note)}
    return {"digest": _digest(note)}


def _digest_value(signature: object) -> str | None:
    return signature.get("digest") if isinstance(signature, dict) else signature


def chunks(note: Note, limit: int = 800, overlap: int = 80) -> list[dict[str, str]]:
    """Split on Markdown headings, then split long sections with a short overlap."""
    sections: list[tuple[str, str]] = []
    heading = note.title
    lines: list[str] = []
    for line in note.body.splitlines():
        if re.match(r"^#{1,6}\s+", line):
            if lines:
                sections.append((heading, "\n".join(lines).strip()))
            heading = re.sub(r"^#{1,6}\s+", "", line).strip()
            lines = []
        else:
            lines.append(line)
    if lines or not sections:
        sections.append((heading, "\n".join(lines).strip()))
    result = []
    for heading, body in sections:
        source = body or heading
        width = max(1, limit - len(heading) - 1)
        step = max(1, width - min(overlap, width - 1))
        for start in range(0, len(source), step):
            piece = source[start:start + width]
            result.append({"note_id": note.id, "text": f"{heading}\n{piece}",
                           "snippet": piece[:200]})
            if start + width >= len(source):
                break
    return result


def _paths(brain: Brain) -> tuple[Path, Path, Path]:
    root = Path(brain.root) / CACHE
    return root / "vectors.npy", root / "chunks.json", root / "manifest.json"


def built(brain: Brain) -> bool:
    return all(path.is_file() for path in _paths(brain))


def _read(brain: Brain):
    import numpy as np
    vectors_path, chunks_path, manifest_path = _paths(brain)
    vectors = np.load(vectors_path, allow_pickle=False)
    rows = json.loads(chunks_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if len(vectors) != len(rows) or not isinstance(manifest, dict):
        raise ValueError("incomplete embedding index")
    return vectors, rows, manifest


def build(brain: Brain) -> dict[str, int | float]:
    """Build or update the index, embedding only changed notes."""
    import numpy as np
    start = time.perf_counter()
    old_vectors, old_rows, old_manifest = None, [], {}
    if built(brain):
        try:
            old_vectors, old_rows, old_manifest = _read(brain)
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    manifest = {note.id: _signature(note, old_manifest.get(note.id))
                for note in brain.notes.values()}
    changed = {note_id for note_id, signature in manifest.items()
               if _digest_value(old_manifest.get(note_id)) != signature["digest"]}
    removed = set(old_manifest) - set(manifest)
    retained = [(row, old_vectors[i]) for i, row in enumerate(old_rows)
                if row["note_id"] in manifest and row["note_id"] not in changed]
    new_rows = [row for note_id in sorted(changed) for row in chunks(brain.notes[note_id])]
    new_vectors = []
    for offset in range(0, len(new_rows), 16):
        batch = new_rows[offset:offset + 16]
        new_vectors.extend(_embed([row["text"] for row in batch]))
    rows = [row for row, _ in retained] + new_rows
    vectors = np.asarray([vector for _, vector in retained] + new_vectors,
                         dtype=np.float32)
    if not rows:
        vectors = np.empty((0, 0), dtype=np.float32)
    vectors_path, chunks_path, manifest_path = _paths(brain)
    vectors_path.parent.mkdir(parents=True, exist_ok=True)
    # The manifest is written last, so an interrupted update can be rebuilt.
    for path in (vectors_path, chunks_path, manifest_path):
        # Unique temp name in the same dir, then atomic rename (no clashes between builders).
        fd, temp_name = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb" if path == vectors_path else "w", encoding=None if path == vectors_path else "utf-8") as handle:
                if path == vectors_path:
                    np.save(handle, vectors)
                else:
                    handle.write(json.dumps(rows if path == chunks_path else manifest))
            os.replace(temp_name, path)
        except BaseException:
            try:
                os.unlink(temp_name)
            except OSError:
                pass
            raise
    return {"notes": len(manifest), "chunks": len(rows), "embedded_notes": len(changed),
            "removed_notes": len(removed), "seconds": time.perf_counter() - start}


_build_lock = threading.Lock()  # one embedding job at a time (the model is shared by every org)
_state_lock = threading.Lock()
_active: set[str] = set()  # org roots with a build running
_pending: dict[str, Brain] = {}  # newest brain requested per org root while its build runs (coalesced)


def ensure_index(brain: Brain) -> int | None:
    """Build or refresh this org's meaning index (incremental). Never raises on model/disk problems;
    None when off, unavailable, or when a build for the same org is already running.

    Builds for different orgs queue up behind each other (they share one model). Calls for an org whose
    build is running are coalesced: the build repeats once at the end if a newer brain arrived."""
    key = str(Path(brain.root).resolve())
    with _state_lock:
        if key in _active:
            _pending[key] = brain
            return None
        _active.add(key)
    result = None
    try:
        current = brain
        while True:
            with _build_lock:
                result = _ensure_index(current)
            with _state_lock:
                nxt = _pending.pop(key, None)
                if nxt is None or nxt is current:
                    _active.discard(key)
                    return result
                current = nxt
    except BaseException:
        with _state_lock:
            _active.discard(key)
            _pending.pop(key, None)
        raise


def _ensure_index(brain: Brain) -> int | None:
    if os.getenv("BRAIN_EMBED") == "0":
        return None
    if not available():
        print("WARNING: fastembed/numpy missing; search falls back to keyword only "
              "(install with: uv pip install -e '.[embed]')", file=sys.stderr, flush=True)
        return None
    try:
        counts = build(brain)
    except Exception as exc:  # model download or disk problems must not stop the server
        print(f"WARNING: meaning index build failed ({exc}); keyword search only",
              file=sys.stderr, flush=True)
        return None
    try:
        _embed(["warm up"])  # load the model now so the first question does not wait for it
    except Exception as exc:
        print(f"WARNING: embedding model not available ({exc}); questions use keyword search only",
              file=sys.stderr, flush=True)
        return None
    print(f"meaning index [{Path(brain.root).name}]: {counts['notes']} notes, {counts['chunks']} chunks, "
          f"all embedded ({counts['embedded_notes']} notes embedded this run, "
          f"{counts['notes'] - counts['embedded_notes']} reused), {counts['seconds']:.1f}s",
          file=sys.stderr, flush=True)
    return int(counts["notes"])


def ranked(brain: Brain, person_id: str, query: str, k: int) -> list[tuple[str, str]]:
    """Return (note id, best chunk snippet), after the read gate."""
    if k <= 0 or not query.strip() or not built(brain) or not available():
        return []
    import numpy as np
    try:
        vectors, rows, manifest = _read(brain)
    except (OSError, ValueError, json.JSONDecodeError):
        return []
    visible = {note.id for note in access.readable(brain, person_id)
               if _digest_value(manifest.get(note.id)) ==
               _signature(note, manifest.get(note.id))["digest"]}
    indices = [i for i, row in enumerate(rows) if row["note_id"] in visible]
    if not indices:
        return []
    global _warned_query
    try:
        qvec = np.asarray(next(iter(_embed([query]))), dtype=np.float32)
    except Exception as exc:  # model missing/broken: keyword search carries on
        if not _warned_query:
            _warned_query = True
            print(f"WARNING: query embedding failed ({exc}); keyword search only",
                  file=sys.stderr, flush=True)
        return []
    selected = vectors[indices]
    norms = np.linalg.norm(selected, axis=1) * np.linalg.norm(qvec)
    scores = selected @ qvec / np.maximum(norms, 1e-12)
    minimum = float(os.getenv("BRAIN_EMBED_MIN", "0.25"))
    best: dict[str, tuple[float, str]] = {}
    for i, score in zip(indices, scores):
        if score < minimum:
            continue
        row = rows[i]
        note_id = row["note_id"]
        if note_id not in best or score > best[note_id][0]:
            best[note_id] = (float(score), row["snippet"])
    return [(note_id, best[note_id][1]) for note_id in
            sorted(best, key=lambda item: (-best[item][0], item))[:k]]


def semantic(brain: Brain, person_id: str, query: str, k: int = 8) -> list[str]:
    return [note_id for note_id, _ in ranked(brain, person_id, query, k)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the semantic search index")
    parser.add_argument("--data", type=Path, required=True)
    args = parser.parse_args()
    counts = build(store.load(args.data))
    print(f"{counts['notes']} notes, {counts['chunks']} chunks; "
          f"embedded {counts['embedded_notes']}, removed {counts['removed_notes']}; "
          f"{counts['seconds']:.2f}s")


if __name__ == "__main__":
    main()
