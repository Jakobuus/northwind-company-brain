---
title: Supplier lead-time report (Cellwerk)
author: mateo
date: 2026-10-28
---

# Supplier lead-time report (Cellwerk)

Prepared by Mateo Fischer, Supply Chain Manager, 28 October 2026.

## Why this report

Sales and production both plan around how long a battery pack takes from purchase order to our dock in Berlin. Until now that number was an estimate. This report replaces it with what the deliveries actually did.

## What we measured

Measured on 8 actual deliveries between February and October 2026, the average lead time for Cellwerk battery packs is 9 weeks.

The raw data is in `battery-deliveries-2026.csv` next to this report. Every row is one purchase order, with the order date, the goods-receipt date and the weeks in between. The export was taken on 28 October 2026.

- Shortest delivery: 8 weeks.
- Longest delivery: 10 weeks.
- The last three deliveries took 9 or 10 weeks each.
- The spread has not shrunk since spring. It is not a one-off bad month.

## Recommendation

Range 8-10 weeks, recommends planning with 10 weeks. Production plans, dealer stock commitments and any new order for T1 spare packs should assume 10 weeks from order to delivery. A 9-week plan works on average, but it leaves no slack when a shipment slips.

I have checked the dates against the Cellwerk email threads from October. The thread history is in `supplier-threads-2026-10.mbox`.

## Next steps

1. Sofia and I review the 10-week planning figure in the next operations meeting.
2. I update the reorder rules in the inventory policy so the safety stock covers the full 10 weeks.
3. I ask Cellwerk for a written delivery window on the 2027 framework volume.

Questions go to me directly or to the operations channel.
