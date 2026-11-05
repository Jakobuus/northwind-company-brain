# Northwind demo video: click guide (one page, 2 screens, recorded in Luma)

Spoken narration: `../video-narration.md` (written by APP; follows the scene order below).

**Questions to paste into BOTH Claude tabs (screen 2):**
1. `What is our sales strategy for 2027?` (Jakob: 14.5M target, 28 dealers · Felix: nothing, "talk to Clara")
2. `Using the Northwind brain, what did we find in the BMS cell balancing review, and what do you recommend for T2?` (Felix: the answer · Jakob: nothing)
3. `How much cash does the company have?` (both: EUR 7.9M)

## Before you hit record
- Window 1920x1080.
- 1. Restore: `scripts/demo-up.sh` (or `scripts/demo-up.sh --no-reset` right after DATA's restore).
- 2. Run `scripts/demo-preflight.sh`: must end with READY TO RECORD.
- App at `localhost:3000`, logged in as `jakob@northwind.example` / `Demo123!`.
- Chrome split view, two claude.ai chats (new chat each): left = Jakob, only his connector on; right = Felix, only his connector on.
- Finder open at `kit/demo-raw/northwind/_live/` (file to drag: `sales-strategy-2027.pdf`).
- LAST, right before recording (after a green preflight): `PERSONAS="jakob felix" scripts/public.sh links`, then in claude.ai Settings > Connectors set "Northwind – Jakob (Head of Sales)" and "Northwind – Felix (Developer)" to these links (re-paste even if they look familiar; the tunnel address changes when it drops). Watchdog: `tail -f /tmp/demo-tunnel-watch.log` must say "ok".

## Screen 1: the app (one header "Northwind Brain", tabs Brain · Frameworks · How it works · Access · Approvals · My space)
Narration: `../video-narration.md`. Order: brain → new knowledge → frameworks → how it works → access → Claude.
1. **Brain** tab: the map full width. Explain core → department layers → personal edge.
2. "Preview as" → **Clara** (CEO: everything except personal areas). Then **back to "Jakob (you)"** (adding is off while previewing).
3. **Add new data**: drag `sales-strategy-2027.pdf` from Finder (`kit/demo-raw/northwind/_live/`) and let go anywhere on the Brain map (or **"+ Add document"** bottom left). By itself: 7-step panel (PDF → uploaded by Jakob, Head of Sales → "Sales strategy" + 3 facts → Sales → team leads yes, SDRs/AEs no → filed → indexed), folds into "Filed ✓", locked card lands in Sales.
4. **Frameworks** tab: hover a few nodes (links + colour group light up, name shows), click **Entry mode selection**: its framework opens. Count reads 1,012.
5. **How it works** tab: ingestion (parse → markdown → facts → department + permissions → index) and retrieval (find nodes → permission filter → answer or "ask the owner").
6. **Access** tab: departments, leads, SDRs/AEs, who reads what. Then **Approvals** tab: the request waiting for Jakob.
7. Optional (skip if short on time): ask bar `What is our sales strategy for 2027?`: headline, 3 points, source chips.

## Screen 2: Chrome split view (copy-paste, same moment in both chats)
Order: the PDF must already be dropped (Screen 1, step 3).

**Pair A, strategy (Jakob sees it, Felix does not)**
`Using the Northwind brain, what is our sales strategy for 2027? Give me the target, the T2 price and the dealer plan.`
- Jakob: the Sales strategy 2027 note: EUR 14.5M target, T2 at EUR 2,690, 28 new dealers (62 to 90), 2 SDRs, EUR 1.6M quota per AE.
- Felix: no strategy note, no numbers; hint "talk to Clara Vogel (Leadership)", plus public facts only (T1 EUR 2,190, T2 launch 15 March 2027).

**Pair B, engineering (Felix sees it, Jakob does not)**
`Using the Northwind brain, what did we find in the BMS cell balancing review, and what do you recommend for T2?`
- Felix: BMS review after 200 cycles; recommends active balancing if drift exceeds 3% in the next test (runs to 300 cycles).
- Jakob: nothing on it (only that Ingrid will share a T2 summary); no review, no numbers.

**Pair C (optional), company core: both see the same**
`How much cash does the company have?`
- Both: EUR 7.9M (Clara Vogel, 30 Oct).

Close on the contrast: same brain, same question, each person gets what their role may read.
