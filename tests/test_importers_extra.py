import zipfile

import pytest

from brain.intake.cli import main
from brain.intake.registry import import_path

PEOPLE = {"people": {"maya": "Maya Lin", "raj": "Raj Patel"}}

VTT = """﻿WEBVTT

NOTE this is a comment

intro
00:00:01.000 --> 00:00:03.500 align:start
<v Maya Lin>Welcome everyone, let's start.</v>

00:00:04.000 --> 00:00:06.000
<v.loud Raj Patel>Pricing is <i>still</i> open &amp; undecided.</v>

00:01:05.250 --> 00:01:07.000
<b></b>

01:02:03.000 --> 01:02:05.000
<v Maya Lin>Thanks all.</v>
<v Raj Patel>Bye.</v>
"""

SRT = """1
00:00:01,000 --> 00:00:02,000
Maya Lin: Kickoff is Monday.

2
00:00:03,000 --> 00:00:04,000
Raj Patel: Agreed.
"""


def test_vtt_voices_become_speaker_lines_and_allow(tmp_path):
    path = tmp_path / "standup 2026-11-03.vtt"
    path.write_text(VTT, encoding="utf-8")
    env = import_path(path, {**PEOPLE, "area": "core"})[0]
    assert env.body.splitlines() == [
        "[00:00:01] Maya Lin: Welcome everyone, let's start.",
        "[00:00:04] Raj Patel: Pricing is still open & undecided.",
        "[01:02:03] Maya Lin: Thanks all. Raj Patel: Bye.",
    ]
    assert (env.type, env.source_type, env.access, env.date) == ("meeting", "vtt", "restricted", "2026-11-03")
    assert env.allow == ["maya", "raj"]


def test_srt_inline_speakers_and_cp1252(tmp_path):
    path = tmp_path / "call.srt"
    path.write_bytes(SRT.replace("Kickoff", "Café kickoff").encode("cp1252"))
    env = import_path(path, PEOPLE)[0]
    assert env.body.splitlines()[0] == "[00:00:01] Maya Lin: Café kickoff is Monday."
    assert env.allow == ["maya", "raj"]
    assert import_path(path, {**PEOPLE, "access": "all"})[0].access == "all"


def test_captions_without_cues_are_skipped(tmp_path):
    path = tmp_path / "empty.vtt"
    path.write_text("WEBVTT\n\nNOTE nothing here\n")
    skipped = []
    assert import_path(path, {}, skipped=skipped) == []
    assert "no caption cues" in skipped[0]


def test_html_title_text_and_dropped_markup(tmp_path):
    path = tmp_path / "page.htm"
    path.write_text(
        "<html><head><title> Pricing &amp; Plans </title><style>p{color:red}</style></head>"
        "<body><script>alert('x')</script><h1>Plans</h1><p>Starter is <b>EUR 10</b></p>"
        "<ul><li>One seat</li><li>Email support</li></ul><embed src=x><p>After embed</p></body></html>",
        encoding="utf-8")
    env = import_path(path, {"area": "core", "access": "all"})[0]
    assert env.title == "Pricing & Plans"
    assert env.body.splitlines() == ["Plans", "Starter is EUR 10", "One seat", "Email support", "After embed"]
    assert env.source_type == "htm"
    assert "alert" not in env.body and "color" not in env.body


def test_html_without_title_uses_filename_and_empty_page_is_skipped(tmp_path):
    page = tmp_path / "notes.html"
    page.write_text("<p>Just text</p>")
    assert import_path(page, {})[0].title == "notes"
    blank = tmp_path / "blank.html"
    blank.write_text("<html><script>1</script></html>")
    skipped = []
    assert import_path(blank, {}, skipped=skipped) == []
    assert len(skipped) == 1


def _para(*runs):
    return "<a:p>" + "".join(f"<a:r><a:t>{r}</a:t></a:r>" for r in runs) + "</a:p>"


def _slide(*paras):
    return ('<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>'
            f'<p:sp><p:txBody>{"".join(paras)}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>')


NOTES = ('<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
         'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>'
         '<p:sp><p:nvSpPr><p:cNvPr id="2" name="n"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr>'
         '<p:txBody><a:p><a:r><a:t>IMAGE</a:t></a:r></a:p></p:txBody></p:sp>'
         '<p:sp><p:nvSpPr><p:cNvPr id="3" name="n"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
         '<p:txBody><a:p><a:r><a:t>Mention the pilot</a:t></a:r></a:p></p:txBody></p:sp>'
         '</p:spTree></p:cSld></p:notes>')

RELS = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="x/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>')

CORE = ('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">'
        '<dc:title>Q4 Board Update</dc:title><dc:creator>Maya Lin</dc:creator>'
        '<dcterms:created>2026-10-30T09:00:00Z</dcterms:created></cp:coreProperties>')


def _make_pptx(path, slides, extra=None):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, xml in slides.items():
            z.writestr(name, xml)
        for name, xml in (extra or {}).items():
            z.writestr(name, xml)
    return path


def test_pptx_numeric_order_text_notes_and_core_properties(tmp_path):
    path = _make_pptx(tmp_path / "board.pptx", {
        "ppt/slides/slide10.xml": _slide(_para("Ten")),
        "ppt/slides/slide2.xml": _slide(_para("Revenue ", "up 12%"), _para("Churn flat")),
        "ppt/slides/slide1.xml": _slide(_para("Q4 Board Update")),
    }, {"ppt/slides/_rels/slide1.xml.rels": RELS, "ppt/notesSlides/notesSlide1.xml": NOTES,
        "docProps/core.xml": CORE})
    env = import_path(path, {**PEOPLE, "area": "core", "access": "all"})[0]
    assert env.body == ("## Slide 1\n\nQ4 Board Update\n\nNotes:\nMention the pilot\n\n"
                        "## Slide 2\n\nRevenue up 12%\nChurn flat\n\n## Slide 10\n\nTen\n")
    assert (env.title, env.author, env.date, env.source_type) == ("Q4 Board Update", "maya", "2026-10-30", "pptx")


def test_pptx_bad_packages_are_skipped(tmp_path):
    notzip = tmp_path / "broken.pptx"
    notzip.write_text("not a zip")
    noslides = _make_pptx(tmp_path / "empty.pptx", {"docProps/core.xml": CORE})
    entity = _make_pptx(tmp_path / "evil.pptx", {
        "ppt/slides/slide1.xml": '<!DOCTYPE x [<!ENTITY a "b">]>' + _slide(_para("&a;"))})
    unsafe = _make_pptx(tmp_path / "unsafe.pptx", {
        "ppt/slides/slide1.xml": _slide(_para("x")), "ppt/../../evil.xml": "x"})
    for path in (notzip, noslides, entity, unsafe):
        skipped = []
        assert import_path(path, {}, skipped=skipped) == [], path.name
        assert len(skipped) == 1, path.name


def test_cli_import_and_validate_on_extra_formats(tmp_path, capsys):
    src, data = tmp_path / "src", tmp_path / "data"
    src.mkdir()
    data.mkdir()
    (data / "policy.yaml").write_text(
        "company: {id: co, name: Co}\n"
        "people: {maya: {name: Maya Lin}, raj: {name: Raj Patel}}\n"
        "areas: {test: {name: Test, owner: maya, readers: everyone}}\n")
    (src / "standup.vtt").write_text(VTT, encoding="utf-8")
    (src / "call.srt").write_text(SRT, encoding="utf-8")
    (src / "page.html").write_text("<title>FAQ</title><p>Refunds take 5 days</p>", encoding="utf-8")
    _make_pptx(src / "deck.pptx", {"ppt/slides/slide1.xml": _slide(_para("Hello deck"))})
    assert main(["import", str(src), "--data", str(data), "--area", "test", "--access", "all"]) == 0
    out = capsys.readouterr().out
    assert "Imported 4 note(s)" in out and "Skipped 0 file(s)" in out
    assert len(list((data / "test").glob("*.md"))) == 4
    assert "allow:\n- maya\n- raj" in (data / "test" / "standup.md").read_text()
    assert main(["validate", "--data", str(data)]) == 0
    assert "Validation: 0 problem(s)" in capsys.readouterr().out
