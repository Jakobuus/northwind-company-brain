"""HTML pages -> plain text note titled by <title>. Scripts, styles and markup are dropped."""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

from .captions import decode
from .common import envelope

_SKIP = {"script", "style", "noscript", "template", "svg", "iframe", "object", "head"}
_BLOCK = {"p", "div", "br", "li", "ul", "ol", "tr", "table", "section", "article", "header", "footer", "nav",
          "main", "aside", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "dt", "dd", "form"}


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title, self.lines, self._cur, self._skip, self._in_title = "", [], [], 0, False

    def flush(self) -> None:
        line = " ".join("".join(self._cur).split())
        if line:
            self.lines.append(line)
        self._cur = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag == "body":
            self._skip = 0  # an unclosed <head> must not hide the page
        elif tag in _SKIP:
            self._skip += 1
        elif tag in _BLOCK:
            self.flush()

    def handle_startendtag(self, tag, attrs):
        if tag in _BLOCK:
            self.flush()

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in _SKIP:
            self._skip = max(0, self._skip - 1)
        elif tag in _BLOCK:
            self.flush()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self._cur.append(data)


def html_text(markup: str) -> tuple[str, str]:
    """-> (title, body text)."""
    parser = _Text()
    try:
        parser.feed(markup)
        parser.close()
    except Exception:  # broken markup: keep what was read
        pass
    parser.flush()
    return " ".join(parser.title.split()), "\n".join(parser.lines)


def load(path: Path, defaults: dict) -> list:
    title, body = html_text(decode(path.read_bytes()))
    if not body:
        raise ValueError("no text found in page")
    return [envelope(path, defaults, body + "\n", title=title or path.stem)]
