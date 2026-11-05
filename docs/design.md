# Company Brain Kit: design

Status: approved approach (Jakob, 2026-11-03/04). Built for the TechEquity Ai "Company Brain" hackathon,
Snowflake SVAI, Menlo Park, Wed 2026-11-04 (build rounds 14:15–16:30 and 17:00–17:30, judging 17:30).

## Goal

A company brain that knows **who may see what** and **whose word wins**, served to AI clients over MCP
and shown as a structured, Obsidian-style graph. Company data is supplied on the day; this kit is the
clean, tested base the build agents start from, so the day goes into importers, polish and the demo.

## Decisions (Jakob's words, recorded verbatim)

- Star feature: "whose word wins" (A), "but with permission by document or meeting type. An interal ceo
  meeting can[not] be found by someone not in the meeting or not specifically given access".
- No-access answers: "if someone asked for information that they don't have access to where there is a
  new decision, they should just get a kind of message. Kind of like the information from general company
  knowledge with a little hint that if they're looking for ongoing decision making. They should talk to
  the responsible person because they don't have access to that specific area."
- Look: "a very structured version of an obsidian second brain, where there's basically the core
  information In the middle, in interconnected nodes and then subsegments with nodes tied to specific
  departments, permission levels, or people."
- Personal space: "even the CEO doesnt get access to personal files, the most outer ring must be seperated
  by individual people so thjat they can safe personal notes etc"
- Look (chosen 04/11): "I like b / C most. Like structured rings with cards" (rings = access levels around
  the core, department slices, notes as cards; outermost ring split per person, see mockup v5).
- Modules (04/11): "People & expertise graph, Meaning-based search" as "Working modules + docs".
  People expertise source: "i cant know this yet. id say both." (declared profiles + activity).
  Frameworks: "keep it out for now, at least until we have the exact task". Robust intake: "keep it out for now".
  Obsidian: "it sounds good, but I would need to start a new obsidian project that doesn't shouldn't interfere or
  pop up in my classic Obsidian graph". Importers: "basic importer architecture should be kind of somewhat
  ready ... Don't pre-build, though. I don't know what the scope will be and what kind of data we will be provided."
- Approach: a small, separate repo built for this demo.
- Hackathon day (04/11): "Fastest route to a demoable result, not to production". Organisers: starter kit
  "not required. all is allowed".
- Frameworks now in (04/11, replaces "keep it out for now"): "lets also use the MBA Vault (public connector) As
  additional source". Retrieval: "Retraival shoudl run via RAG and embeddign/sematic search".
- Data (04/11): "No company data will be provided. all invented (use bunch of lua or haiku agents)".

## Principles

1. **Everything is a markdown note with frontmatter** (Obsidian-compatible). `data/<company>/` opens in
   Obsidian as a vault. Plain files are easy for agents to write and check.
2. **Access is checked before anything is scored or returned**: search candidates, graph hops, graph
   export, conflict lists, citations. One function decides: `access.can_read(person, note)`.
3. **Nothing is deleted.** Losing facts stay, marked `superseded` or `contested`.
4. **Hints never leak.** The "talk to X" hint is triggered by the *question's topic* matching a restricted
   area's declared topics, never by the existence of a hidden note.

## Personal space

Every person has a private area `personal/<person id>/`. Notes there have `access: private` and are
readable **only by their author**: no group, no owner, no CEO, no `allow` exception. To share a personal
note, the author moves it out (or changes it to `restricted` with `allow`). Private notes:
- never feed anyone else's search, hints, graph, conflicts or resolutions;
- may conflict with company facts; such conflicts are shown to the author only and are never routed;
- personal areas have no topics, so they never trigger hints.

## Data model

### Note (one file per item, `data/<company>/<area>/<slug>.md`)

```yaml
---
id: emea-q4-target-2026-10-30          # unique, = filename stem
type: fact                             # company|area|person|document|meeting|decision|policy|fact
title: EMEA Q4 target €3.6M
area: sales                            # key in policy.yaml areas; "core" = whole company
access: area                           # all | area | restricted | private   (see Access)
allow: []                              # extra person ids with access (e.g. meeting attendees)
author: raj                            # person id
date: 2026-10-30                       # when said/written (ISO)
source: emea-weekly-2026-10-30         # id of the note it came from (document/meeting)
# facts and decisions only:
subject: emea                          # what it is about
attribute: q4-target                   # which property; (subject, attribute) = the fact key
value: "3.6M EUR"
claim: target                          # see Claim classes
weight: normal                         # high|normal|low  (decisions: how weighty)
replaces: [emea-q4-target-2026-10-01]  # explicit supersession (ids)
status: current                        # current|superseded|contested  (written by the resolver)
---
Body text. Links as [[wikilinks]] to other note ids.
```

Edges come from: `area` (note → area hub), `author`, `source`, `replaces`, `allow` attendees, and
`[[wikilinks]]` in the body. Area hubs (`type: area`) link to the company hub (`type: company`).

### policy.yaml (per company)

```yaml
company: {id: northwind, name: Northwind}
people:
  maya: {name: Maya Lin, title: CEO, rank: 100, groups: [exec]}
  raj:  {name: Raj Patel, title: Head of EMEA Sales, rank: 60, groups: [sales]}
  lena: {name: Lena Ortiz, title: Marketing intern, rank: 20, groups: [marketing]}
areas:
  core:       {name: Company core, owner: maya, readers: [everyone]}
  sales:      {name: Sales EMEA, owner: raj, readers: [sales, exec]}
  leadership: {name: Leadership, owner: maya, readers: [exec], topics: [strategy, smb, pricing change, m&a, board]}
tokens:   # MCP link token -> person (demo identity)
  9f2c...: maya
```

### Access (`brain/access.py`)

- `access: all` → everyone. `access: area` → members of any group in `areas[area].readers`
  (`everyone` = all people). `access: restricted` → only `author` + `allow`.
- `allow` always adds access. Area owner has access to `access: area` notes in their area, but
  `access: restricted` notes are visible only to their author and `allow` list. CEO is not special-cased:
  give exec groups in `readers`.
- `hint_for(person, query) -> list[Hint]`: for each area the person cannot read whose `topics` match the
  query, return `Hint(area, owner)`. Every topic word must occur anywhere in the question, in any order,
  as a whole word or word prefix. Words shorter than three characters and words with symbols match only
  as exact whole tokens. Unknown people get no hints. Rendered as:
  "For where decisions on {topic} currently stand, talk to {owner name} ({area name}): that area isn't
  open to your role."

### Precedence (`brain/precedence.py`)

Facts with the same key `(subject, attribute)` compete. Claim classes:

| class | claim values | order inside class |
|---|---|---|
| binding | decision, policy, target | authority, then newer date |
| factual | observation, measurement, estimate | newer date, then authority |
| informal | remark | newer date |

- **Authority on a key** = 100 if the author owns the fact's `area`, else the author's `rank`.
- **Explicit `replaces`** is honoured only if the replacer's claim class is the same or higher and its
  authority ≥ the replaced fact's authority. Otherwise the attempt becomes a conflict.
- **Across classes**: binding > factual > informal. A newer lower-class fact with a different value does
  not win; it is recorded as a **conflict**.
- **Conflict** = a losing fact with a different value that is newer than the winner.
  `severity = winner.weight`; `high` → routed to the winner's area owner, or, if no owner is defined,
  the highest-rank person who can read both claims; others → noted on the key.
- Output: `Resolution(key, winner, superseded: list, conflicts: list[Conflict], reason: str)`. `reason`
  is a short human sentence ("Raj owns Sales EMEA and his figure is newer").
- Resolution is computed **per viewer over the facts that viewer can read**. Stale-but-visible facts are
  always shown with their date. (Known limitation: a viewer may see an old figure whose replacement is
  hidden; the date and any topic hint are the only signals. This is deliberate: no leak.)
- User-facing status is derived from `resolve_for(viewer)` only. Stored `status` and the offline
  `apply_status` output must never be shown to a viewer.

### Search (`brain/search.py`)

1. Candidate set = notes the person can read (filter first).
2. Score with BM25 over title + body + frontmatter values; optional embedding score (fastembed
   `BAAI/bge-small-en-v1.5`) fused by reciprocal rank when available; BM25 alone must work.
3. Expand one hop along readable edges for the top hits (relationship questions).
4. Return hits with citations (`id`, `title`, `date`, `author`, snippet), plus `hints` for the query.

### Graph export (`brain/graph.py`)

`export(person, demo_ghosts: bool) -> dict` → `{nodes:[{id,title,type,area,access,status,date,author,claim,weight,locked}],
edges:[{source,target,kind}], areas:[{id,name,owner,owner_name,color,open,kind,person,home}]}`
(`kind`: core|department|personal; personal areas carry `person` and `home` = that person's department area
so the page can place the personal segment inside the right slice; `access` places a card on its ring:
all→everyone, area→department, restricted→restricted, private→personal). Edge kinds: `in_area, authored,
from_source, replaces, conflicts, link`. Locked nodes appear only when `demo_ghosts` is true, with no
title (`"Restricted"`), and `conflicts`/`replaces` edges only when both ends are readable.

### MCP server (`brain/server.py`, FastMCP, streamable HTTP)

Identity: URL path `/<token>/mcp` → person via `policy.tokens` (one personal link per person). Fallback for local runs: env `BRAIN_PERSON`.
Tools: `whoami`, `search(query)`, `read_note(id)`, `ask(question)` (search + resolutions + conflicts the
person may see + hints + citations, as a context packet for the client model to phrase),
`who_owns(topic)`, `my_conflicts()` (conflicts routed to this person), `graph_link()`.

### HTTP API (served by the same process as MCP, for the graph page)

- `GET /api/people` → `[{id,name,title}]` (demo role switcher; demo only)
- `GET /api/graph?person=<id>&ghosts=1` → graph export (see Graph export)
- `GET /api/graph?person=<id>&people=1` → graph with person nodes at their home areas and
  readable `authored`, `attended`, and reciprocal `collaborates` edges (default `people=0`)
- `GET /api/person?person=<viewer>&id=<person>` → public identity and declared expertise,
  plus activity topics with readable evidence IDs and collaborators from readable notes
- `GET /api/who?person=<viewer>&q=<topic>` → ranked expertise with declared matches and
  viewer-readable activity evidence; empty when there is no match
- `GET /api/note?person=<id>&id=<note id>` → `{id,title,type,area,frontmatter:{...},body,links:[{id,title}]}`
  or 404 when unreadable (same 404 as non-existent: no existence leak)
- `GET /api/ask?person=<id>&q=<text>` → ask packet:
  `{question, person, hits:[Hit], resolutions:[{key:[subject,attribute], winner:{id,title,value,date,author_name},
  superseded:[{id,title,value,date}], conflicts:[{winner,challenger,severity,route_to,reason}], reason}],
  hints:[text], summary: str}` where `summary` is a plain templated paragraph (no LLM needed).
  **Additive (RAG):** `/api/ask` also returns `rag`: `null` (disabled via `BRAIN_RAG=0`, or the LLM failed) or
  `{text: str, cited: [note id], model: str, frameworks?: [{title,snippet,source_url}]}`. `text` is an LLM answer
  written only from the viewer-readable notes in the packet (plus the precedence winner/conflict and, if
  `brain.outside` exists, public frameworks listed separately). The MCP `ask` tool is unchanged (the calling
  Claude is the LLM). Retrieval is always hybrid keyword + meaning index; the server builds the index at
  startup (`BRAIN_EMBED=0` turns it off; missing fastembed logs a warning and falls back to keyword).

### Intake (`brain/intake/`)

- `Envelope{id, source_type, source_uri, title, author, date, area, access, allow, body}`; every importer
  returns envelopes; `write_note(envelope)` writes a note (path-confined to the data dir, slug-safe).
- Importers: markdown/txt, pdf (pypdf), docx (python-docx), csv/xlsx (one note per sheet + table body),
  json, meeting transcript (speaker lines → `allow` = attendees).
- Fact extraction is a prompt (`brain/intake/extract_prompt.md`) plus a validator
  (`brain/intake/validate.py`) that checks every fact note against the schema. The extractor itself is
  the build agent (Claude Code/Codex) or `claude -p`, not a paid API key.

### Graph page (`web/`)

Static page reading `/graph.json?person=<id>` from the server (or a file). Style of mockup v3
(`docs/mockup-v3.html`): company hub in the centre, area clusters around it with coloured backdrops,
locked areas shown with a padlock and their name, role switcher, hover highlights links, click opens the
note (frontmatter + links), red dashed conflict edges, green replaces edges, an "ask" panel. Renderer:
sigma.js + graphology (ForceAtlas2) or the mockup's own canvas code; must handle ~2k nodes.

## Repo layout

```
brain/ schema.py store.py access.py precedence.py search.py graph.py server.py
       intake/ envelope.py write.py validate.py extract_prompt.md importers/*.py  cli.py
web/   index.html (+ js)
data/<co>/    the supplied company, imported on the day (no fake dataset)
tests/
docs/  design.md, mockup-v3.html, runsheet.md, lane-briefs/
```

## Build lanes (today, before the event; separate folders, in parallel)

| Lane | Owns | Builder |
|---|---|---|
| L1 core | schema, store, access, precedence + tests | Codex gpt-6-sol |
| L2 search + graph export | search.py, graph.py + tests | Codex gpt-6-sol |
| L3 intake | brain/intake/** + tests | Codex gpt-6-sol |
| L4 MCP server + CLI | server.py, cli.py + tests | Codex gpt-6-sol |
| L5 graph page | web/** | Claude Opus (UI) |
| Runsheet + day-of briefs | docs/runsheet.md, docs/lane-briefs/ | this session |

All lanes code against the interfaces in `brain/schema.py` (committed first). Review: Codex work is
reviewed by Opus; integration test over the real company data is the gate.

## Out of scope

Real OAuth login (tokens in the URL are enough for the demo), write-back from chat clients, live sync
from SaaS sources, multi-company tenancy.

## Platform (app/, from 04/11): the brain as a self-serve product
Jakob 04/11: "copy the appstarter repo (or what is useful) and build on it" so it is "easy to publish and have others
use the company brain". `app/` is digohq/app-starter (MIT): Next.js web (:3000), NestJS api (:3001), Postgres, Redis.
The Python brain runs beside it as a third service (:8000). Rule: the brain still enforces all access; the api never
receives note text except what the brain already filtered for that person.

- Tenancy: starter `Organization.id` = brain company id; brain data at `$BRAIN_ROOT/<orgId>/` (policy.yaml + notes).
- People: brain person id = starter `User.id`; name/title from the user. Rank from org role: OWNER 100, ADMIN 70,
  MEMBER 30 (an Access-page override wins). `core` area always exists (readers: everyone); a private area per member.
- Departments live in Prisma: `BrainArea {orgId, slug, name, ownerUserId, readerGroups[], topics[]}` and
  `BrainMember {orgId, userId, groups[], home?, rankOverride?, title?}`. The api turns them into a policy and syncs it.
- Env: `BRAIN_INTERNAL_URL` (api→brain), `BRAIN_SERVICE_TOKEN` (shared secret), `BRAIN_PUBLIC_URL` (browser/MCP
  base), `BRAIN_ROOT` (data root).

### Brain internal API (api → brain only; header `X-Brain-Service: $BRAIN_SERVICE_TOKEN`, else 401)
- `PUT  /internal/orgs/{org}/policy` JSON `{people:{id:{name,title,rank,groups,home}}, areas:{slug:{name,owner,readers,topics}}}`
  → writes policy.yaml (keeps existing tokens) → `{ok, people, areas}`.
- `POST /internal/orgs/{org}/import` multipart `file, area, access(all|area|restricted|private), author, allow(csv ids)`
  → intake → `{imported:[{id,title}], skipped:[{name,reason}]}`; schedules an index rebuild.
- `GET  /internal/orgs/{org}/notes?person=ID` → notes that person can read: `[{id,title,type,area,date,access}]`.
- `POST /internal/orgs/{org}/view-token` JSON `{person, ttl_seconds}` → `{url}` = `$BRAIN_PUBLIC_URL/v/{token}/`;
  token = HMAC(secret, org|person|exp), base64url.
- `GET  /internal/orgs/{org}/mcp-link?person=ID` → `{url}` (per-person MCP link; creates the token in policy if missing).

### Brain public routes
- `/v/{token}/` serves the graph page, `/v/{token}/how.html` the How-it-works page, `/v/{token}/api/*` the existing
  `/api/*` with org + person fixed by the token (any `?person=` is ignored). Expired/invalid token → 404, same body.
- Per-person MCP links work per org (token → org + person). `serve --data <dir>` single-company mode keeps working.

### Api (Nest) endpoints for the web app (JWT + org membership, follow the starter's Projects vertical for scoping)
- `GET  …/brain/view` → `{url}` · `GET …/brain/mcp-link` → `{url}` · `GET …/brain/notes` → readable notes.
- `GET/PUT …/brain/access` → areas + members (groups, home, rank override, title); PUT is OWNER/ADMIN only.
- `POST …/brain/upload` multipart (file, area, access, allow) → forwards to brain import with author = current user.
- Policy sync: on access PUT, member join/leave/role change, and (idempotent) before view/upload.

### Web pages (org dashboard)
- **Brain**: the view URL in a full-height iframe + a "Connect Claude / ChatGPT" card with the MCP link (copy button,
  3-step instructions). **Upload**: drop files, pick area, access, allowed members. **Access** (OWNER/ADMIN): areas
  table (owner, readers, topics) + members table (departments, home, rank, title). Nav entries for all three.

### Access model v2 (Jakob 04/11 ~16:00; deadline 21:30) — replaces "Departments live in Prisma" above
Jakob: "up to 10 departments or business functions, each with a number of employees, let's say maximum five for now
… Each of the employees must have a kind of private space … information that is available to the whole department.
Every department can access the core layer of every other department. Every person can access the full core of the
company, and then different people can be given different access rules to look deeper into departments. One person
can never access private information of another … as long as that person doesn't [commit it] into the department or
core … if information goes from the department inter[nal] information into the core of the company that must be the
choice of somebody with that kind of authority within that department." Choices: "4 rings", "Department leads" (owner/
admins cannot override), grants by "Company owner/admins", demo company: "Yes, invent one". "really nice
visualization layer … that builds upon what is already there".

**Four rings (layer → brain primitives):**
| Layer | Who reads | Brain note |
|---|---|---|
| `core` company core (center) | everyone | `area: core`, `access: all`, `origin_dept` kept when promoted |
| `dept-core` department core | everyone | `area: <dept>`, `access: all` |
| `dept` department internal | the department's members + people granted that department | `area: <dept>`, `access: area` (area readers = `[<dept>, grant:<dept>]`) |
| `private` | only the author | `area: personal-<person>`, `access: private` |
Limits: ≤10 departments, ≤5 members per department (api enforces). A person has one home department.
Policy v2: area `<dept>` gets `leads: [person ids]` (1-2); a grant = person is in group `grant:<dept>`.

**Moves (brain enforces; api only forwards who asked):**
- `private → dept` ("commit"): only the author, only into their own department.
- `dept → dept-core` and `dept|dept-core → core`: only a lead of that department. Owner/admins cannot.
- Owner/admins may upload straight into `core`. Nobody else writes `core` directly.
- Members ask with a promotion request (api: Prisma `PromotionRequest`, notification to the leads); a lead approves
  (api calls the brain move with `by = lead`) or declines.
- Every move is recorded on the note: `moved: [{from, to, by, at}]` (shown in the UI).

**Brain additions:** `POST /internal/orgs/{org}/notes/{id}/move` `{to: dept|dept-core|core, by}` → 403 if not allowed
(same body whether the note is unreadable or the move is forbidden); notes list and graph export add `layer`, `dept`,
`can_move: [targets]` for the viewer; policy PUT accepts `leads` and `grant:<dept>` groups.
**Api additions:** departments CRUD (name, leads, members ≤5), grants (owner/admin), `POST …/brain/notes/:id/commit`,
`POST …/brain/notes/:id/promotion-requests`, `GET …/brain/promotion-requests` (leads see their department's),
`POST …/brain/promotion-requests/:id/approve|decline`.
**Web additions:** My space (private notes + "Commit to my department"), Approvals inbox (leads), note layer badges +
"Request promotion"/"Promote", Access page v2 (departments, members, leads, grants).
**Visualization:** the graph's rings become the four layers (center core → department cores → department internal →
private per person), department slices around the circle, promotions animate inward, hidden zones show structure
(department and people names are not secret) but never hidden notes, counts or titles.
