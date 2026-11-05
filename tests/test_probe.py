"""The probe script must never print a person's token and must flag leaks."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "probe", Path(__file__).resolve().parent.parent / "scripts" / "probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

LINK = "https://abc.trycloudflare.com/secret-token-1/mcp"


def test_token_is_hidden():
    assert probe.secret_of(LINK) == "secret-token-1"
    assert "secret-token-1" not in probe.label_of(LINK)
    assert "secret-token-1" not in probe.scrub(f"failed for {LINK}", LINK)


def test_leak_checks():
    assert probe.search_leaks({"hits": [{"id": "board-minutes"}], "hints": []}, "Board-Minutes")
    assert not probe.search_leaks({"hits": [], "hints": []}, "board-minutes")
    assert not probe.read_leaks({"error": "Note not found"})
    assert probe.read_leaks({"id": "board-minutes", "body": "secret"})
