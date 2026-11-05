# Context: everything decided or learned before the event (read after AGENTS.md)

## The event
- "Company Brain Hackathon: Build an AI Agent That Knows Your Organization", TechEquity Ai, Snowflake
  Silicon Valley AI Hub (8th floor, 135 Constitution Dr, Menlo Park), Wed 04/11 13:00–19:30.
- Agenda: 13:00 registration · 13:50 keynotes · 14:15–16:30 round 1 · 16:30 demonstration · 17:00–17:30
  round 2 · 17:30–18:45 judging · networking. Under 3 hours of building in total.
- Speaker/host: Dave Nielsen (Cognee DevRel, AI Alliance). Partners: Snowflake SVAI Hub, AI Alliance.
  Organiser contact: info@techequity-ai.org. Not published: judging criteria, prizes, team rules, stack,
  data format, whether pre-built code is allowed → ask at the venue, write answers in `docs/today.md`.

## Positioning (why this wins)
- Most teams will show "chat with company docs". Permissions alone don't stand out either: Cognee (the
  keynote's company) already has per-dataset users/roles/tenants with read/write/delete/share.
- Our edge: **whose word wins**. In our research, memory tools (Mem0, Zep/Graphiti) decide conflicts by
  recency or by asking the model; none weigh who said it. We do: scope → explicit replacement → authority
  (area owner = top authority on their own area) → date; conflicts are shown and routed, never silently
  settled; nothing is deleted.
- Plus **who sees what** done carefully: filter before search, hints by topic never by hidden notes,
  private notes author-only (not even the CEO), no leaks via snippets, counts, expertise or graph ghosts.
- Pitch line: "a company memory that knows who's allowed to see what, and whose word counts on what."

## How it's reached
- Claude (tested 04/11 at the venue through a public tunnel; all tools listed, correct answers + hints):
  `scripts/public.sh data/<co> 8000` → prints one connector link per person → claude.ai Settings →
  Connectors → Add custom connector → paste link. The venue network needs `--protocol http2` (already in
  the script). Each link = one person's view (identity is the secret token in the URL).
- ChatGPT (tested Oct 2026; Plus or Pro, web app at chatgpt.com, not the phone app): there is no "developer
  mode" any more. chatgpt.com/plugins → + → "Create custom MCP server" → Server URL = the person's link →
  Authentication "No authentication" → tick the risk box → "Create as a plugin". Switch it on per chat via the
  composer "+" (the first click after a page load is ignored; click again). After tool changes: Settings →
  Plugins → Refresh tools. Answers take about 40-75 s. Use a Temporary Chat for a clean demo (no memory from
  earlier chats). All tools carry `readOnlyHint`, so ChatGPT asks for no write confirmations.
- Browser: `python -m brain.cli serve --data data/<co> --port 8000` → http://localhost:8000/?person=<id>.
- Obsidian: `python -m brain.cli obsidian --data data/<co>` → open that folder as its own vault.

## State at kickoff
- Built + reviewed (Opus/Codex cross-reviews, all findings fixed): intake (md/txt/pdf/docx/csv/xlsx/json/
  transcripts + fallback + importer slot), rules (access, precedence, private space), search (BM25 + local
  meaning search, model cached at ~/.cache/brain-fastembed), ask packet, people & expertise, MCP server +
  HTTP API, rings+cards graph page, Obsidian vault generator. 76 tests incl. the end-to-end contract test;
  CI on GitHub green.
- Not done on purpose: importers for specific formats (wait for the data), real OAuth login (tokens in the
  link are enough for the demo), MBA frameworks and robust-intake retry/archive (Jakob: keep out for now).
- Open at kickoff: the task itself, the data, the teammate and lane split, the pre-built-code rule.

## Background research
Background research (graph modelling, retrieval, graph UIs, MCP auth, permission-aware retrieval,
conflict resolution) was done outside this repo.
