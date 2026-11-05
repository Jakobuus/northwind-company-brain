# Demo company: Northwind Bikes (INVENTED)

Single source of truth for the writer agents, the seed script and the video. Everything here is fictional. The machine-readable twin is `demo-raw/northwind/manifest.json` (departments, people, grants, 65 file rows). If the two disagree, the manifest wins for file work, this page wins for the story. "Today" in the story is **2026-11-04**; no file is dated later than 2026-11-03.

Model: 4 rings per company (company core, department core, department internal, private; see `docs/design.md` "Access model v2"). Raw files go to `demo-raw/northwind/<path>` (paths in the manifest). The company, departments, leads, members and grants are created through the product (api), not from a policy file: `data/northwind/policy.yaml` is gone.

## Company
Northwind Bikes: 29-person e-bike maker, Berlin Kreuzberg (HQ, 22 people) and Amsterdam (sales, design; 7 people). Founded 2021. Assembly is done by the contract partner Werkstatt Spree (Berlin). Model T1 launched April 2025 (500 Wh, retail EUR 2,190, gross margin 38%, 62 dealers in DE/NL/BE). Model T2 (mid-drive 85 Nm, 720 Wh pack) is in development. 2025 revenue EUR 9.8M; Q3 2026 revenue EUR 3.4M (1,480 T1 bikes plus accessories); cash EUR 7.9M. Battery supplier **Cellwerk GmbH**, frame supplier **Rahmenbau Nord**. Competitor in the board papers: **Halden Bikes GmbH**, Hamburg (Leadership internal only).

## Departments and people (8 departments, 32 people, max 8 each; Sales has 7)
Email `firstname@northwind.example`, password for every demo account `Demo123!`. Person id = first name lowercase (also the author id in the manifest, which uses the email).

| Department (slug) | Leads | People (name, title, role) |
|---|---|---|
| Leadership (`leadership`) | Clara Vogel | Clara Vogel (CEO and co-founder, OWNER); Mia Janssen (Chief of Staff, ADMIN); Niklas Roth (Head of Strategy and Corporate Development) |
| Product & Engineering (`product-engineering`) | Tobias Weber, Priya Nair | Tobias Weber (Head of Engineering); Priya Nair (Product Manager); Ingrid Kowalski (Senior Battery Engineer (BMS expert)); Felix Neumann (Software Engineer); Oskar Lindgren (Mechanical Engineer) |
| Sales (`sales`) | Jakob Volbracht, Elena Costa | Jakob Volbracht (Head of Sales); Elena Costa (Team Lead, DACH); Sanne Visser (Team Lead, Benelux); Lukas Hartmann (Account Executive, Berlin); Daan de Vries (SDR, Amsterdam); Mila Jansen (SDR, Rotterdam); Noah Becker (Account Executive, Munich) |
| Marketing (`marketing`) | Lea Bauer | Lea Bauer (Head of Marketing); Marta Silva (Content Marketer); Ben Okafor (Growth Marketer) |
| Operations & Supply (`operations`) | Sofia Marchetti | Sofia Marchetti (COO, Head of Operations); Mateo Fischer (Supply Chain Manager); Tomasz Nowak (Production Planner); Aylin Demir (Logistics Coordinator) |
| Finance (`finance`) | Jonas Brandt | Jonas Brandt (CFO); Noor Haddad (Financial Analyst); Carl Ekstrom (Controller) |
| People (`people`) | Hannah Lindqvist | Hannah Lindqvist (Head of People); Zoe Martin (Recruiter); Ravi Shah (People Operations) |
| Customer Care (`customer-care`) | Yara Kamal | Yara Kamal (Head of Customer Care); Pieter Bos (Support Agent NL); Greta Fuchs (Support Agent DE); Ines Moreau (Care Analyst) |

Full table (one row per login):

| name | email | department | lead? | role | grants |
|---|---|---|---|---|---|
| Clara Vogel | clara@northwind.example | Leadership | yes | OWNER | - |
| Mia Janssen | mia@northwind.example | Leadership | - | ADMIN | - |
| Niklas Roth | niklas@northwind.example | Leadership | - | MEMBER | - |
| Tobias Weber | tobias@northwind.example | Product & Engineering | yes | MEMBER | - |
| Priya Nair | priya@northwind.example | Product & Engineering | yes | MEMBER | - |
| Ingrid Kowalski | ingrid@northwind.example | Product & Engineering | - | MEMBER | - |
| Felix Neumann | felix@northwind.example | Product & Engineering | - | MEMBER | - |
| Oskar Lindgren | oskar@northwind.example | Product & Engineering | - | MEMBER | - |
| Jakob Volbracht | jakob@northwind.example | Sales | yes | MEMBER | - |
| Elena Costa | elena@northwind.example | Sales | yes | MEMBER | - |
| Sanne Visser | sanne@northwind.example | Sales | - | MEMBER | - |
| Lukas Hartmann | lukas@northwind.example | Sales | - | MEMBER | - |
| Daan de Vries | daan@northwind.example | Sales | - | MEMBER | - |
| Mila Jansen | mila@northwind.example | Sales | - | MEMBER | - |
| Noah Becker | noah@northwind.example | Sales | - | MEMBER | - |
| Lea Bauer | lea@northwind.example | Marketing | yes | MEMBER | Customer Care internal |
| Marta Silva | marta@northwind.example | Marketing | - | MEMBER | - |
| Ben Okafor | ben@northwind.example | Marketing | - | MEMBER | - |
| Sofia Marchetti | sofia@northwind.example | Operations & Supply | yes | MEMBER | Product & Engineering internal |
| Mateo Fischer | mateo@northwind.example | Operations & Supply | - | MEMBER | - |
| Tomasz Nowak | tomasz@northwind.example | Operations & Supply | - | MEMBER | - |
| Aylin Demir | aylin@northwind.example | Operations & Supply | - | MEMBER | - |
| Jonas Brandt | jonas@northwind.example | Finance | yes | MEMBER | Sales internal |
| Noor Haddad | noor@northwind.example | Finance | - | MEMBER | - |
| Carl Ekstrom | carl@northwind.example | Finance | - | MEMBER | - |
| Hannah Lindqvist | hannah@northwind.example | People | yes | MEMBER | - |
| Zoe Martin | zoe@northwind.example | People | - | MEMBER | - |
| Ravi Shah | ravi@northwind.example | People | - | MEMBER | - |
| Yara Kamal | yara@northwind.example | Customer Care | yes | MEMBER | - |
| Pieter Bos | pieter@northwind.example | Customer Care | - | MEMBER | - |
| Greta Fuchs | greta@northwind.example | Customer Care | - | MEMBER | - |
| Ines Moreau | ines@northwind.example | Customer Care | - | MEMBER | - |

Rules of the model the story relies on: Clara (OWNER) and Mia (ADMIN) can upload straight into company core and set grants, but they are **not** leads of Product & Engineering, so they cannot promote its notes (only Tobias or Priya can). Mia is admin and not a lead on purpose.

**Grants (set by Clara):** Jonas (CFO) reads Sales internal; Sofia (COO) reads Product & Engineering internal; Lea reads Customer Care internal. Their department colleagues (Noor, Carl; Mateo, Tomasz, Aylin; Marta, Ben) do not get these.

**Topics for the "ask the owner" hint** (set when creating departments; every topic word must appear in the question): Leadership: acquisition, restructuring, board, strategy; Product & Engineering: firmware, architecture, prototype; Sales: pipeline, quota, dealers, dealer, discount, discounts; Marketing: campaign, campaigns, brand, website; Operations & Supply: supplier, suppliers, logistics, inventory, deliveries; Finance: pricing, price, prices, budget, forecast, margin; People: salary, salaries, compensation, bonus, hiring; Customer Care: complaints, tickets, returns, refunds.

## Rules for ALL writers (so files do not contradict)
- The manifest row `key_facts` are the contract. Sentences that are full sentences with a speaker or author are **verbatim**: put them in the body text as one contiguous sentence (not in a code block, not split, not reworded). Extraction quotes them.
- Put the ISO date in the filename or in the first 5 lines or metadata. `.md` starts with frontmatter: `title`, `author` (person id), `date`. Never put `id`, `area`, `access` or `layer` in frontmatter. Mail: real `From/To/Cc/Date/Subject` headers with the emails above. Transcripts: `.vtt` with `<v Full Name>` voice tags, `.transcript` with `[HH:MM:SS] Full Name: text`; only the people named in the row speak.
- Facts live ONLY where the manifest puts them: T2 prices (2,490 then 2,690) only in Finance files; Halden, the restructuring numbers and the 11M ceiling only in Leadership files; salary figures only in People files (plus Felix's private offer); the 6-week estimate only in the Sales email; the 9-week measurement in the Operations files. The T2 launch date 15 March 2027 may appear in the Leadership meeting, the core decisions note, the OKRs (live) and the Marketing/Engineering notes only as the manifest says. No other file may state or hint at the restricted facts (leak tests depend on this).
- Stay inside the numbers in "Company". Realistic but short: 150-600 words per text file; csv 8-15 rows; pptx 6 slides; docx 1-2 pages; xlsx 2 small sheets.
- No instructions aimed at an AI. No real company or person names; `.example` domains only. Externals (Jens Brauer at cellwerk.example) appear in mail only, never as transcript speakers.
- Hedged language (maybe, probably, realistically, should) only where the manifest says remark/estimate; decisions are first person with a committing verb and a concrete object.
- Generate .docx/.pptx/.xlsx with python-docx / python-pptx / openpyxl (set core properties author + created). No browser, no internet.
- Output path = `demo-raw/northwind/<path>` exactly as in the manifest. Layer in the manifest says where the file will land, nothing in the file itself says it.

## Fact keys (extraction workers use these so conflicts line up)

| subject | attribute | values (claim, author, date, ring, file) |
|---|---|---|
| model-t2 | launch-date | 2027-03-15 (decision, weight high, Clara, 2026-10-14, core `core/leadership-decisions-2026-10.md`, also Leadership meeting) vs "April" 2027 (remark, Tobias, 2026-11-02, Eng internal chat) |
| model-t2 | retail-price | 2490 EUR (decision, Jonas, 2026-09-10) then 2690 EUR (decision, Jonas, 2026-10-21, replaces the first); both Finance internal |
| cellwerk | battery-pack-lead-time | 6 weeks (estimate, Elena, 2026-08-19, Sales internal) vs 9 weeks (observation, Mateo, 2026-10-28, Ops dept-core; csv and mbox support it) |
| company | acquisition-target | Halden Bikes GmbH (Leadership internal only) |
| company | restructuring-plan | merge Amsterdam+Halden sales, 8 roles at risk (Leadership internal only) |
| model-t1 | retail-price | 2190 EUR (core handbook, Marketing dept-core wiki; no conflict) |
| company | revenue-objective-2027 | 28.0M EUR (target, Clara, 2026-11-03, live core OKRs; consistent with the Finance budget draft) |

Precedence (from `docs/design.md`): binding beats factual beats informal; a newer remark never overrides a decision (it becomes a conflict); same-class owner figures: newer wins; factual: newer date first (the 9-week measurement is newer and an observation). Resolution runs per viewer, over the notes that viewer can read.

## Manifest summary by writer batch (62 seed files + 3 live; one writer per batch)
Each row in `manifest.json`: `path, format, author (email), date, dept, layer (core|dept-core|dept|private), title, key_facts[], scenario, batch, seed`. `seed:false` rows are the live-ingest files and are NOT loaded by the seed script.

### B1-core-leadership (10 files; 5 core, 4 dept, 1 private)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `core/company-handbook-overview.md` | md | clara | 2026-06-02 | core | - |
| `core/all-hands-2026-10-30.md` | md | clara | 2026-10-30 | core | S7 general answer for restructuring question |
| `core/leadership-decisions-2026-10.md` | md | clara | 2026-10-14 | core | S1a decision (beats Tobias remark) |
| `core/values-and-ways-of-working.md` | md | mia | 2026-05-20 | core | - |
| `core/company-calendar-2026-h2.csv` | csv | mia | 2026-09-01 | core | - |
| `leadership/leadership-meeting-2026-10-14.vtt` | vtt | clara | 2026-10-14 | dept | S1a origin of decision |
| `leadership/board-meeting-2026-10-27.transcript` | transcript | clara | 2026-10-27 | dept | S7 hidden from other departments |
| `leadership/board-deck-2026-10-27.pptx` | pptx | niklas | 2026-10-27 | dept | S7 hidden from other departments |
| `leadership/strategy-memo-2026.md` | md | clara | 2026-07-08 | dept | - |
| `private/clara/private-note-halden-ceiling.md` | md | clara | 2026-10-28 | private | S2b private stays private |

### B2a-engineering-docs (5 files; 5 dept)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `product-engineering/bms-explained-for-everyone.md` | md | ingrid | 2026-08-04 | dept | S3 promote dept->core by lead Tobias; X who-knows-BMS |
| `product-engineering/bms-design-doc-v3.md` | md | ingrid | 2026-07-22 | dept | X who-knows-BMS evidence |
| `product-engineering/bms-cell-balancing-review.md` | md | ingrid | 2026-09-29 | dept | X who-knows-BMS evidence |
| `product-engineering/t2-architecture.md` | md | tobias | 2026-08-18 | dept | - |
| `product-engineering/t2-product-requirements.docx` | docx | priya | 2026-09-12 | dept | - |

### B2b-engineering-comms (6 files; 4 dept, 2 private)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `product-engineering/standup-2026-09-08.vtt` | vtt | tobias | 2026-09-08 | dept | X who-knows-BMS evidence |
| `product-engineering/standup-2026-10-06.vtt` | vtt | tobias | 2026-10-06 | dept | X who-knows-BMS evidence |
| `product-engineering/team-chat-eng-t2-2026-11-02.md` | md | tobias | 2026-11-02 | dept | S1a remark (loses to Clara's decision, shown as conflict) |
| `product-engineering/firmware-0.9-release-notes.md` | md | felix | 2026-10-19 | dept | - |
| `private/ingrid/private-note-fast-charge.md` | md | ingrid | 2026-10-30 | private | S2 commit private -> department in the video |
| `private/felix/private-note-offer.md` | md | felix | 2026-10-24 | private | S2b private stays private |

### B3-sales (8 files; 8 dept)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `sales/battery-lead-time-email.eml` | eml | elena | 2026-08-19 | dept | S1c estimate (loses to Mateo's measurement) |
| `sales/pipeline-2026-q4.csv` | csv | sanne | 2026-10-30 | dept | S4 granted outsider Jonas reads, Noor does not |
| `sales/q3-sales-review.md` | md | elena | 2026-10-08 | dept | S4 granted outsider |
| `sales/dealer-call-fietshuis-2026-10-12.vtt` | vtt | daan | 2026-10-12 | dept | - |
| `sales/dealer-network-plan.md` | md | elena | 2026-09-03 | dept | - |
| `sales/wiki-dealer-onboarding.html` | html | lukas | 2026-05-12 | dept | S3 pending promotion request (Lukas -> Elena) |
| `sales/dealer-discount-policy.docx` | docx | elena | 2026-08-25 | dept | - |
| `sales/quota-by-rep-2026-h2.csv` | csv | sanne | 2026-07-01 | dept | - |

### B4-marketing (6 files; 2 dept-core, 4 dept)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `marketing/wiki-product-lineup.html` | html | lea | 2026-09-15 | dept-core | dept-core example |
| `marketing/brand-guidelines.pptx` | pptx | marta | 2026-04-10 | dept-core | dept-core example |
| `marketing/campaign-brief-t2-teaser.md` | md | lea | 2026-10-20 | dept | - |
| `marketing/website-traffic-2026-q3.csv` | csv | ben | 2026-10-09 | dept | - |
| `marketing/content-calendar-2026-q4.md` | md | marta | 2026-10-02 | dept | - |
| `marketing/newsletter-draft-november.eml` | eml | marta | 2026-10-29 | dept | - |

### B5-operations (8 files; 1 dept-core, 7 dept)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `operations/supplier-lead-time-report-2026-10-28.md` | md | mateo | 2026-10-28 | dept-core | S1c observation (beats Elena's 6-week estimate) |
| `operations/battery-deliveries-2026.csv` | csv | mateo | 2026-10-28 | dept | S1c supporting data |
| `operations/supplier-scorecard-2026-q3.xlsx` | xlsx | mateo | 2026-10-05 | dept | - |
| `operations/logistics-weekly-2026-10-21.vtt` | vtt | sofia | 2026-10-21 | dept | - |
| `operations/inventory-policy.md` | md | sofia | 2026-06-20 | dept | - |
| `operations/cellwerk-contract-email.eml` | eml | sofia | 2026-09-16 | dept | - |
| `operations/assembly-partner-capacity.md` | md | tomasz | 2026-08-11 | dept | - |
| `operations/supplier-threads-2026-10.mbox` | mbox | mateo | 2026-10-24 | dept | S1c supporting evidence |

### B6-finance (7 files; 7 dept)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `finance/t2-pricing-memo-2026-09-10.md` | md | jonas | 2026-09-10 | dept | S1b owner's first figure |
| `finance/t2-pricing-memo-2026-10-21.md` | md | jonas | 2026-10-21 | dept | S1b owner replaces own figure; S5 pricing frameworks |
| `finance/finance-sync-2026-10-21.vtt` | vtt | jonas | 2026-10-21 | dept | S1b support |
| `finance/budget-2027-draft.xlsx` | xlsx | jonas | 2026-10-15 | dept | S1b consistent |
| `finance/q3-close-report.md` | md | carl | 2026-10-12 | dept | - |
| `finance/cash-forecast-2026-2027.csv` | csv | noor | 2026-10-26 | dept | - |
| `finance/margin-analysis-t1.md` | md | noor | 2026-09-22 | dept | - |

### B7-people (6 files; 2 dept-core, 4 dept)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `people/hr-handbook-2026.docx` | docx | hannah | 2026-05-15 | dept-core | dept-core example |
| `people/onboarding-checklist.html` | html | ravi | 2026-03-10 | dept-core | dept-core example |
| `people/salary-bands-2026.docx` | docx | hannah | 2026-06-30 | dept | S7 hint to Hannah; People internal |
| `people/compensation-review-email.eml` | eml | hannah | 2026-10-05 | dept | - |
| `people/hiring-plan-2027.md` | md | hannah | 2026-10-18 | dept | - |
| `people/recruiting-pipeline-2026-q4.csv` | csv | zoe | 2026-10-27 | dept | - |

### B8-customer-care (6 files; 2 dept-core, 4 dept)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `customer-care/support-playbook.md` | md | yara | 2026-03-02 | dept-core | dept-core example |
| `customer-care/returns-policy.docx` | docx | yara | 2026-04-20 | dept-core | dept-core example |
| `customer-care/ticket-summary-2026-q3.csv` | csv | ines | 2026-10-05 | dept | - |
| `customer-care/customer-feedback-calls-2026-10-15.vtt` | vtt | yara | 2026-10-15 | dept | - |
| `customer-care/escalation-email-2026-10-23.eml` | eml | pieter | 2026-10-23 | dept | - |
| `customer-care/csat-report-2026-q3.md` | md | ines | 2026-10-07 | dept | - |

### L-live-ingest (3 files; 1 core, 1 dept, 1 private)
| path | fmt | author | date | layer | scenario |
|---|---|---|---|---|---|
| `_live/company-okrs-2027.docx` | docx | clara | 2026-11-03 | core | S6 live ingest -> core ring |
| `_live/care-ticket-spike-2026-11-03.csv` | csv | yara | 2026-11-03 | dept | S6 live ingest -> dept internal ring; S4 grant (Lea) |
| `_live/priya-roadmap-doubts.md` | md | priya | 2026-11-03 | private | S6 live ingest -> private ring |
## How the seed script loads the manifest (through the product, in this order)
1. Owner Clara signs up and creates the organisation Northwind Bikes; create the 8 departments with their leads and topics; invite/create the other 28 people into their home department (password `Demo123!`); Mia gets ADMIN; set the 3 grants.
2. For every row with `seed: true`, upload as the **author** with the layer below. The brain extraction pass (follow `brain/intake/extract_prompt.md` and the fact keys above) runs after all uploads.
   - `core`: upload by Clara or Mia straight to company core (owners/admins may).
   - `dept`: upload by the author into their own department (internal).
   - `dept-core`: upload as `dept`, then the department lead moves it to dept-core (author is the lead for Lea, Sofia, Hannah and Yara files; Marta's brand deck is moved by Lea, Ravi's onboarding page by Hannah).
   - `private`: upload by the author into their personal space.
3. Create Lukas's pending promotion request for `sales/wiki-dealer-onboarding.html` (to company core, decider Elena; do NOT approve it).
4. Do not touch `seed: false` rows (`_live/*`): Jakob drops them in during the video.
5. Check: `validate --data`, then log in as Daan: he must see core and dept-cores only (no Halden, no 2,690, no 6-week estimate).

## Scenario map (traceable to exact files)
| # | Scenario | Files | What the viewer sees |
|---|---|---|---|
| 1a | Lead's decision beats a later remark | decision `core/leadership-decisions-2026-10.md` (Clara, 14 Oct; origin `leadership/leadership-meeting-2026-10-14.vtt`) vs remark `product-engineering/team-chat-eng-t2-2026-11-02.md` (Tobias, 2 Nov) | Tobias: 15 March 2027 stands, his "April" shown as a conflict that did not win. Daan: 15 March only, no remark visible. |
| 1b | Owner replaces own figure | `finance/t2-pricing-memo-2026-09-10.md` (2,490), `finance/t2-pricing-memo-2026-10-21.md` (2,690, replaces), support `finance-sync-2026-10-21.vtt`, `budget-2027-draft.xlsx` | Jonas: 2,690, with the 2,490 shown as superseded. Daan: no price, hint "talk to Jonas (Finance)". |
| 1c | Observation beats estimate | estimate `sales/battery-lead-time-email.eml` (Elena, 6 weeks, 19 Aug) vs measurement `operations/supplier-lead-time-report-2026-10-28.md` (9 weeks, dept-core), support `battery-deliveries-2026.csv`, `supplier-threads-2026-10.mbox` | Elena: 9 weeks measured wins, her 6-week estimate shown. Ines (Care): 9 weeks only. |
| 2 | Private note committed to department | `private/ingrid/private-note-fast-charge.md` | Before: only Ingrid sees it; Tobias asks about fast-charge heat and gets nothing. After "Commit to my department": Tobias, Felix, Priya, Oskar see it; Clara still does not. Control: `private/felix/private-note-offer.md` and `private/clara/private-note-halden-ceiling.md` stay private. |
| 3 | Lead promotes to core; member requests | promote `product-engineering/bms-explained-for-everyone.md` (Tobias -> core); pending `sales/wiki-dealer-onboarding.html` (Lukas asked, Elena approves in Approvals) | Before: Daan asks "who knows about BMS?" and gets nothing from Engineering internal. After Tobias promotes: Ingrid, with evidence. Clara (OWNER) has no Promote button on Engineering notes. |
| 4 | Granted outsider vs colleague | Jonas -> Sales internal (`sales/pipeline-2026-q4.csv`, `q3-sales-review.md`); Sofia -> Engineering internal (`t2-architecture.md`); Lea -> Care internal (live ticket csv) | Jonas sees the Q4 pipeline, Noor asks the same and gets the hint to Elena. Sofia sees the T2 architecture, Mateo does not. |
| 5 | Pricing question pulls frameworks | `finance/t2-pricing-memo-2026-10-21.md` (cost-plus EUR 2,494 vs survey median 2,750, competitor band 2,600-3,100) | Jonas asks how to price T2: company facts from the memo plus general frameworks (value-based vs cost-plus, price anchoring, willingness to pay) clearly marked as general knowledge, not company data. |
| 6 | Live ingest, one per ring | `_live/company-okrs-2027.docx` (core), `_live/care-ticket-spike-2026-11-03.csv` (Customer Care internal), `_live/priya-roadmap-doubts.md` (private) | Each answer appears for the right people only (see scene 9). |
| 7 | "Ask the owner" hint | restricted facts: `leadership/board-meeting-2026-10-27.transcript`, `board-deck-2026-10-27.pptx`; `people/salary-bands-2026.docx`; general answer from `core/all-hands-2026-10-30.md` | Felix asks about restructuring: all-hands wording plus "talk to Clara (Leadership)". Felix asks salary band: nothing, hint to Hannah (People). Clara sees the full board detail. |

## Video script cheat sheet (scene by scene; switch user = log in as `<name>@northwind.example`, `Demo123!`)
1. **Rings tour (as Clara, owner).** Open the graph: centre = company core (handbook, all-hands, decisions), department cores around it, department internals, private dots. Open the Access page: 8 departments, leads, the 3 grants. Say: Clara and Mia are not leads of Engineering.
2. **Whose word wins (S1a).** As Tobias ask: "When does the Model T2 launch?" -> 15 March 2027, Clara's decision, with his own "realistically April" chat shown as a conflict. Switch to Daan, same question -> the date only.
3. **Owner replaces own figure + frameworks (S1b, S5).** As Jonas ask: "What is the retail price of the Model T2?" -> EUR 2,690 replaces his 2,490. Then: "How should we price the T2, cost-plus or value-based?" -> memo numbers plus general frameworks marked as such. Switch to Daan: price question -> no price, hint to Jonas.
4. **Observation beats estimate (S1c).** As Elena ask: "How long do Cellwerk battery packs take to arrive?" -> 9 weeks measured (Mateo, 28 Oct) beats her 6-week estimate. Click the department-core badge on the report: everyone can read it.
5. **Private to department (S2).** As Tobias ask: "Any worries about heat during fast charging?" -> nothing. Switch to Ingrid, My space: open "fast-charge temperature worry", click **Commit to my department**; watch the dot travel from the private ring to the Engineering internal ring. Back as Tobias, ask again -> Ingrid's note. As Clara, ask again -> nothing.
6. **Lead promotes, member requests (S3).** As Daan ask: "Who knows about BMS?" -> nothing useful. As Clara open the BMS explainer: no Promote button. As Tobias click **Promote to company core**; the note moves to the centre. As Daan ask again -> Ingrid with evidence. Then as Elena open the Approvals inbox: Lukas's request for the dealer onboarding checklist -> **Approve**; it moves to core.
7. **Grants (S4).** As Jonas ask: "What is in our Q4 pipeline?" -> 14 deals from Sales internal. As Noor, same question -> hint "talk to Elena (Sales)". Optional: Sofia sees T2 architecture, Mateo gets the hint to Tobias.
8. **Ask the owner (S7).** As Felix ask: "What is happening with restructuring?" -> all-hands wording plus hint to Clara (Leadership). Ask: "What is the salary band for a senior engineer?" -> nothing, hint to Hannah. As Clara: restructuring question -> board detail (Halden, 8 roles). As Clara: "What did Felix write privately?" -> nothing.
9. **Live ingest finale (S6), three drops:**
   - As Clara drop `_live/company-okrs-2027.docx` into **company core**. As Daan ask "What are our 2027 objectives?" -> EUR 28.0M revenue, 100 dealers, T2 on 15 March.
   - As Yara drop `_live/care-ticket-spike-2026-11-03.csv` into **Customer Care internal**. As Lea (granted) ask "What are customers complaining about?" -> battery rattle spike, 23 tickets. As Marta, same question -> hint to Yara.
   - As Priya drop `_live/priya-roadmap-doubts.md` as **private**. As Priya ask "What do I doubt about the launch?" -> her note. As Tobias, same -> nothing.
   Reset after recording: delete the three live notes (or reseed).

## Seed (one command)
Needs web :3000, api :3001 (`scripts/dev-app.sh`) and the brain :8000 running; Node 22 is set by the script.
- `scripts/reset_northwind.sh` wipes the Northwind org (db rows and its brain folder) and reseeds. `scripts/reset_northwind.sh --keep` only tops up (idempotent, no wipe). Add `--skip-missing` if raw files are not all there yet.
- Code: `app/apps/api/prisma/seed-northwind.ts`. Users go in through Prisma (verified, `Demo123!`); the org, departments, leads, grants, uploads, moves and Lukas's request go through the api as the right person.
- Result: 32 people, 8 departments, 62 files = 67 notes (core 5, dept-core 7, dept internal 52, private 3), 1 pending promotion request. `_live/*` is not loaded.
- Left for the video on purpose: the BMS explainer stays in Engineering internal (Tobias promotes it in scene 6), Ingrid's note stays private (scene 5), Lukas's request stays pending (Elena approves).
- "Already uploaded" is remembered in `../.northwind-seed.json` (next to `brain-root`, outside git), because the brain gives every upload a fresh id. If it is lost while the org has notes, the script stops and asks for a reset.
- A reset creates a new org id: open the Brain page from the printed URL (or via the org list), not an old bookmark.
