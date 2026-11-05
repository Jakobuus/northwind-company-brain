from datetime import date
import yaml

from brain.store import dump_note, load, parse_note


def test_parse_dump_round_trip(tmp_path):
    path = tmp_path / "memo.md"
    path.write_text("""---
type: fact
area: sales
date: 2026-10-30
allow: [raj]
custom: {source_kind: meeting}
---
Body [[first|alias]], [[second#section]], and [[third]].
""")
    note = parse_note(path)
    assert note.id == note.title == "memo"
    assert note.date == date(2026, 10, 30)
    assert note.links == ["first", "second", "third"]
    assert note.extra == {"custom": {"source_kind": "meeting"}}
    path.write_text(dump_note(note))
    assert parse_note(path) == note


def test_load_skips_bad_frontmatter_and_dot_dirs_and_duplicate_ids(tmp_path):
    (tmp_path / "policy.yaml").write_text("""company: {id: tiny, name: Tiny}
people: {}
areas: {}
""")
    (tmp_path / "a.md").write_text("---\nid: same\n---\nFirst")
    (tmp_path / "b.md").write_text("---\nid: same\n---\nSecond")
    (tmp_path / "bad.md").write_text("---\nfoo: [\n---\nBad")
    hidden = tmp_path / ".hidden"
    hidden.mkdir()
    (hidden / "secret.md").write_text("---\nid: hidden\n---\n")
    brain = load(tmp_path)
    assert list(brain.notes) == ["same"]
    assert brain.notes["same"].body == "First"
    assert len(brain.warnings) == 2
    assert any("bad.md" in warning for warning in brain.warnings)
    assert any("Duplicate id same" in warning for warning in brain.warnings)


def test_timestamp_dates_and_wikilink_targets_round_trip(tmp_path):
    path = tmp_path / "item.md"
    for raw in ("2026-10-30T10:00:00", "'2026-10-30'", "'2026-10-30T10:00:00'"):
        path.write_text(f"---\ndate: {raw}\n---\n[[#Heading]] [[a/b|alias]] [[plain#H]]")
        note = parse_note(path)
        assert note.date == date(2026, 10, 30)
        assert note.links == ["b", "plain"]
        path.write_text(dump_note(note))
        assert parse_note(path).date == note.date


def test_policy_defaults_and_bad_entries_warn(tmp_path):
    (tmp_path / "policy.yaml").write_text(yaml.safe_dump({
        "company": {"id": "x", "name": "X", "extra": "ignored"},
        "extra": "ignored",
        "people": {"maya": {"name": "Maya", "email": "private@example.com"},
                   "bad": {"name": "Bad", "rank": "high"}, "also_bad": 4},
        "areas": {"core": {"name": "Core", "owner": "maya"},
                  "bad": {"name": "Bad", "topics": "strategy"}}}))
    brain = load(tmp_path)
    assert brain.policy.people["maya"].groups == []
    assert brain.policy.people["maya"].rank == 0
    assert brain.policy.people["maya"].title == ""
    assert brain.policy.areas["core"].topics == []
    assert set(brain.policy.people) == {"maya"}
    assert set(brain.policy.areas) == {"core", "personal-maya"}
    assert any("unknown" in warning for warning in brain.warnings)
    assert any("Invalid" in warning for warning in brain.warnings)


def test_load_only_skips_generated_readme_and_top_level_templates(tmp_path):
    (tmp_path / "policy.yaml").write_text("company: {id: co, name: Co}\npeople: {}\nareas: {}\n")
    (tmp_path / "README.md").write_text("---\nid: onboarding\n---\nWelcome\n")
    nested = tmp_path / "sub" / "_templates"
    nested.mkdir(parents=True)
    (nested / "real.md").write_text("---\nid: realnote\n---\nBody\n")
    (tmp_path / "_templates").mkdir()
    (tmp_path / "_templates" / "generated.md").write_text("---\nid: template\n---\n")
    assert set(load(tmp_path).notes) == {"onboarding", "realnote"}
