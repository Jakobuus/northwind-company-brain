from pathlib import Path
import json

import pytest
import yaml
from docx import Document
from openpyxl import Workbook

from brain.intake.envelope import Envelope, slugify
from brain.intake.registry import import_path
from brain.intake.write import write_note
from brain.intake.validate import validate
from brain.intake.cli import main


def _env(**changes):
    values = dict(id="Hello World", source_type="md", source_uri="source.md", title="Hello",
                  author="maya", date="2026-11-04", area="core", access="all", allow=[], body="Body\n")
    values.update(changes)
    return Envelope(**values)


def test_slug_and_confined_writer(tmp_path):
    root = tmp_path / "data"
    decoy = tmp_path / "decoy.md"
    decoy.write_text("untouched")
    assert slugify("../../etc") == "etc"
    assert slugify("///") == "untitled"
    assert len(slugify("a" * 100)) == 80
    first = write_note(_env(id="../../etc"), root)
    assert first == root / "core" / "etc.md"
    assert write_note(_env(id="../../etc"), root) == first
    second = write_note(_env(id="../../etc", body="Different"), root)
    assert second.name == "etc-2.md"
    for area in ("../../etc", "/tmp/escape", "core/../outside"):
        with pytest.raises(ValueError):
            write_note(_env(area=area), root)
    assert decoy.read_text() == "untouched"


def test_markdown_dates_and_frontmatter(tmp_path):
    path = tmp_path / "memo.md"
    path.write_text("---\nid: old-id\ntitle: Original\narea: sales\ncustom: yes\ndate: 04/11/2026\n---\nExact body\n")
    env = import_path(path, {"area": "core", "access": "all"})[0]
    assert (env.id, env.title, env.area, env.date, env.body) == (
        "old-id", "Original", "core", "2026-11-04", "Exact body\n")
    output = write_note(env, tmp_path / "data")
    assert "custom: true" in output.read_text()
    dated = tmp_path / "meeting-November 4, 2026.txt"
    dated.write_text("Notes")
    assert import_path(dated, {})[0].date == "2026-11-04"


def test_structured_importers(tmp_path):
    csv = tmp_path / "rows.csv"
    csv.write_text("name,amount\nA,1\nB,2\n")
    assert "| A | 1 |" in import_path(csv, {})[0].body
    workbook = Workbook()
    workbook.active.title = "North"
    workbook.active.append(["name", "amount"])
    workbook.active.append(["A", 1])
    workbook.create_sheet("South").append(["name", "amount"])
    xlsx = tmp_path / "rows.xlsx"
    workbook.save(xlsx)
    assert len(import_path(xlsx, {})) == 2
    doc = Document()
    doc.add_paragraph("A paragraph")
    docx = tmp_path / "note.docx"
    doc.save(docx)
    assert "A paragraph" in import_path(docx, {})[0].body
    records = tmp_path / "records.jsonl"
    records.write_text('{"title":"One","text":"First"}\n{"title":"Two","text":"Second"}\n')
    assert [e.body for e in import_path(records, {})] == ["First", "Second"]
    raw = tmp_path / "raw.json"
    raw.write_text(json.dumps({"key": 1}))
    assert '"key": 1' in import_path(raw, {})[0].body
    transcript = tmp_path / "call.transcript"
    transcript.write_text("[00:01] Maya Lin: Hello\nRaj Patel: Hi\nMaya Lin: Bye\n")
    meeting = import_path(transcript, {"people": {"maya": "Maya Lin", "raj": "Raj Patel"}})[0]
    assert meeting.type == "meeting"
    assert meeting.allow == ["maya", "raj"]
    txt = tmp_path / "call.txt"
    txt.write_text("Maya Lin: Hello\nRaj Patel: Hi\n")
    assert import_path(txt, {})[0].type == "document"


def test_table_cap(tmp_path):
    path = tmp_path / "large.csv"
    path.write_text("item\n" + "".join(f"{i}\n" for i in range(502)))
    body = import_path(path, {})[0].body
    assert "| 499 |" in body and "| 500 |" not in body
    assert "showing 500 of 502" in body


def test_validator(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    policy = root / "policy.yaml"
    policy.write_text(yaml.safe_dump({"people": {"maya": {}}, "areas": {"core": {}}}))
    write_note(_env(id="source"), root)
    fact = root / "core" / "bad.md"
    fact.write_text("---\nid: source\ntype: fact\narea: wrong\naccess: secret\nauthor: nobody\nallow: [stranger]\nclaim: magic\nweight: huge\nsource: missing\nreplaces: [missing]\n---\nquote\n")
    problems = "\n".join(validate(root, policy))
    for term in ("duplicate id", "unknown area", "unknown access", "unknown author",
                 "unknown allowed person", "unknown claim", "unknown weight", "unknown source",
                 "unknown replaces", "missing date", "missing subject", "missing attribute", "missing value"):
        assert term in problems


def test_pdf(tmp_path):
    reportlab = pytest.importorskip("reportlab.pdfgen.canvas")
    path = tmp_path / "memo.pdf"
    canvas = reportlab.Canvas(str(path))
    canvas.drawString(50, 750, "PDF words")
    canvas.save()
    assert "PDF words" in import_path(path, {})[0].body


def test_transcript_identity_headers_and_defaults(tmp_path):
    source = tmp_path / "exec.txt"
    source.write_text("To: team\nFrom: Maya\nSubject: plan\nAgenda: budget\nDate: today\n"
                      "[00:01] Maya Lin: Start\n00:01:02 Raj: Yes\nLENA: Maybe\n"
                      "Unknown Guest: Here\nMaya: Done\n")
    defaults = {"people": {"maya": "Maya Lin", "raj": "Raj Patel", "lena": "Lena Ortiz"},
                "allow": ["observer"]}
    with pytest.warns(UserWarning, match="Unknown speaker"):
        meeting = import_path(source, defaults)[0]
    assert meeting.type == "meeting"
    assert meeting.access == "restricted"
    assert meeting.allow == ["observer", "maya", "raj", "lena"]
    assert "Unknown Guest: Here" in meeting.body
    source.write_text("To: team\nFrom: Maya\nSubject: plan\nAgenda: budget\nDate: today\n")
    assert import_path(source, defaults)[0].type == "document"


def test_operator_metadata_wins_and_unmapped_author_dropped(tmp_path):
    source = tmp_path / "memo.md"
    source.write_text("---\nauthor: Pretend CEO\narea: leadership\naccess: all\nallow: [stranger]\n---\nBody")
    env = import_path(source, {"people": {"maya": "Maya Lin"}, "author": "maya",
                               "area": "core", "access": "restricted", "allow": ["maya"]})[0]
    assert (env.author, env.area, env.access, env.allow) == ("maya", "core", "restricted", ["maya"])
    assert import_path(source, {"people": {"maya": "Maya Lin"}})[0].author is None
    source.write_text("---\nauthor: Maya Lin\n---\nBody")
    assert import_path(source, {"people": {"maya": "Maya Lin"}})[0].author == "maya"


def test_docx_template_date_fallback_and_author_override(tmp_path):
    from datetime import datetime, timezone
    source = tmp_path / "memo-2026-11-04.docx"
    doc = Document()
    doc.add_paragraph("Body")
    doc.core_properties.author = "Template Author"
    doc.core_properties.created = datetime(2013, 1, 1, tzinfo=timezone.utc)
    doc.save(source)
    env = import_path(source, {"author": "maya"})[0]
    assert env.author == "maya" and env.date == "2026-11-04"


def test_validator_ignores_dot_dirs_and_accepts_zero_decision_value(tmp_path):
    root = tmp_path / "data"
    (root / "sales").mkdir(parents=True)
    (root / ".trash").mkdir()
    (root / "policy.yaml").write_text("people: {raj: {}}\nareas: {sales: {}}\n")
    content = "---\nid: zero\ntype: decision\narea: sales\naccess: area\nauthor: raj\nsubject: s\nattribute: a\nvalue: 0\nclaim: decision\n---\n"
    (root / "sales" / "zero.md").write_text(content)
    (root / ".trash" / "broken.md").write_text("bad")
    problems = validate(root, root / "policy.yaml")
    assert len(problems) == 1 and "missing date" in problems[0]


def test_cli_import_preserves_file_metadata_without_flags(tmp_path):
    source = tmp_path / "memo.md"
    source.write_text("---\narea: leadership\naccess: area\nallow: [raj]\nauthor: Raj Patel\n---\nBody")
    root = tmp_path / "data"
    root.mkdir()
    (root / "policy.yaml").write_text("people: {raj: {name: Raj Patel}}\nareas: {leadership: {}}\n")
    assert main(["import", str(source), "--data", str(root)]) == 0
    output = yaml.safe_load((root / "leadership" / "memo.md").read_text().split("---")[1])
    assert (output["area"], output["access"], output["allow"], output["author"]) == (
        "leadership", "area", ["raj"], "raj")
    plain = tmp_path / "plain.md"
    plain.write_text("Body")
    assert main(["import", str(plain), "--data", str(root)]) == 0
    fallback = yaml.safe_load((root / "core" / "plain.md").read_text().split("---")[1])
    assert (fallback["area"], fallback["access"]) == ("core", "area")


def test_cli_validate_prints_loader_warnings(tmp_path, capsys):
    (tmp_path / "policy.yaml").write_text("company: {id: co, name: Co}\npeople: {}\nareas: {core: {name: Core, owner: '', readers: everyone}}\nextra: yes\n")
    assert main(["validate", "--data", str(tmp_path)]) == 0
    assert "Ignored unknown policy key: extra" in capsys.readouterr().out
    from brain.store import load
    assert load(tmp_path).policy.areas["core"].readers == ["everyone"]


def test_unicode_transcript_speaker(tmp_path):
    source = tmp_path / "call.transcript"
    source.write_text("José García: Hola\n")
    env = import_path(source, {"people": {"jose": "José García"}})[0]
    assert env.allow == ["jose"]


def test_directory_import_reports_hidden_files_and_continues_after_decode_error(tmp_path):
    (tmp_path / ".hidden.txt").write_text("private")
    hidden = tmp_path / ".git"
    hidden.mkdir()
    (hidden / "config.txt").write_text("private")
    (tmp_path / "bad.txt").write_bytes(b"caf\xe9")
    (tmp_path / "good.txt").write_text("Public note")
    skipped = []
    notes = import_path(tmp_path, {}, skipped=skipped)
    assert [note.body for note in notes] == ["Public note"]
    assert any(".hidden.txt" in item for item in skipped)
    assert any(".git" in item for item in skipped)
    assert any("bad.txt" in item for item in skipped)
