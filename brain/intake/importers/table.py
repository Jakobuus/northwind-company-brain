from __future__ import annotations

import csv
from pathlib import Path
from openpyxl import load_workbook

from .common import envelope


def _cell(value: object) -> str:
    return str(value if value is not None else "").replace("|", "\\|").replace("\n", "<br>")


def _table(rows: list[list]) -> str:
    if not rows:
        return ""
    width = max(map(len, rows))
    def line(row: list) -> str:
        return "| " + " | ".join(_cell(row[i] if i < len(row) else "") for i in range(width)) + " |"
    shown = rows[:501]  # header plus 500 data rows
    body = "\n".join([line(shown[0]), line(["---"] * width), *(line(row) for row in shown[1:])])
    if len(rows) > 501:
        body += f"\n\nTruncated: showing 500 of {len(rows) - 1} data rows."
    return body


def load(path: Path, defaults: dict) -> list:
    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.reader(stream))
        return [envelope(path, defaults, _table(rows))]
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        return [envelope(path, defaults, _table([list(row) for row in sheet.values]),
                         title=f"{path.stem} - {sheet.title}", suffix=f"-{sheet.title}")
                for sheet in workbook.worksheets]
    finally:
        workbook.close()
