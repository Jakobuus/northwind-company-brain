import mailbox
import subprocess
import sys
import warnings
from email.message import EmailMessage

from brain.access import can_read
from brain.intake.importers.mail import trim_body
from brain.intake.registry import import_path
from brain.store import load

PEOPLE = {"maya": "Maya Lin", "raj": "Raj Patel", "lena": "Lena Ortiz", "theo": "Theo Park"}
POLICY = """company: {id: tiny, name: Tiny Co}
people:
  maya: {name: Maya Lin, title: CEO, rank: 100, groups: [exec]}
  raj: {name: Raj Patel, title: Sales Lead, rank: 60, groups: [sales]}
  lena: {name: Lena Ortiz, title: Analyst, rank: 20, groups: [sales]}
  theo: {name: Theo Park, title: Designer, rank: 20, groups: [design]}
areas:
  core: {name: Core, owner: maya, readers: [everyone]}
  test: {name: Test, owner: maya, readers: [exec, sales, design]}
"""


def message(subject, sender, to, body, cc=None, date="Mon, 02 Nov 2026 09:30:00 +0100", **headers):
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"], msg["Date"] = subject, sender, to, date
    if cc:
        msg["Cc"] = cc
    for key, value in headers.items():
        msg[key.replace("_", "-")] = value
    msg.set_content(body)
    return msg


def thread():
    first = message("Pricing change", "Maya Lin <maya@tiny.co>", "Raj Patel <raj@tiny.co>",
                    "Raj, we move SMB pricing to 49 EUR from January.\n", cc="lena.ortiz@tiny.co")
    reply = message("Re: Pricing change", "Raj Patel <raj@tiny.co>", "Maya Lin <maya@tiny.co>",
                    "Understood, I will tell the team.\n\n"
                    "On Mon, 2 Nov 2026 at 09:30, Maya Lin <maya@tiny.co> wrote:\n"
                    "> Raj, we move SMB pricing to 49 EUR from January.\n"
                    "> Please confirm.\n\n"
                    "-- \nRaj Patel, Sales\n",
                    date="Mon, 02 Nov 2026 11:00:00 +0100")
    news = message("Weekly digest", "News <news@example.org>", "Raj Patel <raj@tiny.co>", "Ten tips!",
                   List_Unsubscribe="<mailto:unsub@example.org>")
    return first, reply, news


def test_eml_author_allow_and_access(tmp_path):
    first, _, _ = thread()
    path = tmp_path / "pricing.eml"
    path.write_bytes(bytes(first))
    [env] = import_path(path, {"people": PEOPLE})
    assert env.title == "Pricing change"
    assert env.author == "maya"
    assert env.access == "restricted"
    assert env.allow == ["maya", "raj", "lena"]  # sender, To, Cc (matched via "lena.ortiz@")
    assert env.date == "2026-11-02"
    assert "49 EUR" in env.body
    assert "To: Raj Patel <raj@tiny.co>" in env.body


def test_outside_address_with_internal_first_name_is_not_matched(tmp_path):
    msg = message("Hello", "Raj <raj@competitor.com>", "Maya Lin <maya@tiny.co>", "Hi there")
    msg.replace_header("From", "raj@competitor.com")
    path = tmp_path / "x.eml"
    path.write_bytes(bytes(msg))
    [env] = import_path(path, {"people": PEOPLE})
    assert env.author is None and env.allow == ["maya"]


def test_explicit_access_and_author_are_respected(tmp_path):
    first, _, _ = thread()
    path = tmp_path / "pricing.eml"
    path.write_bytes(bytes(first))
    [env] = import_path(path, {"people": PEOPLE, "access": "all", "author": "theo", "allow": ["observer"]})
    assert env.access == "all" and env.author == "theo"
    assert env.allow == ["observer", "maya", "raj", "lena"]  # real sender stays able to read


def test_reply_trimming():
    text = ("Thanks, agreed.\n\nOn Mon, 2 Nov 2026 at 09:30, Maya Lin <m@x.co> wrote:\n> old line\n> older\n"
            "\nAm 02.11.2026 um 09:30 schrieb Maya:\n> alt\n")
    assert trim_body(text) == "Thanks, agreed."
    wrapped = "Yes.\n\nOn Mon, 2 Nov 2026 at 09:30, Maya Lin <maya@tiny.co>\nwrote:\n> hidden\n"
    assert trim_body(wrapped) == "Yes."
    outlook = "Done.\n\n-----Original Message-----\nFrom: Maya\nSent: Monday\nSecret old text\n"
    assert trim_body(outlook) == "Done."
    outlook2 = "Done.\n\nFrom: Maya Lin\nSent: Monday\nTo: Raj\nSecret old text\n"
    assert trim_body(outlook2) == "Done."
    assert trim_body("Keep\n> drop\nKeep too") == "Keep\nKeep too"


def test_html_only_body(tmp_path):
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = "Html", "Maya Lin <maya@tiny.co>", "Raj Patel <raj@tiny.co>"
    msg.set_content("<html><style>p{}</style><body><p>Budget is <b>12k</b></p><p>Sign&amp;go</p></body></html>",
                    subtype="html")
    path = tmp_path / "h.eml"
    path.write_bytes(bytes(msg))
    [env] = import_path(path, {"people": PEOPLE})
    assert "Budget is 12k" in env.body and "Sign&go" in env.body and "<" not in env.body.split("\n\n", 1)[1]


def test_mbox_splits_messages_and_skips_automated(tmp_path):
    path = tmp_path / "inbox.mbox"
    box = mailbox.mbox(str(path))
    for msg in thread():
        box.add(msg)
    box.flush()
    box.close()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        envelopes = import_path(path, {"people": PEOPLE})
    assert [env.title for env in envelopes] == ["Pricing change", "Re: Pricing change"]
    assert len({env.id for env in envelopes}) == 2
    assert envelopes[1].author == "raj" and envelopes[1].allow == ["raj", "maya"]
    assert "wrote:" not in envelopes[1].body and "49 EUR" not in envelopes[1].body
    assert "will tell the team" in envelopes[1].body
    assert "Raj Patel, Sales" not in envelopes[1].body  # signature cut
    assert any("Skipped 1 automated" in str(w.message) for w in caught)


def test_cli_import_validate_and_leak(tmp_path):
    raw, data = tmp_path / "raw", tmp_path / "data"
    raw.mkdir()
    data.mkdir()
    (data / "policy.yaml").write_text(POLICY)
    first, reply, news = thread()
    box = mailbox.mbox(str(raw / "inbox.mbox"))
    for msg in (first, reply, news):
        box.add(msg)
    box.flush()
    box.close()
    single = message("Offsite", "Theo Park <theo@tiny.co>", "Lena Ortiz <lena@tiny.co>", "Offsite is on Friday.")
    (raw / "offsite.eml").write_bytes(bytes(single))

    def cli(*args):
        return subprocess.run([sys.executable, "-m", "brain.intake.cli", *map(str, args)],
                              capture_output=True, text=True, check=True)

    result = cli("import", raw, "--data", data, "--area", "test", "--access", "restricted")
    assert "Imported 3 note(s)" in result.stdout
    assert "Validation: 0 problem(s)" in cli("validate", "--data", data).stdout

    brain = load(data)
    by_title = {note.title: note for note in brain.notes.values()}
    pricing = by_title["Pricing change"]
    assert pricing.access == "restricted" and pricing.author == "maya"
    assert pricing.allow == ["raj", "lena"] or set(pricing.allow) >= {"raj", "lena"}
    for person in ("maya", "raj", "lena"):
        assert can_read(brain, person, pricing)
    # Leak test: Theo is not on the pricing thread, so the note is invisible to him,
    # but he can read the email he sent himself.
    assert not can_read(brain, "theo", pricing)
    assert not can_read(brain, "theo", by_title["Re: Pricing change"])
    assert can_read(brain, "theo", by_title["Offsite"])
    assert not can_read(brain, "maya", by_title["Offsite"])
