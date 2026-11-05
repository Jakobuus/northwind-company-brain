"""Command line entry point for document intake and validation."""
from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path
import yaml

from .registry import formats, import_path
from .validate import validate
from .write import write_note


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("formats")
    imp = sub.add_parser("import")
    imp.add_argument("src", type=Path)
    imp.add_argument("--data", type=Path, required=True)
    imp.add_argument("--area")
    imp.add_argument("--access")
    imp.add_argument("--author")
    imp.add_argument("--allow", action="append")
    imp.add_argument("--personal", metavar="PERSON_ID", help="Import as a private note in this person's personal area")
    check = sub.add_parser("validate")
    check.add_argument("--data", type=Path, required=True)
    check.add_argument("--policy", type=Path)
    args = parser.parse_args(argv)
    if args.command == "formats":
        for suffix, module in formats():
            print(f"{suffix}\t{module}")
        print("other\tbest effort text; binary files skipped")
        return 0
    if args.command == "import":
        if not args.src.exists():
            parser.error(f"Source does not exist: {args.src}")
        defaults = vars(args).copy()
        policy_path = args.data / "policy.yaml"
        if policy_path.is_file():
            policy = yaml.safe_load(policy_path.read_text(encoding="utf-8")) or {}
            defaults["people"] = {pid: value.get("name", "") for pid, value in
                                  (policy.get("people") or {}).items() if isinstance(value, dict)}
        if args.personal:
            if args.personal not in defaults.get("people", {}):
                parser.error(f"Unknown personal person: {args.personal}")
            defaults.update(author=args.personal, area=f"personal-{args.personal}",
                            access="private", allow=[])
        skipped: list[str] = []
        envelopes = import_path(args.src, defaults, skipped=skipped)
        if args.personal:
            envelopes = [replace(env, author=args.personal, area=f"personal-{args.personal}",
                                 access="private", allow=[]) for env in envelopes]
        paths = [write_note(env, args.data) for env in envelopes]
        print(f"Imported {len(paths)} note(s) into {args.data}")
        for warning in skipped:
            print(f"Warning: {warning}")
        print(f"Skipped {len(skipped)} file(s)")
        return 0
    problems = validate(args.data, args.policy or args.data / "policy.yaml")
    if (args.data / "policy.yaml").is_file() and not any(
            problem.startswith("Invalid policy:") for problem in problems):
        from brain.store import load
        for warning in load(args.data).warnings:
            print(f"Warning: {warning}")
    for problem in problems:
        print(problem)
    print(f"Validation: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
