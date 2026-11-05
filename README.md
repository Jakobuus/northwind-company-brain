# Company Brain

A company brain where each person, and their AI assistant, sees only what their role may read. When two notes
disagree, the brain resolves it by whose word wins, not by whichever was written last.
The demo company is **Northwind Bikes**. It is invented, and so is all of its data.

Built at a one-day hackathon. See "Honest limits" below.

## The four rings: who sees what

| Ring | Who reads it |
|---|---|
| Company core (centre) | Everyone in the company |
| Department core | Everyone (every department can read the core of every other) |
| Department internal | That department's members, plus people explicitly granted that department |
| Private | Only the author. Nobody else, including the CEO |

- Each department has 1-2 **leads**. Only a lead can move a note from department to core. Owner and admins cannot
  override that.
- A member asks for a note to be promoted into the core. A lead approves or declines in an approvals inbox.
  Every move is recorded on the note.
- When something is hidden, the answer is an "ask the owner" hint. It never shows the title, text, count or
  snippet of a note you may not read.

## How it works

- **Ingestion:** any file (mail, PDF, Word, Excel, text) is converted to markdown, facts are extracted, it is
  assigned a department and permissions, then indexed (keyword and meaning search).
- **Retrieval:** find matching notes, filter by the asking person's permissions, resolve conflicts by precedence,
  then answer. Every output goes through one file, `brain/access.py`, and each output has a leak test.
- **Connect an AI:** the brain serves a read-only MCP endpoint per person. The AI sees exactly what that
  person sees.

## Run it locally

Prerequisites: Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node 22 with pnpm, and Docker (the app's
Postgres and Redis run in Docker Compose). Tested on macOS.

```bash
# 1. Python brain
uv venv && uv pip install -e ".[dev,embed]"
uv run pytest -q                      # access, precedence, intake and contract tests

# 2. App (web :3000, api :3001) and its env files
cd app && pnpm bootstrap && cd ..     # copies .env files, starts Postgres/Redis, migrates
#    then in app/apps/api/.env set BRAIN_SERVICE_TOKEN to any secret of 16+ characters

# 3. Brain service (:8000), same token as in step 2
BRAIN_SERVICE_TOKEN=<same secret> BRAIN_ROOT=$PWD/../brain-root \
  .venv/bin/python -m brain.cli serve --root "$PWD/../brain-root" --port 8000

# 4. Start web + api, then seed Northwind (invented; re-creates only the Northwind org)
scripts/dev-app.sh                    # stop with: scripts/dev-app.sh stop
scripts/reset_northwind.sh            # add --keep to top up without wiping
```

Open http://localhost:3000/login. Demo-only logins: `<name>@northwind.example` with password `Demo123!`,
for example `jakob` (Head of Sales) and `felix` (Junior Developer, Product & Engineering; docs/demo-company.md has all 32).
Log in as different people and ask the same question to see different answers.

`scripts/demo-up.sh` is the maintainer's one-command wrapper (starts missing services, restores a saved Northwind
state, prints login and graph URLs; `--no-reset` skips the restore). It expects helper files kept next to this
repo (`../brain-up.sh`, `../.brain-dev.env`) that are not in git, so on a fresh checkout use steps 1-4.
`scripts/demo-preflight.sh` is a read-only checklist.

**Connect an AI:** `scripts/public.sh links` prints one MCP connector link per person (`PERSONAS="jakob felix"`
picks who). Use the link in Claude Code, or in ChatGPT (chatgpt.com, Plus or Pro, "Create custom MCP server").
Treat links as secrets; each one grants that person's view.

## Honest limits

- **claude.ai custom connectors currently fail** for authless MCP servers (anthropics/claude-ai-mcp#1214).
  Claude Code and ChatGPT work.
- Demo passwords, tokens and connector links are demo-only. Do not reuse them.
- Quick tunnels (`scripts/public.sh`) are for demos. They drop and change URL.
- All company data is invented. Nothing real is in this repo.
- Speed over hardening: this is a hackathon build, not a production system. The access rules are the part we
  tested hardest.

## Repo map

- `brain/`: Python brain: intake, store, access rules, precedence, search, ask, MCP server, graph export.
- `app/`: web and api platform (Next.js, NestJS, Postgres), based on the MIT-licensed app-starter, with brain pages added.
- `web/`: the standalone graph visualisation (rings view).
- `tests/`: pytest suite, including leak tests and the contract test.
- `docs/`: design (`design.md`), demo company (`demo-company.md`), context, run sheet, module guides.
- `scripts/`: dev and demo scripts (start app, seed Northwind, tunnel, preflight).
- `demo-raw/northwind/`: the invented raw files for the demo company.

Framework notes in the demo come from the MBA Brain framework library.
