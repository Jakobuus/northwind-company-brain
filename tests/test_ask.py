import json

from brain.ask import ask
from test_search import assert_no_intern_leak, company  # noqa: F401


def test_ask_private_decision_is_view_specific(company):
    ceo = ask(company, "maya", "SMB strategy")
    intern = ask(company, "lena", "SMB strategy")
    assert ceo["resolutions"][0]["winner"]["id"] == "exec-smb-decision"
    assert ceo["resolutions"][0]["conflicts"][0]["challenger"] == "intern-smb-remark"
    assert intern["resolutions"][0]["winner"]["id"] == "intern-smb-remark"
    assert intern["resolutions"][0]["conflicts"] == []
    assert intern["hints"] and "Maya Lin" in intern["hints"][0]
    assert all(hint not in intern["summary"] for hint in intern["hints"])
    assert_no_intern_leak(company, intern)


def test_ask_replacement_and_observation(company):
    target = ask(company, "raj", "EMEA Q4 target")
    resolution = next(r for r in target["resolutions"] if r["key"] == ["emea", "q4-target"])
    assert resolution["winner"]["id"] == "lead-sales-target"
    assert resolution["superseded"][0]["id"] == "ceo-sales-target"
    observed = ask(company, "lena", "signup count")
    resolution = next(r for r in observed["resolutions"] if r["key"] == ["signup", "count"])
    assert resolution["winner"]["id"] == "new-observation"
    assert "145 signups" in observed["summary"]
    assert_no_intern_leak(company, observed)


def test_ask_json_has_no_hidden_data_for_all_scenarios(company):
    company.notes["exec-smb-decision"].body += " Unlisted phrase velvet comet."
    for question in ("SMB strategy", "EMEA Q4 target", "signup count"):
        packet = ask(company, "lena", question)
        assert_no_intern_leak(company, packet)
        assert "velvet comet" not in json.dumps(packet)


def test_ask_hint_preserves_policy_topic_case_without_summary_duplication(company):
    company.policy.areas["leadership"].topics = ["SMB Strategy"]
    packet = ask(company, "lena", "smb strategy")
    assert len(packet["hints"]) == 1
    assert "SMB Strategy" in packet["hints"][0]
    assert packet["hints"][0] not in packet["summary"]
