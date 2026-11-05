"""Email importer: .eml (one message) and .mbox (many messages), one note per message.

Access: an email is readable by its sender and its recipients. From becomes the author;
From, To and Cc (people we can match to the policy) go into `allow`; default access is
`restricted`, the same pattern as meeting transcripts. Unknown outside addresses are ignored.
Automated mail (newsletters, bulk, auto-submitted, no-reply senders) is skipped and counted.
"""
from __future__ import annotations

import html
import mailbox
import re
import warnings
from email import message_from_binary_file, policy
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path

from .common import envelope, person_id

_ATTRIBUTION = re.compile(r"^(on|am)\s.{0,300}?\b(wrote\s*:|schrieb\b[^:]{0,150}:)\s*$", re.I)
_ORIGINAL = re.compile(r"^\s*[-_]{2,}\s*(original message|ursprüngliche nachricht|urspr\w+ nachricht)\s*[-_]*\s*$", re.I)
_OUTLOOK_FROM = re.compile(r"^(from|von):\s", re.I)
_OUTLOOK_SENT = re.compile(r"^(sent|gesendet|date|datum):", re.I)
_NO_REPLY = re.compile(r"(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@|\bnotifications?@", re.I)


def load(path: Path, defaults: dict) -> list:
    envelopes, skipped, many = [], 0, path.suffix.lower() == ".mbox"
    for index, msg in enumerate(_messages(path), start=1):
        reason = _automated(msg)
        if reason:
            skipped += 1
            continue
        env = _to_envelope(path, msg, defaults, index if many else None)
        if env is None:
            skipped += 1
            continue
        envelopes.append(env)
    if skipped:
        warnings.warn(f"Skipped {skipped} automated or empty message(s) in {path}", stacklevel=2)
    return envelopes


def _messages(path: Path):
    if path.suffix.lower() == ".mbox":
        box = mailbox.mbox(str(path), factory=lambda f: message_from_binary_file(f, policy=policy.default),
                           create=False)
        try:
            yield from box
        finally:
            box.close()
    else:
        with path.open("rb") as stream:
            yield message_from_binary_file(stream, policy=policy.default)


def _automated(msg) -> str | None:
    if msg["List-Unsubscribe"] or msg["List-Id"]:
        return "newsletter"
    if str(msg["Precedence"] or "").strip().lower() in ("bulk", "list", "junk"):
        return "bulk"
    auto = str(msg["Auto-Submitted"] or "").strip().lower()
    if auto and auto != "no":
        return "automated"
    if _NO_REPLY.search(str(msg["From"] or "")):
        return "no-reply"
    return None


def _people(msg, header: str) -> list[tuple[str, str]]:
    values = [str(value) for value in (msg.get_all(header) or [])]
    return [(name.strip(), addr.strip().lower()) for name, addr in getaddresses(values) if addr]


def _person(name: str, addr: str, defaults: dict) -> str | None:
    pid = person_id(name, defaults) if name else None
    if pid:
        return pid
    # "maya.lin@..." -> "maya lin" must equal a full name. A bare first name or id in an address
    # is not trusted: an outside "raj@other.com" must not open mail to the internal Raj.
    local = re.sub(r"[._-]+", " ", addr.split("@")[0]).casefold()
    matches = [p for p, full in (defaults.get("people") or {}).items() if str(full).casefold() == local]
    return matches[0] if len(matches) == 1 else None


def _strip_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", text)
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d)>", "\n", text)
    return html.unescape(re.sub(r"<[^>]+>", "", text))


def _body_text(msg) -> str:
    part = msg.get_body(("plain", "html"))
    if part is None:
        return ""
    try:
        text = part.get_content()
    except (LookupError, UnicodeError):
        text = (part.get_payload(decode=True) or b"").decode("utf-8", "replace")
    return _strip_html(text) if part.get_content_type() == "text/html" else text


def trim_body(text: str) -> str:
    """Drop quoted replies: '>' lines, 'On ... wrote:' / 'Am ... schrieb:' headers, original-message blocks."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out, i = [], 0
    while i < len(lines):
        line, stripped = lines[i], lines[i].strip()
        joined = f"{stripped} {lines[i + 1].strip()}" if i + 1 < len(lines) else stripped
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if line.rstrip() == "--" or _ORIGINAL.match(line) or (_OUTLOOK_FROM.match(stripped) and _OUTLOOK_SENT.match(nxt)):
            break  # signature or Outlook-style quoted block: the rest is not new text
        if stripped.startswith(">"):
            i += 1
        elif _ATTRIBUTION.match(stripped):
            i += 1
        elif _ATTRIBUTION.match(joined) and re.match(r"(?i)^(on|am)\s", stripped):
            i += 2
        else:
            out.append(line.rstrip())
            i += 1
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def _to_envelope(path: Path, msg, defaults: dict, index: int | None):
    body = trim_body(_body_text(msg))
    if not body:
        return None
    sender = (_people(msg, "From") or [("", "")])[0]
    recipients = _people(msg, "To") + _people(msg, "Cc")
    sender_id = _person(*sender, defaults) if sender[1] else None
    recipient_ids = [pid for pid in (_person(name, addr, defaults) for name, addr in recipients) if pid]
    subject = " ".join(str(msg["Subject"] or "").split()) or "(no subject)"
    header = [f"From: {_label(sender)}"]
    if recipients:
        header.append("To: " + ", ".join(_label(r) for r in _people(msg, "To")))
    if _people(msg, "Cc"):
        header.append("Cc: " + ", ".join(_label(r) for r in _people(msg, "Cc")))
    suffix = f"-{index:03d}-{subject}" if index else f"-{subject}"
    env = envelope(path, {**defaults, "access": defaults.get("access") or "restricted"},
                   "\n".join(header) + "\n\n" + body, title=subject, suffix=suffix,
                   metadata={"title": subject}, kind="document")
    env.author = defaults.get("author") or sender_id
    env.allow = list(dict.fromkeys([*env.allow, *([sender_id] if sender_id else []), *recipient_ids]))
    env.date = _date(msg) or env.date
    if not env.author and not env.allow:
        warnings.warn(f"No known sender or recipient in '{subject}' ({path}): nobody can read this note",
                      stacklevel=2)
    return env


def _label(person: tuple[str, str]) -> str:
    name, addr = person
    return f"{name} <{addr}>" if name else addr


def _date(msg) -> str | None:
    try:
        return parsedate_to_datetime(str(msg["Date"])).date().isoformat()
    except (TypeError, ValueError, IndexError):
        return None
