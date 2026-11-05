from pathlib import Path
from docx import Document

from .common import envelope


def load(path: Path, defaults: dict) -> list:
    doc = Document(path)
    body = "\n".join(p.text for p in doc.paragraphs)
    props = doc.core_properties
    return [envelope(path, defaults, body, metadata={
        "title": props.title or path.stem, "author": props.author or defaults.get("author"),
        "date": props.created,
    })]
