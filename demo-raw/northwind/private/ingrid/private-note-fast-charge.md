---
title: "Ingrid private: fast-charge temperature worry"
author: ingrid
date: 2026-10-30
---

# Fast-charge temperature worry

I am worried about the cell temperature gradient during 45 C fast charging and I have not told Tobias yet.

The numbers from the last three runs on the rig show the outer cells running warmer than the centre of the pack. The gap is small on the first run and grows on the third, which could be a thermal path problem and not just sensor noise. I do not have a clean explanation yet. The BMS thermal cutoff passed, so nothing is unsafe in the test, but the cutoff is a backstop and not a design margin, and I would not want to lean on it.

Plan: test first. I will repeat the 45 C fast-charge run on the rig with thermocouples on each row of cells, and compare the result with the balancing data from last month. If the gradient repeats, I will write it up properly with the data and bring it to Tobias. I do not want to raise a scare on one odd run, and I do not want to sit on it either.

Open questions for me:

- Is the firmware charge taper starting too late? A lower taper point would cut the peak, but it costs charge time on the bench.
- Does the pack fixture pressure change the thermal path? The fixture was tightened after the last build and I never checked it against the first runs.
- Who on the mechanical side could look at the fixture without disturbing the mount work this week?

Next step: book the rig for Thursday morning and send the setup photos to myself so I can reproduce the same layout.
