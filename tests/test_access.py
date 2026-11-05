from brain.access import can_read, hints_for, readable
from brain.schema import Area, Brain, Note, Person, Policy


def company(tmp_path):
    people = {
        "maya": Person("maya", "Maya", "CEO", 100, ["exec"]),
        "raj": Person("raj", "Raj", "Sales", 60, ["sales"]),
        "lena": Person("lena", "Lena", "Intern", 20, ["marketing"]),
    }
    areas = {
        "sales": Area("sales", "Sales", "raj", ["sales"], ["pricing change", "pricing"]),
        "empty": Area("empty", "Secret Strategy", "maya", ["exec"], ["strategy"]),
    }
    return Brain(tmp_path, Policy("tiny", "Tiny", people, areas, {}), {})


def test_access_modes_and_owner(tmp_path):
    brain = company(tmp_path)
    open_note = Note("open", "fact", "Open", "sales", access="all")
    area_note = Note("area", "fact", "Area", "sales")
    meeting = Note("meeting", "meeting", "Meeting", "sales", access="restricted",
                   author="maya", allow=["lena"])
    brain.notes = {note.id: note for note in (open_note, area_note, meeting)}
    assert can_read(brain, "lena", open_note)
    assert not can_read(brain, "lena", area_note)
    assert can_read(brain, "lena", meeting)
    assert can_read(brain, "maya", meeting)
    assert not can_read(brain, "raj", meeting)
    assert [note.id for note in readable(brain, "lena")] == ["open", "meeting"]


def test_hints_depend_on_topics_not_notes(tmp_path):
    brain = company(tmp_path)
    hints = hints_for(brain, "lena", "changes to PRICING and strategy")
    assert [(hint.area, hint.topic) for hint in hints] == [
        ("sales", "pricing change"), ("empty", "strategy")]
    assert hints_for(brain, "lena", "unrelated question") == []
    assert hints_for(brain, "raj", "pricing") == []
    assert hints_for(brain, "maya", "strategy") == []
    assert [(hint.area, hint.topic) for hint in hints_for(
        brain, "lena", "pricing changes")] == [("sales", "pricing change")]


def test_topic_words_any_order_and_symbol_tokens(tmp_path):
    brain = company(tmp_path)
    brain.policy.areas["sales"].topics = ["pricing change", "m&a", "board"]
    assert [h.topic for h in hints_for(brain, "lena", "should we change pricing?")] == ["pricing change"]
    assert hints_for(brain, "lena", "my annual leave") == []
    assert hints_for(brain, "lena", "onboarding checklist") == []
    assert [h.topic for h in hints_for(brain, "lena", "Discuss M&A")] == ["m&a"]
    assert hints_for(brain, "ghost", "pricing change") == []
