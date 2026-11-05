---
title: BMS design doc v3
author: ingrid
date: 2026-07-22
---

# BMS design doc v3

Date: 2026-07-22. Status: v3, for review in Product & Engineering. Author: Ingrid Kowalski, sole author.

## 1. Scope

This document describes the battery management system (BMS) for the 16S pack. It replaces version 2 and covers the pack monitoring, the cell balancing circuit, the state-of-charge estimate, the protection logic and the CAN interface. Hardware choices for the BMS board are in section 2. Thresholds are in the parameter table in Appendix A.

## 2. Pack monitoring

One BMS board serves the whole 16S pack. The BMS board reads the voltage of every series group and the temperature at four points on the pack. Current is measured at the main shunt. All readings go through the same filter before the BMS uses them, so a single noisy sensor does not trigger a protection event.

## 3. Cell balancing

The BMS uses passive cell balancing at 60 mA per cell. Balancing runs during charge only, and only on cells that sit above the balancing threshold. Passive balancing is simple and cheap to build. The downside is heat and slow correction: a cell that is far out of line takes many cycles to recover. Section 7 lists the open question on whether T2 needs active balancing instead.

## 4. State of charge

The BMS estimates state of charge with a Kalman-filter. The filter fuses coulomb counting with the measured cell voltages. Coulomb counting drifts over time, because small current errors add up. The filter corrects the drift when the pack rests and the voltage curve is stable. The BMS estimate is the number riders see on the display, so its drift matters more than any other BMS output. Section 4.2 shows the drift results from the bench tests.

### 4.2 SoC drift

On the bench, drift stayed small while the pack rested often. Drift grew during long hard rides with no rest period, which is why the filter weights voltage more heavily at rest.

## 5. Protection

The BMS cuts output when the hottest cell reaches the thermal cutoff at 60 C. The cutoff reads the hottest of the four temperature points, not the average. Under-voltage and over-voltage cutoffs sit on the same protection layer. A cutoff event is logged with a timestamp so support can trace it.

## 6. Communication

The BMS exposes a CAN interface to the motor controller and the display. Status messages go out at a fixed rate, and the BMS raises a fault frame when a protection limit is hit. The BMS never stops talking while the pack is in use, so the display always shows a current state. The message map is in Appendix B.

## 7. Open questions

Whether T2 needs active balancing depends on the 200-cycle test that is still to run. Until that test is done, the BMS keeps passive balancing in the design.
