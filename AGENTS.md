# Agent rules for this repo (Codex reads AGENTS.md, Claude reads CLAUDE.md: same file)

## MODE: HACKATHON (Wed 04/11, build 14:15–16:30 + 17:00–17:30, demo 16:30, judging 17:30)
**Fastest route to a demoable result, not to production** (Jakob, 04/11). **Speed over polish.** A working, demoable feature now beats a perfect one later. Time-box everything:
if a task isn't working after 20 minutes, cut scope or drop it and say so. No refactors, no gold-plating,
no docs beyond the handoff note. The ONE quality floor that never bends: access rules (see "Never").

Two people work on this repo from different machines, each running several agents. Agents never talk
directly; they stay aligned through this file, `docs/design.md`, the tests, and `docs/handoff/`.

## If you are the main session: you are an ORCHESTRATOR
- **Plan, split, dispatch, integrate. Do not do the work yourself.** Your context is the scarcest
  resource of the day: keep it lean so you stay sharp for 5 hours.
- **Never read big things yourself**: supplied data dumps, long files, logs, full diffs, test output.
  Send a subagent/worker and ask for a summary of at most 10 lines with file paths.
- **Parallelise hard.** Split work into independent tasks that own disjoint files (see Lanes) and run
  them at the same time: 3–6 workers is normal. Sequential only when one truly needs the other's output.
- **Every worker brief has 5 parts:** goal (one sentence) · files it owns (only these) · the contract it
  must respect (link the section) · done = which command proves it on the REAL data · report format
  (≤10 lines: what changed, proof output, what's not done).
- **Cheap models for grunt work** (lookups, imports, reading data: small/fast models); strong models only
  for judgement (plans, access-rule changes, the demo story).
- **State lives in files, not in your head:** decisions → `docs/design.md`, progress → handoff notes,
  the plan for the next hour → `docs/today.md` (update it every checkpoint; overwrite, keep it short).
- **Integrate continuously:** after each worker returns: `git pull --rebase`, run `uv run pytest -q`,
  commit, push. Small commits straight to `main` are fine today; CI must stay green.
- **Checkpoints every ~45 min** (15:00, 15:45, 16:20): what works end-to-end on the real data? Cut what
  won't make the demo.

## If you are a worker
- Do exactly your brief, touch only the files it lists, run its done-check on the real data, report in
  ≤10 lines. Don't explore beyond what the task needs. Don't "improve" other code.
- Blocked or the brief is wrong → stop and report in 3 lines; don't improvise a bigger change.

## Lanes (disjoint folders → no merge fights)
See `docs/lanes.md`. Default split for two people: A = data + rules (`brain/intake/**`, `data/**`,
`brain/{store,access,precedence,search,ask,people,embed}.py`), B = app (`brain/{server,cli,graph}.py`,
`web/**`). Shared contracts change only by agreement: `brain/schema.py`, `docs/design.md` "HTTP API" /
"Graph export", `tests/test_contract.py`; change them in a separate small commit + handoff note first.

## Never (the product is "who sees what" and "whose word wins")
- Anything that returns data goes through `brain/access.py`. Private notes are author-only (no CEO
  exception). Never echo ids/titles/values/snippets of notes the viewer can't read: not in hints, errors,
  counts, ghosts, people/expertise, or search. Adding an output = adding one leak test.
- Demo company data is invented (Jakob 04/11: "No company data will be provided. all invented"); it lives in
  `demo-raw/<co>/` (raw files) and `data/<co>/` (imported), consistent with `docs/demo-company.md`.
  Test fixtures still live inside tests (tmp_path) only.
- Never commit secrets or the organisers' raw files (`supplied-data/` stays out of git); imported notes
  under `data/<co>/` are committed only if the organisers allow sharing.

## Handoff notes (the agents' message channel)
`git pull` and read new notes in `docs/handoff/` before starting each task. After finishing anything
another lane uses, write `docs/handoff/HHMM-<lane>-<topic>.md` (≤10 lines: what, contract touched, one
example call, what's missing) and commit it with the work.

## Commands (from `kit/`, venv: `uv venv && uv pip install -e ".[dev,embed]"`)
- import: `.venv/bin/python -m brain.intake.cli import <file|dir> --data data/<co> --area <id> --access all|area|restricted [--author <id>] [--personal <id>]`
- formats / validate: `python -m brain.intake.cli formats` · `python -m brain.intake.cli validate --data data/<co>`
- new file type: copy `docs/build-briefs/D-new-importer.md` into a worker brief
- extract facts from imported docs: worker follows `brain/intake/extract_prompt.md`
- meaning index: `python -m brain.embed --data data/<co>` · Obsidian vault: `python -m brain.cli obsidian --data data/<co>`
- ask: `python -m brain.cli ask --data data/<co> --person <id> "question"` · status: `python -m brain.cli status --data data/<co>`
- serve: `python -m brain.cli serve --data data/<co> --port 8000` → http://localhost:8000/?person=<id>
- MCP links: `python -m brain.cli links --data data/<co>`; public URL for Claude (tested 04/11 at the venue): `scripts/public.sh data/<co> 8000` starts tunnel + server and prints each person's connector link
- tests: `uv run pytest -q` (the contract test proves intake → server → HTTP/MCP still fit)

## Where things are
Background + positioning + how to connect Claude/ChatGPT `docs/context.md` · spec `docs/design.md` · run sheet + demo script `docs/runsheet.md` · module guides `docs/modules/` ·
day-of briefs `docs/runsheet.md` (D1–D5) + `docs/build-briefs/D-new-importer.md`.
