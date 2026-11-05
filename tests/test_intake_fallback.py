from pathlib import Path

from brain.intake.cli import main
from brain.intake.registry import import_path, register


def test_fallback_text_latin1_and_binary(tmp_path):
    utf = tmp_path / "memo.odd"
    utf.write_text("Useful words é\n")
    assert import_path(utf, {})[0].body == "Useful words é\n"
    latin = tmp_path / "legacy.xyz"
    latin.write_bytes("Café notes".encode("latin-1"))
    assert import_path(latin, {})[0].body == "Café notes"
    binary = tmp_path / "image.unknown"
    binary.write_bytes(b"\x89PNG\0\x01\x02")
    skipped = []
    assert import_path(binary, {}, skipped=skipped) == []
    assert str(binary) in skipped[0]


def test_directory_reports_all_skips_at_end(tmp_path, capsys):
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.bin").write_bytes(b"\0data")
    (source / "b.bin").write_bytes(b"\1\2\3\4")
    (source / "c.weird").write_text("Readable")
    assert main(["import", str(source), "--data", str(tmp_path / "data")]) == 0
    output = capsys.readouterr().out
    assert "Imported 1 note(s)" in output
    assert "a.bin" in output and "b.bin" in output
    assert output.index("Imported") < output.index("a.bin") < output.index("Skipped 2 file(s)")


def test_formats_and_registration(tmp_path, capsys):
    assert main(["formats"]) == 0
    assert ".pdf" in capsys.readouterr().out

    @register(".sampleformat", mimes=("application/x-sampleformat",))
    def sample(path, defaults):
        return [path.name]

    path = tmp_path / "test.sampleformat"
    path.write_text("x")
    assert import_path(path, {}) == ["test.sampleformat"]
