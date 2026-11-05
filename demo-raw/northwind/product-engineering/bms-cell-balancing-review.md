---
title: BMS cell balancing review (200 cycles)
author: ingrid
date: 2026-09-29
---

# BMS cell balancing review (200 cycles)

Date: 2026-09-29. Author: Ingrid Kowalski.

## Summary

This review covers the cell balancing behaviour of the battery management system (BMS) over 200 charge cycles on the bench rig. I recommend active balancing for T2 if drift exceeds 3%. Below that line, the passive balancing in the current BMS design holds up.

## Test setup

The rig holds one 16S pack from the Cellwerk batch used for the T2 prototypes. Each cycle is a full charge from the low cutoff to the high cutoff, followed by a rest period of two hours. The BMS logs every cell voltage during charge and rest. Temperature is logged at the four pack sensors. The BMS runs the production firmware, with logging enabled.

## What we measured

Passive cell balancing at 60 mA per cell worked well in the first 60 cycles. The spread between the weakest and the strongest cell stayed within a narrow band. After that the spread grew slowly. Cells at the warm end of the pack gained capacity drift faster than cells at the cool end, which fits the thermal picture from the design doc.

By cycle 200 the capacity drift between the weakest and the strongest group reached 2.4%. The BMS still kept every cell inside its voltage window, so no protection event fired. The state-of-charge estimate drifted in step with the spread, which is expected, because the Kalman-filter uses the cell voltages at rest to correct its count.

## Interpretation

Passive balancing bleeds charge as heat, so it works best when the spread stays small. On this pack the spread grows with the number of cycles, and the balancing current is the limit. A higher balancing current would fix this on paper, but it would also heat the pack, and the thermal cutoff at 60 C would then trigger on hard rides.

Active balancing moves charge between cells instead of burning it. That is the better tool once drift is real. It also costs more parts and more firmware work, which is why I want the decision based on data and not on a guess.

## Recommendation

I recommend active balancing for T2 if drift exceeds 3% in the next test, which runs to 300 cycles at the warm end of the rig. Below 3%, we keep passive balancing and revisit at the next design review. The decision belongs to Tobias, as the engineering lead, once the 300-cycle result is in.

## Next steps

Run the 300-cycle test with the warm-end group loaded. Log the BMS state-of-charge alongside the cell voltages. Ask Felix to add the balancing current to the firmware log so the next review can show it directly.
