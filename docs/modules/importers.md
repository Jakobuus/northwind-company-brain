# Intake importers

`python -m brain.intake.cli import SOURCE --data DATA` walks a file or directory in sorted order. The registry chooses an importer by suffix, then MIME type. Each importer returns `Envelope` records; the CLI writes one Markdown note per record. Unknown files get a text fallback (UTF-8, then Latin-1). On macOS, RTF, DOC, and Pages files first go through `textutil`. Binary or empty files are skipped and listed after the import count. Run `python -m brain.intake.cli formats` to see registered formats.

To add a format:

1. Create `brain/intake/importers/<name>.py` with `load(path: Path, defaults: dict) -> list[Envelope]`. Use `common.envelope` for metadata and body.
2. Import the module in `brain/intake/registry.py` and register `load` with `register(".suffix", mimes=("type/subtype",))`. Use a unique suffix and MIME type.
3. Add a test with a tiny generated sample. Check the body and relevant metadata.
4. Run `uv run pytest -q`, then import and validate the supplied real files. Report imported, skipped, and validation counts.

The fallback is a safety net for readable text, not a parser for a structured format. Keep source files unchanged. Imported notes use the existing `brain/intake/write.py` path confinement.
