import json
from pathlib import Path

import pytest

from brain.obsidian import setup
from brain.store import load


def _data(root):
    root.mkdir()
    (root / "policy.yaml").write_text(
        "company: {id: co, name: Co}\n"
        "people: {maya: {name: Maya}}\n"
        "areas: {core: {name: Core, color: '#123456'}, sales: {name: Sales, color: '#abcdef'}}\n"
    )
    return root


def test_refuses_main_and_ancestor_vault(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_PROTECTED_VAULT", str(tmp_path / "Vault"))
    main = _data(tmp_path / "Vault")
    with pytest.raises(ValueError, match="protected vault"):
        setup(main)
    nested = main / "child"
    nested.mkdir()
    with pytest.raises(ValueError, match="protected vault"):
        setup(nested)
    parent = tmp_path / "other"
    (parent / ".obsidian").mkdir(parents=True)
    child = _data(parent / "company")
    with pytest.raises(ValueError, match="already contains .obsidian"):
        setup(child)
    assert not (child / ".obsidian").exists()


def test_files_colors_idempotency_and_force(tmp_path):
    root = _data(tmp_path / "company")
    written, preserved = setup(root)
    assert not preserved
    assert {"app.json", "appearance.json", "graph.json", "core-plugins.json", "templates.json"} <= {
        path.name for path in written}
    graph = json.loads((root / ".obsidian" / "graph.json").read_text())
    assert graph["search"] == "-path:.brain-cache -path:_templates"
    assert {g["query"]: g["color"]["rgb"] for g in graph["colorGroups"]} == {
        "path:core/": 0x123456, "path:sales/": 0xABCDEF,
        "path:personal/maya/": 0x808080}
    assert (root / "_templates" / "fact.md").read_text().startswith("---\nid: template-fact\n")
    assert "File → Open folder as vault" in (root / "README.md").read_text()
    assert setup(root) == ([], [])
    config = root / ".obsidian" / "graph.json"
    config.write_text("custom")
    assert setup(root) == ([], [config])
    assert config.read_text() == "custom"
    assert setup(root, force=True) == ([config], [])
    assert not load(root).warnings
    assert not load(root).notes


def test_refuses_output_symlink_outside_data(tmp_path):
    root = _data(tmp_path / "company")
    external = tmp_path / "external"
    external.mkdir()
    (root / ".obsidian").symlink_to(external, target_is_directory=True)
    with pytest.raises(ValueError, match="resolves outside"):
        setup(root)
    assert not list(external.iterdir())


def test_refuses_case_variant_main_vault_and_unmarked_vault(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_PROTECTED_VAULT", str(tmp_path / "Vault"))
    _data(tmp_path / "Vault")
    sibling = tmp_path / "vault"
    with pytest.raises(ValueError, match="protected vault"):
        setup(sibling, force=True)
    other = _data(tmp_path / "other")
    (other / ".obsidian").mkdir()
    with pytest.raises(ValueError, match="already contains .obsidian"):
        setup(other, force=True)
    assert not (other / ".obsidian" / "brain-kit.json").exists()


def test_setup_preserves_unrelated_readme_even_with_force(tmp_path):
    root = _data(tmp_path / "company")
    readme = root / "README.md"
    original = "---\nid: onboarding\n---\nKeep this note.\n"
    readme.write_text(original)
    written, preserved = setup(root, force=True)
    assert readme not in written and readme in preserved
    assert readme.read_text() == original
    assert (root / ".obsidian" / "brain-kit.json").exists()
