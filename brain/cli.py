"""Command line entry points for the company brain."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import yaml

import uvicorn

from . import ask, embed, obsidian, precedence, store
from .server import build_server


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m brain.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("serve", "ask", "links", "status", "obsidian"):
        command = commands.add_parser(name)
        command.add_argument("--data", type=Path, required=(name != "serve"))
        if name == "serve":
            command.add_argument("--root", type=Path, help="multi-company platform mode: one dir per org "
                                 "(needs env BRAIN_SERVICE_TOKEN); default env BRAIN_ROOT when --data is absent")
        if name in ("serve", "links"):
            command.add_argument("--port", type=int, default=8000)
        if name == "serve":
            command.description = ("Demo mode is on by default: person query parameters and graph ghosts "
                                   "are available. Set BRAIN_DEMO=0 to disable them.")
            command.add_argument("--host", default="127.0.0.1")
        if name == "ask":
            command.add_argument("--person", required=True)
            command.add_argument("question")
        if name == "obsidian":
            command.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.command == "obsidian":
        try:
            written, preserved = obsidian.setup(args.data, force=args.force)
        except (OSError, ValueError, yaml.YAMLError) as exc:
            parser.error(str(exc))
        for path in written:
            print(f"Wrote {path}")
        for path in preserved:
            print(f"Preserved user-changed file {path} (use --force to overwrite)")
        return
    if args.command == "serve" and args.data is None:
        root = args.root or (Path(os.environ["BRAIN_ROOT"]) if os.getenv("BRAIN_ROOT") else None)
        if root is None:
            parser.error("serve needs --data <dir> or --root <dir>")
        secret = os.getenv("BRAIN_SERVICE_TOKEN", "")
        if len(secret) < 16:
            parser.error("root mode needs env BRAIN_SERVICE_TOKEN (at least 16 characters)")
        from .platform import build_platform_app
        os.environ.setdefault("BRAIN_BASE_URL", f"http://localhost:{args.port}")
        uvicorn.run(build_platform_app(root, secret), host=args.host, port=args.port, access_log=False)
        return
    if args.command == "serve":
        os.environ.setdefault("BRAIN_BASE_URL", f"http://localhost:{args.port}")
        server = build_server(args.data, auto_index=True)
        uvicorn.run(server.brain_app, host=args.host, port=args.port, access_log=False)  # request lines hold the token
        return
    brain = store.load(args.data)
    if args.command == "ask":
        embed.ensure_index(brain)
        if args.person not in brain.policy.people:
            parser.error("unknown person")
        packet = ask.ask(brain, args.person, args.question)
        print(packet["summary"])
        for hint in packet["hints"]:
            print(f"Hint: {hint}")
        for hit in packet["hits"]:
            print(f"- {hit['title']} ({hit['date'] or 'undated'}; {hit['id']})")
    elif args.command == "links":
        for token, person in brain.policy.tokens.items():
            print(f"{person}: http://localhost:{args.port}/{token}/mcp")
    else:
        conflicts = [conflict for person in brain.policy.people
                     for resolution in precedence.resolve_for(brain, person)
                     for conflict in resolution.conflicts]
        unique = {(conflict.winner, conflict.challenger) for conflict in conflicts}
        print(f"People: {len(brain.policy.people)}")
        print(f"Areas: {len(brain.policy.areas)}")
        print(f"Notes: {len(brain.notes)}")
        print(f"Warnings: {len(brain.warnings)}")
        for warning in brain.warnings:
            print(f"- {warning}")
        print(f"Conflicts: {len(unique)}")


if __name__ == "__main__":
    main()
