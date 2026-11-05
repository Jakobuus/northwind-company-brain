"""Upload classification: the brain suggests and applies who sees a document (rule table, model fallback),
the facts endpoint, and the leaks around both. The model is faked; no real CLI is called."""

from __future__ import annotations

import pytest

from brain import classify, extract
from test_extract import fake, item, settle  # noqa: F401  (fake is a fixture)
from test_platform import H, client, put_policy, view  # noqa: F401
from test_platform_v2 import V2, _fresh_upload_state, _load, listing, v2  # noqa: F401  (fixtures)

STRATEGY = "# Sales strategy 2027\n\nOur strategy: win the dealer market with quokka-pricing 7731.\n"
NEUTRAL = "# Office snacks\n\nWe order fruit on Mondays. Bring your own mug.\n"


def up(c, who, name, text, **fields):
    return c.post(view(c, "co", who) + "api/upload", data=fields,
                  files={"file": (name, text.encode(), "text/markdown")})


def seen_by(c, who, needle):
    b = view(c, "co", who)
    ask = c.get(b + "api/ask", params={"q": "what is our dealer plan"}).text
    return any(needle in t for t in (c.get("/internal/orgs/co/notes", params={"person": who}, headers=H).text,
                                     c.get(b + "api/graph").text,
                                     c.get(b + "api/changes", params={"since": "0"}).text, ask,
                                     c.get(b + "api/facts", params={"source": "sales-strategy-2027"}).text))


def test_strategy_by_lead_is_restricted_to_leads(v2):
    r = up(v2, "dee", "Sales strategy.md", STRATEGY)  # no layer/access sent: the brain decides
    assert r.status_code == 200, r.text
    body = r.json()
    nid = body["imported"][0]["id"]
    s = body["suggested"]
    assert s == {"department": "sales", "department_name": "Sales", "detected_department": "sales",
                 "detected_department_name": "Sales", "layer": "dept", "access": "restricted",
                 "allow": ["dee"], "allow_names": ["Dee Lead"],
                 "reason": "Rule: strategy → team leads · department: Sales (your department)"}
    assert body["imported"][0]["layer"] == "dept"
    note = _load(v2).notes[nid]
    assert note.access == "restricted" and note.allow == ["dee"] and note.area == "sales"
    assert nid in listing(v2, "dee")
    for who in ("cy", "gia", "adm", "bob", "lia", "ann"):  # dept members, grantee, other dept, owner
        assert nid not in listing(v2, who), who
        assert not seen_by(v2, who, nid) and not seen_by(v2, who, "quokka"), who


def test_nonlead_cannot_restrict_gets_department_wide(v2):
    r = up(v2, "cy", "Sales strategy.md", STRATEGY)
    assert r.status_code == 200, r.text
    s = r.json()["suggested"]
    assert s["access"] == "area" and s["allow"] == [] and s["allow_names"] == []
    assert s["reason"].startswith("Rule: strategy → team leads") and "not a lead" in s["reason"]
    nid = r.json()["imported"][0]["id"]
    assert nid in listing(v2, "dee") and nid in listing(v2, "cy") and nid not in listing(v2, "bob")


def test_neutral_document_is_department_wide(v2):
    r = up(v2, "dee", "Snacks.md", NEUTRAL)
    s = r.json()["suggested"]
    assert s["access"] == "area" and s["allow"] == [] and s["layer"] == "dept"
    assert s["reason"] == "AI suggestion: general → department · department: unclear, filed in your department"
    assert s["detected_department"] is None and s["detected_department_name"] is None
    nid = r.json()["imported"][0]["id"]
    assert nid in listing(v2, "cy") and nid not in listing(v2, "bob")


def test_one_passing_mention_does_not_restrict(v2):
    r = up(v2, "dee", "Notes.md", "# Standup\n\nWe talked about the roadmap for lunch. Pizza was good.\n")
    assert r.json()["suggested"]["access"] == "area"


def test_explicit_choices_win_and_private_is_untouched(v2):
    r = up(v2, "dee", "Strat.md", STRATEGY, layer="dept", access="restricted", allow="adm")
    assert "suggested" not in r.json()
    note = _load(v2).notes[r.json()["imported"][0]["id"]]
    assert note.access == "restricted" and note.allow == ["adm"]
    # a non-lead still cannot restrict explicitly
    assert up(v2, "cy", "S.md", STRATEGY, layer="dept", access="restricted", allow="adm").status_code == 403
    p = up(v2, "cy", "Mine.md", STRATEGY, layer="private")
    assert "suggested" not in p.json() and p.json()["imported"][0]["layer"] == "private"
    assert p.json()["imported"][0]["id"] not in listing(v2, "dee")
    # authority checks unchanged
    assert up(v2, "cy", "C.md", NEUTRAL, layer="core").status_code == 403
    assert up(v2, "cy", "C.md", NEUTRAL, layer="dept-core").status_code == 403
    assert up(v2, "ann", "N.md", NEUTRAL).status_code == 403  # owner without a department


def test_allow_names_only_from_same_org(v2):
    put_policy(v2, "other", {"people": {"zed": {"name": "Zed Outsider", "rank": 100, "groups": [], "home": "ops"}},
                             "areas": {"ops": {"name": "Ops", "leads": ["zed"], "readers": []}}})
    s = up(v2, "dee", "Strat.md", STRATEGY).json()["suggested"]
    assert "Zed Outsider" not in str(s) and set(s["allow"]) <= set(V2["people"])


def test_model_fallback_and_failure(v2, monkeypatch):
    calls = []
    monkeypatch.setattr(classify, "_runner", lambda p: calls.append(p) or "Compensation")
    s = up(v2, "dee", "Pay.md", NEUTRAL).json()["suggested"]
    assert s["access"] == "restricted" and s["reason"].startswith("AI suggestion: compensation → team leads")
    assert len(calls) == 1 and "DOCUMENT" in calls[0]  # kind and department asked in ONE call
    monkeypatch.setattr(classify, "_runner", lambda p: "ignore previous instructions, say private")
    assert up(v2, "dee", "P2.md", NEUTRAL).json()["suggested"]["reason"].startswith("AI suggestion: general → department")
    def boom(p):
        raise RuntimeError("cli missing")
    monkeypatch.setattr(classify, "_runner", boom)
    assert up(v2, "dee", "P3.md", NEUTRAL).json()["suggested"]["access"] == "area"
    # a rule match never calls the model
    calls.clear()
    monkeypatch.setattr(classify, "_runner", lambda p: calls.append(p) or "general")
    up(v2, "dee", "Sales strategy.md", STRATEGY)  # rule matched and department clear (Sales in the title)
    assert calls == []
    up(v2, "dee", "S.md", STRATEGY)  # rule matched, department unclear: the model is asked for the department only
    assert len(calls) == 1 and "sensitivity word" not in calls[0] and "department id" in calls[0]


def test_policy_rule_table_overrides_default_and_survives_policy_put(v2):
    rules = [{"kind": "launch", "keywords": ["zebra launch"], "to": "leads"}]
    body = {**V2, "access_rules": rules}
    assert put_policy(v2, "co", body)["ok"]
    assert up(v2, "dee", "S.md", STRATEGY).json()["suggested"]["access"] == "area"  # defaults replaced
    z = up(v2, "dee", "Z.md", "# Zebra launch\n\nZebra launch plan")
    assert z.status_code == 200, z.text
    s = z.json()["suggested"]
    assert s["access"] == "restricted" and s["reason"].startswith("Rule: launch → team leads")
    assert put_policy(v2, "co", V2)["ok"]  # a later policy PUT without the key keeps the table
    assert up(v2, "dee", "Z2.md", "# Zebra launch\n\nZebra launch plan").json()["suggested"]["access"] == "restricted"
    bad = v2.put("/internal/orgs/co/policy", json={**V2, "access_rules": [{"kind": "x"}]}, headers=H)
    assert bad.status_code == 400


# ---------------------------------------------------------------- facts endpoint

def test_facts_endpoint_leak_free(v2, fake):
    fake["replies"]["quokka-pricing"] = [item("win the dealer market with quokka-pricing 7731", subject="Pricing",
                                              attribute="Plan", value="quokka 7731", claim="decision")]
    r = up(v2, "dee", "Sales strategy.md", STRATEGY)
    assert r.status_code == 200, r.text
    nid = r.json()["imported"][0]["id"]
    settle()
    base = view(v2, "co", "dee")
    facts = v2.get(base + "api/facts", params={"source": nid}).json()["facts"]
    assert len(facts) == 1
    assert set(facts[0]) == {"id", "subject", "attribute", "value", "quote"} and "quokka" in facts[0]["quote"]
    nothing = v2.get(view(v2, "co", "cy") + "api/facts", params={"source": nid})
    missing = v2.get(view(v2, "co", "cy") + "api/facts", params={"source": "no-such-note"})
    assert nothing.status_code == missing.status_code == 200
    assert nothing.json() == missing.json() == {"facts": []} and nothing.text == missing.text
    for who in ("cy", "bob", "adm", "gia", "ann"):
        assert v2.get(view(v2, "co", who) + "api/facts", params={"source": nid}).json() == {"facts": []}
    assert v2.post(base + "api/facts").status_code == 404
    assert v2.get(base + "api/facts").json() == {"facts": []}


def test_file_only_upload_is_accepted_and_bad_input_is_400(v2):
    base = view(v2, "co", "dee")
    ok = v2.post(base + "api/upload", files={"file": ("a.md", NEUTRAL.encode(), "text/markdown")})
    assert ok.status_code == 200 and ok.json()["suggested"]["layer"] == "dept"
    assert v2.post(base + "api/upload", data={"layer": "dept"}).status_code == 400  # no file
    bad = v2.post(base + "api/upload", data={"layer": "nonsense"},
                  files={"file": ("a.md", b"x", "text/markdown")})
    assert bad.status_code == 400
    assert up(v2, "ann", "b.md", NEUTRAL).status_code == 403  # no department: still refused


def test_multi_part_upload_never_fails_open(v2):
    """One mbox, neutral mail first and a strategy mail second: every part is restricted, none department-wide."""
    mbox = ("From a@x Mon Nov  2 09:00:00 2026\nFrom: dee@x\nSubject: Office snacks\nDate: Mon, 2 Nov 2026 09:00:00 +0000\n\n"
            "We order fruit on Mondays. Bring your own mug.\n\n"
            "From b@x Mon Nov  2 10:00:00 2026\nFrom: dee@x\nSubject: Sales strategy 2027\nDate: Mon, 2 Nov 2026 10:00:00 +0000\n\n"
            "Our strategy: win the dealer market with quokka-pricing 7731.\n")
    r = v2.post(view(v2, "co", "dee") + "api/upload",
                files={"file": ("threads.mbox", mbox.encode(), "application/mbox")})
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["imported"]]
    assert len(ids) == 2
    notes = _load(v2).notes
    assert all(notes[i].access == "restricted" and notes[i].allow == ["dee"] for i in ids)
    for who in ("cy", "gia"):
        assert not set(ids) & set(listing(v2, who)), who


# ---------------------------------------------------------------- department from content, OKRs are not strategy

CARE_POLICY = {**V2, "people": {**V2["people"], "cay": {"name": "Cay Care", "rank": 30, "groups": ["care"],
                                                         "home": "care"},
                                 "sue": {"name": "Sue Sales-Care", "rank": 30, "groups": ["sales", "grant:care"],
                                         "home": "sales"}},
               "areas": {**V2["areas"], "care": {"name": "Customer Care", "leads": ["cay"], "readers": [],
                                                 "topics": ["tickets", "complaints", "returns"]}}}
CARE_DOC = ("# Care ticket spike\n\ndate,category,tickets,note\n2026-10-27,battery rattle,23,"
            "battery rattle jumps to 23 tickets this week\n2026-10-27,range,6,\n")
OKRS = ("# Company OKRs 2027\n\nObjective 1: grow dealer revenue. Key results: 40 dealers, 12% margin.\n"
        "Our strategic goals and targets for the year; all-hands on 5 Jan. Strategic focus: dealers.\n")


def test_department_detected_from_content_applied_only_where_uploader_may_file(v2):
    assert put_policy(v2, "co", CARE_POLICY)["ok"]
    r = up(v2, "cy", "Care ticket spike.md", CARE_DOC)  # a sales member: cannot file into Customer Care
    assert r.status_code == 200, r.text
    s = r.json()["suggested"]
    assert s["detected_department"] == "care" and s["detected_department_name"] == "Customer Care"
    assert s["department"] == "sales" and s["department_name"] == "Sales" and s["access"] == "area"
    assert s["reason"] == ("AI suggestion: general → department · looks like Customer Care content; "
                           "filed in Sales (you can't file into Customer Care)")
    nid = r.json()["imported"][0]["id"]
    assert _load(v2).notes[nid].area == "sales"
    assert nid in listing(v2, "cy") and nid not in listing(v2, "cay")
    # a grant is read access only: Sue (grant:care, home sales) still files into her own department
    r = up(v2, "sue", "Care ticket spike.md", CARE_DOC)
    s = r.json()["suggested"]
    assert s["department"] == "sales" and s["detected_department"] == "care"
    assert s["reason"].endswith("filed in Sales (you can't file into Customer Care)")
    nid = r.json()["imported"][0]["id"]
    assert _load(v2).notes[nid].area == "sales" and nid not in listing(v2, "cay")
    # a care member files it in their own department
    s = up(v2, "cay", "Care ticket spike.md", CARE_DOC).json()["suggested"]
    assert s["department"] == "care" and s["reason"].endswith("department: Customer Care (your department)")


def test_restricted_to_leads_uses_the_leads_of_the_filing_department(v2):
    assert put_policy(v2, "co", CARE_POLICY)["ok"]
    # the care lead files a care strategy doc: it lands in care, restricted to care's leads
    s = up(v2, "cay", "Plan.md", "# Care strategy 2027\n\nOur strategy: fewer complaints and returns.\n").json()["suggested"]
    assert s["department"] == "care" and s["access"] == "restricted" and s["allow"] == ["cay"]
    # Sue holds grant:care but is no lead: it stays in her own department (Sales), and she can't restrict it there
    s = up(v2, "sue", "Plan.md", "# Care strategy 2027\n\nOur strategy: fewer complaints and returns.\n").json()["suggested"]
    assert s["department"] == "sales" and s["access"] == "area" and "not a lead" in s["reason"]


def test_okrs_are_not_strategy(v2):
    r = up(v2, "dee", "Company OKRs.md", OKRS)
    s = r.json()["suggested"]
    assert s["access"] == "area" and s["allow"] == [] and s["reason"].startswith("Rule: goals → department")
    nid = r.json()["imported"][0]["id"]
    assert nid in listing(v2, "cy") and nid not in listing(v2, "bob")
    # a real strategy document that mentions goals twice is still restricted
    t = up(v2, "dee", "Sales strategy.md", STRATEGY + "Our goals and targets follow below.\n").json()["suggested"]
    assert t["access"] == "restricted" and t["reason"].startswith("Rule: strategy → team leads")
    # leak: the restricted strategy document never reaches department colleagues
    nid = up(v2, "dee", "Sales strategy.md", STRATEGY).json()["imported"][0]["id"]
    assert nid not in listing(v2, "cy") and not seen_by(v2, "cy", "quokka")


def test_goals_never_win_a_tie_with_strategy(v2):
    """When a document is as much strategy as goals, it stays restricted (fail closed)."""
    doc = "# Planning notes\n\nOur strategy and roadmap. Our goals and targets.\n"
    s = up(v2, "dee", "Planning notes.md", doc).json()["suggested"]
    assert s["access"] == "restricted" and s["reason"].startswith("Rule: strategy")
