from pathlib import Path
from pypdf import PdfReader

from .common import envelope


def load(path: Path, defaults: dict) -> list:
    reader = PdfReader(path)
    body = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    metadata = reader.metadata or {}
    date = metadata.get("/CreationDate")
    if date and str(date).startswith("D:"):
        date = str(date)[2:10]
        date = f"{date[:4]}-{date[4:6]}-{date[6:8]}"
    return [envelope(path, defaults, body, metadata={
        "title": metadata.get("/Title") or path.stem,
        "author": metadata.get("/Author") or defaults.get("author"), "date": date,
    })]
