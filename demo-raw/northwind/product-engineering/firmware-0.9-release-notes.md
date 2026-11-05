---
title: "Firmware 0.9 release notes"
author: felix
date: 2026-10-19
---

# Firmware 0.9 release notes

Release date: 19 October 2026. Applies to the T1 controller and the dealer flash tool.

## Highlights

- **OTA updater.** Bikes can now receive firmware over the air. If a new image fails to boot, the controller rolls back to the previous version by itself.
- **Ride-mode tuning.** Smoother power ramp in Eco and Tour, and a retuned throttle curve in Sport.
- **BMS telemetry fields added (thanks Ingrid).** The app now receives cell balance and pack temperature every 10 seconds.

## Bug fixes (12)

1. Display froze after a long press on the mode button.
2. Walk-assist did not disengage when the brake lever was squeezed at low speed.
3. Light output dropped to zero for a second after a mode change.
4. Odometer could skip a few hundred metres after a power cycle.
5. Pairing with the app failed on the second attempt after a reset.
6. Battery icon showed 100 percent for a moment after a full charge was unplugged.
7. Speed sensor reading went negative on a hard stop.
8. Beep on start-up was too loud in the dealer flash mode.
9. Error code E14 stayed visible after the fault had cleared.
10. Clock drifted by one minute per week when the bike was off for long periods.
11. Cruise setting reset when the bike entered sleep.
12. Log upload retried forever when there was no network connection.

## Known issues

- OTA updates over the dealer flash tool need the signed image, which is still in review for the final release.
- Ride-mode tuning for heavy riders (over 110 kg) is not yet validated. Please do not promise a specific range change to customers until the next release.

## Upgrade notes

Bikes on 0.8 install 0.9 through the app or at a dealer. Keep the battery above 30 percent before starting the update.
