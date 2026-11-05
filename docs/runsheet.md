# Run sheet: hackathon day (Wed 04/11, Snowflake SVAI, 8th floor)

## Before you leave
- Rehearsed 04/11 09:00 on a throwaway company: import → validate → ask → graph page all worked.
- Commands you'll use (from `kit/`):
  - import: `.venv/bin/python -m brain.intake.cli import <file|dir> --data data/<co> --area <id> --access all|area|restricted [--author <id>] [--personal <id>]`
  - check: `.venv/bin/python -m brain.intake.cli validate --data data/<co>`
  - ask: `.venv/bin/python -m brain.cli ask --data data/<co> --person <id> "question"`
  - serve: `.venv/bin/python -m brain.cli serve --data data/<co> --port 8000` → http://localhost:8000/?person=<id>
  - MCP links: `.venv/bin/python -m brain.cli links --data data/<co>` (paste into Claude as a custom connector;
    needs a public URL, e.g. `cloudflared tunnel --url http://localhost:8000`, and BRAIN_ALLOWED_HOSTS=<that host>)
- `git pull` / copy the kit onto the laptop; `uv venv && uv pip install -e ".[dev]"`; `uv run pytest -q` green.
- Vendored web libs are in `web/vendor/` (no CDN needed). Charger, hotspot as Wi-Fi backup.
- First thing at the venue: ask an organiser whether pre-built code is allowed. If not, use
  `docs/design.md` as the spec and have the agents rebuild from it (L1 → L2 → L4 in that order; ~45 min).

## Timeline
| Time | What |
|---|---|
| 13:00–13:50 | Register. Get the data. Skim it: which file types, which departments, who are the people. |
| 13:50–14:15 | Keynotes. Meanwhile: write `data/<co>/policy.yaml` (people, ranks, groups, areas, owners, topics). |
| 14:15–15:00 | Lane A: import (D1). Lane B: extract facts (D2). Lane C: policy + access check (D3). |
| 15:00–15:45 | Lane D: integration + scenario test (D4). Lane E: graph polish (D5). |
| 15:45–16:30 | Rehearse the demo twice. Fix only what the demo touches. |
| 16:30–17:00 | Demonstration slot. |
| 17:00–17:30 | Round 2: fix what judges asked about; freeze at 17:25. |

## Day-of agent briefs (paste into a Claude Code / Codex session in the kit repo)
- **D1 import:** "Read docs/design.md (Intake). Import everything under `<supplied dir>` into `data/<co>/`
  with `python -m brain.intake.cli import`, choosing `--area` and `--access` per folder/file using
  `data/<co>/policy.yaml`. Meetings with attendee lists: `access: restricted` + `allow`. Add an importer
  under `brain/intake/importers/` only if a file type is missing, with a test. Run `validate` until clean."
- **D2 extract facts:** "Follow `brain/intake/extract_prompt.md` over `data/<co>/` documents and meetings
  in area `<X>`. Write one fact/decision note per claim. Run `validate`." (Run one agent per area in parallel.)
- **D3 policy:** "Check `data/<co>/policy.yaml` against the people and departments in the data: every
  author exists, every area has an owner, topics for every restricted area cover the obvious questions.
  Then run `python -m brain.cli status`."
- **D4 scenarios:** "Find 3 real conflicts in `data/<co>/` (a decision vs a later remark, a figure
  replaced by its owner, an estimate vs an observation). Write `data/<co>/SCENARIOS.md` (per person: expected winner, conflicts, hints) and check `python -m brain.cli ask` gives those answers for 3 people."
- **D5 polish:** "Make the graph page look great on the projector with `data/<co>/`: label density, area
  colours, start zoom, the ask panel. Do not change the API."

## Demo script (3 minutes)
1. **The picture (30 s).** Graph as CEO: company core in the middle, departments around it. "Every
   document, meeting and decision is a note; this is the company's brain."
2. **Whose word wins (60 s).** Ask the SMB question as the CEO: the decision stands; the intern's
   contradicting post shows as a red conflict, sent to the CEO because it's a weighty decision. Click the
   EMEA target: the unit lead's newer figure replaced the CEO's, because he owns that number.
3. **Who sees what (45 s).** Switch to the intern. Leadership, Finance, HR fade behind padlocks. Same
   question: general company knowledge plus "talk to Maya". "The hint shows for the topic, never because a
   hidden decision exists, so it leaks nothing."
4. **Any AI client (30 s).** Claude with the intern's MCP link: same answer, same hint. Nothing deleted,
   every answer cites title and date.
5. **Close (15 s).** "Scope, explicit replacement, authority, then date. Conflicts are shown, never
   silently settled."

## If something breaks
- Server down → `web/index.html?dev=1` runs on the fake JSON in `web/dev/`.
- Supplied data won't import in time → demo on the part that did import; say what's missing.
- MCP connection fails on venue Wi-Fi → show `python -m brain.cli ask --person lena "..."` in the terminal.
