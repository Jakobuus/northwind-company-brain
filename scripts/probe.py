#!/usr/bin/env python3
"""Check per-person MCP links the way a connector would use them.

usage: python scripts/probe.py [--query Q] [--forbidden ID_OR_TITLE ...] <link> [<link> ...]

For each link: list tools, call whoami, call search. With --forbidden, also search and
read_note for that note and FAIL if it (or anything about it) comes back. One PASS/FAIL line
per link; the secret token in the link is never printed. Exit code 1 if any link fails.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from urllib.parse import urlsplit

from fastmcp import Client

REQUIRED_TOOLS = {"whoami", "search", "read_note"}


def secret_of(link: str) -> str:
    parts = [part for part in urlsplit(link).path.split("/") if part]
    return parts[0] if len(parts) >= 2 and parts[-1] == "mcp" else ""


def label_of(link: str) -> str:
    parsed = urlsplit(link)
    return f"{parsed.netloc}/***/mcp" if secret_of(link) else f"{parsed.netloc}{parsed.path}"


def scrub(text: str, link: str) -> str:
    secret = secret_of(link)
    return text.replace(secret, "***") if secret else text


def data_of(result) -> object:
    """Tool result as plain data: structured content if present, else parsed or raw text."""
    structured = getattr(result, "structured_content", None)
    if structured is not None:
        return structured.get("result", structured) if isinstance(structured, dict) else structured
    text = "\n".join(getattr(item, "text", str(item)) for item in getattr(result, "content", []) or [])
    try:
        return json.loads(text)
    except ValueError:
        return text


async def call(client: Client, tool: str, args: dict) -> object:
    try:
        return data_of(await client.call_tool(tool, args))
    except Exception as exc:  # a refusal from the server counts as "nothing came back"
        return {"error": f"{type(exc).__name__}: {exc}"}


def search_leaks(result: object, forbidden: str) -> bool:
    """True if a search answer names the forbidden note by id, title or anywhere in its text."""
    return forbidden.casefold() in json.dumps(result, default=str).casefold()


def read_leaks(result: object) -> bool:
    """True if read_note returned a note instead of a plain error."""
    return not (isinstance(result, dict) and set(result) == {"error"})


async def probe(link: str, query: str, forbidden: list[str]) -> tuple[bool, str]:
    async with Client(link) as client:
        tools = {tool.name for tool in await client.list_tools()}
        missing = REQUIRED_TOOLS - tools
        if missing:
            return False, f"missing tools {sorted(missing)}"
        who = await call(client, "whoami", {})
        if not isinstance(who, dict) or "id" not in who:
            return False, f"whoami failed: {str(who)[:80]}"
        found = await call(client, "search", {"query": query})
        if not isinstance(found, dict) or "hits" not in found:
            return False, f"search failed: {str(found)[:80]}"
        summary = f"{who['id']}: {len(tools)} tools, search '{query}' -> {len(found['hits'])} hits"
        for item in forbidden:
            if search_leaks(await call(client, "search", {"query": item}), item):
                return False, f"{summary}; LEAK in search for forbidden '{item}'"
            if read_leaks(await call(client, "read_note", {"id": item})):
                return False, f"{summary}; LEAK in read_note for forbidden '{item}'"
        if forbidden:
            summary += f"; {len(forbidden)} forbidden note(s) not reachable"
        return True, summary


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("links", nargs="+", help="per-person MCP links (http(s)://host/<token>/mcp)")
    parser.add_argument("--query", default="company", help="search used for the basic check")
    parser.add_argument("--forbidden", action="append", default=[],
                        help="note id or title this link must not reach (repeatable)")
    args = parser.parse_args()
    failed = 0
    for link in args.links:
        try:
            ok, detail = await probe(link, args.query, args.forbidden)
        except Exception as exc:
            ok, detail = False, f"cannot connect: {type(exc).__name__}: {exc}"
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'} {label_of(link)} {scrub(detail, link)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
