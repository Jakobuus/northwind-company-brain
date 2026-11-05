from datetime import date

from brain.precedence import apply_status, authority, resolve, resolve_for
from brain.schema import Area, Brain, Note, Person, Policy


def company(tmp_path):
    people = {
        "maya": Person("maya", "Maya Lin", "CEO", 100, ["exec"]),
        "raj": Person("raj", "Raj Patel", "Sales head", 60, ["sales"]),
        "lena": Person("lena", "Lena Ortiz", "Intern", 20, ["marketing"]),
    }
    areas = {
        "sales": Area("sales", "Sales EMEA", "raj", ["sales", "exec"]),
        "leadership": Area("leadership", "Leadership", "maya", ["exec"]),
    }
    return Brain(tmp_path, Policy("tiny", "Tiny", people, areas, {}), {})


def claim(id, author, when, value, kind="fact", claim_type="target", area="sales",
          access="area", replaces=None, weight="normal"):
    return Note(id, kind, id, area, access=access, author=author,
                date=date.fromisoformat(when), subject="emea", attribute="q4-target",
                value=value, claim=claim_type, replaces=replaces or [], weight=weight)


def test_ceo_decision_beats_newer_intern_remark_with_routed_conflict(tmp_path):
    brain = company(tmp_path)
    ceo = claim("ceo", "maya", "2026-10-01", "3.5M", kind="decision", claim_type="decision",
                weight="high")
    intern = claim("intern", "lena", "2026-10-03", "3.6M", claim_type="remark")
    resolution = resolve(brain, [ceo, intern])
    assert resolution.winner == "ceo"
    assert [(c.challenger, c.severity, c.route_to) for c in resolution.conflicts] == [
        ("intern", "high", "raj")]
    assert "Maya Lin" in resolution.reason


def test_newer_owner_replaces_ceo_old_target(tmp_path):
    brain = company(tmp_path)
    old = claim("old", "maya", "2026-10-01", "3.5M")
    new = claim("new", "raj", "2026-10-30", "3.6M", replaces=["old"])
    brain.notes = {n.id: n for n in (old, new)}
    assert authority(brain, new) == authority(brain, old) == 100
    resolution = resolve(brain, [old, new])
    assert (resolution.winner, resolution.superseded, resolution.conflicts) == (
        "new", ["old"], [])
    assert "Raj Patel" in resolution.reason and "owns Sales EMEA" in resolution.reason
    assert apply_status(brain) == {"old": "superseded", "new": "current"}
    assert old.status == "current"


def test_intern_cannot_replace_ceo_decision(tmp_path):
    brain = company(tmp_path)
    ceo = claim("ceo", "maya", "2026-10-01", "3.5M", kind="decision",
                claim_type="decision")
    intern = claim("intern", "lena", "2026-10-02", "3.6M", replaces=["ceo"])
    brain.notes = {n.id: n for n in (ceo, intern)}
    resolution = resolve(brain, [ceo, intern])
    assert resolution.winner == "ceo" and resolution.superseded == []
    assert [conflict.challenger for conflict in resolution.conflicts] == ["intern"]
    assert apply_status(brain)["intern"] == "contested"


def test_newer_observation_beats_higher_rank_estimate(tmp_path):
    brain = company(tmp_path)
    old = claim("estimate", "maya", "2026-10-01", "3.5M", claim_type="estimate")
    new = claim("observation", "lena", "2026-10-02", "3.6M",
                claim_type="observation")
    resolution = resolve(brain, [old, new])
    assert resolution.winner == "observation"
    assert resolution.superseded == ["estimate"]


def test_viewer_sees_only_visible_older_fact(tmp_path):
    brain = company(tmp_path)
    old = claim("visible-old", "raj", "2026-10-01", "3.5M")
    hidden = claim("secret-new", "maya", "2026-10-02", "3.6M",
                   area="leadership", access="restricted", replaces=["visible-old"])
    brain.notes = {n.id: n for n in (old, hidden)}
    resolutions = resolve_for(brain, "raj")
    assert len(resolutions) == 1
    assert resolutions[0].winner == "visible-old"
    assert resolutions[0].conflicts == []
    assert "secret-new" not in repr(resolutions)


def test_agreement_is_current_without_explicit_replacement(tmp_path):
    brain = company(tmp_path)
    old = claim("old", "maya", "2026-10-01", " 3.5M ")
    new = claim("new", "raj", "2026-10-02", "3.5m")
    brain.notes = {n.id: n for n in (old, new)}
    resolution = resolve(brain, [old, new])
    assert resolution.winner == "new"
    assert resolution.superseded == resolution.conflicts == []
    assert apply_status(brain) == {"old": "current", "new": "current"}


def test_lower_class_owner_replacement_is_conflict(tmp_path):
    brain = company(tmp_path)
    decision = claim("decision", "maya", "2026-10-01", "3.5M", claim_type="decision")
    remark = claim("remark", "raj", "2026-10-02", "3.6M", claim_type="remark",
                   replaces=["decision"])
    result = resolve(brain, [decision, remark])
    assert result.winner == "decision"
    assert result.superseded == []
    assert [c.challenger for c in result.conflicts] == ["remark"]
    assert "decision" in result.reason and "remark" in result.reason


def test_invalid_replacement_conflicts_even_when_value_agrees(tmp_path):
    brain = company(tmp_path)
    decision = claim("decision", "maya", "2026-10-01", "3.5M", claim_type="decision")
    remark = claim("remark", "raj", "2026-10-02", "3.5M", claim_type="remark",
                   replaces=["decision"])
    result = resolve(brain, [decision, remark])
    assert result.winner == "decision"
    assert [c.challenger for c in result.conflicts] == ["remark"]


def test_high_conflict_without_area_owner_routes_to_reader(tmp_path):
    brain = company(tmp_path)
    first = claim("first", "maya", "2026-10-01", "1", claim_type="decision",
                  area="unknown", access="all", weight="high")
    later = claim("later", "lena", "2026-10-02", "2", claim_type="remark",
                  area="unknown", access="all")
    result = resolve(brain, [first, later])
    assert result.conflicts[0].route_to == "maya"


def test_reason_names_rival_and_dates(tmp_path):
    brain = company(tmp_path)
    old = claim("old", "maya", "2026-10-01", "3.5M")
    new = claim("new", "raj", "2026-10-30", "3.6M", replaces=["old"])
    reason = resolve(brain, [old, new]).reason
    assert "Raj Patel" in reason and "Maya Lin" in reason
    assert "2026-10-30" in reason and "2026-10-01" in reason


def test_invalid_replaces_keeps_newer_observation_in_ranking(tmp_path):
    brain = company(tmp_path)
    old = claim("old", "maya", "2026-10-01", "100", claim_type="observation", area="core")
    new = claim("new", "lena", "2026-10-09", "145", claim_type="observation", area="core")
    expected = resolve(brain, [old, new]).winner
    new.replaces = ["old"]
    result = resolve(brain, [old, new])
    assert expected == result.winner == "new"
    assert result.conflicts


def test_reasons_for_replacement_tie_and_older_authority(tmp_path):
    brain = company(tmp_path)
    old = claim("old", "maya", "2026-10-01", "100")
    new = claim("new", "raj", "2026-10-30", "145", replaces=["old"])
    reason = resolve(brain, [old, new]).reason
    assert "replaces" in reason and "Raj Patel's figure" in reason
    peer = claim("peer", "raj", "2026-10-30", "150")
    assert "ties with" in resolve(brain, [new, peer]).reason
    older = claim("older", "raj", "2026-09-01", "90", claim_type="decision")
    later = claim("later", "lena", "2026-10-01", "100", claim_type="decision")
    reason = resolve(brain, [older, later]).reason
    assert "newer" not in reason


def test_high_conflict_without_any_people_does_not_raise(tmp_path):
    brain = company(tmp_path)
    brain.policy.people.clear()
    first = claim("first", "nobody", "2026-10-01", "1", claim_type="decision", area="unknown", weight="high")
    later = claim("later", "other", "2026-10-02", "2", claim_type="remark", area="unknown")
    assert resolve(brain, [first, later]).conflicts[0].route_to is None


def test_equal_values_in_different_notation_are_not_a_conflict():
    from brain.precedence import _value

    def n(v):
        return Note(id="x", type="fact", title="t", area="sales", value=v)
    assert _value(n("15 March 2027")) == _value(n("2027-03-15")) == _value(n("March 15, 2027"))
    assert _value(n("EUR 2,690")) == _value(n("2690 EUR")) == _value(n("2,690 eur"))
    assert _value(n("April 2027")) != _value(n("2027-03-15"))
    assert _value(n("EUR 2,690")) != _value(n("EUR 2,790"))
