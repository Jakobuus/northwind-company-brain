"""PowerPoint slides -> one note: `## Slide N` per slide, text per paragraph, plus speaker notes.

Stdlib only. The package is checked before anything is read (names, sizes, compression ratio) and XML
with DOCTYPE/ENTITY declarations is refused."""
from __future__ import annotations

import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from .common import envelope

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_SLIDE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")
_MAX_ENTRIES, _MAX_MEMBER, _MAX_TOTAL_READ, _MAX_RATIO = 10_000, 20_000_000, 100_000_000, 200


def _check(z: zipfile.ZipFile) -> None:
    infos = z.infolist()
    if len(infos) > _MAX_ENTRIES:
        raise ValueError("package has too many entries")
    for info in infos:
        name = info.filename
        if name.startswith(("/", "\\")) or "\\" in name or "\0" in name or ".." in name.split("/"):
            raise ValueError("package has unsafe member names")
        if info.file_size > _MAX_MEMBER:
            raise ValueError("package member too large")
        if info.file_size > 1_000_000 and info.file_size > _MAX_RATIO * max(info.compress_size, 1):
            raise ValueError("package member has an extreme compression ratio")


class _Reader:
    def __init__(self, z: zipfile.ZipFile) -> None:
        self.z, self.read_bytes = z, 0

    def xml(self, name: str):
        try:
            data = self.z.read(name)
        except KeyError:
            return None
        self.read_bytes += len(data)
        if self.read_bytes > _MAX_TOTAL_READ:
            raise ValueError("package too large when unpacked")
        if b"<!doctype" in data[:4096].lower() or b"<!entity" in data[:65536].lower():
            raise ValueError("XML entities are not allowed")
        try:  # defusedxml when installed; otherwise the DOCTYPE/ENTITY refusal above is the guard
            from defusedxml import ElementTree as safe_et
        except ImportError:
            return ET.fromstring(data)
        return safe_et.fromstring(data)


def _paragraphs(node) -> list[str]:
    lines = []
    for para in node.iter(_A + "p"):
        parts = []
        for child in para:
            if child.tag == _A + "r":
                parts.append("".join(t.text or "" for t in child.iter(_A + "t")))
            elif child.tag == _A + "fld" and not (child.get("type") or "").startswith("slidenum"):
                parts.append("".join(t.text or "" for t in child.iter(_A + "t")))
            elif child.tag == _A + "br":
                parts.append(" ")
        line = " ".join("".join(parts).split())
        if line:
            lines.append(line)
    return lines


def _notes_name(reader: _Reader, slide_name: str, number: int) -> str:
    folder, base = posixpath.split(slide_name)
    rels = reader.xml(f"{folder}/_rels/{base}.rels")
    if rels is not None:
        for rel in rels.iter(_REL + "Relationship"):
            target = rel.get("Target") or ""
            if target.endswith(".xml") and "notesSlide" in target:
                return posixpath.normpath(posixpath.join(folder, target))
    return f"ppt/notesSlides/notesSlide{number}.xml"


def _notes_lines(root) -> list[str]:
    lines = []
    for shape in root.iter(_P + "sp"):
        holder = shape.find(f"{_P}nvSpPr/{_P}nvPr/{_P}ph")
        if holder is not None and holder.get("type") == "body":
            lines.extend(_paragraphs(shape))
    return lines


def _core(reader: _Reader) -> dict:
    root = reader.xml("docProps/core.xml")
    if root is None:
        return {}
    found = {}
    for element in root:
        local = element.tag.rsplit("}", 1)[-1]
        if local in ("title", "creator", "created") and (element.text or "").strip():
            found[local] = element.text.strip()
    return found


def load(path: Path, defaults: dict) -> list:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise ValueError("not a valid pptx package") from exc
    with z:
        _check(z)
        reader = _Reader(z)
        slides = sorted((int(m.group(1)), n) for n in z.namelist() if (m := _SLIDE.match(n)))
        if not slides:
            raise ValueError("pptx has no slides")
        chunks = []
        for number, name in slides:
            lines = _paragraphs(reader.xml(name))
            notes = reader.xml(_notes_name(reader, name, number))
            notes_lines = _notes_lines(notes) if notes is not None else []
            chunk = [f"## Slide {number}", "", *lines]
            if notes_lines:
                chunk += ["", "Notes:", *notes_lines]
            chunks.append("\n".join(chunk))
        core = _core(reader)
    meta = {"title": core.get("title") or path.stem, "author": core.get("creator") or defaults.get("author"),
            "date": (core.get("created") or "")[:10] or None}
    return [envelope(path, defaults, "\n\n".join(chunks) + "\n", metadata=meta)]
